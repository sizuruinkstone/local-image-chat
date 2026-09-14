import {element,icon} from "../primitives.js";
export function createAssetThumbnail({large=false}={}) {
  let source="";
  const image=element("img",{alt:"",loading:"lazy",decoding:"async",referrerpolicy:"no-referrer"});
  const label=element("span",{class:"asset-image-label",text:"No preview"});
  const root=element("div",{class:`asset-thumbnail${large?" asset-thumbnail-large":""}`,"data-state":"missing"},[icon("layers"),image,label]);
  image.addEventListener("load",()=>{if(image.getAttribute("src")===source){root.dataset.state="ready";label.textContent="";}});
  image.addEventListener("error",()=>{if(image.getAttribute("src")===source){root.dataset.state="failed";label.textContent="Preview unavailable";}});
  return {root,setSource(value) {
    let url="";
    try {const parsed=new URL(value,location.origin);if(value && ["http:","https:"].includes(parsed.protocol))url=value;}catch{}
    if(url===source)return;source=url;
    if(!source){image.removeAttribute("src");root.dataset.state="missing";label.textContent="No preview";}
    else {root.dataset.state="loading";label.textContent="Loading preview…";image.src=source;}
  }};
}
