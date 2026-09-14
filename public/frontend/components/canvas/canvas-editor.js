import {element,button} from "../primitives.js";
import {field,syncValue} from "../settings/dialog.js";
export function createCanvasEditor({workspace,onExit}) {
  let snapshot, sourceKey="", fileVersion=0, drawing=false, lastPoint, sourceReady=false, sourceError="";
  const sourceImage=element("img",{alt:"Editing source image"});
  const mask=element("canvas",{"aria-label":"Paint inpaint mask",tabindex:"0"});
  const surface=element("div",{class:"inpaint-surface"},[sourceImage,mask]);
  const status=element("p",{role:"status"});
  const brush=element("input",{type:"range",min:"5",max:"180",value:"48","aria-label":"Mask brush size"});
  const mode=element("select",{"aria-label":"Creation mode"},[element("option",{value:"img2img",text:"Image to image"}),element("option",{value:"inpaint",text:"Inpaint"})]);
  const file=element("input",{type:"file",accept:"image/png,image/jpeg,image/webp","aria-label":"Source image file"});
  async function readFile() {
    const version=++fileVersion,item=file.files[0],runtimeId=snapshot.runtime.activeRuntimeId,previousSource=sourceKey;if(!item)return;
    try {
      if(!["image/png","image/jpeg","image/webp"].includes(item.type)||item.size>20*1024*1024)throw Error("20MB以下のPNG・JPEG・WebPを選択してください");
      const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(item);});
      if(version!==fileVersion||runtimeId!==workspace.getSnapshot().runtime.activeRuntimeId||previousSource!==sourceKey||workspace.getSnapshot().creation.mode==="txt2img")return;
      workspace.setCreation({source:{dataUrl,imageUrl:dataUrl},mask:null});
    } catch(error){status.textContent=error.message;}
  }
  file.addEventListener("change",readFile);
  mode.addEventListener("change",()=>workspace.setCreation({mode:mode.value}));
  function clear(){const ctx=mask.getContext("2d");ctx.fillStyle="black";ctx.fillRect(0,0,mask.width,mask.height);workspace.setCreation({mask:null});}
  sourceImage.addEventListener("load",()=>{sourceReady=true;mask.width=sourceImage.naturalWidth;mask.height=sourceImage.naturalHeight;const ctx=mask.getContext("2d");ctx.fillStyle="black";ctx.fillRect(0,0,mask.width,mask.height);surface.style.aspectRatio=`${mask.width}/${mask.height}`;all.disabled=snapshot.generation.busy;});
  sourceImage.addEventListener("error",()=>{sourceReady=false;sourceError="Source imageを読み込めません。別の画像を選択してください。";status.textContent=sourceError;});
  function paint(event){const rect=mask.getBoundingClientRect(),point={x:(event.clientX-rect.left)*mask.width/rect.width,y:(event.clientY-rect.top)*mask.height/rect.height};const ctx=mask.getContext("2d");ctx.strokeStyle="white";ctx.fillStyle="white";ctx.lineWidth=Number(brush.value)*mask.width/rect.width;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(lastPoint?.x??point.x,lastPoint?.y??point.y);ctx.lineTo(point.x+.01,point.y);ctx.stroke();lastPoint=point;}
  mask.addEventListener("pointerdown",event=>{if(!sourceReady||snapshot.generation.busy||snapshot.creation.mode!=="inpaint")return;drawing=true;lastPoint=null;mask.setPointerCapture(event.pointerId);paint(event);});
  mask.addEventListener("pointermove",event=>{if(drawing)paint(event);});
  const finish=()=>{if(!drawing)return;drawing=false;workspace.setCreation({mask:mask.toDataURL("image/png")});};
  mask.addEventListener("pointerup",finish);mask.addEventListener("pointercancel",finish);
  const all=button("全体をMask",{onClick:()=>{const ctx=mask.getContext("2d");ctx.fillStyle="white";ctx.fillRect(0,0,mask.width,mask.height);workspace.setCreation({mask:mask.toDataURL("image/png")});}});
  const exit=button("Resultへ戻る",{onClick:()=>{fileVersion++;workspace.setCreation({mode:"txt2img"});onExit();}});
  const settings=element("details",{class:"editor-settings"},[element("summary",{text:"Edit settings"})]),inputs=new Map();
  for(const [key,label,min,max,step,base]of [["inpaintDenoising","Inpaint denoising",0,1,.05,.6],["img2imgDenoising","Image denoising",0,1,.05,.6],["maskBlur","Mask blur",0,64,1,4],["inpaintFill","Masked content (0 fill / 1 original / 2 noise / 3 empty)",0,3,1,1]]){
    const input=element("input",{type:"number",min,max,step});input.addEventListener("change",()=>{if(input.reportValidity())workspace.setParameters({[key]:Number(input.value)});});inputs.set(key,{input,base});settings.append(field(label,input));
  }
  const root=element("section",{class:"canvas-editor","aria-label":"Canvas image editor"},[
    element("div",{class:"editor-tools"},[mode,file,element("label",{text:"Brush"},[brush]),all,button("Maskを消す",{onClick:clear}),exit]),settings,status,element("div",{class:"editor-stage"},[surface])]);
  return {root,render(value){snapshot=value;const creation=value.creation;root.hidden=creation.mode==="txt2img";mode.value=creation.mode;mask.hidden=creation.mode!=="inpaint";
    const key=creation.source?.imageUrl||creation.source?.dataUrl||"";if(key!==sourceKey){sourceKey=key;sourceReady=false;sourceError="";drawing=false;if(key)sourceImage.src=key;else sourceImage.removeAttribute("src");}
    status.textContent=sourceError||(creation.source?"白いMask部分を修正します。Promptは下のDockから編集し、Generateで実行。":"Source imageを選択してください。");
    for(const control of root.querySelectorAll("button,input,select"))control.disabled=value.generation.busy;
    all.disabled ||= !sourceReady;
    for(const [key,{input,base}]of inputs)syncValue(input,value.parameters[key]??base);
  },dispose(){fileVersion++;}};
}
