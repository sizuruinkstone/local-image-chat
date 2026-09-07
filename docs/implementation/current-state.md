# Current state — Local Image Chat

## Checkpoint split — 2026-09-08

ユーザーGOによりR1–R7だけを3commitへ分割。共通contract `a38f3b3`、New Studio workflows `b7583c6`、Production切替は本記録を含むcommit。Pearl Glass/旧Gallery、Lab、Artist catalog、検証画像・browser sessionは未commitで保持。pushなし。

各index treeをTEMPへ独立展開して検証。Git archiveの改行変換を無効にして保存内容どおりのLFで実行し、checkとfull suiteはそれぞれ814/812 pass、825/823 pass、827/825 pass（全てfail 0、既存skip 2）。832件の過去working-tree gateとの差5件は、除外した旧Gallery改修test。New Studioのfixture browser5本を候補treeで確認。Library smokeはviewport切替直後のoverflow assertionが一度失敗し、同一tree再実行でPASSした。実Provider生成・Production再起動はcheckpoint作成では再実施していない。

## Frontend Full Rebuild — R5 / R6 / R7 completed

2026-09-08: **New StudioをProduction defaultへ切替済み**。通常 `http://127.0.0.1:3030/`、明示rollback `/?legacy=1`。ユーザーのAutonomous Completion Runを単一agentで完了。stage / commit / pushなし。開始時のR1–R4・legacy・文書・未追跡/private/generated差分を保持。

R5: actual full Library / 全保持履歴search・Newest/Oldest / paging / Recent / Fit/Zoom Viewer / Metadata / 明示Reuse。R6: Hires・Canvas Inpaint・IP reference・Compare・Experiments・Civitai入口・Profiles/Checkpoint Sets/outfit、canonical Draft保存・実行中Job GET reattach。R7: native ESM本番bootstrap、明示legacy entry、SW/cache/static/updater coverage。Structured6section / Raw / Negative / Final PreviewとCanvas/Dock寸法を維持。

今回の最終gate: check PASS、full **832 total / 830 pass / 0 unexpected fail / 2 existing skips**。R2–R6 browser PASS。Production 5幅1280/1440/1920/390/430で各surface、refresh/direct navigation、旧cache除去、legacy load PASS。Production実生成2回＋Cancel、生成中reload→同一Job再接続、History→Reuse→再生成、Mobile実Generate/Cancel PASS。実AdvancedはSteps8/10のExperimentで2画像完成。実iPhone Safariは未検証。

最初に読む: [最終実装・検証・変更file・制約](frontend-full-rebuild-final.md) → [本番entry](../../src/frontend-entry.js) → [workspace contract](../../public/features/generate-workspace.js) → [Production smoke](../../dev/studio/production-smoke.mjs)。証拠`workbench/final/`。Forge Neoは既存仕様でHires/Inpaint/IP非対応（対応ReForge contractはintegration検証）。local upload/maskはreload保存対象外。Legacyはrollback用に保持。追加Phaseへ進まず完了。

以下は以前のcheckpoint記録であり、現在のProduction entry・検証結果は上記を優先する。

## Previous checkpoint — R4 completed

2026-09-08追補: ユーザー指定によりLoRA folder操作を左の階層ツリーへ集約。開閉・子folder選択・root/親へ戻るを左だけに置き、上部は現在位置の表示のみ、asset grid内のfolderボタンは削除。Mobile/TabletはFoldersから同じ左drawerを開く。folder選択/展開を保持し、Escapeはdrawer→Browserの順に閉じる。変更はBrowser/CSS/R4 smokeと文書のみ。今回check PASS、全体821 total / 819 pass / 0 fail / 2 existing skips、R4 smokeおよび実catalog Desktop/390px確認PASS。実生成は今回再実行していない。Canvas/Dock寸法維持。証拠 `workbench/r4/left-tree-{desktop,mobile}.png`。

2026-09-08: **R4 Full LoRA Browser + Composition Workflow完了**。サブエージェントなし。Dockから独立LoRA Browserへ入り、folder/back/breadcrumb/root・global search・共有Favorite・preview/details・明示trigger挿入・Active Compositionの追加/weight±/数値/enable/remove/上下移動が成立。R1 canonical LoRA stateを共有し、旧DOM/CSS依存なし。Structured 6 sections / Raw / Negative / Final Previewと「構造プロンプト」の見出しを保持。Production切替なし、R5未実施。

検証: check PASS、full **821 total / 819 pass / 0 fail / 2 existing skips**、R2/R3/R4 browser smoke PASS。実Forge Neo / Anima・現在のoneObsessionAnima_v30でflat-color LoRA 0.55の有効/無効2jobが成功し、実画像をCanvasへ表示。実catalog148件・既存Favorite10件、初期60件描画。R3比Canvas/Dock寸法は5幅すべて維持。390/430px fullscreen・440px高さ・focus/Escape/復帰を確認。実iPhone Safari/実soft keyboard未検証。

