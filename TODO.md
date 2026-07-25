# TODO

v2.12の総合改造で意図的に簡略化した項目と、次に手を入れるとよい箇所。
機能自体は動作しており、以下は「あると better」の残作業。

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
  新しい実験として実行する。
- 次にやるなら: `src/experiments.js` に `resume(id)` を追加し、
  `status !== "done"` のrunだけジョブへ積み直す。

## 既知の制限

- `POST /api/lora/open-root` はWindowsでは`explorer.exe`を使う。explorerは成功時も
  終了コード1を返すため、失敗判定はしていない（パスの存在確認のみ実施）。
- LoRAルート直下への「保存先移動」は未対応（サブフォルダ間の移動のみ）。
  `resolveInstallTarget` が空の相対パスを許可しないため。
- 自動リカバリはReForge由来のエラーメッセージ文字列に依存する。ReForgeの
  バージョンによって文言が変わると分類できない場合がある
  （`src/recovery.js` のパターンを追加すれば対応できる）。
- 比較生成中に別の通常生成を投入すると、同じジョブキューへ入るため
  実験の途中に割り込む。厳密な排他は行っていない。

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
