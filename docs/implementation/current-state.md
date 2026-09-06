# Current state — Local Image Chat

更新: 2026-09-07。HEAD `3527a98`、既存checkoutの未コミットworking tree。commit/pushなし。

## Current / completed

ユーザー指定の**Frontend Refactor Phase 3–13が完了。Phase 14へ進まず停止。** Phase 1/2の既存実装も保持している。Phase 14は次候補にすぎず、実装は許可されていない。

今回完了した記録: [Phase 11 — Gallery / History](frontend-refactor-phase11.md)、[Phase 12 — Compare Selection](frontend-refactor-phase12.md)、[Phase 13 — Experiment Workflow](frontend-refactor-phase13.md)。継続判断は[decisions](decisions.md)、全体経緯は[Discovery](frontend-refactor-discovery.md)と[Audit](../refactor/surgery-plan.md)を参照する。Auditの未承認/未実装記述は監査当時の状態。

`public/app.js`はPhase 10終了時の8,386行 / 348,957 bytesから、現在7,156行 / 295,592 bytes。Phase 11–13で**1,230行 / 53,365 bytes減**。

## Current ownership

- app: composition、runtime/form、通常生成、recipe復元・派生workflow。DOMのフォーム値が正本。
- `history-controller`: History generations/page cache、画像ID cursor、paging/append/merge、backend対象filter、取得済みpage内filter/sort、Gallery card/detail、Studio recent取得。Favorite/Compare/recipe/Experimentへはnarrow callbackで接続。
- `comparison-controller`: 正規化image IDのselection Map、2–4枚制限と順序、tray、Gallery/Studio/control同期、Compare entry/view、vote。History cacheやExperiment lifecycleは所有しない。
- `experiment-controller`: Experiment frontend state、単一のExperiment固有status monitor、result entry cache、baseRequest/fixed seed、run/progress/card/detail/recovery、cancel/rename/delete/result導線。Queue/History/Compareの公開callbackだけを利用し、それらのMap/cacheを複製しない。
- `queue-controller`: 全jobのqueue snapshot/poll/panel/terminal state。Experiment固有status monitorとは別責務。
- `image-state`: Favorite Map、通知2系統のMap/watcher、image ID同期、watch/retry、最終Favorite listener。Favorite Mapの単独owner。
- `studio-controller`: candidate/selection/final/inspection/recent filterとStudio表示/listener/timer。History全体cacheやfetch、通知watcherは所有しない。
- `image-modal`: 共用original zoom、close/Escape listener。Gallery/Studio/Compare/Experimentの一覧・tray・resultはthumbnail、originalは明示操作時だけ取得。

Phase 11–13で追加した主な実装とcharacterizationは、[`history-controller.js`](../../public/features/history-controller.js) / [`history-controller.test.js`](../../test/history-controller.test.js)、[`comparison-controller.js`](../../public/features/comparison-controller.js) / [`comparison-controller.test.js`](../../test/comparison-controller.test.js)、[`experiment-controller.js`](../../public/features/experiment-controller.js) / [`experiment-controller.test.js`](../../test/experiment-controller.test.js)。backend/API/History schema/runtime/storage contract、HTML/CSSは変更していない。

## Verification

各PhaseのLean gateは個別記録どおり成功:

- Phase 11 focused Gallery/History: **96 passed / 0 failed**、`npm.cmd run check` exit 0。
- Phase 12 focused Compare: **65 passed / 0 failed**、`npm.cmd run check` exit 0。
- Phase 13 focused Experiment: **68 passed / 0 failed**、`npm.cmd run check` exit 0。

2026-09-07に最終full suiteをexactly onceで実行: **624 total / 622 passed / 0 failed / 2 existing opt-in skips**、duration **11.96s**。

同日のbrowser smokeもexactly onceで成功。Gallery pagingは2→4件、Favorite filterは1件、`img-a`のFavoriteは同じimage IDを持つ3 controlで同期。Compareは2件選択をmodal後も保持し、remove後1件。Experiment detailは2 result、recovery表示、best表示を確認し、Galleryへ戻って4件、Studio recentも4件。console errorは0、画像requestはthumbnailのみでoriginal requestは0。390×844ではCompare `scrollWidth=390`。既知のGallery `scrollWidth=422`は変更なし。

最終architecture reviewではdispose lifecycleを2点検出し、その後focused修正した。Experiment pollはlifecycle generationでdispose後のawait応答・UI/callback更新を無効化し、再init/loadでrunning experimentを監視できる。History disposeは開いているdetail overlayとdocument keydown listenerを閉じる。修正後の指定combined testは**11/11 passed / 0 failed**、`npm.cmd run check` exit 0。exact-one指定に従い、修正後に2回目のfull suite/browser smokeは実行していない。

## Working tree / constraints

本runのapp/package、新controllerとtest、source-sensitive assertion、Phase文書、本snapshotは未コミット。開始時からのPhase 1/2差分、`CURRENT_TASK` / `REVIEW_FIXES`差分、artist/twitter文書・画像・ZIP、luna-tasks、rootのmalice画像、`output/`、`scripts/`、local config/data、その他private/untracked artifactを保持している。これらを削除・巻き戻し・一括stageしてはならない。

残る既知事項は、Gallery filter切替中のrequest raceと390pxでのGallery `scrollWidth=422` overflow。いずれも今回のPhase 11–13抽出scope外で、無断修正しない。

## Next first reads

再開時は [AGENTS](../../AGENTS.md) → 本書 → [decisions](decisions.md) → [Phase 11](frontend-refactor-phase11.md) / [Phase 12](frontend-refactor-phase12.md) / [Phase 13](frontend-refactor-phase13.md) → [`history-controller.js`](../../public/features/history-controller.js) → [`comparison-controller.js`](../../public/features/comparison-controller.js) → [`experiment-controller.js`](../../public/features/experiment-controller.js) → `public/app.js`のcontroller compositionを読む。

次候補はPhase 14のみ。明示的な実装依頼を受けるまでは開始しない。
