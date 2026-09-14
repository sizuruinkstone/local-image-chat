import {profileSections} from "../../../section-profiles.js";
import {element, button} from "../primitives.js";
import {PROMPT_FIELDS,PROMPT_FIELD_LABELS} from "../../../structured-prompt.js";

export function resultMetadataRows(record, image) {
  const p=record.settings ?? {};
  return [
    ["Checkpoint",p.checkpointModelName || p.checkpoint || "—"],
    ["Runtime",record.runtime?.label || record.runtime?.id || "—"],
    ["Resolution",p.width && p.height ? `${p.width} × ${p.height}` : "—"],
    ["Seed",String(image?.seed ?? "—")],
    ["Sampler",p.samplerName || "—"], ["Scheduler",p.scheduler || p.noiseSchedule || "—"],
    ["Steps",String(p.steps ?? "—")], ["CFG",String(p.cfgScale ?? "—")]
  ];
}
export const resultNegativePrompt = record => record?.effectiveNegativePrompt || record?.negativePrompt || "";
export function resultPrompt(record) {
  if (record?.structuredPrompt && record.rawPromptOverride !== true) {
    const combined=profileSections(record.structuredPrompt,record.sectionProfiles);
    const sections=PROMPT_FIELDS.flatMap(field=>{
      const value=String(combined[field] ?? "").trim();
      return value ? [`${PROMPT_FIELD_LABELS[field]}: ${value}`] : [];
    });
    if(sections.length)return sections.join("\n");
  }
  return record?.prompt || "";
}
export function createResultMetadata() {
  let record, image, revision=0;
  const values=element("dl",{class:"metadata-values"});
  const loras=element("ul",{class:"metadata-loras"});
  const status=element("p",{role:"status",class:"metadata-copy-status"});
  const prompt=element("p",{class:"metadata-prompt"}), negative=element("p",{class:"metadata-prompt"}), raw=element("pre",{class:"metadata-raw"});
  const section=(label,node,open=false)=>element("details",open?{open:""}:{},[element("summary",{text:label}),node]);
  async function copy(kind) {
    const version=revision;
    try {
      const text=kind==="prompt" ? resultPrompt(record) : [
        ...resultMetadataRows(record,image).map(([key,value])=>`${key}: ${value}`),
        "", "LoRA", ...(record.loras ?? []).map(lora=>`${lora.name}: ${lora.weight}${lora.enabled===false?" (disabled)":""}`),
        "", "Prompt", resultPrompt(record), "", "Negative Prompt",resultNegativePrompt(record)
      ].join("\n");
      await navigator.clipboard.writeText(text);
      if(version===revision)status.textContent="コピーしました";
    } catch { if(version===revision)status.textContent="コピーできませんでした。表示された文章を選択してコピーしてください。"; }
  }
  const root=element("div",{class:"readable-metadata"},[values,element("h4",{text:"Active LoRA"}),loras,
    element("div",{class:"metadata-copy-actions"},[button("Promptをコピー",{onClick:()=>copy("prompt")}),button("生成情報をコピー",{onClick:()=>copy("all")})]),status,
    section("Prompt",prompt,true),section("Negative Prompt",negative),section("Raw Metadata",raw)]);
  return {root,render(value,selectedImage){
    record=value;image=selectedImage;revision++;status.textContent="";
    values.replaceChildren(...resultMetadataRows(record,image).map(([key,value])=>element("div",{},[element("dt",{text:key}),element("dd",{text:value})])));
    loras.replaceChildren(...(record.loras?.length ? record.loras.map(lora=>element("li",{},[element("span",{text:lora.name}),element("strong",{text:`${lora.weight}${lora.enabled===false?" · disabled":""}`} )])) : [element("li",{text:"なし"})]));
    prompt.textContent=resultPrompt(record) || "—";negative.textContent=resultNegativePrompt(record) || "—";
    raw.textContent=JSON.stringify({...record,selectedImage:image},null,2);
  }};
}
