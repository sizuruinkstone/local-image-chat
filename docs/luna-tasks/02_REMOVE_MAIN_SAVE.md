# Luna Task 02：中央ツールバーの保存ボタン廃止

## 目的

生成画面中央の選択画像ツールバーから、手動ダウンロード用の「保存」だけを削除してください。画像の自動保存、履歴保存、最終Hires結果のダウンロード、Discord添付、共通画像配信処理は残してください。

## 現状

- `public/index.html` の `#studioMainDownload` が中央ツールバーの保存リンクです。
- `public/app.js` のelements一覧、`selectCandidate()`、`setStudioInspection()` がこのリンクを参照します。
- `#downloadLink` は最終Hires結果用の別機能です。
- `.downloadButton` は他画面でも利用される共通クラスです。

## 主な変更対象

- `public/index.html`
- `public/app.js`
- `public/style.css`
- `test/ui-shell.test.js`

## 実装指示

1. `#studioMainDownload` のDOMだけを中央ツールバーから削除してください。
2. elements一覧と、中央リンク専用の `href` / `download` 設定を削除してください。
3. `.studioMainActions #studioMainDownload::before` など、中央保存リンクだけに使うCSSを削除してください。
4. `.downloadButton` 共通CSS、`#downloadLink`、最終結果の保存処理、比較の原寸読込、Discordファイル読込は削除しないでください。
5. ツールバーの列数を7から6へ変更してください。ただし6ボタンを中央カラム全幅へ不自然に引き伸ばさず、既存デザインに合うコンパクトな幅にしてください。
6. 低い画面高用media queryとモバイル側のボタン配置も、保存ボタンの空白や7列前提が残らないよう確認してください。
7. Task 01の画像クリック拡大を残してください。

## 禁止

- 生成画像ファイルの削除
- サーバーの画像保存処理変更
- `#downloadLink` の削除
- `.downloadButton` 共通クラスの一括削除
- 空いた位置への新機能追加

## テスト

- HTMLとapp.jsに `studioMainDownload` が残っていない
- 中央ツールバーが6操作である
- `downloadLink` と自動保存経路が残っている
- ツールバーが画像・バリエーションへ重ならない

## 完了条件

- 中央ツールバーから「保存」と保存アイコンが消えている
- 拡大、比較、情報、再生成、構図、Hires.fixが動く
- 自動保存、履歴、最終Hires結果の保存が維持される
- `npm run check` と `npm test` が成功する
