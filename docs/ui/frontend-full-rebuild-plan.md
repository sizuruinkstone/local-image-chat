# Frontend Full Rebuild — Product / Architecture Plan

作成: 2026-09-07。担当: 設計・監督。状態: First Deliverable。Production切替・実装完了を示す文書ではない。

## 1. 目的と今回の成果物

Local Image ChatをPersonal AI Image Studioとして再設計する。画像を見ながら意図を編集し、生成し、比較し、再利用する一つの作業環境にする。旧画面の配置・DOM・CSSは設計入力にしない。旧実装から得るのは機能、データ、操作順、副作用、互換性の制約である。

本書はarchitecture audit、四分類、情報設計、Desktop/Mobile配置、component architecture、移行計画、risk、実装Phaseを含む。[ワイヤーフレーム](frontend-full-rebuild-wireframes.md)で1440px・390px・430pxの画面と操作遷移を具体化した。今回は実行可能なHTML prototypeではなくASCII設計を成果物とする。

今回の明示依頼が旧[DESIGN](../../DESIGN.md)の「左編集＋右画像」「現在のDOMを正本」とする配置条件に優先する。旧DESIGNは現在稼働する旧UIの履歴として保持する。以下の新design systemは新shell向け提案であり、旧CSSへ追加して適用しない。

## 2. Existing architecture audit

確認対象は現在のworking tree。既存のPearl Glass実装、app/History/Studio/testの未コミット差分を含む。過去checkpointだけを完成状態としない。

| 層 | 現在の入口・責務 | 新築への意味 |
| --- | --- | --- |
| 配信 | `src/server.js`の`express.static(public)` → `public/index.html` → `public/app.js` | 新しいassetも`public/`下に置けば配信の仕組みを維持できる |
| Composition | `public/app.js`のcontroller生成、elements、form adapter、profile/trigger、derivation | 新shellから旧app.jsをimportして起動しない。必要なadapterを抽出する |
| 起動・寿命 | `public/app/bootstrap.js`、各controller init/dispose | Queue/Experimentはapp lifetime。表示切替とjob cancelを分離 |
| Domain＋view混在 | `public/features/*`のcontroller、注入elementsとrender | 名前がcontrollerでもheadlessではない。DOMを捕捉する箇所をrender portへ切り分ける |
| Promptと入力 | appの`readPromptPayload`、`readSettings`、`readSelectedLoras`、Structured/Raw helpers | DOM/app adapterが現在の入力正本。新旧のhidden formや第二storeで同期しない |
| 純粋utility | `structured-prompt.js`、`lora-tags.js`、`prompt-import.js`、`metadata-format.js`等 | 現behaviorとtestを再利用可能 |
| 状態owner | Runtime、Prompt-LoRA、Generation、Recipe、Image State、History、Compare等 | 新viewから公開commandを呼び、query結果を変更しない |
| Presentation | index/style、queue/compare view、app内pickerと描画、ui-kit | 新shell/components/stylesへ置換。機能を失わない単位で撤去 |
| 保存 | `public/core/preferences.js`とfeature-owned storage | key/version/serialization/default/secretの保存場所を保つ |
| 配布 | `public/sw.js`はnetwork透過、`src/updater.js`の`UPDATE_PATHS`にpublic | 新buildやcacheを導入しない。entry変更時にPWA/update/rollbackを検証 |

根拠入口: [app](../../public/app.js)、[bootstrap](../../public/app/bootstrap.js)、[decisions](../implementation/decisions.md)、[UI boundaries](../refactor/ui-renovation-boundaries.md)。旧boundariesに残るHistory race等のreadiness記述は歴史的評価であり、[現在の実装記録](ui-glass-implementation.md)の修正報告と現コード/testを優先する。再発の有無は移行前gateで検査する。

## 3. Preserve / Extract / Replace / Delete Candidate

ファイル全体を一括分類しない。controller内のstate/commandはPreserve、renderはReplace、その間の接続はExtractになり得る。

