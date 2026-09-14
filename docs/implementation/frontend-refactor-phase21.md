# Frontend Refactor Phase 21 — Recipe Workflow

## Implementation / corrected tree

2026-09-07。**Phase 21完了。** Phase 20.5後の再開GateはBで確定し、Recipe workflowを実装した。現在の検証結果はこの節を正本とし、下部の旧停止記録の未完了・primitive不足を現在状態と混同しない。

### Changed / interface

- 新規 `public/features/recipe-workflow.js`（147行）。`createRecipeWorkflow({ runtime, form, promptLora, ipAdapter, referenceImage, inpaint, reportError })` は `load(recipe, image): Promise<boolean>` と `ensureRuntime(recipe)` を返す。
- `public/app.js` は **4,640 → 4,727行（87行増）**。旧loadの順序をworkflowへ移し、compositionとheader/settings/cache/persistence/renderのnarrow adapterを残した。安全な接続と保存例外の区別のため、app行数削減は今回の成果ではない。
- `public/features/inpaint-editor.js` のrollbackに `restoreState(snapshot, { isCurrent })` を接続。owner内部のasync generationに加え、decode後commit前にRuntime contextを再確認する。
- `public/features/reference-image.js` のrestoreへ `syncSize:false` を追加。Recipe rollbackでは保存form寸法を優先し、即時・遅延寸法判明によるauto-sizeを抑止する。通常のsource選択と従来Runtime form restoreのdefaultは変更しない。
- `package.json` のprecheckへ新moduleを追加。新規 `test/recipe-workflow.test.js` / `test/recipe-runtime-boundary.test.js`、既存Inpaint/Reference/form characterization/Task20 testを更新した。
- 文書は本書、`current-state.md`、`decisions.md`。IP、Prompt/LoRA、Runtime controllerのproduction code、backend/API/schema、HTML/CSS、generation submitは変更していない。ignored browser fixtureだけを追加した。

### Workflow order / transaction

Runtime readiness成功 → target/runtime context再確認 → Prompt-LoRA/IP/Reference/Form/Inpaintのowner snapshot capture → header/rating → Prompt → IP → settings/sampler/Seed/count/preferences → selection/source/disabled → trigger/negative/outfit → 保存/描画 → final Prompt reconciliation。

成功したRuntime切替はcommit済み。後続critical failureのrollbackは **Prompt/LoRA → IP → Reference → Form（派生Studio statsも同期）→ Inpaint**。Form内部のReference/mode callbackがInpaint source同期を起こすため、Inpaintを最後にする。ReferenceとForm内Reference restoreの両方でauto-sizeを抑止する。

snapshotはそのoperationだけの一時値であり、ownerのmutable stateを新しく所有しない。queue/versionはworkflowの同時実行制御のみ。Runtime待機中の旧Recipeを新しい要求がsupersedeし、実行・rollbackは直列化する。外部Runtime変更はID比較だけでなく既存token/lifecycle contextで判定し、古いowner restoreを抑止する。後続Recipeは前operationのrollback終了後に開始する。

保存例外は実際のsetItem境界で識別する。nested LoRA同期とInpaint preferencesも同じ分類を通すが、UIやcontrollerの一般例外を保存失敗へ分類しない。保存例外はprefixを保持してfalse、critical例外はrollbackしてfalse。rollback primitiveのfalse/rejectは復元未完了として表示する。次のRecipe適用開始で前回のerror表示を消す。localStorageへの書込回数・順序・保存キーは旧経路を維持し、storage全体をatomicに巻き戻す仕様は追加しない。

### Legacy / owner / one-shot boundaries

Raw/Structured、欠落runtime=ReForge、missing LoRA skip、source=ui fallback、disabled、trigger/outfit、IPのunsupported保持とpayload除外は既存portを使用する。checkpoint/source/mask metadataは従来どおりRecipe適用対象外で、現在のsource/mask/選択checkpointを保持する。この非適用は復元機能の実装済みを意味しない。

composition lock、same-seed、duplicate、instruction/LoRA派生の準備callerとpendingDerivationはappに残る。workflowは生成をsubmitせず、parent/derivation/retry/experimentをconsumeしない。Phase 22の最初の入口は `readDerivationPayload` とそのsubmit/failure/retry/experiment caller。instruction dialog前のRuntime ensureとcancel時のcommit維持もcharacterizeした。

### Validation

