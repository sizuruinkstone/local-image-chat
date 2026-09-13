import {createCivitaiMetadata} from "./civitai-metadata.js";
import {element,button} from "../primitives.js";
import {createStudioDialog,field,syncValue} from "../settings/dialog.js";
import {getJson,postJson} from "../../../core/http-client.js";
import {CHECKPOINT_PROFILES} from "../../../checkpoint-profiles.js";

export function createAdvancedDialog({workspace,onEdit,onHistory}) {
  const dialog=createStudioDialog("Creation tools");dialog.root.classList.add("creation-tools");
  let snapshot,epoch=0,activeTab="hires",timer,disposed=false,experiments=[],capability=null,sets=[];
  const notice=element("p",{role:"status"});const panels=new Map(),tabs=new Map();
  const nav=element("nav",{class:"creation-tabs","aria-label":"Creation tools tabs"});
  for(const [id,label]of [["hires","Hires"],["reference","Reference"],["presets","Presets"],["experiments","Experiments"],["civitai","Civitai"]]){
    const panel=element("section",{"aria-label":`${label} tools`});panels.set(id,panel);
    const tab=button(label,{onClick:()=>{activeTab=id;render();load();}});tabs.set(id,tab);nav.append(tab);
  }
  dialog.body.append(nav,notice,...panels.values());
  async function act(work){const version=epoch;notice.textContent="";try{return await work();}catch(error){if(!disposed&&version===epoch)notice.textContent=error.message;}finally{if(!disposed&&version===epoch)render();}}
  const hiresInputs=new Map();
  for(const [key,label,value,min,max,step]of [["hiresScale","Hires scale",1.5,1,2,.05],["hiresSteps","Hires steps",12,1,80,1],["hiresDenoising","Hires denoising",.28,.01,1,.01]]){
    const input=element("input",{type:"number",min,max,step,value});input.addEventListener("change",()=>{if(input.reportValidity())act(()=>workspace.setParameters({[key]:Number(input.value)}));});hiresInputs.set(key,{input,value});panels.get("hires").append(field(label,input));
  }
  const upscaler=element("input",{type:"text",placeholder:"既存設定のupscaler名"});upscaler.addEventListener("change",()=>act(()=>workspace.setParameters({hiresUpscaler:upscaler.value})));
  const finish=button("Current resultをHiresで仕上げる",{onClick:()=>act(()=>workspace.finishHires())});
  const hiresNote=element("p");panels.get("hires").prepend(hiresNote);panels.get("hires").append(field("Hires upscaler",upscaler),finish);
  const edit=button("Canvasで編集 / Inpaint",{onClick:()=>{dialog.close();onEdit();}});
  const ipNote=element("p"),ipWeight=element("input",{type:"number",min:0,max:2,step:.05,value:.65}),ipStart=element("input",{type:"number",min:0,max:1,step:.05,value:0}),ipEnd=element("input",{type:"number",min:0,max:1,step:.05,value:1});
  const ipEnable=element("input",{type:"checkbox","aria-label":"Enable IP-Adapter"});
  function ipPatch(){return {...snapshot.creation.ipAdapter,enabled:ipEnable.checked,weight:Number(ipWeight.value),guidanceStart:Number(ipStart.value),guidanceEnd:Number(ipEnd.value)};}
  for(const input of [ipEnable,ipWeight,ipStart,ipEnd])input.addEventListener("change",()=>act(()=>workspace.setCreation({ipAdapter:ipPatch()})));
  const ipSource=button("Current resultをReferenceに使用",{onClick:()=>act(()=>workspace.setCreation({ipAdapter:{...ipPatch(),enabled:true,referenceImageId:snapshot.currentImage.id}}))});
  const ipFile=element("input",{type:"file",accept:"image/png,image/jpeg,image/webp","aria-label":"IP-Adapter reference file"});
  ipFile.addEventListener("change",()=>act(async()=>{const file=ipFile.files[0],version=epoch,runtimeId=snapshot.runtime.activeRuntimeId;if(!file)return;if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>20*1024*1024)throw Error("20MB以下の画像を選択してください");const referenceImage=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});if(version!==epoch||runtimeId!==workspace.getSnapshot().runtime.activeRuntimeId)return;workspace.setCreation({ipAdapter:{enabled:true,weight:Number(ipWeight.value),guidanceStart:Number(ipStart.value),guidanceEnd:Number(ipEnd.value),referenceImage}});}));
  panels.get("reference").append(edit,element("h3",{text:"IP-Adapter reference"}),ipNote,field("Enable IP-Adapter",ipEnable),ipSource,ipFile,field("Reference weight",ipWeight),field("Reference start",ipStart),field("Reference end",ipEnd));
  const profiles=element("select",{"aria-label":"Checkpoint profile"},CHECKPOINT_PROFILES.map(p=>element("option",{value:p.id,text:p.label||p.name||p.id})));
  const setList=element("div"),setName=element("input",{type:"text",placeholder:"Checkpoint Setの名前"});
  panels.get("presets").append(element("h3",{text:"Checkpoint profiles"}),profiles,button("Profileの設定を適用",{onClick:()=>act(()=>{const profile=CHECKPOINT_PROFILES.find(p=>p.id===profiles.value);workspace.setParameters(profile.settings);})}),element("h3",{text:"Checkpoint Sets"}),setList,field("New set name",setName),button("Current DraftからSetを保存",{onClick:()=>act(async()=>{
    await postJson("/api/checkpoint-lora-sets",{name:setName.value,checkpoint:snapshot.runtime.selectedCheckpoint?.title,settings:snapshot.parameters,loras:snapshot.loras,prompt:snapshot.prompt.prompt,negativePrompt:snapshot.prompt.negativePrompt});await load();
  })}),element("p",{text:"Setは明示適用のみ。LoRAのprofile・outfitはBrowserのDetailsから選び、Promptへ挿入できます。"}));
  const parameter=element("select",{"aria-label":"Experiment parameter"}),values=element("input",{type:"text",value:"12,16","aria-label":"Experiment values"}),target=element("select",{"aria-label":"Experiment LoRA"}),experimentName=element("input",{type:"text",value:"Studio study"});
  const experimentList=element("div");let definitions={};
  const start=button("Experimentを開始",{onClick:()=>act(async()=>{
    const definition=definitions[parameter.value];const parsed=values.value.split(",").map(v=>definition.kind==="text"?v.trim():Number(v));
    await postJson("/api/experiments",{name:experimentName.value,parameter:parameter.value,target:target.value,values:parsed,fixedSeed:snapshot.parameters.seed<0?1:snapshot.parameters.seed,baseRequest:workspace.buildRequest()});await load();
  })});
  panels.get("experiments").append(field("Experiment name",experimentName),parameter,values,target,start,experimentList);
  const url=element("input",{type:"url",placeholder:"https://civitai.com/models/…","aria-label":"Civitai URL"}),metadata=createCivitaiMetadata();
  let inspectRevision=0,installing=false;
  url.addEventListener("input",()=>{inspectRevision++;metadata.clear();});
  const folder=element("select",{"aria-label":"Install folder"},[element("option",{value:"",text:"Configured default folder"})]);
  const category=element("select",{"aria-label":"LoRA category"},["character","style","other"].map(value=>element("option",{value,text:value})));
  const authStatus=element("p",{role:"status",class:"civitai-auth-status",text:"サーバーのAPIキー設定を確認中…"});
  const install=button("このLoRAをインストール",{onClick:()=>act(async()=>{if(installing)return;installing=true;install.disabled=true;try{await postJson("/api/civitai/install",{url:url.value,category:category.value,folder:folder.value,runtimeId:snapshot.runtime.activeRuntimeId,overwrite:false});const refreshed=await workspace.refreshLoras();notice.textContent=refreshed===false?"インストールは完了しましたが一覧を更新できませんでした。LoRA Browserで更新してください。":"インストール完了。LoRA Browserから選択して使えます。ページの再読み込みは不要です。";}finally{installing=false;install.disabled=false;}})});
  panels.get("civitai").append(authStatus,url,button("Metadataを確認",{onClick:()=>act(async()=>{const revision=++inspectRevision,version=epoch;metadata.clear();const result=await postJson("/api/civitai/inspect",{url:url.value});if(!disposed&&revision===inspectRevision&&version===epoch)metadata.render(result.metadata);})}),metadata.root,field("インストール先の分類",category),field("インストール先フォルダ",folder),install,element("p",{text:"APIキーはサーバーの.env（LOCAL_IMAGE_CHAT_CIVITAI_TOKEN）から自動使用します。ブラウザへの入力・保存は不要です。設定変更後はサーバーを再起動してください。"}));
  async function load(){const version=++epoch,tab=activeTab;clearTimeout(timer);
    try {
      if(tab==="reference"){const runtimeId=snapshot.runtime.activeRuntimeId;const result=await getJson(`/api/reforge/ip-adapter/options?runtimeId=${encodeURIComponent(runtimeId)}`);if(version!==epoch||runtimeId!==workspace.getSnapshot().runtime.activeRuntimeId)return;capability=result;}
      if(tab==="civitai"){
        authStatus.textContent="サーバーのAPIキー設定を確認中…";
        try{const auth=await getJson("/api/civitai/auth-status");if(version!==epoch||disposed)return;
          authStatus.textContent=auth.configured===true?"APIキー設定済み · サーバーの.envから自動使用します":auth.configured===false?"APIキー未設定 · サーバーの.envに設定して再起動してください":"設定状況を確認できません。サーバーを更新・再起動してください。";
        }catch{if(version!==epoch||disposed)return;authStatus.textContent="設定状況を確認できません。サーバーを更新・再起動してください。";}
        const result=await getJson("/api/civitai/install-folders");if(version!==epoch)return;folder.replaceChildren(element("option",{value:"",text:"Configured default folder"}),...(result.folders??[]).map(value=>element("option",{value,text:value})));}
      if(tab==="presets"){const result=await getJson("/api/checkpoint-lora-sets");if(version!==epoch)return;sets=result.sets??[];setList.replaceChildren(...sets.map(set=>button(set.name,{onClick:()=>act(()=>workspace.applyCheckpointSet(set))})));}
      if(tab==="experiments"){const result=await getJson("/api/experiments");if(version!==epoch)return;definitions=result.parameters??{};const selected=parameter.value;parameter.replaceChildren(...Object.entries(definitions).map(([value,d])=>element("option",{value,text:d.label})));if(definitions[selected])parameter.value=selected;else if(definitions.steps)parameter.value="steps";experiments=result.experiments??[];
        experimentList.replaceChildren(...experiments.map(item=>element("div",{class:"experiment-row"},[element("strong",{text:item.name||item.id}),element("span",{text:item.status}),button("画像を見る",{onClick:()=>{dialog.close();onHistory(item.id);}}),...(!["done","completed","failed","cancelled"].includes(item.status)?[button("Cancel experiment",{onClick:()=>act(async()=>{await postJson(`/api/experiments/${encodeURIComponent(item.id)}/cancel`,{});await load();})})]:[])])));
        if(dialog.root.open)timer=setTimeout(load,2000);
      }
    }catch(e){if(version===epoch)notice.textContent=e.message;}finally{if(version===epoch&&!disposed)render();}
  }
  dialog.root.addEventListener("close",()=>{epoch++;clearTimeout(timer);});
  let runtimeKey="";
  function render(){if(!snapshot)return;
    for(const [id,panel]of panels){panel.hidden=id!==activeTab;tabs.get(id).setAttribute("aria-pressed",String(id===activeTab));}
    const locked=snapshot.generation.busy||snapshot.selectingModel||snapshot.runtime.switching;
    const features=snapshot.runtime.activeRuntime?.features??{};
    hiresNote.textContent=features.hires?"完成画像のSeed・Promptを使って高解像度版を生成します。":"現在のRuntimeはHires非対応です。対応Runtimeで利用できます。";
    finish.disabled=locked||!features.hires||!snapshot.currentImage;
    for(const [key,{input,value}]of hiresInputs){syncValue(input,snapshot.parameters[key]??value);input.disabled=locked||!features.hires;}
    syncValue(upscaler,snapshot.parameters.hiresUpscaler??"");upscaler.disabled=locked||!features.hires;edit.disabled=locked||!features.img2img;
    const key=`${snapshot.runtime.activeRuntimeId}:${snapshot.runtime.selectedCheckpoint?.title}`;
    if(key!==runtimeKey){runtimeKey=key;capability=null;if(dialog.root.open&&activeTab==="reference")void load();}
    ipNote.textContent=capability?.message||(!features.ipAdapter?"現在のRuntimeはIP-Adapter非対応です。":"対応状況を確認中…");
    for(const input of [ipEnable,ipWeight,ipStart,ipEnd,ipFile])input.disabled=locked||!capability?.available;
    ipEnable.disabled ||= !snapshot.creation.ipAdapter?.referenceImageId&&!snapshot.creation.ipAdapter?.referenceImage;
    ipSource.disabled=locked||!capability?.available||!snapshot.currentImage;ipEnable.checked=snapshot.creation.ipAdapter?.enabled===true;
    for(const [input,key,base]of [[ipWeight,"weight",.65],[ipStart,"guidanceStart",0],[ipEnd,"guidanceEnd",1]])syncValue(input,snapshot.creation.ipAdapter?.[key]??base);
    const loraKey=JSON.stringify(snapshot.loras.map(l=>l.name));if(target.dataset.key!==loraKey){target.dataset.key=loraKey;target.replaceChildren(...snapshot.loras.map(l=>element("option",{value:l.name,text:l.name})));}
    target.hidden=!definitions[parameter.value]?.needsTarget;start.disabled=locked||experiments.some(item=>!["done","completed","failed","cancelled"].includes(item.status));
  }
  parameter.addEventListener("change",render);
  return {root:dialog.root,open(tab="hires"){activeTab=tab;dialog.open();render();void load();},render(value){snapshot=value;if(dialog.root.open)render();},dispose(){disposed=true;epoch++;clearTimeout(timer);}};
}
