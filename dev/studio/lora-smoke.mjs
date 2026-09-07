import {createRequire} from "node:module";
import {once} from "node:events";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import {createStudioDevServer} from "./server.mjs";
import {createPreviewTransport} from "./fixture-transport.js";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.LIC_PLAYWRIGHT_MODULE || path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const server=createStudioDevServer();server.listen(0,"127.0.0.1");await once(server,"listening");
const origin=`http://127.0.0.1:${server.address().port}`;
const output=path.resolve("workbench/r4");await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:"chrome"});const page=await browser.newPage({viewport:{width:1440,height:900}});
const fixture=createPreviewTransport(),svg=await readFile("dev/studio/study.svg","utf8");
const catalog=Array.from({length:144},(_,i)=>({name:`asset-${i}`,displayName:["Soft afternoon","Ink & paper","Quiet geometry","Warm ceramic","Silver morning","Window light"][i%6]+` ${String(i+1).padStart(2,"0")}`,
 folder:i<72?"Anima/Style":"Anima/Character",registry:{uid:`uid-${i}`,relativeName:`Anima/${i<72?"Style":"Character"}/asset-${i}.safetensors`,favorite:i%12===0,baseModel:"Anima",triggerWords:`texture-${i}, gentle light`,note:"Integration fixture · catalog metadata",previewUrl:i===1?"":i===2?"/outputs/missing-preview.svg":`/outputs/preview-${i}.svg`}}));
