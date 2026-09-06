# Frontend Refactor Phase 6 — Storage settings

実施日: 2026-09-06。Phase6 gate完了。

`public/features/settings-storage.js`がsettings response/plan/busy state、load/render/plan/invalidate/reserve/cancelと4 listenerを所有。appは11 DOM要素、既存HTTP helperとconfirmModalを注入。Backend storage/migration/marker/backup/JsonStore/出力先semanticsは変更なし。

実装前にTEMPの旧app VM characterization: 6 passed/0 failed/1 future-lifecycle skip。新controller: 7/7。関連focused（storage/UI/server integration含む）65/65。check exit0。full npm.cmd test: 576 passed/0 failed/2 opt-in sampler/settings parity skips（全578）。外部log: TEMP `local-image-chat-npm-test-20260906-checks-f1797ba5f37f4888957b35df8b3fbe58.log`。

Characterizationはeditable/env/pending/失敗時disable、trim、busy、入力plan無効化、invalid/same/restart plan、confirm cancel無通信、reserve/cancel PATCH→GET→案内の順序を固定。旧snapshotはTEMP `local-image-chat-phase6-pre-extraction-app.js`。新testは通常実行でTEMP不要。

Chrome localhost fixture: invalid pathは予約無効、同じ保存先は変更なし/予約無効、有効planは件数/容量/空き容量と旧保存先保持の説明、confirm cancelでplan保持、予約成功で入力無効と再起動案内、予約解除で旧保存先不変・再編集可能を確認。実ファイル移行/実provider通信なし。

変更: app/package、新module、settings-storage test、ui-shellのowner追従。Supervisor/独立auditで52保護file hash/size一致、4 featureのDOM subsetと逆importなしを確認。次はPhase7 AI share/template。
