import { appendTriggersToRawPrompt, splitTriggerText, syncTriggerWords, removeTriggersForLora, triggerKey } from "./structured-prompt.js";

// Creator recommendations checked through 2026-09-10; exact installed versions only.
export const CHECKPOINT_STYLE_PROFILES = [
  {
    id: "checkpoint-style:ed32d6584f", hash: "ed32d6584f", filename: "oneObsessionAnima_v30.safetensors",
    label: "One obsession Anima v3.0",
    source: "https://civitai.com/models/2695493?modelVersionId=3190113",
    words: "masterpiece, best quality, score_9, score_8, score_7, absurdres, newest, very aesthetic, amazing quality, highres",
    negativeWords: "worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, lowres, censor",
    note: "作者のPositive推奨と公開作例で共通するNegative品質タグを適用。レーティング指定のsensitiveは自動追加しません。"
  },
  {
    id: "checkpoint-style:2acbd9f1d5", hash: "2acbd9f1d5", filename: "oneObsessionAnima_v40.safetensors",
    label: "One obsession Anima v4.0",
    source: "https://civitai.com/models/2695493?modelVersionId=3301424",
    words: "masterpiece, best quality, score_9, score_8, score_7, absurdres, newest, very aesthetic, amazing quality, highres",
    negativeWords: "worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, lowres",
    note: "v4.0の作者共通推奨Promptから品質タグを登録。レーティング指定のsensitiveと成人表現へ干渉するcensor、画師タグ、人物・構図指定は自動追加しません。"
  },
  {
    id: "checkpoint-style:fcf423c227", hash: "fcf423c227", filename: "silvermoonmixAnima_v23.safetensors",
    label: "SilvermoonMix Anima Evolved v2.3",
    source: "https://civitai.com/models/2639339?modelVersionId=3217855",
    words: "",
    negativeWords: "",
    note: "v2.3は中立的な画風で@画師タグを任意指定する設計。作者がまずNegativeなしを推奨し、公開された固定Positiveもないため自動タグを追加しません。"
  },
  {
    id: "checkpoint-style:7648dcc42b", hash: "7648dcc42b", filename: "miaomiaoRealskin_anima13.safetensors",
    label: "MiaoMiao RealSkin Anima v1.3",
    source: "https://civitai.com/models/2026594?modelVersionId=3265292",
    words: "best quality, score_7, score_9, very aesthetic, ultra detailed, high contrast, photorealistic, raw photo",
    negativeWords: "worst quality, low quality, score_1, score_2, score_3, artist name",
    note: "Anima1.3固有の作者推奨から品質・写実画風タグだけを登録。sensitive/explicit、fair skin、photo backgroundは内容や人物属性を固定するため自動追加しません。"
  },
  {
    id: "checkpoint-style:0b3020d1b9", hash: "0b3020d1b9", filename: "anima29B_v10.safetensors",
    label: "Anima-2.9B v1.0",
    source: "https://civitai.com/models/2855007?modelVersionId=3224434",
    words: "highres, absurdres",
    note: "作者が常用を推奨する品質タグ。年代・@画師タグも推奨ですが、作風に合わせて本文で指定してください。Steps 28–50 / CFG 3.5–5は参考値で、自動変更しません。"
  },
  {
    id: "checkpoint-style:0aa6dd4537", hash: "0aa6dd4537", filename: "chosenIrisesMix_v20Anima.safetensors",
    label: "chosen Irises-mix v2.0 anima",
    source: "https://civitai.com/models/60196/chosen-irises-mix?modelVersionId=3253659",
    words: "masterpiece, best quality, score_7, highres, absurdres",
    note: "作者のv2.0 anima推薦Style 1/2に共通する品質タグだけを適用。安全性・画師・構図・目・背景などの条件付きタグと、明示されたNegativeのない項目は自動追加しません。"
  },
  {
    id: "checkpoint-style:04045f043f", hash: "04045f043f", filename: "chosenMixAnima_v10.safetensors",
    label: "Chosen-mix Anima v1.0",
    source: "https://civitai.com/models/2839674/chosen-mixanima?modelVersionId=3205319",
    words: "masterpiece, best quality, score_7, highres, absurdres",
    negativeWords: "worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, lowres",
    note: "v1.0の作者が最推奨する品質語と公開作例に共通する品質タグだけを適用。画師・構図・衣装・chosen style 3・安全性指定などの条件付きタグは自動追加しません。Negativeは同versionの公開作例に共通する品質/破綻抑制語だけを登録し、animal earやNSFW等の内容条件は除外します。"
  },
  {
    id: "checkpoint-style:9d5a1e1393", hash: "9d5a1e1393", filename: "waiANIMA_v10Base10.safetensors",
    label: "WAI-ANIMA v1.0(base 1.0)",
    source: "https://civitai.com/models/2544636/wai-anima?modelVersionId=2983680",
    words: "masterpiece, best quality, score_7",
    negativeWords: "worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, lowres, censor",
    note: "v1.0(base 1.0)の作者記載Positive Prompt / Negative Promptを登録。BASE ANIMA preview3にだけあるscore_9/score_8は別versionのため除外。"
  },
  {
    id: "checkpoint-style:fd5e870b5b", hash: "fd5e870b5b", filename: "cyberrealisticXL_v100.safetensors",
    label: "CyberRealistic XL v10.0",
    source: "https://civitai.com/models/312530/cyberrealistic-xl?modelVersionId=2840768",
    words: "",
    negativeWords: "cartoon, illustration, anime, painting, CGI, 3D render, low quality, watermark, logo, label",
    note: "v10.0の作者カードにPositive指定はないため追加しない。作者のExample negative promptだけを登録し、モデル説明のphotorealisticは自動タグ化しません。"
  },
  {
    id: "checkpoint-style:be39f808fe", hash: "be39f808fe", filename: "fnMomentAnimaTurbo_v40NoTurbo.safetensors",
    label: "Fn-Moment Anima-Turbo v4.0-no turbo",
    source: "https://civitai.com/models/2733842/fn-moment-anima-turbo?modelVersionId=3274802",
    words: "",
    negativeWords: "",
    note: "作者がNegative不要と明記。任意かつ相互に競合するstyle tagsは全生成へ自動適用せず、v4.0-no turbo固有の自動Positiveも登録しません。"
  },
  {
    id: "checkpoint-style:77ba7554fd", hash: "77ba7554fd", filename: "fnMixAnimaTurbo_baseNoTurbo.safetensors",
    label: "Fn-Mix Anima-Turbo Base-no turbo",
    source: "https://civitai.com/models/2719904/fn-mix-anima-turbo?modelVersionId=3228288",
    words: "",
    negativeWords: "",
    note: "Base-no turboの作者がNegative不要と明記。画師タグと、halo発生時だけ使うno halo/no hatは自動適用しません。"
  },
  {
    id: "checkpoint-style:5d1c3f154d", hash: "5d1c3f154d", filename: "obsessionIllustrious_vPredV20.safetensors",
    label: "Obsession (Illustrious-XL) v-pred_v2.0",
    source: "https://civitai.com/models/820208/obsession-illustrious-xl?modelVersionId=2234052",
    words: "very aesthetic, masterpiece, best quality",
    note: "v-pred_v2.0のQuality Tags列の上位3つだけを登録。v-pred_v1.1にだけ記載されたNegative Promptsは別versionのため流用しません。"
  },
  {
    id: "checkpoint-style:6f25c44965", hash: "6f25c44965", filename: "photanima_v24Turbo.safetensors",
    label: "Photanima v2.4 Turbo",
    source: "https://civitai.com/models/2645333/photanima?modelVersionId=3272949",
    words: "",
    note: "v2.4 Turboの作者がmasterpiece/absurdres/hyperreal等の過剰なfluffは画質を損なうと説明。v2.4の明示Positive/Negative推奨はないため自動タグを登録しません。"
  },
  {
    id: "checkpoint-style:aca019d4aa", hash: "aca019d4aa", filename: "fnMomentAnimaTurbo_v20.safetensors",
    label: "Fn-Moment Anima-Turbo v2.0",
    source: "https://civitai.com/models/2733842/fn-moment-anima-turbo?modelVersionId=3078189",
    words: "",
    negativeWords: "",
    note: "v2.0の作者説明でNegative不要。任意かつ相互に競合するstyle tagsは全生成へ自動適用せず、固有の自動Positiveも登録しません。"
  },
  {
    id: "checkpoint-style:f116b0c78f", hash: "f116b0c78f", filename: "waiIllustriousSDXL_v170.safetensors",
    label: "WAI-illustrious-SDXL v17.0",
    source: "https://civitai.com/models/827184/wai-illustrious-sdxl?modelVersionId=2883731",
    words: "masterpiece, best quality, amazing quality",
    negativeWords: "bad quality, worst quality, worst detail, sketch, censor",
    note: "v17の作者カード記載Positive Prompt / Negative Promptを登録。過剰なquality/aesthetic tagsと安全性ratingのnsfwは自動追加しません。"
  }
];

