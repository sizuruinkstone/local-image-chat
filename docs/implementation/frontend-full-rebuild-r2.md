# Frontend Full Rebuild R2 — New Application Shell

2026-09-07: R2 completed. Single agent; R3 and Production switch are not started.

## Structured Prompt primary workflow — follow-up correction

2026-09-07: User-directed Prompt UX correction implemented within the development Shell. This supersedes the original single Positive textarea described in the earlier R2 record below. Production and real Generate integration remain unchanged.

The normal Dock now shows compact summaries for all six existing `PROMPT_FIELDS`: character, appearance, composition, situation, style, extra. Selecting a summary opens the dedicated Prompt Workspace and focuses that independent editor. Structured is the initial workflow, with Raw and Negative available alongside it, outside the parameter Inspector. Desktop shows six editors and Negative beside the Final preview; Mobile uses a full-screen scrolling workspace. The dialog provides native modal focus containment and Escape/close focus return.

`prompt-workspace.js` renders `snapshot.prompt.prompt` and `negativePrompt` as Final Positive/Negative. It does not duplicate assembly logic. Tests assert these values match the R1 `buildRequest()` payload. Raw input uses `setPrompt({ positive })`; section edits use `setPrompt({ sections })`, and Negative uses `setPrompt({ negative })`. A minimal `setPrompt({ mode: "raw" | "structured" })` extension to the canonical R1 draft seeds the first Raw edit from Final, retains later Raw edits (including intentional empty text), and preserves Structured sections across switching. Raw draft initialization also survives capture/restore and is not added to backend prompt payloads. Existing LoRA transformations remain in R1 and are visible in Final preview.

Files: new `public/frontend/components/prompt/prompt-workspace.js`; updated Prompt Dock, app-shell composition, shell CSS, fixture boot, canonical generation-draft, package syntax-check list, R1 tests and browser smoke. No legacy UI or backend file changed.

Validation: focused 27 pass / 0 fail; check exit 0; full suite 811 total / 809 pass / 0 fail / 2 existing skips. Browser smoke PASS at 1280/1440/1920/390/430, covering six edits, mode round trips, Negative, Final preview, navigation retention and responsive workspace. Console/HTTP/external errors 0. The initial smoke revealed an ambiguous Raw accessible name; an explicit label fixed it. Resize assertions now wait for the media-query update rather than sampling before its event.

Screenshots: `workbench/r2/prompt-dock-{1440,1920,390,430}.png`, `prompt-workspace-{1440,1920,390,430}.png`, `prompt-raw-1440.png`, `prompt-preview-{390,430}.png`. Five browser screenshots were also emitted as native inline image data in the conversation, rather than only local Markdown image paths. Logs: `%TEMP%/lic-structured-{focused,check,suite,browser}.log`. These are preview/Chrome viewport results, not real provider or real mobile keyboard evidence.

## Preview and visual gate

Run `npm.cmd run studio:dev`, then open `http://127.0.0.1:41972/studio-next/`.
This entry exists only on the separate loopback development server. The normal Production server, entry HTML, app composition and CSS are unchanged from the R2 starting snapshot. The preview has fixture data and in-memory draft storage; it never submits an image job or registers a service worker.

The shell uses an independent DOM tree and native ESM under `public/frontend/`. Desktop navigation is a compact Studio / Library tab group inside the App Bar. The full-width graphite Canvas is the main surface, the pearl Prompt Dock stays at the bottom, and the right Inspector opens on demand. Mobile keeps a Canvas and compact dock, moves navigation to the bottom, and uses an Inspector sheet. This changes the interaction structure from the legacy sidebar and editing-form/image columns; it does not import, embed or conceal legacy views.

During visual review a first narrow vertical navigation rail still recalled the old sidebar. It was replaced within R2 by horizontal App Bar tabs. Final screenshots are the `studio-*`, `inspector-*`, `library-*`, and `canvas-*` images below; `*-initial` files are not final evidence.

Final browser screenshots (repository-local, ignored workbench artifacts):

- [Desktop 1440](../../workbench/r2/studio-1440.png), [1920](../../workbench/r2/studio-1920.png), [1280](../../workbench/r2/studio-1280.png)
- [Mobile 390](../../workbench/r2/studio-390.png), [430](../../workbench/r2/studio-430.png)
- [Desktop Inspector](../../workbench/r2/inspector-1440.png), [Mobile Inspector](../../workbench/r2/inspector-390.png)
- [Desktop Library](../../workbench/r2/library-1440.png), [Mobile Library](../../workbench/r2/library-430.png)
- [Empty](../../workbench/r2/canvas-empty-1440.png), [Ready](../../workbench/r2/canvas-ready-1440.png), [Generating](../../workbench/r2/canvas-generating-1440.png), [Error](../../workbench/r2/canvas-error-1440.png)

