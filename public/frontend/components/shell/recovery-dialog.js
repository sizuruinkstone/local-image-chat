import { element, button } from "../primitives.js";
import { createStudioDialog } from "../settings/dialog.js";
export function createRecoveryDialog() {
  const dialog=createStudioDialog("Recovery approval");
  const message=element("p");const settings=element("pre",{class:"result-metadata"});
  let resolve;
  function finish(accepted){const pending=resolve;resolve=null;dialog.close();pending?.(accepted);}
  dialog.body.append(message,settings,element("p",{text:"承認した場合のみ、表示した変更を適用して1回再送します。"}),
    button("再送せず終了",{onClick:()=>finish(false)}),button("変更を承認して再送",{onClick:()=>finish(true)}));
  dialog.root.addEventListener("close",()=>finish(false));
  return {root:dialog.root,confirm(recovery){
    finish(false);message.textContent=recovery.label || recovery.message || recovery.kind || "生成を復旧できます";
    settings.textContent=JSON.stringify(recovery.settings ?? {},null,2);dialog.open();
    return new Promise((done)=>{resolve=done;});
  },dispose(){finish(false);dialog.root.remove();}};
}