開発entry: `npm.cmd run studio:dev` → `http://127.0.0.1:41972/studio-next/`。既存3030 backendへ接続し、Favorite ensure/PATCHを開発gatewayに追加。Production app/index/style/serverのhashは維持。開始時のdirty/未追跡成果物を保持し、stage/commit/pushなし。

最初に読む: [R4実装・変更file・検証・制約](frontend-full-rebuild-r4.md) → [Browser](../../public/frontend/components/lora/lora-browser.js) → [R1 workspace](../../public/features/generate-workspace.js) → [R4 smoke](../../dev/studio/lora-smoke.mjs)。証拠はignored `workbench/r4/`。スクリーンショットは会話へ画像データとして提示。R5以降のLibrary/高度機能/session保存/Production切替は別途指示を待つ。以下は過去milestone。

## Frontend Full Rebuild — previous R3 milestone

2026-09-07: **R3 Real Generate Workflow Integration完了**。サブエージェントなし。Structured 6 sections / Raw / Negative / Final Preview / Dock / Workspaceを維持し、実Generate・Cancel、Model Picker、Resolution/Seed/Active LoRA/Candidates、InspectorのSampler/Scheduler/Steps/CFG、結果metadataと明示Reuse、Recovery dialogを接続。通常entryは `npm.cmd run studio:dev` → `http://127.0.0.1:41972/studio-next/`、既存3030 backendへ開発専用gatewayで接続。R2 mockは明示`?fixture=r2`だけ。Production切替・R4は未実施。

実Provider: Forge Neo / Anima + anima29B_v10、768×768 / 16 stepsでNew Studio→実job→完成画像→Canvas成功。Seed 314159→314160の再生成とCancelも確認。実browser page/console error 0。詳細job ID・初回検証harnessのtimeout修正・画像は[R3記録](frontend-full-rebuild-r3.md)。実生成のbefore/generating/completedとMobile画像を会話へ画像データとして提示。

検証: check成功、full suite **815 total / 813 pass / 0 fail / 2 existing skips**。R2 browser smoke PASS。R3 integrationはPrompt/request一致、settings、model失敗/selection、LoRA、candidate/metadata/reuse、double submit、cancel、failure、recovery承認、Runtime unavailable/backend再接続をPASS。5幅のCanvas/Dock寸法はR2と一致（1440:624/178px、390:496/202px）。実iPhone Safari/実soft keyboard未検証、440px高さの編集確認で代替。

変更: 新generation projection・settings/dialog/Recovery components、既存新Shellの接続、R1のcancelRequested/guard/catalog refresh、dev server/boot/smoke、test、packageと引継ぎ文書。開始時のdirty/未追跡成果物を保持。Production index/style/app/serverは開始時hashと一致。stage/commit/pushなし。

最初に読む: [R3実装・制約・検証](frontend-full-rebuild-r3.md) → [Shell接続](../../public/frontend/app/app-shell.js) → [R1 contract](../../public/features/generate-workspace.js) → [integration smoke](../../dev/studio/integration-smoke.mjs)。Full LoRA Browser/Library、advanced生成機能、session restoreは後続範囲。Clip Skipは現R1 parameter contractにないため未追加。R3で停止。以下は過去milestoneの記録。

## Frontend Full Rebuild — previous R2 milestone

2026-09-07追補: **Structured PromptをPrimary Workflowに修正**。Dockは既存6sectionのcompact summary、展開先は独立Prompt Workspace。Structured / Raw / NegativeとFinal Positive・Negative previewをR1 stateへ接続。mode切替時はStructuredとRaw編集を保持（空Rawを含む）。詳細は[R2追補](frontend-full-rebuild-r2.md)。今回focused 27 pass、check成功、full suite **811 total / 809 pass / 0 fail / 2 existing skips**。Browser smokeは5幅・個別section編集・mode往復・preview・NegativeをPASS、console/HTTP error 0。スクリーンショットは`workbench/r2/prompt-*`へ保存し、会話にも画像データで直接提示。新Prompt WorkspaceとDock/app-shell/CSS、fixture boot、generation-draftのmode境界、test/smoke/packageを変更。Production変更とR3の実生成接続はなし。以下の初回R2結果は追補前の記録。

