import test from "node:test";
import assert from "node:assert/strict";
import {createGenerateWorkspace} from "../public/features/generate-workspace.js";
import {STUDIO_SESSION_KEY} from "../public/core/studio-session.js";
const runtime={id:"reforge",label:"ReForge",available:true,features:{txt2img:true,img2img:true,inpaint:true,hires:true,ipAdapter:true}};
function fixture(storageMap=new Map(),options={}) {
 const requests=[];let status="done";
 const record={runtime,prompt:"finished",settings:{seed:5,width:512,height:512},images:[{id:"image-0001",seed:5,imageUrl:"/outputs/image.png"}]};
 const transport={async getJson(url){
  if(url==="/api/config")return {runtimes:[runtime],defaultRuntimeId:"reforge",defaults:{width:512,height:512}};
  if(url==="/api/runtimes")return {runtimes:[runtime],defaultRuntimeId:"reforge"};
  if(url.startsWith("/api/checkpoints?"))return {checkpoints:[{title:"model-a"},{title:"model-b"}],activeCheckpoint:"model-a"};
  if(url.startsWith("/api/loras?"))return {loras:[{name:"a"},{name:"b"}]};
  if(url.startsWith("/api/samplers?"))return {samplers:["Euler"],schedulers:["Automatic"]};
  if(url.startsWith("/api/history?"))return {generations:[]};
  if(url.startsWith("/api/jobs/"))return {job:{id:"job-saved",status,result:record}};
  throw Error(url);
 },async postJson(url,body){requests.push([url,structuredClone(body)]);return url==="/api/jobs"?{job:{id:"job-saved",status:"queued"}}:{checkpoint:body.checkpoint};},async fetch(){return {ok:true,json:async()=>({job:{id:"job-saved",status:"cancelled"}})};}};
 const storage={getItem:k=>storageMap.get(k)??null,setItem:(k,v)=>storageMap.set(k,String(v)),removeItem:k=>storageMap.delete(k)};
 const workspace=createGenerateWorkspace({transport,storage,persistSession:options.persist??false,timing:{sleep:options.sleep??(async()=>{}),setTimeout:()=>0}});
 return {workspace,requests,storageMap,setStatus:value=>{status=value;}};
}
test("Advanced inpaint/IP request uses canonical Prompt; Hires uses the existing result workflow",async t=>{
 const {workspace:w,requests}=fixture();t.after(()=>w.dispose());await w.initialize();w.setPrompt({sections:{character:"teapot"},negative:"blur"});
 w.setCreation({mode:"inpaint",source:{imageId:"source-0001",imageUrl:"/outputs/source.png"},mask:"data:image/png;base64,AAAA",ipAdapter:{enabled:true,referenceImageId:"reference-0001",weight:.65,guidanceStart:0,guidanceEnd:1}});
 w.setParameters({inpaintDenoising:.4,hiresScale:1.5,hiresSteps:12,hiresDenoising:.28});
 const request=w.buildRequest();assert.equal(request.mode,"inpaint");assert.equal(request.initImageId,"source-0001");assert.ok(request.maskImage);assert.equal(request.ipAdapter.referenceImageId,"reference-0001");assert.equal(request.prompt,w.getSnapshot().prompt.prompt);
 await w.generate();assert.equal(requests.find(([url])=>url==="/api/jobs")[1].mode,"inpaint");
 await w.finishHires();const hires=requests.filter(([url])=>url==="/api/jobs").at(-1)[1];assert.equal(hires.settings.hiresEnabled,true);assert.equal(hires.settings.hiresScale,1.5);assert.equal(hires.parentImageId,"image-0001");
});
test("Session restores independent Raw/Structured drafts, parameters, composition order/disabled and result",async t=>{
 const map=new Map();const first=fixture(map,{persist:true});await first.workspace.initialize();const w=first.workspace;
 w.setPrompt({sections:{character:"structured"},negative:"bad"});w.setPrompt({positive:"raw"});w.setPrompt({mode:"structured"});w.setParameters({seed:42,width:768,scheduler:"Karras"});
 w.addLora("a",.5);w.addLora("b",.8);w.reorderLoras(["b","a"]);w.toggleLora("a");await w.selectModel("model-b");first.workspace.dispose();
 assert.ok(map.has(STUDIO_SESSION_KEY));const second=fixture(map,{persist:true});t.after(()=>second.workspace.dispose());await second.workspace.initialize();
 const s=second.workspace.getSnapshot();assert.equal(s.prompt.structuredPrompt.character,"structured");assert.equal(s.parameters.seed,42);assert.equal(s.runtime.selectedCheckpoint.title,"model-b");assert.deepEqual(s.loras.map(l=>[l.name,l.weight,l.enabled]),[["b",.8,true],["a",.5,false]]);
 second.workspace.setPrompt({mode:"raw"});assert.equal(second.workspace.getSnapshot().prompt.prompt,"raw");assert.equal(second.requests.filter(([url])=>url==="/api/jobs").length,0);
});
test("Saved job reattaches without a second POST and survives corrupt session data safely",async t=>{
 const first=fixture(new Map(),{persist:true});await first.workspace.initialize();first.workspace.setPrompt({positive:"saved"});const map=first.storageMap;first.workspace.dispose();
 const saved=JSON.parse(map.get(STUDIO_SESSION_KEY));saved.activeJobId="job-saved";map.set(STUDIO_SESSION_KEY,JSON.stringify(saved));
 const second=fixture(map,{persist:true});t.after(()=>second.workspace.dispose());await second.workspace.initialize();await new Promise(r=>setImmediate(r));
 assert.equal(second.requests.filter(([url])=>url==="/api/jobs").length,0);assert.equal(second.workspace.getSnapshot().currentImage.id,"image-0001");assert.equal(second.workspace.getSnapshot().generation.busy,false);
 const broken=fixture(new Map([[STUDIO_SESSION_KEY,"broken-json"]]),{persist:true});t.after(()=>broken.workspace.dispose());assert.equal(await broken.workspace.initialize(),true);
});
test("Checkpoint Set keeps successful model activation but restores draft if a LoRA is missing",async t=>{
 const {workspace:w}=fixture();t.after(()=>w.dispose());await w.initialize();w.setPrompt({sections:{character:"keep"}});
 await assert.rejects(w.applyCheckpointSet({checkpoint:"model-b",settings:{steps:42},loras:[{name:"missing",weight:.5}]}),/LoRAがありません/);
 assert.equal(w.getSnapshot().runtime.selectedCheckpoint.title,"model-b");assert.equal(w.getSnapshot().prompt.structuredPrompt.character,"keep");assert.notEqual(w.getSnapshot().parameters.steps,42);
});

test("terminal Job is never saved for reattach while result presentation is still in flight",async t=>{
 const {workspace,storageMap}=fixture(new Map(),{persist:true});t.after(()=>workspace.dispose());await workspace.initialize();workspace.setPrompt({sections:{character:"teapot"}});
 let checked=false;workspace.subscribe(snapshot=>{if(snapshot.generation.job?.status==="done"){assert.equal(JSON.parse(storageMap.get(STUDIO_SESSION_KEY)).activeJobId,null);checked=true;}});
 await workspace.generate();assert.equal(checked,true);
});

test("Checkpoint Set applies when its model is already selected",async t=>{
 const {workspace,requests}=fixture();t.after(()=>workspace.dispose());await workspace.initialize();
 assert.equal(await workspace.applyCheckpointSet({checkpoint:"model-a",settings:{steps:12},prompt:"set prompt",loras:[{name:"b",weight:.4}]}),true);
 assert.equal(workspace.getSnapshot().parameters.steps,12);assert.equal(workspace.buildRequest().prompt,"set prompt");assert.equal(workspace.getSnapshot().loras[0].name,"b");assert.equal(requests.length,0);
});
