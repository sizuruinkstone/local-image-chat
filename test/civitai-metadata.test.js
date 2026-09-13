import test from 'node:test';
import assert from 'node:assert/strict';
import {civitaiMetadataRows} from '../public/frontend/components/inspector/civitai-metadata.js';
test('Civitai card distinguishes default weight from creator recommendation and formats file size',()=>{
 const rows=Object.fromEntries(civitaiMetadataRows({versionName:'anima V1',modelType:'LORA',baseModel:'Anima',recommendedWeight:.75,recommendedWeightSource:'fallback',file:{name:'style.safetensors',sizeKB:179323.234}}));
 assert.equal(rows['初期強度の目安（作者推奨は未確認）'],'0.75');assert.equal(rows['推奨強度'],undefined);assert.equal(rows['サイズ'],'175.1 MB');
 assert.equal(Object.fromEntries(civitaiMetadataRows({recommendedWeight:0,recommendedWeightSource:'description'}))['推奨強度'],'0');
 assert.equal(Object.fromEntries(civitaiMetadataRows({}))['ファイル'],'—');
});
