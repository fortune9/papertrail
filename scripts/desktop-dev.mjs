import {spawn} from 'node:child_process';
import path from 'node:path';
import {electronRuntime,root} from './electron-runtime.mjs';
const directory=await electronRuntime();
const child=spawn(path.join(directory,'electron'),[root],{stdio:'inherit'});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code ?? 1;});
