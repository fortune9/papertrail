import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { electronRuntime,root } from './electron-runtime.mjs';
const exec=promisify(execFile);
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const electron=await electronRuntime();
const dist=path.join(root,'dist');
await fs.mkdir(dist,{recursive:true});
// Windows-mounted checkouts can report every mode as 0777. Stage on a native
// Linux filesystem and normalize package modes before recording ownership.
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'papertrail-linux-build-'));
const stage=path.join(temporary,'root');
try{
const install=path.join(stage,'opt','papertrail');await fs.mkdir(path.dirname(install),{recursive:true});
console.log('Staging Electron and application files…');
await fs.cp(electron,install,{recursive:true});
await fs.rename(path.join(install,'electron'),path.join(install,'papertrail'));
const appRoot=path.join(install,'resources','app');await fs.mkdir(appRoot,{recursive:true});
for(const name of ['src','public','desktop','development','package.json','LICENSE','README.md'])await fs.cp(path.join(root,name),path.join(appRoot,name),{recursive:true});
for(const name of ['@openworkerai/harness-sdk','@openai/codex-sdk'])await fs.cp(path.join(root,'node_modules',name),path.join(appRoot,'node_modules',name),{recursive:true});
// The installed helper must be root-owned and setuid on systems that require it.
// dpkg-deb --root-owner-group records ownership without changing the build host.

const bin=path.join(stage,'usr','bin'),applications=path.join(stage,'usr','share','applications'),icons=path.join(stage,'usr','share','icons','hicolor','scalable','apps');
await Promise.all([bin,applications,icons,path.join(stage,'DEBIAN')].map(dir=>fs.mkdir(dir,{recursive:true})));
await fs.writeFile(path.join(bin,'papertrail'),'#!/bin/sh\nexec /opt/papertrail/papertrail "$@"\n',{mode:0o755});
await fs.writeFile(path.join(applications,'papertrail.desktop'),'[Desktop Entry]\nType=Application\nName=Papertrail\nComment=Search your local research papers\nExec=papertrail\nIcon=papertrail\nTerminal=false\nCategories=Office;Education;Science;\nStartupWMClass=Papertrail\n');
await fs.copyFile(path.join(root,'desktop','icon.svg'),path.join(icons,'papertrail.svg'));
await fs.writeFile(path.join(install,'THIRD_PARTY_NOTICES.txt'),`Papertrail ${pkg.version}\n\nElectron 45.3.2: see LICENSE and LICENSES.chromium.html in this directory.\nOpenWorker SDK and optional runtime: MIT, see resources/app/desktop/licenses/OpenWorker-MIT.txt.\nCodex SDK and optional runtime: Apache-2.0, see resources/app/desktop/licenses/Codex-Apache-2.0.txt; downloaded Codex notices remain in the optional component directory.\nPoppler is a distribution-managed dependency, not redistributed inside this package.\nIts license and source information are provided by the operating system's poppler-utils package.\nSource: https://github.com/fortune9/papertrail\n`);
async function size(dir){let total=0;for(const item of await fs.readdir(dir,{withFileTypes:true})){const f=path.join(dir,item.name);total+=item.isDirectory()?await size(f):(await fs.lstat(f)).size;}return total;}
const dependencies='poppler-utils, xdg-utils, tar, libc6 (>= 2.35), libssl3 | libssl3t64, libgcc-s1, libstdc++6, libgtk-3-0 | libgtk-3-0t64, libnss3, libasound2 | libasound2t64, libgbm1, libxss1, libatk-bridge2.0-0 | libatk-bridge2.0-0t64, libatk1.0-0 | libatk1.0-0t64, libcups2 | libcups2t64, libdbus-1-3, libx11-6, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxrandr2, libpango-1.0-0, libcairo2, libdrm2, libxkbcommon0, libatspi2.0-0 | libatspi2.0-0t64';
await fs.writeFile(path.join(stage,'DEBIAN','control'),`Package: papertrail\nVersion: ${pkg.version}\nSection: science\nPriority: optional\nArchitecture: amd64\nMaintainer: Papertrail contributors\nInstalled-Size: ${Math.ceil(await size(install)/1024)}\nDepends: ${dependencies}\nHomepage: https://github.com/fortune9/papertrail\nDescription: Local research paper library\n Recursively index text-based PDFs and search their pages offline.\n Optional AI components can be detected or downloaded from Settings.\n`);
async function normalize(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isSymbolicLink())throw new Error('Unexpected symlink in package: '+file);if(item.isDirectory()){await fs.chmod(file,0o755);await normalize(file);}else await fs.chmod(file,0o644);}}
await normalize(stage);await fs.chmod(stage,0o755);
for(const file of [path.join(install,'papertrail'),path.join(install,'chrome_crashpad_handler'),path.join(bin,'papertrail')])await fs.chmod(file,0o755);
await fs.chmod(path.join(install,'chrome-sandbox'),0o4755);
const output=path.join(dist,`papertrail_${pkg.version}_amd64.deb`);
console.log('Building Linux x64 .deb installer…');
await exec('dpkg-deb',['--build','--root-owner-group','-Zxz','-z6',stage,output],{timeout:300000,maxBuffer:1024*1024});
console.log(output);

}finally{await fs.rm(temporary,{recursive:true,force:true});}
