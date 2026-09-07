# Current state — Local Image Chat

更新: 2026-09-07。branch `checkpoint/frontend-refactor-phase13` にPhase 22 checkpoint `refactor: checkpoint generation orchestration through phase 22`を作成。Phase 21 rollback point `5f12f91` と古いcheckpoint `55d7bba` / `22beecf` を保持し、pushなし。

## Current / completed

**Frontend Refactor Phase 22 Generation Orchestration完了。Phase 23 Persistence / Bootstrapは未着手。**

[Phase 22記録](frontend-refactor-phase22.md) に生成入口、request順序、one-shot consume、retry/recovery/Hires/Experiment、検証根拠を記録した。Astraの統合reviewは1回の修正確認cycleで完了し、未解決の重大findingなし。Phase 22完了後に停止し、次Phaseへ自動で進まない。

`public/features/generation-controller.js`（305行）へ通常生成/Hiresのrequest構築、active Job/operation/busy、poll/recovery/cancel、result ownerへの接続を抽出。`public/app.js` は **4,727 → 4,479行（248行減）**。API v1、History/storage schema、JobManager、Runtime activation、Discord backend、HTML/CSS、build systemは変更していない。

## Current ownership / boundaries

- `generation-controller`: `generateCandidates()` / `finishSelected()` / `hiresFromGallery(generation,image)` / `cancel()` / `buildPrompt()` / `getState()` / `isBusy()`。各ownerの明示portからrequestを構築する。最初のawait前に予約し、POST応答前の二重投入を防ぐ。recoveryは同じoperation内で承認後1回だけ再送。cancel応答と遅延hideにidentity/version guard。
- one-shot: appの派生フォーム準備と `readDerivationPayload()` を維持。通常requestの **Reference→Inpaint→IP→derivation read-and-clear→settings→POST** の順で消費する。consume前のfailureは保持、settings/POST/running failureでは復元しない。Job作成成功時consumeへ変更していない。
- `runtime-controller`: Runtime/checkpoint/context/capability。Forge Neo activationはbackend共有JobManager実行境界。UI選択/health/catalogからloadしない。
- `prompt-lora-coordinator`: selection/source/disabled/reconciliation。generation用readerがpublic同期/queryを使う。フォームDOM、trigger/profile/outfit/cache保存はapp adapter。
- `reference-image` / `inpaint-editor` / `ip-adapter-controller`: source/File/object URL、Canvas/mask、IP state/availabilityを各ownerへ保持。Generationはpayload portだけを利用する。unsupported IPは保持stateとpayload除外を区別。
- `queue-controller`: 全Job queue polling/terminal通知。Generationは自分のactive Jobだけを既存850msでpollし、全Job pollerを重複追加しない。navigationで停止しない。
- `studio-controller` / `history-controller` / `image-state`: result display、History取得、Favorite/notification presentation。Generationはsnapshotとrefresh callbackを渡すだけ。backend History永続化とDiscord送信を変更しない。
- `experiment-controller`: 独立したbaseRequest構築とrun/poll/recovery lifecycle。同じform readersを使うが、通常derivationをconsumeせずGenerationへ吸収しない。
- `recipe-workflow`: Phase 21のRuntime readiness→owner snapshot→restore→critical rollbackを維持。**Runtime切替成功がcommit境界B**。非Runtime rollbackの順序とprimitiveは[Phase 21](frontend-refactor-phase21.md) / [Phase 20.5](frontend-refactor-phase20-5.md)を参照。
- app: composition、form/cache/read/render/persistence adapter、same-seed/duplicate/派生操作、composition lock、health/Ollama、bootstrap。composition lockはフォーム側の固定であり生成mutexではない。生成成功/失敗/Experimentでは解除しない。

## Verification

2026-09-07、Astra統合review修正後の最終production:

- 新Generation test: **28 passed / 0 failed / 0 skipped**。
- 広域focused 19file: **214 passed / 0 failed / 0 skipped、exit 0**、2.651秒。timer後始末修正後のaffected focusedは **56 passed / 0 failed / 0 skipped、exit 0**。
- `npm.cmd run check`: **exit 0**。
- 最終 `npm.cmd test`: **759 total / 757 passed / 0 failed / 2 existing skips / 0 todo、exit 0**、runner 11.339秒。初回full成功後、同review cycleでGallery確認cancel後のtimer後始末を修正し回帰testを追加したため、affected focused/check/fullを再確認した。fullは計2回。最終full後は文書更新のみ。
- 実Chrome 152、loopback fixtureで通常生成→queued/running/result→Studio/History、navigation、validation、same-seed/duplicate/派生、実File/Canvasのimg2img/inpaint、IP対応差、承認recovery、両Hires、Experiment、double submit/Cancelを確認。最終sequence PASS。
- Browser console error/warning、uncaught、unhandled rejection、外部request、予期しないHTTP failureはすべて **0**。1検証cycle内でfixtureだけを2回修正し、3回目のsequenceがPASS。以後のtimer後始末修正はaffected focused/fullで確認し、Browserは追加実行していない。詳細はPhase 22記録。実provider/実generationは未実施。
- 差分/whitespace/文書リンクを確認。test logはrepository外 `%TEMP%/local-image-chat-phase22-final-{focused,check,full}.log` と最終修正後の `local-image-chat-phase22-corrected-{focused,check,full}.log`。

## Working tree / constraints

Phase 22 checkpointには `public/app.js`、新 `public/features/generation-controller.js`、`package.json`、新 `test/generation-controller.test.js`、既存 `test/task20.test.js`、Phase 22/current-state/decisions文書を収録。pushなし。

開始時からの `docs/CURRENT_TASK.md` / `docs/REVIEW_FIXES.md` と、未追跡の文書/artist-catalog/GPU Lab/画像/output/scripts等を保持した。private/local/generated artifactはstageせず、reset/restore/clean/削除なし。

ignored `workbench/ui-mocks/phase22/` にfixture、smoke script、result.json、最終Cancel後のscreenshotを保持。専用fixture serverは停止済み。既存Phase 17/20.5/21のfixtureも保持する。

## Remaining / Next first reads

Generationのform/cache/read/render/persistence coupling、派生フォーム準備、composition lockはappに残る。消費済みone-shotは失敗時も復元しない既存semantics。Historyの直接refreshとqueue terminal refreshの併存も維持した。実provider、実機mobile Safariは今回の検証対象外。

[AGENTS](../../AGENTS.md) → 本書 → [Phase 22](frontend-refactor-phase22.md) → [decisions](decisions.md) → `public/features/generation-controller.js` / `test/generation-controller.test.js`。Recipeに関係する場合はPhase 21/20.5も参照。

次候補はPhase 23 Persistence / Bootstrap。localStorageのkey/schema/保存callback、startup restore、listener boot order、PWA/bootstrapは今回整理していない。次回の明示依頼があるまで実施しない。[Discovery](frontend-refactor-discovery.md) / [Target](../refactor/target-architecture.md) / [Surgery plan](../refactor/surgery-plan.md)のロードマップは実装許可ではない。
