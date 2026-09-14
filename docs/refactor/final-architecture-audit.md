# Final Architecture / Repository Audit

監査日: 2026-09-07。担当: Astra。対象: `C:\AI\local-image-chat`、HEAD `32940730d94c827aa545a31c3862e664fd907c2e`。Phase 1–23完了後のworking treeを静的監査した。

## Final architecture summary

**Phase 1–23のbehavior-preserving frontend extractionはarchitecture上完了と判定する。全UIの無条件な差し替え準備完了、完全なview/controller分離、既存bugの解消までを意味しない。** Runtime、generation LoRA selection、catalog、Reference、Inpaint、IP、Recipe、Generation、Queue、History、Studio、Compare、Experimentの主要な更新責任は特定でき、重大な逆依存・同一mutable stateの競合ownerは今回の確認範囲で見つからなかった。

UI renovationはfeature単位で開始可能。Settings shellを最初のUI工事として推奨する。Galleryはfilter request raceを先に修正し、390px overflowを完成gateに含める。全画面を止めるBLOCKERは確認していない。次の1作業としては、既知の誤表示を切り離す **Gallery filter request raceだけのbug fix** を推奨する。いずれも今後の提案であり、本Auditでは実装しない。

正本は [current-state](../implementation/current-state.md)、[decisions](../implementation/decisions.md)、現コードと対象test。UI工程の作業境界は [UI renovation boundaries](ui-renovation-boundaries.md)、見た目の既定基準は [DESIGN](../../DESIGN.md) を使う。全面刷新という将来目的だけで、現DESIGNの配色・画像配送・操作規則を撤廃しない。変更するデザイン基準はUI taskで明示する。

```text
index.html + style.css
  → app.js: DOM/form owners + dependency composition + workflow adapters
      → feature controllers: domain state / operations / current rendering
      → app/bootstrap.js: startup order / page lifecycle
      → core/preferences.js: app-owned persistence encoding
feature → own view/helper + explicit ports → other owner
HTTP client → existing legacy/API v1 → backend services / JobManager / storage / providers
```

## Audit scope / evidence

読了・参照した入口: [AGENTS](../../AGENTS.md)、current-state、decisions、[inventory](repository-inventory.md)、[file disposition](file-disposition.md)、[target architecture](target-architecture.md)、[surgery plan](surgery-plan.md)、[Phase 17](../implementation/frontend-refactor-phase17.md)、[Phase 21](../implementation/frontend-refactor-phase21.md)、[Phase 22](../implementation/frontend-refactor-phase22.md)、[Phase 23](../implementation/frontend-refactor-phase23.md)、[package](../../package.json)。追加探索はapp symbol/caller、public feature/helper import、対象test、GalleryのPhase 2/11/14記録、static/updaterの該当箇所に限定した。

独立したowner群、UI/History群、import/path/配信群をread-only subagentへ委譲し、Astraがappの残存責務・危険境界・最終分類を統合確認した。巨大appは宣言一覧と対象rangeを読み、全file全文を前提にしなかった。表中のsymbolを再検索の入口とし、行番号は変更後の恒久IDとしない。

今回の証拠は**現在コードの静的確認**と**明示した過去の検証記録**。test/check/full suite、browser、実provider、実機、実送信、update applyは今回実行していない。Phase 23の最終fullは記録上779 total / 777 passed / 0 failed / 2 skips、Chrome fixture完走PASS。title fallbackの最終補正後はaffected/check/fullで確認され、browserの再実行はなかった。この履歴を今回のlive検証とは扱わない。

## Audit A — app.js responsibility assessment

現在 [public/app.js](../../public/app.js) は4,352行、top-level named function 222個。行数は今回の計測。**正当なcompositionに加え、大きなフォーム・presentation実装が残る混成ファイル**である。「全4,352行が単なる配線」ではない一方、旧来の全feature state/workflowを抱える神ファイルへ戻ったとも判定しない。抽出完了の基準は行数ではなく更新責任とtransaction/lifetimeの所在。

分類は責務単位で重なり得る。たとえばrender名の関数でもフォーム同期が含まれるため、その全体を自由なviewとはみなさない。

