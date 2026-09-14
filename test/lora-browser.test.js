import test from "node:test";
import assert from "node:assert/strict";
import {createLoraBrowserState} from "../public/frontend/app/lora-browser-state.js";
const catalog=[null,{name:"ink",displayName:"Ink wash",folder:"Anima/Style",registry:{favorite:true,triggerWords:"brushwork"}},
  {name:"portrait",folder:"Anima/People",registry:{baseModel:"Anima"}},{name:"plain"}];
test("R4 folder/back/root, global search and favorites retain session position and selected details",()=>{
 const state=createLoraBrowserState();state.setCatalog(catalog);assert.equal(state.getView().total,3);
 state.navigate("Anima");assert.equal(state.getView().children.length,2);
 state.navigate("Anima/Style");assert.equal(state.getView().total,1);
 state.select("ink");state.search("people portrait");assert.equal(state.getView().items[0].id,"portrait");
 assert.equal(state.getView().folder,"Anima/Style");state.search("");assert.equal(state.getView().items[0].id,"ink");
 state.favorites(true);assert.equal(state.getView().total,1);state.favorites(false);
 state.setCatalog(catalog);assert.equal(state.getView().folder,"Anima/Style");assert.equal(state.getView().selected.id,"ink");
 state.back();assert.equal(state.getView().folder,"Anima");state.navigate("");assert.equal(state.getView().total,3);
 state.search("BRUSHWORK");assert.equal(state.getView().items[0].id,"ink");
 assert.throws(()=>state.navigate("missing"),/Unknown/);
});
test("R4 catalog replacement drops missing folder/selection and limits initial rendering",()=>{
 const state=createLoraBrowserState();state.setCatalog(catalog);state.navigate("Anima/Style");state.select("ink");
 state.setCatalog(Array.from({length:144},(_,i)=>({name:`asset ${i}`})));
 assert.equal(state.getView().folder,"");assert.equal(state.getView().selected,null);
 assert.equal(state.getView().total,144);assert.equal(state.getView().items.length,60);
 state.more();assert.equal(state.getView().items.length,120);state.more();assert.equal(state.getView().items.length,144);
 state.search("asset 143");assert.equal(state.getView().total,1);
});