| 分類 | 対象 | 実行方針 |
| --- | --- | --- |
| Preserve | backend、provider、API v1/MCP、使用中legacy API、JobManager/recovery、History/metadata | endpoint・DTO・error・ID・保存形式を変更しない |
| Preserve | generation-controller / recipe-workflow / runtime-controllerの操作順と排他 | 同じcommand/transaction境界に新UIを接続 |
| Preserve | prompt-lora-coordinator、image-state、History/Compare/Queueのowner | 新UIに独自selection/Favorite/queue cacheを持たせない |
| Preserve | HTTP client、preferences、画像URL・thumbnail utility、Prompt/LoRA純粋変換 | 既存exportsとcharacterization testsを維持 |
| Extract | appのform read/apply、Prompt profile/trigger、Checkpoint Set adapter、derivation準備 | 小さな明示portへ移す。挙動変更と同じ差分にしない |
| Extract | feature内render、DOM capture、modal依存、event委譲 | headlessに必要な部分だけ分離。新旧view adapterから一方を選択 |
| Replace | index DOM、style.css、旧navigation、picker、Prompt/Studio/Gallery/Settings view | 新DOMとtoken/component CSSを独立して作る |
| Replace | ui-kit/option-pickerの外観と旧view markup | focus/Escape/keyboard/validationの意味は新primitiveへ引継ぐ |
| Delete Candidate | 旧index/app entry/style、旧DOM専用view、未使用selector/listener、旧配置assert | 新entryの全機能gate、static/import/test確認、rollback確認後に対象を確定 |

Delete Candidateは削除許可リストではない。参照数ゼロだけでは削除しない。外部path、dynamic import、PWA、updater、起動時副作用と既存dirty差分を確認し、旧機能との対応表が全て埋まった時点で撤去する。

## 4. Backend / UI functional contract inventory

| 機能・正本 | 新UIの入口 | 維持する契約・受入条件 |
| --- | --- | --- |
| Runtime / Checkpoint / capabilities — runtime-controller | ヘッダーのEngine状態、Model browser | selected/activeを区別、ID維持、遅延catalog除外、切替成功はcommit境界 |
| Sampler / Scheduler — sampler-picker、app settings | Inspector > Sampling | runtime能力に応じた候補・値を維持。非対応値を黙って置換しない |
| txt2img / candidate / final / Hires — generation-controller | Canvas mode、Generate split action、candidate rail | await前予約、二重submit防止、確定requestの承認付き再送1回、cancelの意味 |
| Structured / Raw / AI Prompt — app＋structured-prompt / prompt-import | Prompt dock・拡張editor・AI action | Raw override優先、section/trigger規則、変換/生成actionを混同しない |
| Active LoRA — prompt-lora-coordinator | ドックの構成帯、LoRA browser | ui/prompt/both source、disabled、weight、missing/ambiguous、maxSelected維持 |
| LoRA catalog / metadata / profile / outfit — lora-library | Assets > LoRA、選択itemの詳細 | identityとmetadata優先順、folder/pin/favorite、profile/trigger、既存管理操作維持 |
| Civitai inspect/install — civitai-controller | Assets > Import | duplicate/registration/folder/busyの意味、token解決・session保存、実installはfixture代替 |
| Checkpoint Sets / presets | Model browser > Sets、Prompt > Presets | apply/autoApply/fingerprint、settings適用後summary同期、保存形式維持 |
| Recipe / same seed / duplicate / instruction / LoRA派生 — recipe-workflow＋app | Canvas > Reuseメニュー | Runtime成功後に非Runtime snapshot、rollback順、syncSize:false、保存失敗の部分成功表示 |
| Reference / img2img — reference-image | Canvas > Reference | file/drop/history入力、object URL解放、mode/dimension syncを保持 |
| Inpaint — inpaint-editor | Canvas > Mask tool | mask座標/undo/redo/resize/復元契約。画像閲覧操作と描画gestureを区別 |
| IP-Adapter — ip-adapter-controller | Inspector > References | capability、読取待ち、preview資源管理、設定・request整合 |
| Gallery / cursor — history-controller | Library展開とTimeline | paging/merge/filter、旧応答排除、取得済み範囲の検索/sort制約を表示 |
| Favorite / rating / notification — image-state | Canvas/Libraryの共通action | 一つのownerから全viewを同期、保存失敗時の表示整合 |
| Metadata / download / reuse / delete / Discord | Canvas情報panel、画像action、Library選択action | 表示は原記録。削除・送信の既存確認/失敗契約を維持。Recipeが復元しないcheckpoint/source/maskを完全復元と表示しない |
| Compare / vote — comparison-controller | Canvas > Compare | 選択2–4枚、同ID同期、vote永続化、mobile一枚切替 |
| Experiments — experiment-controller | Workspace > Experiments | baseRequest、one-shot非消費、run/cancel/delete/recovery、navigation中の監視 |
| Queue / recovery — queue-controller | ヘッダーJobs、進捗drawer | app lifetime、owned Jobと全queueの分離、teardown後応答を無視 |
| Settings — settings-*、ai-share、app general | Preferences全面overlay | General、Discord、Storage、Update、AI share、接続等の全controlを対応付ける |
| Persistence / startup | bootstrap、preferences | 全既存key/version/default、fresh/corrupt/reload、session token、初回load回数維持 |

