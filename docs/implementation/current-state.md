# Current state — Local Image Chat

## Dynamic standing composition sample — 2026-09-11

「ポーズ・構図」の一般向けbuiltin profile末尾へ`立ち姿・ダイナミック構図`を追加。Promptは`full body, standing, contrapposto, three-quarter view, from below, dynamic angle, foreshortening`。立ち全身を保ち、重心・斜め向き・低い視点・遠近だけを指定し、衣装・背景・視線は固定しない。既存sample IDは移動せず、新規IDは`sample-v1:composition:6`。catalogは20→21件。保存catalogへの自動書込なし、選択時だけ従来のsection profile経路でFinalへ合成し、ポーズ・構図の手入力本文は変更しない。

focused profile/MCP 7 PASS、section profile browser Desktop/390/430 PASS、check PASS、full883 total / 881 pass / 0 fail / 既存skip2、diff check PASS。browserで「ダイナミック」検索・適用・Final一致・手入力欄不変を確認。実Provider生成・実iPhone Safari未検証。既存dirty差分保持、server再起動・commit・pushなし。

## Managed Trigger Word per-tag toggles — 2026-09-11

Prompt Workspaceの管理Trigger各行へ有効/無効buttonを追加。対象はLoRA基本Trigger、衣装Trigger、適用中section profile、Checkpoint Positive、Checkpoint Negative。手入力Structured/Raw/Negative本文は変更せず、無効tagだけをFinal Positive/Negativeとgeneration requestから除外する。同一tagに複数sourceがある場合は有効sourceが1つでも残ればFinalへ1回だけ合成。LoRA本体の有効/無効とtag個別状態は独立。section profileは任意の`disabledTriggerKeys`だけをactive snapshot/request/historyへ保存し、空なら従来schemaを維持。Checkpoint toggleはprofile/hashごとのdraft派生状態とし、別Checkpointへ誤適用せず、history reuse時は現在selectedCheckpointから既定有効で再解決する。初期loading/generation/model切替/reuse中は操作をlockし、解除後にbuttonも再描画する。

focused managed-trigger/history/UI 141 PASS、Checkpoint・section profile・LoRA/衣装browser smoke PASS、check PASS、最新full883 total / 881 pass / 0 fail / 既存skip2、diff check PASS。下記Scenes記録時点の`disabledTriggerKeys: []`互換failureは、空配列を旧schemaへ追加しないnormalizeへ修正して解消。Desktop/390/430で個別OFF→Final除外→ON復帰、Raw/Structured、手入力保持、横overflowなしを確認。実Provider生成・実iPhone Safariは未検証。既存dirty差分保持、server再起動・commit・pushなし。

## Scenes initial implementation — 2026-09-11

明示実装GOでS01–S23の初回範囲をAstra単独実装。Studio/Library/Scenes、画像一覧・名前検索・一般/NSFW・更新順・往復保持、Libraryから保存、共通編集・上書き/copy/delete・代表画像picker、共有revision CRUDと独立画像保持、専用workspace/draft一括適用を追加した。Raw手動分割、不足LoRA・分類/同一性確認、非空欄のみ置換、キャラクター/空欄/LoRA 0件/現在Checkpoint/設定維持、生成分類反映、失敗rollbackとstale plan拒否を接続。inline由来LoRAの保持と明示weight 0の再同期・Provider request・履歴保持も補正。詳細・変更fileは[Scenes実装記録](scenes-initial.md)。

2026-09-11 JST: focused 147 PASS、check PASS、Scenes browser Desktop/390/430 PASS、既存Library/Preview/Studio integration browser PASS。02:39 JSTの最新fullは882 total / 879 PASS / 1 FAIL / skip 2で、作業中に外部変更された`section-profiles.js`の`disabledTriggerKeys: []`と、未変更`test/history.test.js`の期待値不一致。直前fullは877 total / 875 PASS / 0 FAIL / skip 2。外部の変更を保持し、workspace全体の最終完了判定はこの不一致の解消待ちとしている。実Provider生成・実iPhone Safariは未実施。稼働server再起動・commit/pushなし。新APIの実利用はWeb server再起動と再読込が必要。

開始前からの混在dirty差分・未追跡文書・設定/保存データを保持。並行するTrigger/profile変更も保持。次は[実装記録](scenes-initial.md)→[要件](../ui/scenes-requirements.md)→[設計](../ui/scenes-design.md)を読み、並行変更完了後のHistory期待値とfull gateを確認する。新たな機能追加は次の依頼範囲で扱う。

## Scenes requirements / design — 2026-09-11

[Scenes要件書](../ui/scenes-requirements.md)のS01–S23を確認済み。設計GOにより[画面・接続設計](../ui/scenes-design.md)を作成。一覧カード、Library Viewerから保存、共通保存/編集dialog、独立共有CRUDと代表画像保持、workspace/draftの一括適用を設計。空欄/LoRA 0件維持・キャラクター/Checkpoint/設定維持・生成分類反映を基準に、部分profile/管理triggerの扱いとrevision競合を明記。Raw編集中の手動分割・分類不明LoRA等の例外操作は設計提案で、本人確認済み要件とは区別。

対象は設計書・要件書の追補・本snapshotのみ。既存dirty差分を保持、Production実装・データ変更・server再起動・commit/pushなし。2026-09-11に現codeとの対応、要件整合、文書リンク・whitespaceを確認。文書のみのためtest/browser/実Provider未実行。次回は要件書→設計書を読み、設計レビューまたは別途実装GOで継続する。

## Library content-rating buttons — 2026-09-11

Libraryの分類selectを生成画面と同じ`content-rating-picker`形式の一般/NSFW直接buttonへ変更。一覧filterとImage Viewer再分類の両方を2択に統一し、Library初期filterは一般。旧保存値のすべて/未分類は一般へ互換normalizeする。Viewerで未分類の旧履歴を開いた場合は両buttonを未選択表示し、押した時点で一般またはNSFWへ再分類できる。選択状態は`aria-pressed`、再分類通信中は両buttonを無効化し、別画像navigation中も元generationだけを更新する既存race contractを維持。History API server paging、PATCH schema、card badgeは変更なし。focused Library/UI 43 PASS、Library browser smoke PASS、check PASS、full864 total / 862 pass / 0 fail / 既存skip2、diff check PASS。Desktop/390/430で一覧・Viewerの操作と横overflowなしを確認。既存dirty差分保持、server再起動・commit・pushなし。

## Section profile classification buttons — 2026-09-10

部分プロファイルの分類操作をselectから直接押せるsegmented buttonsへ変更。保存dialogは一般/NSFWの2択、呼び出しdialogはすべて/一般/NSFWの3択。選択状態は`aria-pressed`で表示し、現在の生成分類から呼び出し初期filterを決める既存動作、検索との併用、profileの`contentRating`保存、profile適用で生成分類を暗黙変更しない契約を維持。focused profile/workspace 40 PASS、check PASS、full864 total / 862 pass / 0 fail / 既存skip2、diff check PASS。Desktop/390/430で保存・一般→すべて→NSFW filter・適用・再読込と横overflowなしを確認、review findingなし。既存dirty差分保持、server再起動・commit・pushなし。

## Forge Neo Anima checkpoint profiles — 2026-09-10