| 分類 | 現在のsymbol / 領域 | 評価・今後の扱い |
| --- | --- | --- |
| COMPOSITION ROOT | imports、elements、各create* factory、preConfigControllers、controllerInitOrder、createAppBootstrap、Runtime/Recipe/Generationへのport構成 | 正当。DOM subset・callback・transportをここで接続する。featureからappへimportしない。factory wiringだけのために別階層や中央storeを増やす必要なし |
| FORM ADAPTER | readSettings/readPromptPayload/readTitlePayload、read/writeStructuredSections、positivePromptSources/writePromptSource、setPromptFields、Raw override、generationMode、trigger frames、Prompt clear/undo、設定summary | DOM値は現フォーム正本。coordinatorは選択/タグを所有し、Raw/Structured優先順位までは所有しない。UI移植ではこのadapterが実装入口になる |
| PERSISTENCE BRIDGE | loraWeights/triggers/negative/profile/preset/addon/outfit/checkpointProfile maps、saveLora*、saveProfileSettings、setRecipeAwareStorage、title/img2img/Prompt部品restore | preferencesはserialization ownerであってdomain storeではない。cached default weightと実効selected weightは別。Recipe中の保存例外分類と順序を保持する |
| LEGITIMATE WORKFLOW BRIDGE | captureRuntimeState/restoreRuntimeState/finalizeRuntimeStateRestore、captureFormState/restoreFormState、ensureRuntimeForRecipeDirect、applyRecipe*、loadRecipeFields、composition lock、same-seed/duplicate/LoRA/instruction派生準備、readDerivationPayload、loadHistory/loadLoras/loadStudioRecent | 異なるownerの順序・フォーム準備・境界変換。Runtime/Recipe/Generationのtransaction本体は各controllerにある。実callerを持つ薄いwrapperを行数だけで削除しない |
| EXTRACTION CANDIDATE | openPresetPicker（3328行付近からの長いmodal view）、renderUsedLoras、trigger panel/row、AI Prompt import preview、Promptフォームの表示群、checkHealthとRuntime表示 | picker/viewやPromptフォームを改築する際に、その対象だけ局所化する価値がある。全app再解体をUI前提にしない。checkHealthはfallbackと再loadを伴い、単なるstatus renderとは違う |
| DEAD BRIDGE | openCharacterPicker / openOutfitPicker（3665/3692行付近） | public/src/test検索では各宣言以外の参照なし。module scope、exportなし。現「LoRA追加」はloraLibrary.openPickerへ接続。**現repository配線上の未接続入口**と分類し、削除はしない。外部harness/将来意図を含む完全な削除認定ではない |

重要な副作用:

- `renderSelectedLoraSummary()` は `ensureSelectedLoraOutfits()`、trigger同期、Raw mirror等につながる。viewの再render回数を増やすだけでも保存/フォーム更新に影響し得る。
- `readSelectedLoras()` は最初に `syncFromPrompt()` を呼ぶ。pure selectorとしてrender loopで再利用しない。
- `readDerivationPayload()` は読み取り時にpendingを消費する。preview、Experiment、button enable判定に使わない。
- `changeLoraOnly()` のdialog内working Mapは一時編集値であり第二のselection ownerではない。cancel時pending保持は現仕様。
- `setupClearableField()` の静的listenerは直接addEventListenerされ、bootstrapのlisten registry外。dynamic row/modalにも局所listenerがある。現one-shot startupで二重登録は確認していないが、任意remountを安全にする包括的dispose contractは未成立。

## Audit B — Owner map

State ownerは「全データを1moduleへ集約する」という意味ではない。backendの保存正本、frontendの操作state、DOM値、projectionを区別する。下表のpublic interfaceは今回確認した代表的な正式portであり、全exportの複製ではない。consumerの接続は原則app経由。

