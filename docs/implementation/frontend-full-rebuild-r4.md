# R4 — Full LoRA Browser + Composition Workflow

2026-09-08 completed. Existing repository / single agent. Production cutover, legacy removal, R5, commit and push are not part of this change.

2026-09-08 follow-up: folder navigation now lives exclusively in the left hierarchical navigation, with separate expand/collapse and selection controls, root and parent actions. The top path is informational; grid folder buttons were removed. At <=1000px, Folders opens the same left drawer, selecting returns to the grid, and Escape first dismisses the drawer. Session folder/expansion position survives reopening. Updated files: Browser component/CSS, R4 smoke and current-state/this record. Check PASS; full suite 821 total / 819 pass / 0 fail / 2 existing skips; updated R4 smoke PASS (including keyboard expansion, selected folder and read-only top path); actual catalog Desktop/390px drawer review PASS. Studio geometry unchanged; real generation was not repeated for this presentation-only change. Screenshots: `workbench/r4/left-tree-desktop.png`, `left-tree-mobile.png`. This follow-up supersedes the original navigation placement described below.

## Browser and contract

- Prompt Dock's compact Active LoRA summary opens **Browse LoRA**. Desktop uses an independent large modal; Mobile uses a full viewport with Browse / Details / Composition surfaces. Closing returns focus to the Dock. Native modal provides Escape and focus containment. No legacy picker, modal, DOM or CSS import.
- `public/frontend/components/lora/lora-browser.js` composes asset thumbnails, Details and Active Composition. It receives only the public R1 workspace. Its session state contains folder/query/filter/selected-detail/pagination, not a second editable LoRA composition or favorite store.
- `lora-browser-state.js` reuses `buildLoraCatalog`, `buildLoraFolderTree`, `filterItemsByFolder` and safe relative location formatting from the existing pure catalog module. Root, parent, breadcrumbs and child folders work; name/path/trigger/base-model search and Favorites span all folders while retaining the folder context. Closing/reopening preserves position for the current application session, matching the legacy picker. No new localStorage key.
- Catalog comes from R1's runtime-scoped `/api/loras?runtimeId=…`. Reopening refreshes through `refreshLoras()`. Details reads the current catalog synchronously, so selecting another asset has no asynchronous details response to race. Missing selected assets/folders are cleared after catalog replacement.
- Favorite state remains the existing backend registry: ensure UID via `POST /api/loras/registry/ensure` when required, then `PATCH /api/loras/:uid`. Only the returned entry is merged; PATCH's legacy `loras` list may be for a different runtime and is deliberately ignored. Same-asset writes serialize; runtime/dispose guards discard stale responses; favorite commits invalidate older in-flight catalog reads. Failures retain previous Favorite state and appear inside the Browser. The dev gateway allows these narrow existing endpoints and checks Origin for writes.
- Thumbnail resolution reuses `resolveLoraPreviewUrl`: local preview, cached preview, registry URL. Loading, ready, missing and failed states share a fixed square footprint. Images use native lazy loading/async decoding; first render is limited to 60 assets, with explicit additional batches of 60. No new image pipeline, remote downloader or virtualization library.
- Details exposes name, relative path, preview, Active state, current weight, Favorite and available registry metadata (base model, category, notes, meaningful recommended weight and trigger words). No compatibility or missing metadata is inferred.

## Composition and Prompt semantics

- Browser, Dock, primary settings and `buildRequest()` all read canonical `snapshot.loras`. Add remains open; an already selected asset shows a disabled Active button. The existing API's repeated add still updates the same selection instead of duplicating it.
- Numeric weight and ±0.05 controls use the existing clamp/range/precision; enable/disable, remove and explicit up/down ordering are supported. `reorderLoras(names)` validates a complete permutation and updates the existing coordinator Map. R1 draft opts into order preservation during Prompt reconciliation; legacy coordinator default behavior is unchanged.
- Request preserves the same LoRA ordering and existing disabled semantics: disabled entries remain in the request with `enabled: false`; the backend excludes them during application. The UI does not silently drop or reinterpret these entries.
- **Add does not insert trigger words.** Browser calls `addLora(name, weight, {includeTriggers:false})`. Existing callers retain the default metadata semantics. `insertLoraTrigger(name, field)` explicitly appends registry words to a chosen one of the existing six Structured sections or Raw when Raw mode is active. It does not switch modes, rewrite other sections or touch Negative. Ordinary LoRA tags still follow the existing runtime/backend behavior.
- Prompt Workspace remains six-section Structured / Raw / Negative / Final Preview, with the requested heading **構造プロンプト**. Final Preview uses canonical R1 Prompt; no UI-specific reconstruction.
- Browser operations preserve prompt modes/drafts, Negative, seed, dimensions, model, advanced parameters and the selected result. Only explicit trigger insertion changes the chosen Prompt field.

