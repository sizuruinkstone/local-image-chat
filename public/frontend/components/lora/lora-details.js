import {element,button} from "../primitives.js";
import {createAssetThumbnail} from "./asset-thumbnail.js";
import {createWeightEditor} from "./active-composition.js";
import {PROMPT_FIELDS,PROMPT_FIELD_LABELS} from "../../../structured-prompt.js";
export function createLoraDetails({onAdd,onFavorite,onWeight,onInsert,onClose,getPromptChoices = () => []}) {
  let asset,active;
  const title=element("h2");const path=element("p",{class:"lora-detail-path"});
  const thumb=createAssetThumbnail({large:true});
  const meta=element("dl",{class:"lora-detail-metadata"});
  const add=button("Add to Composition",{className:"control lora-add",onClick:()=>onAdd(asset.id)});
  const favorite=button("Favorite",{onClick:()=>onFavorite(asset.id,!asset.favorite)});
  const weight=createWeightEditor("Selected LoRA",value=>onWeight(asset.id,value));
  const triggers=element("p",{class:"lora-trigger-text"});
  const target=element("select",{"aria-label":"Trigger target section"});
  const choice=element("select",{"aria-label":"LoRA outfit / preset"}); let choiceKey="";
  const insert=button("選んだsectionへ挿入",{onClick:()=>onInsert(asset.id,target.value,choice.value)});
  const triggerArea=element("section",{class:"lora-trigger-area"},[element("h3",{text:"Trigger words"}),triggers,choice,target,insert]);
  const close=button("素材一覧へ",{className:"control detail-back",glyph:"back",onClick:onClose});
  const body=element("div",{class:"lora-detail-body"},[close,thumb.root,title,path,element("div",{class:"lora-detail-actions"},[add,favorite]),weight.root,meta,triggerArea]);
  const empty=element("div",{class:"lora-detail-empty"},[element("p",{text:"気になる素材を選択"}),element("small",{text:"Preview・metadataを確認して、構成へ追加できます。"})]);
  const root=element("aside",{class:"lora-details","aria-label":"LoRA Details"},[empty,body]);
  let previousMode;
  return {root,render(item,snapshot,locked){
    asset=item;body.hidden=!item;empty.hidden=Boolean(item);if(!item)return;
    active=snapshot.loras.find(lora=>lora.name===item.id);
    title.textContent=item.name;path.textContent=item.path;thumb.setSource(item.thumbnailUrl);
    add.disabled=locked||Boolean(active);add.querySelector("span").textContent=active?"Active in Composition":"Add to Composition";
    favorite.setAttribute("aria-pressed",String(item.favorite));favorite.querySelector("span").textContent=item.favorite?"★ Favorite":"☆ Favorite";
    favorite.disabled=snapshot.catalogState?.pendingFavorites.includes(item.id)??false;
    weight.root.hidden=!active;if(active)weight.render(active.weight,locked);
    const rows=[["Base model",item.baseModel],["Category",item.registry.subcategory||item.category],["Recommended weight",item.registry.recommendedWeightSource && item.registry.recommendedWeightSource!=="fallback" ? item.registry.recommendedWeight : ""],["Notes",item.registry.note]];
    meta.replaceChildren(...rows.filter(([,value])=>value!==""&&value!=null).flatMap(([name,value])=>[element("dt",{text:name}),element("dd",{text:String(value)})]));
    triggers.textContent=item.triggerWords||"登録されたTrigger wordsはありません。";
    const choices=getPromptChoices(item.id),nextChoiceKey=JSON.stringify([item.id,choices]);
    if(choiceKey!==nextChoiceKey){choiceKey=nextChoiceKey;choice.replaceChildren(element("option",{value:"",text:"登録Trigger words"}),...choices.map(item=>element("option",{value:item.id,text:item.label||item.name||item.id})));}
    choice.hidden=!choices.length;
    const raw=snapshot.prompt.rawPromptOverride;
    if(raw!==previousMode){target.replaceChildren(...(raw?[{value:"raw",label:"Raw Prompt"}]:PROMPT_FIELDS.map(value=>({value,label:PROMPT_FIELD_LABELS[value]}))).map(({value,label})=>element("option",{value,text:label})));previousMode=raw;}
    target.disabled=locked||(!item.triggerWords&&!choices.length);insert.disabled=locked||(!item.triggerWords&&!choices.length);choice.disabled=locked;
    insert.querySelector("span").textContent=raw?"Raw Promptへ挿入":"選んだsectionへ挿入";
  }};
}