| Domain / state owner | Public interface | Consumers | Forbidden direct access | Remaining coupling |
| --- | --- | --- | --- | --- |
| Runtime / Checkpoint — [runtime-controller](../../public/features/runtime-controller.js): selected/active Runtime・Checkpoint、catalog、switch promise/snapshot、health/catalog/selection tokens | configure, applyHealth, selectRuntime, loadCheckpoints, getState, waitForSwitch, runtimeRequestContext, isRuntimeContextCurrent、capability/payload queries | app、Checkpoint Sets、Library、Sampler、IP、Recipe、Generation | private token/switchSnapshotの操作、UI選択だけでproviderをactivate、query戻り値のmutation | appのexternal snapshotが複数ownerを束ねる。getState内の配列/objectはdeep copyではない |
| Checkpoint Sets — [checkpoint-sets](../../public/features/checkpoint-sets.js): sets・fingerprint・lifecycle。保存はbackend | load/render、CRUD/apply/applyAuto、markSettingsApplied、getState | Runtime選択callback、settings、Prompt/form ports | selected MapやPromptを直接書く、fingerprintをUI側へ複製 | form settingsとLoRA restoreはapp adapter。getStateのsetsは参照。summary同期不足は後述 |
| Prompt / LoRA selection — [prompt-lora-coordinator](../../public/features/prompt-lora-coordinator.js): selected/source/disabled、notice、debounce/guard。Raw/Structured/trigger framesはappフォームowner | getSelectedEntries/getSelectedNames/getSource/isDisabled、setSelected/setWeight/replaceSelection、syncFromPrompt/scheduleSync、captureState/restoreState、restoreCheckpointSelection/restoreRecipeSelection | Library操作、使用中一覧、profile/outfit、Checkpoint Sets、Recipe、Generation、Experiment | private Map/Set書込、別selected store、activeでないPromptを書換える新binding | appのprofile/cache/trigger/Raw優先規則へのcallbackが多い。queryはcopyを返す |
| LoRA Library — [lora-library](../../public/features/lora-library.js): installed catalog、folder/pin/category/root表示state・load tokens | load/render/getItems/findByName/setItems、openPicker、loadRoot/getRootInfo、metadata/favorite操作、getState/restoreState | app、coordinator catalog query、Runtime restore、Civitai reload、picker | selected/source/disabledの所有、catalog配列をconsumerが直接編集 | getItemsはlive array。controlsはappのprofile/cacheとselection portを使用。管理viewも同居 |
| Civitai — [civitai-controller](../../public/features/civitai-controller.js): inspection・folder/default/recent/favorite・request tokens、session token UI | inspect/install/loadFolders/getFolders、registration/preview操作、getState | Settings import UI、Library folder query、app | catalog/registry schema書換え、browserでlocalStorageへsecret保存、viewからinstall POSTを二重発行 | Library reload/root queryの明示port。getFoldersは参照配列 |
| Reference Image — [reference-image](../../public/features/reference-image.js): reference・object URL・file token・listener | loadFile/useImage/setReference/clear、hasReference/getReference、readPayload、captureSnapshot/restoreSnapshot、syncResolution/syncSelectedSize/setBusy | Generation、Recipe、Runtime form、img2img/Inpaint entry | object URLの外部revoke、独自FileReader state、画像byteをHistory schemaへ埋込 | generationModeとdimension DOMはapp。clear→Inpaint reset。Recipe restoreはsyncSize:false |
| Inpaint — [inpaint-editor](../../public/features/inpaint-editor.js): source/key・canvas mask・undo/redo・tool・async generation | setSource/reset/readPayload/hasMask、undo/redo、captureState/restoreState、loadPreferences/savePreferences/setBusy | Reference/mode adapter、Recipe rollback、Generation | canvas/undo stack/tokenの外部変更、view resizeでmask原寸を再定義 | canvas DOMとpointer座標がview依存。form内の設定DOMと保存portを共有 |
| IP-Adapter — [ip-adapter-controller](../../public/features/ip-adapter-controller.js): options・retained state・reference/object URL・file/runtime tokens | loadOptions/readPayload/applyMetadata/restoreRecipe、captureState/restoreState、syncUi | Runtime、Recipe、Generation、Studio | unsupported時に保存stateを消す、private token/URLを外部操作 | ReferenceのfileToDataUrl/inferImageMimeTypeをnamed importするがcontroller state共有ではない |
| Recipe — [recipe-workflow](../../public/features/recipe-workflow.js): requestVersion・直列queue・短命owner snapshots | load, ensureRuntime | History/Studio action、same-seed/duplicate/instruction、app | Runtime成功を後続失敗でrollback、他owner snapshotの独自再構築、submit/one-shot consume | header/settings/cache/renderはapp form port。Reference snapshotはform側にも含まれ復元が重なるが順序を固定済み |
| Generation — [generation-controller](../../public/features/generation-controller.js): frontend operation予約・own activeJobId/version | generateCandidates, finishSelected, hiresFromGallery, buildPrompt, cancel, getState, isBusy | Generate/Studio/Gallery、busy/capability UI | 全Job queueの第二owner、フォーム再読込でrecovery再構築、await後に排他を開始 | 多数のform reader/UI callback。派生pendingとcomposition lockはapp、resultはStudio |
| Queue — [queue-controller](../../public/features/queue-controller.js): queue snapshot・polling/panel・seen terminal・lifecycle | init/dispose, refresh, startPolling、panel操作 | bootstrap、Generation、Experiment、Queue view | view切替でpoll停止/cancel、第二全Job poller | terminal時History refreshはGeneration成功refreshと併存。snapshotはserver queueの投影 |
| History / Gallery — [history-controller](../../public/features/history-controller.js): generations/entries・cursor/hasMore/loading/total・filter/sort/tagQuery。永続正本はbackend History | load/loadMore/loadStudioRecent/render、setFilter/resetFilter/openFilterDialog/openDetail、getGenerations/getEntries/getState | navigation、Studio、Compare、Experiment、Generation、image-state | cache/cursor配列のconsumer mutation、選択/Favorite/Experiment state再所有、view直接fetch | retrievalとcards/detail/filter UI同居。queryがlive array。Gallery filter raceとStudio recent response raceが別々にある |
| Studio — [studio-controller](../../public/features/studio-controller.js): candidates/selected/final/inspection/historyFilter・表示timer | setCandidates/selectCandidate/presentFinal/inspect、renderRecent、syncOutputStats/updateGenerationState、getSelectedCandidate/getLastGeneration/getFinalImage | Generation、History result、image-state、Compare、app | Gallery cacheを新設、busy projectionを生成予約の正本にする | form readerとaction callback、DOM/imageModal。result queryも読取専用で扱う |
| Compare — [comparison-controller](../../public/features/comparison-controller.js): selection Map・galleryMode | toggle/clear/sync/setGalleryMode/openEntries、getSelection/isSelected、init/dispose | History cards、Studio shortcut、Experiment比較、app | 外部selection Map操作、History削除結果を別schemaで管理 | compare-view、document全体のdata-compare-image-id/historyCompareCheck同期、Studio query、History reload/vote callbacks。2–4枚/ID normalization |
| Experiment — [experiment-controller](../../public/features/experiment-controller.js): experiments/parameters/limits・activeId/poll・entryCache。永続runはbackend | load/run/poll/cancel、renderCards/openDetail/openResult、ensureEntries/compare、getExperiments/getActiveExperimentId | Compare画面、Queue result、app form、History callbacks | Generation予約/derivation consumeの流用、全queue/History cacheの再所有 | baseRequest projectionを自身で組立てる。Generationとはcount/seed/one-shotが異なる正当な別workflow |
| Image Favorite / notification — [image-state](../../public/features/image-state.js): imageFavorites・Discord 2 maps・channel別watcher Sets | toggleFavorite/getFavorite/resolveImageFavorite、remember/apply state、badge factories/render、bindPresentation、init/dispose | History、Studio、Experiment、final image | LoRA favoriteと統合、各view独自watcher/send state、既存ID+channel dedupeを迂回する監視 | document全体のdata selectorで同IDを更新。disposeはfinal button listenerのみでwatcher継続guardなし |
| Settings — [settings-navigation](../../public/features/settings-navigation.js)のcategory/search、[settings-discord](../../public/features/settings-discord.js)、[settings-storage](../../public/features/settings-storage.js)、[settings-update](../../public/features/settings-update.js)、[ai-share](../../public/features/ai-share.js)、[sampler-picker](../../public/features/sampler-picker.js)がdomain別owner | navigation activate/init/dispose、各settings load/save/check等、update restoreSessionSecret/loadVersionContract、Sampler loadOptions/syncLabels、AI-share loadShareState/loadPromptTemplate/scheduleShareCsvSync | Settings shell、Runtime/Sampler接続、Prompt部品、bootstrap | shell独自のsettings store、raw secret保存、storage migration/updateのview直接実行 | General設定DOM・profile/title/Promptはapp。Settingsは単一巨大controllerへ統合しない |
| Persistence — [core/preferences](../../public/core/preferences.js)がapp-owned key/encoding、各featureが自key、backendが永続domain data | get/set/readJson/readStringMap/readLoraWeights/readLoraTriggers/readLoraOutfits/writeMap、title/session methods | app adapters、settings-update。他featureへstorage port注入 | UIからkey/version変更・二重保存・全storage atomic rollback、tokenのlocalStorage移行 | form Mapの所有はapp。preferencesはstate storeではなくserializer。PROFILE_STORAGE_VERSION=3 |
| Bootstrap — [app/bootstrap](../../public/app/bootstrap.js)がstart Promise/listener registry/page dispose、appが順序と依存一覧 | createAppBootstrap→start/dispose、registerServiceWorker | appのみ | featureで全app再起動、view disposeをJob cancelに接続、bootstrap global async token | one-shot初期DOM lookup、直接listenerの残存。任意unmount/remount frameworkのlifecycleではない |

