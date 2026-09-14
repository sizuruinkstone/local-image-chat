import {element,button} from '../primitives.js';
import {createStudioDialog,field} from '../settings/dialog.js';
import {createLibraryService} from '../../../core/library-service.js';
import {thumbnailImageUrl} from '../../../image-delivery.js';
import {getJson} from '../../../core/http-client.js';

export function createSceneImagePicker(onSelect) {
  const dialog=createStudioDialog('Libraryから代表画像を選択');
  const grid=element('div',{class:'scene-grid'}),status=element('p',{role:'status'});
  const search=element('input',{type:'search'}),rating=element('select',{},['general','nsfw'].map(value=>element('option',{value,text:value==='general'?'一般':'NSFW'})));
  let timer;
  const service=createLibraryService({getJson,onChange:render});
  function render(data) {
    status.textContent=data.error || (data.loading?'読み込み中…':`${data.total ?? data.items?.length ?? 0}件`);
    grid.replaceChildren(...(data.items ?? []).map(item=>{
      const node=button(item.record.title || `画像 ${item.image.id}`,{onClick:()=>{onSelect(item.image);dialog.close();}});
      node.prepend(element('img',{src:thumbnailImageUrl(item.image),alt:'',loading:'lazy'}));return node;
    }));
    more.disabled=data.loading||!data.nextCursor;
  }
  const more=button('さらに読み込む',{onClick:()=>service.more()});
  search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>service.setQuery({search:search.value}),200);});
  rating.addEventListener('change',()=>service.setQuery({rating:rating.value}));
  dialog.body.append(field('Library画像を検索',search),field('画像の分類',rating),status,grid,more);
  return {...dialog,open(){dialog.open();service.load();},dispose(){clearTimeout(timer);service.dispose();dialog.root.remove();}};
}
