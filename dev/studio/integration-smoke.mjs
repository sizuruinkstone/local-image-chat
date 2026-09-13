import {createRequire} from "node:module";
import {once} from "node:events";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import {createStudioDevServer} from "./server.mjs";
import {createPreviewTransport} from "./fixture-transport.js";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.LIC_PLAYWRIGHT_MODULE || path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const server=createStudioDevServer();server.listen(0,"127.0.0.1");await once(server,"listening");
const origin=`http://127.0.0.1:${server.address().port}`;
const output=path.resolve("workbench/r3");await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:"chrome"});const page=await browser.newPage({viewport:{width:1440,height:900}});
const fixture=createPreviewTransport();const svg=await readFile("dev/studio/study.svg","utf8");
const requests=[],errors=[],unexpected=[],measurements=[];
let failConfig=false;
let status="queued",serial=0,current=null,recovery=false,failModel=false,unavailable=false,postDelay=0;
const runtime={id:"forge-neo-anima",label:"Anima · integration",provider:"forge-neo",available:true,ok:true,features:{txt2img:true}};
function job(){return {id:`job-${serial}`,status,progress:status==="queued"?0:status==="done"?100:40,message:status,
 error:status==="failed"?"Integration generation failure":undefined,recovery:recovery?{kind:"memory",label:"Lower resolution",settings:{width:512,height:512}}:undefined,
 result:status==="done"?{...current,runtime,images:[{id:`image-${serial}-1`,seed:101,imageUrl:"/outputs/test-a.svg"},{id:`image-${serial}-2`,seed:102,imageUrl:"/outputs/test-b.svg"}]}:undefined};}
