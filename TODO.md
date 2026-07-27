# TODO

v2.12の総合改造で意図的に簡略化した項目と、次に手を入れるとよい箇所。
機能自体は動作しており、以下は「あると better」の残作業。

## v2.20で対応済み

- トップレベル画面を4つ（生成 / ギャラリー / 比較 / 設定）へ整理（`public/view-router.js`）
- PC 3カラム（左ナビ・中央入力・右に最新結果sticky）、スマホは1カラム＋下部ナビ
- 生成ボタンの追従バー（PC中央下部 / スマホは下部ナビの上）と生成中の進捗・中止表示
- Checkpointを生成設定へ統合、Sampler/Schedulerの候補選択（`public/option-picker.js`）とプリセット
- 使用中LoRAの操作をまとめた生成画面用セクションとLoRA追加ピッカー
- ギャラリーの絞り込み（`public/gallery-filter.js`）と履歴の統合表示
- 画面移動しても生成が止まらないこと（サーバー側ジョブ + 右上キュー表示）の維持

## v2.20で見送った項目

### 設定画面の「UI設定」「デフォルト生成設定」

- 現状: 設定画面はCheckpoint管理・LoRA管理・Civitai・Discord・スマホ接続・アップデート。
  テーマや既定の生成設定を編集するUIは無く、既定値は`config.json`のまま。
- 次にやるなら: `/api/config`へPATCHを足し、`config.local.json`へ書き戻す。
  画面は設定画面へ`<details>`を1つ追加するだけで済む。

### ギャラリーの並べ替え・ページング

- 現状: 履歴は新しい順の200件までを取得し、絞り込みは画面側で行う。
- 次にやるなら: `GET /api/history`へ`offset`とソート指定を足し、
  `renderHistory`（`public/app.js`）を追記読み込みへ変える。

### 比較画面からの直接実行

- 現状: `比較実験へ送る`は比較画面を開くだけで、生成画面の条件を自動転記しない
  （Prompt・LoRA・生成設定はそのまま共有されているため、そのまま実行できる）。
- 次にやるなら: 比較条件のフォームへ「現在のLoRA weight」などを初期値として流し込む。

## v2.19で対応済み

- スマホ向けレスポンシブ（320〜430px）、用途別プロンプトのアコーディオン化、タップ領域の拡大
- LAN待ち受け（`src/net-info.js` + `start-lan.bat` + `LOCAL_IMAGE_CHAT_HOST` / `LOCAL_IMAGE_CHAT_PORT`）
- PWA（`public/manifest.webmanifest` / `public/sw.js` / `public/icons/*`）
- README: LAN・Tailscale・Windowsファイアウォール・セキュリティ制約

## v2.19で見送った項目

### アクセス制御（ログイン）

- 現状: 認証機構が無い。LAN公開時は同じネットワークの端末から誰でも操作できる。
- 次にやるなら: `src/server.js`へトークン検証のミドルウェアを1枚入れ、
  トークンは`config.local.json`か環境変数で受け取る（DiscordのWebhookと同じ扱い）。
  画面側はsessionStorageへ保持し、`getJson`/`postJson`（`public/app.js`）へヘッダーを足す。

### オフライン表示

- 現状: Service Workerはキャッシュを持たない（古いフロントエンドを残さないため）。
  オフラインでは画面も開けない。
- 次にやるなら: `public/sw.js`へ「HTMLとJSだけstale-while-revalidate」を入れる。
  その場合はバージョン付きキャッシュ名と`activate`での旧キャッシュ削除を必ずセットにする。

## v2.18で対応済み（Issue #10）

- 画面上部のAI共有バー（`Grok用に全コピー` / `AI共有CSVを更新`）
- AI共有CSVの生成・保存（`src/ai-share.js` + `data/lora_list.csv`）と、手入力Trigger Wordsの優先反映
- Grok用Markdown（環境・Checkpoint・所有LoRA・運用ルール）の組み立てとコピー
- LoRA一覧更新・Civitai再取得・Trigger Words編集後の自動同期（best-effort）
- クリップボード書き込みが応答しない場合のタイムアウト（`public/ui-kit.js`。ボタンが「コピー中」で固まらない）

## v2.18で見送った項目

### CSVの取り込み（読み込み側）

- 現状: `data/lora_list.csv` は出力専用。既存CSVはTrigger Wordsの優先順位3として読むだけで、
  外部で編集したCSVをレジストリへ書き戻す機能は無い。