**単一ownerは規約と現consumer実装によって成立している。完全なread-only APIによって強制されてはいない。** Runtime、Library、Checkpoint Sets、Civitai、History、Studio等のquery結果に内部配列/object参照が残る。現consumerの不正mutationは見つからないが、UI側ではread-only扱いとし、編集には明示portを使う。防御copy導入は別の狭い改善候補であり、無条件なdeep cloneは要求しない。

## Audit C — Dependency assessment

| 検査 | 結果 / 判断 |
| --- | --- |
| feature → app.js import | public JavaScriptのstatic import scanで0。static module cycleも未検出 |
| feature → 他feature internal state | major violationは未検出。IP→Referenceは共有file/MIME helperのnamed importのみ。controller instance/private stateへの侵入ではない |
| duplicated Map/Set/state | selected/source/disabled、Compare selection、queue等の重複ownerなし。weight cache≠selected weight、Library folder expansion≠modal-local expansion、Recipe snapshot≠永続owner、Experiment entryCache≠Gallery paging cache |
| duplicate polling | Queueのbootstrap/Generation/ExperimentからのstartPollingは単一guardへ合流。active own Job、全Queue、Experiment、Discord 2 channelは別用途。image-stateはchannel+IDでdedupするがdispose後guardは不足 |
| duplicate persistence | 同一keyに競合する新ownerは未検出。Recipe prefix保存、catalog defaults/migration、profile保存はappの明示portへ残る。render経由の既存保存副作用をpure化しない |
| duplicate listener | controller init guard・listener解除あり。重複登録の重大例は未検出。ただしapp clearable listenerはregistry外であり、任意remount保証なし |
| duplicate async generation token | Runtime context、Recipe supersession、Reference file、Inpaint decode、Generation operation/Job、Queue lifecycleは異なる寿命を守る。中央tokenへの統合は不適切。Historyの不足は下記bug |
| 他owner schema再定義 | major violationは未検出。Generation/Experiment/Hiresのrequest projectionは異なる仕様。Recipeはowner snapshotをopaqueに扱う。appのDOM設定key列挙・snapshot adapterは重複パターンとして残る |
| redundant refresh | Queue terminalとGeneration completionのHistory refresh、初回空HistoryでGallery入場時再fetch、health fallbackのcatalog再loadは既存意味。二重poll所有と混同しない |

