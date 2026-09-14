# Frontend Refactor Phase 18 — Reference Image

2026-09-07。開始HEAD `55d7bba`、Phase 17未コミット差分を保持。Phase 18のみ。commit/pushなし。

## Changed

- `public/features/reference-image.js` を追加し、local file選択、drag/drop、履歴画像、参照アセットidentity、preview、寸法取得、解像度同期、clear、runtime snapshot、生成payload read、listener/object URL lifecycleを抽出した。
- `public/app.js` は **5,292 → 5,161行（131行減）**。既存の64px丸め、256–1536 clamp、現在設定のlong edge、sync checkboxがcheckedの場合だけ同期する条件、20MB/MIME/error文言を維持した。
- `test/reference-image.test.js` を追加し、`package.json` の `precheck` に新moduleのsyntax checkを登録した。backend/API/storage/UI markupは変更していない。

## Ownership

- Reference sourceの単一ownerは `reference-image` controller。`no source` / `local-file` / `history-image` / `reference-asset` を区別し、queryはコピーを返す。
- local fileはData URLをpayload用に保持し、object URLをpreview用に所有する。replace / clear / disposeでrevokeする。file-load世代guardは後から完了した古い選択とdispose後の完了を破棄し、完了時点で作成済みの不要URLもrevokeする。遅延した寸法読込もsource identity guardで新しい参照を上書きしない。
- Inpaint mask/canvasは移していない。参照設定時は既存mode callback、clear時はInpaint controllerのreset callbackだけで接続する。Runtime、History、Studio、generation全体のstateは所有しない。

## Interface

- write: `loadFile(file)`, `useImage(image, options)`, `setReference(reference, options)`, `clear()`, `restoreSnapshot(snapshot, options)`。
- read: `hasReference()`, `getReference()`, `readPayload(mode)`, `captureSnapshot()`。
- lifecycle/UI: `init()`, `setBusy(busy)`, `syncSelectedSize()`, `dispose()`。appからはmode getter/setter、error表示、preference保存、Inpaint resetだけをcallbackとして渡す。

## Gate

- Phase単体実装時の `node --test test/reference-image.test.js`: **8 passed / 0 failed / 0 skipped**、exit 0。architecture review後はunchecked syncとpending file readのregression testを追加した。
- corrected tree最終focused `node --test test/reference-image.test.js test/inpaint-editor.test.js test/ip-adapter-controller.test.js`: **28 passed / 0 failed**。
- 最終 `npm.cmd run check`: **exit 0**。最終 `npm.cmd test`: **708 total / 706 passed / 0 failed / 2 existing skips**、exit 0、11.838s。
- mock fixtureのBrowser Smokeは最終treeで1回実施。desktopのlocal preview/寸法/clear/reload、Inpaint source clear-resetを確認し、console error/warn 0、injected error/unhandled beacon 0。実generation/providerは未実施。
- Astra architecture reviewは1回。auto-sizeがuncheckedでも同期するregressionと、pending file readがreplacement/dispose後にstate/URLを残すraceを検出して修正した。残るP0/P1/major findingなし。

## Remaining risk

- Browser上の実FileReader/Image decodingとobject URL preview、clear/reloadは最終smokeで確認済み。drag/dropの専用操作はunit contractで確認し、browserではfile input経路を使用した。
- Inpaint source-change/mask resetのownershipはPhase 19、IP-Adapter固有reference stateはPhase 20で分離済み。一般Reference sourceとの統合は行っていない。
- Runtime rollbackではlocal preview snapshotをData URLへ戻す。payload、source identity、mask keyは保持するが、blob URLそのものは意図的にsnapshotへ保存しない。
