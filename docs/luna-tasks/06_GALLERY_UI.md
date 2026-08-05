# Luna Task 06：ギャラリー画面UI改善

## このタスクの担当範囲

既存のギャラリー画面だけを、画像閲覧を主役にした構成へ整理してください。

- Vanilla HTML / CSS / JavaScript と Express 構成を維持する
- 新規リポジトリ・新規依存・UIフレームワークを追加しない
- API、履歴形式、画像保存、サムネイル生成・配信、Favorite保存、比較データを変更しない
- `public/ui-kit.js`、既存 `openModal()`、native HTML、既存の比較Stateを優先して再利用する
- Task 07（設定画面）へ関係するDOM・CSS・処理は変更しない

`DESIGN.md` は2026-08-05時点のリポジトリ直下には存在しません。作業開始時に再確認し、存在していれば先に全文を読んでください。存在しない場合は、本書と既存の `public/style.css` のトークンを基準にしてください。

## 現行実装で確認済みの事実

- HTML: `public/index.html` の `#viewGallery`
- 一覧: `#historyGrid`
- ページング: `loadHistory()` / `loadMoreHistory()`、初回・追加とも20件
- 描画: `renderHistory()` / `createHistoryCard()`
- 絞り込み: `public/gallery-filter.js` の `filterGalleryEntries()`
- 現在の条件: 種別、Checkpoint、LoRA、生成日時、検索
- Favorite: 既存 `createFavoriteButton()` と画像IDベースの同期処理
- 比較: 既存 `compareSelection`、`toggleCompareSelection()`、`compareCurrentSelection()`、比較トレイ
- 画像表示: `configureThumbnailImage()` が `thumbnailUrl`、lazy loading、原寸fallbackを管理
- 拡大: `openImageModal(originalImageUrl(image), title)`
- 詳細: `openHistoryDetail(generation, image)`
- 現在のカード操作: 削除、読込、詳細、比較が常設
- `#preferenceSummary` と `.preferenceTags` はFavorite傾向の表示であり、現時点ではタグ絞り込みUIではない
- 現在の `galleryFilter` にはタグ条件と並び替え条件はない

## 変更予定ファイル

原則として次の5ファイル以内に収めてください。

- `public/index.html`
- `public/app.js`
- `public/style.css`
- `public/gallery-filter.js`
- `test/ui-shell.test.js`（必要なら既存の関連テストも更新）

サーバー側ファイル、`public/image-delivery.js`、比較画面専用ファイルは変更しないでください。やむを得ず範囲が増える場合は、変更前に理由を報告してください。

## 目標DOM構造

既存IDを可能な限り維持し、概ね次の役割へ整理してください。

```text
#viewGallery
└─ galleryPage
   ├─ galleryHeaderRow
   │  ├─ 見出し
   │  ├─ 表示件数（#galleryFilterSummaryを再利用可）
   │  ├─ 再読込（#refreshHistoryButton）
   │  └─ 必要な管理操作
   ├─ galleryToolbar
   │  ├─ 検索（#gallerySearch）
   │  ├─ 並び替え
   │  ├─ 絞り込みを開く
   │  ├─ Favorite切替
   │  └─ 比較モード切替
   ├─ compareModeBar（比較モード中だけ）
   ├─ #historyGrid
   └─ #historyLoadMoreButton
```

Checkpoint、LoRA、生成日時、タグは上部へ常設せず、必要なときだけ開く絞り込みUIへ移してください。タグやフィルターが一覧を縦に押し下げる構造は禁止です。

## 1. 上部ツールバー

### 1行目

- 見出し「ギャラリー」
- 取得済み件数と表示件数
- `#refreshHistoryButton`
- 既存機能上必要な管理操作だけ

極小の `RECIPE LIBRARY` ラベルは削除して構いません。見出しより操作群が目立たないようにしてください。

### 2行目

- `#gallerySearch`
- 並び替えselect
- 「絞り込み」ボタン
- 「すべて / お気に入り」または既存種別フィルターのコンパクトな切替
- 「比較モード」ボタン

Checkpoint、LoRA、生成日時をこの行へ直接並べないでください。通常生成／比較実験の既存絞り込みは、絞り込みパネルへ移しても構いません。

並び替えは最低限「新しい順（既定）」「古い順」を用意してください。取得済みページのクライアント側データだけを並び替え、全履歴を一括取得しないでください。追加読込後は取得済み全件を同じ条件で安定ソートし、重複を作らないでください。

## 2. 絞り込みとタグ

### 詳細フィルター

次を既存 `openModal()` を使ったモーダル、または一覧を押し下げないドロワーへ収めてください。新しい複雑なPopover基盤は作らないでください。