共有Checkpointフォルダへ追加された`oneObsessionAnima_v40.safetensors`、`silvermoonmixAnima_v23.safetensors`、`miaomiaoRealskin_anima13.safetensors`を`config.local.json`の`forgeNeoAnima.profiles`へ登録。3件とも既存oneObsession Anima v3.0と同じ685 tensorのmodel-only Anima構成で、VAE/Text Encoderを内包しないため、既存規約どおり`preset: anima`と`qwen_image_vae.safetensors` / `oneObsessionAnima_v30_txt.safetensors`を指定。Profile ID/checkpointの重複なし、相対path、実ファイル存在、JSON parseを直接検証。focused checkpoint 21 PASS、check PASS、full863 total / 861 pass / 0 fail / 既存skip2、diff check PASS。Style Trigger・公開codeは変更していない。稼働中Forge Neoは未refresh、Web Serverも未再起動のため、実UI反映・切替・生成は未検証。既存dirty差分保持、commit/pushなし。

同3件を実ファイルSHA-256でCivitaiのexact versionへ照合し、`checkpoint-style-profiles.js`へhash限定Profileを追加。One obsession v4.0は作者の品質Positive/Negativeからratingの`sensitive`と成人表現へ干渉する`censor`を除いて登録。SilvermoonMix v2.3は中立画風とNegativeなしが作者推奨のため両方空。MiaoMiao RealSkin Anima1.3は品質・写実画風語とNegative品質語を登録し、ratingの`sensitive`/`explicit`、人物属性の`fair skin`、背景指定の`photo background`を除外。Sampler/Steps/CFG/解像度、画師タグ、生成分類は変更しない。選択Checkpoint由来の管理情報としてのみFinalへ適用し、手入力Prompt・保存Draftへは焼き込まない。focused style/workspace 44 PASS、check PASS、full864 total / 862 pass / 0 fail / 既存skip2、diff check PASS。実Provider生成・実UI切替は未検証。

## General / NSFW generation, Library, and section profiles — 2026-09-10

現行Studioへ既存`contentRating`契約を露出。生成前はPrompt Dockで一般/NSFWを明示し、Prompt本文と独立したgeneration/history metadataとして送信・session復元する。Libraryは全分類/一般/NSFW/未分類のserver paging filter、カードbadge、Viewerでのgeneration単位再分類を追加。再分類後cache更新、PATCH中navigation競合、390/430px操作重複を回帰検証した。

部分プロファイルentryにも`contentRating: general | nsfw`を追加。保存時に分類を指定し、呼び出し時は全件/一般/NSFWでfilter、初期filterは現在の生成分類。既存profileとbuiltin 20件は一般へ互換normalize。profile適用は生成分類を暗黙変更せず、catalog分類だけをsnapshot/request/history/reuseへ保持する。local/shared API/import/MCPを同じschemaへ更新し、shared save/refresh競合時のID重複も防止。絞り込み0件と保存0件の表示を区別する。

変更: public/{section-profiles,section-profile-samples}.js、core/{section-profile-library,library-service}.js、features/generate-workspace.js、frontendのPrompt Dock/section profile/Image Library/app-shell/CSS、src/{section-profiles,MCP tools}、docs/MCP.md、関連test/smoke、本snapshot。focused profile/rating 67 PASS、Studio integration browser PASS、Library browser PASS、Profile dialog browser Desktop/390/430 PASS。check PASS、full862 total / 860 pass / 0 fail / 既存skip2、diff check PASS。実Provider生成・実iPhone Safari未検証。稼働server/MCPは再起動していないため、共有profileの新分類保存を実運用へ反映するにはWeb Server再起動とMCP再接続が必要。既存dirty差分保持、commit/pushなし。

## Anima Style LoRA classification — 2026-09-10

稼働中3030のForge Neo Anima catalog 158件をread-only棚卸しし、`Anima/Style`直下23件とregistry未登録だった`Anima2.9B/Style/anima29b-turbo-v2.9-remap`を分類。既存PATCHで`subcategory` / `detailCategory`を手動固定し、既存move API（confirmあり）でsidecarを含むfile setを移動した。Kirin R Armorのみ`Anima/Character/Game`、Turbo 2件は各Style/Utility、その他はArtist 10 / Franchise 5 / Render 3 / Enhancer 3。Trigger Words / Negative Words / weight等は変更していない。

移動24/24成功、collision/rollback/deleteなし。Forge Neo LoRA refresh後、対象24件のfolder・subcategory・detailCategory・UID・detailCategory manualField一致、旧`Anima/Style`直下0件、旧`Anima2.9B/Style`直下0件を再取得検証。source code変更・test実行・server再起動・commit/pushなし。registry/local model fileの実データ変更であり、必要時は各UIDのmove APIで旧folderへ個別に戻せる。既存dirty差分を保持。

## Civitai readable metadata / post-install refresh — 2026-09-09

Metadata確認は画像付きmodel overviewへ変更。name/version/type/baseModel/weight/file/size/trainedWords/source linkを表示し、生JSONは閉じたdetailsへ。fallback weightは作者推奨と区別。previewはHTTPS image.civitai.comのみ、失敗時placeholder。URL変更/新inspect/closeで古いmetadata応答を採用しない。install二重click抑止、一覧refresh失敗は成功と区別して案内。

install後のlistLorasForRuntimeはReForge再走査に加え、Forge Neo等もprovider.refreshLorasがあれば使用してから一覧を返す。Studioはその後catalog更新。通常ページreload/Runtime再起動不要、Browserから選択して構成へ追加する（勝手に有効化しない）。今回backend変更を稼働processへ反映するためのserver再起動は未実施。

変更: frontend/components/inspector/{civitai-metadata,advanced-dialog}.js、styles/shell.css、src/server.js、dev/studio/advanced-smoke.mjs、test/civitai-metadata.test.js、本snapshot。check PASS、full858 total / 856 pass / 0 fail / 既存skip2。Advanced fixture browser Desktop/390/430 PASS。画像workbench/r6/civitai-metadata-1440.png（fixture）。実Civitai download/実Provider refreshは未実行。既存差分保持、commit/pushなし。

## Civitai server environment authentication visibility — 2026-09-09

ユーザーは毎回入力ではなく.env自動認証を希望。既存LOCAL_IMAGE_CHAT_CIVITAI_TOKEN resolver/起動scriptの.env読込を確認。ローカル.envの対象entry有無/非空booleanのみ確認（既に設定あり）、実値の表示・記録・変更・実key通信testなし。新GET /api/civitai/auth-statusは稼働processの設定済booleanだけ返す。Studio Tools/Civitaiで確認中/設定済み/未設定/確認不能を表示し、設定場所/サーバー再起動を案内。ブラウザにtoken入力・保存なし。inspect/installは既存server resolverを継続使用。downloadとmetadataの401/403を有効性/アクセス権確認メッセージへ整理。

変更: src/server.js、src/civitai.js、frontend/components/inspector/advanced-dialog.js、dev/studio/{server,advanced-smoke}.mjs、本snapshot。check PASS、full857 total / 855 pass / 0 fail / 既存skip2。Advanced fixture browser PASS、tokenなしrequestでinstall/status表示を確認。画像workbench/r6/civitai-server-auth.png。実Civitai認証/元の失敗原因は未検証。稼働server再起動なし、新status endpoint反映には再起動が必要。既存差分保持、commit/pushなし。