## Audit D — UI renovation contract

UI変更で許すのはDOM構造、render/CSS、view内一時表示state、accessibility、responsive、focus/scroll/interaction presentation。controller file内でも**表示関数だけ**なら対象になり得る。file全体をUI専用とみなさない。

DOM ID/class/data selectorを変える場合、elements注入・event delegation・source assertionも対象featureの差分で追従する。form値を別storeに複製しない。controllerが捕捉したDOMを無断でreplaceしない。必要ならそのfeatureだけ明示rebind/dispose設計を先に固める。

原則変更禁止: API v1/MCPと使用中legacy API、History schema/画像単位cursor/merge、JobManagerとrecovery、Forge Neo activation、Runtime IDs `reforge`/`forge-neo-anima`・checkpoint public ID、storage schema/key/version/migration、secretの保存範囲、image URL/security/cache、PWA/updateの配信契約。UI taskでの原則であり、独立して承認されたbug fixやcontract変更taskを永久に禁止するものではない。

特にPhase 17のRaw優先・UI追加時tag非挿入・既存tag weight更新・disabled保持、Phase 21のRuntime成功commit/非Runtime rollback順/`syncSize:false`/保存prefix、Phase 22のawait前予約/IP後settings前consume/承認付き確定request再送1回/Experiment非consumeを維持する。Recipeは現在checkpoint/source/maskを適用しない。新UIの「復元」表記だけで機能を拡張しない。

## Audit E — Feature UI renovation readiness

READYは安定interfaceを保つ表示工事を開始可能、READY WITH CONSTRAINTSは既存owner/adapters/lifetimeを保つ条件付き、NOT READYは関連correctness前提の解消が先、を意味する。現デザインの完成品質や実機検証済みという意味ではない。

| Feature | 判定 | UIだけ新築可能か / prerequisite | 変更禁止contract / browser重点 |
| --- | --- | --- | --- |
| Generate / Studio | READY WITH CONSTRAINTS | 可能。form adaptersと結果viewを分け、既存DOM ownerを1つにする。Checkpoint Set summary整合は関連表示工事前に修正 | Generation one-shot、Recipe、candidate/seed/lock。生成中遷移・連打・cancel・recovery・選択/Hires・summary |
| LoRA picker | READY WITH CONSTRAINTS | 可能。現Library openPicker→app openPresetPicker接続を入口にする | selection/source/disabled、Raw/Structured、tag非対称性。search/folder/weight/disabled/Raw/keyboard |
| LoRA management | READY WITH CONSTRAINTS | 可能。catalog/persistence controlsと管理renderを分ける | registry identity/default優先/metadata/install/move。長い名称・reload中Runtime・favorite・編集失敗 |
| Gallery | NOT READY | filter request raceを先に別fix。overflowはGallery UI着手前または最初のlayout工事で解消 | paging/merge/Favorite/thumbnail intent。遅延応答・filter連打・append・390px・長いラベル |
| Compare | READY WITH CONSTRAINTS | 可能。既存selection ownerとcompare selector contractを保持 | 2–4枚/ID/vote。追加・解除・削除連携・tray/mobile・modal focus |
| Experiments | READY WITH CONSTRAINTS | 可能。run/baseRequest/pollを維持しcards/progress/detailだけ変更 | count=1、seed、cancel/recovery、pending非消費。遷移中poll・同時run・結果比較 |
| Settings shell | READY | category/search/layout単位で可能。domain保存処理は既存port利用 | 各domain save、session secret、migration/update。検索→category→details/focus、390pxカテゴリselect |
| img2img | READY WITH CONSTRAINTS | 可能。Reference/mode/dimension adapterとURL寿命を保持 | size sync、reference payload、mode capability。upload/drop/clear/遅いfile・遷移 |
| Inpaint | READY WITH CONSTRAINTS | 可能。canvas表示寸法とmask実寸/座標を分離 | source/key、mask/undo、decode freshness、Recipe rollback。touch/scroll・DPR/resize・undo/reset |
| IP-Adapter | READY WITH CONSTRAINTS | 可能。controller reference/metadata/capability stateを再利用 | unsupported保持+payload省略、URL release。Runtime往復・file競合・Recipe/生成 |

