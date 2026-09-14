# Frontend Refactor Phase 11 — Gallery / History

2026-09-06完了。Phase 12以降は本Phaseでは未着手。commit/pushなし。

## Changed

`public/features/history-controller.js`を追加し、`app.js`からHistory取得、画像ID cursor paging、append merge、Gallery cache/filter/sort、card/empty/error表示、detail表示、content rating更新、画像削除、Gallery固有listenerを抽出した。`package.json`のsyntax checkへ新moduleを追加し、配置依存testを新ownerへ追従した。

## Ownership

controllerはgenerations/page snapshot、cursor、hasMore/loading/total、Gallery filter/sort/tag query、取得済みentry、card/detail表示を所有する。`mergeHistoryGenerations`は同generationの画像をimage IDで重複排除し、既存generation/image順を保持する。

Favorite/Discord状態は`image-state`、Studioの選択/inspectionは`studio-controller`、Compare selectionとExperiment lifecycleは引き続きapp側owner。recipe復元、派生生成、Hires、Compare操作はcontrollerへ移さずcallbackで接続した。

## Interface

主なinterfaceは`init` / `dispose`、`load` / `loadMore`、`loadStudioRecent`、`render`、`setFilter` / `resetFilter`、`openDetail`、`getGenerations` / `getEntries` / `getState`。appはworkflow callback、runtime capability、Studio recent presentation、image-state port、History更新後のExperiment/Compare再描画だけを注入する。

一覧はthumbnailのみを設定し、originalはcardクリック、detail、zoomなどの明示操作時だけ使用する。API、History schema、filter-before-page、画像ID cursor、automatic retryは変更していない。

## Gate result

- focused Gallery/History suite: **96 passed / 0 failed**
- `npm.cmd run check`: **exit 0**
- Phase単独のfull suite / Browser Smoke: Lean Run指定により未実施

## Remaining risk

既存のfilter切替中request競合はscope外として変更していない。Phase 12では`comparison-controller`がselection Mapを単独所有し、History controllerの`getEntries`とcard callbackだけを利用すること。Phase 13ではExperiment cache/lifecycleをHistory cacheへ混ぜないこと。

最終architecture reviewのfollow-upで、開いているdetailを`dispose`時に閉じ、controller所有のoverlayとdocument keydown listenerを確実に解除するよう補強した。
