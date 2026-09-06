# Current state — Local Image Chat

更新: 2026-09-07。HEAD `22beecf`（Phase 1–13 checkpoint）を保持し、Phase 14–16は未コミット。commit/pushなし。

## Current / completed

**Frontend Refactor Phase 16 — LoRA Management / Civitaiまで完了。Phase 17以降は未着手。** Phase 1–13のcheckpointをrollback pointとして保持している。

今回の根拠は [Phase 14](frontend-refactor-phase14.md) / [Phase 15](frontend-refactor-phase15.md) / [Phase 16](frontend-refactor-phase16.md)。継続判断は [decisions](decisions.md)、全体経緯は [Discovery](frontend-refactor-discovery.md) / [Audit](../refactor/surgery-plan.md)。過去文書の未承認/未実装記述は各文書作成時点の状態。

`public/app.js` は **7,156 → 5,392行**。Phase 14で264行、Phase 15で186行、Phase 16で1,314行減。

## Current ownership

- `runtime-controller`: descriptor、画面上の選択runtime、checkpoint catalog/selected/active、switch promise/rollback、health/request/lifecycle世代、runtime/checkpoint/refresh listener。appにmutable mirror stateはない。
- `checkpoint-sets`: Set catalog/選択表示、CRUD、apply/autoApply、dirty fingerprint。runtime context guardを使用し、runtime/checkpointやPrompt/LoRA internalsは所有しない。
- `lora-library`: installed catalog、folder/search/category/compatibility、list/preview/detail、runtime-aware load/refresh、metadata save/move、root、picker入口。generation selection stateは所有しない。
- `civitai-controller`: URL inspect、install folder memory、duplicate/install/refresh、session-only token。成功後にlibrary reload portへ接続する。
- app: composition、フォーム/Prompt、LoRA generation selection/source/disabled/outfit、profile migration、通常生成・recipe、checkpoint profile、health HTTPとOllamaを含む表示。controllerへ狭いoperation portで接続する。
- `sampler-picker`: Sampler/Scheduler catalogとpicker。runtime contextを利用し、復元portでcatalogを戻す。
- `history-controller`: History page cache/filter、Gallery表示、Studio recent。`comparison-controller`: selection/tray/Compare/vote。`experiment-controller`: Experiment state/monitor/results。
- `queue-controller`: queue snapshot/poll。`image-state`: 画像Favoriteと通知watcher。`studio-controller`: Studio selection/workflow。`image-modal`: 共用original zoom。

runtime public ID、API v1、History/storage/MCP、Neo activation、ReForge backend semanticsを維持。Neoのselectedをactiveと推定せず、activationは共有JobManagerの生成実行時に残す。HTML/CSS変更なし。

## Verification

2026-09-07、Phase 16最終実装に対して実行:

- Phase 15 focused checkpoint-set/runtime: **66 passed / 0 failed / 0 skipped**。
- Phase 16 focused LoRA/Civitai + Phase 14–15: **224 passed / 0 failed / 0 skipped**。追加backend/UI contract: **25 passed / 0 failed / 0 skipped**。
- `npm.cmd run check`: **exit 0**。
- `npm.cmd test`: **656 total / 654 passed / 0 failed / 2 existing opt-in skips**、exit 0、Node duration 12.09s。Phase 16後の最終full suiteは1回。
- fixture browser smoke: Checkpoint Set applyとruntime/checkpoint/form表示同期、LoRA folder/detail、Civitai URL inspect/install、folder/library refresh、installed表示を確認。browser console error 0、uncaught error/unhandledrejection 0件。実runtime/Civitai download/generation/送信なし。
- 最終architecture review: owner重複、逆import、global store/event bus、backend/token contract、Phase 17先取りの重大findingなし。

実装前はsource/既存assertionのcharacterizationのみで、変更前test commandは未実行。過去のPhase 11–13検証はそれぞれの記録を参照する。

## Working tree / constraints

Phase 14–16の変更: `public/app.js`、`public/features/runtime-controller.js`、`public/features/checkpoint-sets.js`、`public/features/lora-library.js`、`public/features/civitai-controller.js`、`package.json`、各controller test、`test/task20.test.js`、`test/task22.test.js`、`test/ui-shell.test.js`、Phase 14–16文書、本snapshot。fixtureはignored `workbench/ui-mocks/phase14/` と `workbench/ui-mocks/phase15-16/` に保存。

開始時の `docs/CURRENT_TASK.md` / `docs/REVIEW_FIXES.md` の差分、未追跡のartist/twitter/luna-tasks文書、画像/ZIP、`output/`、`scripts/`、local/private artifactは保持。削除・巻き戻し・一括stageしてはならない。

既知のGallery 390px overflowとGallery filter request raceは別task。実providerの稼働状態、実Civitai download、実生成成功は今回未確認。Checkpoint Setのruntime共有、Prompt非dirty、保存済みpromptBoosts非適用は既存semanticsのまま。

## Next first reads

[AGENTS](../../AGENTS.md) → 本書 → [Phase 15](frontend-refactor-phase15.md) / [Phase 16](frontend-refactor-phase16.md) → [decisions](decisions.md) → [checkpoint-sets](../../public/features/checkpoint-sets.js) / [lora-library](../../public/features/lora-library.js) / [civitai-controller](../../public/features/civitai-controller.js) と対象tests → appのselection/Prompt ports。

次候補はPhase 17 Prompt / LoRA Coordinator。最初に `selectedLoras` / source / disabled、Prompt tag/weight reconciliation、Trigger source、outfit/raw/structured同期、Checkpoint SetのLoRA/Prompt ports、library operation portsの境界を設計reviewする。**別の高難度runとして、明示的な実装依頼を受けるまで開始しない。**
