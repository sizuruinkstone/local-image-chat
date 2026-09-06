# Frontend Refactor Phase 15 — Checkpoint Sets

2026-09-07完了。開始HEAD `22beecf` と未コミットのPhase 14を保持。commit/pushなし。Phase 16へ継続し、Phase 17は未着手。

## Changed

`public/features/checkpoint-sets.js` を追加し、Checkpoint Setのcatalog、Checkpoint別表示、CRUD、apply / autoApply、dirty fingerprint、listenerを `public/app.js` から抽出した。`package.json` のsyntax checkへ登録し、`test/checkpoint-sets-controller.test.js` を追加した。

appは **6,892 → 6,706行（186行減）**。backend、保存schema、API、HTML/CSSは変更していない。

## Ownership

controllerがSet一覧・選択表示、create / rename / duplicate / delete、autoApply設定、保存後/適用後のfingerprint baselineを所有する。fingerprintは既存どおりfull `readSettings()` とsort済みの選択LoRA名/weightで、Prompt、Negative Prompt、Prompt boosts、LoRA metadata/source/outfitは含めない。

Set schemaにruntime IDを追加していない。同じCheckpoint identityはruntimeを跨いで同じSetとして扱い、手動applyもruntime/checkpointを切り替えず、現在のform / LoRA / Promptへ内容を適用する既存semanticsを維持した。

## Interface

appはruntimeのstate/context/current判定、settings read/apply、LoRA fingerprint/save/restore/render、Prompt read/applyを狭いportで渡す。controllerはruntime internals、LoRA selection map、Prompt parsing/raw/structured同期を所有しない。

autoApplyはruntime controllerのselection callbackが渡すstate/context/current判定を使用する。確認dialogの前後とmutation直前に同じruntime/checkpoint contextであることを確認し、dialog中にruntimeが変わった場合は古いSetを適用しない。

## Gate

- focused: `node --test test/checkpoint-sets-controller.test.js test/runtime-controller.test.js test/checkpoint-sets.test.js test/task20.test.js test/task22.test.js` — **66 passed / 0 failed / 0 skipped**、exit 0。
- `npm.cmd run check` — exit 0。
- `git diff --check` — exit 0。
- Phase 15では指示どおりfull suite / browser smokeを実行せず、Phase 16後の最終gateでまとめて実行した。

## Remaining risk

保存済み `promptBoosts` をapplyしないこと、Promptだけの編集をdirty判定に含めないこと、同名Checkpoint identityがruntimeを跨いでSetを共有することは既存仕様のまま。変更にはbackend schemaやPhase 17 coordinator判断が必要なため、このPhaseでは再設計していない。