export const isCheckpointStyleSource = id => String(id).startsWith("checkpoint-style:");
export const checkpointStyleSource = id => CHECKPOINT_STYLE_PROFILES.find(profile => profile.id === id);
export function checkpointStyleProfile(checkpoint) {
  if (!checkpoint) return null;
  const title = typeof checkpoint === "string" ? checkpoint : checkpoint.title ?? checkpoint.filename ?? "";
  const hash = (checkpoint.hash || title.match(/\[([a-f0-9]+)\]$/i)?.[1] || "").toLowerCase();
  const filename = title.replace(/\s*\[[^\]]+\]$/, "").split(/[\\/]/).at(-1).toLowerCase();
  return CHECKPOINT_STYLE_PROFILES.find(profile => hash ? hash === profile.hash : filename === profile.filename.toLowerCase()) ?? null;
}

// Derived from the selected model, never baked into manual text or persisted draft.
export function withCheckpointStyle(triggers, checkpoint) {
  const result = structuredClone(triggers).flatMap(trigger =>
    (trigger.sourceLoraIds ?? []).filter(isCheckpointStyleSource).reduce((items, id) => removeTriggersForLora(items, id), [trigger]));
  const profile = checkpointStyleProfile(checkpoint);
  if (!profile) return result;
  for (const trigger of syncTriggerWords([], [{id: profile.id, targetField: "style", triggerWords: profile.words}]).triggers) {
    const existing = result.find(item => triggerKey(item.text) === triggerKey(trigger.text));
    if (existing) existing.sourceLoraIds.push(profile.id);
    else result.push(trigger);
  }
  return result;
}

