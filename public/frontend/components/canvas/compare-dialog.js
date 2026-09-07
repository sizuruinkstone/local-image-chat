import {element,button} from "../primitives.js";
import {createStudioDialog} from "../settings/dialog.js";
import {originalImageUrl} from "../../../image-delivery.js";
import {postJson} from "../../../core/http-client.js";
export function createCompareDialog(){
 const dialog=createStudioDialog("Compare images");dialog.root.classList.add("compare-dialog");let left,right;
 const images=element("div",{class:"compare-images"}),note=element("p",{role:"status"});
 async function vote(winner){try{await postJson("/api/comparisons",{imageIds:[left.image.id,right.image.id],winnerImageId:winner?.image.id??null,result:winner?(winner===left?"a":"b"):"draw"});note.textContent="比較結果を保存しました。";}catch(e){note.textContent=e.message;}}
 const controls=element("div",{class:"viewer-controls"},[button("Aを選ぶ",{onClick:()=>vote(left)}),button("同等",{onClick:()=>vote(null)}),button("Bを選ぶ",{onClick:()=>vote(right)}),button("比較をリセット",{onClick:()=>{left=right=null;dialog.close();}})]);
 dialog.body.append(note,images,controls);
 return {root:dialog.root,open(item,current){if(!left)left=current&&current.image.id!==item.image.id?current:item;if(item.image.id!==left.image.id)right=item;
  images.replaceChildren(...[left,right].filter(Boolean).map((entry,index)=>element("figure",{},[element("img",{src:originalImageUrl(entry.image),alt:`Compare ${index===0?"A":"B"}`}),element("figcaption",{text:`${index===0?"A":"B"} · Seed ${entry.image.seed} · ${entry.record.settings?.steps??"—"} steps`})])));
  controls.hidden=!right;note.textContent=right?"画像と生成設定を見比べて、結果を明示保存できます。":"Aを保持しました。閉じてLibraryから別の画像を選び、Compareを押してください。";dialog.open();
 }};
}