## Shared section profiles / MCP CRUD — 2026-09-09

部分profileのlist/create/update/delete MCP4toolを追加（計13）。API v1 section-profiles GET/POST/PATCH/DELETEとimport endpoint、JsonStoreでdataDir/section-profiles.jsonへ共有保存。Web config sectionProfileApi flagによりStudioはserver catalogを使用。起動/呼び出し時refresh、旧browser catalog/hidden sampleをIDで一度だけ移行。元localStorage保持、remote更新/削除を再移行で覆さない。active snapshot/履歴は独立。通信failure表示、二重click抑止、stale refresh guard、mutation成功後の追加GET失敗で誤って再登録させないcache更新。旧server/fixtureはlocal catalogを保持。

変更: src/section-profiles.js追加、src/api/v1/router.js、src/server.js、src/mcp/{tools,local-image-chat-client}.js、public/core/section-profile-library.js追加、features/generate-workspace.js、prompt/section-profile-controls.js、dev/studio/{server,section-profile-smoke}.mjs、test/{section-profile-mcp,mcp-tools}.test.js、docs/MCP.md、本snapshot。検証: MCP SDK+実HTTPのisolated service CRUD/共有/移行/validation/stale test含むfocused11 PASS、shared browser Desktop/390/430 PASS、check PASS、full857 total / 855 pass / 0 fail / 既存skip2、diff check PASS。実稼働server/MCP再起動は未実施。利用反映はWeb Server再起動→Studio再読込で移行→MCP再接続が必要。実Provider再生成なし。既存dirty差分保持、commit/pushなし。

## Applied profiles in Trigger Words — 2026-09-09

適用中sectionProfilesを表示専用trigger rowsへ変換し、各sectionの既存Trigger Words件数/本文に表示。由来profile名と有効/無効を示し、Raw共通accordionにも表示。無効は無効表示、解除は行を除去。生成合成/state/requestへtriggerを追加せず二重送信を防止。変更: frontend/components/prompt/prompt-workspace.js、dev/studio/section-profile-smoke.mjs、本snapshot。Desktop/390/430 browser PASS、profile行/由来/disable/remove/Final重複なしをassert。check PASS、full855 total / 853 pass / 0 fail / 既存skip2。画像workbench/section-profiles/compact-1440.png。既存差分保持、commit/pushなし。

## Profile samples / inline delete — 2026-09-09

プロファイルcardの削除を名前と同じheader行の右へ移動。Character/Appearance/Composition/Situation各5件、計20件の汎用sampleをpublic/section-profile-samples.jsへ追加。保存済customを先頭に保持し、builtin sampleは選択時のみ適用。削除は専用localStorage key localImageChat.sectionProfileSamplesHidden.v1へIDを記録し再読込で復活させない。既存catalogへ自動書込/上書きなし。変更: section-profile-samples.js、section-profiles.js、section-profile-controls.js、shell.css、test/section-profiles.test.js、本snapshot。focused3 PASS、check PASS、full855 total / 853 pass / 0 fail / 既存skip2、profile browser Desktop/390/430 PASS。画像workbench/section-profiles/picker-1440.png。既存差分保持、commit/pushなし。

## Character profile / aligned section headings — 2026-09-09

キャラクターをPROFILE_SECTIONSへ追加し既存保存/呼び出しdialogとsnapshot合成を利用。全6sectionのheading min-heightを32pxに統一し、button有無でtextarea上端がずれないよう修正。変更: public/section-profiles.js、frontend/styles/shell.css、dev/studio/section-profile-smoke.mjs、本snapshot。Desktopで3組のtextarea上端一致をassert、Character保存/呼び出し/Final反映と390/430をfixture検証PASS。check PASS、full854 total / 852 pass / 0 fail / 既存skip2。既存差分保持、commit/pushなし。

## Compact section profile dialogs — 2026-09-09

ユーザー指示で部分profileのinline保存フォーム/適用accordionを撤去。対象3sectionの見出し横に保存/呼び出しbuttonを置き、各入力欄下は既存Trigger Wordsのみ。保存は名前/本文の専用dialog、呼び出しは検索付き一覧+適用中snapshot編集/有効無効/解除/別名保存のdialog。選択で閉じてPromptへ戻る。Esc/閉じるは子dialogのみを閉じ、元buttonへfocus復元。Rawでは同じbuttonをsection名付きで表示。state/request/storageは変更なし。

変更: frontend/components/prompt/{section-profile-controls,prompt-workspace}.js、frontend/styles/shell.css、dev/studio/section-profile-smoke.mjs、本snapshot。fixture browser Desktop/390/430 save/apply/edit/Raw/disable/remove/reload/Escape PASS。check PASS、全体854 total / 852 pass / 0 fail / 既存skip2。画像workbench/section-profiles/{compact-1440,picker-390,save-dialog}.png。実iPhone Safari未検証、既存差分保持、commit/pushなし。

## Section Prompt profiles — 2026-09-09

容姿・衣装/ポーズ・構図/シチュエーション・背景に部分プロファイルを追加。各欄の本文を保存、名前・内容検索、呼び出し、保存済削除。各section最大1個の適用snapshotを本文と別管理し、accordion内で今回だけ編集/有効無効/解除/別名保存。保存catalogはブラウザlocalStorageのlocalImageChat.sectionProfiles.v1（最大300件）。保存書込失敗は画面に表示しcatalogを更新しない。

canonical draftのsectionProfilesをStructured/Raw両方のFinalへ合成。同一section内の同一タグは合成時に重複回避、手入力本文は不変。Raw編集欄へprofile語を書き戻さない。適用snapshotはsession capture/restoreと生成request→generation-service→history→reuseを通過し、保存元変更/削除とは独立。LibraryのStructured metadata/copyにも適用内容を含める。既存履歴は空profileとして扱う。Rawでは同じ管理controlsをRaw欄下へ移動。

変更: public/section-profiles.js、features/{generation-draft,generate-workspace,generation-controller}.js、frontend/components/prompt/{section-profile-controls,prompt-workspace}.js、frontend/components/library/result-metadata.js、frontend/app/app-shell.js、styles/shell.css、src/{history,services/generation-service}.js、test/{section-profiles,generate-workspace,history,result-metadata}.test.js、dev/studio/section-profile-smoke.mjs、本snapshot。

検証: focused48 PASS、check PASS、full854 total / 852 pass / 0 fail / 既存skip2。profile fixture browser Desktop/390/430でsave/apply/edit/Raw/disable/remove/reload PASS。既存Generate integration browser PASS。画像workbench/section-profiles/。実Provider再生成/実iPhone Safariなし。稼働中serverを再起動していないため、新しい履歴snapshot保存を実運用へ反映するには既存Node serverの再起動が必要。既存dirty差分保持、commit/pushなし。

## Library Structured Prompt metadata — 2026-09-09

LibraryのImage Viewer / Result Metadataで、Structured生成はPrompt欄を既存6section順の`ラベル: 本文`として表示し、空sectionは省略する。Prompt単独copyと生成情報copyも同じ構造表示を使用。Raw生成、旧履歴、全section空は実際の保存`prompt`へfallbackし、生成内容を偽らない。履歴schema・生成request・reuse範囲は変更なし。

