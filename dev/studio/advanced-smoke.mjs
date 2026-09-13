import {createRequire} from "node:module";
import {once} from "node:events";
import {readFile,mkdir} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import {createStudioDevServer} from "./server.mjs";
const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const server=createStudioDevServer();server.listen(0,"127.0.0.1");await once(server,"listening");
const browser=await chromium.launch({channel:"chrome",headless:true}),page=await browser.newPage({viewport:{width:1440,height:900}});
const runtime={id:"reforge",label:"Integration ReForge",available:true,features:{txt2img:true,inpaint:true,img2img:true,hires:true,ipAdapter:true}};
const comparisons=[],records=[];
const svg=await readFile("dev/studio/study.svg","utf8"),requests=[],errors=[];let record,serial=0,sets=[],experiments=[];
page.on("pageerror",e=>errors.push(e.message));await page.route("**/outputs/*.svg",r=>r.fulfill({contentType:"image/svg+xml",body:svg}));
await page.route("https://image.civitai.com/fixture-preview.svg",r=>r.fulfill({contentType:"image/svg+xml",body:svg}));
await page.route("**/api/**",async route=>{const request=route.request(),url=new URL(request.url()),p=url.pathname;const json=data=>route.fulfill({contentType:"application/json",body:JSON.stringify(data)});
 if(p==="/api/config")return json({runtimes:[runtime],defaultRuntimeId:"reforge",defaults:{width:768,height:768,seed:17,steps:16}});
 if(p==="/api/runtimes")return json({runtimes:[runtime],defaultRuntimeId:"reforge"});
 if(p==="/api/checkpoints")return json({checkpoints:[{title:"model-a"}],activeCheckpoint:"model-a"});if(p==="/api/checkpoints/select")return json({checkpoint:"model-a"});
 if(p==="/api/samplers")return json({samplers:["Euler"],schedulers:["Automatic"]});if(p==="/api/loras")return json({loras:[]});
 if(p==="/api/history")return json({generations:records,total:records.length,hasMore:false});
 if(p==="/api/jobs"&&request.method()==="POST"){const body=request.postDataJSON();requests.push(body);serial++;record={...body,runtime,images:[{id:`image-000${serial}`,seed:17,imageUrl:`/outputs/${serial}.svg`}]};records.unshift(record);return json({job:{id:`job-${serial}`,status:"queued"}});}
 if(p.startsWith("/api/jobs/"))return json({job:{id:`job-${serial}`,status:"done",result:record}});
 if(p==="/api/reforge/ip-adapter/options")return json({available:true,message:"Available",family:"sdxl"});
 if(p==="/api/checkpoint-lora-sets"){if(request.method()==="POST")sets.push({...request.postDataJSON(),id:"set-1"});return json({sets});}
 if(p==="/api/experiments"){if(request.method()==="POST"){requests.push(request.postDataJSON());experiments=[{id:"experiment-1",name:"Study",status:"running"}];}return json({experiments,parameters:{steps:{label:"Steps",kind:"integer"},cfgScale:{label:"CFG",kind:"number"}}});}
 if(p.endsWith("/cancel")){experiments[0].status="cancelled";return json({experiment:experiments[0]});}
 if(p==="/api/comparisons"){comparisons.push(request.postDataJSON());return json({comparison:comparisons.at(-1)});}
 if(p==="/api/civitai/auth-status")return json({configured:true});
 if(p==="/api/civitai/install"){assert.equal(Object.hasOwn(request.postDataJSON(),"token"),false);return json({ok:true});}
 if(p==="/api/civitai/inspect")return json({metadata:{modelName:"Fixture LoRA",versionName:"Anima V1",modelType:"LORA",baseModel:"Anima",trainedWords:["chosen style 3"],recommendedWeight:0.75,recommendedWeightSource:"fallback",previewUrl:"https://image.civitai.com/fixture-preview.svg",sourceUrl:"https://civitai.com/models/1",file:{name:"fixture.safetensors",sizeKB:179323}}});
 return json({});
});
await mkdir("workbench/r6",{recursive:true});
const tools=async tab=>{await page.getByRole("button",{name:"Tools",exact:true}).click();await page.getByRole("navigation",{name:"Creation tools tabs"}).getByRole("button",{name:tab,exact:true}).click();};
const done=()=>page.waitForFunction(()=>document.querySelector(".canvas-stage").dataset.state==="completed");
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/studio-next/`);await page.waitForFunction(()=>!document.querySelector(".prompt-open").disabled);
 await page.getByRole("button",{name:"Structured · 編集",exact:true}).click();await page.getByRole("textbox",{name:"キャラクター",exact:true}).fill("ceramic teapot");await page.keyboard.press("Escape");
 await page.getByRole("button",{name:"Generate",exact:true}).click();await done();await tools("Reference");await page.getByRole("button",{name:"Canvasで編集 / Inpaint",exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.inpaint-surface img').complete&&document.querySelector('.inpaint-surface img').naturalWidth>0);
 await page.getByRole("button",{name:"全体をMask",exact:true}).click();await page.screenshot({path:"workbench/r6/inpaint-1440.png",animations:"disabled"});await page.getByRole("button",{name:"Generate",exact:true}).click();await page.waitForFunction(()=>!document.querySelector(".generate-action").textContent.includes("Cancel"));
 assert.equal(requests[1].mode,"inpaint");assert.ok(requests[1].maskImage.startsWith("data:image/png"));assert.equal(requests[1].initImageId,"image-0001");
 await page.getByRole("button",{name:"Resultへ戻る",exact:true}).click();await tools("Hires");await page.getByRole("spinbutton",{name:"Hires scale",exact:true}).fill("1.5");await page.getByRole("spinbutton",{name:"Hires scale",exact:true}).press("Tab");
 await page.getByRole("button",{name:"Current resultをHiresで仕上げる",exact:true}).click();await done();
 assert.equal(requests[2].settings.hiresEnabled,true);await page.keyboard.press("Escape");await tools("Reference");await page.getByRole("button",{name:"Current resultをReferenceに使用",exact:true}).click();await page.keyboard.press("Escape");
 await page.getByRole("button",{name:"Generate",exact:true}).click();await done();assert.equal(requests[3].ipAdapter.enabled,true);
 await tools("Experiments");await page.getByRole("button",{name:"Experimentを開始",exact:true}).click();await page.getByRole("button",{name:"Cancel experiment",exact:true}).click();assert.equal(requests.at(-1).baseRequest.prompt,"ceramic teapot");
 await page.getByRole("navigation",{name:"Creation tools tabs"}).getByRole("button",{name:"Civitai",exact:true}).click();await page.getByRole("textbox",{name:"Civitai URL"}).fill("https://civitai.com/models/1");await page.getByRole("button",{name:"Metadataを確認",exact:true}).click();await page.getByRole("heading",{name:"Fixture LoRA",exact:true}).waitFor();
 await page.getByText("chosen style 3",{exact:true}).waitFor();
 await page.getByText("APIキー設定済み · サーバーの.envから自動使用します",{exact:true}).waitFor();
 await page.getByRole("button",{name:"このLoRAをインストール",exact:true}).click();
 await page.getByText("インストール完了。LoRA Browserから選択して使えます。ページの再読み込みは不要です。",{exact:true}).waitFor();
 for(const width of [1440,390,430]){
  await page.setViewportSize({width,height:900});
  await page.locator('.civitai-model-preview').scrollIntoViewIfNeeded();
  assert.ok(await page.locator('.creation-tools').evaluate(n=>n.scrollWidth<=n.clientWidth));
  await page.screenshot({path:`workbench/r6/civitai-metadata-${width}.png`,animations:'disabled'});
 }
 await page.setViewportSize({width:1440,height:900});await page.keyboard.press("Escape");
 await page.getByRole("button",{name:"Library",exact:true}).click();await page.locator(".image-library-grid .library-image").last().click();await page.getByRole("button",{name:"Compare",exact:true}).click();await page.getByRole("button",{name:"Aを選ぶ",exact:true}).click();await page.getByText("比較結果を保存しました。",{exact:true}).waitFor();assert.equal(comparisons[0].result,"a");assert.equal(comparisons[0].winnerImageId,comparisons[0].imageIds[0]);await page.keyboard.press("Escape");await page.keyboard.press("Escape");await page.getByRole("button",{name:"Studio",exact:true}).click();
 const before=requests.length;await page.reload();await page.waitForFunction(()=>!document.querySelector(".prompt-open").disabled);assert.equal(requests.length,before);assert.equal(await page.locator(".canvas-stage").getAttribute("data-state"),"completed");
 for(const [width,height]of [[390,844],[430,932]]){await page.setViewportSize({width,height});await tools("Hires");await page.screenshot({path:`workbench/r6/advanced-${width}.png`,animations:"disabled"});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.keyboard.press("Escape");}
 assert.deepEqual(errors,[]);console.log("R6 Advanced and reload browser PASS");
}finally{await browser.close();await new Promise(done=>server.close(done));}
