# Current state — Local Image Chat

更新: 2026-09-07。branch `checkpoint/frontend-refactor-phase13` にPhase 17–21 checkpoint `refactor: checkpoint prompt and recipe extraction through phase 21`を作成済み。rollback point `55d7bba`（Phase 14–16 checkpoint）と `22beecf`（Phase 1–13 checkpoint）を保持し、pushなし。

## Current / completed

**Frontend Refactor Phase 21 Recipe Workflow完了。Phase 22/23は未着手。**

Phase 20.5のsafety primitiveを利用して [Phase 21](frontend-refactor-phase21.md) を再開・完了した。必須Gateは **B：Runtime切替成功がcommit境界**。後続Recipeのcritical failureでは成功後にcaptureした非Runtime ownerだけをrollbackする。成功時にRuntime snapshotを破棄する実装、次の切替失敗のbaseline、instruction dialog cancelの既存behaviorを根拠にした。

Phase 21 corrected treeはfocused **103 passed / 0 failed / 0 skipped**、check exit 0、full **731 total / 729 passed / 0 failed / 2 existing skips**。実ブラウザでRecipe復元、critical rollback、Runtime commit維持、連続loadとstale抑止を確認した。Astra統合reviewとBrowserで検出したfindingは修正済みで、残る重大findingなし。

今回の根拠は [Phase 21](frontend-refactor-phase21.md)、primitiveの前提は [Phase 20.5](frontend-refactor-phase20-5.md)。継続判断は [decisions](decisions.md)。[Discovery](frontend-refactor-discovery.md) / [Audit](../refactor/surgery-plan.md) のロードマップは次Phaseへの実装許可ではない。

`public/app.js` はPhase 21で **4,640 → 4,727行（87行増）**。`recipe-workflow.js`（147行）へ復元順序・同時実行制御・rollbackを移し、appにはnarrow adapterを追加した。backend/API/storage schema、HTML/CSSは変更していない。

## Current ownership

- `reference-image`: source identity、preview、寸法、auto-size、object URL、snapshot、生成payloadを所有する。nullを含むrestoreとstale read guardは維持。Recipe rollbackだけ `syncSize:false` を使い、保存form寸法を即時/遅延auto-sizeから保護する。
- `inpaint-editor`: canvas/mask、paint/erase、undo/redo、source/tool/brush/historyのopaque rollbackとasync generation guardを所有する。Recipe rollbackはFormのsource/mode同期後に最後にrestoreし、追加の `isCurrent` portでRuntime変更後のdecode commitを防ぐ。
- `ip-adapter-controller`: options/model metadata、availability、enable、weight/guidance、IP固有reference/preview/object URL、UI validation、rollback/recipe/metadata snapshot、generation payloadを所有する。local rollbackはData URLへ正規化し、blob URLはcontroller内だけでrevokeする。rollback captureはcapability-independent、payloadだけがRuntime capabilityに従う。file/options世代guardで古い完了を破棄する。
- `runtime-controller`、`prompt-lora-coordinator`、`checkpoint-sets`、`lora-library`、`civitai-controller`、`studio-controller`、`history-controller`、その他Phase 17までに抽出済みcontrollerの所有境界は維持した。
- `recipe-workflow`: `load(recipe,image)` / `ensureRuntime(recipe)`。Runtime readiness→短命snapshot→既存順序のrestore→critical rollbackだけを協調する。queue/versionとRuntime context guardでstale applyを抑止し、owner stateは複製所有しない。
- app: composition、generation、form/cache/render/persistence adapter、派生UI、health/Ollama、残るbootstrap。one-shot parent/derivation等のconsumeは既存generation境界に留まる。

API v1、History/storage/registry schema、runtime public ID、Neo activation、ReForge semanticsを維持。一般ReferenceとIP固有referenceは別stateのまま、InpaintはReferenceのsourceを複製せずport経由で消費する。

## Verification

2026-09-07、Phase 21 architecture review / Browser finding修正後のcorrected tree:

- focused: **103 passed / 0 failed / 0 skipped**、exit 0。
- `npm.cmd run check`: **exit 0**。
- `npm.cmd test`: **731 total / 729 passed / 0 failed / 2 existing skips / 0 todo**、exit 0、runner 10.722s、wall 11.345s。最終productionとBrowser確認後に1回だけ実行。
- localhost fixture/実ChromeでHistory読込、Runtime切替、Raw優先/LoRA、supported/unsupported IP、local File/実Canvas、critical rollback、旧Recipe、連続load、same-seed/duplicate、stale undo/resetを確認。最終sequence PASS。途中で検出したReference auto-sizeによるrollback寸法の上書きは修正済み。
- Browser console error/warn、uncaught、unhandled rejection **すべて0**。実provider/実generation requestなし。
- Astra統合reviewは1回の修正確認サイクル。Runtime境界、Inpaint contextの接続、保存順序/分類、派生表示とBrowser findingを修正し、残る重大findingなし。

旧Phase文書の途中結果を最終結果として扱わない。

## Working tree / constraints

Phase 17–21 checkpointには新Recipe workflow、app、Reference/Inpaintのnarrow restore option、package、新規Recipe 2 testと既存Reference/Inpaint/form/Task20 test、Phase 17–21/current-state/decisionsを収録。checkpoint対象外の既存dirty/untracked差分、private/local/generated artifactは保持し、reset/restore/削除していない。

ignored `workbench/ui-mocks/phase21/` のin-memory fixture、smoke script、画像は追跡しない。既存Phase 17/20.5 fixtureも保持する。

残余境界:

- checkpoint/source/maskの保存metadataは、現行互換としてRecipeから新しく復元しない。既存source/maskを保持する。新機能として復元するなら別のfailure仕様が必要。
- 保存例外は適用済prefixを保持して失敗を返す。ownerのrollback自体が拒否した場合は復元未完了を報告する。storage全体のatomic transactionは追加しない。
- form/cache/persistenceとgenerationのcouplingはappに残る。実provider/生成結果は今回の検証対象外。

## Next first reads

[AGENTS](../../AGENTS.md) → 本書 → [Phase 21完了記録](frontend-refactor-phase21.md) → [decisions](decisions.md) → `recipe-workflow.js` / `recipe-workflow.test.js` / `recipe-runtime-boundary.test.js`。

次候補はPhase 22 Generation Orchestration。明示依頼後にappのsubmit / `readDerivationPayload` / failure・retry / experiment baseRequest / composition lockの境界を最初に確認する。Phase 21完了後に停止し、Phase 22/23へ進まない。
