import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHistoryService} from "../src/history.js";
import {createLibraryService} from "../public/core/library-service.js";
test("full-history search and oldest apply before cursor pagination without changing storage", async t => {
 const directory = await mkdtemp(path.join(os.tmpdir(), "lic-library-")); t.after(() => rm(directory,{recursive:true,force:true}));
 const history = createHistoryService(directory);
 for(let i=0;i<7;i++) await history.addGeneration({prompt:i===0?"rare watercolor":"ordinary",images:[{id:`image-000${i}`,filename:`${i}.png`,seed:i}]});
 const newest=await history.listPage({limit:2});assert.equal(newest.generations[0].images[0].seed,6);
 const oldest=await history.listPage({limit:2,sort:"oldest"});assert.equal(oldest.generations[0].images[0].seed,0);
 const second=await history.listPage({limit:2,sort:"oldest",cursor:oldest.nextCursor});assert.equal(second.generations[0].images[0].seed,2);
 const found=await history.listPage({limit:1,search:"rare watercolor"});assert.equal(found.total,1);assert.equal(found.generations[0].images[0].seed,0);
 await assert.rejects(history.listPage({sort:"unknown"}),/並び順/);
});
test("Library ignores stale search and incremental responses, deduplicates and retries failures", async()=>{
 const pending=[];const service=createLibraryService({getJson:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject}))});
 const page=id=>({generations:[{images:[{id}]}],hasMore:true,nextCursor:id,total:10});
 const old=service.load(),fresh=service.setQuery({search:"new",sort:"oldest"});pending[1].resolve(page("new"));await fresh;pending[0].resolve(page("old"));await old;
 assert.equal(service.getSnapshot().items[0].image.id,"new");assert.match(pending[1].url,/sort=oldest/);
 const more=service.more();const replacement=service.setQuery({search:"other"});pending[3].resolve(page("other"));await replacement;pending[2].resolve(page("stale"));await more;
 assert.deepEqual(service.getSnapshot().items.map(x=>x.image.id),["other"]);
 const failure=service.more();pending[4].reject(Error("offline"));await failure;assert.equal(service.getSnapshot().error,"offline");
 const retry=service.more();pending[5].resolve(page("other"));await retry;assert.equal(service.getSnapshot().items.length,1);service.dispose();
});
