export const CHECKPOINT_PROFILES = [
  {
    id: "wai-illustrious-v17",
    name: "WAI Illustrious v17",
    family: "illustrious",
    match: [/wai.?illustrious/i, /wai.?nsfw.?illustrious/i],
    settings: profileSettings(896, 1152, 25, 6, "Euler a", "Automatic"),
    note: "普段使い向け。品質とRX 6700 XT 12GBでの扱いやすさを優先"
  },
  {
    id: "chosen-mix-xl-v41",
    name: "Chosen-mix XL v4.1",
    family: "illustrious",
    match: [/chosen.?mix.*xl.*v?4[._ -]?1/i],
    settings: profileSettings(896, 1152, 32, 5, "Euler", "Automatic"),
    note: "作者作例基準。Clip skip 2。通常生成は896×1152を安全側の初期値にする"
  },
  {
    id: "rin-flanime-illustrious",
    name: "RIN Flanime Illustrious",
    family: "illustrious",
    match: [/rin.*flanime/i, /flanime/i],
    settings: profileSettings(896, 1152, 30, 5, "Euler a", "Automatic"),
    note: "フラットアニメ向けの安定基準。Clip skip 2。Hiresは1.5倍・10〜15 Steps・Denoising 0.3前後から"
  },
  {
    id: "one-obsession-v23",
    name: "One Obsession v23",
    family: "illustrious",
    match: [/one.?obsession/i],
    settings: profileSettings(832, 1216, 20, 5, "Euler", "Karras"),
    note: "立体感寄り。まず20 Steps・CFG 5から"
  },
  {
    id: "miaomiao-realskin-eps-v14",
    name: "MiaoMiao RealSkin EPS v1.4",
    family: "illustrious",
    match: [/miaomiao.*realskin.*eps.*v?1[._ -]?4/i],
    settings: profileSettings(896, 1152, 30, 5, "Euler a", "Exponential"),
    note: "公式推奨の中心値。CFG 3.8〜6、Clip skip 2。Hiresは2倍・10 Steps・Denoising 0.2〜0.3が目安"
  },
  {
    id: "noobai-vpred-v10",
    name: "NoobAI XL V-Pred 1.0",
    family: "noobai",
    match: [/noobai.*(?:v.?pred|vpred).*v?1[._ -]?0/i],
    settings: profileSettings(832, 1216, 30, 4.5, "Euler", "Automatic", "Zero Terminal SNR"),
    note: "Euler推奨。CFG 4〜5・28〜35 Steps。Karras系Schedulerは避ける。V-PredはZero Terminal SNR"
  },
  {
    id: "obsession-vpred-v20",
    name: "Obsession V-Pred 2.0",
    family: "noobai",
    match: [/obsession.*(?:v.?pred|vpred).*v?2[._ -]?0/i],
    settings: profileSettings(768, 1280, 30, 5, "Euler a", "SGM Uniform", "Zero Terminal SNR"),
    note: "公式作例基準。Zero Terminal SNRを使用し、必要ならRescale CFG 0.2〜0.7を手動で有効化"
  },
  {
    id: "nova-anime-xl-v19",
    name: "Nova Anime XL v19",
    family: "illustrious",
    match: [/nova.?anime.?xl/i, /nova.?furry.?xl/i],
    settings: profileSettings(768, 1216, 22, 4.5, "Euler a", "Automatic"),
    note: "軽快なアニメ絵向け。CFGを上げすぎない"
  },
  {
    id: "ilustmix-v11",
    name: "iLustMix v11",
    family: "illustrious",
    match: [/ilustmix/i],
    settings: profileSettings(832, 1216, 25, 6, "Euler a", "Automatic"),
    note: "艶のあるアニメ塗り向け"
  },
  {
    id: "miaomiao-harem-v2",
    name: "MiaoMiao Harem v2",
    family: "illustrious",
    match: [/miaomiao.*harem/i],
    settings: profileSettings(832, 1216, 24, 5, "Euler a", "Automatic"),
    note: "Illustrious系の汎用設定"
  },
  {
    id: "generic-illustrious",
    name: "Illustrious汎用",
    family: "illustrious",
    match: [/illustrious/i, /illustmix/i, /ilxl/i],
    settings: profileSettings(896, 1152, 25, 5, "Euler a", "Automatic"),
    note: "個別登録のないIllustrious系Checkpoint"
  },
  {
    id: "generic-noobai",
    name: "NoobAI汎用",
    family: "noobai",
    match: [/noobai/i, /noob.?xl/i],
    settings: profileSettings(896, 1152, 25, 5, "Euler a", "Automatic"),
    note: "NoobAI系Checkpoint"
  },
  {
    id: "generic-pony",
    name: "Pony汎用",
    family: "pony",
    match: [/pony/i],
    settings: profileSettings(832, 1216, 25, 6, "Euler a", "Automatic"),
    note: "Pony系Checkpoint"
  },
  {
    id: "generic-sdxl",
    name: "SDXL汎用",
    family: "sdxl",
    match: [/sdxl/i, /sd.?xl/i, /xl.?1[._ -]?0/i],
    settings: profileSettings(896, 1152, 25, 6, "DPM++ 2M", "Karras"),
    note: "標準SDXL系Checkpoint"
  },
  {
    id: "generic-sd15",
    name: "SD 1.5汎用",
    family: "sd15",
    match: [/sd.?1[._ -]?5/i, /v1[._ -]?5/i],
    settings: profileSettings(512, 768, 24, 7, "DPM++ 2M", "Karras"),
    note: "SD 1.5系Checkpoint"
  }
];

