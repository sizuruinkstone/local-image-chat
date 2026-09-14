import {createGenerateWorkspace} from "../../features/generate-workspace.js";
import {mountStudioShell} from "./app-shell.js";
import {createRecoveryDialog} from "../components/shell/recovery-dialog.js";

const recoveryDialog = createRecoveryDialog();
const workspace = createGenerateWorkspace({persistSession:true, storage:localStorage, confirmRecovery:recoveryDialog.confirm});
const shell = mountStudioShell({root:document.getElementById("studio-root"), workspace, recoveryDialog, production:true});
// Do not tear down a page placed into the back/forward cache.
window.addEventListener("pagehide", event => { if (!event.persisted) shell.dispose(); });
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", {updateViaCache:"none"}).then(registration => registration.update()).catch(() => {
    // Generation stays online-only; an unavailable install surface is optional.
  });
}