HTTPは既存helperとfeature所有のrequestを使う。新component内にendpointを重複記述しない。詳細request payloadの正本は対象controllerとserver test。移行Phase R1でcommandごとの入力/成功/失敗fixtureを固定し、この表を操作単位まで展開する。

監査で確認した接続例:

| 呼び出し元 | 現行通信・重要な順序 |
| --- | --- |
| generation-controller | `POST /api/jobs`、`GET /api/jobs/:id`、`DELETE /api/jobs/:id`。IP読取後、derivation read-and-clear、その後settings読取 |
| queue-controller | `GET /api/queue`。全queueと自分の生成operationは別owner |
| runtime-controller | `/api/runtimes`とruntimeに紐付くcheckpoint/catalog。旧contextの結果を適用しない |
| checkpoint-sets | `/api/checkpoint-lora-sets`のCRUDとapply/autoApply。新viewで独自適用しない |
| experiment-controller | `/api/experiments`から実行・poll・cancel等へ。generation lockへ統合しない |
| settings-storage | `/api/storage/settings`のGET/PATCHと既存migration操作。UI変更でmigrationを実行しない |
| API v1 | `src/api/v1/router.js`の別契約。legacy呼出をv1へ勝手に置換しない |

参照画像はuploadと保存済みIDを区別し、source変更時のmask無効化、非同期read token、object URL寿命を維持する。共有utilityの`structured-prompt.js`、`lora-tags.js`、`history-title.js`にはNode側利用もあるため、新browser専用treeへ一括移動しない。

## 5. New information architecture

恒常的な作業場所はStudio一つ。Global barにStudio、Assets、Experiments、Jobs、Preferences。Studio内部ではCanvas、Prompt dock、Timelineを同時に維持する。LibraryはStudioのCanvas領域を拡張する閲覧modeで、別のGenerate pageへ遷移させない。

- Canvas focus: 画像を見る、candidateを選ぶ、compare、reference、mask。空/前回/進捗/結果を同じ面で表示。
- Prompt dock: 意図を書く、sectionを切り替える、Rawを編集、presets、LoRA構成、生成。compact/expandedを切り替える。
- Inspector: 通常は閉じる。Generation、Image metadata、Referenceの対象別タブ。Sampling/CFG等はGeneration内。
- Timeline / Library: recentを薄いrailで表示、展開するとfilter付きgrid。選択でCanvasにinspect、明示Reuseで入力に適用。
- Assets: Model/LoRAの視覚browserと管理、Civitai import。選択後同じdraftへ戻る。
- Preferences: app設定・接続・storage・update。制作parameterはここへ逃がさない。

Canvasの「閲覧中image ID」と最後の生成結果は区別する。履歴選択ではdraft、pending derivation、Runtimeを変更しない。「最新結果へ」で閲覧を戻す。生成完了時、過去画像を閲覧中なら完了通知とTimeline追加を行い、強制的に選択を奪わない。結果閲覧modeなら新結果へ移る。

## 6. Prompt / LoRA interaction design

