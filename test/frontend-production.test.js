import test from "node:test";
import assert from "node:assert/strict";
import {once} from "node:events";
import path from "node:path";
import {readFile} from "node:fs/promises";
import express from "express";
import {installFrontendEntry} from "../src/frontend-entry.js";

test("Production routing selects New Studio, explicit legacy rollback and revalidated static modules", async t => {
  const app=express();installFrontendEntry(app,path.resolve("public"));
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  for(const route of ["/","/index.html","/studio-next/","/frontend/index.html","/?fixture=r2"]){
    const response=await fetch(origin+route),body=await response.text();assert.equal(response.status,200);assert.match(body,/frontend\/app\/boot\.js/);assert.doesNotMatch(body,/src="\/app\.js/);assert.equal(response.headers.get("cache-control"),"no-cache");
  }
  const legacy=await fetch(origin+"/?legacy=1");assert.equal(await legacy.text(),await readFile("public/index.html","utf8"));
  for(const asset of ["/frontend/app/boot.js","/features/generate-workspace.js","/frontend/styles/shell.css","/sw.js","/manifest.webmanifest"]){const response=await fetch(origin+asset);assert.equal(response.status,200,asset);assert.equal(response.headers.get("cache-control"),"no-cache",asset);}
});

test("Production boot has no development/fixture dependency and updater includes the new static tree",async()=>{
 const boot=await readFile("public/frontend/app/boot.js","utf8"),html=await readFile("public/frontend/index.html","utf8"),updater=await readFile("src/updater.js","utf8");
 assert.doesNotMatch(boot+html,/__studio-dev__|fixture-transport|study\.svg|\/style\.css|src="\/app\.js/);
 assert.match(boot,/persistSession:true/);assert.match(boot,/updateViaCache:"none"/);assert.match(html,/\/manifest.webmanifest/);assert.match(updater,/"public"/);
});
