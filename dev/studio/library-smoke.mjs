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
const records=Array.from({length:85},(_,i)=>({id:`generation-${i}`,title:`Study ${i}`,prompt:i===84?"rare watercolor":"ceramic study",negativePrompt:"blur",settings:{width:768,height:768,steps:16},runtime:{id:"forge-neo-anima"},images:[{id:`image-000${i}`,seed:i,imageUrl:`/outputs/${i}.svg`,thumbnailUrl:`/outputs/${i}.svg`}]}));
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/outputs/*.svg",r=>r.fulfill({contentType:"image/svg+xml",body:svg}));
await page.route("**/api/**",async route=>{const url=new URL(route.request().url()),p=url.pathname;const json=d=>route.fulfill({contentType:"application/json",body:JSON.stringify(d)});
 if(p==="/api/history") {let rows=records.filter(r=>(r.title+" "+r.prompt).includes(url.searchParams.get("search")||""));if(url.searchParams.get("sort")==="oldest")rows=[...rows].reverse();const offset=url.searchParams.has("cursor")?rows.findIndex(r=>r.images[0].id===url.searchParams.get("cursor"))+1:0;const size=Number(url.searchParams.get("limit")||20),part=rows.slice(offset,offset+size);return json({generations:part,total:rows.length,hasMore:offset+size<rows.length,nextCursor:part.at(-1)?.images[0].id});}
 if(p.endsWith("/recipe")){const r=records.find(r=>r.images[0].id===p.split("/")[3]);return json({...r,selectedImage:r.images[0]});}
 return json(await fixture.getJson(url.href));
});
await mkdir("workbench/r5",{recursive:true});
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/studio-next/`);await page.waitForFunction(()=>!document.querySelector(".prompt-open").disabled);
 await page.getByRole("button",{name:"Library",exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll(".image-library-grid .library-image").length===40);
 await page.getByRole("button",{name:"さらに読み込む",exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll(".image-library-grid .library-image").length===80);
 await page.getByRole("searchbox",{name:"Search all history"}).fill("rare");await page.waitForFunction(()=>document.querySelectorAll(".image-library-grid .library-image").length===1);
 await page.getByRole("button",{name:"View image image-00084",exact:true}).click();await page.getByRole("button",{name:"Zoom +",exact:true}).click();await page.getByRole("dialog",{name:"Image Viewer"}).getByRole("button",{name:"Fit",exact:true}).click();
 await page.getByRole("button",{name:"Reuse settings → Studio",exact:true}).click();await page.getByRole("button",{name:"Raw · 編集",exact:true}).waitFor();await page.getByRole("button",{name:"Raw · 編集",exact:true}).click();assert.equal(await page.getByRole("textbox",{name:"Raw Prompt",exact:true}).inputValue(),"rare watercolor");await page.keyboard.press("Escape");
 await page.getByRole("button",{name:"Library",exact:true}).click();assert.equal(await page.getByRole("searchbox",{name:"Search all history"}).inputValue(),"rare");await page.getByRole("searchbox",{name:"Search all history"}).fill("");await page.getByRole("combobox",{name:"History sort"}).selectOption("oldest");await page.waitForFunction(()=>document.querySelectorAll(".image-library-grid .library-image").length===40);
 assert.equal(await page.locator(".image-library-grid button").first().getAttribute("aria-label"),"View image image-00084");
 for(const [width,height]of [[1280,900],[1440,900],[1920,1080],[390,844],[430,932]]){
  await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`workbench/r5/library-${width}.png`,animations:"disabled"});
  await page.locator(".image-library-grid button").first().click();await page.getByRole("button",{name:"Next",exact:true}).click();await page.screenshot({path:`workbench/r5/viewer-${width}.png`,animations:"disabled"});await page.keyboard.press("Escape");
 }
 assert.deepEqual(errors,[]);console.log("R5 Library browser PASS");
}finally{await browser.close();await new Promise(done=>server.close(done));}