const requests=[],errors=[],metrics=[],favoriteWrites=[];let imageRequests=0,failFavorite=false;
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/outputs/*.svg",async route=>{imageRequests++;if(route.request().url().includes("missing-preview"))return route.fulfill({status:404,body:"missing"});
 const number=Number(/preview-(\d+)/.exec(route.request().url())?.[1]??0);
 const hues=["#bd7651","#758d88","#bda979","#aa827b","#73889a","#979273"];
 return route.fulfill({contentType:"image/svg+xml",body:svg.replaceAll("#ba7351",hues[number%6]).replaceAll("#cd8962",hues[(number+1)%6])});});
await page.route("**/api/**",async route=>{
 const req=route.request(),url=new URL(req.url()),p=url.pathname;
 const json=(data,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(data)});
 if(p==="/api/loras"){await new Promise(done=>setTimeout(done,75));return json({loras:catalog});}
 if(req.method()==="PATCH"){if(failFavorite)return json({error:"Registry unavailable"},503);const item=catalog.find(l=>l.registry.uid===p.split("/").at(-1));Object.assign(item.registry,req.postDataJSON());favoriteWrites.push(req.postDataJSON());return json({entry:item.registry,loras:[{name:"foreign runtime"}]});}
 if(p==="/api/jobs"&&req.method()==="POST"){requests.push(req.postDataJSON());return json({job:{id:"lora-job",status:"queued"}});}
 if(p==="/api/jobs/lora-job")return json({job:{id:"lora-job",status:"done",result:{...requests.at(-1),images:[{id:"lora-image",seed:451,imageUrl:"/outputs/result.svg"}]}}});
 try{return json(await fixture.getJson(url.href));}catch{return json({error:"Missing fixture"},404);}
});
const shot=name=>page.screenshot({path:path.join(output,name+".png"),animations:"disabled"});
const open=async()=>{await page.getByRole("button",{name:"Active LoRA",exact:true}).click();await page.getByRole("searchbox",{name:"Search LoRA"}).waitFor();await page.waitForFunction(()=>!document.querySelector(".lora-browser-notice").textContent);};
const close=()=>page.getByRole("button",{name:"Close LoRA Browser"}).click();
const find=async value=>{await page.getByRole("searchbox",{name:"Search LoRA"}).fill(value);};
const select=async name=>{await page.getByRole("button",{name:new RegExp(`^${name}`)}).first().click();};
const dims=()=>page.evaluate(()=>Object.fromEntries(["canvas-stage","prompt-dock"].map(name=>[name,document.querySelector("."+name).getBoundingClientRect().height])));
try{
 await page.goto(origin+"/studio-next/");await page.waitForFunction(()=>!document.querySelector(".prompt-open").disabled);
 await page.getByRole("button",{name:"Structured · 編集",exact:true}).click();
 await page.getByRole("textbox",{name:"キャラクター",exact:true}).fill("a ceramic teapot");await page.getByRole("textbox",{name:"Negative Prompt",exact:true}).fill("blur");
 const initialPrompt=await page.getByRole("textbox",{name:"Final Positive Prompt",exact:true}).inputValue();await page.keyboard.press("Escape");
 const before=await dims(),start=performance.now();await open();
 metrics.push({operation:"open 144 assets",ms:Math.round(performance.now()-start),rendered:await page.locator(".lora-asset").count()});
 assert.equal(await page.getByRole("searchbox",{name:"Search LoRA"}).evaluate(n=>n===document.activeElement),true);
 await page.locator('.lora-asset .asset-thumbnail[data-state="failed"]').waitFor();
 assert.equal(await page.locator('.lora-asset .asset-thumbnail[data-state="missing"]').count(),1);
 await page.locator('.lora-asset .asset-thumbnail[data-state="ready"]').first().waitFor();
 await shot("browser-overview-1440");assert.equal(await page.locator(".lora-asset").count(),60);
 const folderStart=performance.now();await page.getByRole("navigation",{name:"LoRA folders",exact:true}).getByRole("button",{name:"Anima",exact:true}).click();
 await page.getByRole("button",{name:"Collapse Anima",exact:true}).click();
 assert.equal(await page.getByRole("button",{name:"Anima/Style",exact:true}).isVisible(),false);
 assert.equal(await page.getByLabel("Current LoRA folder",{exact:true}).textContent(),"All LoRA / Anima");
 await page.getByRole("button",{name:"Expand Anima",exact:true}).focus();await page.keyboard.press("Enter");
 await page.getByRole("navigation",{name:"LoRA folders",exact:true}).getByRole("button",{name:"Anima/Style",exact:true}).click();metrics.push({operation:"folder switch",ms:Math.round(performance.now()-folderStart)});
 const searchStart=performance.now();await find("Anima/Character asset-143");assert.equal(await page.locator(".lora-asset").count(),1);metrics.push({operation:"path search",ms:Math.round(performance.now()-searchStart)});
 await find("");await close();assert.deepEqual(await dims(),before);
 assert.equal(await page.getByRole("button",{name:"Active LoRA",exact:true}).evaluate(n=>n===document.activeElement),true);
 await open();assert.equal(await page.getByLabel("Current LoRA folder",{exact:true}).textContent(),"All LoRA / Anima / Style");
 assert.equal(await page.getByLabel("Current LoRA folder",{exact:true}).getByRole("button").count(),0);
 assert.equal(await page.getByRole("navigation",{name:"LoRA folders",exact:true}).getByRole("button",{name:"Anima/Style",exact:true}).getAttribute("aria-current"),"location");
 await find("asset-0");await select("Soft afternoon 01");await page.getByRole("button",{name:"Add to Composition",exact:true}).click();
 assert.equal(await page.getByRole("button",{name:"Active in Composition",exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole("dialog",{name:"LoRA Library"}).isVisible(),true);
 await shot("detail-selected-1440");
 const fav=page.getByRole("button",{name:"★ Favorite",exact:true});failFavorite=true;await fav.click();await page.getByText("Registry unavailable",{exact:true}).waitFor();
 assert.equal(await fav.getAttribute("aria-pressed"),"true");failFavorite=false;await fav.click();await page.getByRole("button",{name:"☆ Favorite",exact:true}).waitFor();
 await page.getByRole("button",{name:"☆ Favorite",exact:true}).click();await page.getByRole("button",{name:"★ Favorite",exact:true}).waitFor();
 await find("");await page.getByRole("button",{name:"☆ Favorites",exact:true}).click();assert.equal(await page.locator(".lora-asset").count(),12);
 await page.getByRole("button",{name:"☆ Favorites",exact:true}).click();assert.equal(await page.locator(".lora-asset").count(),60);
 await page.getByRole("combobox",{name:"Trigger target section"}).selectOption("style");
 await page.getByRole("button",{name:"選んだsectionへ挿入",exact:true}).click();
 await find("asset-3");await select("Warm ceramic 04");await page.getByRole("button",{name:"Add to Composition",exact:true}).click();
 const weight=page.getByRole("spinbutton",{name:"asset-3 weight",exact:true});await weight.fill("0.55");await weight.press("Tab");
 await page.getByRole("button",{name:"asset-3 weight plus",exact:true}).click();assert.equal(await weight.inputValue(),"0.6");
 await page.getByRole("button",{name:"asset-3 move up",exact:true}).click();
 await page.getByRole("button",{name:"asset-0 Disable",exact:true}).click();
 assert.equal(await page.locator(".composition-row").first().locator("strong").textContent(),"asset-3");
 await shot("composition-editing-1440");await close();
 assert.equal(await page.locator(".lora-summary").textContent(),"2 LoRA · Browse LoRA");
 await page.getByRole("button",{name:"Structured · 編集",exact:true}).click();
 assert.equal(await page.getByRole("textbox",{name:"キャラクター",exact:true}).inputValue(),"a ceramic teapot");
 const final=await page.getByRole("textbox",{name:"Final Positive Prompt",exact:true}).inputValue();assert.ok(final.includes("texture-0, gentle light"));assert.ok(final.includes(initialPrompt));
 await page.keyboard.press("Escape");await page.getByRole("button",{name:"Generate",exact:true}).click();await page.waitForFunction(()=>document.querySelector(".canvas-stage").dataset.state==="completed");
 assert.equal(requests[0].prompt,final);assert.equal(requests[0].negativePrompt,"blur");assert.deepEqual(requests[0].loras.map(l=>l.name),["asset-3","asset-0"]);assert.equal(requests[0].loras[0].weight,0.6);assert.equal(requests[0].loras[1].enabled,false);assert.equal(requests[0].loras[0].triggerWords,"");
 const image=await page.locator(".artwork").getAttribute("src");
 for(const [width,height]of [[1280,900],[1920,1080],[390,844],[430,932]]){
  await page.setViewportSize({width,height});const studio=await dims();await open();await find("");
  if(width<701){assert.equal(await page.getByRole("dialog",{name:"LoRA Library"}).evaluate(n=>n.clientWidth),width);
   await page.getByRole("button",{name:"Folders",exact:true}).click();await page.getByRole("navigation",{name:"LoRA folders",exact:true}).getByRole("button",{name:"All LoRA",exact:true}).click();await page.getByRole("button",{name:"Folders",exact:true}).click();await page.getByRole("navigation",{name:"LoRA folders",exact:true}).getByRole("button",{name:"Anima",exact:true}).click();await page.getByRole("button",{name:"Folders",exact:true}).click();await page.getByRole("navigation",{name:"LoRA folders",exact:true}).getByRole("button",{name:"Anima/Style",exact:true}).click();
   await shot(`mobile-browser-${width}`);await find("asset-4");await select("Silver morning 05");await page.getByRole("button",{name:"Add to Composition",exact:true}).click();await shot(`mobile-detail-${width}`);
   await page.getByRole("button",{name:"Composition · 3",exact:true}).click();const w=page.getByRole("spinbutton",{name:"asset-4 weight",exact:true});await w.fill("0.45");await w.press("Tab");await shot(`mobile-composition-${width}`);await page.getByRole("button",{name:"asset-4 Remove",exact:true}).click();await page.getByRole("button",{name:"Browse",exact:true}).click();
   await page.setViewportSize({width,height:440});await find("asset-3");assert.equal(await page.getByRole("searchbox",{name:"Search LoRA"}).isVisible(),true);await page.setViewportSize({width,height});
  }else await shot(`browser-overview-${width}`);
  assert.equal(await page.getByRole("dialog",{name:"LoRA Library"}).evaluate(n=>n.scrollWidth<=n.clientWidth),true);
  // Native modal traps keyboard focus and Escape restores the Dock entry.
  for(let i=0;i<12;i++)await page.keyboard.press("Tab");assert.equal(await page.evaluate(()=>document.activeElement.closest(".lora-browser")!==null),true);
  await page.keyboard.press("Escape");assert.deepEqual(await dims(),studio);assert.equal(await page.locator(".artwork").getAttribute("src"),image);metrics.push({width,height,studio});
 }
 await page.getByRole("button",{name:"Structured · 編集",exact:true}).click();await page.getByRole("button",{name:"Raw",exact:true}).click();
 await page.getByRole("textbox",{name:"Raw Prompt",exact:true}).fill("raw ceramic");await page.keyboard.press("Escape");
 await open();await find("asset-0");await select("Soft afternoon 01");await page.getByRole("button",{name:"Raw Promptへ挿入",exact:true}).click();await close();
 await page.getByRole("button",{name:"Raw · 編集",exact:true}).click();assert.equal(await page.getByRole("textbox",{name:"Final Positive Prompt",exact:true}).inputValue(),"raw ceramic, texture-0, gentle light");
 assert.equal(await page.getByRole("textbox",{name:"Negative Prompt",exact:true}).inputValue(),"blur");await page.keyboard.press("Escape");
 assert.deepEqual(errors,[]);
 await writeFile(path.join(output,"browser-report.json"),JSON.stringify({result:"PASS",catalog:144,initialRenderLimit:60,imageRequests,metrics,favoriteWrites,requests,errors},null,2));
 console.log(JSON.stringify({result:"PASS",metrics,imageRequests,errors}));
}catch(error){await shot("browser-failure");console.error(errors);throw error;}finally{await browser.close();await new Promise(done=>server.close(done));}