変更: frontend/components/library/result-metadata.js、test/result-metadata.test.js、dev/studio/library-smoke.mjs、本snapshot。result metadata unit 3 PASS、check PASS、full849 total / 847 pass / 0 fail / 既存skip2、Library fixture browser 1280/1440/1920/390/430・表示/copy/Structured reuse PASS。既存Recent click契約に合わないLibrary smoke冒頭の旧Viewer期待を除去。実Provider再生成・実iPhone Safari検証なし。既存差分保持、commit/pushなし。

## Recent Canvas selection / image fullscreen — 2026-09-08

Recent strip/Recent dialogの画像選択はshell内の閲覧選択として中央Canvasのみ切替。Draftとcore completed/current candidateは変更せず、表示中recordをResult Metadata/Image Viewer/明示Seed reuseへ渡す。新規生成開始または新しい完成recordで閲覧選択を解除。Library gridは従来のViewer操作を維持。

Canvas click/Enter/Spaceは画像専用の全画面dialogを開く。Fullscreen API対応時はnative fullscreen、非対応/拒否時もviewport全体へcontain表示。閉じる/ESCで戻る。右上Image Viewer buttonは現在Canvas画像のmetadata/reuse Viewerを開く。Canvas toolbarのZoom +/-/Fitを撤去。Viewer内のzoom機能は保持。

変更: frontend/app/app-shell.js、components/canvas/{canvas-toolbar,fullscreen-image}.js、components/library/image-library.js、styles/shell.css、dev/studio/integration-smoke.mjs、本snapshot。check PASS、全体841 total / 839 pass / 0 fail / 既存skip2。fixture integrationでRecent→Canvasのみ/Seed保持、全画面/keyboard、専用Viewer、候補/再利用/生成を検証。Desktop/390/430でRecent/Viewer/fullscreenを確認。画像 workbench/r3/{recent-canvas-1440,canvas-image-fullscreen,fullscreen-390,fullscreen-430}.png。実iPhone Safari/実Provider再生成なし。既存差分保持、commit/pushなし。

## Checkpoint managed quality tags — 2026-09-08

直近50生成（2026-09-05 05:59〜09-08 03:49 JST、画像枚数ではなく生成record数）の上位2件: One obsession Anima v3.0 37件、Anima-2.9B v1.0 10件。公開Civitai APIでインストール済hash ed32d6584f / 0b3020d1b9をそれぞれmodel 2695493 version3190113 / model2855007 version3224434へ照合し、作者の説明・公開作例から品質タグを登録。前者は作者Positive例の品質10語（rating指定sensitiveを除外）と公開作例で共通するNegative品質10語、後者はPositiveのhighres/absurdresのみ。年代・画師・Steps・CFG等は自動変更しない。

selectedCheckpointから派生する管理タグとしてPositive/Negativeを別系統でFinal Promptへ合成。手入力Structured/Raw/Negative本文と保存Draftには書き込まない。Negativeはユーザー本文内とCheckpoint内で重複除去し、Positiveと同じ文字列でも混同しない。Checkpoint切替・Profileなし・履歴reuseでは現在のselectedCheckpointから再解決する。新規履歴はユーザーNegative本文を互換フィールドで分離保存し、旧履歴は従来のnegativePromptへfallbackする。hash不一致の別versionには適用しない。

変更: public/checkpoint-style-profiles.js、features/{generation-draft,generate-workspace,generation-controller}.js、frontend/components/{prompt/prompt-workspace,library/result-metadata}.js、frontend/styles/shell.css、src/{history,services/generation-service}.js、関連test/browser smoke、本snapshot。検証: focused52 PASS、check PASS、full847 total / 845 pass / 0 fail / 既存skip2、fixture browser Desktop/390/430・Structured/Raw・本文/Final分離 PASS。実Provider再生成・実iPhone Safari検証なし。既存差分保持、commit/pushなし。画像: workbench/checkpoint-style/。

## Canvas click to enlarge — 2026-09-08

Studioの表示画像をクリック/Enter/Spaceで既存Image Viewerへ開く。現在選択candidateの画像/完成recordを渡し、Fit/Zoomを利用。閲覧だけではDraftを変更しない。imageに拡大cursor/keyboard操作を付与。変更: canvas-stage.js、app-shell.js、image-library.js、shell.css、integration-smoke.mjs、本snapshot。

検証: check PASS、full837 total / 835 pass / 0 fail / 既存skip2。Generate integration PASS、画像click/Enter→Viewer/Zoom/Fit/EscapeとSeed不変を確認。fixture screenshot workbench/r3/canvas-image-expanded.png。実Provider再生成なし。既存差分保持、commit/pushなし。

## Active Composition outfit workflow — 2026-09-08

ユーザー依頼: 衣装selectをActive CompositionのWeight左へ移動。detailの挿入先select/衣装select/挿入buttonとComposition並替上下buttonを撤去（contractの順序APIは保持）。選択した衣装は既存profile/registry choicesから解決し、outfit-state由来付き管理Triggerとしてappearanceへ即時反映。衣装なしで解除、衣装変更は旧衣装由来だけ置換。本文変更なし。LoRA無効/削除と連動し、capture/reuseでも選択復元。Character LoRAの自動base登録は既存resolveLoraBaseTriggerWordsを使い衣装タグと分離。

変更: features/{generate-workspace,generation-draft}.js、frontend/components/lora/{active-composition,lora-browser,lora-details}.js、prompt/prompt-workspace.js、styles/lora-browser.css、test/generate-workspace.test.js、dev/studio/lora-smoke.mjs、本snapshot。check PASS、全体837 total / 835 pass / 0 fail / 既存skip2。対象31 pass、LoRA browser Desktop/390/430 PASS。衣装変更/解除/無効/削除/Raw/履歴reuseを確認。workbench/r4/composition-editing-1440.png、mobile-composition-390.pngを画像として会話へ提示。実Provider再生成なし。既存差分保持、commit/pushなし。

## Section Trigger Word accordions — 2026-09-08

ユーザー依頼: 各Structured入力欄の下にTrigger Words件数付きのdetails/summaryを配置。キャラクター・容姿衣装を含む6sectionそれぞれでtargetFieldに対応する管理語を表示。本文への書込みなし。閉状態を初期値とし、語/由来LoRA/Weight（1以外）/有効状態を閲覧可能。state更新でdetails自体を作り直さず開閉状態を保持。Rawは入力欄下の共通accordion。画風品質も同形式とし、Checkpointタグの自動適用は今回未実装。

変更はpublic/frontend/components/prompt/prompt-workspace.js、styles/shell.css、dev/studio/lora-smoke.mjs、本snapshot。check PASS、full836 total / 834 pass / 0 fail / 既存skip2。LoRA browserでsection位置/初期閉/展開維持/本文不変/Final送信を確認。Shell browser Desktop/390/430pxもPASS。画像workbench/r4/section-triggers.pngを会話内に提示。既存dirty差分保持、commit/pushなし。

## Prompt entry/import and managed LoRA triggers — 2026-09-08

