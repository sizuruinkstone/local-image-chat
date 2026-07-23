export const LORA_PROFILES = [
  {
    id: "shanimas-illustrious-v2",
    name: "アイドルマスター シャイニーカラーズ（28キャラ）",
    category: "direction",
    baseModel: "Illustrious",
    versionId: 3048052,
    sourceUrl: "https://civitai.com/models/1186512?modelVersionId=3048052",
    filename: "shanimas.il.safetensors",
    match: ["shanimas.il", "shanimas il"],
    recommendedWeight: 0.9,
    defaultPreset: "identity",
    note: "画風＋28キャラ収録。キャラと衣装を別々に選択できます。配布例は0.9。",
    presets: [
      { id: "identity", name: "画風のみ（キャラ指定なし）", triggerWords: "shanimas, 1girl, solo, alternate costume" },
      { id: "amana", name: "大崎甘奈（amana）", triggerWords: "shanimas, amana, 1girl, solo" },
      { id: "asahi", name: "芹沢あさひ（asahi）", triggerWords: "shanimas, asahi, 1girl, solo" },
      { id: "chiyoko", name: "園田智代子（chiyoko）", triggerWords: "shanimas, chiyoko, 1girl, solo" },
      { id: "chiyuki", name: "桑山千雪（chiyuki）", triggerWords: "shanimas, chiyuki, 1girl, solo" },
      { id: "fuyuko", name: "黛冬優子（fuyuko）", triggerWords: "shanimas, fuyuko, 1girl, solo" },
      { id: "hana", name: "鈴木羽那（hana）", triggerWords: "shanimas, hana, 1girl, solo" },
      { id: "haruki", name: "郁田はるき（haruki）", triggerWords: "shanimas, haruki, 1girl, solo" },
      { id: "hiori", name: "風野灯織（hiori）", triggerWords: "shanimas, hiori, 1girl, solo" },
      { id: "hinana", name: "市川雛菜（hinana）", triggerWords: "shanimas, hinana, 1girl, solo" },
      { id: "juri", name: "西城樹里（juri）", triggerWords: "shanimas, juri, 1girl, solo" },
      { id: "kaho", name: "小宮果穂（kaho）", triggerWords: "shanimas, kaho, 1girl, solo" },
      { id: "kiriko", name: "幽谷霧子（kiriko）", triggerWords: "shanimas, kiriko, 1girl, solo" },
      { id: "kogane", name: "月岡恋鐘（kogane）", triggerWords: "shanimas, kogane, 1girl, solo" },
      { id: "koito", name: "福丸小糸（koito）", triggerWords: "shanimas, koito, 1girl, solo" },
      { id: "luca", name: "斑鳩ルカ（luca）", triggerWords: "shanimas, luca, 1girl, solo" },
      { id: "madoka", name: "樋口円香（madoka）", triggerWords: "shanimas, madoka, 1girl, solo" },
      { id: "mamimi", name: "田中摩美々（mamimi）", triggerWords: "shanimas, mamimi, 1girl, solo" },
      { id: "mano", name: "櫻木真乃（mano）", triggerWords: "shanimas, mano, 1girl, solo" },
      { id: "meguru", name: "八宮めぐる（meguru）", triggerWords: "shanimas, meguru, 1girl, solo" },
      { id: "mei", name: "和泉愛依（mei）", triggerWords: "shanimas, mei, 1girl, solo" },
      { id: "mikoto", name: "緋田美琴（mikoto）", triggerWords: "shanimas, mikoto, 1girl, solo" },
      { id: "natsuha", name: "有栖川夏葉（natsuha）", triggerWords: "shanimas, natsuha, 1girl, solo" },
      { id: "nichika", name: "七草にちか（nichika）", triggerWords: "shanimas, nichika, 1girl, solo" },
      { id: "rinze", name: "杜野凛世（rinze）", triggerWords: "shanimas, rinze, 1girl, solo" },
      { id: "sakuya", name: "白瀬咲耶（sakuya）", triggerWords: "shanimas, sakuya, 1girl, solo" },
      { id: "tenka", name: "大崎甜花（tenka）", triggerWords: "shanimas, tenka, 1girl, solo" },
      { id: "toru", name: "浅倉透（toru）", triggerWords: "shanimas, toru, 1girl, solo" },
      { id: "yuika", name: "三峰結華（yuika）", triggerWords: "shanimas, yuika, 1girl, solo" }
    ],
    addons: [
      { id: "none", name: "衣装指定なし", triggerWords: "" },
      { id: "cosaaa", name: "衣装A（cosaaa）", triggerWords: "cosaaa" },
      { id: "cosccc", name: "衣装B（cosccc）", triggerWords: "cosccc" }
    ],
    defaultAddon: "none"
  },
  {
    id: "suou-patra-illustrious",
    name: "周防パトラ（VTuber）",
    baseModel: "Illustrious",
    versionId: 3028701,
    sourceUrl: "https://civitai.com/models/2697170?modelVersionId=3028701",
    filename: "patra.il.safetensors",
    match: ["patra.il", "patra il"],
    recommendedWeight: 0.9,
    defaultPreset: "identity",
    note: "本人＋2衣装収録。衣装を別プルダウンから選択できます。まず0.9。",
    presets: [
      {
        id: "identity",
        name: "衣装自由（キャラ特徴のみ）",
        triggerWords: "patra, 1girl, solo, alternate costume",
        negativeWords: "apt, bpt"
      }
    ],
    addons: [
      { id: "none", name: "衣装指定なし", triggerWords: "" },
      { id: "apt", name: "衣装A（apt）", triggerWords: "apt", clearNegativeWords: true },
      { id: "bpt", name: "衣装B（bpt）", triggerWords: "bpt", clearNegativeWords: true }
    ],
    defaultAddon: "none"
  },
  {
    id: "aizawa-ema-il-v2",
    name: "藍沢エマ v2.0（23衣装）",
    baseModel: "Illustrious",
    versionId: 2439947,
    sourceUrl: "https://civitai.com/models/1327407?modelVersionId=2439947",
    filename: "Aizawa_Ema_IL_2.0.safetensors",
    match: ["Aizawa_Ema_IL_2.0", "Aizawa Ema IL 2.0"],
    recommendedWeight: 0.85,
    defaultPreset: "identity",
    legacyDefaultPreset: "default",
    note: "配布元の推奨は0.8〜1.0。まず0.85。",
    presets: [
      {
        id: "identity",
        name: "衣装自由（キャラ特徴のみ）",
        recommendedWeight: 0.65,
        triggerWords: "EmaDefault, 1girl, solo, alternate costume, long hair, flower hairpin, mismatched cat earrings",
        negativeWords: "strapless layered dress, criss-cross halter, waist bow, single fishnet thighhigh, thigh strap, block heels"
      },
      {
        id: "default",
        name: "初期衣装",
        triggerWords: "EmaDefault, 1girl, solo, long hair, flower hairpin, mismatched cat earrings, choker, strapless layered dress, criss-cross halter, waist bow, gloves, single fishnet thighhigh, thigh strap, block heels"
      },
      {
        id: "military",
        name: "異世界系戦闘服",
        triggerWords: "EmaMilitary, 1girl, solo, long hair, hairband, mismatched cat earrings, short dress, necktie, gloves, white coat, belt, garter straps, thighhighs, boots"
      },
      {
        id: "one-piece",
        name: "私服ワンピース",
        triggerWords: "EmaOnePiece, 1girl, solo, long hair, flower hairband, flower earrings, yellow-framed eyewear, floral print one-piece dress, layered skirt, frilled socks, mary janes"
      },
      {
        id: "roomwear",
        name: "ルームウェア",
        triggerWords: "EmaRoomwear, 1girl, solo, twin long braids, cat hairpin, parted bangs, yellow-framed eyewear, cat print striped hoodie, black shorts, cat slippers"
      },
      {
        id: "ninja",
        name: "和風戦闘服",
        triggerWords: "EmaNinja, 1girl, solo, bob cut, streaked hair, butterfly hair ornament, sleeveless ninja kimono dress, detached collar, haori, detached sleeves, pantyhose, high heel boots"
      },
      {
        id: "showdown",
        name: "SHOWDOWN衣装",
        triggerWords: "EmaSHOWDOWN, 1girl, solo, long hair, SHOWDOWN off-shoulder turtleneck, pencil skirt, SHOWDOWN open jacket, white thighhighs, sneakers"
      },
      {
        id: "fes",
        name: "FES衣装",
        triggerWords: "EmaFESdress, 1girl, solo, long hair, flower hair ornament, pendant earrings, neck ribbon, FES sleeveless pleated dress, frills arm garter, arm strap, wrist cuffs gloves, back bow, single thigh strap, leg ribbon, platform heels"
      },
      {
        id: "visual",
        name: "公式ビジュアル衣装",
        triggerWords: "EmasVisual, 1girl, solo, long hair, flower hairpin, single pill earring, mini Dixie cup hat, choker, pendant, sleeveless shirt, jacket partially removed, single glove, layered skirt, see-through side long hem, back bow, single thigh strap, single fishnet thighhigh, mary janes"
      },
      {
        id: "anniversary-1",
        name: "一周年記念",
        triggerWords: "EmaFirstAnniversary, 1girl, solo, long hair, braided bangs, hair ribbon, sleeveless turtleneck dress, off shoulder, black lace halterneck, bow waist sash, thigh ribbon, strappy heels"
      },
      {
        id: "anniversary-2",
        name: "二周年記念",
        triggerWords: "EmaSecondAnniversary, 1girl, solo, long hair, hair flower, mismatched cat earrings, strapless kimono, detached collar, manaita obi, wide sleeves, single thighhigh, thigh strap"
      },
      {
        id: "anniversary-3",
        name: "三周年記念",
        triggerWords: "EmaThirdAnniversary, 1girl, solo, long hair, half up braid, single flower earring, hair bow, puffy short sleeves shirt, bowtie, high-waist layered skirt, strappy block heels"
      },
      {
        id: "anniversary-4",
        name: "四周年記念",
        triggerWords: "EmaFourthAnniversary, 1girl, solo, long hair, flower hair ornament, flower earring, sleeveless china dress, detached sleeves, gold trim flower thigh strap, sleeve cutout, long white skirt, side slit"
      },
      {
        id: "jersey-maid",
        name: "ジャージメイド",
        triggerWords: "EmaJerseyMaid, 1girl, solo, long hair, cat ear maid headdress, mismatched cat earrings, jersey maid dress, maid apron, detached wings, bow thigh strap"
      },
      {
        id: "blessing",
        name: "Blessing衣装",
        triggerWords: "EmaBlessing, 1girl, solo, long hair, half updo, hair bow, choker, off-shoulder dress, frilled wrist cuffs, long belt, black footwear"
      },
      {
        id: "seiso-t",
        name: "清楚ですがTシャツ",
        triggerWords: "EmasSeisoT, 1girl, solo, Seiso t-shirt"
      },
      {
        id: "kimono-2022",
        name: "着物2022",
        triggerWords: "EmaKimono2022, 1girl, solo, low side ponytail, flower hair scrunchie, flower kanzashi, peony print green kimono, blue obi, tabi, okobo"
      },
      {
        id: "kimono-2024",
        name: "着物2024",
        triggerWords: "EmaKimono2024, 1girl, solo, long hair, flower hair ribbon, kikkoumon print blue kimono, flower obi, blue hakama, fur-trimmed gloves, pointy boots"
      },
      {
        id: "summer-2023",
        name: "水着2023",
        triggerWords: "EmaSummer2023, 1girl, solo, long hair, bucket hat, animal earrings, side-tie lace-trimmed bikini, detached collar, animal pendant, wristwatch, sandals"
      },
      {
        id: "summer-2024",
        name: "水着2024",
        triggerWords: "EmaSummer2024, 1girl, solo, long hair, hairclips, star earrings, choker, frilled bikini, see-through detached sleeves, thigh strap, sandals"
      },
      {
        id: "shibuya-tsutaya",
        name: "SHIBUYA TSUTAYA衣装",
        triggerWords: "EmaSHIBUTSUTA, 1girl, solo, long hair, cross hairclip, mismatched cat earrings, uniform coat dress, half gloves, single fishnet thighhigh, strappy heels"
      },
      {
        id: "valentine",
        name: "バレンタイン2023",
        triggerWords: "EmaValentine, 1girl, solo, long hair, bow hairclip, winter coat dress, white bow capelet, gloves, pantyhose, high heels"
      },
      {
        id: "sumire",
        name: "パーカーニーハイ",
        triggerWords: "EmaSumire, 1girl, solo, side ponytail, cat hair tie, cat paw print sweater dress, bra strap, cross-laced sleeves, side off shoulder, thighhighs"
      },
      {
        id: "tracksuit",
        name: "運動服",
        triggerWords: "EmaTracksuit, 1girl, solo, long hair, flower hairpin, mismatched cat earrings, tracksuit, track pants, sneakers"
      }
    ]
  },
  {
    id: "last-rite-illustrious",
    name: "ラストライト（アークナイツ：エンドフィールド）",
    baseModel: "Illustrious",
    versionId: 2786357,
    sourceUrl: "https://civitai.com/models/2478293",
    filename: "Robertlu1021_last_rite_(arknights)_v1.0_epoch_10.safetensors",
    match: ["Robertlu1021_last_rite_(arknights)_v1.0_epoch_10", "last_rite_(arknights)"],
    recommendedWeight: 0.8,
    defaultPreset: "identity",
    legacyDefaultPreset: "default",
    note: "配布元の推奨は0.7〜1.0。まず0.8。",
    presets: [
      {
        id: "identity",
        name: "衣装自由（キャラ特徴のみ）",
        recommendedWeight: 0.65,
        triggerWords: "last_rite_(arknights), 1girl, solo, alternate costume, gradient eyes, blue hair, blunt bangs, long hair, pointed ears, thick tail, bell hair ornament",
        negativeWords: "grey headgear, mechanical choker, bodysuit, high-leg leotard, detached sleeves, blue gloves, split cape, clothing cutout, x-shaped straps, navel cutout, hip cutouts, pelvic curtain, blue heels"
      },
      {
        id: "default",
        name: "標準衣装",
        triggerWords: "last_rite_(arknights), 1girl, solo, gradient eyes, blue hair, blunt bangs, long hair, pointed ears, thick tail, bell hair ornament, grey headgear, mechanical choker, see-though, bodysuit, high-leg leotard, detached sleeves, blue gloves, split cape, clothing cutout, x-shaped straps, navel cutout, hip cutouts, pelvic curtain, blue heels"
      }
    ]
  },
  {
    id: "dreizehn-illustrious",
    name: "ドライツェーン（Shadowverse）",
    baseModel: "Illustrious",
    versionId: 2862431,
    sourceUrl: "https://civitai.com/models/2547088",
    filename: "dreizehn_(shadowverse)_ilxl_v1.safetensors",
    match: ["dreizehn_(shadowverse)_ilxl_v1", "dreizehn shadowverse ilxl"],
    recommendedWeight: 0.9,
    defaultPreset: "identity",
    legacyDefaultPreset: "cape",
    note: "配布元推奨0.9。",
    presets: [
      {
        id: "identity",
        name: "衣装自由（キャラ特徴のみ）",
        recommendedWeight: 0.7,
        triggerWords: "aadrei, 1girl, solo, alternate costume, short hair, blue hair, braid, blue eyes",
        negativeWords: "pauldrons, hooded cape, two-sided cape, white cape, white bodysuit, side cutout, detached sleeves, white gloves, faulds, black thighhighs"
      },
      {
        id: "cape",
        name: "標準衣装・ケープあり",
        triggerWords: "aadrei, 1girl, solo, short hair, blue hair, braid, blue eyes, pauldrons, hooded cape, two-sided cape, white cape, white bodysuit, side cutout, detached sleeves, partially fingerless gloves, white gloves, faulds, black thighhighs"
      },
      {
        id: "no-cape",
        name: "標準衣装・ケープなし",
        triggerWords: "aadrei, 1girl, solo, short hair, blue hair, braid, blue eyes, white bodysuit, side cutout, detached sleeves, partially fingerless gloves, white gloves, black thighhighs"
      }
    ]
  },
  {
    id: "kuramochi-meruto-illustrious",
    name: "倉持めると（にじさんじ）",
    baseModel: "Illustrious",
    versionId: 1848430,
    sourceUrl: "https://civitai.com/models/1633032",
    filename: "kuramochi_meruto_ilxl_v1.safetensors",
    match: ["kuramochi_meruto_ilxl_v1", "kuramochi meruto ilxl"],
    recommendedWeight: 0.9,
    defaultPreset: "identity",
    legacyDefaultPreset: "outfit-1",
    note: "配布元推奨0.9。",
    presets: [
      {
        id: "identity",
        name: "衣装自由（キャラ特徴のみ）",
        recommendedWeight: 0.7,
        triggerWords: "aameruto, 1girl, solo, alternate costume, pink hair, side ponytail, hair ribbon, hair bow, blue eyes",
        negativeWords: "neck ribbon, collared shirt, white shirt, black jacket, black shorts, thigh strap, single thighhigh, black thighhighs"
      },
      {
        id: "outfit-1",
        name: "衣装1・ジャケットあり",
        triggerWords: "aameruto, 1girl, solo, pink hair, side ponytail, hair ribbon, hair bow, hair ornament, hairclip, blue eyes, neck ribbon, collared shirt, white shirt, sleeveless, off shoulder, black jacket, long sleeves, black shorts, thigh strap, single thighhigh, black thighhighs"
      },
      {
        id: "outfit-1-no-jacket",
        name: "衣装1・ジャケットなし",
        triggerWords: "aameruto, 1girl, solo, pink hair, side ponytail, hair ribbon, hair bow, hair ornament, hairclip, blue eyes, neck ribbon, collared shirt, white shirt, sleeveless, black shorts, thigh strap, single thighhigh, black thighhighs"
      },
      {
        id: "outfit-2",
        name: "衣装2・制服",
        triggerWords: "bbmeruto, 1girl, solo, long hair, pink hair, ahoge, braid, hair ornament, hair bow, earrings, blue eyes, choker, necklace, school uniform, loose bowtie, collared shirt, white shirt, off shoulder, purple jacket, long sleeves, midriff, pleated skirt, black skirt"
      }
    ]
  },
  {
    id: "ishigami-nozomi-illustrious",
    name: "石神のぞみ（にじさんじ）",
    baseModel: "Illustrious",
    versionId: 2940638,
    sourceUrl: "https://civitai.com/models/2619134",
    filename: "ishigami_nozomi_ilxl_v1.safetensors",
    match: ["ishigami_nozomi_ilxl_v1", "ishigami nozomi ilxl"],
    recommendedWeight: 0.9,
    defaultPreset: "identity",
    legacyDefaultPreset: "outfit-1",
    note: "配布元推奨0.9。",
    presets: [
      {
        id: "identity",
        name: "衣装自由（キャラ特徴のみ）",
        recommendedWeight: 0.7,
        triggerWords: "aanozomi, 1girl, solo, alternate costume, long hair, grey hair, hair bow, earrings",
        negativeWords: "choker, necktie, off shoulder, red shirt, bandages, fingerless gloves, half-skirt, red skirt, black shorts, fishnet pantyhose, red thighhighs"
      },
      {
        id: "outfit-1",
        name: "衣装1・赤黒",
        triggerWords: "aanozomi, 1girl, solo, long hair, grey hair, hair bow, black bow, hair ornament, earrings, choker, necktie, off shoulder, red shirt, bracelet, bandages, single glove, fingerless gloves, belt, half-skirt, red skirt, black shorts, fishnet pantyhose, red thighhighs"
      },
      {
        id: "outfit-2",
        name: "衣装2・悪魔パーカー",
        triggerWords: "bbnozomi, 1girl, solo, long hair, grey hair, low twintails, hair ribbon, hood up, fake horns, demon tail, necklace, clothes writing, crop top, white shirt, hooded jacket, black jacket, long sleeves, black shorts, thigh strap"
      },
      {
        id: "outfit-3",
        name: "衣装3・制服",
        triggerWords: "ccnozomi, 1girl, solo, long hair, grey hair, ponytail, hair bow, ear piercing, black choker, school uniform, black necktie, collared shirt, white shirt, grey cardigan, long sleeves, armband, plaid skirt, black skirt"
      }
    ]
  },
  {
    id: "zoe-rayne-il-v2",
    name: "Zoe Rayne（Palworld）IL v2",
    baseModel: "Illustrious",
    versionId: 2774887,
    sourceUrl: "https://civitai.com/models/272966?modelVersionId=2774887",
    filename: "ZoeRayneIXL_v4.safetensors",
    match: ["ZoeRayneIXL_v4", "Zoe Rayne IXL v4"],
    recommendedWeight: 0.8,
    defaultPreset: "identity",
    legacyDefaultPreset: "full-outfit",
    note: "配布例は0.7〜0.8。まず0.8。",
    presets: [
      {
        id: "identity",
        name: "衣装自由（キャラ特徴のみ）",
        recommendedWeight: 0.7,
        triggerWords: "zzZoe, 1girl, solo, alternate costume, pink eyes, multicolored hair, two-tone hair, split-color hair, twintails, long hair",
        negativeWords: "black hat, animal ear headwear, black choker, black jacket, cropped jacket, belt, miniskirt, black skirt, necklace, pendant, midriff, crop top"
      },
      {
        id: "full-outfit",
        name: "標準衣装",
        triggerWords: "zzZoe, 1girl, solo, pink eyes, multicolored hair, two-tone hair, split-color hair, twintails, long hair, black hat, animal ear headwear, black choker, black jacket, cropped jacket, belt, miniskirt, black skirt, necklace, pendant, midriff, crop top"
      }
    ]
  },
  {
    id: "roxy-migurdia-illustrious-v2",
    name: "ロキシー・ミグルディア v2.0",
    baseModel: "Illustrious",
    versionId: 2593646,
    sourceUrl: "https://civitai.com/models/232861?modelVersionId=2593646",
    filename: "roxy_mskt_v3-04.safetensors",
    match: ["roxy_mskt_v3-04", "roxy migurdia", "roxy mskt"],
    recommendedWeight: 0.8,
    defaultPreset: "identity",
    legacyDefaultPreset: "mage-a",
    note: "配布例を基準に0.8から。",
    presets: [
      {
        id: "identity",
        name: "衣装自由（キャラ特徴のみ）",
        recommendedWeight: 0.7,
        triggerWords: "roxy migurdia, 1girl, solo, alternate costume, blue hair, long hair, twin braids, hair between eyes, ahoge, blue eyes",
        negativeWords: "RoxyMageA, witch hat, brown cloak, white jacket, black skirt"
      },
      {
        id: "mage-a",
        name: "魔術師衣装A",
        triggerWords: "roxy migurdia, 1girl, solo, blue hair, long hair, twin braids, hair between eyes, ahoge, blue eyes, RoxyMageA, witch hat, brown cloak, white jacket, long sleeves, black skirt"
      },
      {
        id: "mage-b",
        name: "魔術師衣装B",
        triggerWords: "roxy migurdia, 1girl, solo, blue hair, long hair, twin braids, hair between eyes, blue eyes, RoxyMageB, witch hat, white capelet, white jacket, long sleeves, black skirt, black socks, white boots"
      },
      {
        id: "cozy",
        name: "部屋着・Cozy",
        triggerWords: "roxy migurdia, 1girl, solo, blue hair, long hair, twin braids, hair between eyes, blue eyes, RoxyCozy, white collared shirt, long shirt, untucked shirt, long sleeves, hoop skirt, white thigh boots"
      }
    ]
  },
  {
    id: "cure-arcana-shadow-v2",
    name: "キュアアルカナ・シャドウ v2.0",
    baseModel: "Illustrious",
    versionId: 2669932,
    sourceUrl: "https://civitai.com/models/2298144?modelVersionId=2669932",
    filename: "curearcanashadow_Illust_v2.safetensors",
    match: ["curearcanashadow_Illust_v2", "cure arcana shadow illust v2"],
    recommendedWeight: 0.8,
    defaultPreset: "identity",
    legacyDefaultPreset: "full-outfit",
    note: "配布元推奨0.8前後。",
    presets: [
      {
        id: "identity",
        name: "衣装自由（キャラ特徴のみ）",
        recommendedWeight: 0.65,
        triggerWords: "cure arcana shadow, meitantei precure!, 1girl, solo, alternate costume",
        negativeWords: "magical girl, tiara, circlet, wrist cuffs, black dress, black capelet, frills, black bow, frilled dress, black thighhighs"
      },
      {
        id: "full-outfit",
        name: "変身衣装・全身",
        triggerWords: "cure arcana shadow, meitantei precure!, 1girl, solo, magical girl, blonde hair, very long hair, multicolored hair, pink hair, gradient hair, hair bow, antenna hair, pink eyes, earrings, tiara, ahoge, two-tone hair, hair intakes, hair ornament, circlet, wrist cuffs, jewelry, black dress, black capelet, frills, black bow, frilled dress, high heels, black footwear, black thighhighs"
      },
      {
        id: "wand",
        name: "アルカナロッド持ち",
        triggerWords: "cure arcana shadow, meitantei precure!, 1girl, solo, magical girl, blonde hair, very long hair, multicolored hair, pink hair, gradient hair, hair bow, antenna hair, pink eyes, tiara, circlet, black dress, black capelet, frilled dress, black thighhighs, holding wand, wand"
      }
    ]
  }
];