- 修正後focused（workflow、Runtime boundary、Runtime/Prompt/LoRA/Reference/Inpaint/IP/form/Task20）: **103 passed / 0 failed / 0 skipped、exit 0**。
- `npm.cmd run check`: **exit 0**。
- `npm.cmd test`: **731 total / 729 passed / 0 failed / 2 existing skips / 0 todo、exit 0**。runner 10.722s、wall 11.345s。production修正・Browser Smoke完了後に1回実行し、成功後は再実行していない。
- Browser: current appをlocalhost mockで配信し実Chrome 152/headlessで確認。History cardの実「読込」操作 → Neo切替・unsupported IP → ReForge・supported IP → Raw override weight 0.65が保存selection 0.7より優先 → local File/実Canvas paint → Recipe適用時source/mask/選択checkpoint保持 → critical failure後form/selection/IP/source/mask/undo history一致 → 成功Runtimeを保持する失敗 → 旧Raw → 連続Recipe最後だけ適用 → same-seed/duplicate → pending undo後resetのstale抑止。**最終sequence PASS**。
- 最終browser console error/warning、uncaught error、unhandled rejectionは **すべて0**。失敗HTTP response 0、generation request 0。実provider/実generationは未実施。
- `git diff --check`: exit 0、whitespace errorなし。文書の相対リンクも確認。既存working-copyのLF/CRLF warningは保持。
- 初回browser準備ではfixtureのCSV endpoint不足と非表示canvas操作を修正した。その後、実rollbackでReference auto-sizeが832×1216を1216×896へ上書きする不具合を検出し、owner optionとfocused regressionで修正して最終sequenceを再確認した。途中の失敗を最終greenとして扱わない。

### Architecture review / remaining risk

Astraの統合reviewで、Bと矛盾する旧Runtime復元案、Inpaint context optionのapp接続漏れ、保存回数/順序・例外分類、rollback後Studio派生表示を修正した。Browserで検出したReference auto-sizeも同Phase内で修正し、修正箇所を検証した。現時点で未解決の重大findingなし。

残るcouplingはappのform/cache/render/persistence adapter、Runtime ensureと派生UI、generationのone-shot consume。snapshot restoreに使うsourceが後から取得不能になるなどowner自体が復元を拒否した場合は、失敗を明示するが復元成功を保証しない。保存例外後のprefix保持は既存の互換境界である。checkpoint/source/maskの新しいRecipe復元は追加していない。Phase 22/23は未着手。既存dirty/private/local差分とcheckpointを保護し、stage/commit/pushなし。

## Resume after Phase 20.5 — mandatory gate (2026-09-07)

Phase 20.5のIP/Inpaint/Reference/Form safety primitive完了を前提に再開。以下の旧停止記録は当時のcharacterizationとして保持し、IPのblob寿命やInpaint snapshot不足を現在の未解決事項として扱わない。

### Runtime boundary: B

**成功したRuntime切替をcommit boundaryとし、Recipeの後続critical failureでは旧Runtimeへ戻さない。** 非Runtime snapshotはRuntime readinessの成功後にcaptureする。これは新しいrollback APIが不要だから選ぶ方針ではなく、以下の既存behaviorによる判断。

- `runtime-controller.selectRuntime` は切替開始時にsnapshotを取り、resource取得失敗/rejectの間だけrollbackする。成功時は明示的に `switching=false`、`switchSnapshot=null`、UI通知、true返却を行う。
- Phase 14のsnapshot/rollback記録は切替loaderとその外部resourceに境界を置く。既存 `runtime-controller.test.js` も切替失敗とresources→render→formの復元順を固定している。これらの既存test単独では後続Recipe失敗の仕様まで証明しない。
- `deriveWithInstruction` はinstruction dialog前にRuntimeをensureし、cancel時はその成功した切替を維持する。Recipe未適用でもRuntime成功が残る、既存の可視的な経路である。
- 今回read-only診断で実runtime-controller＋既存fakeを使用し、ReForge→Neo成功→後続owner相当のthrowではNeoを維持し、その後のNeo→ReForge失敗ではNeoへrollbackすることをassertした。exit 0。成功した切替が次transactionのbaselineになる。

非Runtime rollbackの追加は今回明示依頼されたcritical failure保護。過去のRecipeに完全な非Runtime transactionが既に存在したとは主張しない。Runtimeのselected/active checkpoint、catalog、context tokenはcontrollerに留め、workflowへ複製しない。

### Failure classification

