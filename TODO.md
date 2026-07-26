# TODO

v2.12の総合改造で意図的に簡略化した項目と、次に手を入れるとよい箇所。
機能自体は動作しており、以下は「あると better」の残作業。

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
| 共通UI | — | `public/ui-kit.js` |
| マイグレーション | `src/migrations.js` | — |