New R1 surface: `catalogState {version, loading, error, pendingFavorites}`, `refreshLoras()`, `setLoraFavorite(name, bool)`, `reorderLoras(names)`, `insertLoraTrigger(name, sectionOrRaw)`, optional third `addLora` argument. Existing add/weight/toggle/remove/buildRequest/generate APIs remain shared.

## Verification on 2026-09-08

| Gate | Result |
| --- | --- |
| `npm.cmd run check` | PASS, exit 0; all new UI modules/dev scripts registered |
| `node --test test/lora-browser.test.js test/generate-workspace.test.js` | 31 pass / 0 fail |
| `npm.cmd test` final | **821 total / 819 pass / 0 fail / 2 existing skips**, exit 0 |
| `node dev/studio/smoke.mjs` (R2) | PASS: 1280 / 1440 / 1920 / 390 / 430, five Canvas states, no page/console/HTTP errors |
| `node dev/studio/integration-smoke.mjs` (R3) | PASS: existing Prompt/settings/generation/candidate/reuse/recovery workflow |
| `node dev/studio/lora-smoke.mjs` (R4) | PASS: 144 fixture assets, folder/search/Favorite/failure/fallback/add/duplicate/weight/toggle/reorder/remove, Dock/request sync, Structured and Raw explicit triggers, reopen/draft/result preservation, mobile layout and keyboard focus |
| `node dev/studio/real-lora-smoke.mjs` | PASS: actual LoRA enabled and disabled jobs, actual 768px images displayed on New Canvas |
| Live Browser review | 148 actual assets, 10 existing Favorites, Desktop and 390/430 previews/composition, page errors 0 |
| Production isolation | `public/app.js`, `public/index.html`, `public/style.css`, `src/server.js` match the previous verified Production hashes |
| Whitespace | `git diff --check` PASS; repository CRLF advisory warnings only |

Behavior tests also cover catalog-loading observation, stale catalog/favorite/runtime responses, shared registry ensure/merge and failed Favorite rollback, invalid order rejection and request order surviving Prompt sync. Proxy tests include the new ensure/PATCH routes and foreign-Origin rejection.

Initial validation fixes: the R2 CSS test hardcoded two allowed new-design-system files; replaced with recursive enforcement that all CSS imports stay under `public/frontend/styles/`. R2 smoke waited for a weight in Dock visible text; it now reads the compact summary's detailed title. R3's direct Active-LoRA-settings test uses the settings entry because the Dock LoRA entry now opens the Browser. No failed behavior was removed. Initial real smoke assumed catalog count 144; live count had changed to 148, so readiness now waits for loaded assets instead of a fixed count. No job was submitted by that failed attempt.

## Real provider evidence

The currently active provider/model at verification was **Forge Neo / Anima**, `sd/oneObsessionAnima_v30.safetensors [ed32d6584f]`. It differs from the historical R3 model; no model was switched by this smoke.

| Job | Settings / outcome |
| --- | --- |
| `7382a28c-3751-43e7-8f24-dac2dcdc4720` | Browser add `anima-base-1-flat-color-v3`, weight **0.55**, enabled; seed **414159**, 768×768, 16 steps; done; image `9e5b2ba2-55b0-4f74-b06b-8c6b3d31b411` rendered on Canvas |
| `27bdcc9e-c190-4ed5-b045-754d0460fd89` | Disable the same composition entry, seed **414160**; existing request carries `enabled:false`; done; image `9f1e447f-3cd9-4cae-a232-17307783c620` rendered on Canvas |

