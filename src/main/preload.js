const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('leise',{
  call:async(action,args={})=>{const result=await ipcRenderer.invoke('leise:call',action,args);if(!result.ok)throw new Error(result.error);return result.value;},
  onChange:callback=>{const fn=()=>callback();ipcRenderer.on('leise:changed',fn);return()=>ipcRenderer.removeListener('leise:changed',fn);},
  onQuery:callback=>{const fn=(_,data)=>callback(data);ipcRenderer.on('leise:query',fn);return()=>ipcRenderer.removeListener('leise:query',fn);}
});
