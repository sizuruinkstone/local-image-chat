# Frontend Refactor Phase 20.5 — Restore Safety Primitives

2026-09-07。HEAD `55d7bba`、Phase 17–20の未コミット差分を保持。Phase 21の事前characterizationで判明したrollback safety不足だけを補強した。Phase 21 Recipe Workflow、Phase 22 Generation Orchestration、Phase 23 Persistence/Bootstrapは実装していない。stage/commit/pushなし。

## Changed

- `public/features/ip-adapter-controller.js`
- `public/features/inpaint-editor.js`
- `public/features/reference-image.js`
- `public/app.js`
- `test/ip-adapter-controller.test.js`
- `test/inpaint-editor.test.js`
- `test/reference-image.test.js`
- `test/prompt-lora-form-characterization.test.js`

`prompt-lora-coordinator`のproduction code、backend/API、History/storage schema、Runtime controller、HTML/CSSは変更していない。Browser Smoke用のignored fixtureを `workbench/ui-mocks/phase205/` に残した。

## IP-Adapter rollback / recipe / payload boundaries

- `captureState()` / `restoreState()` はRuntime capabilityに依存しないfull rollback port。optionsと保持stateをcaptureし、restoreはpending file readとpending options requestを無効化する。
- local fileはcontrollerが既に保持するData URLをrollback previewへ使用する。live controllerが所有するblob URLはsnapshotへ渡さず、置換・clear・rollback・dispose時のrevokeはcontroller内に留めた。
- `getSnapshot()` / `restoreSnapshot()` は保持中feature metadataの互換port。unsupported Runtimeでも参照identityを取得・復元できる。`restoreSnapshot()`はcapability/optionsを所有しないため、進行中の現在Runtime options requestは無効化しない。
- `restoreRecipe()` は既存Recipe metadata復元、`readPayload()` はgeneration payload。後者だけが現在Runtime capabilityとenabledをgateし、unsupported時はIP fieldを返さない。

## Inpaint rollback and stale async invalidation

`captureState()` はrestorable source descriptor、source key、backing width/height、PNG mask、tool、brush size、undo/redo PNG stackのコピーだけを返す。local sourceはData URLへ正規化し、DOM node、Canvas、2D context、live objectを公開しない。

`restoreState()` は世代を進め、detached source/maskを事前decodeする。validation/decode成功と世代一致を確認した後だけ、source/canvas → mask → history → brush/tool → status/UIの順でcommitする。decode failureとsuperseded restoreは既存stateを変更しない。

undo/redoはdecode成功までstackをcommitしない。source replacement、clear、reset、rollback restore、dispose、新しいstrokeはasync generationを更新し、古いdecode完了を破棄する。

## Reference / Form / Prompt-LoRA

- Referenceの既存snapshot、blob ownership、stale read guardを維持。追加修正として、`restoreSnapshot(null)`も現在referenceの有無にかかわらずpending local readを無効化する。appはnullを含め必ずownerへrestoreを委譲する。
- app内に狭い `captureFormState()` / `restoreFormState()` を追加。既存runtime form snapshotに、Recipe loadが実際に変更・保存するcontent rating、LoRA weight/trigger/negative/outfit cacheだけを加えた。既存Mapを置換し、既存保存・render callbackを使う。profile/preset/addon、controller state、Recipe transactionは含めない。
- `appliedTriggerWords` はrecordとnested `sourceLoraIds`をcapture/restore両方向でcopyし、capture後のlive mutationと反復restoreから隔離した。
- Prompt/LoRA coordinatorのRaw/Structured、selection/source/disabled semanticsは変更していない。selection rollbackは既存coordinator port、formとapp-owned cacheのrollbackはapp portという境界を維持した。

## Verification

2026-09-07、architecture review finding修正後:

- focused: `node --test test/ip-adapter-controller.test.js test/inpaint-editor.test.js test/reference-image.test.js test/prompt-lora-coordinator.test.js test/prompt-lora-form-characterization.test.js` — **60 passed / 0 failed / 0 skipped、exit 0**。
- `npm.cmd run check` — **exit 0**。
- `npm.cmd test` — **716 total / 714 passed / 0 failed / 2 existing skips / 0 todo、exit 0**。test runner 11.829s、wall 12.48s。1回だけ実行。
- ignored local fixtureと実ブラウザでBrowser Smokeを1回実施。IPはlocal `File` → capture → alternate reference → rollbackで、revoke後もData URL previewがdecodeできた。unsupported中もcapture/restoreでき、payloadは空。
- Inpaintは実Canvasでpaint/history → capture → alternate source/reset → restoreを行い、source identity、mask、undo historyを復元。遅延undo decode中のreset後に古い完了が描画しないことと、同じsnapshotの再restoreも確認。
- Browser console error/warn **0**。fixtureはlocalhostのみで、backend/provider/実generation requestなし。
- Astra architecture reviewを1回実施。Reference empty rollbackのpending read、IP full rollbackのpending options、form trigger snapshotのnested mutable sharingという3件のP2を検出し、全件をowner内の世代guard/copyとfocused regressionで修正した。未解決P0/P1/major findingなし。
- `git diff --check` — whitespace errorなし。既存working-copyのLF/CRLF warningのみ。

## Remaining boundary / Phase 21

Phase 20.5で要求されたIP、Inpaint、Reference、Prompt/LoRA、Formの安全primitiveは利用可能になったため、Phase 21の設計・実装検討は再開できる。ただし、Runtime切替成功後に別featureが失敗した場合の以前Runtimeへのpublic rollback portは今回のscope外で未定義。Phase 21開始時にcritical rollback境界と、checkpoint/source/maskの現行非復元semanticsを確定する必要がある。この点を解決せずatomic Recipe workflow完成とは扱わない。
