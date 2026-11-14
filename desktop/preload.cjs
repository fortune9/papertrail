const {contextBridge,ipcRenderer}=require('electron');
async function invoke(channel,...args){try{return await ipcRenderer.invoke(channel,...args);}catch(error){throw new Error(error.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}}
contextBridge.exposeInMainWorld('papertrailDesktop',Object.freeze({
  chooseFolder:()=>invoke('desktop:choose-folder'),
  getSettings:()=>invoke('desktop:get-settings'),
  getPreferences:()=>invoke('desktop:get-preferences'),
  savePreferences:preferences=>invoke('desktop:save-preferences',preferences),
  saveSettings:settings=>invoke('desktop:save-settings',settings),
  startSignIn:()=>invoke('desktop:sign-in'),
  signInStatus:()=>invoke('desktop:sign-in-status'),
  openSignInPage:()=>invoke('desktop:open-sign-in-page'),
  cancelSignIn:()=>invoke('desktop:cancel-sign-in'),
  importLibrary:()=>invoke('desktop:import-library'),
  onCommand:callback=>{
    const listener=(_event,command)=>{if(['choose-folder','settings'].includes(command))callback(command);};
    ipcRenderer.on('desktop:command',listener);
    return ()=>ipcRenderer.removeListener('desktop:command',listener);
  }
}));
