# 最終レビュー結果

更新日: 2026-08-05
状態: **Task 01〜07の指摘はすべて解消済み**

最終統合レビューで、本文書に記載したTask 04、Task 06、Task 07の追加修正がすべて反映されていることを確認しました。新しい追加修正指示はありません。以下はレビュー履歴として残しますが、Lunaが再実装する必要はありません。

---

# レビュー追加指示（解消済み・履歴）

更新日: 2026-08-05
対象レビュー: Luna Task 01 / 03 / 04 / 05

## 総合判定

- Task 01「中央メイン画像クリックで拡大」: 承認
- Task 03「画像比較の導線改善」: 承認（Task 04との表示統合修正を除く）
- Task 04「履歴タイトル生成元の分離」: 要修正1件
- Task 05「画像生成完了後のDiscord通知」: 承認

型チェック、関連テスト、全テストは成功しています。以下の1件だけ修正したうえで、Task 04を完了扱いにしてください。

## [P1] 比較トレイも共通の履歴タイトル取得関数を使用する

対象:

- `public/app.js` の `renderCompareTray()`（レビュー時点の6525行付近）
- `test/ui-shell.test.js`

現在のコード:

```js
const title = entry.generation?.description || `Seed ${entry.image.seed}`;
```

問題:

- 新規履歴に保存された `generation.title` を比較トレイだけ無視しています。
- Task 04で定義した `generationTitle(generation)` へ表示タイトル取得を集約する要件から外れています。
- 手動タイトルまたは自動生成タイトルが存在しても、比較トレイでは旧 `description` が表示されます。
- `description` をPrompt復元用として保持すること自体は正しいため、復元・派生生成側の参照は変更しないでください。

修正:

```js
const title = generationTitle(entry.generation);
```

`generationTitle()` は既に `title || description || "無題"` の後方互換fallbackを持つため、比較トレイ内で別のfallbackを重ねないでください。

テスト追加:

- `renderCompareTray()` が `generationTitle(entry.generation)` を使用すること。
- 比較トレイの表示タイトル取得で `entry.generation?.description` を直接参照しないこと。
- 新規 `title` がある履歴、旧 `description` だけの履歴、両方空の履歴の純粋関数テストは既存のTask 04テストを維持すること。

禁止:

- `description` フィールドの削除・改名
- 比較候補Stateや比較モーダルの変更
- タイトルの保存形式や自動生成方式の再設計
- Task 01、03、05の承認済み処理への便乗変更

## 修正後の確認

```powershell
npm run check
node --test test/ui-shell.test.js test/compare-view.test.js test/history.test.js test/discord.test.js test/server-integration.test.js
npm test
```

期待結果:

- すべて成功
- 比較トレイへ新しい `generation.title` が表示される
- 古い履歴は `description`、両方ない履歴は「無題」になる
- 比較候補の追加・解除・全解除・2枚以上での比較開始が従来どおり動く

## レビューで確認済みの事項

### Task 01

- 中央メイン画像はクリック、Enter、Spaceで既存の拡大モーダルを開く。
- Spaceの既定スクロールとキーリピートを抑止している。
- `tabindex`、`role="button"`、`aria-label` がある。
- バリエーションサムネイルは引き続き選択操作である。
- Escape、背景クリック、閉じるボタンは既存モーダルを再利用している。

### Task 03

- 比較候補は既存の `compareSelection` へ集約され、4枚上限を維持している。
- ナビバッジ、比較トレイ、個別解除、全解除、0枚・1枚案内、2枚以上の開始導線がある。
- 既存の `openCompareView()` を再利用している。
- 比較画面は初期表示にサムネイルを使い、明示操作時だけ原寸へ切り替える。

### Task 04

- 新規履歴へ独立した `title` を確定保存する。
- 手動タイトル、自動方式、テンプレート、実Seed、古い履歴fallbackのテストがある。
- `description` はPrompt生成・復元互換のため残されている。
- 比較トレイ以外の主要表示面は `generationTitle()` を使用している。

### Task 05

- Favorite通知と生成完了通知は別設定・別状態として扱われている。
- 生成画像保存と履歴保存の後に、生成レスポンスを待たせず通知を開始する。
- 通知失敗を生成失敗へ波及させない。
- 添付は先頭画像1枚に制限され、Webhook実値は公開しない。
- sent/sending/failedの重複防止、failed再送、stuck recoveryが維持されている。
- テスト通知は固定文面で画像を添付しない。

## レビュー時の検証結果

