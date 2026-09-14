import { element, button } from "../primitives.js";
import { originalImageUrl } from "../../../image-delivery.js";

export function createFullscreenImage() {
  let previous;
  const image = element("img", {alt:"全画面画像"});
  const root = element("dialog", {class:"fullscreen-image", "aria-label":"画像の全画面表示"}, [
    image, button("閉じる", {className:"control fullscreen-image-close", onClick:()=>root.close()})
  ]);
  const exit = () => { if(document.fullscreenElement === root) document.exitFullscreen?.().catch(()=>{}); };
  const changed = () => { if(!document.fullscreenElement && root.open) root.close(); };
  root.addEventListener("close",()=>{exit(); if(previous?.isConnected) previous.focus();});
  document.addEventListener("fullscreenchange",changed);
  return {root, open(value) {
    image.src=originalImageUrl(value);
    previous=document.activeElement;
    if(!root.open)root.showModal();
    // Viewport overlay remains usable where native fullscreen is unsupported.
    root.requestFullscreen?.().then(()=>{if(!root.open)exit();}).catch(()=>{});
  }, dispose(){exit();document.removeEventListener("fullscreenchange",changed);root.remove();}};
}
