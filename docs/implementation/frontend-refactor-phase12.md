# Frontend Refactor Phase 12 — Compare Selection

2026-09-06完了。Phase 13以降は本Phaseでは未着手。commit/pushなし。

## Changed

`public/features/comparison-controller.js`を追加し、`app.js`からCompare selection、tray、Gallery比較モード、Compare entry、view起動、vote記録を抽出した。既存`compare-view.js`のpath/export/表示実装は変更していない。`package.json`のsyntax checkへ新moduleを追加し、配置依存testを新ownerへ追従した。

## Ownership

controllerは正規化したimage IDをkeyにする単一selection Map、2〜4枚制限、選択順、remove/clear、tray、Gallery checkbox、Studio/card/detailの比較control同期、Compare entry/view、vote処理を所有する。

History paging/cache/fetch、recipe、generation、Experiment lifecycle、Favorite/notification stateは所有しない。Experimentからは比較entries、parameter、experiment IDだけを受け、best更新とHistory reloadはappの狭いcallbackへ返す。

## Interface

主なinterfaceは`init` / `dispose`、`toggle` / `clear`、`isSelected`、`syncControl` / `sync`、`setGalleryMode`、`openEntries` / `compareSelection`、`getSelection`、`isGalleryMode`。History cardsとStudioはselection internalsを参照せず、これらのportをappから利用する。

Gallery選択とtrayはthumbnailのみを使用する。Compare viewも最初はthumbnailで表示し、既存の「原寸で比較」操作までoriginal取得を遅延する。

## Gate result

- focused Compare suite: **65 passed / 0 failed**
- `npm.cmd run check`: **exit 0**
- Phase単独のfull suite / Browser Smoke: Lean Run指定により未実施

## Remaining risk

既存`compare-view`の多画像vote result表現は先行仕様どおり維持した。Phase 13ではExperiment controllerがselection Mapを複製せず、比較結果を`openEntries`へ渡すだけにすること。Compare完了後もGallery selectionを自動clearしない既存挙動を維持すること。
