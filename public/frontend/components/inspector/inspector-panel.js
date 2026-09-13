import { element, iconButton, button } from "../primitives.js";
import {createResultMetadata} from "../library/result-metadata.js";
import { field, syncValue, syncOptions } from "../settings/dialog.js";
export function createInspectorPanel({ onClose, onParameters = () => {}, onReuse = () => {}, onResultSeed = () => {} }) {
  let tab = "draft";
  let snapshot, view;
  const close = iconButton("Close inspector", "close", onClose);
  const draftTab = button("Current Draft",{onClick:()=>{tab="draft";renderContent();}});
  const resultTab = button("Result Metadata",{onClick:()=>{tab="result";renderContent();}});
  const draft = element("div",{class:"inspector-draft"});
  const inputs = new Map();
  for (const [key,label,type,min,max,step] of [["samplerName","Sampler","select"],["scheduler","Scheduler","select"],["steps","Steps","number",1,150,1],["cfgScale","CFG","number",0,30,0.1]]) {
    const input=element(type === "select" ? "select" : "input",type === "select" ? {} : {type,min,max,step});
    input.addEventListener("change",()=>{if(input.reportValidity())onParameters({[key]:type === "select" ? input.value : Number(input.value)});});
    inputs.set(key,input); draft.append(field(label,input));
  }
  const dimensions = element("div", {class:"rail-dimensions"});
  for (const [key,label,min,max,step] of [["width","Width",64,2048,8],["height","Height",64,2048,8],["seed","Seed",-1,undefined,1]]) {
    const input=element("input",{type:"number",min,step,...(max?{max}:{})});
    input.addEventListener("change",()=>{if(input.reportValidity())onParameters({[key]:Number(input.value)});});
    inputs.set(key,input); dimensions.append(field(label,input));
  }
  draft.append(dimensions,button("Random seed (−1)",{onClick:()=>onParameters({seed:-1})}));
  const draftNote=element("p",{class:"panel-intro"}); draft.prepend(draftNote);
  const metadata = createResultMetadata(); metadata.root.classList.add("result-metadata");
  const reuse = button("この結果の設定をReuse",{onClick:onReuse});
  const seed = button("ResultのSeedを使う",{onClick:onResultSeed});
  const result = element("div",{class:"inspector-result"},[element("p",{text:"閲覧・candidate選択だけではCurrent Draftは変わりません。ReuseはPrompt・parameters・LoRAを適用します（Modelは対象外）。",class:"panel-intro"}),metadata.root,seed,reuse]);
  const root=element("aside",{class:"inspector-panel",id:"studio-inspector","aria-label":"Generation inspector",hidden:""},[
    element("div",{class:"panel-heading"},[element("h2",{text:"制作設定"}),close]),
    element("div",{class:"inspector-tabs"},[draftTab,resultTab]),draft,result]);
  function renderContent(){
    if(!snapshot)return;
    draft.hidden=tab!=="draft";result.hidden=tab!=="result";
    draftTab.setAttribute("aria-pressed",String(tab==="draft"));resultTab.setAttribute("aria-pressed",String(tab==="result"));
    draftNote.textContent=`${snapshot.runtime.selectedCheckpoint?.modelName ?? "—"} · ${snapshot.parameters.width ?? "—"} × ${snapshot.parameters.height ?? "—"}`;
    syncOptions(inputs.get("samplerName"),snapshot.catalogs.samplers,snapshot.parameters.samplerName);
    syncOptions(inputs.get("scheduler"),snapshot.catalogs.schedulers,snapshot.parameters.scheduler);
    for(const [key,input] of inputs){syncValue(input,snapshot.parameters[key]);input.disabled=view.locked;}
    if (snapshot.currentImage) {
      metadata.root.hidden=false;metadata.render(snapshot.completed,snapshot.currentImage);
    } else metadata.root.hidden=true;
    seed.disabled=reuse.disabled=view.locked || !snapshot.currentImage;
  }
  return {root,focus(){close.focus();},render(value,open,projection={locked:!value.ready}){snapshot=value;view=projection;root.hidden=!open;renderContent();}};
}
