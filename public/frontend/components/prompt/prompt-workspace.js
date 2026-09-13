import {PROFILE_SECTIONS, normalizeSectionProfiles} from "../../../section-profiles.js";
import {createSectionProfileControls} from "./section-profile-controls.js";
import { checkpointStyleSource, isCheckpointStyleSource } from "../../../checkpoint-style-profiles.js";
import { element, button } from "../primitives.js";
import {outfitSourceLoraName} from "../../../lora-outfit-selection.js";
import { PROMPT_FIELDS, PROMPT_FIELD_LABELS, syncTriggerWords, triggerKey } from "../../../structured-prompt.js";

export function createPromptWorkspace({ onPrompt, workspace }) {
  let snapshot;
  let returnFocus;
  const fields = new Map();
  const triggerGroups = new Map();
  const profileControls = new Map();
  const profileHosts = new Map();
  const rawProfiles=element("div",{class:"raw-section-profiles"});
  function managedToggle(trigger,active,locked,target){
    const control=button(active?"有効":"無効",{className:"control managed-trigger-toggle","aria-label":`${trigger.text}を${active?"無効":"有効"}にする`,"aria-pressed":String(active),onClick:()=>workspace.setManagedTriggerEnabled(target,!active)});
    control.disabled=locked;
    return control;
  }
  function createTriggerGroup(label) {
    const summary=element("summary");
    const body=element("div",{class:"trigger-group-content"});
    const root=element("details",{class:"managed-triggers","aria-label":`${label} Trigger Words`},[summary,body]);
    let previous;
    return {root,render(triggers,loras,locked){
      summary.textContent=`Trigger Words · ${triggers.length}`;
      const key=JSON.stringify([triggers,loras.map(lora=>[lora.name,lora.enabled]),locked]);
      if(key===previous)return;previous=key;
      body.replaceChildren(...triggers.map(trigger=>{
        const sources=trigger.sourceLoraIds ?? [];
        const selected=trigger.enabled!==false;
        const sourceActive=trigger.profileName ? trigger.sourceEnabled!==false : !sources.length || sources.some(id=>checkpointStyleSource(id) || loras.some(lora=>lora.name===(outfitSourceLoraName(id)||id)&&lora.enabled!==false));
        const active=selected&&sourceActive;
        const toggle=trigger.managementTarget ? managedToggle(trigger,selected,locked,trigger.managementTarget) : null;
        return element("div",{class:"managed-trigger-row"},[
          element("div",{class:"managed-trigger-heading"},[element("span",{text:trigger.text}),toggle]),
          element("small",{text:`${trigger.profileName ? `${trigger.profileName} · プロファイル` : sources.map(id=>checkpointStyleSource(id)?`${checkpointStyleSource(id).label} · Checkpoint`:outfitSourceLoraName(id)?`${outfitSourceLoraName(id)} · 衣装`:id).join(" / ") || "登録タグ"}${trigger.weight!==1?` · Weight ${trigger.weight}`:""} · ${active?"有効":"無効"}`})
        ]);
      }));
      if(!triggers.length)body.append(element("small",{text:"登録されたTrigger Wordはありません。"}));
    }};
  }
  function createCheckpointTriggerGroup(label,kind) {
    const summary=element("summary");
    const body=element("div",{class:"trigger-group-content"});
    const root=element("details",{class:"managed-triggers checkpoint-managed-triggers","aria-label":label},[summary,body]);
    let previous;
    return {root,render(triggers,profile,locked){
      summary.textContent=`${label} · ${triggers.length}`;
      const key=JSON.stringify([triggers,profile,locked]);
      if(key===previous)return;previous=key;
      body.replaceChildren(...triggers.map(trigger=>element("div",{class:"managed-trigger-row"},[
        element("div",{class:"managed-trigger-heading"},[
          element("span",{text:trigger.text}),
          managedToggle(trigger,trigger.enabled!==false,locked,{kind:`checkpoint-${kind}`,id:trigger.managementId})
        ]),
        element("small",{text:`${trigger.sourceCheckpoint || profile?.label || "Checkpoint"} · ${trigger.enabled===false?"無効":"有効"}`})
      ])));
      if(profile)body.append(element("p",{class:"prompt-mode-note"},[
        element("span",{text:`${profile.note} `}),
        element("a",{href:profile.source,target:"_blank",rel:"noopener noreferrer",text:"配布元"})
      ]));
      if(!triggers.length)body.append(element("small",{text:"現在のCheckpointに登録されたTriggerはありません。"}));
    }};
  }
  const sections = element("div", { class: "prompt-sections" });
  for (const key of PROMPT_FIELDS) {
    const input = element("textarea", { id: `prompt-section-${key}`, rows: "3", spellcheck: "false" });
    input.addEventListener("input", () => onPrompt({ sections: { ...snapshot.prompt.structuredPrompt, [key]: input.value } }));
    fields.set(key, input);
    const triggers=createTriggerGroup(PROMPT_FIELD_LABELS[key]);triggerGroups.set(key,triggers);
    const heading=element("div",{class:"prompt-section-heading"},[element("label",{for:input.id,text:PROMPT_FIELD_LABELS[key]})]);
    const host=element("div",{class:"prompt-section"},[
      heading,input,triggers.root
    ]);
    sections.append(host);
    if(workspace && PROFILE_SECTIONS.includes(key)){const control=createSectionProfileControls({field:key,label:PROMPT_FIELD_LABELS[key],workspace});profileControls.set(key,control);profileHosts.set(key,heading);heading.append(control.root);}
  }
  const managed = createTriggerGroup("Raw Prompt");
  const checkpointPositive = createCheckpointTriggerGroup("Checkpoint Positive Trigger","positive");
  const checkpointNegative = createCheckpointTriggerGroup("Checkpoint Negative Trigger","negative");
  const raw = element("textarea", { id: "prompt-raw", "aria-label": "Raw Prompt", rows: "12", spellcheck: "false" });
  raw.addEventListener("input", () => onPrompt({ positive: raw.value }));
  const rawArea = element("label", { class: "prompt-raw-area", for: raw.id }, [element("span", { text: "Raw Prompt" }), raw,
    element("small", { text: "送信するPositive Promptを直接編集。LoRA処理後の正確な内容はFinal Promptで確認できます。" })]);
  const negative = element("textarea", { id: "prompt-negative", rows: "3", spellcheck: "false" });
  negative.addEventListener("input", () => onPrompt({ negative: negative.value }));
  const final = element("textarea", { id: "prompt-final", readonly: "", rows: "12" });
  const finalNegative = element("textarea", { id: "prompt-final-negative", readonly: "", rows: "3" });
  const structuredButton = button("Structured", { onClick: () => onPrompt({ mode: "structured" }) });
  const rawButton = button("Raw", { onClick: () => onPrompt({ mode: "raw" }) });
  const modeNote = element("p", { class: "prompt-mode-note" });
  const close = button("Canvasへ戻る", { glyph: "close", onClick: () => root.close() });
  const root = element("dialog", { class: "prompt-workspace", "aria-labelledby": "prompt-workspace-title" }, [
    element("header", { class: "prompt-workspace-heading" }, [element("div", {}, [element("small", { text: "COMPOSE / PROMPT WORKSPACE" }), element("h1", { id: "prompt-workspace-title", text: "構造プロンプト" })]), close]),
    element("div", { class: "prompt-mode-controls", "aria-label": "Prompt mode" }, [structuredButton, rawButton, modeNote]),
    element("div", { class: "prompt-workspace-body" }, [
      element("div", { class: "prompt-editors" }, [sections, rawArea, rawProfiles, managed.root,
        element("label", { class: "prompt-negative-area", for: negative.id }, [element("span", { text: "Negative Prompt" }), negative]),
        element("section", {class:"checkpoint-trigger-management","aria-label":"Checkpoint Trigger management"},[
          checkpointPositive.root,checkpointNegative.root
        ])]),
      element("aside", { class: "prompt-final-preview", "aria-label": "送信内容のプレビュー" }, [
        element("h2", { text: "Final Prompt" }), element("p", { text: "生成requestのPositive / Negative。現在のmodeとLoRA処理を反映した値です。" }),
        element("label", { for: final.id, text: "Final Positive Prompt" }), final,
        element("label", { for: finalNegative.id, text: "Final Negative Prompt" }), finalNegative,
        element("small", { text: "この内容をGenerateで送信します。編集・previewだけでは生成を開始しません。" })])])
  ]);
  root.addEventListener("close", () => { if (returnFocus?.isConnected) returnFocus.focus(); });
  return { root, open(key) {
    returnFocus = document.activeElement;
    if (!root.open) root.showModal();
    (key === "negative" ? negative : key === "final" ? final : snapshot.prompt.rawPromptOverride ? raw : fields.get(key) ?? fields.get(PROMPT_FIELDS[0])).focus();
  }, render(value) {
    snapshot = value;
    const locked = !value.ready || value.generation.busy || value.selectingModel || value.runtime.switching || value.reusing;
    for (const input of [...fields.values(), raw, negative, structuredButton, rawButton]) input.disabled = locked;
    const prompt = value.prompt;
    const isRaw = prompt.rawPromptOverride;
    rawProfiles.hidden=!isRaw;
    for(const [key,control] of profileControls){const host=isRaw?rawProfiles:profileHosts.get(key);if(control.root.parentElement!==host)host.append(control.root);control.render(value,locked);}
    const profile=prompt.checkpointStyle;
    const checkpointPositiveRows=prompt.checkpointPositiveTriggers ?? [];
    const triggers=(prompt.appliedTriggerWords ?? []).flatMap(trigger=>{
      const sources=(trigger.sourceLoraIds ?? []).filter(id=>!isCheckpointStyleSource(id));
      if(sources.length)return [{...trigger,sourceLoraIds:sources,managementTarget:{kind:"applied",id:trigger.id}}];
      const checkpointTrigger=checkpointPositiveRows.find(item=>triggerKey(item.text)===triggerKey(trigger.text));
      return checkpointTrigger ? [{...trigger,enabled:checkpointTrigger.enabled,managementTarget:{kind:"checkpoint-positive",id:checkpointTrigger.managementId}}] : [];
    });
    checkpointPositive.render(checkpointPositiveRows,profile,locked);
    checkpointNegative.render(prompt.checkpointNegativeTriggers ?? [],profile,locked);
    // Display projection only: profile content is already composed by the draft.
    const profileTriggers=Object.entries(normalizeSectionProfiles(prompt.sectionProfiles)).flatMap(([field,p])=>
      syncTriggerWords([],[{id:`section-profile:${field}`,targetField:field,triggerWords:p.text}]).triggers.map(trigger=>{
        const key=triggerKey(trigger.text),disabled=(p.disabledTriggerKeys ?? []).includes(key);
        return {...trigger,profileName:p.name,enabled:!disabled,sourceEnabled:p.enabled,managementTarget:{kind:"section-profile",field,key}};
      }));
    const visibleTriggers=[...triggers,...profileTriggers];
    for(const [key,group] of triggerGroups)group.render(visibleTriggers.filter(trigger=>trigger.targetField===key),value.loras,locked);
    managed.root.hidden=!isRaw;managed.render(visibleTriggers,value.loras,locked);
    sections.hidden = isRaw; rawArea.hidden = !isRaw;
    structuredButton.setAttribute("aria-pressed", String(!isRaw)); rawButton.setAttribute("aria-pressed", String(isRaw));
    modeNote.textContent = isRaw ? "Rawが生成に使用されます。Structuredの各sectionは保持されています。" : "6つのsectionからFinal Promptを組み立てます。Rawの編集内容は切替後も保持します。";
    for (const [key, input] of fields) if (input.value !== prompt.structuredPrompt[key]) input.value = prompt.structuredPrompt[key];
    for (const [input, text] of [[raw, prompt.rawPrompt], [negative, prompt.negativePrompt], [final, prompt.prompt], [finalNegative, prompt.finalNegativePrompt]]) {
      if (input.value !== text) input.value = text;
    }
  } };
}