詳細なAllowed/Required/Forbidden/Testsは [feature boundaries](ui-renovation-boundaries.md) を正本とする。

## Audits F / H — Remaining debt and pre-UI bugs

以下の分類は作業順。静的リスクを実browser再現済みと偽らない。**全featureを停止するBLOCKERは今回未検出。**

| ID / debt | 証拠と影響 | 優先度 / 対応条件 |
| --- | --- | --- |
| H1 Gallery filter request race | history-controller loadはloading時returnし、応答を無条件commit。setFilterのFavorite/rating変更はresetPaging→loadだがin-flight時に捨てられる。旧dataset/cursorが新filter下へ入り、最新要求が再発行されない。Phase 11で既知、現在コードでも確認 | FIX BEFORE RELATED UI。GalleryをNOT READYにする局所blocker。最新filterの結果とcursorだけcommitするbehavior testを先に固定し、別fix。全Settings/UI着手は妨げない |
| H2 390px Gallery overflow | [Phase 2](../implementation/frontend-refactor-phase2.md)では390×844/scrollWidth422を旧Chrome fixtureで計測。現在CSSのmobile toolbar 2列、quick filter min-width74px、rating 4buttonが狭いcellへ入る構造が残る。現在browser値は未計測 | FIX BEFORE RELATED UI。Gallery responsive完成前に必須。独立小fixまたは最初のGallery layout工事で解消可。body overflow:hiddenで操作を隠すだけにしない |
| H3 Studio recent response race | history-controller loadStudioRecentはfilterに応じてGET後、freshness判定なしでonStudioRecentDataへ渡す。遅い旧favorite/all応答が新表示を上書き可能 | FIX BEFORE RELATED UI。Studio recent改築前に対象testで再現・修正。H1とは別request経路で、H1修正だけで解決したとしない |
| H4 Checkpoint Set summary/stats stale | app applyCheckpointSetSettingsはDOM値更新→syncSamplerLabelsだけ。Phase 17 browserで実フォームとcollapsed summary/Studio statsの不一致を観測。現在接続でもsummary/stats同期なし | FIX BEFORE RELATED UI。Generate/Checkpoint Set summary工事前。フォーム適用semanticsを変えず表示同期を確認 |
| H5 notification watcher disposal | image-state disposeはfinal favorite listener解除のみ。watchDiscordSend/watchDiscordGenerationSendのsleep/GET後にdisposed/lifecycle guardなし | CAN WAIT（現page-lifetime owner維持時）。notification ownerのdispose/remountを導入するUI taskではFIX BEFORE RELATED UIへ繰上げ。navigationで監視停止する修正は不可。現在の重複poll bugとは認定しない |
| H6 direct listeners / remount assumptions | app setupClearableFieldのlistenerがbootstrap registry外。DOM cache、controller element captures、beforeunload登録は一度のpage起動向け | CAN WAIT。全app再mountやhot swapのprerequisiteとしては未解決。対象DOMを作り直すtaskでlistener所有を明示 |
| D1 source/path-sensitive tests | [prompt-lora form characterization](../../test/prompt-lora-form-characterization.test.js)はapp関数をsource抽出/VM評価。[ui](../../test/ui.test.js)、[ui-shell](../../test/ui-shell.test.js)、[layout-overflow](../../test/layout-overflow.test.js)、[pwa](../../test/pwa.test.js)、[recipe runtime boundary](../../test/recipe-runtime-boundary.test.js)等がpath/ID/source依存 | CAN WAIT。触るfeatureのassertだけbehaviorへ適切に追従。全面test整理をUI前提にしない。URL/secret/contract assertionは残す |
| D2 stale docs | Phase 2のinventory/disposition/target/surgeryは歴史的baseline。app9939行/public JS24/test53/次Phase3、check既存9file漏れ等は現在値ではない。9漏れはPhase23/packageで解消済み。Phase17/22の「後続未着手」も当時状態 | CAN WAIT。旧文書を今回書換えず、このAuditとcurrent-stateへ現在判断を集約。Phase19のasync undo懸念は後続Phase20.5/21のguardで更新されており未修正bugとして再掲しない |
| D3 giant controller候補 | 今回計測: Library1073、History749、Experiment589、Civitai535、IP529、Inpaint475行。index1250/CSS3584行 | CAN WAIT。高いview/operation混在を対象UI工事で局所化。長さのみでは再分割しない。Historyのraceは長さと別のcorrectness問題 |
| D4 callback量 / repeated adapters | app createGenerationControllerのform/owners/ui、Library controls、Runtime external snapshot、Recipe form ports。設定key列挙、read/save/render adapterの反復 | CAN WAIT。callbackは隠れたglobal dependencyより明示的。対象featureでcohesive portのまとまりを維持し、巨大appContext/汎用event busを導入しない |
| D5 remaining/dead app bridges | 正当bridgeと副作用renderはAudit A。旧Character/Outfit入口2件は未接続 | CAN WAIT。将来確認後の独立cleanup候補。全app解体・未使用推測での削除をUI前提にしない |
| D6 defensive-copy不統一 | Runtime/Library/History等が参照を返す。現consumerの外部mutationは未検出 | CAN WAIT。UIにはread-only query契約を明示。必要箇所だけcopy/command設計を別taskで検討 |
| D7 ignored fixture運用 | [.gitignore](../../.gitignore)でworkbench全体ignore、git ls-files workbenchは空。Phase23等のsmoke harnessはclean checkoutに含まれない | FIX BEFORE RELATED UIの再現準備。最初の該当browser工事で必要fixtureの起動手順/最小経路を再現可能にする。tracked fixture化は別scope判断。local成果物は保持 |
| D8 redundant fetch | 空History初回・fallback・Queue terminal/Generation双方refresh | CAN WAIT。測定上の問題が出た場合だけ検討。H1の最新要求喪失を「dedup」と正当化しない |
| D9 physical relocation | helpers/controller/viewをpublic内co-locateする余地。src/frontendへの移動利益は未計測 | CAN WAIT。Audit G参照 |