最新ユーザー指示「Promptに直書きしない」を優先。Prompt Dockの編集入口はStructured/Raw · 編集の1つに統合し、隣へImport Prompt追加。既存parseAiPromptOutputで貼付文章を解析し、preview/未認識行を表示して明示適用。section付きはStructured置換、見出しなしはRaw、Negative未記載は保持。

LoRA Browser追加時は本文追記を廃止し、canonical appliedTriggerWordsへ由来LoRA/targetField付きで登録。Structured/Raw本文を変更せずFinal Promptで合成。共有語は由来を併合、disableで非反映、removeで該当由来のみ除去。Raw切替初期化や生成完了時も管理語を本文へ書き戻さない。Prompt Workspaceに別枠表示、LoRA追加時は登録/既存/未登録の結果を通知。以前の実装で本文へ追記済みの語の自動削除は行わない。

変更: components/prompt/{prompt-dock,prompt-workspace,prompt-import-dialog}.js、components/lora/lora-browser.js、app/app-shell.js、styles/shell.css、features/{generate-workspace,generation-draft}.js。test/studio-prompt-import.test.js追加、generate-workspace.test.jsとdev/studioのintegration/lora/smoke更新。既存dirty差分を保持しcommit/pushなし。

検証: focused32 pass、check PASS、full836 total / 834 pass / 0 fail / 既存skip2。Import Desktop/390px、Structured/Raw/Negative、managed trigger合成/本文不変/disable/remove/共有語、LoRA/Generate integration browserを確認。実Provider生成なし。以下は以前の時点の記録であり本文への自動追記という記述は今回更新で廃止。

## Right Recent / header cleanup — 2026-09-08

ユーザー依頼: 仮表示Personal workspace / Untitled studyをapp barから削除。nav挿入先をapp-bar-actionsへ変更。Desktop Studioを左制作310px・中央Canvas・右Recent120–180pxの3列へ変更し、下段100pxをCanvasへ戻した。Recentは縦scroll・画像比率保持、Libraryは全幅を維持、Mobileの配置は維持。変更はapp-bar.js / app-shell.js / shell.css / integration-smoke.mjs / 本snapshot。既存未commit・別作業差分を保持、commit/pushなし。

検証: check PASS、full 834 total / 832 pass / 0 fail / 既存skip2。Generate integrationとLibrary browser PASS、Desktop右位置assertion、390/430px、縦長・横長candidateをfixtureで確認。実Provider再生成なし。縦長完成画像のスクリーンショットを会話へ提示。

## Studio creation layout / readable metadata — 2026-09-08

ユーザーの新旧比較と追加コメントに基づく通常のUI改善。Desktopは左310pxにModel/Resolution preset入口/LoRA/6section Prompt入口・Negative・Final Preview/Sampler/Scheduler/Steps/CFG/Width/Height/Seed/Generateを集約。中央Canvas、下Recent（最大12画像）。New Prompt WorkspaceとLibrary grid、既存workspaceの生成・排他・再利用contractを維持。Desktopの設定は常設、Mobileは制作設定パネル。Mobile→Desktopでoverlay状態をクリアし再縮小時の操作遮蔽を防ぐ。

Library詳細と結果パネルは共通readable metadata表示。Checkpoint/Runtime/Resolution/選択画像Seed/Sampler/Scheduler/Steps/CFG/LoRAをラベル表示し、Prompt/Negative/Raw Metadataはdetailsへ。Rawは初期折り畳み。Library上部にStudioで再利用、metadata内にPrompt/生成情報copy（成功/失敗表示）。再利用範囲は既存のまま、Checkpointは対象外と画面に明示。画像を開くだけではDraft変更なし。

変更: public/frontend/app/app-shell.js、components/{canvas/canvas-toolbar,inspector/inspector-panel,library/image-library,library/result-metadata}.js、styles/{shell,image-library}.css。test/result-metadata.test.js追加、dev/studioのshell/integration/library/production/real系smoke selectorを現UIへ追従。前回LoRA自動Trigger/Reuse移動と別作業dirty差分は保持。commit/pushなし。

検証: check/full suite（834 total / 832 pass / 0 fail / 既存skip 2）、Shell/Generate integration/LoRA/Library fixture browser PASS。1280/1440/1920/390/430px、Prompt両mode、生成/Cancel/失敗/再利用/candidate、Recent→画像詳細、copy、viewport切替を確認。Desktop Canvas高は900px viewportで624→702、1080pxで782→882、Mobileは496/584を維持。画像証拠workbench/r2,r3,r4,r5、会話へ画像データでも提示。実Provider生成・実iPhone Safariは今回未検証。Frontend Rebuild基準checkpoint25e1127は変更していない。

## Studio usability follow-up — 2026-09-08

ユーザー依頼の2点を完了。LibraryのReuse settingsをViewer上部のFit/Zoom/Compareと同じ操作列へ移動。LoRA Browser追加時はworkspace.addLoraのinsertTriggersでcanonical Structured sectionへ編集可能なTrigger Wordを追記。既存classifyTriggerField（分類優先→keyword→extra）を使用し、Raw modeはRawへ追記。既存文章/Negative/別modeのdraftを保持、重複語を再追加しない。backendへのtriggerWordsは空にしてFinal Preview外の追加を防止。登録Triggerなしは追記なし。追記した文章は通常の編集textであり、LoRA無効化/削除では自動削除しない。

変更: public/features/generate-workspace.js、public/frontend/components/{library/image-library,lora/lora-browser}.js、test/generate-workspace.test.js、dev/studio/{library,lora}-smoke.mjs、本snapshot。検証: focused 30/30、check exit 0、全体833 total / 831 pass / 0 fail / 2既存skip。LoRA/Library fixture browser PASS（Desktop、390/430px）、Viewer1440/390 screenshot目視確認。証拠workbench/r4・r5。実Provider生成/実iPhone Safariは今回は未検証。既存別作業差分を保持し、今回commit/pushなし。基準checkpointとremoteは25e1127のまま。

## Remote backup / closure — 2026-09-08

Frontend Full Rebuild R1–R7は `25e1127` を基準点として完了。`origin/checkpoint/frontend-refactor-phase13` へ同名branchをpush済み、upstream設定済み。mainへのmergeなし。未追跡555件を分類し、生成・検証画像11件を狭いignore候補として記録。削除・移動・.gitignore変更・追加commitなし。Pearl Glass等の既存差分は保持。

[バックアップ・分類・Library flaky追跡メモ](checkpoint-backup-and-untracked.md) を参照。今回の変更は本snapshotと同メモのみ。実装/test/実Provider再実行なし。以後は実使用から出た個別issueとして対応する。以下のpushなし等は各作業時点の過去記録。

## Checkpoint split — 2026-09-08

ユーザーGOによりR1–R7だけを3commitへ分割。共通contract `a38f3b3`、New Studio workflows `b7583c6`、Production切替は本記録を含むcommit。Pearl Glass/旧Gallery、Lab、Artist catalog、検証画像・browser sessionは未commitで保持。pushなし。

各index treeをTEMPへ独立展開して検証。Git archiveの改行変換を無効にして保存内容どおりのLFで実行し、checkとfull suiteはそれぞれ814/812 pass、825/823 pass、827/825 pass（全てfail 0、既存skip 2）。832件の過去working-tree gateとの差5件は、除外した旧Gallery改修test。New Studioのfixture browser5本を候補treeで確認。Library smokeはviewport切替直後のoverflow assertionが一度失敗し、同一tree再実行でPASSした。実Provider生成・Production再起動はcheckpoint作成では再実施していない。

