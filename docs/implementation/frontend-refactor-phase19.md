# Frontend Refactor Phase 19 — Inpaint Editor

2026-09-07。Phase 18完了時点からPhase 19のみ。既存dirty差分を保持し、commit/pushなし。

## Changed

- `public/features/inpaint-editor.js`（343行）を追加し、base image同期、mask canvas、paint/erase、pointer処理、undo/redo/clear、mask判定、PNG export、tool/history state、preferences、listener lifecycleを抽出した。
- `public/app.js` は **5,161 → 4,909行（252行減）**。Inpaintのmutable stateとlistenerを削除し、Reference・generation・busy・config/recipe restoreをnarrow portへ置換した。
- `test/inpaint-editor.test.js` を追加し、`package.json` の `precheck` に新moduleを登録した。backend/API/storage schema、HTML/CSS、IP-Adapterは変更していない。

## Ownership

- Inpaint canvas/mask/tool/drawing/last point/source key/undo-redo stackの単一ownerは `inpaint-editor`。履歴上限は既存どおり12。
- Reference Image sourceはPhase 18 controllerのownerのまま。appが `getReference()` のコピーを `setSource(reference)` へ渡し、Inpaintはsource registryやHistory/Studio stateを保持しない。
- source keyが同じ場合はmaskを保持し、replacement時はsource image load成功後にbacking canvasをsource実寸へ合わせ、mask/historyをresetする。古い非同期loadはkey guardで無視する。
- 表示rect、canvas backing size、source sizeを分離し、pointerは `displayed rect → backing canvas` の既存比例変換を維持した。
- maskは既存どおり `source-over` の不透明黒で初期化/eraseし、不透明白をpaintする。白判定thresholdはred channel `> 16`、exportはcanvas実寸のPNG。

## Interface

- Reference接続: `setSource(reference)`, `reset()`。
- 編集: `setTool(tool)`, `clearMask()`, `undo()`, `redo()`, `hasMask()`。
- generation: `readPayload(mode)`。`inpaint`かつcanvasありの場合だけ `{ maskImage: PNG Data URL }` を返す。
- lifecycle/settings: `init()`, `dispose()`, `loadPreferences()`, `savePreferences()`, `setDefaultFullRes(value)`, `setBusy(busy)`。
- appはgeneration mode、Reference query、既存settings DOM、backendへ送る全payload組立だけを保持する。

## Gate

- Phase単体実装時の `node --test test/inpaint-editor.test.js test/reference-image.test.js`: **17 passed / 0 failed / 0 skipped**、exit 0。内訳は新規Inpaint 9件、Reference回帰8件。
- architecture review修正後の最終focused `node --test test/reference-image.test.js test/inpaint-editor.test.js test/ip-adapter-controller.test.js`: **28 passed / 0 failed**。
- 最終 `npm.cmd run check`: **exit 0**。最終 `npm.cmd test`: **708 total / 706 passed / 0 failed / 2 existing skips**、exit 0、11.838s。
- mock fixtureのBrowser Smokeは最終treeで1回実施。実canvasでpaint/erase/undo/redo/source clear-resetを確認した。desktopはdisplayed 278px / backing 1254px、412px viewportではdisplayed 324px / backing 1254pxでpointer操作が機能した。
- 同じsmokeでconsole error/warn 0、injected error/unhandled beacon 0。実generation/providerは未実施。Astra architecture reviewは1回で、Phase 18/20のauto-size guardとpending file/dispose raceを修正後、残るP0/P1/major findingなし。

## Remaining risk

- pointer capture、responsive表示時のdisplay/backing座標変換、paint/erase/undo/redo/source resetは最終Browser Smokeで確認済み。unit testのcanvas fakeは簡略化されているが、実canvas smokeで補完した。
- 非同期undo snapshotの完了がsource replacement/resetと競合し、古いsnapshotを描画する可能性は既存経路から継承している。
- Image load失敗時に直前canvasがload完了まで残る挙動、brush幅をbacking pixelとして扱う挙動は既存互換のため維持した。
- Recipe workflow全体のapply順はPhase 21へ残して未着手。Phase 19では既存recipe/settings restore callbackからeditorの保存表示同期を呼ぶだけに留めた。