export function findProfileForLora(lora) {
  const registryVersionId = Number(lora?.registry?.versionId);
  const registryModelId = Number(lora?.registry?.modelId);
  const registryMatch = LORA_PROFILES.find((profile) =>
    (Number.isInteger(registryVersionId) && registryVersionId > 0
      && Number(profile.versionId) === registryVersionId)
    || (Number.isInteger(registryModelId) && registryModelId > 0
      && profileModelId(profile) === registryModelId)
  );
  if (registryMatch) return registryMatch;

  const haystack = normalize(`${lora?.name ?? ""} ${lora?.alias ?? ""} ${lora?.displayName ?? ""}`);
  if (!haystack) return null;
  return LORA_PROFILES.find((profile) =>
    profile.match.some((candidate) => haystack.includes(normalize(candidate)))
  ) ?? null;
}

export function createRegistryProfile(lora) {
  const registry = lora?.registry;
  if (!registry || registry.category !== "character") return null;

  const triggerWords = String(registry.triggerWords ?? "").trim();
  const registeredOutfits = normalizeRegistryOutfits(registry.outfitPresets);
  const defaultOutfitWords = registeredOutfits[0]?.triggerWords || triggerWords;
  const { identityWords } = splitCharacterTriggerWords(defaultOutfitWords);
  const outfitWords = uniqueWords(registeredOutfits
    .flatMap((preset) => splitCharacterTriggerWords(preset.triggerWords).outfitWords.split(",")))
    .join(", ") || splitCharacterTriggerWords(triggerWords).outfitWords;
  const modelId = positiveInteger(registry.modelId);
  const versionId = positiveInteger(registry.versionId);
  const identity = modelId && versionId
    ? `${modelId}-${versionId}`
    : normalize(`${lora?.name ?? ""}-${registry.modelName ?? "character"}`) || "character";

  return {
    id: `civitai-${identity}`,
    name: `${registry.modelName || lora?.displayName || "Civitaiキャラクター"}（自動登録）`,
    baseModel: registry.baseModel || "不明",
    versionId,
    sourceUrl: registry.sourceUrl || "",
    recommendedWeight: Number(registry.recommendedWeight) || 0.75,
    defaultPreset: "identity",
    note: "Civitaiの専用Trigger Wordsを衣装ごとに分け、キャラ特徴と服装タグも分離した自動プリセットです。",
    presets: [
      {
        id: "identity",
        name: "衣装自由（服タグなし）",
        triggerWords: identityWords,
        negativeWords: outfitWords
      },
      ...(registeredOutfits.length
        ? registeredOutfits
        : [{
            id: "civitai-default",
            name: "Civitai登録衣装",
            triggerWords: triggerWords || "1girl, solo"
          }])
    ]
  };
}