export function checkpointPositiveTriggers(checkpoint) {
  const profile = checkpointStyleProfile(checkpoint);
  if (!profile?.words?.trim()) return [];
  return syncTriggerWords([], [{id: profile.id, targetField: "style", triggerWords: profile.words}]).triggers.map(trigger => ({
    ...trigger,
    sourceId: profile.id,
    sourceCheckpoint: profile.label,
    source: profile.source,
    note: profile.note
  }));
}

// Negative checkpoint tags are intentionally independent from Positive
// appliedTriggerWords: the same text may validly exist on both sides.
export function checkpointNegativeTriggers(checkpoint) {
  const profile = checkpointStyleProfile(checkpoint);
  if (!profile?.negativeWords?.trim()) return [];
  const seen = new Set();
  return splitTriggerText(profile.negativeWords).flatMap((text) => {
    const key = triggerKey(text);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{
      id: `${profile.id}:negative:${key}`,
      text,
      sourceId: profile.id,
      sourceCheckpoint: profile.label,
      enabled: true,
      source: profile.source,
      note: profile.note
    }];
  });
}

export function withCheckpointNegative(userNegativePrompt, checkpoint) {
  return appendTriggersToRawPrompt(userNegativePrompt, checkpointNegativeTriggers(checkpoint));
}