- 種別: すべて / 通常生成 / 比較実験
- Checkpoint: 既存 `#galleryCheckpoint`
- LoRA: 既存 `#galleryLora`
- 生成日時: 既存 `#galleryPeriod`
- タグ検索
- 選択中タグ
- 選択タグ解除
- すべて解除
- 条件適用後の件数

### タグ絞り込みの境界

現行コードには独立したタグ絞り込みがないため、次の最小構成に限定してください。

- 候補は取得済みの `toGalleryEntries()` のPositive Prompt系文字列からクライアント側で収集する
- 既存履歴に構造化Promptがあれば既存値を優先し、なければ最終Positive Promptをカンマ区切りとして扱う
- タグ文字列自体の大文字小文字、括弧、重み、エスケープを保存データ上で変更しない
- 選択タグは `galleryFilter` のUI stateにだけ保持する
- サーバーAPI、履歴JSON、Favorite傾向データへ保存しない
- 絞り込み対象は取得済みページだけであることを、件数表示で誤解がないよう示す
- 複数タグはAND条件を基本とする

`#preferenceSummary` のFavorite傾向タグは別機能です。タグ絞り込み候補と同じDOM/stateへ統合したり、クリックしただけでPromptへ追加したりしないでください。現在の大きな傾向表示は、コンパクトな折りたたみまたは詳細フィルター内の補助情報へ移して構いません。

## 3. 画像グリッド

既存 `.historyGrid` を次を基準に調整してください。

```css
.historyGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
}
```

- 1366px幅で概ね3〜4列
- 1920px幅で概ね5〜6列
- カードを230px未満へ極端に縮めない
- ページ全体の横スクロールを発生させない
- サムネイルは `object-fit: contain`
- 画像領域は暗い単色背景にする
- 元画像のアスペクト比を壊さず、全体を確認可能にする
- 現在の `aspect-ratio: 7 / 9; object-fit: cover` による強いトリミングを解消する
- 二重カード、強い影、太いライム枠を作らない

一覧は引き続き `configureThumbnailImage()` を使用し、`thumbnailUrl`、`loading="lazy"`、`decoding="async"` を維持してください。通常経路で `originalUrl` を一覧の `src` にしないでください。

## 4. 画像カード

通常時に見せる情報を次だけへ絞ってください。

- 画像
- Favorite星
- `generationTitle(generation)` によるタイトル
- 短いModel / Checkpoint表示
- 生成日時
- 三点メニュー

Seed、LoRA、Sampler、Steps、CFG、実験値の詳細は一覧本文へ常設せず、詳細モーダルへ移してください。比較実験で識別に不可欠な短いバッジだけは残して構いません。

### 操作

- 画像またはカードの主領域クリック: 既存の拡大または `openHistoryDetail()`
- Favorite星: 既存Favorite切替。カードの拡大・選択を発火させない
- 三点メニュー: 読込（再利用）、比較に追加/解除、詳細、削除、既存のその他操作
- 三点メニュー内のクリック: `stopPropagation()` 等でカードクリックと分離
- 削除: 既存の確認と `deleteHistoryImage()` を必ず維持
- 読込: 既存 `activateCompositionLock(generation, image)` を維持
- 詳細: 既存 `openHistoryDetail(generation, image)` を維持
- 比較: 既存 `toggleCompareSelection()` を維持

三点メニューはnative `<details>` または既存 `openModal()` で実装してください。メニューを開くためだけに新ライブラリや全画面のイベント管理を追加しないでください。キーボードで開閉・操作できるbutton要素を使い、外側クリック処理がカード操作を誤発火させないようにします。

既存のDiscord状態表示は失わないでください。カード上で常設する必要がなければ詳細またはメニュー内の静かな状態表示へ移動できますが、通知処理・状態同期は変更禁止です。

## 5. 比較モード

ギャラリー専用の表示モードだけ追加し、選択データは既存 `compareSelection` を共有してください。別の配列やlocalStorageを作らないでください。

通常時:

- カード上の比較チェックボックスを表示しない
- 上部に「比較モード」開始ボタンだけ表示

比較モード中:

- 各画像左上へチェックボックスまたは同等の明確な選択UI
- 選択件数
- 「比較を開始」
- 「すべて解除」
- 「比較モード終了」

挙動:

- チェック操作は画像拡大を発火させない
- 最大4件という既存制限を維持する
- 2件未満は比較開始をdisabledにする
- 0件なら「あと2枚選択してください」、1件なら「あと1枚選択してください」と表示
- 「すべて解除」は既存 `clearCompareSelection()` を使用する
- 比較開始は既存 `compareCurrentSelection()` を使用する
- 比較モード終了は表示UIだけを通常へ戻す。選択を消すのは「すべて解除」の明示操作に限定する
- 既存の比較トレイ、ナビバッジ、比較画面との同期を壊さない