- 次にやるなら: `parseAiShareCsv`（`src/ai-share.js`）の結果を
  `civitai.updateEntry` の手動編集（`manualFields`）として流し込む。

### コピー前プレビューの常時表示

- 現状: コピーは1クリックで実行し、直後のトーストの`内容を確認`でプレビューを開く方式。
- 次にやるなら: 設定で「コピー前に必ずプレビューする」を選べるようにする。

## v2.17で対応済み

- プロンプト内LoRAタグとLoRA選択UIの双方向同期（`public/lora-tags.js`）
- 実効Weight・選択元（ui / prompt / both）・LoRA警告の履歴保存と、履歴詳細での表示
- 生成へ送るeffectivePromptでの同一LoRAの一本化と、`Copy Prompt`のeffectivePrompt化

## v2.17で見送った項目

### `<lyco:...>` などLoRA以外のタグ

- 現状: `<lora:...>` だけを解析する。`<lyco:...>`・`<hypernet:...>`は対象外で、
  プロンプトにあってもそのまま生成へ送るだけ。
- 次にやるなら: `public/lora-tags.js` の `LORA_TAG_PATTERN` を種別付きへ広げ、
  `parseLoraTags` の戻り値へ `kind` を足す。UI側の照合は種別が一致するものだけにする。

### 同名ファイルが複数フォルダにある場合の選択

- 現状: `A/dup` と `B/dup` のようにファイル名が重複していて、タグがフォルダ省略形
  （`<lora:dup:1>`）の場合は自動選択せず警告だけ出す。
- 次にやるなら: 警告からフォルダを選ばせるUIを出し、選んだ結果をタグへ書き戻す
  （`replaceLoraWeight`と同じ要領でタグ名だけを置換する）。

### 共通モジュールの置き場所

- `public/lora-tags.js` はブラウザへ配信する必要があるためpublic配下にあり、
  サーバー（`src/server.js`）はそこから相対importしている。
  共有コードを増やす場合は `shared/` を作り、publicへコピー配信する構成を検討する。

## v2.16で対応済み

- AI出力の一括インポート（`public/prompt-import.js` + `public/app.js`の`openAiPromptImport`）
- 反映前プレビュー、置き換え／末尾追加、結合結果の二重追加防止、認識不能時のRaw Promptフォールバック
- `LoRAトリガーワード`見出しの取り込みと`(word:1.2)`からのWeight読み取り
- Grok向け指示テンプレートの保存・全文コピー・`lora_list.csv`の自動生成（`src/prompt-template.js`）

## v2.16で見送った項目

### インポート時の項目マッピング変更

- 現状: 見出しと反映先の対応は`HEADING_ALIASES`（`public/prompt-import.js`）の固定表。
  未対応の見出しは取り込まず、プレビューに一覧を出すだけ。
- 次にやるなら: プレビューの各行へ`<select>`を足し、反映先を選び直せるようにする。
  対応表をユーザー辞書として`data/prompt-template.json`へ保存する手もある。

### Grokへの直接送信

- 現状: 指示テンプレートのコピーだけ。API送信は行わない（仕様どおり）。
- 次にやるなら: `src/prompt-template.js`と並べて送信サービスを作り、
  APIキーはDiscord Webhookと同じくサーバー内だけで保持する。

## v2.15で対応済み

- Favorite時のDiscord自動送信（`src/discord.js` + `PATCH /api/history/:imageId/favorite`）
- 画像ごとの送信状態（`not_sent` / `sending` / `sent` / `failed`）の履歴保存と二重送信防止
- 失敗した画像だけの再送（`POST /api/history/:imageId/discord/send`）
- Webhook URLのサーバー内保持（環境変数 / `config.local.json` / `data/discord-settings.json`）

## v2.15で見送った項目

### Discord Bot API（チャンネルID指定）での送信

- 現状: Webhookのみ対応。指示にあった「送信先チャンネル」はWebhook URLで代用している。
- 次にやるなら: `src/discord.js`の`postToDiscordWebhook`と並べて`postToDiscordChannel`
  （`POST /channels/{id}/messages` + `Authorization: Bot ...`）を足し、
  `resolveWebhook`を「送信方式の解決」へ広げる。Bot Tokenも同じくサーバー内だけで保持する。

### Discord投稿の削除・比較画面のバッジ

