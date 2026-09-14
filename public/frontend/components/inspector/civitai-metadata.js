import {element} from '../primitives.js';
export function civitaiMetadataRows(value){
 const weight=Number.isFinite(value.recommendedWeight)?String(value.recommendedWeight):'未記載';
 return [['バージョン',value.versionName||'—'],['種類',value.modelType||'—'],['ベースモデル',value.baseModel||'—'],
  [value.recommendedWeightSource==='fallback'?'初期強度の目安（作者推奨は未確認）':'推奨強度',weight],
  ['ファイル',value.file?.name||'—'],['サイズ',Number.isFinite(value.file?.sizeKB)?`${(value.file.sizeKB/1024).toFixed(1)} MB`:'—']];
}
export function createCivitaiMetadata(){
 const root=element('section',{class:'civitai-model-preview',hidden:'','aria-label':'Civitai モデル情報'});
 function safeUrl(value,image=false){try{const u=new URL(value);return u.protocol==='https:'&&(image?u.hostname==='image.civitai.com':u.hostname==='civitai.com')?u.href:null;}catch{return null;}}
 return {root,clear(){root.hidden=true;root.replaceChildren();},render(value){
  const media=element('div',{class:'civitai-preview-media'});
  const fallback=element('span',{text:'プレビュー画像なし'});
  const preview=safeUrl(value.previewUrl,true);
  if(preview){const img=element('img',{src:preview,alt:`${value.modelName||'モデル'}のプレビュー`,referrerpolicy:'no-referrer',loading:'lazy'});img.addEventListener('error',()=>media.replaceChildren(fallback));media.append(img);}else media.append(fallback);
  const words=element('div',{class:'civitai-trained-words'},(value.trainedWords||[]).map(word=>element('span',{text:word})));
  if(!words.childNodes.length)words.append(element('span',{text:'指定なし'}));
  const detail=element('div',{},[element('h3',{text:value.modelName||'名前未記載'}),element('dl',{class:'metadata-values'},civitaiMetadataRows(value).map(([label,text])=>element('div',{},[element('dt',{text:label}),element('dd',{text})]))),element('h4',{text:'Trigger Words'}),words]);
  const source=safeUrl(value.sourceUrl);if(source)detail.append(element('a',{href:source,target:'_blank',rel:'noopener noreferrer',text:'Civitaiの配布ページを開く'}));
  const raw=element('details',{class:'civitai-raw-metadata'},[element('summary',{text:'詳細データ（JSON）'}),element('pre',{text:JSON.stringify(value,null,2)})]);
  root.replaceChildren(element('div',{class:'civitai-model-overview'},[media,detail]),raw);root.hidden=false;
 }};
}
