const {app,BrowserWindow,dialog,ipcMain,Menu,safeStorage,shell,session,net}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {randomBytes,createHash}=require('node:crypto');
const fs=require('node:fs/promises');

app.setName('Papertrail');
if(process.platform==='linux')app.setDesktopName('papertrail.desktop');
if(process.env.PAPERTRAIL_DESKTOP_DATA_DIR)app.setPath('userData',path.resolve(process.env.PAPERTRAIL_DESKTOP_DATA_DIR));
let window,backend,settings,preferences,login,service,tools,stopping=false,canQuit=false;
const token=randomBytes(32).toString('hex');
const root=app.getAppPath();
const load=relative=>import(pathToFileURL(path.join(root,relative)).href);
if(!app.requestSingleInstanceLock())app.quit();
else {
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
  if(canQuit)return;
  event.preventDefault();if(stopping)return;stopping=true;
  const forced=setTimeout(()=>app.exit(0),10000).unref();
  Promise.resolve().then(async()=>{login?.cancel();await tools?.close();await backend?.close();await preferences?.writing.catch(()=>{});}).catch(error=>console.error('Shutdown:',error.message)).finally(()=>{clearTimeout(forced);canQuit=true;app.quit();});
});
app.whenReady().then(async()=>{
  const [{ToolManager,missingAssistant},{SettingsStore,PreferencesStore},{DesktopLogin},{Assistant},{CodexAssistant},{AssistantService},{startLocalServer},{searchOptions},{trustedDesktopSender,libraryPdfUrl}]=await Promise.all([
    load('desktop/tools.js'),load('desktop/settings.js'),load('desktop/login.js'),load('src/assistant.js'),load('src/codex-assistant.js'),load('src/assistant-service.js'),load('src/server.js'),load('src/search.js'),load('desktop/security.js')]);
  const directory=app.getPath('userData');
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  await fs.chmod(directory,0o700);
  const codexHome=path.join(directory,'codex');await fs.mkdir(codexHome,{recursive:true,mode:0o700});
  tools=new ToolManager(directory,{env:{...process.env,CODEX_HOME:codexHome},fetchImpl:(url,options)=>net.fetch(url,options)});await tools.load();
  settings=new SettingsStore(directory,safeStorage);await settings.load();
  preferences=new PreferencesStore(directory,input=>{
    if(!input || typeof input!=='object')throw new Error('Invalid preferences.');
    if(input.backend!==undefined && !['openworker','codex'].includes(input.backend))throw new Error('Invalid backend.');
    return {...(input.backend?{backend:input.backend}:{}),...(input.searchOptions?{searchOptions:searchOptions(input.searchOptions)}:{})};
  });await preferences.load();
  const makeOpenWorker=()=>{
    if(!tools.ready.openworker)return missingAssistant('openworker');
    const env=settings.environment();
    const identity=createHash('sha256').update(JSON.stringify([env.AI_MODEL,env.AI_BASE_URL,env.AI_API])).digest('hex').slice(0,16);
    return new Assistant(directory,{env,executable:tools.ready.openworker.path,agentName:`desktop-reader-v1-${identity}`,providerName:`DesktopProvider-${identity}`});
  };
  const codexEnvironment=()=>({...process.env,CODEX_HOME:codexHome,CODEX_PATH:tools.ready.codex?.path,PATH:[path.dirname(tools.ready.codex?.launcher || tools.ready.codex?.path || '/usr/bin/codex'),process.env.PATH || '/usr/bin:/bin'].join(path.delimiter),PAPERTRAIL_DESKTOP:'1'});
  const makeCodex=()=>tools.ready.codex?new CodexAssistant({env:codexEnvironment()}):missingAssistant('codex');
  service=new AssistantService(directory,{openworker:makeOpenWorker(),codex:makeCodex(),defaultBackend:'codex'});
  const resetAssistants=async()=>{
    login?.cancel();await service.shutdown();
    service.engines={openworker:makeOpenWorker(),codex:makeCodex()};
    login=tools.ready.codex?new DesktopLogin(tools.ready.codex.path,codexEnvironment(),url=>shell.openExternal(url),{version:app.getVersion()}):null;
  };
  await resetAssistants();
  backend=await startLocalServer({dataDir:directory,assistant:service,token});
  const origin=backend.url;
  const desktopSession=session.fromPartition('persist:papertrail');
  desktopSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  desktopSession.webRequest.onBeforeSendHeaders({urls:[origin+'/*']},(details,callback)=>callback({requestHeaders:{...details.requestHeaders,'X-Papertrail-Token':token}}));
  const trusted=event=>{
    if(!trustedDesktopSender(event,window,origin))throw new Error('Untrusted desktop request.');
  };
  const handle=(channel,callback)=>ipcMain.handle(channel,async(event,...args)=>{trusted(event);return callback(...args);});
  handle('desktop:choose-folder',async()=>{
    const result=await dialog.showOpenDialog(window,{title:'Add a PDF folder',properties:['openDirectory']});
    return result.canceled?null:result.filePaths[0];
  });
  handle('desktop:get-settings',async()=>({...await settings.publicSettings(),dataDirectory:directory,version:app.getVersion(),serverAddress:backend.url}));
  handle('desktop:get-preferences',()=>preferences.value);
  handle('desktop:save-preferences',input=>preferences.save(input));
  handle('desktop:save-settings',async input=>{
    if(service.busy)throw new Error('Wait for the current answer or AI setup to finish before changing provider settings.');
    service.reconfiguring=true;
    try{const result=await settings.save(input);await service.engines.openworker.shutdown();service.engines.openworker=makeOpenWorker();return result;}
    finally{service.reconfiguring=false;}
  });
  handle('desktop:sign-in',()=>{if(service.busy)throw new Error('Wait for the current answer or download before signing in.');if(!login)throw new Error('Open Settings → AI components to find or download Codex first.');return login.start();});
  handle('desktop:sign-in-status',()=>login?.status() || {running:false,message:'Set up Codex in Settings first.'});
  handle('desktop:open-sign-in-page',()=>{if(!login)throw new Error('Set up Codex first.');return login.openPage();});
  handle('desktop:cancel-sign-in',()=>login?.cancel());
  const toolsAvailable=()=>{if(service.busy || login?.status().running)throw new Error('Wait for the current answer, sign-in or download to finish first.');};
  handle('desktop:get-tools',()=>tools.status());
  handle('desktop:detect-tools',async()=>{
    toolsAvailable();service.reconfiguring=true;
    try{await tools.detect();await resetAssistants();return tools.status();}finally{service.reconfiguring=false;}
  });
  handle('desktop:choose-codex',async()=>{
    toolsAvailable();
    const choice=await dialog.showOpenDialog(window,{title:'Select an existing Codex executable',defaultPath:tools.ready.codex?.launcher || tools.ready.codex?.path || path.join(app.getPath('home'),'.nvm'),properties:['openFile','showHiddenFiles']});
    if(choice.canceled)return tools.status();
    toolsAvailable();service.reconfiguring=true;
    try{await tools.selectCodex(choice.filePaths[0]);await resetAssistants();return tools.status();}finally{service.reconfiguring=false;}
  });
  handle('desktop:use-codex-path',async executable=>{
    toolsAvailable();service.reconfiguring=true;
    try{await tools.selectCodex(executable);await resetAssistants();return tools.status();}finally{service.reconfiguring=false;}
  });
  handle('desktop:install-tool',id=>{
    toolsAvailable();tools.spec(id);
    if(tools.ready[id])return tools.status();
    const state=tools.startInstall(id);service.reconfiguring=true;
    tools.task=tools.task.then(()=>tools.activate(()=>resetAssistants())).finally(()=>{service.reconfiguring=false;});
    return state;
  });
  handle('desktop:cancel-tool-download',()=>tools.cancel());
  handle('desktop:import-library',async()=>{
    if(service.busy || backend.library.job?.running)throw new Error('Wait for indexing and answers to finish first.');
    if(backend.library.stats().total)throw new Error('Import is available only for an empty desktop library. Your current papers have been kept.');
    const choice=await dialog.showOpenDialog(window,{title:'Import an existing Papertrail database',properties:['openFile'],filters:[{name:'SQLite database',extensions:['sqlite','db']}]});
    if(choice.canceled)return null;
    if(service.busy || backend.library.job?.running || backend.library.stats().total)throw new Error('The library changed while selecting a file. Wait for ongoing work to finish and try again.');
    const {prepareLibraryImport,installLibraryImport}=await load('desktop/library-import.js');
    service.reconfiguring=true;let stopped=false;
    try{
      const staged=await prepareLibraryImport(choice.filePaths[0],directory);
      const confirmation=await dialog.showMessageBox(window,{type:'question',title:'Import your library',message:`Import ${staged.papers} papers and ${staged.pages} pages?`,detail:'Your source database and original PDFs stay where they are. Papertrail will restart after importing.',buttons:['Cancel','Import'],defaultId:1,cancelId:0});
      if(confirmation.response!==1){await fs.rm(staged.staged,{force:true});return null;}
      await backend.close();stopped=true;await installLibraryImport(staged.staged,directory);
      setTimeout(()=>{app.relaunch();app.quit();},300);
      return {papers:staged.papers,restarting:true};
    }catch(error){if(stopped)setTimeout(()=>{app.relaunch();app.quit();},1000);throw error;}
    finally{service.reconfiguring=false;}
  });
  function protect(contents){
    contents.on('will-navigate',(event,url)=>{try{if(new URL(url).origin!==origin)event.preventDefault();}catch{event.preventDefault();}});
    contents.on('will-attach-webview',event=>event.preventDefault());
  }
  window=new BrowserWindow({width:1380,height:950,minWidth:780,minHeight:600,show:false,
    webPreferences:{preload:path.join(root,'desktop','preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,session:desktopSession}});
  window.on('closed',()=>{window=null;for(const other of BrowserWindow.getAllWindows())other.close();if(!stopping)app.quit();});
  protect(window.webContents);
  window.webContents.setWindowOpenHandler(({url})=>{
    if(libraryPdfUrl(url,origin)){
      const viewer=new BrowserWindow({width:1000,height:850,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,session:desktopSession,plugins:true}});
      protect(viewer.webContents);viewer.webContents.setWindowOpenHandler(()=>({action:'deny'}));viewer.loadURL(url);
    }
    return {action:'deny'};
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'File',submenu:[{label:'Add folder…',accelerator:'CmdOrCtrl+O',click:()=>window?.webContents.send('desktop:command','choose-folder')},{label:'Settings…',accelerator:'CmdOrCtrl+,',click:()=>window?.webContents.send('desktop:command','settings')},{type:'separator'},{role:'quit'}]},
    {role:'editMenu'},{label:'View',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}
  ]));
  window.once('ready-to-show',()=>window.show());
  await window.loadURL(origin);
}).catch(error=>{dialog.showErrorBox('Papertrail could not start',error.message);app.quit();});
}