## Frontend Full Rebuild — R5 / R6 / R7 completed

2026-09-08: **New StudioをProduction defaultへ切替済み**。通常 `http://127.0.0.1:3030/`、明示rollback `/?legacy=1`。ユーザーのAutonomous Completion Runを単一agentで完了。stage / commit / pushなし。開始時のR1–R4・legacy・文書・未追跡/private/generated差分を保持。

R5: actual full Library / 全保持履歴search・Newest/Oldest / paging / Recent / Fit/Zoom Viewer / Metadata / 明示Reuse。R6: Hires・Canvas Inpaint・IP reference・Compare・Experiments・Civitai入口・Profiles/Checkpoint Sets/outfit、canonical Draft保存・実行中Job GET reattach。R7: native ESM本番bootstrap、明示legacy entry、SW/cache/static/updater coverage。Structured6section / Raw / Negative / Final PreviewとCanvas/Dock寸法を維持。

今回の最終gate: check PASS、full **832 total / 830 pass / 0 unexpected fail / 2 existing skips**。R2–R6 browser PASS。Production 5幅1280/1440/1920/390/430で各surface、refresh/direct navigation、旧cache除去、legacy load PASS。Production実生成2回＋Cancel、生成中reload→同一Job再接続、History→Reuse→再生成、Mobile実Generate/Cancel PASS。実AdvancedはSteps8/10のExperimentで2画像完成。実iPhone Safariは未検証。

最初に読む: [最終実装・検証・変更file・制約](frontend-full-rebuild-final.md) → [本番entry](../../src/frontend-entry.js) → [workspace contract](../../public/features/generate-workspace.js) → [Production smoke](../../dev/studio/production-smoke.mjs)。証拠`workbench/final/`。Forge Neoは既存仕様でHires/Inpaint/IP非対応（対応ReForge contractはintegration検証）。local upload/maskはreload保存対象外。Legacyはrollback用に保持。追加Phaseへ進まず完了。

以下は以前のcheckpoint記録であり、現在のProduction entry・検証結果は上記を優先する。

## Previous checkpoint — R4 completed

2026-09-08追補: ユーザー指定によりLoRA folder操作を左の階層ツリーへ集約。開閉・子folder選択・root/親へ戻るを左だけに置き、上部は現在位置の表示のみ、asset grid内のfolderボタンは削除。Mobile/TabletはFoldersから同じ左drawerを開く。folder選択/展開を保持し、Escapeはdrawer→Browserの順に閉じる。変更はBrowser/CSS/R4 smokeと文書のみ。今回check PASS、全体821 total / 819 pass / 0 fail / 2 existing skips、R4 smokeおよび実catalog Desktop/390px確認PASS。実生成は今回再実行していない。Canvas/Dock寸法維持。証拠 `workbench/r4/left-tree-{desktop,mobile}.png`。

2026-09-08: **R4 Full LoRA Browser + Composition Workflow完了**。サブエージェントなし。Dockから独立LoRA Browserへ入り、folder/back/breadcrumb/root・global search・共有Favorite・preview/details・明示trigger挿入・Active Compositionの追加/weight±/数値/enable/remove/上下移動が成立。R1 canonical LoRA stateを共有し、旧DOM/CSS依存なし。Structured 6 sections / Raw / Negative / Final Previewと「構造プロンプト」の見出しを保持。Production切替なし、R5未実施。

検証: check PASS、full **821 total / 819 pass / 0 fail / 2 existing skips**、R2/R3/R4 browser smoke PASS。実Forge Neo / Anima・現在のoneObsessionAnima_v30でflat-color LoRA 0.55の有効/無効2jobが成功し、実画像をCanvasへ表示。実catalog148件・既存Favorite10件、初期60件描画。R3比Canvas/Dock寸法は5幅すべて維持。390/430px fullscreen・440px高さ・focus/Escape/復帰を確認。実iPhone Safari/実soft keyboard未検証。

開発entry: `npm.cmd run studio:dev` → `http://127.0.0.1:41972/studio-next/`。既存3030 backendへ接続し、Favorite ensure/PATCHを開発gatewayに追加。Production app/index/style/serverのhashは維持。開始時のdirty/未追跡成果物を保持し、stage/commit/pushなし。

最初に読む: [R4実装・変更file・検証・制約](frontend-full-rebuild-r4.md) → [Browser](../../public/frontend/components/lora/lora-browser.js) → [R1 workspace](../../public/features/generate-workspace.js) → [R4 smoke](../../dev/studio/lora-smoke.mjs)。証拠はignored `workbench/r4/`。スクリーンショットは会話へ画像データとして提示。R5以降のLibrary/高度機能/session保存/Production切替は別途指示を待つ。以下は過去milestone。

## Frontend Full Rebuild — previous R3 milestone

2026-09-07: **R3 Real Generate Workflow Integration完了**。サブエージェントなし。Structured 6 sections / Raw / Negative / Final Preview / Dock / Workspaceを維持し、実Generate・Cancel、Model Picker、Resolution/Seed/Active LoRA/Candidates、InspectorのSampler/Scheduler/Steps/CFG、結果metadataと明示Reuse、Recovery dialogを接続。通常entryは `npm.cmd run studio:dev` → `http://127.0.0.1:41972/studio-next/`、既存3030 backendへ開発専用gatewayで接続。R2 mockは明示`?fixture=r2`だけ。Production切替・R4は未実施。

実Provider: Forge Neo / Anima + anima29B_v10、768×768 / 16 stepsでNew Studio→実job→完成画像→Canvas成功。Seed 314159→314160の再生成とCancelも確認。実browser page/console error 0。詳細job ID・初回検証harnessのtimeout修正・画像は[R3記録](frontend-full-rebuild-r3.md)。実生成のbefore/generating/completedとMobile画像を会話へ画像データとして提示。

検証: check成功、full suite **815 total / 813 pass / 0 fail / 2 existing skips**。R2 browser smoke PASS。R3 integrationはPrompt/request一致、settings、model失敗/selection、LoRA、candidate/metadata/reuse、double submit、cancel、failure、recovery承認、Runtime unavailable/backend再接続をPASS。5幅のCanvas/Dock寸法はR2と一致（1440:624/178px、390:496/202px）。実iPhone Safari/実soft keyboard未検証、440px高さの編集確認で代替。

変更: 新generation projection・settings/dialog/Recovery components、既存新Shellの接続、R1のcancelRequested/guard/catalog refresh、dev server/boot/smoke、test、packageと引継ぎ文書。開始時のdirty/未追跡成果物を保持。Production index/style/app/serverは開始時hashと一致。stage/commit/pushなし。

最初に読む: [R3実装・制約・検証](frontend-full-rebuild-r3.md) → [Shell接続](../../public/frontend/app/app-shell.js) → [R1 contract](../../public/features/generate-workspace.js) → [integration smoke](../../dev/studio/integration-smoke.mjs)。Full LoRA Browser/Library、advanced生成機能、session restoreは後続範囲。Clip Skipは現R1 parameter contractにないため未追加。R3で停止。以下は過去milestoneの記録。

