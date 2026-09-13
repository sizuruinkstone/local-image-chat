import {element,button} from '../primitives.js';
import {createStudioDialog,field} from '../settings/dialog.js';
import {createSceneLibrary,sceneRequest} from '../../../core/scene-library.js';
import {PROMPT_FIELDS,PROMPT_FIELD_LABELS} from '../../../structured-prompt.js';
import {createSceneEditor} from './scene-editor.js';

export function createScenes({workspace,onApplied,onLibrary,onSaved=()=>{}}) {
  let visible=false,loaded=false,disposed=false,timer,applying=false,activePlan,activeScene,listData,scroll=0,gridKey='';
  const root=element('section',{class:'scenes-library','aria-label':'Scenes'});
  const search=element('input',{type:'search',placeholder:'名前で検索…','aria-label':'場面を名前で検索',maxlength:'100'});
  const status=element('p',{role:'status'}),grid=element('div',{class:'scene-grid'}),message=element('p',{role:'alert'}),busyReason=element('p',{role:'status'});
  const rating=element('div',{class:'content-rating-picker',role:'group','aria-label':'場面の分類'});
  const filters=['general','nsfw'].map(value=>{const node=button(value==='general'?'一般':'NSFW',{className:'content-rating-option',onClick:()=>{root.scrollTop=0;service.setQuery({contentRating:value});}});rating.append(node);return node;});
  const more=button('さらに読み込む',{onClick:()=>service.more()});
  const empty=button('Libraryを開く',{onClick:onLibrary});
  const service=createSceneLibrary({onChange:render});
  const editor=createSceneEditor({onSaved:scene=>{
    service.invalidate();loaded=false;message.textContent=scene?`「${scene.name}」を保存しました。${scene.contentRating!==(listData?.contentRating ?? 'general')?'一覧と異なる分類に保存されています。':''}`:'場面を削除しました。';onSaved(scene);
    if(visible){loaded=true;service.load().then(()=>{if(scene)grid.querySelector(`[data-scene-id="${scene.id}"] .scene-edit`)?.focus({preventScroll:true});});}
  }});
  const exception=createStudioDialog('場面の適用を確認');exception.root.classList.add('scene-application');
  exception.root.addEventListener('cancel',event=>{if(applying)event.preventDefault();});
  exception.root.addEventListener('close',()=>{if(visible&&activeScene)grid.querySelector(`[data-scene-id="${activeScene.id}"] .scene-apply`)?.focus({preventScroll:true});});
  exception.root.querySelector('header button').addEventListener('click',event=>{if(applying)event.stopImmediatePropagation();},true);
  const exceptionError=element('p',{role:'alert'});let decisionInputs={};
  async function commit(plan,scene) {
    const latest=(await sceneRequest(`/api/v1/scenes/${scene.id}`)).scene;
    const result=workspace.applyScene(plan,latest);
    if(result.applied){exception.close();onApplied();}
  }
  function showExceptions(plan,scene,baseDecisions={}) {
    activePlan=plan;activeScene=scene;decisionInputs={matches:{},keep:{},sections:null};exception.body.replaceChildren();exceptionError.textContent='';
    if(plan.missing.length) {
      exception.body.append(element('p',{text:plan.available.length?'不足・同一性未確認のLoRAがあります。残りを適用できます。':'利用できるLoRAが0件なら、現在のLoRA構成を維持します。'}));
      for(const entry of plan.missing) {
        const select=element('select',{},[element('option',{value:'',text:'使用せず残りを適用'}),...(entry.status==='collision'?[]:workspace.getSnapshot().catalogs.loras.map(item=>element('option',{value:item.name,text:item.name})))]);
        decisionInputs.matches[entry.index]=select;
        exception.body.append(field(`${entry.saved.name} · ${entry.status==='collision'?'識別情報の衝突':entry.status==='ambiguous'?'一致が曖昧':'不足／同一性を確認して選択'}`,select));
      }
    }
    for(const item of plan.unknown) {
      const select=element('select',{},[element('option',{value:'',text:'分類を確認'}),element('option',{value:'keep',text:'キャラクターとして残す'}),element('option',{value:'replace',text:'場面用として置き換える'})]);
      decisionInputs.keep[item.name]=select;exception.body.append(field(item.name,select));
    }
    if(plan.needsRaw||plan.issues.includes('inline')) {
      const prompt=workspace.getSnapshot().prompt;
      const ref=element('textarea',{readonly:'',rows:'5',text:prompt.rawPromptOverride?prompt.rawPrompt:Object.values(prompt.structuredPrompt).join('\n')});
      exception.body.append(field('現在の本文（参考）',ref),element('p',{text:'現在の本文を各欄へ整理してください。<lora:…> 指定は本文から外してLoRA一覧で管理します。場面の非空欄はこの後置き換わります。'}));
      const managed=element('details',{},[element('summary',{text:'適用中プロファイル・自動Trigger（本文への転記不要）'}),
        ...Object.entries(prompt.sectionProfiles ?? {}).map(([key,p])=>element('p',{text:`${PROMPT_FIELD_LABELS[key]} · ${p.name}（${p.enabled?'有効':'無効'}）: ${p.text}`})),
        ...(prompt.appliedTriggerWords ?? []).map(t=>element('p',{text:`${PROMPT_FIELD_LABELS[t.targetField] ?? '自動付与'}（${t.enabled?'有効':'無効'}）: ${t.text}`}))]);exception.body.append(managed);
      decisionInputs.sections={};
      for(const key of PROMPT_FIELDS) {
        const input=element('textarea',{rows:'3',text:prompt.rawPromptOverride?'':prompt.structuredPrompt[key]});decisionInputs.sections[key]=input;exception.body.append(field(PROMPT_FIELD_LABELS[key],input));
      }
    }
    const apply=button(plan.needsRaw?'分割して場面を適用':'利用できる内容を適用',{onClick:async()=>{
      if(applying)return;applying=true;apply.disabled=true;exception.body.inert=true;
      try {
        const decisions={...baseDecisions,allowMissing:true,matches:{...baseDecisions.matches,...Object.fromEntries(Object.entries(decisionInputs.matches).map(([key,input])=>[key,input.value]))},keep:{...baseDecisions.keep,...Object.fromEntries(Object.entries(decisionInputs.keep).filter(([,input])=>input.value).map(([key,input])=>[key,input.value==='keep']))},
          ...(decisionInputs.sections?{sections:Object.fromEntries(Object.entries(decisionInputs.sections).map(([key,input])=>[key,input.value]))}:{})};
        const next=workspace.prepareSceneApplication(activeScene,decisions,activePlan);
        if(next.issues.length) {
          if(next.issues.includes('inline'))throw new Error('対象外の本文に <lora:…> 指定が残っています。整理してから適用してください');
          if(next.issues.includes('classification')&&!next.unknown.every(item=>Object.hasOwn(decisionInputs.keep,item.name))){showExceptions(next,activeScene,decisions);return;}
          throw new Error('残すLoRAの分類を選択してください');
        }
        await commit(next,activeScene);
      }catch(error){exceptionError.textContent=error.message;}finally{applying=false;apply.disabled=false;exception.body.inert=false;}
    }});
    exception.body.append(exceptionError,button('キャンセル',{onClick:()=>{if(!applying)exception.close();}}),apply);exception.open();
  }
  async function select(id) {
    if(applying)return;applying=true;message.textContent='';render(listData);
    try {
      const scene=(await sceneRequest(`/api/v1/scenes/${id}`)).scene;
      const plan=workspace.prepareSceneApplication(scene);
      if(plan.issues.length)showExceptions(plan,scene);else await commit(plan,scene);
    }catch(error){message.textContent=error.message;}finally{applying=false;render(listData);}
  }
  function render(data) {
    if(!data||disposed)return;listData=data;
    const anchor=[...grid.children].find(node=>node.getBoundingClientRect().bottom>root.getBoundingClientRect().top);
    const anchorId=anchor?.dataset.sceneId,offset=anchor?.getBoundingClientRect().top;
    status.textContent=data.error || (data.loading?'読み込み中…':`${data.total}件 · 更新が新しい順`);
    filters.forEach((node,index)=>node.setAttribute('aria-pressed',String(data.contentRating===['general','nsfw'][index])));
    const snapshot=workspace.getSnapshot();const disabled=applying||!snapshot.ready||snapshot.generation.busy||snapshot.runtime.switching||snapshot.reusing||snapshot.selectingModel||snapshot.catalogState.loading;
    const nextKey=JSON.stringify(data.items);
    if(gridKey!==nextKey)grid.replaceChildren(...data.items.map(scene=>{
      const apply=button(scene.name,{className:'scene-apply',onClick:()=>select(scene.id),'aria-label':`${scene.name}を適用`});apply.disabled=disabled;
      const img=element('img',{src:scene.thumbnailUrl,alt:'',loading:'lazy',decoding:'async'});img.addEventListener('error',()=>{if(!img.dataset.failed){img.dataset.failed='1';img.src='/image-placeholder.svg';}});apply.prepend(img);
      const card=element('article',{class:'scene-card','data-scene-id':scene.id},[apply,
        element('details',{class:'scene-checkpoint'},[element('summary',{text:`元: ${scene.source?.checkpointName || '不明'}`}),element('p',{text:scene.source?.checkpointName || '保存元Checkpointは不明です'})]),
        button('編集',{className:'control scene-edit',onClick:()=>editor.openScene(scene.id),'aria-label':`${scene.name}を編集`})]);return card;
    }));gridKey=nextKey;grid.querySelectorAll('.scene-apply').forEach(node=>node.disabled=disabled);
    if(anchorId){const node=grid.querySelector(`[data-scene-id="${anchorId}"]`);if(node)root.scrollTop+=node.getBoundingClientRect().top-offset;}
    more.hidden=!data.nextCursor;more.disabled=data.loading;
    empty.hidden=data.loading||data.items.length>0;
    if(!data.loading&&!data.error&&!data.items.length)status.textContent=data.query?'条件に合う場面がありません':'まだ場面がありません。Libraryで画像を開き、場面として保存できます。';
  }
  search.addEventListener('input',()=>{clearTimeout(timer);service.invalidate();timer=setTimeout(()=>{root.scrollTop=0;service.setQuery({query:search.value});},200);});
  root.append(element('header',{class:'scenes-tools'},[element('h1',{text:'Scenes'}),search,rating,button('更新',{onClick:()=>service.load()})]),status,message,busyReason,grid,empty,more);
  return {root,dialogs:[editor.root,editor.picker,exception.root],openSource:id=>editor.openSource(id),
    show(value){if(visible&&!value)scroll=root.scrollTop;const entered=value&&!visible;visible=value;root.hidden=!value;if(entered){root.scrollTop=scroll;if(!loaded){loaded=true;service.load();}}},
    render(){if(listData){const snapshot=workspace.getSnapshot();const disabled=applying||!snapshot.ready||snapshot.generation.busy||snapshot.runtime.switching||snapshot.reusing||snapshot.selectingModel||snapshot.catalogState.loading;grid.querySelectorAll('.scene-apply').forEach(node=>node.disabled=disabled);busyReason.textContent=disabled?'生成・構成の更新が完了すると場面を適用できます。閲覧と場面の編集は引き続き利用できます。':'';busyReason.hidden=!disabled;}},
    dispose(){disposed=true;clearTimeout(timer);service.dispose();editor.dispose();exception.root.remove();}};
}