- 現状: Favorite解除では投稿を消さない（仕様どおり）。投稿削除のUIとAPIは無い。
  送信状態のバッジは履歴カード・候補カード・生成結果パネルのみで、`public/compare-view.js`の
  👍ボタンには出していない。
- 次にやるなら: 保存済みの`discordMessageId`を使って`DELETE /webhooks/{id}/{token}/messages/{messageId}`
  を呼ぶ明示的な操作を履歴詳細へ追加する。

## v2.14で対応済み

- 日本語説明文の任意化（Promptがあれば説明文なしで生成し、履歴は`無題`）
- 用途別Positive Prompt（分割入力）とRaw Promptモード（`public/structured-prompt.js` + `public/app.js`）
- LoRAトリガーワードの自動取得・分類・個別Weight・枠単位の削除
- 履歴への構造化プロンプト／Raw Prompt上書き／トリガーワード保存と、古い履歴のRaw Prompt復元

## v2.14で見送った項目

### トリガーワード反映先の手動変更

- 現状: 反映先はLoRA分類（`registry.subcategory`）とキーワードで自動決定し、判定できない語は
  `追加プロンプト`へ入れる。ユーザーが枠ごとに反映先を選び直すUIは無い。
- 次にやるなら: `createTriggerRow`（`public/app.js`）へ`<select>`を足し、
  `AppliedTriggerWord.targetField`を書き換える。`syncTriggerWords`は既存枠の
  `targetField`を保持するので、同期で戻されることはない。

### Checkpoint別LoRAセットの構造化保存

- 現状: LoRAセット（`data/checkpoint-lora-sets.json`）は従来どおりPrompt全文を保存する。
  読み込むとRaw Prompt上書きとして復元される。
- 次にやるなら: `src/checkpoint-sets.js`のスキーマへ`structuredPrompt`を追加し、
  `currentSetPayload` / `applyCheckpointSet`（`public/app.js`）を履歴と同じ形へ揃える。

## v2.13で対応済み

- ヘッダー右上の生成キュー表示（`GET /api/queue` + `public/queue-view.js`）。
  通常生成と比較実験を`job.meta.kind`で区別し、実行順・完了数・処理中の条件を出す
- 履歴詳細の`Copy Prompt` / `Copy All Metadata`（整形は`public/metadata-format.js`）
- Prompt・Negative prompt・Civitai URL・Seedの個別クリアと`Clear Prompts`（Undo付き）

## v2.13で見送った項目

### リンク追加欄のクリア

- 指示にあった「リンク追加のURL入力欄」は、このアプリに該当機能が無いため対象外。
  URL入力欄はCivitaiモデルページのみで、そこへはクリアボタンを追加済み。
  将来リンク管理を追加する場合は`setupClearableField`（`public/app.js`）を再利用する。

### 失敗した比較実験の再実行・キューの並べ替え

- 現状: サーバーに再実行（resume）とキュー並べ替えのAPIが無いため、見た目だけの
  ボタンは追加していない。キュー詳細では中止・中断と結果表示だけを出す。
- 次にやるなら`src/experiments.js`へ`resume(id)`を追加してから、
  `public/queue-view.js`の`buildComparisonRow`へ`onRetryComparison`を渡す。

## v2.12.1で対応済み

- run状態（`queued`/`running`/`done`/`failed`/`cancelled`）の永続化と、
  終端状態をJobManagerの状態で上書きしない優先順位（`src/experiments.js`）
- 実ジョブが消えた未完了runの`cancelled`への正規化（サーバー再起動対応）
- 実験削除時のジョブ停止（`experiments.stopJobs` → 履歴削除 → `experiments.remove`）
- 比較実験の同時実行禁止（サーバーは409、フロントはボタン無効化と監視復元）
- 実験データ保存失敗時の孤児ジョブ回収
- 自動リカバリされたrunの`recovered` / `retryInfo`記録とUI表示

## 簡略化した項目

### パラメータ比較の複数軸

- 現状: 比較対象は1項目のみ（仕様どおり）。複数軸の総当たりは未実装。
- 次にやるなら: `src/experiments.js` の `create` を `parameters: [{parameter, target, values}]`
  形式へ拡張し、直積の枚数が上限を超えたら400で拒否する。
  UIは `public/app.js` の `runExperiment` と `#experimentDetails`（`public/index.html`）。
- 注意: 枚数が爆発するため、確認ダイアログと上限（既定8・最大12）は必ず維持する。

