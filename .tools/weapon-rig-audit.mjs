import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { chromium } from 'playwright-core';

// Inspect the actual GLBs and animation clips independently of match timing.
// npm run ai:rigs -- artifacts/weapon-rigs; RIG_WEAPONS limits the roster.
const root = process.cwd();
const out = path.resolve(process.argv[2] || 'artifacts/weapon-rigs');
await fs.mkdir(out, { recursive: true });
const html = `<!doctype html><style>body{margin:0;background:#8093a4}canvas{display:block}#label{position:fixed;top:12px;left:16px;font:20px monospace;color:white}#cross{position:fixed;left:50%;top:50%;width:1px;height:1px;box-shadow:0 0 0 2px #ff3030}</style><div id="label"></div><div id="cross"></div>
<script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/","three-mesh-bvh":"/vendor/three-mesh-bvh/src/index.js"}}</script>
<script type="module">
import * as THREE from 'three';
import { Viewmodel } from '/viewmodel.js';
import { WEAPONS } from '/weapons.js';
const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
renderer.setSize(1280,720); renderer.setPixelRatio(1); renderer.toneMapping=THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
window.rigs={};
window.loadRig=async id=>{
 const def=WEAPONS[id];
 const vm=new Viewmodel({...def,camo:'openai'});
 await vm.load('viewmodel/c_usa_mp_fbi_shortsleeve_viewhands_lod0.glb',def.viewmodelUrl,def.magazineUrl,null,def);
 await vm.loadClips(def.clips);
 vm.hemi.intensity=1.3;vm.lamp.intensity=1.7;vm.scene.background=new THREE.Color('#8093a4');vm.setSize(1280,720);
 vm.scene.updateMatrixWorld(true);
 const gun=vm.root.getObjectByName('j_gun'),clip=vm.root.getObjectByName('tag_clip');
 const seatedPosition=gun.worldToLocal(clip.getWorldPosition(new THREE.Vector3()));
 const seatedRotation=gun.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(clip.getWorldQuaternion(new THREE.Quaternion()));
 rigs[id]={vm,def,seatedPosition,seatedRotation};return true;
};
window.poseRig=(id,pose,time=0)=>{
 const {vm,def,seatedPosition,seatedRotation}=rigs[id];vm.resetActions();vm.bobAmp=vm.sprintBlend=0;vm.swayRot.set(0,0);vm.swayPos.set(0,0);vm.bobTime=vm.airTime=0;vm.lookVel.set(0,0);vm.pendingLook.set(0,0);
 vm.mixer.update(0);
 if(pose.startsWith('sprint')){
   for(let t=0;t<time;){
     const dt=Math.min(1/120,time-t);
     if(t>time-0.25)vm.addLook(pose==='sprintDownLeft'?-24:pose==='sprintDownRight'?24:0,24);
     vm.update(dt,{speed:900,moving:true,sprinting:true,grounded:true});t+=dt;
   }
 }else if(pose==='ads'){vm.setAiming(true);vm.update(1);vm.root.visible=true;}
 else if(pose.startsWith('reload')){
   vm.reload(pose==='reloadEmpty');
   const action=pose==='reloadEmpty'?vm.reloadEmptyAction:vm.reloadAction;
   vm.idleAction.stop();action.stopFading().setEffectiveWeight(1);
   for(let t=0;t<time;){const step=Math.min(1/120,time-t);vm.update(step);t+=step;}
 } else vm.update(0);
 vm.scene.updateMatrixWorld(true);renderer.render(vm.scene,vm.camera);
 document.querySelector('#label').textContent=def.name+' / '+pose+' / '+time.toFixed(3)+'s';
 const gun=vm.root.getObjectByName('j_gun');
 const local=node=>node?gun.worldToLocal(node.getWorldPosition(new THREE.Vector3())).toArray():null;
 const point=(p)=>p?.clone().project(vm.camera).toArray()??null;
 const optical=vm.findScopeSights(gun);
 const front=optical?.front??vm.getSightAnchor(gun,'front')??vm.findSightTip(gun);
 const rear=optical?.rear??vm.getSightAnchor(gun,'rear')??(front?vm.findRearSight(gun,front):null);
 const fresh=vm.spareMagazine?.getObjectByName('tag_clip_spare')??vm.root.getObjectByName('tag_clip_full')??vm.root.getObjectByName('tag_clip');
 const freshRotation=gun.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(fresh.getWorldQuaternion(new THREE.Quaternion()));
 const seatError=new THREE.Vector3().fromArray(local(fresh)).distanceTo(seatedPosition);
 // The upper 45% must remain clear while sprinting. Read the rendered
 // framebuffer: a sleeve through the near plane can cover it despite valid bones.
 let upperCoverage=0;
 if(pose.startsWith('sprint')){
   const gl=renderer.getContext(),pixels=new Uint8Array(1280*324*4);
   gl.readPixels(0,396,1280,324,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   for(let i=0;i<pixels.length;i+=4){
     if(Math.abs(pixels[i]-128)+Math.abs(pixels[i+1]-147)+Math.abs(pixels[i+2]-164)>6)upperCoverage++;
   }
 }
 return {id,pose,time,upperCoverage,seatError,seatAngle:freshRotation.angleTo(seatedRotation),front:point(front),rear:point(rear),ads:vm.adsPos.toArray(),scope:!!vm.scopeRoot,
   magazine:local(vm.magazineRoot),spare:local(vm.spareMagazine),magVisible:vm.magazineRoot?.visible,
   spareVisible:vm.spareMagazine?.visible,reloading:vm.reloading,
   tags:Object.fromEntries(['tag_clip','tag_clip1','tag_clip_full','tag_weapon','j_wrist_le','tag_sights','tag_sights_on'].map(n=>[n,local(vm.root.getObjectByName(n))]))};
};
window.ready=true;
</script>`;
const server = http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end(html);return;}
  if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const vendor=url.pathname.startsWith('/vendor/');
  const base=vendor?path.resolve(path.dirname(fileURLToPath(import.meta.resolve('three'))),'../..'):path.join(root,'export/web');
  const file=path.resolve(base,decodeURIComponent(url.pathname.slice(vendor?8:1)));
  if(!file.startsWith(base+path.sep))throw Error('outside root');
  const bytes=await fs.readFile(file);
  const mime={'.js':'text/javascript','.json':'application/json','.webp':'image/webp','.png':'image/png','.glb':'model/gltf-binary'}[path.extname(file)]??'application/octet-stream';
  res.writeHead(200,{'Content-Type':mime,'Content-Length':bytes.length}).end(bytes);
 }catch(e){process.stderr.write(req.url+': '+String(e)+'\n');res.writeHead(404).end(String(e));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle='+(process.env.AI_GAME_ANGLE||'d3d11'),'--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const errors=[],logs=[],states=[];
page.on('console',m=>{logs.push(m.type()+': '+m.text());if(m.type()==='error')errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)errors.push(r.url()+' HTTP '+r.status());});
page.on('pageerror',e=>{errors.push(String(e));process.stderr.write('PAGE: '+String(e)+'\n');});page.on('requestfailed',r=>errors.push(r.url()+' '+r.failure()?.errorText));
try {
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.waitForFunction(()=>window.ready);
 const {WEAPONS}=await import('../export/web/weapons.js');
 for(const def of Object.values(WEAPONS).filter(d=>!process.env.RIG_WEAPONS||process.env.RIG_WEAPONS.split(',').includes(d.id))){
  process.stdout.write(def.id+'\n');await page.evaluate(id=>loadRig(id),def.id);
  const durations=await page.evaluate(id=>['reload','reloadEmpty'].map(k=>rigs[id].vm.clips.get(k).duration),def.id);
  for(const [pose,time] of [['hip',0],['ads',0],...durations.flatMap((d,i)=>[0.25,0.5,0.75,0.98].map(t=>[i?'reloadEmpty':'reload',t*d])),...(process.env.RIG_MOTION?['sprintDown','sprintDownLeft','sprintDownRight'].flatMap(p=>[1,1.25,1.5,1.75,2].map(t=>[p,t])):[])]){
   states.push(await page.evaluate(([id,pose,time])=>poseRig(id,pose,time),[def.id,pose,time]));
   await page.screenshot({path:path.join(out,`${def.id}-${pose}-${time.toFixed(3)}.png`)});
  }
  await page.evaluate(id=>{rigs[id].vm.mixer.stopAllAction();},def.id);
 }
}finally{
 await fs.writeFile(path.join(out,'states.json'),JSON.stringify(states,null,2));
 await fs.writeFile(path.join(out,'console.log'),logs.join('\n'));
 await fs.writeFile(path.join(out,'errors.json'),JSON.stringify(errors,null,2));
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
if(errors.length)throw Error(errors.join('\n'));

assert.ok(states.length, 'No weapons matched RIG_WEAPONS');
const checks={};
for(const state of states){
 if(state.pose.startsWith('sprint'))checks[state.id+'-'+state.pose+'-'+state.time]=state.upperCoverage===0;
 if(state.pose==='ads'){
  for(const name of ['front','rear']){
   const p=state[name];checks[state.id+'-'+name]=Boolean(p && Math.hypot(p[0]*640,p[1]*360)<0.5);
  }
 }
 if(state.pose==='hip' && ['dsr50','ballista','svu','as50'].includes(state.id))checks[state.id+'-scope']=state.scope;
}
for(const id of new Set(states.map(s=>s.id))){
 for(const pose of ['reload','reloadEmpty']){
  const state=states.filter(s=>s.id===id&&s.pose===pose).at(-1);
  checks[id+'-'+pose+'-seated']=state.seatError<0.05 && state.seatAngle<0.015;
 }
}
await fs.writeFile(path.join(out,'report.json'),JSON.stringify({checks,passed:Object.values(checks).every(Boolean)},null,2));
assert.ok(Object.values(checks).every(Boolean),JSON.stringify(Object.entries(checks).filter(([,ok])=>!ok)));
console.log(Object.keys(checks).length+' rig checks passed');
