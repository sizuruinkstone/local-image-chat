# UI Renovation Boundaries

基準日: 2026-09-07、Phase 1–23完了、HEAD `32940730d94c827aa545a31c3862e664fd907c2e`。担当: Astra。これは将来のUI taskを切るための契約書であり、UI/production/testの変更許可ではない。

architectureの判断、owner map、既知bug、移動/buildの比較は [Final architecture audit](final-architecture-audit.md) を参照する。実装時の入口は [AGENTS](../../AGENTS.md) → [current-state](../implementation/current-state.md) → 本書の対象feature → 対象controller/test。継続contractは [decisions](../implementation/decisions.md)、見た目の既定基準は [DESIGN](../../DESIGN.md)。Phase 2時点のsurgery計画を現在の未完了task一覧として実行しない。

## 共通契約とReadinessの意味

**UIの新築は可能。ただし既存state ownerを残してviewとDOM adapterを改築する。** 新しいフォームstore、全体event bus、feature→app.js import、provider直結、同一domainの第二controllerを作らない。各controllerは現在render/DOMも含むため、controller fileという理由だけで変更不可ではないが、UI taskで操作順・保存・pollingまで変更してよいわけでもない。

- **READY**: 現interfaceのままfeatureの表示工事を開始できる。
- **READY WITH CONSTRAINTS**: 指定adapter/state/lifetimeと関連bug前提を守れば開始できる。動的remountまで保証しない。
- **NOT READY**: 関連correctness bugを先に別taskで直す。全projectの停止を意味しない。

Allowed changes共通: DOM構造、render関数、CSS、view内の開閉/search等の表示state、accessibility、responsive、操作の見せ方。ID/class/data selectorを変えるならDOM injection・event委譲・対象assertを同じfeature差分で追従する。現在のフォーム値の正本はDOM/app adapterであり、新旧hidden formを二重に持たない。controllerのelementsはfactory時に捕捉されるため、無断のreplaceChildren/remountは行わない。

Forbidden changes共通: API v1/MCP/使用中legacy routeのrequest/response、History schema・cursor/merge、JobManager/recovery、Forge Neo activation、storage schema/key/version/migration、Runtime ID/checkpoint ID、Recipe/Generation semantics、secretの保存場所、image URL/security/cache、PWA/update/static deliveryの変更。これらは独立したcontract変更taskで扱う。

現在のqueryはすべてimmutableではない。Runtime/Library/History等のgetState/getItems/getEntriesの戻り値は**read-only**として扱い、sort/splice/Map化後の元object書換えをしない。変更は公開command/restore portへ渡す。

一覧画像は [image-delivery](../../public/image-delivery.js) のthumbnail/lazy/cache方針を保持。原寸は明示的な選択・詳細・拡大時のみ。大きなbase64 JSON、cache bust query、一覧の原寸先読みをUI都合で追加しない。modalは [ui-kit](../../public/ui-kit.js) / [image-modal](../../public/features/image-modal.js) のfocus/Escape/closeを活用する。

各featureのRequired tests欄は**affected focused候補**であり、毎回全部を実行する指定ではない。共通completion gateは後段に定義する。

## 1. Generate / Studio

| 項目 | 境界 |
| --- | --- |
| Feature | Generate form、candidate選択、final result、inspection、Studio recent |
| UI owner/view | [app](../../public/app.js): elements、readSettings/readPromptPayload/readSelectedLoras、Raw/Structured/trigger/profile、composition lock、設定summary。[studio-controller](../../public/features/studio-controller.js): candidates/final/inspection/render。[index](../../public/index.html)、[style](../../public/style.css) |
| Allowed changes | 入力/結果layout、accordion、候補card、read-only metadata、progress/error、button presentation、focus/responsive。form adapterのDOM接続更新。viewを局所化する場合も副作用をそのまま保持 |
| Required controller interface | [generation-controller](../../public/features/generation-controller.js)のgenerateCandidates/finishSelected/hiresFromGallery/buildPrompt/cancel/isBusy。Studio setCandidates/selectCandidate/presentFinal/inspect/syncOutputStats/query。Prompt-LoRA/Recipe/Reference/Inpaint/IPの既存ports |
| Forbidden changes | 最初のawait前の予約、確定request再送1回、own JobとQueueの分離、derivation consume順、seed/count/lock、raw優先を変更しない。Studio busyは表示projectionで、第二のsubmit guardにしない |
| Regression risks | 連打/確認dialog中の二重POST、遅延cancel/hide、previewがone-shotを消費、view切替によるJob停止、DOM値とsummaryずれ。readSelectedLoras/renderSelectedLoraSummaryは副作用を持つ |
| Required tests | [generation-controller test](../../test/generation-controller.test.js)、[studio-controller test](../../test/studio-controller.test.js)、[prompt-lora form characterization](../../test/prompt-lora-form-characterization.test.js)。Recipe/Runtime接続を触る時だけ該当boundary testsを追加。browser: generate→navigate→completion→candidate→Hires、cancel/recovery各対象経路、横overflow/keyboard |
| Readiness | **READY WITH CONSTRAINTS**。Studio recentの遅延応答race、Checkpoint Set適用後summary/stats同期不足は各関連表示工事前に別fix。結果card等の独立presentationから着手可能 |

