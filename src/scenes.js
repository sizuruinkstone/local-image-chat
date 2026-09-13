import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {JsonStore} from './json-store.js';
import {createThumbnailService} from './thumbnails.js';
import {validateSceneContent,extractSceneSource,sceneError} from '../public/scenes.js';

export function createSceneService({dataDir,outputDir,history,getCatalog = async()=>[],store: suppliedStore}) {
  const directory = path.resolve(dataDir,'scenes-images');
  const store = suppliedStore ?? new JsonStore(path.join(dataDir,'scenes.json'),{schemaVersion:1,revision:0,items:[],mutations:{}});
  const historyPaths = createThumbnailService({outputDir});
  const safeAsset = id => {if (!/^[a-f0-9-]{36}$/.test(id ?? '')) throw sceneError('画像IDが不正です');return path.join(directory,id);};
  const lookup = (data,id) => {const item=data.items.find(item=>item.id===id);if(!item)throw sceneError('場面がありません',404);return item;};
  const revision = (item,value) => {if(item.revision!==value)throw sceneError(`別の端末で更新されています（最新 revision ${item.revision}）。最新版を読み直すか別名保存してください`,409);};
  const urls = item => ({...item,thumbnailUrl:`/api/v1/scenes/${item.id}/preview?asset=${item.preview.assetId}&size=thumb`});
  async function cleanup(assetId) { for (const suffix of ['', '.webp','.tmp','.webp.tmp']) await fs.rm(safeAsset(assetId)+suffix,{force:true}).catch(()=>{}); }
  async function copyAsset(imageId, originalAsset) {
    const id=crypto.randomUUID(), destination=safeAsset(id);
    await fs.mkdir(directory,{recursive:true});
    try {
      const source = imageId ? historyPaths.pathsFor(await history.getImage(imageId)).sourcePath : safeAsset(originalAsset);
      await fs.copyFile(source,destination+'.tmp');
      const input=sharp(destination+'.tmp',{animated:false,failOn:'error'}), metadata=await input.metadata();
      if ((metadata.pages ?? 1)>1 || !['png','jpeg','webp'].includes(metadata.format)) throw sceneError('代表画像の形式に対応していません');
      await input.rotate().resize({width:384,height:384,fit:'inside',withoutEnlargement:true}).webp({quality:76}).toFile(destination+'.webp.tmp');
      await fs.rename(destination+'.tmp',destination); await fs.rename(destination+'.webp.tmp',destination+'.webp');
      return {assetId:id,mimeType:`image/${metadata.format}`,width:metadata.width,height:metadata.height};
    } catch(error) {await cleanup(id);throw error;}
  }
  function body(value,allowed) {
    if(!value || typeof value!=='object' || Object.keys(value).some(key=>!allowed.includes(key)))throw sceneError('未対応の保存項目があります');
    for(const key of ['sourceImageId','previewSourceImageId'])if(value[key]!==undefined && (typeof value[key]!=='string'||!value[key]||value[key].length>100))throw sceneError('Library画像IDを指定してください');
  }
  async function mutate(kind,id,value) {
    body(value,['content','expectedRevision','mutationId',...(kind==='create'?['sourceImageId']:[]),'previewSourceImageId']);
    const content=validateSceneContent(value.content);
    if(kind!=='update' && !/^[\w-]{8,100}$/.test(value.mutationId ?? ''))throw sceneError('保存操作IDが不正です');
    let result,newAsset,oldAsset;
    const mutationKey=`${kind}:${id ?? ''}:${value.mutationId}`;
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
    try {
      await store.update(async data=>{
        if(kind!=='update' && data.mutations[mutationKey]) {
          const prior=data.mutations[mutationKey];
          if(prior.fingerprint!==fingerprint)throw sceneError('同じ保存操作IDで内容が変わっています',409);
          result=lookup(data,prior.id);return data;
        }
        const original=kind==='create'?null:lookup(data,id);
        if(original)revision(original,value.expectedRevision);
        let source=original?.source;
        if(kind==='create') {
          if(!value.sourceImageId)throw sceneError('Library画像を選択してください');
          source=extractSceneSource(await history.getRecipe(value.sourceImageId)).source;
        }
        const preview=kind==='update'&&!value.previewSourceImageId ? original.preview : await copyAsset(value.previewSourceImageId || (kind==='create'?value.sourceImageId:null),original?.preview.assetId);
        if(preview!==original?.preview)newAsset=preview.assetId;
        const now=new Date().toISOString();
        result={schemaVersion:1,...content,id:kind==='update'?id:crypto.randomUUID(),revision:kind==='update'?original.revision+1:1,
          createdAt:kind==='update'?original.createdAt:now,updatedAt:now,source,preview};
        if(kind==='update') {data.items=data.items.filter(item=>item.id!==id);if(newAsset)oldAsset=original.preview.assetId;}
        data.items.push(result);data.revision+=1;
        if(kind!=='update')data.mutations[mutationKey]={id:result.id,fingerprint};
        return data;
      });
    } catch(error) {if(newAsset)await cleanup(newAsset);throw error;}
    if(oldAsset)await cleanup(oldAsset);
    return {scene:urls(result)};
  }
  return {
    // Run before serving requests. No active writes exist during this recovery pass.
    async recover() {
      const data=await store.read(), retained=new Set(data.items.map(item=>item.preview.assetId));
      await fs.mkdir(directory,{recursive:true});
      for(const name of await fs.readdir(directory)) {
        const match=/^([a-f0-9-]{36})(?:\.webp)?(?:\.tmp)?$/.exec(name);
        if(match && (!retained.has(match[1]) || name.endsWith('.tmp')))await fs.rm(path.join(directory,name),{force:true});
      }
    },
    async list({query='',contentRating='general',cursor='',limit=60}={}) {
      if(typeof query!=='string'||query.length>100||!['general','nsfw'].includes(contentRating))throw sceneError('検索条件が不正です');
      limit=Number(limit);if(!Number.isInteger(limit)||limit<1||limit>200)throw sceneError('取得件数は1〜200です');
      const data=await store.read();let offset=0;
      if(cursor) {
        let parsed;try{parsed=JSON.parse(Buffer.from(cursor,'base64url').toString());}catch{throw sceneError('一覧cursorが不正です');}
        if(parsed.query!==query||parsed.contentRating!==contentRating||parsed.revision!==data.revision)throw sceneError('一覧が更新されました。再取得してください',409);
        if(!Number.isInteger(parsed.offset)||parsed.offset<0)throw sceneError('一覧cursorが不正です');offset=parsed.offset;
      }
      const items=data.items.filter(item=>item.contentRating===contentRating&&item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
      const next=offset+limit;
      return {items:items.slice(offset,next).map(item=>{const {id,revision,name,contentRating,source,updatedAt,thumbnailUrl}=urls(item);return {id,revision,name,contentRating,source,updatedAt,thumbnailUrl};}),total:items.length,catalogRevision:data.revision,
        nextCursor:next<items.length?Buffer.from(JSON.stringify({query,contentRating,revision:data.revision,offset:next})).toString('base64url'):null};
    },
    async get(id){return {scene:urls(lookup(await store.read(),id))};},
    async source(imageId){const recipe=await history.getRecipe(imageId);let catalog=[];try{catalog=await getCatalog(recipe);}catch{/* Unknown classification stays explicit. */}return {source:extractSceneSource(recipe,catalog)};},
    create:value=>mutate('create',null,value),update:(id,value)=>mutate('update',id,value),copy:(id,value)=>mutate('copy',id,value),
    async remove(id,expectedRevision){let asset;await store.update(data=>{const item=lookup(data,id);revision(item,Number(expectedRevision));asset=item.preview.assetId;data.items=data.items.filter(item=>item.id!==id);data.revision+=1;return data;});await cleanup(asset);return {deleted:true,id};},
    async preview(id,asset,size){const item=lookup(await store.read(),id);if(item.preview.assetId!==asset)throw sceneError('代表画像が更新されています',404);if(!['thumb','original'].includes(size))throw sceneError('画像サイズが不正です');return {path:safeAsset(asset)+(size==='thumb'?'.webp':''),mimeType:size==='thumb'?'image/webp':item.preview.mimeType};}
  };
}
export function registerSceneRoutes(router,{service,wrap}) {
  router.get('/scenes',wrap(async(req,res)=>res.json(await service.list(req.query))));
  router.get('/scenes/source/:imageId',wrap(async(req,res)=>res.json(await service.source(req.params.imageId))));
  router.get('/scenes/:id/preview',wrap(async(req,res)=>{const file=await service.preview(req.params.id,req.query.asset,req.query.size ?? 'thumb');res.type(file.mimeType).set('Cache-Control','private, no-cache').sendFile(file.path);}));
  router.get('/scenes/:id',wrap(async(req,res)=>res.json(await service.get(req.params.id))));
  router.post('/scenes',wrap(async(req,res)=>res.status(201).json(await service.create(req.body))));
  router.post('/scenes/:id/copy',wrap(async(req,res)=>res.status(201).json(await service.copy(req.params.id,req.body))));
  router.patch('/scenes/:id',wrap(async(req,res)=>res.json(await service.update(req.params.id,req.body))));
  router.delete('/scenes/:id',wrap(async(req,res)=>res.json(await service.remove(req.params.id,req.query.expectedRevision))));
}
