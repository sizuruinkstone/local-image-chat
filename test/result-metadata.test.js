import test from "node:test";
import assert from "node:assert/strict";
import {resultMetadataRows,resultNegativePrompt,resultPrompt} from "../public/frontend/components/library/result-metadata.js";
test("readable result metadata uses the selected result seed and saved settings, including zero CFG",()=>{
 const record={runtime:{id:"neo"},settings:{checkpoint:"saved model",seed:1,width:896,height:1152,steps:12,cfgScale:0,samplerName:"Euler",scheduler:"normal"}};
 const before=structuredClone(record);
 const rows=Object.fromEntries(resultMetadataRows(record,{seed:42}));
 assert.deepEqual(rows,{Checkpoint:"saved model",Runtime:"neo",Resolution:"896 × 1152",Seed:"42",Sampler:"Euler",Scheduler:"normal",Steps:"12",CFG:"0"});
 assert.deepEqual(record,before);
 assert.equal(Object.fromEntries(resultMetadataRows({},{})).Seed,"—");
});
test("readable metadata shows the effective Final Negative when available",()=>{
 assert.equal(resultNegativePrompt({negativePrompt:"request final",effectiveNegativePrompt:"provider final"}),"provider final");
 assert.equal(resultNegativePrompt({negativePrompt:"request final"}),"request final");
});
test("Library metadata formats Structured Prompt sections and preserves Raw and legacy fallback",()=>{
 const structured={prompt:"final flattened",rawPromptOverride:false,structuredPrompt:{character:"1girl",appearance:"blue eyes",composition:"",situation:"classroom",style:"watercolor",extra:""}};
 const before=structuredClone(structured);
 assert.equal(resultPrompt(structured),"キャラクター: 1girl\n容姿・衣装: blue eyes\nシチュエーション・背景: classroom\n画風・品質: watercolor");
 assert.deepEqual(structured,before);
 assert.equal(resultPrompt({...structured,rawPromptOverride:true,prompt:"raw final"}),"raw final");
 assert.equal(resultPrompt({prompt:"legacy final"}),"legacy final");
 assert.equal(resultPrompt({prompt:"fallback",structuredPrompt:{}}),"fallback");
});

test('Structured metadata includes the generation-time section profile without editing stored manual sections',()=>{
 const record={structuredPrompt:{appearance:'hat'},sectionProfiles:{appearance:{name:'Summer',text:'white dress',enabled:true}}};
 assert.equal(resultPrompt(record),'容姿・衣装: hat, white dress');assert.equal(record.structuredPrompt.appearance,'hat');
});