## Audit G — Physical relocation recommendation

**第一推奨は現public/featuresとnative ESM/static配信を維持し、UI工程を先に進める。src/frontendへの全移動もbuild導入も先行しない。**

現在 [server](../../src/server.js) のexpress.staticはroot/public、[index](../../public/index.html) のmodule entryは/app.js。[updater](../../src/updater.js)のUPDATE_PATHSはpublic/src/testを含む。[SW](../../public/sw.js)はactivate時cache削除・fetch pass-throughで、現precache manifestは存在しない。[settings-update](../../public/features/settings-update.js)は/version.jsonをno-cache取得する。新build directoryは自動で更新対象にならない。

| 選択肢 | 実利 / 必要な変更 | 推奨 |
| --- | --- | --- |
| 現配置維持 | 抽出で既にowner単位の探索が可能。URL、ESM、updaterの変更を不要にする | 今の第一推奨 |
| public内のfeature co-location | helper/view/CSSの局所性改善。relative import/check列挙/source testは追従必要。fileを動かすだけではform couplingは減らない | 対象featureで探索負荷が実証された時、move-only別差分 |
| src/frontendを専用static rootとして公開 | buildは理論上不要。ただしExpress root、entry/assets、Node shared helper、配信/更新/rollbackの設計変更 | UI前は不要。src全体を公開しない |
| src/frontendからpublicへcopy | source/output分離。二重正本、未copyの古いasset、起動/配布/clean手順が増える | 現状では利益不足 |
| bundle/build output | module request数/load時間・最適化・配布要件が測定上必要なら利益 | 未測定なので導入しない。新deps/scripts/static/updater/PWA gateが必要 |

`structured-prompt.js`、`lora-tags.js`、`history-title.js`はNode側consumerも持つ。frontend-only pathへ移す前に共有とbrowser配信を設計する。manifest scope/start、/sw.js登録、icons/version、旧pageのmodule graph、更新失敗時rollbackを独立gateにする。

AI coding context削減の主要因はowner/portの成立であり、`public`を`src/frontend`と改名することではない。次の改善余地は対象view/CSS/adapterを局所的に読めるようにすること。token削減率や起動高速化の実測は今回ない。

## Audit I — Lean test strategy

1 feature / 1 reviewable差分を単位とする。新しい表示変更ごとにPhase 1–23の全scenarioを繰り返さない。current-stateの広い検査候補一覧は、毎回すべて再実行する指示ではなく、影響範囲を選ぶためのrisk inventoryとして扱う。