## 2. Prompt / LoRA picker

| 項目 | 境界 |
| --- | --- |
| Feature | generation用LoRA追加/使用中一覧、weight/disabled、Structured/Raw/trigger表示 |
| UI owner/view | [lora-library](../../public/features/lora-library.js) openPicker → app openPresetPicker。app renderUsedLoras、trigger panels、prompt mode/import view。[preset-catalog](../../public/preset-catalog.js)等を再利用 |
| Allowed changes | picker/modalのlayout、search/folder presentation、使用中card、weight control、trigger row、説明/aria。選択更新はcoordinatorへ委譲 |
| Required controller interface | [prompt-lora-coordinator](../../public/features/prompt-lora-coordinator.js)のgetSelectedEntries/getSource/isDisabled、setSelected/setWeight/toggleDisabled、syncFromPrompt/scheduleSync等。Library getItems/findByName/openPicker、app active Prompt read/write・profile/outfit ports |
| Forbidden changes | UI追加はtagを挿入しない、weight変更は規定経路の既存tagだけ更新、Raw override優先、source ui/prompt/both、disabled保持、missing/ambiguous tag、maxSelected、manual/profile/registry優先順。別selection Mapを恒久保持しない |
| Regression risks | view再renderがtag挿入/保存を増やす、inactive Structured/Rawを書換える、Library sliderと使用中weightの非対称性を勝手に統一、dialog cancelとpendingの意味変更 |
| Required tests | [coordinator](../../test/prompt-lora-coordinator.test.js)、[form characterization](../../test/prompt-lora-form-characterization.test.js)、[tags](../../test/lora-tags.test.js)、[outfit](../../test/lora-outfit-selection.test.js)、[preset catalog](../../test/preset-catalog.test.js)のaffected。browser: add→Raw tag→weight→disabled→remove、folder/search/favorite、keyboard/modal、長い名称 |
| Readiness | **READY WITH CONSTRAINTS**。現入口はLibrary openPicker。未接続のapp openCharacterPicker/openOutfitPickerを新UIから有効化するのは単なる見た目変更ではなく、明示feature scopeが必要 |

## 3. LoRA management

| 項目 | 境界 |
| --- | --- |
| Feature | installed catalog、category/folder/pin/favorite、profile/metadata編集、root表示 |
| UI owner/view | [lora-library](../../public/features/lora-library.js)のrender群、[lora-editor](../../public/lora-editor.js)、appのprofile/trigger/cache controls |
| Allowed changes | 管理card/table、metadata dialog、folder tree、preview、filter、empty/loading/error、responsive。catalog操作portは維持 |
| Required controller interface | Library load/render/getItems/findByName/openPicker/loadRoot、既存metadata/favorite/root commandsとcontrols callbacks。Civitai folders/rootは注入query |
| Forbidden changes | selection/source/disabledをLibraryへ移す、catalog配列をviewから編集、registry UID/name/file identityの変更、metadata優先順・移動/sidecar/install契約変更、UIから直接filesystem操作 |
| Regression risks | catalog reload中のRuntime変更、metadata保存後のselection/profile同期、古いpreview、filter/pin消失、Favoriteと画像Favorite混同 |
| Required tests | [library controller](../../test/lora-library-controller.test.js)、[profiles](../../test/lora-profiles.test.js)、[preview](../../test/lora-preview.test.js)、[metadata](../../test/lora-metadata.test.js)のaffected。browser: long names、folder/pin/favorite、mock metadata成功/失敗、reload、Runtime切替 |
| Readiness | **READY WITH CONSTRAINTS**。1073行の管理controllerを理由なく先に全分割しない。対象renderの局所化は有益。actual file move/installはfixture外で実行しない |

