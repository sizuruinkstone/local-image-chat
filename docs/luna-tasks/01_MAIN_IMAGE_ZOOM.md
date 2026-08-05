# Luna Task 01：中央メイン画像クリックで拡大

## 目的

生成画面中央の選択中メイン画像 `#studioMainImage` を、マウスクリック、タップ、Enter、Spaceで既存の画像拡大モーダルへ開けるようにしてください。バリエーションサムネイルのクリック動作は「選択」のまま維持します。

## 現状

- `public/app.js` に `openImageModal()`、`ensureImageModal()`、`closeImageModal()`、Escape処理があります。
- `#studioMainZoomButton` は既に `studioInspection` の原寸URLを既存モーダルへ渡しています。
- `#studioMainImage` は表示と `cursor: zoom-in` まではありますが、画像自体のクリック・キーボード操作がありません。

## 主な変更対象

- `public/index.html`
- `public/app.js`
- 必要な場合だけ `public/style.css`
- `test/ui-shell.test.js` または新しい関連テスト1ファイル

## 実装指示

1. `#studioMainImage` を既存モーダルのトリガーとして扱ってください。
2. クリック時は `studioInspection` が存在する場合だけ、`originalImageUrl(studioInspection.image)` と履歴タイトル相当のaltを `openImageModal()` へ渡してください。
3. `#studioMainZoomButton` と画像クリックでURL生成やタイトル生成を二重実装せず、必要なら小さな共通関数へ寄せてください。
4. 画像へ `tabindex="0"`、`role="button"`、`aria-label="選択画像を拡大"` を設定してください。画像未表示時はフォーカス対象にならない既存状態を維持するか、表示時だけ操作可能にしてください。
5. `keydown` はEnterまたはSpaceだけを処理し、Spaceではページスクロールを防いでください。キーリピートでモーダルを重複生成しないでください。
6. 既存モーダルのEscape、背景クリック、閉じるボタンをそのまま利用してください。
7. `#studioMainFavoriteButton` と画像内ツールバーのクリックは画像クリックへ伝播させず、既存の各操作だけを実行してください。既にツールバーが画像の兄弟要素なら、必要最小限の伝播防止だけにしてください。
8. `.candidateImage` やバリエーションカードのクリックを拡大へ変更しないでください。

## 禁止

- 新しいモーダルの作成
- `openImageModal()` の全面書き換え
- 画像URL・配信APIの変更
- バリエーションの選択動作変更
- 拡大ボタンの削除（このタスクでは残す）

## テスト

- 画像クリックで既存モーダルが開く契約
- EnterとSpaceが同じ拡大処理を呼ぶ
- `#studioMainImage` にアクセシブルな操作属性がある
- バリエーション側の既存選択ハンドラが残る
- Escapeと背景クリックの既存処理が残る

## 手動確認

- 履歴画像を中央へ表示して画像をクリック
- Enter、Space、Escape
- お気に入り星と各ツールバーボタンを押して、意図せず拡大しないこと
- 縦長・横長画像、モバイル相当幅

## 完了条件

- 中央メイン画像だけがクリック・タップ・Enter・Spaceで拡大する
- 既存モーダルを再利用している
- バリエーションは引き続き選択操作である
- 既存の拡大ボタン、Favorite、比較、再生成を壊していない
- `npm run check` と `npm test` が成功する
