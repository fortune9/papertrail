import { DatabaseSync, backup } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Library } from '../src/library.js';

export async function prepareLibraryImport(source,directory) {
  const resolved=await fs.realpath(source),destination=path.join(directory,'library.sqlite');
  if(resolved===path.resolve(destination))throw new Error('This is already the desktop library.');
  const db=new DatabaseSync(resolved,{readOnly:true});
  const staged=path.join(directory,'library-import.sqlite');
  try{
    for(const table of ['papers','pages','roots'])if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))throw new Error('Select an existing Papertrail library.sqlite database.');
    if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('The selected database did not pass its integrity check.');
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    await fs.rm(staged,{force:true});await backup(db,staged);
    const probe=new Library(staged);
    try{return {staged,papers:probe.stats().total,pages:probe.stats().pages};}finally{probe.db.close();}
  }catch(error){await fs.rm(staged,{force:true});throw error;}
  finally{db.close();}
}

export async function installLibraryImport(staged,directory) {
  const target=path.join(directory,'library.sqlite');
  const previous=target+'.before-import';
  await fs.rm(previous,{force:true});
  try{await fs.rename(target,previous);}catch(error){if(error.code!=='ENOENT')throw error;}
  try{await fs.rename(staged,target);}
  catch(error){try{await fs.rename(previous,target);}catch{}throw error;}
}