## 4. Civitai import

| 項目 | 境界 |
| --- | --- |
| Feature | inspect、duplicate確認、folder選択、install/registration |
| UI owner/view | [civitai-controller](../../public/features/civitai-controller.js) preview/dialog、Settings内DOM、app clearable Civitai URL |
| Allowed changes | 入力/preview/進捗/重複説明、folder picker、失敗表示、focus/responsive |
| Required controller interface | inspect/install/loadFolders/getFolders、registration/previewの公開commands、Library reload/root query。session tokenは既存ownerへ |
| Forbidden changes | install/duplicate/registry semantics、backend token解決、session-onlyからの移行、tokenの表示/log/test埋込、view独自POST |
| Regression risks | inspect旧応答、folder再load、clear後旧preview、install二重実行、busy時操作 |
| Required tests | [Civitai controller](../../test/civitai-controller.test.js)と対象folder tests。browserはdummy token/mock APIでinspect→folder→duplicate/install→reload、失敗/clear。実外部downloadは対象外 |
| Readiness | **READY WITH CONSTRAINTS**。Settings shell工事とinstall workflow変更を混ぜない |

## 5. Runtime / Checkpoint / Checkpoint Sets

| 項目 | 境界 |
| --- | --- |
| Feature | Runtime選択、checkpoint表示/選択、profile、保存Set |
| UI owner/view | [runtime-controller](../../public/features/runtime-controller.js)、[checkpoint-sets](../../public/features/checkpoint-sets.js)、app syncRuntimeUi/renderCheckpointProfileSummary/applyCheckpointSetSettings |
| Allowed changes | selector/status/profile/Set card、説明/警告、loading/busy/availability presentation |
| Required controller interface | Runtime selectRuntime/loadCheckpoints/getState/runtimeSupports系/context ports、Set load/apply/applyAuto/CRUD/markSettingsApplied。app external snapshot/form adapters |
| Forbidden changes | selectedとactiveの統合、Runtime IDs/activation、Checkpoint public ID、Runtime成功commit、set fingerprint・autoApply・Prompt/source復元順。UIからNeo options POSTしない |
| Regression risks | slow catalog/health、切替中操作、旧selection応答、部分失敗rollback、Set適用後summary不一致 |
| Required tests | [runtime](../../test/runtime-controller.test.js)、[checkpoint set controller](../../test/checkpoint-sets-controller.test.js)、[recipe runtime boundary](../../test/recipe-runtime-boundary.test.js)のaffected。browser: delayed switch/failure→UIとowner一致、Set適用後form/summary/Studio stats一致 |
| Readiness | **READY WITH CONSTRAINTS**。Set summary/statsの既存不一致は関連UI前fix。横断順序変更が必要ならAstraの設計対象 |

## 6. Recipe actions

| 項目 | 境界 |
| --- | --- |
| Feature | History/Studioから読込、same-seed、duplicate、instruction/LoRA派生 |
| UI owner/view | History/Studio action menus、app composition lock/派生dialog。[recipe-workflow](../../public/features/recipe-workflow.js)は操作順owner |
| Allowed changes | action配置/説明、確認dialog、loading/error/rollback不完全表示、focus誘導 |
| Required controller interface | recipeWorkflow.load/ensureRuntime、各owner capture/restore、app派生準備commands。生成submitはGenerationへ |
| Forbidden changes | Runtime成功後capture、rollback Prompt-LoRA→IP→Reference→Form→Inpaint、syncSize:false、保存例外prefix、missing Runtime=ReForge、checkpoint/source/mask非適用、one-shot非consume |
| Regression risks | instruction cancelでRuntimeを戻す、旧Recipeが新Runtimeへrestore、source auto-sizeでrollback寸法変化、保存失敗を成功扱い |
| Required tests | [recipe workflow](../../test/recipe-workflow.test.js)、[recipe runtime boundary](../../test/recipe-runtime-boundary.test.js)、影響したowner test。browserは成功load、失敗rollback、連続Recipe、cancel、same-seed/duplicateの対象subset |
| Readiness | **READY WITH CONSTRAINTS**。action viewは改築可。全設定完全復元などRecipe機能追加は別task |

