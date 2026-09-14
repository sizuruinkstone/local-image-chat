# Frontend Full Rebuild R3 — Real Generate Workflow Integration

2026-09-07: R3 completed, single agent. R4 and Production switch are not started.

## Entry and real generation

`npm.cmd run studio:dev` serves `http://127.0.0.1:41972/studio-next/`. The normal entry now uses the real R1 workspace and HTTP transport. A restricted development gateway forwards the required config/runtime/catalog/job/history/image requests to the existing local backend (`http://127.0.0.1:3030`, configurable with `LIC_STUDIO_BACKEND_URL`). Only a local HTTP origin is accepted; unrelated write endpoints and foreign-origin writes are rejected. Production server and bootstrap are unchanged.

R2 mock rendering is retained only under the explicit development URL `?fixture=r2` for regression smoke. It is absent from the primary path. The real entry starts an empty Structured draft, uses the existing Runtime/model defaults, and does not insert sample LoRAs or artwork. Library is a clearly marked later-phase surface, independent of current generation candidates.

Verified through the real New Studio browser UI with **Forge Neo / Anima**, model `sd/anima29B_v10.safetensors [0b3020d1b9]`, 768×768, 16 steps, CFG 6, Euler a:

| Operation | Evidence |
| --- | --- |
| Structured Prompt → Generate → real job → completion → actual image in Canvas | Job `0ebfa375-4cb1-4acd-8aee-418dbfe70105`, done; seed 314159 |
| Change Seed and Generate again | Job `4c3ee53e-9fe5-4be0-b406-da9fe6aceb75`, done; seed 314160 |
| Generate then Cancel | Job `34c700fb-2682-4cd9-b398-bc18c0518d87`, cancelled; terminal state independently read back from backend |

Real browser had zero page/console errors. The actual submitted Positive/Negative matched Final Prompt preview. Backend images loaded with a nonzero natural width in Canvas. No backend process restart was needed. Only this task's development gateway was restarted.

An initial verification script used Playwright's default 30-second wait because its timeout option was passed in the argument position. That browser verification timed out while the real job continued. The initial job `25e76a9d-cac9-4029-9abe-6de0fd736cf1` subsequently completed. After correcting the harness timeout and confirming that job finished, the successful three-operation verification above ran. Generated test outputs/history are retained; no cleanup or rollback was performed.

## Contract connections

| Surface | R1 API / state |
| --- | --- |
| Prompt Workspace | Existing `setPrompt`, `snapshot.prompt`; Structured six sections / Raw / Negative / Final preview semantics unchanged |
| Generate / Cancel | `generate()`, `cancel()`, generation subscription; request assembly remains the existing shared builder used by `buildRequest()` |
| Model Picker | Runtime installed checkpoint catalog and selected checkpoint, `selectModel()`, `selectRuntime()`, `refreshCatalogs()`; search and failure/selection/loading states |
| Primary settings | `setParameters()` for resolution presets/orientation/custom dimensions, seed, candidate count 1–4 |
| Active LoRA | `setLoraWeight()`, `toggleLora()`, `removeLora()`; no LoRA catalog browser |
| Inspector Current Draft | Sampler, Scheduler, Steps, CFG from snapshot/catalogs and `setParameters()` |
| Canvas | generation projection, `currentImage`, `completed.images`; `selectImage()` for candidate navigation |
| Inspector Result Metadata | Read-only selected result prompt, negative, runtime/model, parameters, seed and LoRAs |
| Explicit Reuse | `reuseMetadata(completed, currentImage)`; separate result-seed action uses `setParameters({ seed })` |
| Recovery | R1 `confirmRecovery` port with a new native dialog; only explicit acceptance authorizes the existing one-time retry |

`generation-view.js` is a presentation projection, not a second draft or job owner. It maps Ready / Submitting / Queued / Generating / Completed / Error / Cancelling / Cancelled / Recovery approval from real state. Percentages are only existing backend `job.progress` values, not a timer or invented sampling progress. The previous image remains visible through another job, failure or cancellation. Candidate navigation is a small Canvas caption control; it does not write Current Draft or Recent state.

The R1 additions are limited to observable `cancelRequested` with duplicate/terminal cancel guarding, a guarded catalog refresh operation, and clearing stale model-selection error text on a new selection. Existing Runtime async guards, rollback boundary, request/schema and generation exclusion are preserved. Clip Skip is not in the R1 editable parameter contract and is not added in R3.

Prompt UX remains primary and retains its original section schema, mode semantics and final assembly. Edits are disabled while R1 owns a generation/model/reuse operation, and the mobile Prompt Workspace retains a reachable close header when scrolled. No old form, modal, rendering function, CSS or DOM is imported.

## Visual preservation and screenshots

Measured with Inspector collapsed, after responsive layout settles:

