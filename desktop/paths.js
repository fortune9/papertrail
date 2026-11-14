import path from 'node:path';
import { createRequire } from 'node:module';
import { resolveRuntimeExecutable } from '@openworkerai/harness-sdk';

const require=createRequire(import.meta.url);
export function desktopPaths({packaged,resourcesPath,appRoot}) {
  if(process.platform!=='linux' || process.arch!=='x64')throw new Error('This desktop build currently supports Linux x64 only.');
  const codexRoot=packaged?path.join(resourcesPath,'native','codex'):
    path.join(path.dirname(require.resolve('@openai/codex-linux-x64/package.json')),'vendor','x86_64-unknown-linux-musl');
  return {appRoot,codex:path.join(codexRoot,'bin','codex'),
    openworker:packaged?path.join(resourcesPath,'native','openworker','openworker-harness'):resolveRuntimeExecutable()};
}