| Condition | 現行behavior / Phase 21で維持する分類 |
| --- | --- |
| Runtimeが利用不可、切替loader failure | Recipe適用前の失敗。Runtime自身のrollback後false、Recipe fieldを適用しない |
| missing checkpoint | Recipe loadは保存checkpointを選択しないためnon-critical非適用。現在の選択を維持。Runtime catalog取得自体の失敗とは区別 |
| missing LoRA | 導入済exact name以外をskip。loadを失敗にしない |
| unsupported IP | reference/parameterを保持しenabledを抑止。payload除外。Recipe loadは成功可能 |
| absent legacy field | Raw/ReForge/source=ui等の既存fallback。settings未定義は現在値保持、欠落IPは既存どおりclear |
| Reference source unavailable | 現行Recipeはsource metadataを読込まないのでRecipe failureとして評価しない。現在source維持。新しいdownload/restoreを導入しない |
| Inpaint mask/source mismatch | 現行Recipeは保存mask/sourceを適用しないのでnon-critical非適用。無効maskを別sourceへ流用する処理も追加しない |
| Prompt/LoRA/IP/form等の予期しないrestore例外 | 今回のcritical rollback対象。Runtime成功後の各owner snapshotへ戻しload失敗。IPの正常なfalse/clearを例外と混同しない |
| rollback primitiveのdecode失敗/false/reject | rollback自体の未完了として報告。復元成功やRecipe成功として扱わない |

Reference/Inpaintの「非適用」はmissing resourceでも正常に新sourceを復元できるという意味ではない。将来これらをRecipeから適用するならfailure仕様とrestore portを別途定義する。

### Persistence boundary

`setContentRating`、candidateCount、img2img/Inpaint preferences、LoRA cacheの保存は、既存ではDOM/state更新の間に直接 `setItem` を呼ぶ。例外はloadを中断し、適用済prefixやそれ以前の保存を自動巻戻ししない。したがって単なる保存失敗をcontroller全体のrollback理由に変更しない。保存できなかったloadを成功扱いにも変更しない。localStorageをtransaction logやsnapshot storeとして追加使用せず、保存schema/keyを変更しない。

---

## Historical discovery before Phase 20.5

2026-09-07。HEAD `55d7bba`、Phase 17–20の未コミット差分を保持。**事前characterizationで停止。Phase 21は未完了、production実装なし。** Phase 22/23へ進んでいない。stage/commit/pushなし。

## Changed

本書と `current-state.md` のみ。`public/app.js` は開始時・終了時とも4,603行。既存controller/test/package差分は今回の変更ではない。

## Workflow order — 現行コードのcharacterization

`public/app.js:loadRecipeFields` の実際の順序:

1. `ensureRuntimeForRecipe`。runtime欠落/無効IDはReForge fallback。selectableな対象が無ければerror/false。同一Runtimeでもswitch完了を待ち、別Runtimeは `selectRuntime` へ委譲する。
2. description、正規化title、content rating（保存を含む）。
3. `promptLoraCoordinator.restorePromptSnapshot(recipe)`。
4. `ipAdapterController.restoreRecipe(recipe)`。falseをcritical failureとして扱わない。
5. 存在するsettings fieldだけ適用、inpaintFullRes、sampler label。
6. 選択imageのSeed、Studio stats、candidateCount=1、count handler、img2img denoising表示、Inpaint preferences保存。
7. `restoreRecipeSelection`、導入済LoRAの非空trigger/negative、outfit復元。
8. weight/trigger/negative保存、library/selection描画、`syncFromPrompt()`、true。

候補順序と異なり、IPはsettingsより前。Recipeの `settings.checkpoint` を選択する処理、mode/source/maskを復元する処理はこの経路に存在しない。Runtime切替に伴うcatalog readinessと、保存checkpointの選択は別である。

## Transaction / rollback — 停止理由

依頼の強制停止条件 **「controller snapshot interfaceだけでは安全にrollbackできない」** に該当する。

- Runtime切替中の失敗は `runtime-controller.selectRuntime` が自分のsnapshotとcontext guardでrollbackする。成功後のRecipe失敗を巻き戻すpublic snapshot/restore portはない。内部 `captureState` / `restoreState` は非公開。
- 現行RecipeはRuntime readiness以降にtry/catch/rollbackを持たない。IP/Prompt/LoRAや保存callbackがthrowすれば適用済prefixが残る。欠落IPのfalse、missing LoRAのskipは既存semanticsだが、critical rejectionのpartial stateを明示的に許容するtest/documentは確認できなかった。安全な仕様として新しく追認しない。
- IPの `captureState()` → 別Recipe適用 → `restoreState(snapshot)` で、最初のlocal previewのblob URLがrevoke済みのまま復元されることを、既存test fixtureと実controllerで再現した。単純snapshot rollbackはpreview資源を復元できない。
- IPの `getSnapshot()` はunsupported Runtimeでnullを返す。実stateにreferenceが保持されている場合も同じで、これだけではdisabled/unsupported状態をlosslessにcaptureできない。
- Inpaintにはmask/historyのpublic capture/restore portがない。`restoreMaskSnapshot` はdecode待機後にsource/lifecycle guardなしで描画する。source置換後の古いundo/redo完了を防ぐportも現状ない。これはPhase 20から記録された未解決リスクで、今回の新規regressionではない。

