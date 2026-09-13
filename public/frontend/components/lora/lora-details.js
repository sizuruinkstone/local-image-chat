import {element,button} from "../primitives.js";
import {createAssetThumbnail} from "./asset-thumbnail.js";
import {createWeightEditor} from "./active-composition.js";
export function createLoraDetails({onAdd,onFavorite,onWeight,onClose}) {
  let asset,active;
  const title=element("h2");const path=element("p",{class:"lora-detail-path"});
  const thumb=createAssetThumbnail({large:true});
  const meta=element("dl",{class:"lora-detail-metadata"});
  const add=button("Add to Composition",{className:"control lora-add",onClick:()=>onAdd(asset.id)});
  const favorite=button("Favorite",{onClick:()=>onFavorite(asset.id,!asset.favorite)});
  const weight=createWeightEditor("Selected LoRA",value=>onWeight(asset.id,value));
  const triggers=element("p",{class:"lora-trigger-text"});
  const triggerArea=element("section",{class:"lora-trigger-area"},[element("h3",{text:"Trigger words"}),triggers,element("small",{text:"追加時に自動登録。衣装はActive Compositionで選べます。"})]);
  const close=button("素材一覧へ",{className:"control detail-back",glyph:"back",onClick:onClose});
  const body=element("div",{class:"lora-detail-body"},[close,thumb.root,title,path,element("div",{class:"lora-detail-actions"},[add,favorite]),weight.root,meta,triggerArea]);
  const empty=element("div",{class:"lora-detail-empty"},[element("p",{text:"気になる素材を選択"}),element("small",{text:"Preview・metadataを確認して、構成へ追加できます。"})]);
  const root=element("aside",{class:"lora-details","aria-label":"LoRA Details"},[empty,body]);
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
  }};
}