## 7. Gallery

| 項目 | 境界 |
| --- | --- |
| Feature | History一覧、filter/sort/search、paging、detail、Favorite/rating、action menu |
| UI owner/view | [history-controller](../../public/features/history-controller.js)のrender/card/detail/filter、[gallery-filter](../../public/gallery-filter.js)、index gallery toolbar/grid、style gallery rules |
| Allowed changes | card/grid/toolbar/filter dialog、empty/error/load-more表示、metadata/accessibility/responsive。DOM contract追従。overflow解消 |
| Required controller interface | History load/loadMore/setFilter/resetFilter/openFilterDialog/openDetail/getEntries/getGenerations。image-state Favorite/notification、Compare toggle/query、Recipe load、Generation hires ports |
| Forbidden changes | view自身のfetch/paging cache、cursor形式/merge/page size契約、History schema/ID、独自Favorite map、原寸先読み、bulk削除の意味変更 |
| Regression risks | Favorite/rating切替中に要求が捨てられ旧data/cursorがcommit、append中reset、detailから変更後cache、同generationのpage跨ぎ、Compare selection、390px filter group overflow |
| Required tests | prerequisite bug fixは[history controller](../../test/history-controller.test.js)でdelayed old/new filter、append/reset、failure後最新要求をbehavior検証。view工事では[Gallery filter characterization](../../test/ui-shell.test.js)、[image delivery UI](../../test/image-delivery-ui.test.js)、[layout overflow](../../test/layout-overflow.test.js)のaffected。browserはnonempty/long labels、rapid Favorite/rating、load more、menu/modal、390pxとdesktop |
| Readiness | **NOT READY**。先にfilter raceだけ別fix。390px overflowはGallery完成前必須で、最初のlayout工事に含めてもよい。全UIのBLOCKERではない |

## 8. Compare

| 項目 | 境界 |
| --- | --- |
| Feature | 選択tray、比較modal、diff、vote |
| UI owner/view | [comparison-controller](../../public/features/comparison-controller.js)、[compare-view](../../public/compare-view.js)、History/Studio側比較button |
| Allowed changes | tray/比較pane/metadata/vote presentation、keyboard/aria、mobile切替、image fit |
| Required controller interface | toggle/clear/sync/setGalleryMode/openEntries/getSelection/isSelected、History snapshots/reload・vote callback、Studio query、document全体のcompare selector同期 |
| Forbidden changes | selection Mapの第二owner、ID normalization、2–4枚制約、vote API/保存、image delivery原寸意図 |
| Regression risks | 同IDを別viewで選択、History削除後selection、modal close/focus、favorite/ratingとのevent propagation、narrow screen tray |
| Required tests | [comparison controller](../../test/comparison-controller.test.js)、[compare view](../../test/compare-view.test.js)、[image-state](../../test/image-state.test.js)のaffected。browser: 2→4枚、解除/clear、vote、Gallery/Studio同期、mobile/focus |
| Readiness | **READY WITH CONSTRAINTS**。Gallery retrievalを触らず比較viewは開始可。Gallery全導線の完成判定にはGallery prerequisiteも必要 |

## 9. Experiments

| 項目 | 境界 |
| --- | --- |
| Feature | parameter選択、run/progress、実験card/detail、結果比較 |
| UI owner/view | [experiment-controller](../../public/features/experiment-controller.js)のrender群、compare-view、Compare画面のExperiment section |
| Allowed changes | parameter/control layout、progress、cards/detail/results、比較の見せ方、empty/error/responsive |
| Required controller interface | run/load/poll/cancel/renderCards/openDetail/openResult/ensureEntries/compare、History query、Queue start、form reader ports |
| Forbidden changes | baseRequestのseed/count=1方針、pendingDerivation非消費、backend run/cancel/delete/recovery semantics、page lifetime poll、独自全queue |
| Regression risks | running中navigation、同時run、旧poll、cache削除、best/vote反映、削除前cancel、recoveryで条件が下がった表示 |
| Required tests | [experiment controller](../../test/experiment-controller.test.js)と影響した[compare view](../../test/compare-view.test.js)。backend operationが不変なら全server suiteをfocusedに追加しない。browser: mock run→navigate→progress→result→compare、cancel/失敗の対象subset |
| Readiness | **READY WITH CONSTRAINTS**。presentation工事可。Generation workflowとの統一refactorは含めない |

