import {createRequire} from "node:module";
import {once} from "node:events";
import {readFile,mkdir} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import {createStudioDevServer} from "./server.mjs";
import {createPreviewTransport} from "./fixture-transport.js";
const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const server=createStudioDevServer();server.listen(0,"127.0.0.1");await once(server,"listening");
const browser=await chromium.launch({channel:"chrome",headless:true}),page=await browser.newPage({viewport:{width:1440,height:900}});
const fixture=createPreviewTransport(),svg=await readFile("dev/studio/study.svg","utf8"),errors=[];
const records=Array.from({length:85},(_,i)=>({id:`generation-${i}`,title:`Study ${i}`,contentRating:i%2?"nsfw":"general",prompt:i===84?"rare watercolor":"ceramic study",negativePrompt:"blur",...(i===84?{structuredPrompt:{character:"ceramic figure",style:"rare watercolor"},rawPromptOverride:false}:{}),settings:{checkpointModelName:"Anima · Studio model",width:768,height:768,steps:16,cfgScale:5.5,samplerName:"Euler",scheduler:"normal"},runtime:{id:"forge-neo-anima"},images:[{id:`image-000${i}`,seed:i,imageUrl:`/outputs/${i}.svg`,thumbnailUrl:`/outputs/${i}.svg`}]}));
let holdRatingPatch=false,releaseRatingPatch=()=>{},announceRatingPatch;
const ratingPatchStarted=new Promise(resolve=>{announceRatingPatch=resolve;});
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/outputs/*.svg",r=>r.fulfill({contentType:"image/svg+xml",body:svg}));
await page.route("**/api/**",async route=>{const url=new URL(route.request().url()),p=url.pathname;const json=d=>route.fulfill({contentType:"application/json",body:JSON.stringify(d)});
 if(p==="/api/history"&&route.request().method()==="GET") {let rows=records.filter(r=>(r.title+" "+r.prompt).includes(url.searchParams.get("search")||""));const rating=url.searchParams.get("rating");if(rating)rows=rows.filter(r=>r.contentRating===rating);if(url.searchParams.get("sort")==="oldest")rows=[...rows].reverse();const offset=url.searchParams.has("cursor")?rows.findIndex(r=>r.images[0].id===url.searchParams.get("cursor"))+1:0;const size=Number(url.searchParams.get("limit")||20),part=rows.slice(offset,offset+size);return json({generations:part,total:rows.length,hasMore:offset+size<rows.length,nextCursor:part.at(-1)?.images[0].id});}
 if(/^\/api\/history\/[^/]+\/content-rating$/.test(p)&&route.request().method()==="PATCH") {const imageId=p.split("/")[3],record=records.find(r=>r.images.some(image=>image.id===imageId));if(holdRatingPatch){announceRatingPatch();await new Promise(resolve=>{releaseRatingPatch=resolve;});}record.contentRating=route.request().postDataJSON().contentRating;return json({contentRating:record.contentRating});}
 if(p.endsWith("/recipe")){const r=records.find(r=>r.images[0].id===p.split("/")[3]);return json({...r,selectedImage:r.images[0]});}
 return json(await fixture.getJson(url.href));
});
await mkdir("workbench/r5",{recursive:true});
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/studio-next/`);await page.waitForFunction(()=>!document.querySelector(".prompt-open").disabled);
 await page.getByRole("button",{name:"Library",exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll(".image-library-grid .library-image").length===40);
 const libraryRating=page.getByRole("group",{name:"コンテンツ分類",exact:true});
 assert.equal(await libraryRating.getByRole("button",{name:"一般",exact:true}).getAttribute("aria-pressed"),"true");
 assert.equal(await libraryRating.getByRole("button").count(),2);
 await libraryRating.getByRole("button",{name:"NSFW",exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll(".image-library-grid .library-image").length===40);
 assert.equal(await libraryRating.getByRole("button",{name:"NSFW",exact:true}).getAttribute("aria-pressed"),"true");
  assert.equal(await page.locator('.image-library-grid .library-rating-badge[data-rating="nsfw"]').count(),40);
 await page.locator(".image-library-grid button").first().click();const viewerRating=page.getByRole("group",{name:"選択画像のコンテンツ分類",exact:true});await viewerRating.getByRole("button",{name:"一般",exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.library-viewer [aria-label="選択画像のコンテンツ分類"] button')].every(button=>!button.disabled));assert.equal(records[1].contentRating,"general");await page.keyboard.press("Escape");
 await libraryRating.getByRole("button",{name:"一般",exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll(".image-library-grid .library-image").length===40);
 const cachedId="View image image-0001";assert.equal(await page.getByRole("button",{name:cachedId,exact:true}).getAttribute("data-content-rating"),"general");await page.getByRole("button",{name:cachedId,exact:true}).click();
 await viewerRating.getByRole("button",{name:"NSFW",exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('.library-viewer [aria-label="選択画像のコンテンツ分類"] button')].every(button=>!button.disabled));await page.keyboard.press("Escape");
 await libraryRating.getByRole("button",{name:"NSFW",exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll(".image-library-grid .library-image").length===40);assert.equal(await page.getByRole("button",{name:cachedId,exact:true}).getAttribute("data-content-rating"),"nsfw");
 await libraryRating.getByRole("button",{name:"一般",exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll(".image-library-grid .library-image").length===40);
 await page.getByRole("button",{name:"View image image-0000",exact:true}).click();holdRatingPatch=true;await viewerRating.getByRole("button",{name:"NSFW",exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('.library-viewer [aria-label="選択画像のコンテンツ分類"] button')].every(button=>button.disabled));await ratingPatchStarted;
 await page.getByRole("button",{name:"Next",exact:true}).click();releaseRatingPatch();holdRatingPatch=false;await page.waitForFunction(()=>[...document.querySelectorAll('.library-viewer [aria-label="選択画像のコンテンツ分類"] button')].every(button=>!button.disabled));
 assert.equal(records[0].contentRating,"nsfw");assert.equal(await viewerRating.getByRole("button",{name:"一般",exact:true}).getAttribute("aria-pressed"),"true");await page.keyboard.press("Escape");
 await page.getByRole("button",{name:"さらに読み込む",exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll(".image-library-grid .library-image").length===42);
 await page.getByRole("searchbox",{name:"Search all history"}).fill("rare");await page.waitForFunction(()=>document.querySelectorAll(".image-library-grid .library-image").length===1);
 await page.getByRole("button",{name:"View image image-00084",exact:true}).click();await page.getByRole("button",{name:"Zoom +",exact:true}).click();await page.getByRole("dialog",{name:"Image Viewer"}).getByRole("button",{name:"Fit",exact:true}).click();
 assert.equal(await page.locator(".viewer-controls").getByRole("button",{name:"Studioで再利用",exact:true}).isVisible(),true);assert.equal(await page.locator(".library-viewer .readable-metadata details").filter({has:page.getByText("Raw Metadata",{exact:true})}).getAttribute("open"),null);
 await page.evaluate(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{window.copiedMetadata=text;}}}));
 const structuredDisplay="キャラクター: ceramic figure\n画風・品質: rare watercolor";
 assert.equal(await page.locator(".library-viewer .metadata-prompt").first().textContent(),structuredDisplay);
 await page.getByRole("button",{name:"Promptをコピー",exact:true}).click();assert.equal(await page.evaluate(()=>window.copiedMetadata),structuredDisplay);
 await page.getByRole("button",{name:"生成情報をコピー",exact:true}).click();const copied=await page.evaluate(()=>window.copiedMetadata);assert.ok(copied.includes("Sampler: Euler"));assert.ok(copied.includes(structuredDisplay));
 await page.getByRole("button",{name:"Studioで再利用",exact:true}).click();await page.getByRole("button",{name:"Structured · 編集",exact:true}).waitFor();await page.getByRole("button",{name:"Structured · 編集",exact:true}).click();assert.equal(await page.getByRole("textbox",{name:"キャラクター",exact:true}).inputValue(),"ceramic figure");assert.equal(await page.getByRole("textbox",{name:"画風・品質",exact:true}).inputValue(),"rare watercolor");await page.keyboard.press("Escape");
 await page.getByRole("button",{name:"Library",exact:true}).click();assert.equal(await page.getByRole("searchbox",{name:"Search all history"}).inputValue(),"rare");await page.getByRole("searchbox",{name:"Search all history"}).fill("");await page.getByRole("combobox",{name:"History sort"}).selectOption("oldest");await page.waitForFunction(()=>document.querySelectorAll(".image-library-grid .library-image").length===40);
 assert.equal(await page.locator(".image-library-grid button").first().getAttribute("aria-label"),"View image image-00084");
 for(const [width,height]of [[1280,900],[1440,900],[1920,1080],[390,844],[430,932]]){
  await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Library width ${width}: ${JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll("body *")].filter(n=>n.getBoundingClientRect().right>innerWidth+1&&n.checkVisibility()).map(n=>({class:n.className,right:n.getBoundingClientRect().right})).slice(0,12)))}`);await page.screenshot({path:`workbench/r5/library-${width}.png`,animations:"disabled"});
  await page.locator(".image-library-grid button").first().click();await page.getByRole("button",{name:"Next",exact:true}).click();await page.screenshot({path:`workbench/r5/viewer-${width}.png`,animations:"disabled"});await page.keyboard.press("Escape");
 }
 assert.deepEqual(errors,[]);console.log("R5 Library browser PASS");
}finally{await browser.close();await new Promise(done=>server.close(done));}