```text
npm run check
  成功

node --test test/ui-shell.test.js test/compare-view.test.js test/history.test.js test/discord.test.js test/server-integration.test.js test/ui.test.js test/layout-overflow.test.js
  68 passed / 0 failed

npm test
  353 passed / 0 failed
```

ブラウザ確認では、履歴画像を選択すると中央へ原寸URLが設定され、中央画像のクリック可能属性と既存比較導線が表示されることを確認しました。実Webhookへの送信、実ReForge生成、モバイルSafari実機までは今回のレビューでは実行していません。

---

# Task 07 レビュー追加指示

更新日: 2026-08-05
対象レビュー: Luna Task 07「設定画面UI改善」

## 判定

要修正2件です。2カラム、カテゴリ切替、検索、状態要約、生成画面からLoRA管理への遷移、既存保存方式の維持は確認できました。以下を修正したうえでTask 07を完了扱いにしてください。

## [P1] 重複している `loraSyncNotice` IDを解消する

対象:

- `public/index.html` の生成画面LoRA欄（レビュー時点の320行付近）
- `public/index.html` の設定画面LoRA欄（レビュー時点の963行付近）
- `public/app.js` のLoRA同期通知描画処理
- `test/ui-shell.test.js`

確認結果:

```text
document.querySelectorAll('#loraSyncNotice').length === 2
```

同じIDが次の2箇所に存在します。

```html
<div id="loraSyncNotice" ...></div>
```

`document.getElementById("loraSyncNotice")` は先に現れる生成画面側だけを取得するため、設定画面側の通知枠は更新されません。Task 07の「設定DOMとIDが重複しない」という必須条件にも反します。

修正方針:

1. 生成画面と設定画面の通知枠へ別々のIDを割り当ててください。
2. 同じLoRA同期通知を両画面で表示する必要がある場合、通知内容を作る処理は共有し、2つの表示先へ同じ内容を描画してください。
3. 設定画面側の通知枠が不要と確定できる場合は、死んでいる要素を削除しても構いません。CSSで隠すだけにはしないでください。
4. LoRA選択、衣装プリセット、同期警告の生成ロジックは変更しないでください。

テスト:

- 一部の既知IDだけでなく、`public/index.html` のすべての `id` を抽出し、重複が0件であることを検証してください。
- 両方の通知枠を残す場合は、LoRA同期通知の描画先が両方更新される契約も固定してください。

## [P2] カテゴリ選択直後に主要設定内容を表示する

対象:

- `public/index.html` の各設定カテゴリにある主要 `<details>`
- 必要なら `public/app.js` の `activateSettingsCategory()`
- `test/ui-shell.test.js`

現象:

初期HTMLでは、モデル以外の主要セクションがほぼすべて閉じています。

```text
一般                 appManagementDetails      closed
プロンプト           promptPartsDetails         closed
モデル               checkpointDetails          open
LoRA                 settingsLoraDetails        closed
履歴・ギャラリー     titleGenerationDetails     closed
Discord通知          discordDetails             closed
接続                 mobileAccessDetails        closed
詳細                 promptTemplateDetails      closed
アプリ情報           updateDetails              closed
```

カテゴリ分離自体はできていますが、多くのカテゴリで選択直後の右本文が閉じた見出しだけになります。「全設定が閉じたアコーディオンとして並び、設定状態を一覧で把握できない」というTask 07の改善目的が十分に解消されていません。

最小修正:

1. 各カテゴリの主要セクションは初期表示で開いてください。静的な `open` 属性、またはカテゴリを初めて選択した時だけ主要セクションを開く最小処理のどちらでも構いません。
2. Civitai登録、Grokテンプレート、更新適用など、長い補助機能・高度な機能・危険操作は閉じたままで構いません。
3. ユーザーが手動で閉じた主要セクションを、同じセッション中のカテゴリ切替のたびに強制的に開き直さないでください。
4. 既存input/button ID、保存ハンドラ、API呼び出しは変更しないでください。
5. 全設定を同時表示へ戻さず、現在のカテゴリ分離は維持してください。

テスト:

- 一般、プロンプト、履歴、Discord、接続などのカテゴリを選択した直後に、主要設定内容へ追加クリックなしで到達できること。
- Civitaiや高度な補助設定は意図どおり折りたたみを維持すること。
- カテゴリ切替後も各設定DOMが複製されないこと。

## 修正後の確認

```powershell
npm run check
node --test test/ui-shell.test.js test/ui.test.js test/layout-overflow.test.js
npm test
```

期待結果:

- 全コマンド成功
- HTML内の重複IDが0件
- 設定画面側のLoRA同期通知が死んだDOMにならない
- カテゴリ選択直後に主要設定が読める
- 生成画面からLoRA管理へ移動してもPromptと生成設定が保持される
- 既存のlocalStorage、個別API、手動保存、自動保存の方式が変わらない

## Task 07で承認済みの部分

- `220px minmax(0, 1fr)` のデスクトップ2カラム
- 本文最大幅860pxと `min-width: 0`
- 860px以下でデスクトップナビをnative selectへ縮退するCSS
- 一般、プロンプト、モデル、LoRA、履歴、Discord、接続、詳細、アプリ情報のカテゴリ分離
- 空の外観カテゴリを追加していない
- 検索語の大文字小文字を区別しない複数語AND検索
- 検索0件の空状態
- 検索結果からカテゴリ、対象details、最初の操作要素への遷移
- `activateSettingsCategory()` をデスクトップナビ、狭幅select、検索、LoRA管理導線で共有
- 生成画面からLoRA管理へ移動しても入力中Character Promptが保持されることをブラウザで確認
- ReForge、Discord、更新の状態要約が既存表示結果を再利用している
- Task 07のための新規依存、API、保存データ形式変更がない

## レビュー時の検証結果

```text
npm run check
  成功

node --test test/ui-shell.test.js test/ui.test.js test/layout-overflow.test.js
  39 passed / 0 failed

npm test
  358 passed / 0 failed
```

ブラウザ確認は1280×720相当で実施し、カテゴリ切替、Webhook検索からDiscord設定への遷移、生成画面からLoRA管理への遷移、Prompt保持を確認しました。CSS上の860px以下縮退と横幅制約は確認しましたが、モバイルSafari実機と125%ズームの手動確認は今回実施していません。

---

# Task 06 レビュー追加指示

更新日: 2026-08-05
対象レビュー: Luna Task 06「ギャラリー画面UI改善」

## 判定

要修正3件です。20件ページング、サムネイル配信、検索・並び替え、フィルターモーダル、タグAND絞り込み、Favorite、三点メニューの既存操作、比較モードは正常に動作しています。以下だけをギャラリーの範囲内で修正してください。

## [P1] 画像詳細モーダルへ対象画像を表示する

対象:

- `public/app.js` の `openHistoryDetail()`（レビュー時点の7152行付近）
- `public/style.css` の詳細モーダル用スタイル
- `test/ui-shell.test.js`

現象:

三点メニューの「詳細」から既存 `openHistoryDetail(generation, image)` は開きますが、モーダル内に画像要素がありません。ブラウザのアクセシビリティツリーでも、詳細ダイアログにはタイトル・パラメータ・Prompt・操作だけがあり、大きな画像は存在しません。

Task 06では詳細表示に「大きな画像」を含めることが必須です。カード画像クリックの拡大モーダルが別に存在していても、三点メニューの「詳細」から画像と情報を一緒に確認できる必要があります。

最小修正:

1. `openHistoryDetail()` のヘッダー直後、またはメタデータ直前へ画像プレビューを1つ追加してください。
2. 詳細を明示的に開いた時だけ取得されるため、`originalImageUrl(image)` を使用して構いません。
3. `alt` は `generationTitle(generation)` を使用してください。
4. `object-fit: contain`、`max-width: 100%`、適切な最大高を設定し、縦長・横長とも切らないでください。
5. 画像クリックでさらに既存拡大モーダルを開く場合も、新しいモーダル基盤は作らず既存 `openImageModal()` を再利用してください。
6. 一覧カードの `src` は引き続きサムネイルのままにしてください。

テスト:

- `openHistoryDetail()` が対象画像の表示要素を作ること。
- 詳細画像は `originalImageUrl(image)` を使用すること。
- 一覧カードは引き続き `configureThumbnailImage()` を使用し、原寸を初期 `src` にしないこと。

## [P1] 三点メニューから共通 `details` のカード装飾を外す

対象:

- `public/style.css` の `.historyCardMenu`（レビュー時点の3118行付近）
- `test/ui-shell.test.js` または `test/layout-overflow.test.js`

原因:

全体共通スタイルとして次があります。

```css
details {
  margin-top: 12px;
  padding: 13px;
  border: 1px solid var(--line);
  border-radius: 13px;
}
```

`.historyCardMenu` はnative `<details>` ですが、現在の上書きは `position` と `align-self` だけです。そのため閉じた三点メニュー自体が約64pxの別カードになり、カード本文下部へ大きな空白と二重枠を作っています。1280×720の実画面でも、各画像カード下部にメニュー専用の大きな囲みが見えました。