## 10. Settings shell / domain panels

| 項目 | 境界 |
| --- | --- |
| Feature | category/navigation/search、general/Discord/storage/update/AI-share/Sampler等 |
| UI owner/view | [settings-navigation](../../public/features/settings-navigation.js)、[settings-discord](../../public/features/settings-discord.js)、[settings-storage](../../public/features/settings-storage.js)、[settings-update](../../public/features/settings-update.js)、[ai-share](../../public/features/ai-share.js)、[sampler-picker](../../public/features/sampler-picker.js)、app general form |
| Allowed changes | 初回工事はshellのcategory/search/layout/focusに限定。個別panelのlabel/control presentationは後続feature taskで可能 |
| Required controller interface | shell activate/init/dispose、各domain load/save/check等。Sampler loadOptions/syncLabels、AI share scheduleShareCsvSync。Persistence/update/sessionは既存ports |
| Forbidden changes | shell用settings storeを追加、保存key/version/default変更、secret localStorage化、Discord送信state変更、storage plan/reserve/migration順、update apply/rollback変更 |
| Regression risks | searchがcategory/detailsを開く順序、focus飛び、390px mobile category select、hidden legacy controlを削除してlistenerを破壊、save二重発火 |
| Required tests | 最初のshellは[settings navigation](../../test/settings-navigation.test.js)＋[ui](../../test/ui.test.js)/[ui-shell](../../test/ui-shell.test.js)/[layout](../../test/layout-overflow.test.js)のaffected。domain panelを触る場合だけ当該settings test。browser: 複数語search→category→details/focus→clear、mobile select、reload |
| Readiness | shellは **READY**、操作を持つdomain panelは **READY WITH CONSTRAINTS**。最初に新築すべきUIとしてshellを推奨。実Webhook送信/実storage migration/実updateをsmokeへ混ぜない |

## 11. img2img / Reference Image

| 項目 | 境界 |
| --- | --- |
| Feature | file/drop/history imageの入力、preview、mode、dimension sync |
| UI owner/view | [reference-image](../../public/features/reference-image.js)、app setGenerationMode/size/settings adapter、img2img panel |
| Allowed changes | drop zone、preview/status、入力control配置、keyboard/touch、responsive。source所有はcontrollerへ |
| Required controller interface | loadFile/useImage/clear/getReference/hasReference/readPayload、captureSnapshot/restoreSnapshot/syncResolution/syncSelectedSize/setBusy、app mode/size callbacks |
| Forbidden changes | object URL管理、pending FileReader/token、payload、source選択時size sync、Recipe rollback syncSize:false、reference asset security |
| Regression risks | 遅いfile A後にB選択、clear後旧decode、mode切替、History原寸取得、Recipe rollback後寸法、URL revoke |
| Required tests | [reference image](../../test/reference-image.test.js)、影響時[recipe runtime boundary](../../test/recipe-runtime-boundary.test.js)。browser: file/drop→replace→clear、History選択、mode/size、narrow viewport |
| Readiness | **READY WITH CONSTRAINTS**。UIで新しいReference stateを作らず既存ownerのDOM portを更新 |

## 12. Inpaint

| 項目 | 境界 |
| --- | --- |
| Feature | mask canvas、paint/erase、brush/undo/redo、mask設定 |
| UI owner/view | [inpaint-editor](../../public/features/inpaint-editor.js)とcanvas stage、app mode/Reference coupling |
| Allowed changes | toolbar・brush presentation・canvas stage layout・a11y。表示scale変更は座標とbitmap保存寸法を区別 |
| Required controller interface | setSource/reset/hasMask/readPayload、undo/redo、captureState/restoreState、preferences/busy ports |
| Forbidden changes | mask semantics、bitmap/source identity、undo stacks、decode token/Runtime isCurrent、Recipe restore最後の順序、generation payload |
| Regression risks | CSS resize/DPRでstroke位置ずれ、touchがpage scrollと競合、source replacement後旧undo描画、mask消失、decode中reset |
| Required tests | [inpaint editor](../../test/inpaint-editor.test.js)、[recipe workflow](../../test/recipe-workflow.test.js)のaffected。browserの実Canvasでpaint/erase/undo/redo、resize/DPR/touch、source replacement、reset/restore |
| Readiness | **READY WITH CONSTRAINTS**。toolbarのみならSolで可能。canvas owner/restore境界へ触れる場合はAstra設計対象。browser確認をsource testで代用しない |

