# Frontend Refactor Phase 5 — Discord settings

実施日: 2026-09-06。Phase 5 gate完了。

`public/features/settings-discord.js`へ設定取得/render/save/test/clearと3 listenerを抽出。14 DOM要素、transport/UI、appのconnection summary callbackを明示注入。画像Favorite/生成通知のMap/watchersは対象外。成功時のWebhook入力クリア、失敗・cancel時保持、安全なhint表示、9 bool DTO、renderとload finallyのsummary順を維持。secretを保存する新frontend storageなし、backend送信semantics不変。

変更: app/package、新module、`test/settings-discord.test.js`、ui-shellのsource assertion移動。HTML/CSS/backend変更なし。

検証: 実装前の旧関数VM characterization 4 passed/0 failed/1 future-controller skip。同assertionを新controllerへ適用しPhase5単体5/5。関連focused62 passed/0 failed/1 unrelated optional parity skip。check exit0。full `npm.cmd test` 569 passed/0 failed/2 opt-in saved-snapshot parity skips（全571）。ログはTEMP `local-image-chat-phase5-npm-test-20260906.log`。

Chrome fixture（localhost58557）: fake Webhook設定保存→入力空・hintのみ表示・接続summary更新、test UI成功、clear cancel保持、clear実行→未設定/clear disabledを確認。実provider/Discord通信なし。fixtureのPOST/PATCHはmemoryだけ変更。

Supervisor review: narrow DOM subset、3 listener init/dispose、既存API/body/エラー/順序保持、notification stateとの混在なし。次はPhase6 storage frontendのみ。
