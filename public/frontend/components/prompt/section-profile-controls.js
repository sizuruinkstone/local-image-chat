import {element,button} from '../primitives.js';
import {createStudioDialog} from '../settings/dialog.js';
function createRatingButtons(label,choices,onChange){
 let value=choices[0].value,controls=[];
 const root=element('div',{class:'section-profile-rating-options',role:'group','aria-label':label});
 const select=(next,notify=false)=>{
  if(!choices.some(choice=>choice.value===next))return;
  const changed=value!==next;value=next;
  for(const control of controls)control.setAttribute('aria-pressed',String(control.dataset.profileRating===value));
  if(notify&&changed)onChange?.(value);
 };
 controls=choices.map(choice=>button(choice.label,{className:'section-profile-rating-button','data-profile-rating':choice.value,'aria-pressed':'false',onClick:()=>select(choice.value,true)}));
 root.append(...controls);select(value);
 return {root,get value(){return value;},set value(next){select(next);}};
}
export function createSectionProfileControls({field,label,workspace}){
 let snapshot, listKey;
 const picker=createStudioDialog(`${label} · 呼び出し`);
 const saver=createStudioDialog(`${label} · 保存`);
 picker.root.classList.add('section-profile-dialog');saver.root.classList.add('section-profile-dialog');
 const error=element('p',{role:'alert'}),saveError=element('p',{role:'alert'});
 const name=element('input',{'aria-label':`${label} プロファイル名`,placeholder:'名前'});
 const text=element('textarea',{'aria-label':`${label} 保存内容`,rows:'7'});
 const search=element('input',{type:'search','aria-label':`${label} プロファイル検索`,placeholder:'名前・内容を検索'});
 const ratingFilter=createRatingButtons(`${label} プロファイル分類`,[
  {value:'all',label:'すべて'},{value:'general',label:'一般'},{value:'nsfw',label:'NSFW'}
 ],()=>{listKey='';renderList();});
 const saveRating=createRatingButtons(`${label} 保存分類`,[
  {value:'general',label:'一般'},{value:'nsfw',label:'NSFW'}
 ]);
 const list=element('div',{class:'section-profile-list'});
 const activeName=element('h3');
 const activeRating=element('small',{class:'section-profile-rating'});
 const activeText=element('textarea',{'aria-label':`${label} 今回だけ編集`,rows:'5'});
 let pending=false;
 const run=async(fn,output=error)=>{if(pending)return;pending=true;try{output.textContent='';await fn();}catch(e){output.textContent=e.message;}finally{pending=false;}};
 function openSave(value){name.value=value?.name||'';text.value=value?.text??snapshot.prompt.structuredPrompt[field]??'';saveRating.value=value?.contentRating==='nsfw'?'nsfw':snapshot.contentRating==='nsfw'?'nsfw':'general';saveError.textContent='';saver.open();name.focus();}
 saver.body.append(element('label',{},[element('span',{text:'名前'}),name]),element('fieldset',{class:'section-profile-rating-field'},[element('legend',{text:'分類'}),saveRating.root]),element('label',{},[element('span',{text:'保存するPrompt'}),text]),saveError,
  button('保存する',{onClick:()=>run(async()=>{await workspace.saveSectionProfile(field,{name:name.value,text:text.value,contentRating:saveRating.value});saver.close();},saveError)}));
 const toggle=button('無効にする',{onClick:()=>run(()=>workspace.setSectionProfile(field,{...snapshot.prompt.sectionProfiles[field],enabled:!snapshot.prompt.sectionProfiles[field].enabled}))});
 const remove=button('適用解除',{onClick:()=>run(()=>workspace.setSectionProfile(field,null))});
 const active=element('section',{class:'section-profile-current'},[activeName,activeRating,activeText,element('small',{text:'今回だけ編集。保存元は変更しません。'}),
  element('div',{},[toggle,remove,button('別名で保存…',{onClick:()=>openSave({...snapshot.prompt.sectionProfiles[field],name:snapshot.prompt.sectionProfiles[field].name+' コピー'})})])]);
 picker.body.append(element('div',{class:'section-profile-filters'},[search,ratingFilter.root]),element('div',{class:'section-profile-browser'},[list,active]),error);
 const recall=button('呼び出し',{onClick:()=>{error.textContent=snapshot.sectionProfileError||'';ratingFilter.value=snapshot.contentRating==='nsfw'?'nsfw':'general';listKey='';renderList();picker.open();search.focus();run(async()=>{error.textContent='読み込み中…';await workspace.refreshSectionProfiles?.();error.textContent='';});}});
 const root=element('div',{class:'section-profile-controls','data-section':label,'aria-label':`${label} プロファイル`},[
  button('保存',{onClick:()=>openSave()}),recall,picker.root,saver.root
 ]);
 activeText.addEventListener('input',()=>run(()=>workspace.setSectionProfile(field,{...snapshot.prompt.sectionProfiles[field],text:activeText.value})));
 function renderList(){
  const query=search.value.toLowerCase();
  const fieldItems=(snapshot.sectionProfileCatalog||[]).filter(p=>p.field===field);
  const items=fieldItems.filter(p=>(ratingFilter.value==='all'||(p.contentRating==='nsfw'?'nsfw':'general')===ratingFilter.value)&&`${p.name} ${p.text}`.toLowerCase().includes(query));
  const key=JSON.stringify([fieldItems.length,items]);if(key===listKey)return;listKey=key;
  list.replaceChildren(...items.map(p=>element('div',{class:'section-profile-card'},[
   element('div',{class:'section-profile-card-heading'},[button(p.name,{onClick:()=>run(()=>{workspace.setSectionProfile(field,p);picker.close();})}),
    element('span',{class:'section-profile-rating',text:p.contentRating==='nsfw'?'NSFW':'一般'}),
    button('削除',{'aria-label':`${p.name}を削除`,onClick:()=>run(()=>workspace.removeSectionProfile(p.id))})]),
   element('small',{text:p.text})
  ])));
  if(!items.length)list.append(element('p',{text:fieldItems.length?'この分類・検索条件に一致するプロファイルはありません。':'保存済みプロファイルはありません。'}));
 }
 search.addEventListener('input',renderList);
 return {root,render(value,locked){snapshot=value;const p=value.prompt.sectionProfiles?.[field];
  active.hidden=!p;activeName.textContent=p?`適用中: ${p.name}`:'';
  activeRating.textContent=p?(p.contentRating==='nsfw'?'NSFW':'一般'):'';
  recall.title=p?`適用中: ${p.name}（${p.enabled?'有効':'無効'}）`:'プロファイルを呼び出す';
  recall.setAttribute('aria-pressed',String(Boolean(p?.enabled)));
  if(activeText.value!==(p?.text||''))activeText.value=p?.text||'';
  toggle.querySelector('span').textContent=p?.enabled?'無効にする':'有効にする';
  renderList();
  for(const control of [...root.children].filter(n=>n.tagName==='BUTTON'))control.disabled=locked;
  for(const body of [picker.body,saver.body])for(const control of body.querySelectorAll('input,textarea,button'))control.disabled=locked;
 }};
}
