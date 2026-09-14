import {createRequire} from 'node:module';import os from 'node:os';import path from 'node:path';import {writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto('http://127.0.0.1:3030/');await page.waitForFunction(()=>!document.querySelector('.prompt-open').disabled);
 await page.evaluate(async()=>{const old=await caches.open('lic-old-ui-test');await old.put('/',new Response('<html>old UI</html>',{headers:{'content-type':'text/html'}}));const r=await navigator.serviceWorker.ready;await r.unregister();await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});});
 await page.waitForFunction(async()=>!(await caches.keys()).length);await page.reload();await page.waitForFunction(()=>!document.querySelector('.prompt-open').disabled);assert.equal(await page.locator('.preview-badge').textContent(),'LOCAL');
 await page.getByRole('button',{name:'Tools',exact:true}).click();await page.getByRole('navigation',{name:'Creation tools tabs'}).getByRole('button',{name:'Reference',exact:true}).click();await page.getByText('Forge Neo / AnimaではIP-Adapterを利用できません',{exact:true}).waitFor();assert.equal(await page.getByRole('checkbox',{name:'Enable IP-Adapter',exact:true}).isDisabled(),true);
 await page.goto('http://127.0.0.1:3030/?legacy=1');await page.locator('#mainNav').waitFor();await page.waitForLoadState('networkidle');assert.equal(await page.locator('.studio-shell').count(),0);assert.deepEqual(errors,[]);
 await writeFile('workbench/final/cache-legacy-report.json',JSON.stringify({result:'PASS',checks:['old cache cleared by activated worker','refresh stays New Studio','actual unsupported IP capability','legacy UI loads'],errors},null,2));console.log('Production SW update, unsupported capability and legacy browser PASS');
}finally{await browser.close();}