### 派生生成のPrompt解析

- 現状: 衣装・背景・表情の変更は「元Promptへ追加指示を足す」方式。
  元Promptから該当タグを除去する解析は行っていない（追加内容は
  `derivationInstruction` として履歴に残る）。
- 次にやるなら: `public/app.js` の `deriveWithInstruction` / `appendPromptInstruction`。
  背景・表情のタグ辞書を作り、既存タグを置換してから追加するとより正確になる。

### 比較画面の同期ズーム

- 現状: ホイール拡大とドラッグ移動を全ペインで同期（実装済み）。
  ただしピンチズーム（タッチ2本指）には未対応。
- 次にやるなら: `public/compare-view.js` の `stage` へ `touchstart/touchmove` を追加。

### 実験の再開

- 現状: 中断した実験の「残りだけ再実行」は未実装。中断後は値を入れ直して
  新しい実験として実行する。サーバー再起動で中断されたrunも同じ扱い。
- 次にやるなら: `src/experiments.js` に `resume(id)` を追加し、
  `status !== "done"` のrunだけジョブへ積み直す（同時実行の排他は
  `findActive()` をそのまま使える）。

### 比較実験のリカバリ抑止

- 現状: 比較実験中でも通常生成と同じ自動リカバリが働き、候補枚数・Hires倍率・
  解像度などが同時に下がることがある。下がった場合は`recovered`と`retryInfo`を
  runと履歴へ残し、UIへ`設定を下げて再試行`と表示するだけで、リカバリ自体は止めない。
- 次にやるなら: 実験payloadへ`allowRecovery: false`を持たせ、
  `src/server.js` の `generateWithRecovery` で比較実験だけ再試行せず
  `failed`にする（比較の公平性を優先する場合）。

## 既知の制限

- `POST /api/lora/open-root` はWindowsでは`explorer.exe`を使う。explorerは成功時も
  終了コード1を返すため、失敗判定はしていない（パスの存在確認のみ実施）。
- LoRAルート直下への「保存先移動」は未対応（サブフォルダ間の移動のみ）。
  `resolveInstallTarget` が空の相対パスを許可しないため。
- 自動リカバリはReForge由来のエラーメッセージ文字列に依存する。ReForgeの
  バージョンによって文言が変わると分類できない場合がある
  （`src/recovery.js` のパターンを追加すれば対応できる）。
- 比較生成中に別の通常生成を投入すると、同じジョブキューへ入るため
  実験の途中に割り込む。厳密な排他は行っていない（比較実験どうしの
  同時実行だけをv2.12.1で禁止した）。
- 実験の中断・削除では、実行中ジョブへ中止シグナルを送ってから最大3秒だけ
  終了を待つ。ReForge側が応答しない場合はその待ち時間で打ち切り、runは
  `cancelled`として確定する。
- 生成ジョブはメモリ上にしか無いため、サーバーを再起動すると未完了runは
  必ず`cancelled`になる。ジョブキュー自体の永続化は行っていない。

## 関連ファイル

| 機能 | サーバー | クライアント |
| --- | --- | --- |
| LoRAルート判定 | `src/lora-root.js` | `public/app.js`（`loadLoraRoot`） |
| 保存先ピッカー | `src/civitai.js`（`listInstallFolders`） | `public/civitai-folders.js` |
| 重複チェック | `src/civitai.js`（`checkDuplicate`）、`src/lora-files.js` | `public/app.js`（`openDuplicateDialog`） |
| メタデータ編集 | `src/lora-registry.js`、`src/civitai.js` | `public/lora-editor.js` |
| 実験・比較生成 | `src/experiments.js` | `public/app.js`（実験セクション） |
| 画像比較 | `src/experiments.js`（`addComparison`） | `public/compare-view.js` |
| Checkpointセット | `src/checkpoint-sets.js` | `public/app.js`（LoRAセット） |
| 自動リカバリ | `src/recovery.js`、`src/job-manager.js` | `public/app.js`（`confirmRecovery`） |
| 生成キュー表示 | `src/server.js`（`/api/queue`）、`src/job-manager.js`（`job.meta`） | `public/queue-view.js` |
| 履歴のコピー | — | `public/metadata-format.js` |
| 共通UI | — | `public/ui-kit.js`（`copyToClipboard`・`flashLabel`・トーストの`action`） |
| マイグレーション | `src/migrations.js` | — |
