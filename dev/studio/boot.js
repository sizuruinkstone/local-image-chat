import { createGenerateWorkspace } from "/features/generate-workspace.js";
import { mountStudioShell } from "/frontend/app/app-shell.js";
import { createRecoveryDialog } from "/frontend/components/shell/recovery-dialog.js";

// Only an explicit development fixture URL uses mock transport; normal Studio uses the existing backend.
const previewMode = new URLSearchParams(location.search).get("fixture") === "r2";
const values = new Map();
const recoveryDialog = createRecoveryDialog();
const transport = previewMode ? (await import("./fixture-transport.js")).createPreviewTransport() : undefined;
const workspace = createGenerateWorkspace({ transport, confirmRecovery: recoveryDialog.confirm,
  persistSession: !previewMode,
  storage: previewMode ? { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } : localStorage
});
const shell = mountStudioShell({ root: document.getElementById("studio-root"), workspace, artwork: "/__studio-dev__/study.svg", previewMode, recoveryDialog });
if (await shell.ready && previewMode) {
  workspace.setPrompt({ sections: { character: "a sculptural arch, a single terracotta sphere", appearance: "warm ivory, matte ceramic", composition: "balanced composition, eye level", situation: "quiet architectural space, soft afternoon light", style: "minimal still life, fine texture", extra: "soft shadows" }, negative: "text, watermark, blur" });
  workspace.addLora("Soft light", 0.65);
}
window.addEventListener("pagehide", () => shell.dispose(), { once: true });
