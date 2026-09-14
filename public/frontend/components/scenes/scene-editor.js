import {element,button} from '../primitives.js';
import {createStudioDialog,field} from '../settings/dialog.js';
import {SCENE_FIELDS,extractSceneTriggers,validateSceneContent} from '../../../scenes.js';
import {PROMPT_FIELD_LABELS} from '../../../structured-prompt.js';
import {sceneRequest} from '../../../core/scene-library.js';
import {createSceneImagePicker} from './scene-image-picker.js';

export function createSceneEditor({onSaved=()=>{}}={}) {
  const dialog=createStudioDialog('場面を保存・編集');dialog.root.classList.add('scene-editor');
  let current=null,source=null,previewId,dirty=false,busy=false,generation=0,mutationId,mutationBody='',disposed=false,loaded=false;
  const error=element('p',{role:'alert'}),note=element('p',{text:'空欄とLoRA 0件は適用時の現在値を維持します。キャラクター属性が他の欄に混在する場合は手動で整理してください。'});
  const name=element('input',{type:'text',maxlength:'100'}),rating=element('select',{},[element('option',{value:'',text:'分類を選択'}),element('option',{value:'general',text:'一般'}),element('option',{value:'nsfw',text:'NSFW'})]);
  const image=element('img',{class:'scene-editor-image',alt:'場面の代表画像'}),checkpoint=element('p');
  const inputs={};
  const fields=SCENE_FIELDS.map(key=>{
    const check=element('input',{type:'checkbox','aria-label':`${PROMPT_FIELD_LABELS[key]}を保存`}),text=element('textarea',{rows:'3','aria-label':PROMPT_FIELD_LABELS[key]});inputs[key]={check,text};
    return element('section',{class:'scene-field'},[field(`${PROMPT_FIELD_LABELS[key]}を保存`,check),text]);
  });
  const includeLoras=element('input',{type:'checkbox'}),loraList=element('div',{class:'scene-loras'});let loraInputs=[];
  const negativeCheck=element('input',{type:'checkbox'}),negative=element('textarea',{rows:'3','aria-label':'保存するNegative'});
  const references=element('div');
  const picker=createSceneImagePicker(item=>{previewId=item.id;image.src=item.thumbnailUrl||`/api/images/${encodeURIComponent(item.id)}/thumbnail`;dirty=true;});
  function reference(label,value){return field(label,element('textarea',{readonly:'',rows:'4',text:value}));}
  function fill(value,isSource) {
    loaded=true;dialog.root.querySelector('h2').textContent=isSource?'場面として保存':'場面を編集';
    source=isSource?value:null;current=isSource?null:value;previewId=undefined;mutationId=crypto.randomUUID();mutationBody='';
    name.value=value.name ?? '';rating.value=value.contentRating ?? '';
    for(const key of SCENE_FIELDS){inputs[key].check.checked=Boolean(value.fields[key]?.trim());inputs[key].text.value=value.fields[key] ?? '';}
    negativeCheck.checked=!isSource&&Boolean(value.userNegativePrompt);negative.value=value.userNegativePrompt ?? '';
    image.src=isSource?`/api/images/${encodeURIComponent(value.source.historyImageId)}/thumbnail`:value.thumbnailUrl;
    checkpoint.textContent=`保存元: ${value.source?.checkpointName || '不明'}`;
    references.replaceChildren();
    if(value.referencePrompt)references.append(reference('元Prompt（手動で各欄へ転記）',value.referencePrompt));
    if(isSource&&!value.negativeRecorded)references.append(reference('元Negative（手入力記録なし・参考のみ）',value.referenceNegative));
    includeLoras.checked=true;loraInputs=[];loraList.replaceChildren();
    for(const item of value.loras ?? []) {
      const checked=element('input',{type:'checkbox','aria-label':`${item.name}を保存`});checked.checked=isSource?item.selected:true;
      const role=element('select',{'aria-label':`${item.name}の分類`},['unknown','scene','character'].map(value=>element('option',{value,text:value==='unknown'?'分類を確認':value==='scene'?'場面用':'キャラクター用'})));role.value=item.role;
      const weight=element('input',{type:'number',min:'0',max:'2',step:'0.05','aria-label':`${item.name} weight`});weight.value=item.weight;
      const identity=element('select',{'aria-label':`${item.name}の同一性`},[element('option',{value:'recorded',text:'生成時の記録を使用（識別情報がなければ適用時に確認）'}),...(item.identityCandidate?.registryUid||item.identityCandidate?.sha256?[element('option',{value:'confirmed',text:`現在の ${item.name} と同じLoRAであることを確認`})]:[])]);
      identity.classList.add('scene-identity');
      const sync=()=>{checked.disabled=role.value!=='scene';if(checked.disabled)checked.checked=false;};role.addEventListener('change',sync);sync();
      loraList.append(element('div',{class:'scene-lora-row'},[field(item.name,checked),role,weight,...(isSource?[identity]:[])]));loraInputs.push({item,checked,role,weight,identity});
    }
    error.textContent='';reload.hidden=true;copy.hidden=isSource;remove.hidden=isSource;save.textContent=isSource?'保存':'上書き保存';dirty=false;
  }
  function content() {
    if(includeLoras.checked&&loraInputs.some(row=>row.checked.checked&&row.weight.value===''))throw new Error('LoRAのweightを入力してください');
    const loras=includeLoras.checked?loraInputs.filter(row=>row.checked.checked&&row.role.value==='scene').map(({item,weight,identity})=>({identity:identity.value==='confirmed'?item.identityCandidate:item.identity,name:item.name,role:'scene',weight:Number(weight.value)})):[];
    const triggers=source?extractSceneTriggers(source.appliedTriggerWords,loras):(current.loraTriggers ?? []).map(trigger=>({...trigger,sources:trigger.sources.filter(s=>loras.some(l=>JSON.stringify(l.identity)===JSON.stringify(s.loraIdentity)))})).filter(t=>t.sources.length);
    const value={name:name.value,contentRating:rating.value,fields:Object.fromEntries(SCENE_FIELDS.filter(key=>inputs[key].check.checked).map(key=>[key,inputs[key].text.value])),loras,loraTriggers:triggers,...(negativeCheck.checked?{userNegativePrompt:negative.value}:{})};
    const result=validateSceneContent(value);
    if(!Object.keys(result.fields).length&&!result.loras.length&&!result.userNegativePrompt)throw new Error('保存する内容を選択してください');
    return result;
  }
  function setBusy(value){busy=value;dialog.root.querySelectorAll('button').forEach(node=>node.disabled=value);dialog.body.inert=value||!loaded;for(const node of [save,copy,remove])node.disabled=value||!loaded;}
  async function persist(asCopy=false) {
    if(busy||!loaded)return;
    try {
      const value=content();setBusy(true);error.textContent='';
      let expectedRevision=current?.revision;
      if(asCopy&&reload.hidden===false){
        const latest=(await sceneRequest(`/api/v1/scenes/${current.id}`)).scene;
        if(!confirm('最新版の代表画像を使用して、入力中の内容を別名保存します。続けますか？'))return;
        expectedRevision=latest.revision;
      }
      const body={content:value,...(current?{expectedRevision}:{sourceImageId:source.source.historyImageId}),...(previewId?{previewSourceImageId:previewId}:{})};
      const key=JSON.stringify({asCopy,body});if(key!==mutationBody){mutationBody=key;mutationId=crypto.randomUUID();}
      if(!current||asCopy)body.mutationId=mutationId;
      const data=await sceneRequest(`/api/v1/scenes${current?`/${current.id}${asCopy?'/copy':''}`:''}`,current&&!asCopy?'PATCH':'POST',body);
      dirty=false;dialog.close();onSaved(data.scene);
    }catch(cause){error.textContent=cause.message;if(cause.status===409)reload.hidden=false;}
    finally{setBusy(false);}
  }
  const save=button('保存',{onClick:()=>persist()}),copy=button('別名保存',{onClick:()=>persist(true)});
  const reload=button('最新版を読み直す',{onClick:async()=>{if(busy||!confirm('入力中の変更を破棄して最新版を読み直しますか？'))return;await openScene(current.id);}});reload.hidden=true;
  const remove=button('削除',{onClick:async()=>{
    if(busy||!confirm(`場面「${current.name}」を削除しますか？`))return;
    setBusy(true);try{await sceneRequest(`/api/v1/scenes/${current.id}?expectedRevision=${current.revision}`,'DELETE');dirty=false;dialog.close();onSaved(null);}catch(cause){error.textContent=cause.message;if(cause.status===409)reload.hidden=false;}finally{setBusy(false);}
  }});
  const footer=element('footer',{class:'scene-editor-footer'},[remove,reload,button('キャンセル',{onClick:()=>close()}),copy,save]);
  dialog.body.append(element('div',{class:'scene-editor-layout'},[
    element('aside',{},[image,button('画像を変更',{onClick:()=>picker.open()}),checkpoint]),
    element('div',{},[field('場面の名前',name),field('場面の分類',rating),references,...fields,field('LoRAを含める',includeLoras),loraList,field('Negativeを含める',negativeCheck),negative,note,error])
  ]));dialog.root.append(footer);
  const mark=()=>{dirty=true;};dialog.body.addEventListener('input',mark);dialog.body.addEventListener('change',mark);
  function close(){if(busy)return;if(dirty&&!confirm('入力中の変更を破棄しますか？'))return;generation++;dirty=false;dialog.close();}
  // Intercept the shared dialog close listener before it can bypass the dirty guard.
  dialog.root.querySelector('header button').addEventListener('click',event=>{event.stopImmediatePropagation();close();},true);
  dialog.root.addEventListener('cancel',event=>{event.preventDefault();close();});
  async function openScene(id,isSource=false) {
    const version=++generation;loaded=false;dialog.open();setBusy(true);error.textContent='読み込み中…';
    try{const data=await sceneRequest(`/api/v1/scenes/${isSource?'source/':''}${encodeURIComponent(id)}`);if(disposed||version!==generation)return;fill(isSource?data.source:data.scene,isSource);}
    catch(cause){if(version===generation)error.textContent=cause.message;}
    finally{if(version===generation)setBusy(false);}
  }
  return {root:dialog.root,picker:picker.root,openSource:id=>openScene(id,true),openScene,dispose(){disposed=true;generation++;picker.dispose();dialog.root.remove();}};
}