2026-09-07: **R2 New Application Shell + Visual Direction Gate完了**。サブエージェントなし。独立DOM/CSSのCanvas中心Shell、App Bar内Studio/Library nav、下部Prompt Dock、必要時右InspectorとMobile sheetを実装。開発専用entryは `npm.cmd run studio:dev` → `http://127.0.0.1:41972/studio-next/`。R1のinitialize/snapshot/subscriptionとPrompt更新を接続。Generate・Canvas lifecycle・Library画像はfixture/mock。Production切替とR3は未実施。

最初に読む: [R2実装・画像・検証](frontend-full-rebuild-r2.md) → [新Shell](../../public/frontend/app/app-shell.js) → [dev entry](../../dev/studio/boot.js) → [R1 contract](frontend-full-rebuild-r1.md)。変更は新`public/frontend/`、`dev/studio/`、`test/frontend-shell.test.js`、package scripts、本snapshotとR2記録。R3から既存workspaceのGenerate lifecycle・parameter/model/LoRA/historyをcomponent callbackへ接続可能。現時点でR3接続を阻害する問題は確認なし。

検証（今回実行）: focused 25 pass、check exit 0、full suite **809 total / 807 pass / 0 fail / 2 existing skips**。Chrome browser smoke PASS、1280/1440/1920/390/430とCanvas5状態、nav/Inspector/resize/draft保持を確認。console/HTTP/external request 0、横overflowなし。スクリーンショットを`workbench/r2/`へ保存し目視確認。Productionのindex/style/app/serverは開始時SHA256と一致。実provider生成・実iOS/Safari・soft keyboardは未実施。

保持: 開始時のR1・既存UI・文書・test・未追跡成果物を保持。依存追加、stage/commit/pushなし。R2で停止。以下は過去milestoneの記録。

## Frontend Full Rebuild — previous R1 milestone

2026-09-07: **R1 Functional Contract Characterization + Adapter Boundary完了**。サブエージェントなし。DOM非依存の`createGenerateWorkspace`、canonical JS draft、Runtime service、共通request/settings/Recentを実装。旧UIは同じRuntime/request/settings/Recent coreを旧adapterから使用。Production entryとHTML/CSSは変更なし。R2未着手。

最初に読む: [R1実装・API・制約](frontend-full-rebuild-r1.md) → [公開workspace](../../public/features/generate-workspace.js) → [behavior tests](../../test/generate-workspace.test.js) → [承認済み計画](../ui/frontend-full-rebuild-plan.md)。R2はこの公開contractでNew Shellの基本Generateを組める。高度機能、Checkpoint Set/profileの新entry接続、全保存restore、全Galleryは後続範囲。

検証: baseline 782 pass、最終805 total / **803 pass / 0 fail / 2 skips**、check exit 0。新21 behavior tests。旧source位置に依存した3検査を抽出先／behaviorへ追従後に全green。Chrome隔離fixtureで旧UI生成・metadata reuse・1440/390/430、空documentで新contract生成・reuse成功、console/HTTP error 0。Node smoke PASS。実provider/実Safari未実施。詳細・log位置はR1記録。

保持: 開始時のdirty UI/文書/testと未追跡成果物を保持。新6production modules、旧4modulesの限定接続変更、package check登録、test3files、引継ぎ文書のみ。stage/commit/pushなし。R1で停止。

## Frontend Full Rebuild — previous planning milestone

2026-09-07: 新しい明示依頼に基づく**Frontend Product RedesignのFirst Deliverable（R0 Planning）を作成**。旧UIを配置の参考にせず、Canvas中心・下部Prompt dock・必要時Inspector・同じStudio内のLibraryという新IAを提案。Production実装・default切替は未実施。

最初に読むfiles: [Full Rebuild Plan](../ui/frontend-full-rebuild-plan.md) → [Desktop / Mobile wireframes](../ui/frontend-full-rebuild-wireframes.md) → [継続contract](decisions.md)。新計画にはaudit、四分類、機能contract、design system、component構成、移行/risk/R0–R9と検証gateを記載。旧DESIGNの配置条件より今回のゼロベース設計依頼を優先し、旧DESIGN自体は稼働UIの履歴として保持した。

今回変更: 上記新規2文書と本snapshotのみ。静的source/配信/SW/updater確認、文書リンク・内容・whitespace確認を実施。test suite/browser/実provider生成は未実施。以下の782 pass等は旧UIの過去検証で、新UIの検証結果ではない。

保持: 開始時のDESIGN、CURRENT_TASK/REVIEW_FIXES、app/index/style、History/Studio、関連test、既存未追跡docs/output/scripts等の差分。削除・stage・commit・pushなし。次候補はR1 contract characterizationとform/presentation adapter境界の確定。その後R2で独立shellを構築する。新UIの機能parityと配信gate前にProductionを切り替えない。

## Previous checkpoint — Phase 23

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