| Viewport | R2 Canvas / Dock height | R3 Canvas / Dock height |
| --- | --- | --- |
| 1280×900 | 624 / 178 | 624 / 178 |
| 1440×900 | 624 / 178 | 624 / 178 |
| 1920×1080 | 782 / 196 | 782 / 196 |
| 390×844 | 496 / 202 | 496 / 202 |
| 430×932 | 584 / 202 | 584 / 202 |

Canvas and Dock grid dimensions are unchanged. New controls open from existing summary positions. Inspector still occupies its prior optional right panel/mobile sheet; it is not made permanently visible. Structured remains directly accessible in Dock. There is no dashboard or permanent settings-card collection.

Real screenshots: [before 1440](../../workbench/r3/real-before-1440.png), [generating 1440](../../workbench/r3/real-generating-1440.png), [completed 1440](../../workbench/r3/real-completed-1440.png), [completed 1920](../../workbench/r3/real-completed-1920.png), [completed 390](../../workbench/r3/real-completed-390.png), [completed 430](../../workbench/r3/real-completed-430.png).

Integration screenshots (fixture images, not provider evidence): [Model Picker](../../workbench/r3/model-picker-1440.png), [primary settings](../../workbench/r3/primary-settings-1440.png), [Inspector draft](../../workbench/r3/inspector-draft-1440.png), [candidate metadata](../../workbench/r3/result-metadata-1440.png), [Recovery](../../workbench/r3/recovery-1440.png), [mobile Active LoRA](../../workbench/r3/active-lora-390.png), [mobile Inspector](../../workbench/r3/inspector-390.png).

Real before/generating/completed and mobile result images are also delivered as native image data in the conversation, not only local Markdown image paths.

## Tests and limits

- `npm.cmd run check`: exit 0, includes all new frontend and development scripts.
- `npm.cmd test`: **815 total / 813 pass / 0 fail / 2 existing skips**.
- Focused `node --test test/generate-workspace.test.js test/studio-generation.test.js`: 27 pass / 0 fail.
- R2 `node dev/studio/smoke.mjs`: PASS, including Prompt Workspace and all five widths.
- R3 `npm.cmd run studio:integration`: PASS. Seven intercepted job submissions exercise Structured/Raw/Negative equality, basic/advanced parameters, model failure/selection, LoRA weight/toggle/remove, double-submit protection, multiple candidates, read-only metadata, explicit reuse, cancellation, failure, recovery approval, Runtime unavailable and backend reconnect. Existing R1 tests retain stale model/metadata/dispose and rollback coverage.
- Mobile 390/430: Generate/Cancel, Raw editing, completed real images, Model Picker, Inspector, Active LoRA, overflow and 440px reduced-height keyboard approximation checked. Existing R2 smoke retains Structured section/preview checks. Real iPhone Safari and a real soft keyboard are **not verified**.
- Real report: [real-report.json](../../workbench/r3/real-report.json). Integration and dimensional evidence: [integration-report.json](../../workbench/r3/integration-report.json).
- Logs: `%TEMP%/lic-r3-{focused,check,suite,r2-smoke,integration,real}.log`. Workbench artifacts are ignored, not staged.

Expected model/backend 503 responses are injected only by the integration harness; no unexpected request failures or page exceptions occurred there. Early integration failures were fixed: notification overlap after Cancel, accessible selector ambiguity in the harness, and waiting for responsive layout before measuring it. Result metadata uses readable labels instead of exposing an entire request object.

The live entry keeps draft/results in the workspace session. Reload/dispose does not cancel a backend job and does not restore the active job into a new session. Persistence/session restoration, full Library and Full LoRA Browser are outside R3. Metadata Reuse retains R1's explicit exclusions, including checkpoint selection; the UI says Model is not included. Real LoRA quality and deliberate real-provider recovery failures were not tested; those behavior paths use controlled integration evidence.

## Changed files and handoff

New: `public/frontend/app/generation-view.js`, `components/settings/{dialog,model-picker,primary-settings}.js`, `components/shell/recovery-dialog.js`; `dev/studio/{integration-smoke,real-smoke}.mjs`; `test/studio-generation.test.js`; this record.

Updated: `public/frontend/app/app-shell.js`, Canvas stage, App Bar, Prompt Dock, Prompt Workspace (busy gating only), Inspector, shell CSS; `public/features/generate-workspace.js`; `dev/studio/{boot.js,index.html,server.mjs,smoke.mjs}`; `test/generate-workspace.test.js`; package scripts and current-state.

Production `public/index.html`, `public/style.css`, `public/app.js`, `src/server.js` hashes match the preserved starting snapshot. No backend implementation, dependency, lockfile, storage schema, legacy UI, commit, stage or push change is part of R3. All earlier dirty and untracked work is preserved. Shared DOM-free runtime/request/generation/Prompt-LoRA logic remains intentional; there is no legacy presentation dependency. Stop here; R4 requires separate authorization.
