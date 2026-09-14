import test from 'node:test';
import assert from 'node:assert/strict';
import {createGenerationDraft} from '../public/features/generation-draft.js';
import {
 checkpointStyleProfile, withCheckpointStyle, checkpointNegativeTriggers,
 withCheckpointNegative, CHECKPOINT_STYLE_PROFILES
} from '../public/checkpoint-style-profiles.js';
const a={title:'sd/oneObsessionAnima_v30.safetensors [ed32d6584f]',hash:'ed32d6584f'};
const b={title:'sd/anima29B_v10.safetensors [0b3020d1b9]',hash:'0b3020d1b9'};
const c={title:'sd/chosenMixAnima_v10.safetensors [04045f043f]',hash:'04045f043f'};
const d={title:'sd/oneObsessionAnima_v40.safetensors [2acbd9f1d5]',hash:'2acbd9f1d5'};
const e={title:'sd/silvermoonmixAnima_v23.safetensors [fcf423c227]',hash:'fcf423c227'};
const f={title:'sd/miaomiaoRealskin_anima13.safetensors [7648dcc42b]',hash:'7648dcc42b'};
test('checkpoint profiles match exact version and reject conflicting hash',()=>{
 assert.equal(checkpointStyleProfile(a).label,'One obsession Anima v3.0');
 assert.ok(checkpointStyleProfile('sd/anima29B_v10.safetensors'));
 assert.equal(checkpointStyleProfile({...a,hash:'wrong'}),null);
 assert.deepEqual(checkpointNegativeTriggers(b),[]);
 const profile=checkpointStyleProfile(b);profile.negativeWords='';
 try { assert.deepEqual(checkpointNegativeTriggers(b),[]); }
 finally { delete profile.negativeWords; }
});
test('installed Chosen-mix Anima v1.0 resolves the verified hash and tags',()=>{
 const profile=checkpointStyleProfile(c);
 assert.equal(profile.label,'Chosen-mix Anima v1.0');
 assert.equal(profile.hash,'04045f043f');
 assert.equal(profile.filename,'chosenMixAnima_v10.safetensors');
 assert.equal(profile.source,'https://civitai.com/models/2839674/chosen-mixanima?modelVersionId=3205319');
 assert.equal(profile.words,'masterpiece, best quality, score_7, highres, absurdres');
 assert.equal(profile.negativeWords,'worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, lowres');
 assert.equal(checkpointStyleProfile({...c,hash:'wrong'}),null);
});
test('new Anima checkpoints resolve only their verified versions and expose creator-safe tags',()=>{
 const one=checkpointStyleProfile(d);
 assert.equal(one.label,'One obsession Anima v4.0');
 assert.equal(one.source,'https://civitai.com/models/2695493?modelVersionId=3301424');
 assert.equal(one.words,'masterpiece, best quality, score_9, score_8, score_7, absurdres, newest, very aesthetic, amazing quality, highres');
 assert.equal(one.negativeWords,'worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, lowres');

 const silver=checkpointStyleProfile(e);
 assert.equal(silver.label,'SilvermoonMix Anima Evolved v2.3');
 assert.equal(silver.words,'');
 assert.equal(silver.negativeWords,'');
 assert.deepEqual(checkpointNegativeTriggers(e),[]);

 const realSkin=checkpointStyleProfile(f);
 assert.equal(realSkin.label,'MiaoMiao RealSkin Anima v1.3');
 assert.equal(realSkin.words,'best quality, score_7, score_9, very aesthetic, ultra detailed, high contrast, photorealistic, raw photo');
 assert.equal(realSkin.negativeWords,'worst quality, low quality, score_1, score_2, score_3, artist name');
 assert.deepEqual(checkpointNegativeTriggers(f).map(item=>item.text),['worst quality','low quality','score_1','score_2','score_3','artist name']);

 for (const checkpoint of [d,e,f]) {
  assert.ok(checkpointStyleProfile(checkpoint.title.replace(/ \[[^\]]+\]$/,'')));
  assert.equal(checkpointStyleProfile({...checkpoint,hash:'wrong'}),null);
 }
});
test('checkpoint tags stay outside manual Structured/Raw, follow model and survive completion without baking',()=>{
 let model=a; const draft=createGenerationDraft({getCheckpoint:()=>model});
 draft.setPrompt({sections:{character:'teapot',style:'ink'},negative:'blur'});
 assert.equal(draft.readPrompt().structuredPrompt.style,'ink');
 assert.match(draft.positive(),/masterpiece/);
 assert.equal(draft.readPrompt().negativePrompt,'blur');
 draft.setPrompt({mode:'raw'}); const manual=draft.readPrompt().rawPrompt;
 assert.doesNotMatch(manual,/masterpiece/);
 draft.applyGenerated({prompt:draft.positive(),negativePrompt:'blur'});
 assert.equal(draft.readPrompt().rawPrompt,manual);
 const saved=draft.capture(); model=b;draft.restore(saved);
 assert.doesNotMatch(draft.positive(),/masterpiece/);
 assert.match(draft.positive(),/highres/);
 model=null;assert.equal(draft.positive(),manual);
 draft.dispose();
});
test('metadata reuse removes old checkpoint sources and preserves shared LoRA sources',()=>{
 const old=withCheckpointStyle([],a);
 const shared=old.find(t=>t.text==='masterpiece');shared.sourceLoraIds.push('art-lora');
 const next=withCheckpointStyle(old,b);
 assert.deepEqual(next.find(t=>t.text==='masterpiece').sourceLoraIds,['art-lora']);
 assert.equal(next.filter(t=>t.text==='highres').length,1);
 assert.equal(next.some(t=>t.sourceLoraIds.includes('checkpoint-style:ed32d6584f')),false);
 const d=createGenerationDraft({getCheckpoint:()=>b});
 d.reuse({structuredPrompt:{style:'ink'},appliedTriggerWords:old,loras:[{name:'art-lora',weight:1}]},{});
 assert.equal(d.readPrompt().structuredPrompt.style,'ink');
 assert.equal(d.readPrompt().checkpointStyle.label,'Anima-2.9B v1.0');
 assert.equal(d.readPrompt().appliedTriggerWords.some(t=>t.sourceLoraIds.includes('checkpoint-style:ed32d6584f')),false);
 d.dispose();
});