const UNKNOWN_PROFILE = Object.freeze({
  id: "unknown",
  name: "自動判定できません",
  family: "unknown",
  match: [],
  settings: null,
  note: "プロフィールを手動で選ぶと推奨設定と互換性判定を利用できます"
});

export function inferCheckpointProfile(checkpoint) {
  const haystack = [
    checkpoint?.title,
    checkpoint?.modelName,
    checkpoint?.filename
  ].filter(Boolean).join(" ");
  return CHECKPOINT_PROFILES.find((profile) =>
    profile.match.some((pattern) => pattern.test(haystack))
  ) ?? UNKNOWN_PROFILE;
}

export function getCheckpointProfile(profileId) {
  return CHECKPOINT_PROFILES.find((profile) => profile.id === profileId)
    ?? (profileId === UNKNOWN_PROFILE.id ? UNKNOWN_PROFILE : null);
}

export function normalizeBaseModelFamily(baseModel) {
  const value = String(baseModel ?? "").trim().toLowerCase();
  if (!value || value === "不明" || value === "unknown") return "unknown";
  if (/illustrious|illust(?:rious)?|ilxl/.test(value)) return "illustrious";
  if (/noob.?ai|noob.?xl/.test(value)) return "noobai";
  if (/pony/.test(value)) return "pony";
  if (/krea.?2/.test(value)) return "krea2";
  if (/anima/.test(value)) return "anima";
  if (/flux/.test(value)) return "flux";
  if (/sd.?1[._ -]?5|stable diffusion 1[._ -]?5/.test(value)) return "sd15";
  if (/sdxl|sd.?xl|xl.?1[._ -]?0/.test(value)) return "sdxl";
  return "unknown";
}

export function assessLoraCompatibility(checkpointProfile, baseModel) {
  const checkpointFamily = checkpointProfile?.family ?? "unknown";
  const loraFamily = normalizeBaseModelFamily(baseModel);
  if (checkpointFamily === "unknown" || loraFamily === "unknown") {
    return {
      level: "unknown",
      label: "ベース不明",
      message: "配布元のベースモデル情報がないため互換性を判定できません"
    };
  }
  if (checkpointFamily === loraFamily) {
    return {
      level: "compatible",
      label: "対応",
      message: `${baseModel}向け`
    };
  }
  if (
    (checkpointFamily === "illustrious" && loraFamily === "noobai")
    || (checkpointFamily === "noobai" && loraFamily === "illustrious")
  ) {
    return {
      level: "caution",
      label: "近縁・要確認",
      message: `${baseModel}向け。読み込めますが再現性が落ちる場合があります`
    };
  }
  return {
    level: "incompatible",
    label: "非対応の可能性",
    message: `${baseModel}向けのLoRAです。現在の${checkpointProfile.name}とはベースモデルが一致しません`
  };
}

function profileSettings(width, height, steps, cfgScale, samplerName, scheduler, noiseSchedule = "Automatic") {
  return { width, height, steps, cfgScale, samplerName, scheduler, noiseSchedule };
}
