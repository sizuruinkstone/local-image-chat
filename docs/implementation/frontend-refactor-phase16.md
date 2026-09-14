# Frontend Refactor Phase 16 — LoRA Management / Civitai

2026-09-07完了。16A LoRA Libraryの後に16B Civitai frontendを実施。開始HEAD `22beecf` と未コミットのPhase 14–15を保持。commit/pushなし。Phase 17は未着手。

## Changed

- `public/features/lora-library.js`: installed catalog、library UI state、folder tree、一覧/preview/detail、runtime-aware load/refresh、metadata save/move、LoRA master Favorite、root表示/open、LoRA picker入口。
- `public/features/civitai-controller.js`: URL inspect、preview、install folder memory、duplicate choice、install、registration refresh、Civitai tokenのsession-only復元。
- `public/app.js`: 上記controllerのcompositionとPrompt/selection側portだけを保持。
- `package.json`: 2 moduleのsyntax checkを追加。
- `test/lora-library-controller.test.js` / `test/civitai-controller.test.js`: controller behavior testを追加。
- `test/ui-shell.test.js` / `test/task20.test.js` / `test/task22.test.js`: 移動したownerへのsource配置assertionだけを更新。

appは **6,706 → 5,392行（1,314行減）**。Phase 15–16合計は **6,892 → 5,392行（1,500行減）**。backend、registry/storage schema、API、`.env`、HTML/CSSは変更していない。

## Ownership

`lora-library` がinstalled LoRA catalogの単一owner。search/category/compatibility、selected/expanded folder、pinned/displayed detail、breadcrumb/group/list、preview/detail、catalog load/refreshとstale suppressionを所有する。runtime rollbackはcontrollerのcatalog getter/setterを使用し、appにmutable mirrorを置かない。

`civitai-controller` がinspected metadata、folder/default/recommended/recent/favorite、duplicate dialog、install/status、registration refreshを所有する。tokenは既存の `localImageChat.civitaiToken` sessionStorageだけに保存し、localStorage、status、log、controller snapshotへ保存しない。

## Interface

Libraryからgeneration selectionへの接続は、選択有無/件数、weight、Trigger/Negative、profile/preset/addon、summary、share CSV等の操作callbackだけ。`selectedLoras`、`loraSelectionSources`、`disabledLoras`、Prompt/raw/structured/outfit stateはapp側の既存ownerに残した。

catalog publish後はapp portで profile検出 → manual値を上書きしないCivitai defaults → profile migration → 未導入selection除去 → summary描画 → AI-share同期の既存順序を維持する。

Civitaiは既存のURL inspect workflowのみを抽出し、generic search/version pickerは追加していない。installは duplicate確認 → choice → install直前のruntime payload取得 → backend install成功 → 成功folder記憶 → folder再取得 → runtime-specific library再取得。成功前にinstalled状態を推定せず、cancel/failureでcatalog/selectionを破壊しない。

## Gate

- LoRA/Civitai + Phase 14–15 focused: **224 passed / 0 failed / 0 skipped**、exit 0。
- 追加backend/UI contract focused: **25 passed / 0 failed / 0 skipped**、exit 0。
- `npm.cmd run check` — exit 0。
- 最終full suite `npm.cmd test`（Phase 16後に1回）— **656 total / 654 passed / 0 failed / 2 existing opt-in skips**、exit 0。
- fixture browser smoke（Phase 16後に1回）— Checkpoint Set applyとruntime/checkpoint/form表示同期、LoRA folder/detail、Civitai inspect/install、folder/library refresh、installed表示を確認。console error 0、uncaught error / unhandledrejection 0。実Civitai download、実runtime、実generationなし。
- 最終architecture review — owner重複、feature→app逆import、global store/event bus、backend contract/token漏えい、Prompt/selection先取りの重大findingなし。
- `git diff --check` — exit 0（working-copyの既存LF/CRLF warningのみ）。

## Remaining risk

LoRA management rowはselection/profile/Trigger編集を含むため、library controllerは多数の狭いoperation portでappのPhase 17 ownerへ接続している。appにはselection map、Prompt tag/weight reconciliation、trigger source、outfit/raw/structured同期、catalog publish時のprofile migrationが残る。実provider reload、実download、実generationは未確認。
