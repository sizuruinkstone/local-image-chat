# Frontend Refactor Phase 10 — Studio Result Display

2026-09-06完了。Phase 11以降は未着手。commit/pushなし。

## 抽出したownership

`public/features/studio-controller.js`へ、`selectedCandidate`、`lastGeneration`、`finalImage` / `finalGeneration`、Studio inspection、recent filter、表示timerを移した。候補・選択・最終結果・recent cards・read-only metadata・copy・Studio固有listener・runtime依存action表示も同controllerがowner。`public/features/image-modal.js`へ、Studio / Gallery / LoRA等で共用するoriginal拡大表示とclose/Escape listenerを抽出した。

controllerは既存`image-delivery.js`、`metadata-format.js`、`history-title.js`、`studio-history.js`とPhase 9の`image-state` portを利用する。Favorite/Discord stateやwatcherは重複保持せず、controller内にAPI fetch、polling、cache bustingを追加していない。

## Interfaceとapp側workflow

主なcontroller interfaceは`init` / `dispose`、`resetForGeneration`、`setCandidates`、`selectCandidate`、`presentFinal`、`inspect`、`renderRecent` / `renderRecentError`、`setHistoryFilter`、`syncOutputStats`、`updateGenerationState`、`syncWorkflowAvailability`とresult state getter。

appはcomposition rootとして、History取得、runtime feature判定、form stats、Compare、IP-Adapter参照、recipe適用、同Seed再生成、img2img/inpaint、Gallery詳細を明示callbackで接続する。Generation request構築・送信、runtime activation、form/Prompt/LoRA、History paging/cache/merge、Compare/Experiment/IP-Adapter workflowはapp側に残した。

## 維持した表示契約

- candidate/recent/finalの通常表示はthumbnail。candidate選択、recentからの明示選択、zoom、downloadだけoriginalを使う。
- thumbnail失敗時のoriginal fallbackは1回だけで、その後placeholderへ進む。timestamp/random queryは追加しない。
- 新規生成開始時はselected/final/inspectionだけをclearし、前回の`lastGeneration`、candidate cards/summary、metadataは成功結果で置換されるまで保持する。
- candidate選択はmain previewだけを更新し、loading/final panelのvisibilityを変更しない。recent選択の明示`showOnCanvas`経路は従来どおりcanvasへ切り替える。
- 最新のruntime/IP-Adapter availabilityをbusy transition後も保持する。画面遷移ではresult/inspectionをresetしない。

## Verification

- focused: Studio controller/modal、UI shell、Task20 runtime、image delivery/state、metadata、Studio historyの**95 passed / 0 failed**。
- Task10 server integration: **8 passed / 0 failed**。
- `npm.cmd run check`: exit 0。新2moduleをcheck列挙へ追加。
- `npm.cmd test`: **611 total / 609 passed / 0 failed / 2 opt-in skips**。
- substantial-change review: 初回に見つかったavailability、生成開始reset、candidate visibilityの3回帰を修正し、各回帰testを追加。再reviewでactionable findingなし。

## Browser smoke

isolated localhost fixtureをChromeで確認し、実Forge Neo / ReForge / Discordへは接続していない。

- 1366×768: empty center、recent 2件、候補2枚、候補変更、selected original、metadata seed/prompt、zoom/Escape、metadata copy、Favorite同期、Gallery→Generateのstate保持を確認。
- candidateは各`/thumbnail`を1回取得し、自動選択したcandidate Aと明示選択したcandidate Bの`/original`を各1回取得。Favorite履歴Bの明示選択でoriginal 1回。未選択originalの一括取得とcache-bustingなし。
- 390×844: 候補2枚、main preview、metadataを維持。`innerWidth=390`に対し`document.scrollWidth=375`。
- smoke後にviewportを戻し、tabとfixture serverを終了した。

## Remaining coupling / Phase 11前の境界

appとの意図的な結合は、History fetch、runtime capability、form stats、Compare/IP-Adapter/recipe/regeneration callbackと`image-state` port。`public/app.js`は8,795行から8,386行へ409行減少した。

Phase 11前に、History paging/cache/mergeのownerとGalleryのrender/filter、Studioへ渡すsnapshot、delete/update通知の境界をreviewする。Studio controllerにHistory取得やform適用を吸収せず、Phase 10のstate getter/callbackを必要最小限で利用する。