## 6. 詳細表示

詳細情報は既存 `openHistoryDetail(generation, image)` を再利用し、一覧へ複製しないでください。少なくとも既存データから次が確認できる状態を維持します。

- 大きな画像
- タイトル
- Model / Checkpoint
- Seed
- Resolution
- Sampler / Scheduler
- Steps / CFG
- LoRA
- Positive Prompt
- Negative Prompt
- 読込・再利用
- 比較に追加/解除

既存の拡大モーダルを残す場合も、詳細へ到達する導線を三点メニューに残してください。

## 7. レスポンシブ

- デスクトップを主対象としつつ、760px以下の既存下部ナビを壊さない
- 狭幅ではツールバーを自然に2行以上へ折り返してよい
- 検索入力とボタンのタップ領域を最低36px程度確保する
- モバイルは1〜2列。画像幅が読み取れないほど小さくならないことを優先する
- フィルターモーダルは画面内で縦スクロール可能にする
- ページ全体の横スクロールを発生させない
- `prefers-reduced-motion` では新規transitionを無効化または最小化する

## 禁止事項

- `/api/history`、履歴カーソル、20件ページングの変更
- 全履歴を取得してから画面上だけ件数を減らすこと
- 一覧で原寸画像を常用すること
- base64 / Blob URLによる一覧表示への回帰
- Favoriteまたは比較Stateの二重実装
- 画像データ・タイトル生成・再利用処理の変更
- `preferenceSummary` をタグフィルターと誤認して破壊すること
- カード全体クリックから削除・読込を発火させること
- API、DB、Expressルート、サービスワーカーの変更
- Task 07の設定画面変更

## 必須テスト

既存テストを更新し、少なくとも次を自動検証してください。

- 一覧は `configureThumbnailImage()` を使用し、原寸URLを初期 `src` にしない
- `loading="lazy"` / `decoding="async"` が維持される
- gridが `minmax(230px, 1fr)` 相当で、サムネイルが `object-fit: contain`
- 上部に検索、並び替え、絞り込み、Favorite、比較モードの導線がある
- 詳細フィルターのCheckpoint / LoRA / 期間が既存stateへ反映される
- タグ検索、AND絞り込み、選択解除、全解除
- 並び替えが取得済みデータだけへ安定適用される
- Favorite星と三点メニューのクリックが画像拡大を発火させない
- 三点メニューから読込、比較、詳細、削除の既存関数へ到達する
- 通常時は比較チェックが非表示、比較モード中だけ表示
- 0件/1件/2件以上の比較メッセージとdisabled状態
- 追加20件後に重複せず、現在のフィルター・並び替えを維持する
- 既存Favorite、比較トレイ、削除、読込、詳細のテストが通る

## 手動確認

- 1366×768 / 1920×1080 / ブラウザズーム125%
- 760px以下で横スクロールなし
- 初回表示直後に画像グリッドが見える
- 縦長、横長、正方形の画像全体を確認できる
- 20件追加読込
- 絞り込みの開閉、タグ検索、条件解除
- Favorite登録・解除
- 比較モード開始、0/1/2〜4枚選択、比較開始、全解除、終了
- 画像拡大、詳細、読込、削除
- DevTools Networkで一覧通常表示がthumbnail URLだけを取得する

## 実行コマンド

```powershell
npm run check
node --test test/ui-shell.test.js test/ui.test.js test/layout-overflow.test.js test/image-delivery-ui.test.js
npm test
```

## 完了条件

1. ギャラリーを開いた直後に画像一覧が見える
2. タグ・詳細フィルターが一覧を押し下げない
3. 画像全体をサムネイルで確認できる
4. カード上の常設操作がFavoriteと三点メニュー中心へ減っている
5. 画像クリックで拡大または詳細を開ける
6. 既存の読込、削除、詳細、Favorite、Discord状態を失っていない
7. 比較モードの開始・選択・開始可否・解除・終了が明確
8. 初回20件と追加20件の通信設計が維持される
9. 通常一覧で原寸画像を大量取得しない
10. 1366px、1920px、モバイル幅で横スクロールがない
11. API・履歴・Favorite・比較データ形式を変更していない
12. 型/構文チェックと関連テスト、全テストが成功する

## 作業後の報告

- 変更ファイル一覧と各ファイルの役割
- 旧構造と新構造
- タグ候補の取得元と絞り込み対象範囲
- 詳細フィルターの開き方
- カード三点メニューへ移した操作
- 比較モードの利用手順と既存Stateの再利用箇所
- サムネイル配信を維持した根拠
- レスポンシブ確認結果
- 実行したコマンドと結果
- 未対応事項
