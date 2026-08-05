# Luna Task 05：画像生成完了後のDiscord通知

## 目的

ReForge生成、原画像保存、サムネイル生成試行、履歴保存が完了した後に、Discordへ非同期通知できるようにしてください。既存の「Favorite時Discord送信」は残し、生成完了通知とは設定と送信契機を分けてください。

## 再利用必須の既存基盤

- `src/discord.js`
  - `isDiscordWebhookUrl()`
  - `maskWebhookUrl()`
  - `postToDiscordWebhook()`
  - サーバー側JSON Store
  - 画像ファイルの安全な読込
  - 二重実行防止と送信状態
- `src/server.js`
  - `/api/discord/settings`
  - 履歴保存後の `stored` generation
- `src/history.js`
  - 画像ごとのDiscord状態と再送処理
- `public/app.js`
  - Discord設定ロード・保存
  - 送信状態監視、失敗Toast、再送

既存Favorite送信を別実装へ置き換えないでください。

## 主な変更対象

- `src/discord.js`
- `src/server.js`
- `src/history.js`（既存状態で足りない場合だけ）
- `public/index.html`
- `public/app.js`
- `test/discord.test.js`
- `test/server-integration.test.js` または専用サーバーテスト

## 設定

既存のDiscord設定へ後方互換で追加してください。

- 生成完了通知を有効にする（既定OFFを推奨。既存Favoriteの `autoSend` と別キー）
- 生成画像を添付する
- タイトルを含める
- Modelを含める
- Seedを含める
- 生成時間を含める
- 複数枚時の添付方式（初期実装は「先頭1枚」固定でも可）
- テスト通知

Webhook URLは引き続きpassword入力で、APIから実値を返さないでください。環境変数・config.local・保存値の優先順位も維持してください。

## 送信タイミング

1. `src/server.js` でReForge生成が成功する
2. 画像ファイル保存が成功する
3. `history.addGeneration()` が成功する
4. その後に生成完了通知をbackgroundで開始する

通知開始・送信完了を生成レスポンスで待たないでください。通知失敗時もjobはdone、画像と履歴は保持します。

## 通知内容

- 見出し: `Local Image Chatで画像生成が完了しました`
- タイトル: Task 04で保存された `generation.title`。Task 04未実装なら安全なfallbackを使い、このタスク内でタイトル生成仕様を新設しないでください。
- Model、先頭画像Seed、解像度、生成時間、生成枚数
- 添付ONなら先頭の保存済み原画像1枚
- Prompt全文は生成完了通知の必須項目ではありません。既存Favorite設定と混同しないでください。
- Discordのメンションは既存どおり無効化してください。

## 生成時間

クライアント表示値ではなく、jobまたはサーバー側で信頼できる開始・完了時刻から算出してください。既存結果に時間がない場合は任意項目として省略し、偽の値を送らないでください。

## 失敗・再送

- 失敗は画像単位またはgeneration単位で状態を永続化してください。既存画像単位状態を再利用できるなら先頭画像へ紐づけて構いません。
- 同じgenerationの自動通知を並列・重複送信しないでください。
- ブラウザが開いている場合、既存の状態監視で失敗Toastと「再送」を提供してください。
- ブラウザが閉じていてもサーバーログと失敗状態が残るようにしてください。
- sentは再送しない、failedのみ手動再送可能、sendingは重複開始しない、再起動時のstuck recoveryを維持してください。

## テスト通知

- `POST /api/discord/test` のような限定されたサーバーAPIを追加して構いません。
- 保存済みWebhook解決を再利用してください。
- 本文は `Local Image Chat Discord通知テスト\n\n接続に成功しました。`
- 画像は添付しません。
- 成功・失敗を既存Toastで表示します。
- 任意URLを受け取って送るAPIにしないでください。

## 禁止

- Webhook URLをlocalStorageや公開stateへ保存
- APIレスポンス、ログ、ToastへのWebhook実値出力
- 通知失敗を生成失敗にする
- 全画像の無制限添付
- Favorite自動送信の削除・意味変更
- 新規HTTPライブラリ追加

## テスト

- 通知OFFでは送らない
- 通知ON・Webhook設定済みで履歴保存後に1回開始
- 生成失敗時は送らない
- 履歴保存失敗時は送らない
- Discord失敗でもjobと履歴は成功
- 1枚・4枚生成で本文の枚数が正しい
- 添付ON/OFF
- 各include設定
- 無効URL拒否、URL非公開
- test通知成功・失敗
- 二重送信防止、failed再送、sent再送拒否

## 完了条件

- 生成完了後だけ非同期通知される
- Favorite送信と生成完了通知を個別に有効化できる
- 画像と履歴を失わず失敗状態を確認・再送できる
- Webhook秘密情報を公開しない
- `npm run check` と `npm test` が成功する
