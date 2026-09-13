import {element,button} from "../primitives.js";
import {createStudioDialog,field} from "../settings/dialog.js";
import {parseAiPromptOutput} from "../../../prompt-import.js";
import {PROMPT_FIELDS,formatTriggerWord,buildFinalPrompt} from "../../../structured-prompt.js";

export function preparePromptImport(text) {
  if (!text.trim()) throw new Error("取り込むPromptを貼り付けてください。");
  const parsed=parseAiPromptOutput(text);
  const sections={...parsed.sections};
  for(const trigger of parsed.triggerWords){
    const key=PROMPT_FIELDS.includes(trigger.field)?trigger.field:"extra";
    sections[key]=[sections[key],formatTriggerWord(trigger)].filter(Boolean).join(", ");
  }
  const structured=parsed.hasSections || parsed.triggerWords.length>0;
  const patch=structured ? {sections} : parsed.combined ? {positive:parsed.combined} : !parsed.recognized ? {positive:text.trim()} : {};
  if(parsed.negativePrompt)patch.negative=parsed.negativePrompt;
  return {patch,preview:structured?buildFinalPrompt(sections):patch.positive??"（Positive Promptは変更しません）",
    note:!parsed.recognized?"見出しなしの文章をRaw Promptとして取り込みます。":structured?"Structuredの6sectionを取り込み内容で置き換えます。":"認識したPromptを取り込みます。",
    warnings:parsed.recognized?[...parsed.unknownHeadings,...parsed.ignoredLines]:[]};
}
export function createPromptImportDialog({onApply}) {
  const dialog=createStudioDialog("Import Prompt");
  const input=element("textarea",{rows:10,placeholder:"Character: …\nStyle: …\nNegative Prompt: …"});
  const preview=element("textarea",{rows:6,readonly:""});
  const note=element("p"),warning=element("p",{class:"panel-intro"}),status=element("p",{role:"status"});
  let prepared,locked=true;
  const apply=button("Promptを取り込む",{onClick:async()=>{
    if(locked||!prepared)return;
    try {await onApply(prepared.patch);dialog.close();}catch(error){status.textContent=error.message;}
  }});
  function update(){
    status.textContent="";
    try{prepared=preparePromptImport(input.value);preview.value=prepared.preview;note.textContent=prepared.note;warning.textContent=prepared.warnings.length?"取り込まれない行: "+prepared.warnings.join(" / "):"Negativeの記載がない場合は、現在のNegativeを保持します。";}
    catch{prepared=null;preview.value="";note.textContent="分割Prompt、Final Prompt、見出しなしのRaw Promptを貼り付けられます。";warning.textContent="";}
    apply.disabled=locked||!prepared;
  }
  input.addEventListener("input",update);
  dialog.root.classList.add("prompt-import-dialog");
  dialog.body.append(field("Import text",input),note,field("Import preview",preview),warning,status,apply);
  update();
  return {...dialog,open(){dialog.open();input.focus();},render(snapshot){locked=!snapshot.ready||snapshot.generation.busy||snapshot.selectingModel||snapshot.runtime.switching||snapshot.reusing;input.disabled=locked;apply.disabled=locked||!prepared;}};
}