## Frontend Full Rebuild — previous R2 milestone

2026-09-07追補: **Structured PromptをPrimary Workflowに修正**。Dockは既存6sectionのcompact summary、展開先は独立Prompt Workspace。Structured / Raw / NegativeとFinal Positive・Negative previewをR1 stateへ接続。mode切替時はStructuredとRaw編集を保持（空Rawを含む）。詳細は[R2追補](frontend-full-rebuild-r2.md)。今回focused 27 pass、check成功、full suite **811 total / 809 pass / 0 fail / 2 existing skips**。Browser smokeは5幅・個別section編集・mode往復・preview・NegativeをPASS、console/HTTP error 0。スクリーンショットは`workbench/r2/prompt-*`へ保存し、会話にも画像データで直接提示。新Prompt WorkspaceとDock/app-shell/CSS、fixture boot、generation-draftのmode境界、test/smoke/packageを変更。Production変更とR3の実生成接続はなし。以下の初回R2結果は追補前の記録。

2026-09-07: **R2 New Application Shell + Visual Direction Gate完了**。サブエージェントなし。独立DOM/CSSのCanvas中心Shell、App Bar内Studio/Library nav、下部Prompt Dock、必要時右InspectorとMobile sheetを実装。開発専用entryは `npm.cmd run studio:dev` → `http://127.0.0.1:41972/studio-next/`。R1のinitialize/snapshot/subscriptionとPrompt更新を接続。Generate・Canvas lifecycle・Library画像はfixture/mock。Production切替とR3は未実施。

最初に読む: [R2実装・画像・検証](frontend-full-rebuild-r2.md) → [新Shell](../../public/frontend/app/app-shell.js) → [dev entry](../../dev/studio/boot.js) → [R1 contract](frontend-full-rebuild-r1.md)。変更は新`public/frontend/`、`dev/studio/`、`test/frontend-shell.test.js`、package scripts、本snapshotとR2記録。R3から既存workspaceのGenerate lifecycle・parameter/model/LoRA/historyをcomponent callbackへ接続可能。現時点でR3接続を阻害する問題は確認なし。

検証（今回実行）: focused 25 pass、check exit 0、full suite **809 total / 807 pass / 0 fail / 2 existing skips**。Chrome browser smoke PASS、1280/1440/1920/390/430とCanvas5状態、nav/Inspector/resize/draft保持を確認。console/HTTP/external request 0、横overflowなし。スクリーンショットを`workbench/r2/`へ保存し目視確認。Productionのindex/style/app/serverは開始時SHA256と一致。実provider生成・実iOS/Safari・soft keyboardは未実施。

保持: 開始時のR1・既存UI・文書・test・未追跡成果物を保持。依存追加、stage/commit/pushなし。R2で停止。以下は過去milestoneの記録。

## Frontend Full Rebuild — previous R1 milestone

2026-09-07: **R1 Functional Contract Characterization + Adapter Boundary完了**。サブエージェントなし。DOM非依存の`createGenerateWorkspace`、canonical JS draft、Runtime service、共通request/settings/Recentを実装。旧UIは同じRuntime/request/settings/Recent coreを旧adapterから使用。Production entryとHTML/CSSは変更なし。R2未着手。

最初に読む: [R1実装・API・制約](frontend-full-rebuild-r1.md) → [公開workspace](../../public/features/generate-workspace.js) → [behavior tests](../../test/generate-workspace.test.js) → [承認済み計画](../ui/frontend-full-rebuild-plan.md)。R2はこの公開contractでNew Shellの基本Generateを組める。高度機能、Checkpoint Set/profileの新entry接続、全保存restore、全Galleryは後続範囲。

検証: baseline 782 pass、最終805 total / **803 pass / 0 fail / 2 skips**、check exit 0。新21 behavior tests。旧source位置に依存した3検査を抽出先／behaviorへ追従後に全green。Chrome隔離fixtureで旧UI生成・metadata reuse・1440/390/430、空documentで新contract生成・reuse成功、console/HTTP error 0。Node smoke PASS。実provider/実Safari未実施。詳細・log位置はR1記録。

保持: 開始時のdirty UI/文書/testと未追跡成果物を保持。新6production modules、旧4modulesの限定接続変更、package check登録、test3files、引継ぎ文書のみ。stage/commit/pushなし。R1で停止。

## Frontend Full Rebuild — previous planning milestone

2026-09-07: 新しい明示依頼に基づく**Frontend Product RedesignのFirst Deliverable（R0 Planning）を作成**。旧UIを配置の参考にせず、Canvas中心・下部Prompt dock・必要時Inspector・同じStudio内のLibraryという新IAを提案。Production実装・default切替は未実施。

最初に読むfiles: [Full Rebuild Plan](../ui/frontend-full-rebuild-plan.md) → [Desktop / Mobile wireframes](../ui/frontend-full-rebuild-wireframes.md) → [継続contract](decisions.md)。新計画にはaudit、四分類、機能contract、design system、component構成、移行/risk/R0–R9と検証gateを記載。旧DESIGNの配置条件より今回のゼロベース設計依頼を優先し、旧DESIGN自体は稼働UIの履歴として保持した。

今回変更: 上記新規2文書と本snapshotのみ。静的source/配信/SW/updater確認、文書リンク・内容・whitespace確認を実施。test suite/browser/実provider生成は未実施。以下の782 pass等は旧UIの過去検証で、新UIの検証結果ではない。

保持: 開始時のDESIGN、CURRENT_TASK/REVIEW_FIXES、app/index/style、History/Studio、関連test、既存未追跡docs/output/scripts等の差分。削除・stage・commit・pushなし。次候補はR1 contract characterizationとform/presentation adapter境界の確定。その後R2で独立shellを構築する。新UIの機能parityと配信gate前にProductionを切り替えない。

## Previous production snapshot — Pearl Glass implementation

更新: 2026-09-07。branch `checkpoint/frontend-refactor-phase13`にPhase 1–23完了checkpoint `refactor: complete frontend extraction through phase 23`を作成。Phase 22 rollback point `2e37ec9`を保持し、pushなし。

## Current / completed

**UI Renovation: B / Pearl GlassのProduction実装をユーザーが承認し、Astra単独で実施（2026-09-07）。** 左編集＋右画像＋下Recent、Glass配色、Runtime/Checkpoint開閉、主要設定の選択、LoRA小型picker/フォルダ再開/Weight±、Gallery画像＋metadata/前後移動/自動追加を実装。詳細は[実装記録](../ui/ui-glass-implementation.md)。場面保存・新API/schema・provider変更・commit/pushは対象外。

前提修正: History filter旧応答排除、Studio Recent freshness、Checkpoint Set適用後summary/stats同期。Raw/Structured/LoRA/Recipe/Generationの既存owner/適用契約を保持。前からあるCURRENT_TASK/REVIEW_FIXES/未追跡docs/output等を保持。

検証は実装記録を正本とする。Chrome隔離fixtureで1366/1920/2560/狭いPC相当/390/430、Scheduler/解像度、LoRA、Gallery詳細、Recipe復元、生成中画面遷移を確認。実Safariと実provider生成は未検証。最終check exit 0、full test 784件中782 pass / 0 fail / 2 skips、git diff --check exit 0（2026-09-07）。次は本人による実環境の操作確認。Galleryの検索・oldest等は取得済み範囲という既存制約を残す。全履歴検索/sortを実現するserver契約変更、場面保存は別の適合設計。

