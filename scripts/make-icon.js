// Renders the app mark (src/renderer/icons.js) into assets/icon.ico and the tray
// icons. No external artwork or fonts. Run with: npx electron scripts/make-icon.js
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
require('../src/renderer/icons.js');
const assets=path.join(__dirname,'../assets');

const mark=globalThis.Icons.brand('m');
// Inactive tray variant: the same tile in neutral graphite.
const muted=mark.replace('#a6f2d0','#c3ccd8').replace('#5ccaa5','#8b96a6').replace('#2d8a8f','#5d6878');

function ico(pngs) {
  const header=Buffer.alloc(6+pngs.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(pngs.length,4);
  let offset=header.length;
  pngs.forEach(({size,data},i)=>{const e=6+i*16;header.writeUInt8(size>=256?0:size,e);header.writeUInt8(size>=256?0:size,e+1);header.writeUInt16LE(1,e+4);header.writeUInt16LE(32,e+6);header.writeUInt32LE(data.length,e+8);header.writeUInt32LE(offset,e+12);offset+=data.length;});
  return Buffer.concat([header,...pngs.map(p=>p.data)]);
}

app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{offscreen:true}});
  await win.loadURL('data:text/html,<canvas></canvas>');
  const render=(svg,size)=>win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=c.height=${size};const x=c.getContext('2d');x.drawImage(img,0,0,${size},${size});resolve(c.toDataURL('image/png').split(',')[1]);};img.onerror=reject;img.src='data:image/svg+xml;base64,'+${JSON.stringify(Buffer.from(svg.replace('<svg ',`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" `)).toString('base64'))};})`).then(b=>Buffer.from(b,'base64'));
  const sizes=[16,24,32,48,64,128,256];
  const pngs=[];for(const size of sizes)pngs.push({size,data:await render(mark,size)});
  fs.mkdirSync(assets,{recursive:true});
  fs.writeFileSync(path.join(assets,'icon.ico'),ico(pngs));
  fs.writeFileSync(path.join(assets,'icon.png'),pngs.at(-1).data);
  for(const [name,svg] of [['tray-active',mark],['tray-inactive',muted]])
    for(const [suffix,size] of [['',16],['@1.5x',24],['@2x',32]])fs.writeFileSync(path.join(assets,`${name}${suffix}.png`),await render(svg,size));
  console.log('Icons geschrieben:',sizes.join(', '),'px + Tray');
  app.quit();
});
