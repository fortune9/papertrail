export function trustedDesktopSender(event,window,origin){
  try{return !!window && event.sender===window.webContents && event.senderFrame===window.webContents.mainFrame && new URL(event.senderFrame.url).origin===origin;}catch{return false;}
}
export function libraryPdfUrl(value,origin){
  try{const url=new URL(value);return url.origin===origin && /^\/api\/papers\/\d+\/file$/.test(url.pathname);}catch{return false;}
}