最初に読むfiles: [実装記録](../ui/ui-glass-implementation.md) → [DESIGN](../../DESIGN.md) → [比較と採用記録](../ui/ui-visual-mock-comparison.md) → [UI boundaries](../refactor/ui-renovation-boundaries.md)。以下はPhase 23完了時のsnapshot。

**Frontend Refactor Phase 23 Persistence / Bootstrap完了。Phase 1–23のfrontend refactor roadmap完了。**

[Phase 23記録](frontend-refactor-phase23.md) に起動順、Persistence ownership、controller init、listener/monitor/page teardown、storage互換、検証根拠を記録した。Phase 23完了で停止し、UI新築や次作業へ自動で進まない。

`public/core/preferences.js`へapp-owned storage keyと既存serialization/fallback、`public/features/settings-update.js`へGitHub session tokenとversion/update、`public/app/bootstrap.js`へ明示startup phase・static listener registry・single page teardownを抽出。`public/app.js`は **4,479 → 4,352行（127行減）**となり、DOM/dependency composition → controller作成 → restore/load → init/startを読むcomposition rootへ整理した。

HTML/CSS、backend/API、History、storage key/schema/version、Service Worker/cache/update strategy、Runtime/Prompt-LoRA/Recipe/Generation semantics、framework/build systemは変更していない。新しいarchitecture decisionは生じず、`decisions.md`は変更していない。

## Bootstrap / ownership snapshot

起動順:

1. Runtime → Checkpoint Set → LoRA Library → Civitai pre-config init。
2. `/api/config` → `/api/runtimes`とconfig-backed preference restore。version contractは従来どおり非blocking。
3. title/checkpoint/img2img/Inpaint/Prompt parts/GitHub session token restore、PWA `/sw.js`登録、initial UI preparation。
4. health、checkpoint、LoRA、History、Civitai folders、LoRA root、Experiment、Checkpoint Set、Discord、Prompt template、AI share、Sampler、Storage、IP optionsを既存`Promise.all`で1回load。
5. initial state/render sync → app-lifetime Queue monitor → primary listener → controller init → feature listener → saved view → late Prompt listener → single page teardown。

post-load controller init順:

```text
Navigation → Sampler → Settings Navigation → Discord Settings → Storage Settings
→ AI Share → Queue → Image State → Studio → Comparison → History → Experiment
→ Reference Image → Inpaint → IP-Adapter
```

`PROFILE_STORAGE_VERSION = 3`、全`localImageChat.*` key、string/JSON/array/Map/Set変換、破損/missing fallbackを維持。GitHub/Civitai tokenはsessionStorage限定。Navigation、Runtime、Sampler、LoRA Library、Civitai、Inpaint等のfeature keyは各controller ownershipのまま明示storage portを受ける。

Queue/Experiment monitorはnavigationで停止せずapp lifetime。page teardown時はstatic listenerを解除し、controllerをreverse disposeする。Queueはsleep中とin-flight GET後の両方にlifecycle guardを持ち、teardown後にrender/通知/History refreshしない。Reference/IPはapp composition時のみ個別`beforeunload`を抑止し、single teardownからobject URL/pending readを一度だけ破棄する。navigation disposeとJob cancelは接続していない。

## Verification

2026-09-07、architecture review修正後の最終production:

- affected focused 8 files: **101 total / 100 passed / 0 failed / 1 existing skip、exit 0**。
- broad focused 33 files: **350 total / 348 passed / 0 failed / 2 existing skips、exit 0**。
- title部分成功fallback補正後のaffected focused 4 files: **54 passed / 0 failed / 0 skipped、exit 0**。
- `npm.cmd run check`: **exit 0**。新3moduleと監査で既知の既存漏れ9 JS fileを明示列挙へ追加。
- 最終 `npm.cmd test`: **779 total / 777 passed / 0 failed / 2 existing skips / 0 todo、exit 0**。初回full（778 total / 776 passed）後、厳密なtitle部分成功fallback補正が入ったためpost-review production修正例外としてaffected/check/fullを再実行した。最終full後は文書のみ。
- 実Chrome 152.0.7977.77 + loopback fixtureのcomplete cycle: **PASS**。fresh load/initial render、assert対象initial fetch各1回、Runtime/catalog、Prompt/settings/profile save/restore、Gallery/Generate、reload、corrupt JSON fallback、fixture generationを確認。console error/warning、uncaught、unhandled rejection、HTTP failure、external requestはすべて **0**。server停止済み。
- Browser完走前にignored harnessのhidden control操作/fixture profile idを3回修正した。各途中停止はapp errorではなく、production差分なし。修正後のcomplete sequenceがgreen。
- Browser後のtitle補正はnormal browser pathを変えないため反復せず、affected/check/fullで最終productionを確認。
- Astra read-only architecture reviewを1回実施。P1なし。P2 Queue in-flight teardownとP3 title grouped storage fallbackを修正し、回帰testと全gateで確認。重大findingなし。
- `git diff --check`と最終scope/statusは文書更新後に確認。test logはrepository外 `%TEMP%/local-image-chat-phase23-*.log`。

## Working tree / constraints

Phase 23 checkpointには、上記3module、`public/app.js`、Queue/Reference/IP lifecycle、関係test、`package.json`、本書とPhase 23記録を収録。ignored `workbench/ui-mocks/phase23/`にsmoke script/screenshotを保持する。

開始時からの `docs/CURRENT_TASK.md` / `docs/REVIEW_FIXES.md` と、未追跡の文書/artist-catalog/GPU Lab/画像/output/scripts等をそのまま保持した。private/local/generated artifactをstageせず、削除・巻き戻しなし。

## Remaining / UI新築前の竣工検査

`app.js`にはDOM cache、form/read/render/persistence adapter、Prompt/LoRA profile適用、Runtime/Recipe ports、派生フォーム準備、composition lockが残る。これは既存owner間のcompositionであり、中央storeや逆importへ変更していない。History空結果時の再fetch、health fallback時の再取得、Queue terminalとGeneration完了からのHistory refreshは既存semanticsとして残る。

UI新築前は、(1) fresh/missing/corrupt/reload storage matrixと全key snapshot、(2) startup/init/listener/fetch/monitor count、(3) slow Runtime/health/catalogとnavigation race、(4) Runtime→capability、Prompt-LoRA→Checkpoint Set/Recipe、Image State→Studio/Gallery、Queue→Generation terminalの結合、(5) navigation後stateとpage teardown/object URL、(6) History/Gallery pagination/filter/Favorite、(7) PWA/static/update contract、(8) desktop/mobile/Safari layout/accessibility、(9) fixture全経路、(10) 別承認gateで実provider/実機を検査する。

次回の最初のreadは [AGENTS](../../AGENTS.md) → 本書 → [Phase 23](frontend-refactor-phase23.md) → [decisions](decisions.md) → `public/app/bootstrap.js` / `public/core/preferences.js` / `public/features/settings-update.js`。Phase 22以前の生成・Recipe境界は各Phase記録を参照する。
