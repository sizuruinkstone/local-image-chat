# Frontend Refactor Phase 14 — Runtime / Checkpoint Controller

2026-09-07完了。Phase 15以降は未着手。開始HEAD `22beecf`（Phase 1–13 checkpoint）を保持。commit/pushなし。

## Changed

`public/features/runtime-controller.js` を追加し、`public/app.js` のruntime/checkpoint stateと非同期切替を抽出した。`package.json` のsyntax checkへ登録し、`test/runtime-controller.test.js` を追加、`test/task20.test.js` / `test/task22.test.js` の配置依存assertionを意味を保って追従した。

appは **7,156 → 6,892行（264行減）**。backend、API v1、History/storage、MCP、HTML/CSSは変更していない。

## Ownership

controllerはdescriptor一覧、画面の選択runtime、catalog、selected/active checkpoint、切替promiseとrollback snapshot、refresh/health/selection/lifecycle世代、3つの選択・refresh listenerを所有する。appのmutable mirror stateは廃止し、必要時に `getState()` から読む。

public ID `reforge` / `forge-neo-anima`、descriptor/featuresによる機能判定、保存済みruntimeのfallback、旧履歴のReForge解釈、checkpointのbasename/extension/hash suffix/曖昧一致の既存規則を維持する。

Neoの選択POSTは従来のlocal APIによる検証のみ。activationは共有JobManagerのgeneration実行境界に残る。options → sd-models → sd-modules、allowlist検証、必要時の `sd_model_checkpoint` → `forge_preset` → `forge_additional_modules` 順POST、GET再検証、成功後txt2imgのbackend sequenceは変更しない。health成功をgeneration readiness/activation完了とは扱わない。

## Runtime interface

- lifecycle: `init` / `dispose`
- state/selection: `getState` / `configure` / `selectRuntime` / `waitForSwitch` / `runtimeForGeneration`
- catalog/checkpoint: `loadCheckpoints` / `refreshCheckpoints` / `selectCheckpoint` / `findCheckpoint` / `updateActiveCheckpoint`
- context/capability: `runtimeRequestContext` / `isRuntimeContextCurrent` / `runtimeApiUrl` / `runtimePayload` / `runtimePayloadFor` / `runtimeSupports`
- health: `beginHealthRequest` / `applyHealth` / `isHealthRequestCurrent`

appはhealth HTTP取得とOllamaを含む画面表示、generation/recipe、checkpoint profile設定、Checkpoint Sets、Prompt/LoRA、Sampler、IP-Adapter間の接続を保持する。controllerからappへの逆import、global event bus、centralized storeはない。

## Snapshot/rollback ports

`captureExternalSnapshot` は切替に必要なform、LoRA catalog/selection/source/disabled、Sampler options、IP-Adapter options/stateだけをappから受ける。controllerはそれらの内部を操作せず、`restoreExternalSnapshot` と `finalizeExternalRestore` に復元を委譲する。Gallery、History、Discord、Experiment、Favoriteはsnapshotに含めない。

失敗時はruntime/checkpointと保存キーを戻し、周辺リソースを戻し、checkpoint/profile/set/LoRA表示とruntime UIを同期してからform/IP表示を復元する。最後のUI通知がフォームを再度変更しない順序をtestで固定した。`loadExternalResources(context)` は既存3 loaderへ接続し、boolean失敗とrejectをrollbackする。Sampler取得失敗時に空catalogで継続する既存semanticsは維持する。

Checkpoint選択後は同期portでprofile設定と関連表示、選択完了statusの順に反映し、その後async portで既存autoApplyとhealth/IP再取得へ接続する。Checkpoint Setsの保存/apply/autoApply/fingerprintはappに残す。

## Async race protection

runtime selection tokenとlifecycle世代で切替前・dispose前の応答を無効化する。catalog GETとrefresh POSTは共通catalog tokenで順序反転を抑止し、古いfinallyが新しいcontrol状態を変更しない。refresh・checkpoint選択・healthは各request tokenも持つ。

health後のactive更新は新しいcatalogが始まっていれば抑止する。health fallback完了後は新しいruntime contextを読み直す。health成功・失敗・finally、checkpoint autoApply後の継続にもcurrent guardを適用する。disposeはlistenerを解除し、すべての世代を無効化する。汎用async framework、backend cancel/load、controller固有timerは追加していない。

## Focused test

実装前は旧sourceと既存Task 20/22 assertionを確認した。**変更前test commandは実行していない**。追加behavior testは10件で、fallback、alias、selected/active、順序反転、partial/reject rollback、復元順序、health/catalog競合、health fallback、dispose/re-initを検証する。

最終focused command:

`node --test test/runtime-controller.test.js test/checkpoint-profiles.test.js test/checkpoint-sets.test.js test/task20.test.js test/task22.test.js test/ui-shell.test.js test/ai-share.test.js`

2026-09-07: **111 passed / 0 failed / 0 skipped**、exit 0、3.11s。`npm.cmd run check` **exit 0**。

## Full test

2026-09-07、最終実装に対し `npm.cmd test` を**1回**実行。**636 total / 634 passed / 0 failed / 2 existing opt-in skips**、exit 0。Node duration 19.27s。以降は文書のみ更新し、実装変更・full suite再実行なし。

## Browser smoke

2026-09-07、in-app browserで1回のsmoke sequenceを実施。ignored `workbench/ui-mocks/phase14/` のin-memory fixtureを使用した。

- ReForge catalog表示からNeoへ切替、Neo catalogとIMG/MASK disabledを確認。
- Neoで `animaFluxMix_v11.safetensors` を選択してもactiveは `oneObsessionAnima_v30.safetensors`。両者を区別する表示を確認。
- Neo catalog refresh後も選択とactiveを保持。
- Neo refreshを10秒遅延させ、その間にReForgeへ切替。旧応答後もReForge catalogとIMG/MASK enabledを維持。
- ReForgeの `animaPencilXL_v310.safetensors` 選択では従来どおり「切替完了」。Galleryへ移動して生成画面へ戻っても選択を保持。
- fixtureで捕捉したuncaught error / unhandledrejectionは0件。

実runtime通信、model load、generation、Discord送信は行っていない。

## Remaining risk

architecture reviewを1回実施し、検出したmirror state、rollback後の再描画、非同期guard、履歴callerの旧参照を修正・対象検証した。未解決の重大findingなし。

appにはform/Prompt/LoRA、health表示、profile、Checkpoint Sets、recipe/generationとのcouplingが残る。Phase 15ではautoApplyの確認dialogを跨ぐ処理とruntime contextの接続、fingerprintとform復元の関係をreviewすること。今回それらの所有者や保存方式は変更していない。既知のGallery 390px overflowとGallery filter request raceは別taskのまま。実providerの稼働状態や実生成成功は今回の検証対象外。