Both requests preserved Final Preview == request Prompt, Negative and empty implicit trigger metadata. Backend job results retain the matching enabled/disabled LoRA metadata. Browser close/disable preserved the previous image until the next result. No mock provider was used for these two jobs. Real page errors: 0. The owned development gateway was reloaded to expose Favorite routes; backend/provider processes were not restarted.

## Performance and visual preservation

- Live 148 assets: open **393ms**, initial 60 rendered. Separate live thumbnail review: first 12 image responses/decodes plus capture **2.9s** in the final capture (observed 2.5–3.7s, network-dependent); Favorite count 10. External previews still depend on their existing source availability.
- Fixture 144 assets with intentional 75ms catalog response delay: open **577ms**, two-step folder navigation **51ms**, path search **12ms**. These are single local smoke observations, including Playwright overhead, not benchmark percentiles. 92 image requests across the entire extended scenario, including repeated searches, folder views and mobile passes; not 92 at initial open.
- Browser first grid at 1440px displays six approximately 144px square thumbnails per row. No giant four-card layout or 54px text list. Native lazy loading and bounded batches are sufficient for the measured catalog size; virtualization is deferred.

| Viewport | Canvas height | Dock height | Compared with R3 |
| --- | ---: | ---: | --- |
| 1280×900 / 1440×900 | 624px | 178px | unchanged |
| 1920×1080 | 782px | 196px | unchanged |
| 390×844 | 496px | 202px | unchanged |
| 430×932 | 584px | 202px | unchanged |

Mobile tests include folder navigation, search, grid, details, continuous add, Composition, direct weight, remove, close/return and retained result. 440px viewport height simulates reduced space during keyboard use; **actual iPhone Safari and actual soft keyboard remain unverified**. Native modal focus containment/Escape/restoration are exercised with Chrome. Browser introduces no permanent Studio sidebar, setting cards or changed Inspector hierarchy.

Screenshots/reports are generated under ignored `workbench/r4/`: `real-browser-overview-1440.png`, `real-detail-1440.png`, `real-composition-1440.png`, `real-mobile-browser-{390,430}.png`, `real-mobile-composition-{390,430}.png`, and real-before/generating/completed/disabled-completed. Fixture screenshots explicitly exercise fallback and larger composition edits. Representative images are emitted to the conversation as image data, not only local-path links. JSON evidence: `browser-report.json`, `real-report.json`, `live-view-report.json`. Logs: `%TEMP%/lic-r4-{check,full-final,browser,r2,r3,real,live-view}.log`.

## Changed files and remaining scope

- New: `public/frontend/app/lora-browser-state.js`; `public/frontend/components/lora/{lora-browser,lora-details,active-composition,asset-thumbnail}.js`; `public/frontend/styles/lora-browser.css`; `test/lora-browser.test.js`; `dev/studio/{lora-smoke,real-lora-smoke}.mjs`; this R4 record.
- Updated: `public/features/{generate-workspace,generation-draft,prompt-lora-coordinator}.js`; `public/frontend/app/app-shell.js`; `public/frontend/components/prompt/prompt-dock.js`; `public/frontend/components/settings/primary-settings.js`; `public/frontend/styles/shell.css`; `dev/studio/{server,smoke,integration-smoke}.mjs`; `test/{generate-workspace,frontend-shell,studio-generation}.test.js`; `package.json`; current-state and decisions.
- Remaining dependency is shared pure catalog/preview/weight/schema helpers, existing coordinator and backend API/registry. No legacy DOM, form, modal, CSS or rendering function is used by the Browser. Production still uses its original UI adapter; its selection state is not mirrored into this separate application session.
- Existing dirty/untracked work is preserved. No stage/commit/push. Development entry remains `npm.cmd run studio:dev` → `http://127.0.0.1:41972/studio-next/`.
- R5 not started. Full Library/Gallery/search overhaul, generation-session persistence, Hires/Inpaint/IP-Adapter/Compare/Experiments/Civitai integration, Production cutover and legacy deletion remain unimplemented as requested.
