import { promises as fs } from 'node:fs';
import path from 'node:path';

export function validateSettings(input) {
  if(!input || typeof input!=='object')throw new Error('Invalid settings.');
  for(const key of ['model','baseUrl','api'])if(input[key]!==undefined && typeof input[key]!=='string')throw new Error('Provider settings must be text.');
  for(const key of ['rememberKey','clearApiKey'])if(input[key]!==undefined && typeof input[key]!=='boolean')throw new Error('Key preferences must be boolean.');
  const model=String(input.model || '').trim(),baseUrl=String(input.baseUrl || 'https://api.openai.com/v1').trim();
  const api=input.api || 'responses';
  if(model.length>200 || baseUrl.length>1000 || !['responses','chat-completions'].includes(api))throw new Error('Invalid provider settings.');
  let url;try{url=new URL(baseUrl);}catch{throw new Error('Enter a valid provider URL.');}
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)throw new Error('Use an HTTP(S) provider URL without credentials, query or fragment.');
  if(input.apiKey!==undefined && (typeof input.apiKey!=='string' || input.apiKey.length>8192))throw new Error('Invalid API key.');
  return {model,baseUrl:url.href.replace(/\/$/,''),api};
}

export class PreferencesStore {
  constructor(directory,validate){this.filename=path.join(directory,'preferences.json');this.validate=validate;this.value={};this.writing=Promise.resolve();}
  async load(){try{this.value=this.validate(JSON.parse(await fs.readFile(this.filename,'utf8')));}catch{}return this.value;}
  async save(input){
    const value=this.validate(input);this.value=value;
    this.writing=this.writing.catch(()=>{}).then(async()=>{await fs.writeFile(this.filename+'.tmp',JSON.stringify(value)+'\n',{mode:0o600});await fs.rename(this.filename+'.tmp',this.filename);});
    await this.writing;return value;
  }
}

export class SettingsStore {
  constructor(directory,crypto){this.directory=directory;this.crypto=crypto;this.settings={model:'',baseUrl:'https://api.openai.com/v1',api:'responses'};this.key='';this.persisted=false;}
  async load(){
    await fs.mkdir(this.directory,{recursive:true,mode:0o700});
    try{
      const data=JSON.parse(await fs.readFile(path.join(this.directory,'settings.json'),'utf8'));
      this.settings=validateSettings(data);
      if(data.encryptedKey){
        try{const decrypted=await this.crypto.decryptStringAsync(Buffer.from(data.encryptedKey,'base64'));this.key=decrypted.result;this.persisted=true;}
        catch{this.warning='The saved key could not be unlocked. Enter it again, or unlock your desktop keyring.';}
      }
    }catch(error){if(error.code!=='ENOENT' && !this.warning)this.warning='Settings could not be loaded. Save them again to continue.';}
    return {...this.settings,hasApiKey:!!this.key,rememberKey:this.persisted,warning:this.warning || ''};
  }
  async publicSettings(){return {...this.settings,hasApiKey:!!this.key,rememberKey:this.persisted,
    secureStorageAvailable:await this.crypto.isAsyncEncryptionAvailable(),warning:this.warning || ''};}
  environment(){return {AI_MODEL:this.settings.model,AI_BASE_URL:this.settings.baseUrl,AI_API:this.settings.api,OPENAI_API_KEY:this.key};}
  async save(input){
    const settings=validateSettings(input);
    let key=input.clearApiKey?'':input.apiKey || this.key;
    let encryptedKey;
    if(key && input.rememberKey){
      if(!await this.crypto.isAsyncEncryptionAvailable())throw new Error('Your desktop keyring is unavailable. Uncheck Remember key to use it only for this session.');
      encryptedKey=(await this.crypto.encryptStringAsync(key)).toString('base64');
    }
    const filename=path.join(this.directory,'settings.json'),temporary=filename+'.tmp';
    await fs.writeFile(temporary,JSON.stringify({...settings,...(encryptedKey?{encryptedKey}:{})},null,2)+'\n',{mode:0o600});
    await fs.rename(temporary,filename);
    this.settings=settings;this.key=key;this.persisted=!!encryptedKey;this.warning='';
    return this.publicSettings();
  }
}