Prompt compactは短い編集領域、section一覧、生成されるPrompt previewへの入口を持つ。expandedではCharacter / Appearance / Pose / Background等を既存`PROMPT_FIELDS`へ対応付ける。表示labelの追加を新しいpayload fieldの追加としない。Rawでは元文字列を維持し、Structuredへの破壊的な再parseを自動実行しない。

「タグ表示」は編集文字列からの補助表示。tokenizerがない段階では文字数・tag数と明記し、モデルのtoken数と偽らない。last-usedとpresetsは既存保存へ接続。新しいeditor undoと一時draft履歴はsession内の編集操作だけを対象とし、Runtime切替やRecipe適用全体をundoしたように見せない。永続Prompt履歴は保存設計が必要なのでshell段階では非実装と表示する。

LoRA browserはfolder tree/breadcrumb、検索、favorite filter、thumbnail grid、選択詳細、現在の構成を持つ。Active帯は名前・weight・enabledを常時要約し、詳細で数値入力、削除、順序操作。dragだけに頼らず「前へ/後ろへ」とkeyboard操作を付ける。

LoRA reorderは既存selection orderとPrompt tag orderが同じとは仮定しない。R5でcoordinatorの公開commandとして定義・testするまでは表示順のpreviewのみ。Raw tagを暗黙に並べ替えたり、UI追加でtagを挿入する規則へ変更しない。Backend変更なしで実現できても、owner contractの拡張は独立した差分として扱う。

## 7. Design system proposal

Professional Creative Tool × Pearl Glass。常設workspaceは不透明な中立色で読みやすくし、glassは浮上するcommand surface/sheetに限定。大量の透明card、常時gradient、広いblurを使わない。

| Token群 | 新shellの初期値・規則 |
| --- | --- |
| Spacing | 4 / 8 / 12 / 16 / 24 / 32 / 48px。control内8–12、group間24 |
| Typography | system sans、日本語system fallback。11補助、13操作、15本文、18panel、24empty title。mobile入力16px以上。数値tabular |
| Radius | control 6、panel 10、sheet 16、pillは状態表示のみ |
| Surface | workspace `#ECEDEB`、panel `#F8F9F6`、raised `#FFFFFF`、Canvas `#26292C` |
| Text | primary `#202426`、secondary `#555D62`、Canvas label `#F1F3F2` |
| Border | 1px `#D4D8D5`、focus以外の濃い囲みを抑える |
| Shadow | raised `0 8px 24px rgb(20 25 28 / 12%)`、modal `0 16px 48px rgb(20 25 28 / 20%)` |
| Glass / blur | raised surfaceのみ白92%＋12px blur上限。不対応/透過抑制時は白不透明 |
| Accent | muted teal `#275F60`。Generate、選択、focusへ限定。写真上はneutral control |
| Focus | 2px accent ring＋2px offset。keyboard focusがCanvas上でも見える |
| Hover / pressed | hoverはsurface一段変化、pressedは`#DDE5E1`。移動scaleなし |
| Disabled | text `#68716C`、surface `#E3E6E2`、disabled semanticsと理由。色だけで表現しない |
| Danger | `#A42B3C`＋文言/icon。失敗をtoastだけで消さない |
| Motion | 120ms hover、180ms panel、240ms overlay。reduced-motionで位置移動を無効化 |

これらは実測contrast合格の報告ではない。R2で通常文字4.5:1、large text/UI境界3:1を検証する。Button、IconButton、Field、Select/Combobox、Tabs、Toolbar、Sheet/Dialog、Menu、Status、Thumbnail、Empty/Error/Progressを共通primitiveとして実装し、画面別の似たCSSを増やさない。日英の長いlabel、IME、200% zoom、focus return、Escape、live statusを共通gateにする。

## 8. Component architecture

native ESMを継続。新framework/build/dependencyは不要。`public/frontend/`に新規責務をまとめ、既存domain moduleは安易に物理移動しない。

