# Local Image Chat 次回更新：Luna向け個別タスク一覧

更新日: 2026-08-05
役割: この文書は個別タスクの索引と共通ルールです。実装時は、Lunaへ割り当てられた1つのタスク文書だけを主要求として扱ってください。

## 0. 作業前確認

- リポジトリ直下に `DESIGN.md` は現時点では存在しません。
- 将来追加されていた場合は、各タスクの作業開始前に必ず全文を読んで従ってください。
- 新規リポジトリを作成しないでください。
- HTML、CSS、Vanilla JavaScript、Expressの既存構成を維持してください。
- React、Vue、Tailwind、UIフレームワーク、新しい状態管理ライブラリを導入しないでください。
- 原則として新規依存を追加しないでください。
- 作業ツリーには他タスク由来の未コミット変更があります。担当範囲外を戻したり、整形したりしないでください。
- 各タスク開始時に `git status --short` と対象ファイルの差分を確認してください。
- 変更が8ファイルを超える見込みなら、実装前に理由とファイル一覧を報告して止めてください。

## 1. 現状調査の確定事項

### タイトル生成経路

現在は、廃止対象の日本語生成用説明で使われていた `promptDescription` が生成要求の `description` として送信され、`src/server.js` がそのまま `history.addGeneration()` へ渡しています。`src/history.js` の `normalizeGeneration()` が `generation.description` として保存し、空なら「無題」にしています。生成画面右履歴、ギャラリー、画像詳細、画像altも主に `generation.description` をタイトルとして使っています。

### 比較機能

- 比較候補は `public/app.js` の `compareSelection`（`Map`、最大4枚）で保持されています。
- 生成画面中央、最終結果、ギャラリーカード、詳細モーダルから追加できます。
- ギャラリー上部の「比較する（n）」から `compareCurrentSelection()` を呼びます。
- `public/compare-view.js` には2〜4枚の比較モーダル、原寸切替、同期ズーム・パン、設定差分、LoRA Weight差分、Prompt差分が既にあります。
- 現在はヘッダー件数バッジ、比較候補トレイ、0枚・1枚時の案内がなく、画面内の「比較実験」と通常の画像比較が区別しにくい状態です。

### 画像拡大

- `public/app.js` の `openImageModal()` / `ensureImageModal()` が既にあります。
- Escape、閉じるボタン、背景クリックに対応しています。
- 中央の「拡大」ボタン、ギャラリー画像、LoRA作例などは既存モーダルを利用しています。
- `#studioMainImage` 自体には、現時点でクリック・Enter・Spaceによる拡大操作がありません。

### 中央の保存ボタン

- `public/index.html` の `#studioMainDownload` は中央ツールバーのダウンロード用 `<a>` です。
- `selectCandidate()` と `setStudioInspection()` が `href` と `download` を設定します。
- 最終Hires結果には別の `#downloadLink` があります。
- 自動保存と履歴保存はサーバー側で行われており、中央の手動保存リンクとは独立しています。

### 設定保存

- 生成候補数、各種生成補助、LoRA選択関連などは既存の `localStorage` を利用しています。
- Checkpointセット、LoRAレジストリ、Civitai、Discordなどは既存のサーバーAPIとJSON Storeを利用しています。
- 設定画面は `public/index.html` の複数の `<details>` で構成され、保存方式は項目ごとに異なります。UI整理タスクで保存方式を統一・変更してはいけません。

### Discord

- `src/discord.js` にWebhook検証、マスク表示、サーバー側保存、画像添付、送信状態、二重送信防止、失敗状態、再送処理があります。
- Webhook URLは環境変数、`config.local.json`、`data/discord-settings.json` の順で解決され、APIレスポンスへ実値を返しません。
- 現在の自動送信は「画像をFavoriteにした時」です。生成完了通知ではありません。
- `src/server.js` は画像ファイル、サムネイル、履歴の保存後に `history.addGeneration()` を完了しているため、その直後が生成完了通知を開始する安全な位置です。
- 既存のFavorite送信を壊さず、生成完了通知とは設定・メッセージ・送信契機を区別する必要があります。

### ギャラリー

- `public/app.js` の `loadHistory()` / `renderHistory()` / `createHistoryCard()` が担当しています。
- 20件カーソルページング、Favorite、Checkpoint、LoRA、期間、検索の絞り込みは既にあります。
- `public/gallery-filter.js` が画像単位への平坦化と絞り込みを担当しています。
- サムネイル、遅延読み込み、原寸フォールバックは既存の `public/image-delivery.js` を利用しています。

## 2. 個別タスク

推奨順に、以下を1件ずつLunaへ割り当ててください。各タスクの終了後にレビューを挟み、次タスクは最新の作業ツリーを前提に開始してください。

1. [01_MAIN_IMAGE_ZOOM.md](./luna-tasks/01_MAIN_IMAGE_ZOOM.md)
2. [02_REMOVE_MAIN_SAVE.md](./luna-tasks/02_REMOVE_MAIN_SAVE.md)
3. [03_COMPARE_ENTRY_FLOW.md](./luna-tasks/03_COMPARE_ENTRY_FLOW.md)
4. [04_HISTORY_TITLE_SOURCE.md](./luna-tasks/04_HISTORY_TITLE_SOURCE.md)
5. [05_DISCORD_GENERATION_NOTIFICATION.md](./luna-tasks/05_DISCORD_GENERATION_NOTIFICATION.md)
6. [06_GALLERY_UI.md](./luna-tasks/06_GALLERY_UI.md)
7. [07_SETTINGS_UI.md](./luna-tasks/07_SETTINGS_UI.md)

## 3. タスク間の依存

- 01と02は同じ中央画像ツールバー付近を変更します。必ず01→02の順にしてください。
- 03は02で保存ボタンが消えた後のツールバーを前提に、比較ラベルを調整します。
- 04は履歴表示名の共通取得関数を用意します。06はその関数・契約を再利用してください。
- 05は通知設定UIを追加します。07はその設定項目を「Discord通知」カテゴリへ配置するだけにし、Discord処理を作り直してはいけません。
- 03でギャラリーの比較操作を整えた後、06はそのDOM・状態関数を再利用してください。
- 07は最後に実施し、それ以前に追加されたタイトル設定・通知設定をカテゴリへ組み込んでください。

## 4. 全タスク共通の禁止事項

- APIの破壊的変更
- ReForge連携の変更
- 既存画像ファイルの保存方法・配信方法の変更
- 履歴データの破壊的移行
- 既存Favorite送信の削除
- 生成失敗とDiscord通知失敗の混同
- Prompt全文やAI翻訳結果をタイトルとして再利用
- 比較機能・画像モーダル・設定保存処理の重複実装
- 全面リファクタリング
- 無関係な命名変更、整形、依存更新

## 5. 各タスク共通の検証と報告

最低限、次を実行してください。

```powershell
npm run check
npm test
```

関連テストは全テストより先に実行してください。UIタスクでは3030番で動作中の画面を再読み込みして確認して構いませんが、生成中ジョブがある場合はサーバーを勝手に再起動しないでください。

作業後は次だけを報告してください。

- 変更ファイルと各変更内容
- 再利用した既存処理
- 既存仕様との互換方法
- 実行したコマンドと結果
- 手動確認結果
- 未確認事項・残る制約
- `git diff --stat`