page.on("pageerror",e=>errors.push(e.message));
page.on("requestfailed",r=>unexpected.push(r.url()));
await page.route("**/outputs/test-*.svg",route=>route.fulfill({contentType:"image/svg+xml",body:route.request().url().endsWith("test-a.svg") ? svg.replace('width="1440" height="1024" viewBox="0 0 1440 1024"','width="768" height="1024" viewBox="336 0 768 1024"') : svg}));
await page.route("**/api/**",async route=>{
 const req=route.request(),url=new URL(req.url()),p=url.pathname;
 const json=(data,code=200)=>route.fulfill({status:code,contentType:"application/json",body:JSON.stringify(data)});
 if(p==="/api/history")return json({generations:[{id:"recent-study",title:"Recent study",runtime,settings:{width:768,height:1024},prompt:"ceramic study",images:[{id:"recent-a",seed:99,imageUrl:"/outputs/test-a.svg"},{id:"recent-b",seed:100,imageUrl:"/outputs/test-b.svg"}]}],total:2,hasMore:false});
 if(p==="/api/config" && failConfig)return json({error:"Integration backend unavailable"},503);
 if(p==="/api/runtimes")return json({runtimes:[{id:"reforge",label:"ReForge",available:false,ok:false,features:{txt2img:true}},{...runtime,available:!unavailable,ok:!unavailable}],defaultRuntimeId:runtime.id});
 if(p==="/api/checkpoints")return json({checkpoints:[{title:"model-a",modelName:"Model A"},{title:"model-b",modelName:"Model B"}],activeCheckpoint:"model-a"});
 if(p==="/api/checkpoints/select")return failModel?json({error:"Model selection failed"},503):json({checkpoint:req.postDataJSON().checkpoint});
 if(p==="/api/samplers")return json({samplers:["Euler","DPM++ 2M"],schedulers:["Automatic","Karras"]});
 if(p==="/api/jobs"&&req.method()==="POST"){
  current=req.postDataJSON();requests.push(current);serial++;status="queued";
  if(postDelay)await new Promise(done=>setTimeout(done,postDelay));return json({job:job()});
 }
 if(p.startsWith("/api/jobs/")){if(req.method()==="DELETE")status="cancelled";return json({job:job()});}
 try{return json(await fixture.getJson(url.href));}catch{return json({error:"Missing fixture"},404);}
});
const waitPhase=phase=>page.waitForFunction(value=>document.querySelector(".canvas-stage").dataset.state===value,phase);
const closeDialog=()=>page.getByRole("dialog").getByRole("button",{name:"閉じる",exact:true}).click();
const shot=name=>page.screenshot({animations:"disabled",path:path.join(output,name+".png")});
try{
 await page.goto(origin+"/studio-next/");await page.waitForFunction(()=>!document.querySelector(".prompt-open").disabled);
 assert.equal(await page.locator(".preview-select").isVisible(),false);
 await page.getByRole("button",{name:"Structured · 編集",exact:true}).click();
 await page.getByRole("textbox",{name:"キャラクター",exact:true}).fill("teapot, <lora:Soft light:0.65>");
 await page.getByRole("textbox",{name:"Negative Prompt",exact:true}).fill("blur");
 const preview=await page.getByRole("textbox",{name:"Final Positive Prompt",exact:true}).inputValue();
 await page.keyboard.press("Escape");
 await page.locator(".model-summary").click();await page.getByRole("searchbox",{name:"Model search"}).fill("Model B");
 failModel=true;await page.getByRole("button",{name:"Model B",exact:true}).click();
 await page.getByRole("dialog",{name:"Model Picker",exact:true}).getByText("Model selection failed",{exact:true}).waitFor();
 assert.ok((await page.locator(".model-current").textContent()).includes("Model A"));
 failModel=false;await page.getByRole("button",{name:"Model B",exact:true}).click();
 await page.waitForFunction(()=>document.querySelector(".model-current").textContent.includes("Model B"));
 await shot("model-picker-1440");await closeDialog();
 await page.locator(".resolution-summary").click();await page.getByRole("button",{name:"Portrait · 896 × 1152",exact:true}).click();
 await page.getByRole("dialog",{name:"制作設定",exact:true}).getByRole("spinbutton",{name:"Seed",exact:true}).fill("321");await page.getByRole("dialog",{name:"制作設定",exact:true}).getByRole("spinbutton",{name:"Seed",exact:true}).press("Tab");
 await page.getByRole("combobox",{name:"Candidates",exact:true}).selectOption("2");
 await page.getByRole("spinbutton",{name:"Soft light weight",exact:true}).fill("0.8");await page.getByRole("spinbutton",{name:"Soft light weight",exact:true}).press("Tab");
 await page.getByRole("button",{name:"Soft light Disable",exact:true}).click();await page.getByRole("button",{name:"Soft light Enable",exact:true}).click();
 await shot("primary-settings-1440");await closeDialog();
 if (page.viewportSize().width<=900) await page.getByRole("button",{name:"制作設定",exact:true}).click();
 await page.getByRole("combobox",{name:"Sampler",exact:true}).selectOption("DPM++ 2M");await page.getByRole("combobox",{name:"Scheduler",exact:true}).selectOption("Karras");
 await page.getByRole("spinbutton",{name:"Steps",exact:true}).fill("18");await page.getByRole("spinbutton",{name:"Steps",exact:true}).press("Tab");
 await page.getByRole("spinbutton",{name:"CFG",exact:true}).fill("5.5");await page.getByRole("spinbutton",{name:"CFG",exact:true}).press("Tab");
 await shot("inspector-draft-1440");await page.keyboard.press("Escape");
 await page.getByRole("button",{name:/^(Structured|Raw) · 編集$/,exact:true}).click();const final=await page.getByRole("textbox",{name:"Final Positive Prompt",exact:true}).inputValue();await page.keyboard.press("Escape");
 const beforeRecentSeed=await page.locator(".seed-summary").textContent();
 await page.locator(".studio-recent-strip").getByRole("button",{name:"View image recent-b",exact:true}).click();
 assert.ok((await page.locator(".artwork").getAttribute("src")).includes("test-b.svg"));
 assert.equal(await page.getByRole("dialog").count(),0);
 assert.equal(await page.locator(".seed-summary").textContent(),beforeRecentSeed);
 await shot("recent-canvas-1440");
 await page.getByRole("button",{name:"NSFW",exact:true}).click();
 assert.equal(await page.getByRole("button",{name:"NSFW",exact:true}).getAttribute("aria-pressed"),"true");
 postDelay=250;await page.getByRole("button",{name:"Generate",exact:true}).click();await waitPhase("submitting");
 await page.locator(".generate-action").evaluate(node=>node.click());assert.equal(requests.length,1);
 await waitPhase("queued");status="running";await waitPhase("generating");
 assert.equal(requests[0].prompt,final);assert.equal(requests[0].negativePrompt,"blur");assert.equal(requests[0].contentRating,"nsfw");assert.equal(requests[0].settings.checkpoint,"model-b");assert.equal(requests[0].settings.seed,321);assert.equal(requests[0].settings.candidateCount,2);assert.equal(requests[0].settings.steps,18);assert.equal(requests[0].settings.cfgScale,5.5);assert.equal(requests[0].settings.scheduler,"Karras");assert.equal(requests[0].loras[0].weight,0.8);
 await shot("integration-generating-1440");status="done";await waitPhase("completed");await shot("integration-completed-1440");
 const draftSeed=await page.locator(".seed-summary").textContent();
 await page.getByRole("button",{name:"画像を拡大",exact:true}).click();
 const fullscreen=page.getByRole("dialog",{name:"画像の全画面表示",exact:true});await fullscreen.waitFor();
 assert.ok((await fullscreen.locator("img").getAttribute("src")).includes("test-a.svg"));
 await page.screenshot({path:path.join(output,"canvas-image-fullscreen.png"),animations:"disabled"});
 await fullscreen.getByRole("button",{name:"閉じる",exact:true}).click();
 assert.equal(await page.locator(".seed-summary").textContent(),draftSeed);
 await page.getByRole("button",{name:"画像を拡大",exact:true}).focus();await page.keyboard.press("Enter");await fullscreen.waitFor();
 await fullscreen.getByRole("button",{name:"閉じる",exact:true}).click();
 await page.getByRole("button",{name:"Image Viewer",exact:true}).click();
 const viewer=page.getByRole("dialog",{name:"Image Viewer",exact:true});await viewer.waitFor();
 assert.ok((await viewer.locator(".viewer-image").getAttribute("src")).includes("test-a.svg"));
 await page.keyboard.press("Escape");
 assert.equal(await page.locator(".canvas-view-controls").getByRole("button",{name:"Fit",exact:true}).count(),0);
 assert.equal(await page.locator(".canvas-view-controls").getByRole("button",{name:/Zoom/}).count(),0);

 await page.getByRole("button",{name:"Next candidate",exact:true}).click();assert.equal(await page.locator(".canvas-candidates > span").textContent(),"2 / 2");
 if (page.viewportSize().width<=900) await page.getByRole("button",{name:"制作設定",exact:true}).click();await page.getByRole("button",{name:"Result Metadata",exact:true}).click();assert.equal(await page.locator(".inspector-result .metadata-values > div").filter({has:page.getByText("Seed",{exact:true})}).locator("dd").textContent(),"102");
 await shot("result-metadata-1440");await page.getByRole("button",{name:"Current Draft",exact:true}).click();assert.equal(await page.getByRole("spinbutton",{name:"Steps",exact:true}).inputValue(),"18");
 await page.getByRole("button",{name:"Result Metadata",exact:true}).click();await page.getByRole("button",{name:"この結果の設定をReuse",exact:true}).click();
 await page.waitForFunction(()=>document.querySelector(".seed-summary").textContent.includes("102"));await page.keyboard.press("Escape");
 // Raw submission and cancellation retain the previous selected result.
 await page.getByRole("button",{name:"Structured · 編集",exact:true}).click();await page.getByRole("button",{name:"Raw",exact:true}).click();await page.getByRole("textbox",{name:"Raw Prompt",exact:true}).fill("raw teapot");await page.keyboard.press("Escape");
 await page.getByRole("button",{name:"Generate",exact:true}).click();await waitPhase("queued");assert.equal(requests.at(-1).prompt,"raw teapot");await page.getByRole("button",{name:"Cancel",exact:true}).click();await waitPhase("cancelled");assert.ok(await page.locator(".artwork").isVisible());
 // Explicit recovery approval is required before a retry request.
 await page.getByRole("button",{name:"Generate",exact:true}).click();await waitPhase("queued");recovery=true;status="failed";
 await page.getByRole("dialog",{name:"Recovery approval",exact:true}).waitFor();const before=requests.length;await page.waitForTimeout(100);assert.equal(requests.length,before);
 await shot("recovery-1440");await page.getByRole("button",{name:"変更を承認して再送",exact:true}).click();await waitPhase("queued");recovery=false;assert.equal(requests.length,before+1);assert.equal(requests.at(-1).settings.width,512);status="done";await waitPhase("completed");
 await page.getByRole("button",{name:"Generate",exact:true}).click();await waitPhase("queued");status="failed";await waitPhase("error");assert.ok(await page.locator(".artwork").isVisible());
 for(const [width,height]of [[390,844],[430,932]]){
  await page.setViewportSize({width,height});
  const controlLayout=await page.evaluate(()=>{const actions=document.querySelector(".prompt-generation-actions").getBoundingClientRect(),summary=[...document.querySelectorAll(".prompt-summary-grid,.raw-summary")].find(node=>!node.hidden).getBoundingClientRect();return {actions:{left:actions.left,top:actions.top,right:actions.right,bottom:actions.bottom},summary:{left:summary.left,top:summary.top,right:summary.right,bottom:summary.bottom}};});
  const controlsDoNotOverlap=controlLayout.summary.right<=controlLayout.actions.left+1||controlLayout.summary.bottom<=controlLayout.actions.top+1||controlLayout.actions.bottom<=controlLayout.summary.top+1;assert.equal(controlsDoNotOverlap,true,JSON.stringify(controlLayout));
  await page.getByRole("button",{name:"Recent",exact:true}).click();
  await page.getByRole("dialog",{name:"Recent generations",exact:true}).getByRole("button",{name:"View image recent-b",exact:true}).click();
  assert.equal(await page.getByRole("dialog").count(),0);
  assert.ok((await page.locator(".artwork").getAttribute("src")).includes("test-b.svg"));
  await page.getByRole("button",{name:"Image Viewer",exact:true}).click();
  assert.ok((await viewer.locator(".viewer-image").getAttribute("src")).includes("test-b.svg"));await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"画像を拡大",exact:true}).click();await fullscreen.waitFor();
  await shot(`fullscreen-${width}`);await fullscreen.getByRole("button",{name:"閉じる",exact:true}).click();
  await page.locator(".model-summary").click();await shot(`model-picker-${width}`);await closeDialog();
  await page.getByRole("button",{name:"Raw · 編集",exact:true}).click();await page.getByRole("textbox",{name:"Raw Prompt",exact:true}).fill("raw teapot, <lora:Soft light:0.8>");await page.keyboard.press("Escape");
  await page.locator(".seed-summary").click();await page.getByRole("spinbutton",{name:"Soft light weight",exact:true}).waitFor();await shot(`active-lora-${width}`);if(await page.getByRole("button",{name:"Soft light Remove",exact:true}).count()){await page.getByRole("button",{name:"Soft light Remove",exact:true}).click();assert.equal(await page.getByRole("button",{name:"Soft light Remove",exact:true}).count(),0);}await closeDialog();
  if (page.viewportSize().width<=900) await page.getByRole("button",{name:"制作設定",exact:true}).click();await shot(`inspector-${width}`);await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Raw · 編集",exact:true}).click();await page.getByRole("textbox",{name:"Raw Prompt",exact:true}).fill(`mobile raw ${width}`);
  await page.setViewportSize({width,height:440});await page.getByRole("textbox",{name:"Raw Prompt",exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.locator(".prompt-workspace").evaluate(n=>n.scrollWidth<=n.clientWidth),true);
  await page.keyboard.press("Escape");await page.setViewportSize({width,height});
  await page.getByRole("button",{name:"Generate",exact:true}).click();await waitPhase("queued");await page.getByRole("button",{name:"Cancel",exact:true}).click();await waitPhase("cancelled");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 for(const [width,height,canvasHeight,dockHeight]of [[1280,900,624,178],[1440,900,624,178],[1920,1080,782,196],[390,844,496,202],[430,932,584,202]]){
  await page.setViewportSize({width,height});
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const size=await page.evaluate(()=>({width:innerWidth,canvas:document.querySelector(".canvas-stage").getBoundingClientRect().height,dock:document.querySelector(".prompt-dock").getBoundingClientRect().height}));
  assert.ok(size.canvas>=canvasHeight);if(width<=900)assert.equal(size.dock,dockHeight);
  if(width>900){
    const rail=await page.locator(".prompt-dock").boundingBox(),canvas=await page.locator(".canvas-stage").boundingBox();
    assert.ok(rail.x+rail.width<=canvas.x+1);assert.ok(await page.locator(".studio-recent-strip").isVisible());
    const recent=await page.locator(".studio-recent-strip").boundingBox();assert.ok(recent.x>=canvas.x+canvas.width-1);
  }measurements.push(size);
 }
 unavailable=true;await page.reload();await page.waitForFunction(()=>!document.querySelector(".prompt-open").disabled);
 assert.equal(await page.getByRole("button",{name:"Generate",exact:true}).isDisabled(),true);
 await page.locator(".model-summary").click();await page.getByRole("dialog",{name:"Model Picker",exact:true}).getByText("Runtime unavailable",{exact:true}).waitFor();await closeDialog();
 unavailable=false;failConfig=true;await page.reload();await page.locator(".connection-error").getByText("Integration backend unavailable",{exact:true}).waitFor();
 failConfig=false;await page.locator(".connection-error").getByRole("button",{name:"接続を再確認",exact:true}).click();await page.waitForFunction(()=>!document.querySelector(".prompt-open").disabled);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  await page.getByRole("button",{name:"Import Prompt",exact:true}).click();
  await page.getByRole("textbox",{name:"Import text",exact:true}).fill("Character: imported teapot\nStyle: watercolor\nNegative Prompt: blur");
  assert.equal(await page.getByRole("textbox",{name:"Import preview",exact:true}).inputValue(),"imported teapot, watercolor");
  await page.screenshot({path:path.join(output,`prompt-import-${width}.png`),animations:"disabled"});
  await page.getByRole("button",{name:"Promptを取り込む",exact:true}).click();
  await page.getByRole("button",{name:"Structured · 編集",exact:true}).click();
  assert.equal(await page.getByRole("textbox",{name:"キャラクター",exact:true}).inputValue(),"imported teapot");
  assert.equal(await page.getByRole("textbox",{name:"Negative Prompt",exact:true}).inputValue(),"blur");
  await page.keyboard.press("Escape");
 }
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 await writeFile(path.join(output,"integration-report.json"),JSON.stringify({result:"PASS",requests:requests.length,errors,unexpected,expectedModelFailure:503,expectedBackendFailure:503,measurements,checks:["Structured/Raw/Negative request","settings","double submit","candidate/reuse","cancel","failure","recovery approval","mobile/keyboard-height"]},null,2));
 console.log("R3 integration browser PASS");
}catch(e){await shot("integration-failure");throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