```text
public/frontend/
  app/             entry.js, compose.js, lifecycle.js
  components/
    primitives/    button, field, dialog, menu, toolbar
    shell/         global-bar, workspace, jobs-drawer
    canvas/        stage, result-actions, reference-tools
    prompt/        dock, section-editor, raw-editor
    generation/    primary-controls, progress
    lora/          browser, active-composition
    gallery/       timeline, library, image-details
    inspector/     generation, metadata, references
    settings/      preferences-shell, domain-panels
  adapters/        prompt-form, generation-form, feature-presentation
  state/           workspace-presentation (表示stateだけ)
  services/        既存HTTP/feature portへの必要なadapterだけ
  styles/          tokens, primitives, shell, responsive
public/features/   既存domain ownerを維持しrender境界のみ抽出
public/core/       既存HTTP / preferences
```

依存方向: entry → composition → componentとadapter → 既存owner。componentはread snapshot/renderとcommandだけを知る。owner→entry逆import、global event bus、巨大contextは禁止。

表示stateはinspector開閉、Library mode等。表示中image IDは既存Studioのinspection/selection ownerを利用し、新しいMapや第二ownerを作らない。generation settings、LoRA selection、History cache、Runtime、Favoriteは複製しない。Prompt/form adapterを移す際は、新entry内の一つの編集ownerを正本として定め、Recipe/Set/persistence/submitの全portを同じownerへ接続する。既存app DOMと新ownerを双方向同期させる過渡方式は採らない。

Responsiveは同じcomponent/ownerをlayout変更して使用する。sheetへ出すためにcontroller捕捉DOMを作り直す場合はrender port分離後に行い、listener dispose・focus returnを検査する。CSS非表示の第二formは作らない。

## 9. Migration plan

1. 現在のdirty差分を開始snapshotとして記録し、対象file/hunk単位で保持。既存782 passは過去の報告であり、R1開始時のbaselineを測る。
2. fixtureで既存機能の入力と結果をcharacterize。UI selectorをcontractと混同しない。
3. 新shellを独立assetとして作成。旧CSS/旧DOMを読み込まない。fixture prototypeはignored workbench配下から専用loopback harnessで配信する。
4. contract adapterを一責務ずつ抽出し、旧entryでbehaviorを維持してから新entryへ接続する。一documentに新旧appを同時bootstrapしない。
5. 開発中の新entryはdevelopment harness限定。production serverへ未完成route/flagを恒久追加しない。同時タブ操作による実jobの二重開始を移行検証に持ち込まない。
6. parity gate後、`public/index.html`を新entryへ切替。manifest/start URL、SW、static MIME/import、updaterのpublic収録、再読込/rollbackを検証する。
7. 旧entryへのrollback対象を明確に保存し、旧viewの参照/副作用/対応testを確認して削除。旧dirty作業を「不要」として削除しない。

新UIを最終production defaultとする。ただしshellが描けるだけでは切替しない。機能parity未達は旧UIを保持した未完了Phaseとして記録する。

## 10. Risks and mitigations

| Risk | 検出・対処 |
| --- | --- |
| DOM正本と新draftが乖離 | form/Recipe/Set/storage/submitを同じportへ接続、payload比較 |
| remountでJob停止・listener重複 | nav往復/resize中のpoll・submit回数、teardown後応答test |
| Prompt操作がLoRA tagを改変 | Raw/Structured/source/disabled/weightのcharacterization維持 |
| Runtime切替後の失敗で不正rollback | Recipe runtime boundary test、部分成功/失敗UIを明示 |
| Gallery閲覧でdraft/派生を消費 | inspectはread-only、Reuseは明示command、生成完了中閲覧fixture |
| 新IAで高度機能が消える | contract inventoryをcontrol単位へ展開、入口とtestを全行対応 |
| 検索を全履歴検索に見せる | 「読み込み済み」範囲と追加取得を表示。server変更は混ぜない |
| 新UI assetが配布されない | public内配置、PWA/update/static/rollback test |
| 透明面・mobile keyboardが操作を妨げる | 不透明fallback、safe-area/dvh、390/430、IME/keyboard確認 |
| reorder/undoを既存機能と誤認 | 新interactionはowner contractとsession範囲を明記、未接続を有効表示しない |
| testをobsolete扱いしてbugを隠す | 旧assertごとに保存すべきbehaviorと新assertを対応付けてreview |

