# Frontend Refactor Phase 4 — Settings shell

実施日: 2026-09-06。Phase 4 gate完了。次はPhase 5 Discord settings UIのみ。

- `public/features/settings-navigation.js`へ9カテゴリ、search index、active category、検索/カテゴリ/focus処理と4 listenerを抽出。7 DOM要素とdocument/window/rAFを注入。init/disposeは自身のlistenerだけを管理。
- appはconnection summary・個別設定保存/API・LoRA/updateのworkflowを保持。既存callerからactivateを呼ぶ。HTML/CSS、狭幅breakpoint、保存キー、API変更なし。
- Phase3のcomposition確認でSamplerへDOM全体が渡っていたため、同じく実際の7要素だけへ限定した。Sampler内部behaviorは不変。
- 変更: app/package、新module、`test/settings-navigation.test.js`、ui-shellの移動先assertions。既存assertionsの意味を保持。

検証（2026-09-06）:

| Gate | 結果 |
| --- | --- |
| 抽出前の実app VM characterization | 3 passed / 0 failed / 2 future-controller skips |
| 新controller + sampler + ui-shell | 53 passed / 0 failed / 2 opt-in parity skips |
| 旧snapshotと新controllerのparity | 5 passed / 0 failed / 0 skipped |
| npm.cmd run check | exit 0 |
| npm.cmd test | 564 passed / 0 failed / 2 opt-in parity skips（全566） |

旧snapshot: TEMP `local-image-chat-phase4-pre-extraction-app.js`。`SETTINGS_LEGACY_APP_PATH`を指定して再現可能。標準testはTEMP不要でcontrollerを検証。全文logはTEMP `local-image-chat-phase4-*.log`。

Chrome fixtureで抽出前後とも、複数語Grok/テンプレート検索→詳細カテゴリ→details open→grokInstructions focus→検索clearが一致。390pxでカテゴリselectへ切替・選択成功、document scrollWidth375pxで横overflowなし。ブラウザは実public配信、APIはローカルfixtureのみ。

Supervisor review: 個別保存/connection summaryはapp、feature逆importなし、timer/retry/backend/History/runtime/storage/CSS変更なし。残るcouplingはappのLoRA/updateからの明示category activation。
