# Frontend Refactor Phase 20 — IP-Adapter Controller

2026-09-07。Phase 19完了時点からPhase 20のみ。既存dirty差分を保持し、commit/pushなし。

## Changed

- `public/features/ip-adapter-controller.js` を追加し、options/model metadata、availability、enable、weight/guidance、IP固有reference、preview/object URL、async guard、UI、runtime/recipe snapshot、payload read、listener lifecycleを抽出した。
- `public/app.js` は **4,909 → 4,603行（306行減）**。IP-Adapterのmutable stateとlistenerを削除し、Runtime/Studio/generation/recipeをcontroller portへ置換した。
- `test/ip-adapter-controller.test.js` を追加。既存 `test/server-integration.test.js` のfrontend ownership assertionとPhase 18のsource assertionを新module境界へ追従させ、`package.json`の`precheck`へ登録した。
- 現UIにmodel selector/catalog選択は存在せず、options APIの固定 `module` / `model` 表示を正本として維持した。HTML/CSS、backend/API/storage schemaは変更していない。

## Ownership

- IP options/model metadata、enabled、weight、guidance start/end、IP固有reference identity/Data URL/public URL、preview、object URLの単一ownerは `ip-adapter-controller`。
- Runtime stateは所有しない。`runtimeSupports("ipAdapter")`、request context/current判定、runtime API URL、switching queryだけを毎回読む。label文字列による判定はない。
- options取得はRuntime context guardに加えてcontroller request tokenを持ち、同じRuntime/context内で逆順完了した古い応答も破棄する。local fileも独立したload世代guardを持ち、古い選択またはdispose後に完了した読込はstateへ反映せず、作成済みの不要URLをrevokeする。
- Phase 18 Reference ImageとはMIME/FileReader helperだけを共有する。img2img/inpaint sourceとIP referenceは意味・preview・payloadが異なるためstateを統合しない。History/reference assetは公開ID portでIP referenceへ接続する。
- local preview object URLはreplacement/clear/disposeでrevokeする。同じsourceへ別object URLを渡した場合は既存previewを保持し、余分なURLだけrevokeする。

## Interface

- Runtime/options: `loadOptions(context)`, `isAvailable()`, `getOptions()`, `syncUi()`。
- Reference/edit: `loadFile(file)`, `setReference(reference, options)`, `setCurrentImageAsReference(image, options)`, `clearReference(options)`, `toggleEnabled()`, `syncNumbers()`。
- Runtime rollback: `captureState()`, `restoreState(snapshot, options)`。
- Recipe narrow port: `getSnapshot()`, `restoreSnapshot(snapshot)`, `restoreRecipe(recipe)`。workflow順序や永続化は実装しない。
- Result metadata/payload: `applyMetadata(value)`, `readPayload()`。
- Lifecycle: `init()`, `dispose()`。

## Gate

- Phase単体実装時の `node --test test/ip-adapter-controller.test.js test/runtime-controller.test.js test/reference-image.test.js`: **27 passed / 0 failed / 0 skipped**、exit 0。`node --test --test-name-pattern="Task 10のUI契約" test/server-integration.test.js`: **1 passed / 0 failed / 0 skipped**、exit 0。
- architecture review修正後の最終focused `node --test test/reference-image.test.js test/inpaint-editor.test.js test/ip-adapter-controller.test.js`: **28 passed / 0 failed**。
- 最終 `npm.cmd run check`: **exit 0**。最終 `npm.cmd test`: **708 total / 706 passed / 0 failed / 2 existing skips**、exit 0、11.838s。
- mock fixtureのBrowser Smokeは最終treeで1回実施。ReForge固定model表示、History reference、enable、weight/guidance 0.80/0.10/0.90、captured mock job payloadを確認した。Forge Neoではunsupported/disabled/payload除外、ReForge復帰後はreference/parameterを保持しつつOFFのままで、明示的な再enable後だけpayloadへ復帰した。
- 同じsmokeでconsole error/warn 0、injected error/unhandled beacon 0。実generation/providerは未実施。Astra architecture reviewは1回で、pending file readのreplacement/dispose raceを修正後、残るP0/P1/major findingなし。

## Remaining risk

- local FileReader/preview、ReForge→Forge Neo→ReForge切替、History reference、Studio操作からのmock job payloadはBrowser Smokeで確認済み。実options providerと実generationは未確認。
- unsupported Runtimeまたはoptions unavailableになった時点でenabledをfalseにし、対応Runtimeへ戻っても自動再enableしない既存挙動を維持した。referenceとparameterは保持する。
- Weight 0–2、guidance 0–1の入力制約は既存HTML rangeが担う。controllerは既存どおりDOM/recipe値をNumber化し、backend contractの追加validationやclampは行わない。
- Runtime rollback snapshot内のblob preview ownershipは既存経路を継承し、URL寿命をcontrollerだけでは完全に保証しない。
- Recipe用portは現在のIP fieldだけを扱う。Recipe apply順、Runtime選択、Reference/Inpaintとのworkflow orchestrationはPhase 21へ残し、未着手。