test('checkpoint Negative is derived once without changing the user textarea and follows the selected model',()=>{
 let model=a;const draft=createGenerationDraft({getCheckpoint:()=>model});
 draft.setPrompt({sections:{character:'teapot'},negative:'blur, low quality'});
 const first=draft.readPrompt();
 assert.equal(first.negativePrompt,'blur, low quality');
 assert.equal(first.finalNegativePrompt.match(/low quality/g)?.length,1);
 assert.match(first.finalNegativePrompt,/worst quality/);
 assert.equal(first.checkpointNegativeTriggers[0].sourceCheckpoint,'One obsession Anima v3.0');
 draft.setPrompt({mode:'raw'});
 assert.equal(draft.readPrompt().finalNegativePrompt,first.finalNegativePrompt);
 const saved=draft.capture();
 model=b;
 assert.equal(draft.readPrompt().negativePrompt,'blur, low quality');
 assert.equal(draft.readPrompt().finalNegativePrompt,'blur, low quality');
 assert.deepEqual(draft.readPrompt().checkpointNegativeTriggers,[]);
 model={title:'unprofiled.safetensors',hash:'none'};
 assert.equal(draft.readPrompt().finalNegativePrompt,'blur, low quality');
 draft.restore(saved);
 assert.equal(draft.readPrompt().finalNegativePrompt,'blur, low quality');
 draft.dispose();
});

test('Positive and Negative checkpoint tags use independent dedupe domains',()=>{
 const profile=CHECKPOINT_STYLE_PROFILES[0];
 const original=profile.negativeWords;
 try {
  profile.negativeWords='masterpiece, low quality, masterpiece';
  assert.equal(withCheckpointStyle([],a).filter(item=>item.text==='masterpiece').length,1);
  assert.deepEqual(checkpointNegativeTriggers(a).map(item=>item.text),['masterpiece','low quality']);
  assert.match(withCheckpointNegative('',a),/^masterpiece, low quality$/);
 } finally { profile.negativeWords=original; }
});

test('history reuse restores the saved user Negative and derives only the current checkpoint Negative',()=>{
 const draft=createGenerationDraft({getCheckpoint:()=>b});
 draft.reuse({structuredPrompt:{style:'ink'},negativePrompt:'manual old, worst quality',userNegativePrompt:'manual old'},{});
 assert.equal(draft.readPrompt().negativePrompt,'manual old');
 assert.equal(draft.readPrompt().finalNegativePrompt,'manual old');
 draft.dispose();
});

test('checkpoint Trigger Word toggles are tag-specific and scoped to the selected profile',()=>{
 let model=a;const draft=createGenerationDraft({getCheckpoint:()=>model});
 draft.setPrompt({sections:{character:'subject'},negative:'manual'});
 let state=draft.readPrompt();
 const positive=state.checkpointPositiveTriggers.find(trigger=>trigger.text==='masterpiece');
 const negative=state.checkpointNegativeTriggers.find(trigger=>trigger.text==='worst quality');
 draft.setManagedTriggerEnabled({kind:'checkpoint-positive',id:positive.managementId},false);
 draft.setManagedTriggerEnabled({kind:'checkpoint-negative',id:negative.managementId},false);
 assert.doesNotMatch(draft.positive(),/masterpiece/);assert.doesNotMatch(draft.finalNegative(),/worst quality/);
 const saved=draft.capture();
 draft.setManagedTriggerEnabled({kind:'checkpoint-positive',id:positive.managementId},true);
 draft.restore(saved);assert.doesNotMatch(draft.positive(),/masterpiece/);
 model=d;
 state=draft.readPrompt();
 assert.equal(state.checkpointPositiveTriggers.find(trigger=>trigger.text==='masterpiece').enabled,true);
 assert.equal(state.checkpointNegativeTriggers.find(trigger=>trigger.text==='worst quality').enabled,true);
 model=a;assert.equal(draft.readPrompt().checkpointPositiveTriggers.find(trigger=>trigger.text==='masterpiece').enabled,false);
 draft.dispose();
});
