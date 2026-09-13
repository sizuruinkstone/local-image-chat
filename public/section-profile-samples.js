// Built-in starting points. They are never applied to a draft automatically.
const examples={
 character:[
  ['女性・ソロ','1girl, solo, adult woman'],
  ['男性・ソロ','1boy, solo, adult man'],
  ['女性ふたり','2girls, adult women'],
  ['男女ふたり','1girl, 1boy, adult woman, adult man'],
  ['猫耳キャラクター','1girl, solo, adult woman, cat ears, cat tail'],
  ['初音ミク','1girl, solo, hatsune_miku, vocaloid, aqua hair, twintails, aqua eyes'],
  ['セイバー（Fate）','1girl, solo, saber_(fate), fate_(series), blonde hair, green eyes'],
  ['綾波レイ','1girl, solo, ayanami_rei, neon_genesis_evangelion, short blue hair, red eyes'],
  ['レム（Re:ゼロ）','1girl, solo, rem_(re:zero), re:zero_kara_hajimeru_isekai_seikatsu, blue hair, blue eyes'],
  ['ヨル・ブライア','1girl, solo, yor_briar, spy_x_family, black hair, red eyes'],
  ['フリーレン','1girl, solo, frieren, sousou_no_frieren, white hair, green eyes, elf ears'],
  ['雷電将軍','1girl, solo, raiden_shogun, genshin_impact, long purple hair, purple eyes, hair ornament'],
  ['猫猫（薬屋のひとりごと）','1girl, solo, maomao_(kusuriya_no_hitorigoto), kusuriya_no_hitorigoto, green hair, hair ornament'],
  ['今汐（鳴潮）','1girl, solo, jinhsi_(wuthering_waves), wuthering_waves, white hair, yellow eyes, dragon horns']
 ],
 appearance:[
  ['白ワンピース・麦わら帽子','white sundress, straw hat, sandals'],
  ['カジュアル・デニム','white shirt, denim jeans, sneakers'],
  ['夏祭り・浴衣','yukata, obi, hair ornament, geta'],
  ['巫女装束','miko, white kimono, red hakama'],
  ['冬服・コート','winter coat, scarf, gloves, boots']
 ],
 composition:[
  ['全身・正面','full body, standing, from front, looking at viewer'],
  ['膝上・斜め','cowboy shot, standing, three-quarter view, looking at viewer'],
  ['上半身・ポートレート','upper body, eye-level, looking at viewer'],
  ['横顔・寄り','close-up, profile, looking away'],
  ['座り姿・全身','full body, sitting on bench, three-quarter view'],
  ['立ち姿・ダイナミック構図','full body, standing, contrapposto, three-quarter view, from below, dynamic angle, foreshortening']
 ],
 situation:[
  ['夏祭り・神社・昼','summer shrine festival, shrine grounds, festival stalls, daylight'],
  ['夏祭り・夜・提灯','summer festival, night, paper lanterns, warm lighting'],
  ['海辺・晴天','sandy beach, ocean, blue sky, summer, daylight'],
  ['カフェ・窓際','cafe interior, window, wooden table, soft daylight'],
  ['街角・雨上がり','city street, after rain, puddles, reflections, evening']
 ]
};
export const SECTION_PROFILE_SAMPLES=Object.entries(examples).flatMap(([field,rows])=>rows.map(([name,text],index)=>({id:`sample-v1:${field}:${index+1}`,field,name,text,enabled:true,contentRating:'general'})));
