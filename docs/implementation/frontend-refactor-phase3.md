# Frontend Refactor Phase 3 — Sampler picker

実施日: 2026-09-06。Phase 3–10連続runのPhase 3 gate完了。commit/pushなし。

- `public/features/sampler-picker.js` がcatalog、既存4保存keyのFavorite/Recent処理、search/preset、pickerの2 click listenerを所有。DOMのSampler/Scheduler値を正本に維持。
- appは7個のDOM subset、HTTP/modal、runtime URL/context判定を注入。runtime rollbackは`getOptions`/`setOptions`、profile/recipe後の同期は`syncLabels`。runtime自体の設計・activationは変更しない。
- `init`重複防止、`dispose`/再init、空catalog、stale成功/失敗、保存値の破損、個別選択・preset順、外部form変更後の同期を検証。retry追加なし。
- 変更: app、上記module、package check列挙、`test/sampler-picker.test.js`。HTML/CSS/backendと既存private成果物は変更なし。

検証: focused 12/12、sampler+ui-shell 48/48、`npm.cmd run check` exit 0、全`npm.cmd test` 560 passed / 0 failed / 0 skipped。全test logはTEMPの`local-image-chat-phase3-npm-test-20260906.log`。

Characterization時系列の制約: 編集前appはTEMP `local-image-chat-phase3-before/app.js`に保存したが、最初の実行可能testは抽出draft後に実行した。gate確定前に`SAMPLER_LEGACY_APP_PATH`へそのsnapshotを指定し、旧関数をVM実行して同一シナリオの値・順序・modalをcontrollerと比較するparity testを追加。13 passed / 0 failedを確認（production変更なし）。実装前にtest実行済みとは扱わない。後続Phaseでは旧実装testの実行を先行する。

Chrome smoke: 隔離localhost fixtureでpickerを開き、Euler検索、Favorite追加、選択後label同期、別Sampler DDIM選択後のRecent表示を確認。実provider/Discord通信なし。

app規模: 9,939行 / 413,084 bytes → 9,781行 / 407,035 bytes（-158行）。保存key/API/History/storage/runtime/HTML/CSS不変、逆importなしをSupervisor review。残る結合はruntime snapshotとform適用後の明示sync。次はPhase 4 shellのみ。
