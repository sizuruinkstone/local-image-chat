# Current state — Local Image Chat

更新: 2026-09-07。branch `checkpoint/frontend-refactor-phase13`にPhase 1–23完了checkpoint `refactor: complete frontend extraction through phase 23`を作成。Phase 22 rollback point `2e37ec9`を保持し、pushなし。

## Current / completed

**Frontend Refactor Phase 23 Persistence / Bootstrap完了。Phase 1–23のfrontend refactor roadmap完了。**

[Phase 23記録](frontend-refactor-phase23.md) に起動順、Persistence ownership、controller init、listener/monitor/page teardown、storage互換、検証根拠を記録した。Phase 23完了で停止し、UI新築や次作業へ自動で進まない。

`public/core/preferences.js`へapp-owned storage keyと既存serialization/fallback、`public/features/settings-update.js`へGitHub session tokenとversion/update、`public/app/bootstrap.js`へ明示startup phase・static listener registry・single page teardownを抽出。`public/app.js`は **4,479 → 4,352行（127行減）**となり、DOM/dependency composition → controller作成 → restore/load → init/startを読むcomposition rootへ整理した。

HTML/CSS、backend/API、History、storage key/schema/version、Service Worker/cache/update strategy、Runtime/Prompt-LoRA/Recipe/Generation semantics、framework/build systemは変更していない。新しいarchitecture decisionは生じず、`decisions.md`は変更していない。

## Bootstrap / ownership snapshot

起動順:

1. Runtime → Checkpoint Set → LoRA Library → Civitai pre-config init。
2. `/api/config` → `/api/runtimes`とconfig-backed preference restore。version contractは従来どおり非blocking。
3. title/checkpoint/img2img/Inpaint/Prompt parts/GitHub session token restore、PWA `/sw.js`登録、initial UI preparation。
4. health、checkpoint、LoRA、History、Civitai folders、LoRA root、Experiment、Checkpoint Set、Discord、Prompt template、AI share、Sampler、Storage、IP optionsを既存`Promise.all`で1回load。
5. initial state/render sync → app-lifetime Queue monitor → primary listener → controller init → feature listener → saved view → late Prompt listener → single page teardown。

post-load controller init順:

```text
Navigation → Sampler → Settings Navigation → Discord Settings → Storage Settings
→ AI Share → Queue → Image State → Studio → Comparison → History → Experiment
→ Reference Image → Inpaint → IP-Adapter
```

`PROFILE_STORAGE_VERSION = 3`、全`localImageChat.*` key、string/JSON/array/Map/Set変換、破損/missing fallbackを維持。GitHub/Civitai tokenはsessionStorage限定。Navigation、Runtime、Sampler、LoRA Library、Civitai、Inpaint等のfeature keyは各controller ownershipのまま明示storage portを受ける。

Queue/Experiment monitorはnavigationで停止せずapp lifetime。page teardown時はstatic listenerを解除し、controllerをreverse disposeする。Queueはsleep中とin-flight GET後の両方にlifecycle guardを持ち、teardown後にrender/通知/History refreshしない。Reference/IPはapp composition時のみ個別`beforeunload`を抑止し、single teardownからobject URL/pending readを一度だけ破棄する。navigation disposeとJob cancelは接続していない。

## Verification

2026-09-07、architecture review修正後の最終production:

- affected focused 8 files: **101 total / 100 passed / 0 failed / 1 existing skip、exit 0**。
- broad focused 33 files: **350 total / 348 passed / 0 failed / 2 existing skips、exit 0**。
- title部分成功fallback補正後のaffected focused 4 files: **54 passed / 0 failed / 0 skipped、exit 0**。
- `npm.cmd run check`: **exit 0**。新3moduleと監査で既知の既存漏れ9 JS fileを明示列挙へ追加。
- 最終 `npm.cmd test`: **779 total / 777 passed / 0 failed / 2 existing skips / 0 todo、exit 0**。初回full（778 total / 776 passed）後、厳密なtitle部分成功fallback補正が入ったためpost-review production修正例外としてaffected/check/fullを再実行した。最終full後は文書のみ。
- 実Chrome 152.0.7977.77 + loopback fixtureのcomplete cycle: **PASS**。fresh load/initial render、assert対象initial fetch各1回、Runtime/catalog、Prompt/settings/profile save/restore、Gallery/Generate、reload、corrupt JSON fallback、fixture generationを確認。console error/warning、uncaught、unhandled rejection、HTTP failure、external requestはすべて **0**。server停止済み。
- Browser完走前にignored harnessのhidden control操作/fixture profile idを3回修正した。各途中停止はapp errorではなく、production差分なし。修正後のcomplete sequenceがgreen。
- Browser後のtitle補正はnormal browser pathを変えないため反復せず、affected/check/fullで最終productionを確認。
- Astra read-only architecture reviewを1回実施。P1なし。P2 Queue in-flight teardownとP3 title grouped storage fallbackを修正し、回帰testと全gateで確認。重大findingなし。
- `git diff --check`と最終scope/statusは文書更新後に確認。test logはrepository外 `%TEMP%/local-image-chat-phase23-*.log`。

## Working tree / constraints

Phase 23 checkpointには、上記3module、`public/app.js`、Queue/Reference/IP lifecycle、関係test、`package.json`、本書とPhase 23記録を収録。ignored `workbench/ui-mocks/phase23/`にsmoke script/screenshotを保持する。

開始時からの `docs/CURRENT_TASK.md` / `docs/REVIEW_FIXES.md` と、未追跡の文書/artist-catalog/GPU Lab/画像/output/scripts等をそのまま保持した。private/local/generated artifactをstageせず、削除・巻き戻しなし。

## Remaining / UI新築前の竣工検査

`app.js`にはDOM cache、form/read/render/persistence adapter、Prompt/LoRA profile適用、Runtime/Recipe ports、派生フォーム準備、composition lockが残る。これは既存owner間のcompositionであり、中央storeや逆importへ変更していない。History空結果時の再fetch、health fallback時の再取得、Queue terminalとGeneration完了からのHistory refreshは既存semanticsとして残る。

UI新築前は、(1) fresh/missing/corrupt/reload storage matrixと全key snapshot、(2) startup/init/listener/fetch/monitor count、(3) slow Runtime/health/catalogとnavigation race、(4) Runtime→capability、Prompt-LoRA→Checkpoint Set/Recipe、Image State→Studio/Gallery、Queue→Generation terminalの結合、(5) navigation後stateとpage teardown/object URL、(6) History/Gallery pagination/filter/Favorite、(7) PWA/static/update contract、(8) desktop/mobile/Safari layout/accessibility、(9) fixture全経路、(10) 別承認gateで実provider/実機を検査する。

次回の最初のreadは [AGENTS](../../AGENTS.md) → 本書 → [Phase 23](frontend-refactor-phase23.md) → [decisions](decisions.md) → `public/app/bootstrap.js` / `public/core/preferences.js` / `public/features/settings-update.js`。Phase 22以前の生成・Recipe境界は各Phase記録を参照する。