巨大なglobal snapshotやcontroller内部参照で不足を回避せず、抽出前に停止した。既存partial failureの維持と、要求されたcritical failure rollback・source/mask restoreの安全性を同時に満たす実装は未確定。

## Controller ports / 再開に必要な設計

- Runtime: `runtimeForGeneration` / `selectRuntime` / `waitForSwitch` / context guardは利用可能。成功後の巻戻し範囲は別途定義が必要。
- Prompt/LoRA: `restorePromptSnapshot` / `restoreRecipeSelection` / `syncFromPrompt` を維持する。`captureState` はselection/source/disabledのみ。form、trigger/outfit/cache、途中persistenceのrollback境界は別途必要。
- Reference: `captureSnapshot` / `restoreSnapshot` があり、local previewはData URLへfallbackする。object URLはownerに留める。
- Inpaint: source/mask decodeの世代guardと、必要な範囲だけのsnapshot/lifecycle portの設計が必要。
- IP: enabled/unsupportedを含む保持stateと、revoke後にも有効なpreviewを復元できるowner側portが必要。

再開時はまず上記narrow port補強を実施範囲として確定し、critical failureの巻戻し範囲を決める。checkpoint/source/maskを新しく復元するか、既存の非復元semanticsを維持するかも明記する。schema/API migrationやgeneration submit変更は不要と断定できる段階ではないが、今回必要性を示す証拠はない。

## Legacy fallback / schema

History UIは `history-controller` からgeneration/imageをcallbackへ渡す。`src/history.js:normalizeGeneration` はruntime、Prompt/negative/structured/raw override/applied triggers、settings、LoRA、mode/sourceImageId/sourceImageUrl/maskImageUrl、IP、parent/derivation/experiment/retry metadataを保持する。Seedは各imageにある。

- runtime欠落はReForge。Structured欠落は分類/migrationせずRawへ復元。
- Raw overrideは保存Raw、次に保存Promptを使用し、Structuredを保持してもRaw優先を解除しない。
- LoRAはinstalled exact nameのみ。sourceがui/prompt/both以外ならui、enabled=falseはdisabledとして復元。最終reconciliationはactive Promptのweight/sourceを優先する。
- outfitは保存choice IDとapplied trigger内のstate sourceを既存profileで検証して復元する。
- IP欠落/disabled/参照identity欠落はclear。unsupportedではenabled=falseとしreference/parametersを保持する。
- Reference/Inpaint metadataがHistoryにあっても、現行Recipe loadはsource/maskを復元しない。既存Referenceのlocal/history/asset identityはReference controllerのまま。

## One-shot / Generation boundary

`loadRecipeFields` 自体はparent/derivation/retry/experimentをconsumeしない。`activateCompositionLock`、same-seed、duplicate、LoRA変更、instruction派生のcallerが成功後にlock/Seed/pendingDerivationを設定する。duplicateはSeedを-1に戻す。`readDerivationPayload` が生成時にpendingDerivationを読み取りnullにする。

`deriveWithInstruction` はmodal前にもRuntimeをensureするため、cancel時にRuntimeだけ切替済みになる既存挙動がある。Phase 22の最初の確認対象はgeneration submitから `readDerivationPayload` を呼ぶ位置、failure/retry時の一回消費、experiment/baseRequestとcomposition lockの境界。今回は変更しない。

## Focused tests

2026-09-07、既存treeで実行:

`node --test test/runtime-controller.test.js test/prompt-lora-form-characterization.test.js test/prompt-lora-coordinator.test.js test/reference-image.test.js test/inpaint-editor.test.js test/ip-adapter-controller.test.js`

**62 passed / 0 failed / 0 skipped、exit 0。** これは事前characterizationであり、未実装のRecipe workflowの合格結果ではない。

追加のread-only診断は既存IP testのfake factoryと実controllerをNode VMで使用。local file → capture → History IP Recipe → restoreで、復元previewがrevoke済みURLであることをassertした。unsupportedで `getSnapshot() === null` かつ内部captureのreference保持もassertした。**診断exit 0（問題の再現成功）**。実ブラウザでの画像decode/描画確認ではない。

## Full tests / Browser smoke

強制停止によりproduction実装なし。`npm.cmd run check`、full suite、Phase 21 Browser Smokeは未実施。Phase 20の708件という結果を今回の実行結果として扱わない。文書の相対リンク、差分、whitespaceを確認する。

## Remaining risk / Review

Astraの実装前設計判定で上記snapshot不足を確認。完成実装に対する統合architecture reviewは未実施で、重大findingなしとは報告しない。Recipe re-entry、古いruntime/undo完了、途中failureの安全性はPhase 21完了gateとして未達。Phase 21 module/interfaceは未作成。