At 1440×900 the Canvas is 1440×624 and the dock is 178px high. At 390×844 the Canvas is 390×496 and the dock is 202px high. Image presentation is on the Canvas, without an enclosing dashboard card. Visual self-review passed the requested sidebar/form/card/dashboard checks. These screenshots provide the visual direction for user review, not a claim of user approval.

## Boundaries and R1 connection

- `app/app-shell.js`: component composition, subscription and teardown; `app/shell-state.js`: only navigation, preview Canvas state, Inspector visibility.
- `components/shell/`: App Bar and workspace navigation.
- `components/canvas/`: stage with Empty / Ready / Image / Generating / Error, toolbar, fit/zoom.
- `components/prompt/`: Positive Prompt and Generate action, Model / Resolution / Active LoRA summaries.
- `components/inspector/`: independent right panel, responsive dialog and focus return.
- `components/library/`: image collection shell; opening a sample returns to Studio and preserves the prompt draft.
- `components/primitives.js`: small DOM/control/icon helpers; no legacy UI helper dependency.

`mountStudioShell({ root, workspace, artwork })` accepts the actual R1 `createGenerateWorkspace()` instance. It calls `initialize`, `getSnapshot`, and `subscribe`, and returns `{ ready, dispose }`. Positive Prompt edits call `setPrompt`; model, resolution, LoRA and runtime summaries render from snapshots. The development boot changes Prompt and adds a LoRA after initialization to exercise subscription updates. Draft state remains owned by R1, separate from shell view state. Disposal unsubscribes and releases the owned workspace, media listeners and preview timer.

Generate is explicitly a preview simulation. Canvas states and progress are local shell state, not real generation lifecycle. The artwork is a newly authored local SVG sample. Library entries are samples, Inspector settings are placeholders, and the runtime label explicitly says preview. No real provider/API health or image generation was verified in R2.

R3 can replace the fixture transport and connect `workspace.generate()` / generation snapshots, parameter editing, model selection, LoRA controls and history to these component callbacks without importing legacy DOM. R1 public contracts remain unchanged. No blocker for this next integration was found; full persistence, real workflow, advanced features and Production routing remain separate work.

## Design system

`styles/tokens.css`, `primitives.css`, and `shell.css` are independent of legacy CSS. All new tokens use `--studio-*`: graphite Canvas, pearl surfaces, opaque white input, muted text, subdued green action/focus accents; spacing 4–48px; radii 5/9/16px; border and shadow levels; 12px blur; Segoe UI / Yu Gothic typography; 34px controls and 44px touch targets; 120/180ms motion; hover, pressed, focus-visible and disabled states. Translucency is confined to controls/dock/overlays. Reduced motion and reduced transparency have fallbacks.

## Validation, 2026-09-07

| Check | Current result |
| --- | --- |
| `node --test test/frontend-shell.test.js test/generate-workspace.test.js` | 25 pass, 0 fail |
| `npm.cmd run check` | exit 0, including all new shell/dev JavaScript |
| `npm.cmd test` | 809 total, 807 pass, 0 fail, 2 existing skips |
| `node dev/studio/smoke.mjs` | PASS, Chrome 152.0.7977.77 |
| Browser widths | 1280 / 1440 / 1920 / 390 / 430; no horizontal overflow in Studio, Library, Inspector or five Canvas states |
| Interaction | Navigation, retained draft, Inspector open/close, Escape/focus return, mobile Tab containment, desktop/mobile resize with Inspector open, preview generation, Canvas switching and reduced motion passed |
| Browser isolation | 0 console/page errors, 0 HTTP failures, 0 external requests; no legacy assets or backend requests |
| Production preservation | SHA256 of `public/index.html`, `public/style.css`, `public/app.js`, `src/server.js` matches R2 start |

Browser measurements are in [browser-report.json](../../workbench/r2/browser-report.json); initial Production hashes in [production-before.json](../../workbench/r2/production-before.json). Test logs are `%TEMP%/local-image-chat-r2-{focused,check,suite,browser}.log`. The reproducible `npm.cmd run studio:smoke` uses the bundled Playwright module or `LIC_PLAYWRIGHT_MODULE`; no dependency installation is required. Mobile evidence is Chrome viewport emulation, not real iOS/Safari or soft-keyboard testing.

## Changed files and preservation

R2 adds the `public/frontend/` component/styles/app tree, `dev/studio/{index.html,boot.js,fixture-transport.js,study.svg,server.mjs,smoke.mjs}`, and `test/frontend-shell.test.js`. It extends `package.json` with studio dev/smoke/check commands and updates this record and `current-state.md`. Screenshots/reports remain in ignored `workbench/r2/`.

All starting R1, UI, documentation, test and untracked local work is preserved. No backend contract, production entry, legacy implementation, dependency/lockfile, storage schema, commit, stage or push change is part of R2.