これはTask 06の「カードの中へ別カードを作らない」「常設操作をFavoriteとコンパクトな三点メニューへ減らす」という要件に反します。

最小修正例:

```css
.historyCardMenu {
  position: relative;
  align-self: flex-end;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
```

既存の`.historyCardMenu > summary`の36pxタップ領域と、開いた時の`.historyCardMenuBody`は維持してください。メニュー項目のイベント処理、削除確認、比較、読込、詳細は変更しないでください。

必要なら`.preferenceSummaryDetails`も共通`details`の余分な外枠・paddingを継承していないか同じ観点で確認してください。ただしFavorite傾向の機能や内容は変更しないでください。

テスト:

- `.historyCardMenu` が共通`details`のmargin、padding、borderを明示的にリセットすること。
- 閉じたメニューのクリック領域は36px以上を維持すること。
- 開いたメニューがカードや隣接カードの背面へ隠れないこと。

## [P2] デスクトップのグリッド密度を指定範囲へ合わせる

対象:

- `public/style.css` の `.historyGrid`（レビュー時点の3083行付近）
- `test/ui-shell.test.js`

確認結果:

1280px幅のブラウザで次の実測でした。

```text
1行のカード数: 5
カード幅: 約236px
grid-template-columns: 235.8px × 5列
```

Task 06の目安は1366pxで3〜4列、1920pxで5〜6列です。現在の`minmax(230px, 1fr)`固定では1280pxですでに5列になり、1920pxではさらに7〜8列へ増えるため、画像とタイトルが過密になります。

修正方針:

1. デスクトップの最小カード幅をおおむね280〜300pxへ調整し、1366pxで4列、1920pxで6列前後を目安にしてください。
2. 1080px以下では230px程度まで縮小して構いません。
3. 760px以下の2列、420px以下の1列は維持してください。
4. `minmax(0, 1fr)`と`min-width: 0`を維持し、横スクロールを発生させないでください。
5. 固定列数だけで全幅を決めず、既存の`auto-fill`または適切なメディアクエリを使用してください。

テスト:

- 1366px相当で3〜4列。
- 1920px相当で5〜6列。
- 760px以下で2列、420px以下で1列。
- ページ全体に横スクロールがないこと。

## 修正後の確認

```powershell
npm run check
node --test test/ui-shell.test.js test/ui.test.js test/layout-overflow.test.js test/image-delivery-ui.test.js
npm test
```

ブラウザ確認:

- 1366×768で4列前後
- 1920×1080で6列前後
- 三点メニューが別カードのように見えない
- 詳細ダイアログに対象画像とメタデータが表示される
- 一覧20枚の画像URLはサムネイルのまま
- 追加20件後も重複しない

## Task 06で承認済みの部分

- 初回20件、追加20件のカーソルページングを維持
- 実ブラウザで20件から40件へ追加し、画像IDの重複が0件であることを確認
- 一覧20枚すべてが `/api/images/{id}/thumbnail` を使用
- 一覧で `/original` が0件
- 先頭4枚だけeager、以降はlazy、全画像が`decoding="async"`
- サムネイルは`object-fit: contain`
- タグ、Checkpoint、LoRA、期間をnative dialogへ格納
- タグ候補は取得済みのStructured Promptを優先し、fallback Promptを利用
- 複数タグはAND条件で絞り込み
- 選択タグの個別解除と全解除
- 表示件数に「取得済み」の範囲を明記
- 新しい順・古い順の安定ソート
- Favorite星クリックと三点メニュー操作をカード拡大から分離
- 三点メニューから既存の読込、比較、詳細、削除へ接続
- Discord状態を三点メニュー内で維持
- 比較モードは既存 `compareSelection` を共有
- 0件・1件・2件以上の案内と開始可否
- 比較候補、ナビバッジ、既存比較トレイの同期
- 比較モード終了時に候補を勝手に消さない
- API、履歴形式、Favoriteデータ、比較データ形式を変更していない

## レビュー時の検証結果

```text
npm run check
  成功

node --test test/ui-shell.test.js test/ui.test.js test/layout-overflow.test.js test/image-delivery-ui.test.js
  41 passed / 0 failed

npm test
  358 passed / 0 failed
```

ブラウザ確認は1280×720相当で実施しました。フィルター、タグAND絞り込み、三点メニュー、詳細、比較モード、20件追加読込を確認しています。1366×768、1920×1080、125%ズーム、モバイルSafari実機は今回実施していません。
