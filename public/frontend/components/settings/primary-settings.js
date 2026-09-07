import { element, button } from "../primitives.js";
import { createStudioDialog, field, syncValue } from "./dialog.js";
export function createPrimarySettings({ onParameters, onWeight, onToggle, onRemove, onResultSeed }) {
  const dialog = createStudioDialog("制作設定");
  let snapshot;
  const dimensions = element("p");
  const presets = element("div", { class: "resolution-presets" });
  for (const [label, width, height] of [["Square",1024,1024],["Portrait",896,1152],["Landscape",1152,896],["Wide",1344,768]]) {
    presets.append(button(`${label} · ${width} × ${height}`, { onClick: () => onParameters({ width, height }) }));
  }
  const rotate = button("縦横を入れ替える", { onClick: () => onParameters({ width: snapshot.parameters.height, height: snapshot.parameters.width }) });
  const seed = element("input", { type: "number", min: "-1", step: "1" });
  seed.addEventListener("change", () => { if (seed.reportValidity()) onParameters({ seed: Number(seed.value) }); });
  const count = element("select");
  count.append(...[1,2,3,4].map((value) => element("option", { value, text: String(value) })));
  count.addEventListener("change", () => onParameters({ candidateCount: Number(count.value) }));
  const seedReuse = button("ResultのSeedを使う", { onClick: onResultSeed });
  const loras = element("div", { class: "active-lora-list" });
  let loraKey = "";
  const custom = element("details", {}, [element("summary", { text: "Custom dimensions" })]);
  const width = element("input", { type: "number", min: "64", max: "2048", step: "8" });
  const height = element("input", { type: "number", min: "64", max: "2048", step: "8" });
  for (const [key,input] of [["width",width],["height",height]]) input.addEventListener("change", () => { if (input.reportValidity()) onParameters({ [key]: Number(input.value) }); });
  custom.append(field("Width",width),field("Height",height));
  dialog.body.append(element("h3", { text: "Resolution" }),dimensions,presets,rotate,custom,
    field("Seed",seed),button("Random seed (−1)",{onClick:()=>onParameters({seed:-1})}),seedReuse,field("Candidates",count),
    element("h3", { text: "Active LoRA" }),loras,element("small",{text:"素材の追加・並べ替えはPrompt DockのBrowse LoRAから。"}));
  return { ...dialog, render(value, view) {
    snapshot = value;
    const p=value.parameters;
    dimensions.textContent = `${p.width ?? "—"} × ${p.height ?? "—"} · ${p.width === p.height ? "Square" : p.width > p.height ? "Landscape" : "Portrait"}`;
    for (const [input,v] of [[seed,p.seed],[count,p.candidateCount ?? 1],[width,p.width],[height,p.height]]) syncValue(input,v);
    const next = JSON.stringify(value.loras);
    if (next !== loraKey) {
      loraKey = next;
      loras.replaceChildren(...value.loras.map((lora) => {
        const weight = element("input", { type:"number", step:"0.05", "aria-label": `${lora.name} weight`, value:lora.weight });
        weight.addEventListener("change",()=>{if(weight.reportValidity())onWeight(lora.name,Number(weight.value));});
        return element("div",{class:"active-lora-row"},[element("strong",{text:lora.name}),weight,
          button(lora.enabled === false ? "Enable" : "Disable",{ "aria-label":`${lora.name} ${lora.enabled === false ? "Enable" : "Disable"}`,onClick:()=>onToggle(lora.name)}),
          button("Remove",{ "aria-label":`${lora.name} Remove`,onClick:()=>onRemove(lora.name)})]);
      }));
      if (!value.loras.length) loras.append(element("p",{text:"Active LoRAなし。Prompt中のLoRA指定や明示的なmetadata reuseで反映されます。"}));
    }
    for(const control of dialog.body.querySelectorAll("button,input,select"))control.disabled=view.locked;
    seedReuse.disabled=view.locked || !value.currentImage;
  } };
}