## 13. IP-Adapter

| 項目 | 境界 |
| --- | --- |
| Feature | reference選択、model/weight/guidance、Runtime availability |
| UI owner/view | [ip-adapter-controller](../../public/features/ip-adapter-controller.js)のsyncUiとcontrol DOM |
| Allowed changes | input/preview/slider/availability説明、disabled presentation、layout/focus/responsive |
| Required controller interface | loadOptions/readPayload/applyMetadata/restoreRecipe、captureState/restoreState、syncUi、既存reference操作ports |
| Forbidden changes | unsupportedでもretained stateを保持しpayloadのみ省略、独自capability判断、options/file tokens、object URL寿命、metadata/schema |
| Regression risks | Runtime往復で設定消失、旧options応答、file競合、reference clear、Recipe失敗restore、unsupported送信 |
| Required tests | [IP controller](../../test/ip-adapter-controller.test.js)、影響時[reference](../../test/reference-image.test.js)/[recipe workflow](../../test/recipe-workflow.test.js)。browser: supported→unsupported→戻る、file→clear、Recipe、payload有無 |
| Readiness | **READY WITH CONSTRAINTS**。新UIのdisabled理由を改善してもunsupported時の保存stateを消さない |

## 14. Queue / Favorite / notification presentation

| 項目 | 境界 |
| --- | --- |
| Feature | Queue panel/indicator、各viewのFavorite・Discord 2 channel状態 |
| UI owner/view | [queue-view](../../public/queue-view.js)、[queue-controller](../../public/features/queue-controller.js)、[image-state](../../public/features/image-state.js)のbadge/button render、各card/result |
| Allowed changes | panel/status/badge/button/aria、全viewで同IDの見せ方、error/retry説明 |
| Required controller interface | Queue startPolling/refresh/panel/init/dispose。image-state toggleFavorite/remember/apply state、badge factories/render、bindPresentation |
| Forbidden changes | navigationで監視停止、全Jobの第二poller、viewごとのFavorite map、Discord両channelの混同、view-local/重複watcher追加、既存ID+channel dedupe変更、実送信の無断追加 |
| Regression risks | 同ID複数表示の同期、event propagation、初回terminal重複通知、dispose後GET/toast、Queue completionとHistory refresh |
| Required tests | [queue controller](../../test/queue-controller.test.js)、[queue view](../../test/queue-view.test.js)、[image-state](../../test/image-state.test.js)、[favorite sync](../../test/favorite-sync.test.js)のaffected。browserはmock通知state・同IDの複数view・navigation中completion |
| Readiness | **READY WITH CONSTRAINTS**。現app lifetimeを維持する表示工事は可。image-state disposeはwatcherを無効化しないため、owner remount導入前にはlifecycle fixが必要 |

## 15. Persistence / Bootstrap / common shell

| 項目 | 境界 |
| --- | --- |
| Feature | startup、saved view、static listeners、page lifecycle、共通navigation |
| UI owner/view | [app/bootstrap](../../public/app/bootstrap.js)、[core/preferences](../../public/core/preferences.js)、[navigation](../../public/features/navigation.js)、app factory lists/restore order |
| Allowed changes | shell/navigationの見せ方と対象DOM接続。startup順と保存方式は維持。view display stateだけを変更 |
| Required controller interface | bootstrap start/dispose、navigation showView/loadInitialView/init/dispose、preferences key/encoding ports |
| Forbidden changes | config→restore→load→init順、二重start/listener/fetch、view dispose→Job cancel、storage key/version/fallback、session secret、SW/static/update契約 |
| Regression risks | module評価時DOM lookup、one-shot start、直接clearable listeners、遅いstartup途中dispose後処理、controller DOM capture、saved hash/view restore |
| Required tests | [bootstrap](../../test/bootstrap.test.js)、[preferences](../../test/preferences.test.js)、[navigation](../../test/navigation.test.js)。PWA/static接続を変更した時だけ[pwa](../../test/pwa.test.js)/[updater](../../test/updater.test.js)を追加。browser: fresh→save→reload、target corrupt/missing key、navigation state、init/fetch count |
| Readiness | 既存page lifetimeのpresentationは **READY WITH CONSTRAINTS**。任意app unmount/remountや新router/framework導入は本契約では **NOT READY**、独立lifecycle設計が先 |