## 11. Implementation phases and exit gates

| Phase | 対象 | 完了条件 |
| --- | --- | --- |
| R0 Planning（今回） | 本書＋wireframe＋current-state入口 | 9成果物、既存機能の入口、設計差異、移行条件をreview可能にする |
| R1 Contract readiness | adapter inventoryとcharacterization、開始baseline | command入力/出力/失敗・storage/lifecycle fixture。旧UI behavior維持 |
| R2 New shell / primitives | 独立DOM/CSS、Canvas/Prompt/Timeline/Inspector shell | 1440/390/430、focus/contrast/overflow、旧CSS importなし |
| R3 Generate vertical slice | Runtime/model、primary setting、Prompt基本、生成/結果/cancel | fixtureでPrompt→Generate→Result→変更→再生成、二重POSTなし |
| R4 Prompt + Inspector | Structured/Raw、AI、presets、全sampling、Reference/Inpaint/IP | 復元・派生consume・mask/size・capabilityの全対象test |
| R5 LoRA / Assets | browser、folder、favorite、active weight/disable/remove、管理/import | coordinator parity、reorder contract、catalog/metadata/importの成功/失敗 |
| R6 Library / iteration | Timeline/Library、metadata、Recipe、Compare、Hires、Experiments/Queue | 閲覧中完了、paging/race、reuse/rollback、全既存action到達可能 |
| R7 Preferences + persistence | 全設定domain、bootstrap、reload | missing/corrupt/saved/session、load/init一回、navigation復元 |
| R8 Integration / production switch | visual/interaction/parity、entry/static/PWA/update | 全gate成功後に新UIをdefault化、rollback手順検証 |
| R9 Legacy removal | 旧view/asset/obsolete test撤去、文書整理 | 削除根拠・残存参照なし・全gate成功。旧UI依存なし |

MobileはR2から各Phaseで同時確認し、最後に縦積み対応する工程にはしない。実装担当は通常Sol、局所componentはTerra、調査/testはLuna、architectureと最終横断reviewはAstra。重複fileの同時編集は避ける。

### Test classification / validation

- Preserve: server/API/MCP、純粋utility、Runtime/Recipe/Generation/state/persistenceの意味を検査するtest。新UIを理由に弱めない。
- Adapt harness: controller testのDOM fixtureやelement injection。assertするcommand/side effect/countは保持してadapterだけ更新。
- Replace obsolete: `ui-shell.test.js`等の旧class/左右配置/markup文字列を固定するassert。旧assert→新UX behavior→新testの対応表を差分に付ける。file単位で全obsolete扱いしない。
- Add: Library閲覧中生成完了、Prompt sheetでIME、LoRA keyboard reorder、Inspector開閉後の値保持、Mobile mask、loading/error/empty/result、連打/遅延応答。

各実装Phase: affected focused → `npm.cmd run check` → `npm.cmd test` → `git diff --check`。checkは新moduleも対象に加える。full結果はpass/fail/skipと実施時点を記録し、782という件数だけでparityを判断しない。

Browser fixtureは1440×900、390×844、430×932でまず実施。keyboard/zoom/reduced motion、長い日英label、画像あり/なし、API失敗、runtime切替、生成中navigationを含める。主要stateのscreenshotを保存してlayout/視線階層をreviewする。Chrome mobile viewportと実Safariは別証拠。実provider生成、実外部送信/install/storage migration/updateはfixture結果で代替実施済みにしない。

## 12. 今回の検証と未実施

2026-09-07: 現在のsource/module/test入口、配信・SW・updater、architecture documentsを静的確認。新規2文書の相対リンク、9成果物との対応、wireframe寸法、差分とwhitespaceを確認する。Production source/test/設定/保存dataには変更しない。

本Planningではtest suite、browser、実provider生成を実行していない。782 pass / 2 skipsは既存current-stateの過去記録。新UIの動作保証やvisual QA完了として扱わない。次の実装入口はR1であり、R2以降のshellを既存UIへのCSS追加で代替しない。