export function splitCharacterTriggerWords(triggerWords) {
  const words = uniqueWords(String(triggerWords ?? "").split(","));
  const outfit = words.filter(isOutfitWord);
  const identity = words.filter((word) => !isOutfitWord(word));
  if (!identity.some((word) => /^1(?:girl|boy)$/i.test(word))) identity.push("1girl");
  if (!identity.some((word) => /^solo$/i.test(word))) identity.push("solo");
  if (!identity.some((word) => /^alternate costume$/i.test(word))) identity.push("alternate costume");
  return {
    identityWords: identity.join(", "),
    outfitWords: outfit.join(", ")
  };
}

export function getProfile(profileId) {
  return LORA_PROFILES.find((profile) => profile.id === profileId) ?? null;
}

export function getPreset(profile, presetId) {
  if (!profile) return null;
  return profile.presets.find((preset) => preset.id === presetId)
    ?? profile.presets.find((preset) => preset.id === profile.defaultPreset)
    ?? profile.presets[0]
    ?? null;
}

function normalize(value) {
  return String(value)
    .toLowerCase()
    .replace(/\.safetensors$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function profileModelId(profile) {
  const matched = String(profile?.sourceUrl ?? "").match(/\/models\/(\d+)/i);
  return matched ? Number(matched[1]) : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeRegistryOutfits(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value
    .filter((preset) => preset && typeof preset === "object" && String(preset.triggerWords ?? "").trim())
    .map((preset, index) => {
      let id = String(preset.id ?? `civitai-outfit-${index + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!id || id === "identity" || ids.has(id)) id = `civitai-outfit-${index + 1}`;
      ids.add(id);
      return {
        id,
        name: String(preset.name ?? `Civitai衣装${index + 1}`).trim(),
        triggerWords: String(preset.triggerWords).trim()
      };
    });
}

function uniqueWords(words) {
  const seen = new Set();
  return words
    .map((word) => word.trim())
    .filter((word) => {
      const normalized = word.toLowerCase();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function isOutfitWord(word) {
  return /\b(?:apron|armor|armour|belt|bikini|blazer|bodysuit|boot|bra|cape|capelet|cardigan|choker|cloak|coat|collar|costume|dress|footwear|garter|glove|gown|hat|headgear|heel|hood|hoodie|jacket|jeans|kimono|leotard|lingerie|loafer|necktie|nightgown|obi|outfit|pauldron|panties|pants|pantyhose|pajama|robe|sandal|shirt|shoe|shorts|skirt|sleeve|sneaker|sock|stocking|suit|sweater|swimsuit|thighhigh|tie|top|tracksuit|trousers|t-shirt|uniform|vest|yukata)s?\b/i.test(word)
    || /\b(?:clothing|clothes|dressed|off[- ]shoulder|strapless|sleeveless|high-leg|crop top|detached sleeves|wrist cuffs)\b/i.test(word);
}
