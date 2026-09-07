import {element,button} from "../primitives.js";
import {MIN_LORA_WEIGHT,MAX_LORA_WEIGHT,clampLoraWeight} from "../../../lora-tags.js";
export function createWeightEditor(name,onWeight) {
  let weight=0.7;
  const input=element("input",{type:"number",min:MIN_LORA_WEIGHT,max:MAX_LORA_WEIGHT,step:"0.01","aria-label":`${name} weight`});
  input.addEventListener("change",()=>{if(input.value && input.reportValidity())onWeight(Number(input.value));else input.value=weight;});
  const down=button("−",{className:"control","aria-label":`${name} weight minus`,onClick:()=>onWeight(clampLoraWeight(weight-0.05))});
  const up=button("+",{className:"control","aria-label":`${name} weight plus`,onClick:()=>onWeight(clampLoraWeight(weight+0.05))});
  const root=element("div",{class:"composition-weight"},[down,input,up]);
  return {root,render(value,disabled){weight=value;if(input.value!==String(value))input.value=value;input.disabled=disabled;down.disabled=disabled||value<=MIN_LORA_WEIGHT;up.disabled=disabled||value>=MAX_LORA_WEIGHT;}};
}
export function createActiveComposition({onWeight,onToggle,onRemove,onMove}) {
  const root=element("section",{class:"lora-composition","aria-label":"Active Composition"});
  const heading=element("h2",{text:"Active Composition"});
  const count=element("span");const list=element("div",{class:"composition-list"});
  root.append(element("header",{},[heading,count]),list);
  const rows=new Map();
  return {root,render(loras,locked){
    count.textContent=`${loras.length} active`;
    const keep=new Set(loras.map(lora=>lora.name));
    for(const [name,row]of rows)if(!keep.has(name)){row.root.remove();rows.delete(name);}
    if(!loras.length){list.replaceChildren(element("p",{text:"素材を選んで構成へ追加。追加してもBrowserは開いたままです。",class:"composition-empty"}));return;}
    list.querySelector(".composition-empty")?.remove();
    loras.forEach((lora,index)=>{
      let row=rows.get(lora.name);
      if(!row){
        const order=element("span",{class:"composition-order"});const name=element("strong",{text:lora.name,title:lora.name});
        const weight=createWeightEditor(lora.name,value=>onWeight(lora.name,value));
        const toggle=button("",{onClick:()=>onToggle(lora.name)});
        const up=button("↑",{"aria-label":`${lora.name} move up`,onClick:()=>onMove(lora.name,-1)});
        const down=button("↓",{"aria-label":`${lora.name} move down`,onClick:()=>onMove(lora.name,1)});
        const remove=button("Remove",{"aria-label":`${lora.name} Remove`,onClick:()=>onRemove(lora.name)});
        const node=element("div",{class:"composition-row"},[order,name,weight.root,element("div",{class:"composition-actions"},[toggle,up,down,remove])]);
        row={root:node,order,weight,toggle,up,down,remove};rows.set(lora.name,row);
      }
      const expected=list.children[index];if(expected!==row.root)list.insertBefore(row.root,expected??null);
      row.order.textContent=String(index+1).padStart(2,"0");
      row.root.dataset.enabled=String(lora.enabled!==false);
      row.weight.render(lora.weight,locked);
      row.toggle.querySelector("span").textContent=lora.enabled===false?"Enable":"Disable";
      row.toggle.setAttribute("aria-label",`${lora.name} ${lora.enabled===false?"Enable":"Disable"}`);
      row.toggle.disabled=row.remove.disabled=locked;row.up.disabled=locked||index===0;row.down.disabled=locked||index===loras.length-1;
    });
  }};
}