| Gate | 粒度 / 実施時点 |
| --- | --- |
| Per-feature focused | 変更中は対象controller/helper/source契約だけ。bug fixは旧不正挙動を再現するtest→修正→affected tests。UI view変更ではDOM接続/重要操作に絞り、実装を写したtestを増やさない |
| Browser smoke | featureの統合後に1つのcomplete sequence。正常経路+主要失敗/非同期経路+入退場。未操作の全featureを追加しない。fixture失敗とproduction失敗を分ける |
| Full suite / check | repositoryの実装completion gateに従い、最終production差分確定後にnpm.cmd run checkとnpm.cmd testを各1回。frontendのみでもこのgateは省略しない。green後の再実行はproduction/test変更・新failure・未解決懸念に限る |
| Visual / responsive | 改築した画面で1366×768 100%/125%、390pxを基本とし、共通grid/breakpointに触れた時はDESIGNの1920/2560/430px・Safari関連条件を追加。long labels、empty/populated/error、modal/focus、横overflowを確認。CSS regexは実layout検証の代替ではない |
| Integration escalation | Runtime/Recipe/Generation/Canvas横断なら関係ownerのfocused testsと境界scenarioを追加。page lifetime/static配信を変えるならbootstrap/PWA/updater/起動を追加。全組合せを常設gateにしない |
| Final multi-feature release | 一連のUI工事の最後に主要journey/共通shell/実機を一度横断確認。各小taskで全journeyを反復しない。実provider/実送信/実updateは独立した実行範囲 |

browser fixtureはループバックで開始/終了し、scenarioと期待request数を記録する。実機未確認ならその限界を明記する。documentation-only taskはlinks/path/scope/whitespaceだけでよく、今回suiteを走らせないのはこの区分による。

## Project readiness / next decision

| 質問 | 判定 |
| --- | --- |
| 1. Phase 1–23 architecture完了か | Yes。主要feature ownerとtransaction境界の抽出完了。view完全分離や既存bug全解消の判定ではない |
| 2. UI新築を始めてよいか | Yes、feature単位。Settings shellを先行可。Gallery等は局所prerequisiteを守る |
| 3. blocking bugはあるか | 全体BLOCKERなし。Gallery raceはGalleryの局所blocker。390px overflowはGallery responsive完成前必須。Studio recent/Checkpoint summaryは関連UI前fix |
| 4. app.jsをさらに解体すべきか | 全面解体を先行しない。対象UIでpicker/Prompt view/adapterを局所化する時に判断 |
| 5. physical relocationを先にすべきか | No。現public配信とfeature配置を維持 |
| 6. build systemを導入すべきか | No。現時点で利益の測定根拠なし |
| 7. 最初のUI feature | Settings navigation/category/search shell。LoRA管理・Civitai・storage/update operationまで同時刷新しない |
| 8. Astraの価値 | UI境界設計、共通form owner/lifecycle変更、Runtime/Prompt/Recipe/Generation横断、Canvas restore、static/update変更、substantial change最終review |
| 9. Solへ任せる工程 | 承認済み境界に沿ったfeature view/DOM/CSS/adapter接続、Gallery race等の中規模fix、focused regression。小CSS/単純shellはTerra、検索/testログはLuna |
| 10. 推奨次の1作業 | Gallery filter request raceの独立bug fix。Favorite/rating切替中の旧応答、append/reset、失敗後最新要求を対象とし、UI redesign/relocationを混ぜない。Studio recent raceは自動で同時修正しない |

## Document-only validation

今回作成したのは本書と[UI renovation boundaries](ui-renovation-boundaries.md)だけ。ユーザーが新Audit文書以外の新規変更を禁止したため、通常のAGENTS引継ぎ更新より今回の明示scopeを優先し、current-state/decisionsを含む既存文書は変更しない。

2026-09-07の文書検証: 2文書のlocal link 143件はすべて参照先が存在し、独立whitespace検査もerror 0。git diff --checkはexit 0。新規文書のgit diff --no-index --checkもwhitespace errorなし（exit 1はNULとの新規内容差分によるもので、whitespace失敗ではない）。既存LF/CRLF warningは変換予告であり失敗ではない。新規2文書を除くporcelain statusと既存2文書のbinary diffは開始時と一致し、tracked fileのSHA-256一覧も一致した。新規2文書はuntrackedのため通常のgit diffには出ない点を考慮して個別検査した。

既存dirtyのdocs/CURRENT_TASK.md、docs/REVIEW_FIXES.md、未追跡研究文書・画像・output/scripts等を保持した。production/test/package/storage/UIの変更、move/delete/rename、commit/pushは行っていない。