## Bug prerequisiteと実装の切り方

| 優先度 | 対象 | UI taskとの関係 |
| --- | --- | --- |
| BLOCKER | 今回確認した全project共通の該当bugなし | 未実施の実機/provider検証まで成功保証する意味ではない |
| FIX BEFORE RELATED UI | Gallery filter race | Gallery改築前に独立fix。旧応答破棄だけでなく最新要求を最終的に実行すること。cursor/append/resetを同じfilter contextへ揃える |
| FIX BEFORE RELATED UI | 390px Gallery overflow | Gallery responsive完成前に解消。独立fixか最初のlayout工事。clipで操作を消して通過させない |
| FIX BEFORE RELATED UI | Studio recent race、Checkpoint Set summary stale | 各関連UI工事前に狭いfix。Gallery raceと同じpatchへ自動拡大しない |
| CAN WAIT | 通知watcher dispose guard、clearable listener registry外 | 現page lifetime維持なら先行UI可。remount/dispose仕様変更時は関連fixへ繰上げ |
| CAN WAIT | app全解体、giant controller分割、全test再配置、dead bridge cleanup、physical relocation、build導入 | UI開始の前提にしない。必要性が具体化した別taskで判断 |

最初の推奨作業は**Gallery filter raceだけのbug fix**。最初のUI工事はその後の**Settings shell category/search/layout**。前者はcorrectnessを固定する小さな作業、後者は独立したcontroller境界を用いたUI工事の基準を作る作業となる。

## Lean validation / handoff

- 着手時: 対象feature・Allowed変更・保護contract・affected test・browser scenarioを1枚のtask範囲へ固定。現dirtyとの差分を記録する。
- 変更中: 対象focusedだけを回す。path/source assertionは意味を保ったまま対象view/adapterへ追従する。CSS文字列testの成功を390px実layoutの証明にしない。
- Browser: feature統合後のcomplete sequenceを1回。正常+最も危険な非同期/失敗+入退場を選ぶ。fixture側失敗はfixture修正後に未完了scenarioを含むsequenceを完走し、production回帰と混同しない。
- Responsive: 対象画面の1366×768 100%/125%と390px、長いtitle/model、empty/populated/error、keyboard/focus。共通layoutを変える時はDESIGNの1920/2560/430pxとSafari条件を追加。実Safari未確認なら明記する。
- Completion: repository規約どおり最終production差分後にcheck/fullを各1回。green後に文書だけ直した場合は再実行しない。production/test修正・新failure・未解決懸念があればaffected→必要gateを再確認する。
- End-to-end: 複数featureの工事がまとまったrelease境界で主要journeyを一度横断。小さなUI taskごとに全Phaseのfixtureを反復しない。
- Fixture: ignored workbenchは保存し、該当scenarioのfixtureが現在checkoutで再現可能か開始時に確認する。clean checkoutへ配布できない点を記録。tracked harness化は必要な最小範囲を別途決める。
- Handoff: changed files、何を維持したか、実行したgate/結果、実機等の未確認、残る関連bugを短く報告。歴史的PASSを今回の結果にしない。

Astraは曖昧なUI境界、共通form/lifecycle、Runtime/Prompt/Recipe/Generation横断、Canvas restore、static/updater変更、substantial changeの最終reviewに集中する。Solは承認済みinterfaceを使うview/adapter実装、focused bug fixと回帰testを担当できる。単純CSS/小shellはTerra、検索/path確認/test集計はLunaが適する。

本書の作成ではUI/production/test/packageを変更しない。文書path/local link/whitespaceと新Audit文書以外の差分不変を確認し、実装へ進まず停止する。
