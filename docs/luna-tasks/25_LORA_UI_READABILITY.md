# Task 25: LoRA選択・管理UIの可読性改善

更新日: 2026-08-29
状態: **設計完了／Luna実装待ち**
担当: Luna
設計・レビュー: Codex

## 目的

生成画面の「LoRAを追加」モーダルと、設定画面の「LoRA管理」を読みやすく整理する。

- 生成画面: 今回の生成へ使うLoRAを素早く探して追加する場所。
- 設定画面: 所有LoRAを検索し、1件ずつ確認・編集する場所。
- 一覧では識別に必要な情報だけを表示し、長い詳細はプレビュー／編集側へ集約する。

今回の対象は表示密度、情報の優先順位、スクロール構造、レスポンシブ時の詳細導線だけである。LoRAの取得・分類・選択・Weight・Favorite・Trigger Words・衣装プリセット・Civitai登録など、既存機能と保存形式は変更しない。

## 最優先追加要件：ファイルの所在を探せること

現在の最大の問題は、LoRAのフォルダ階層が大量のchipと平坦なgroupへ変換され、「どのフォルダへ何が入っているか」を追えないことである。見た目の整理より先に、folderを第一ナビゲーションとして扱う。

既存LoRA DTOの`folder`、`name`、registryの`relativeName`など、既に公開されている相対情報だけを使用する。Windows絶対パスやRuntime内部pathを新たにブラウザーへ公開しない。

共通要件:

- `/`と`\\`を表示用だけ`/`へ正規化し、segment単位のfolder treeを構築する。
- 例: `Anima/Character/Arknights`は`Anima > Character > Arknights`として展開する。
- 親folderの件数は配下を含む再帰件数、末端folderは直下件数を表示する。
- `(ルート)`を明示し、folder未設定LoRAを見失わない。
- folder選択時は配下を含めるか直下だけかを一貫させる。初期版は「選択folder配下をすべて含む」とし、breadcrumbで現在地を示す。
- 検索は全folder横断を既定とし、結果カード／行に相対folderを表示する。
- 検索結果を選んだ場合、そのfolder treeを展開して現在位置を同期する。
- 同名LoRAが別folderに存在しても、相対folder表示によって区別できる。
- treeの展開状態と選択folderは画面内で維持する。新しい永続保存keyは必須ではない。
- folder名と相対LoRA名は表示用に省略してよいが、`title`で全文を確認できる。
- Settingsでは既存`POST /api/lora/open-root`を再利用した「LoRAルートを開く」をfolder pane上部へ置く。
- 初期版では任意folder pathを受け取る新APIを追加しない。「選択中folderをOSで直接開く」は別Task候補とする。

推奨共通helper:

```text
buildLoraFolderTree(items)
getFolderDescendantCount(node)
filterItemsByFolder(items, selectedFolder)
formatLoraRelativeLocation(item)
```

可能ならDOM非依存の純粋関数として`public/preset-catalog.js`へ置き、生成PickerとSettingsで共有する。同じtree構築を2箇所へ複製しない。

## 現状確認済み事項

次の既存実装を作り直さず再利用する。

- `openPresetPicker()`による生成画面のLoRA選択モーダル
- 検索、フォルダ絞り込み、Favorite絞り込み、Favorite切替
- `renderLoras()`、`createLoraRow()`による設定一覧
- カテゴリ、互換性、プレビュー有無のfilter
- `renderLoraPreview()`による作例と詳細表示
- `editLoraMetadata()`／`openLoraEditor()`による編集
- native input/select、既存`openModal()`、`ui-kit.js`

見づらさの主因:

1. 生成側は狭いカードへ画像、長い名前、分類、Trigger、操作が詰まり、本文が10〜12px中心。
2. フォルダchipが複数行を取り、画像一覧の高さを圧迫する。
3. サムネイルが`object-fit: cover`で強く切れ、作例を判別しづらい。
4. モーダル下端の「閉じる」が全面ライムの主要操作になり、「追加」と競合する。
5. 設定側は一覧行ごとに選択、Weight、互換性、詳細設定を持ち、114件規模では視線移動が多い。
6. 中幅以下では`.loraWorkspace`が1カラムになり、右プレビューが長い一覧の下へ落ちて実質的に見えない。
7. 未選択行のWeight値にもライムが使われ、選択状態の意味が弱い。

## 技術・デザイン前提

- Vanilla HTML / CSS / JavaScript、Express構成を維持する。
- `DESIGN.md`を正本とする。
- 新規依存を追加しない。
- API、LoRA registry、localStorage key、状態管理、Runtime別LoRA取得処理を変更しない。
- React、Vue、Tailwind、UI framework、仮想スクロールlibraryを追加しない。
- 画像は既存preview URLだけを使用し、原寸の一括先読みをしない。
- 本文は13px以上を基本とする。10px以下は補助badgeなど必要最小限に限定する。
- ライムは選択中、Favorite、主要な「追加」操作だけに使う。
- 常時発光、全面ライムの閉じるボタン、太い緑枠、カード内カードを増やさない。
- 角丸は原則8px以下。動きは150〜200ms、`prefers-reduced-motion`を維持する。

## 生成画面「LoRAを追加」

### 構造

既存`openPresetPicker()`を維持する。LoRA専用option/classの追加は許可するが、キャラクター／衣装Pickerを不用意に変えない。

```text
LoRAを追加
├─ 説明・選択数
├─ sticky toolbar
│  ├─ 検索
│  ├─ すべて
│  └─ Favorite
├─ browser workspace
│  ├─ folder tree
│  └─ content
│     ├─ breadcrumb・表示件数
│     └─ LoRA grid（ここだけ縦スクロール）
└─ 静かな閉じる操作
```

- Desktopの幅は`min(1120px, calc(100vw - 32px))`程度を上限目安にする。
- モーダル全体は画面外へ出さず、LoRA gridだけが安定して縦スクロールする。
- 検索と「すべて／Favorite」は上部に固定する。
- Desktopでは左180〜220px程度をfolder tree、残りをLoRA gridにする。
- folder treeは独立して縦スクロールし、LoRA gridのスクロールと混ぜない。
- tree nodeは展開アイコン、folder名、件数を1行に固定する。
- 選択中folderは細いライム線または文字色だけで示す。
- content上部に`LoRA / Anima / Character / Arknights`のようなbreadcrumbを表示する。
- 各カードの補助行に現在の相対folderを表示する。検索中は必須とする。
- 現在表示件数をtoolbar付近へ控えめに表示してよい。新規データ取得は不要。

### カード

- Desktopは`repeat(auto-fill, minmax(190px, 1fr))`程度を目安とする。
- 1366px幅で3〜4列、1920px幅で4〜5列程度を目安にする。
- 作例画像は一定のaspect-ratioを揃え、`object-fit: contain`を使用する。
- 画像、名前、互換性／分類、Trigger、追加操作の順に情報階層を付ける。
- 表示名は13〜14px、最大2行のline-clamp、`title`で全文確認可能にする。
- Base model／分類は小さな1行badgeまたは補助行へ整理する。
- Trigger Wordsは1行ellipsis。全文を常時展開しない。
- Favorite星は16〜18px、クリック領域32〜36px。星クリックで追加を発火させない。
- 「追加」はカードごとに1つだけ。追加済みは全面ライムにせず、静かな`追加済み`状態にする。
- 追加・解除、最大選択数、Favorite、検索、folder filterの処理は変更しない。
- カード全体クリックで追加する新挙動は入れない。
- モーダル下端の「閉じる」はsecondary/ghost相当にし、全面ライム背景にしない。

### レスポンシブ

- 760px以下は2列を基本とし、390px前後では1列も許容する。
- toolbarは検索を1行目、filterを2行目へ自然に折り返す。
- 900px前後未満ではfolder treeを常設せず、「フォルダ」ボタンから既存`openModal()`またはinline drawerで開く。
- folder選択後はdrawerを閉じ、breadcrumbに現在地を残す。
- modal本体やカードで横スクロールを発生させない。
- iPhone Safariで入力時のズーム、背景スクロール、既存modalのEscape／閉じるを壊さない。

## 設定画面「LoRA管理」

### Desktop構造

```text
LoRA管理
├─ 検索・カテゴリ・互換性filter・再読込
└─ workspace
   ├─ folder tree（独立スクロール）
   ├─ LoRA一覧（独立スクロール）
   └─ 選択中LoRA詳細／編集（独立領域）
```

- 一覧は「探して選ぶ」、右側は「確認・編集する」役割にする。
- 長いTrigger全文、Civitai詳細、衣装プリセット全内容を一覧へ常時出さない。
- `renderLoraPreview()`と`editLoraMetadata()`を正本として再利用する。
- checkboxが生成フォームの選択と同期する既存仕様を維持する。
- Desktopでは3ペインを基本とする。目安はfolder 180〜220px、一覧280〜360px、詳細`minmax(0, 1fr)`。
- folder pane上部へ既存「LoRAフォルダを開く」を置く。
- folder paneはカテゴリfilterとは別軸である。カテゴリとfolderを同時に絞り込める。
- 一覧上部にbreadcrumbと`このフォルダ内 N件`を表示する。

### toolbar／カテゴリ

- 検索を最も大きくし、互換性selectと再読込を同じ高さへ揃える。
- カテゴリは静かなsegmented tabsとし、選択中だけライム文字または細線を使う。
- `キャラクター 97`のようにラベルと件数を1行表示し、縦分割しない。
- 検出件数statusは1行の補助情報へ整理する。
- toolbarをstickyにする場合はLoRA管理領域内だけとし、ページ途中へ不自然に張り付けない。

### 一覧行

- サムネイル、checkbox、名前、互換性、Weight、詳細を開く操作までを主要表示にする。
- 名前は13px以上、1行ellipsis、`title`で全文表示。
- サムネイルは44〜52px程度。大きな作例は右詳細で`contain`表示する。
- 一覧行へ相対folderまたは相対LoRA名を1行の補助情報として表示する。検索中と「すべて」表示では必須とする。
- Weightは既存どおり操作可能にする。未選択行の値はライムにせず補助色にする。
- 選択中だけ左端の細いindicator、checkbox、または弱い背景で示す。太いライム枠は禁止。
- `キャラ・衣装・Trigger設定`は初期状態で閉じ、展開時だけ入力欄を出す。
- folder見出しと件数は1行、長いfolder名はellipsis。検索中は一致groupを開く。
- checkbox、slider、詳細操作のeventを分離し、意図しない選択やpreview固定を起こさない。

### 詳細／プレビュー

- Desktopの右詳細は画面外へ伸びず、必要なら右詳細内部だけをスクロール可能にする。
- 作例画像は`object-fit: contain`を維持する。
- 表示名、Base Model、互換性、現在Weight、基本Triggerを主要情報として表示する。
- `保存場所`として安全な相対位置（例: `Anima/Character/Arknights/example`）を表示する。値は1行ellipsis＋`title`とし、コピーボタンを置いてよい。
- 絶対LoRA rootは既存設定欄以外へ新たに露出させない。
- Civitai名、version、subcategory、衣装数などは既存「詳細情報」内へ残す。
- 「LoRAを選択／解除」「編集」を維持する。主要ライム操作は未選択時の「LoRAを選択」だけに限定する。
- hover previewとクリック固定の既存挙動を維持する。

### 中幅・モバイル

現状のように右プレビューを長い一覧の末尾へ落とさない。

- 1100px前後未満で1カラムになる場合、一覧行のサムネイル／名前／明示的な「詳細」操作から既存プレビュー相当を`openModal()`で開く。
- 中幅ではfolder treeも常設せず、「フォルダ」ボタンからdrawer/modalで開く。
- 中幅以下では常設`aside#loraPreview`を非表示にしてよい。
- modal内でも作例、主要情報、選択／解除、編集へ到達できる。
- modalを閉じても検索、filter、一覧スクロール位置、選択状態を失わない。
- 760px以下は検索、select、再読込を縦積みし、入力とボタンを44px以上にする。
- 390〜430pxで横スクロールを発生させない。

`renderLoraPreview()`を任意containerへ描画できる小さなhelperへ整理してよい。ただしLoRA状態管理やeditorを全面リファクタリングしない。

## 空・loading・error

- 取得中、0件、検索結果0件、preview未選択、preview画像なしを区別する。
- `undefined`、空select、壊れた画像iconを表示しない。
- 再読込失敗時も既存一覧を不用意に消さず、既存status/toast方針を維持する。
- Runtime切替中のdisabled制御と通知を変更しない。

## 変更予定ファイルと上限

第一候補:

1. `public/app.js`
2. `public/style.css`
3. `public/preset-catalog.js`
4. `test/preset-catalog.test.js`
5. `test/ui-shell.test.js`
6. `test/layout-overflow.test.js`（必要な場合）
7. `docs/CURRENT_TASK.md`（Task 25状態行のみ）

原則7ファイル以内。`public/index.html`が不可避なら8ファイル目として許可し、理由を報告する。

変更禁止:

- `src/server.js`、`src/history.js`、`src/reforge.js`、`src/forge-neo.js`
- `src/generation-runtimes.js`、`src/api/**`、`src/mcp/**`
- `data/**`、`outputs/**`、`package.json`、`package-lock.json`
- LoRA registry／profile data形式

## 禁止事項

- 新しいLoRA機能、分類、filter、編集項目の追加
- API、保存形式、localStorage key、Runtime挙動の変更
- UI framework、仮想スクロールlibrary導入
- Favorite、選択、Weight、Trigger、衣装、編集処理の複製
- 生成画面からCivitai追加を復活させること
- LoRA画像を原寸で一括取得すること
- folder tree構築を生成PickerとSettingsへ別々に複製すること
- 絶対filesystem pathを新たにAPI／DOMへ公開すること
- ユーザー入力folderをそのままOSで開く新endpointを追加すること
- card全体クリックによる追加
- absolute配置、負margin、固定pixel高さだけで崩れを隠すこと
- 他画面のmodal／picker／buttonの無関係な全面変更
- dirty worktreeの既存差分のreset、整理、削除
- 実3030／Forge Neo／ReForgeの停止・再起動

## 必須テスト

### 生成Picker

- 検索、folder、Favorite filter、最大選択数、追加／解除が維持される。
- nested folder tree、再帰件数、`(ルート)`、配下filter、breadcrumbを確認する。
- 同名LoRAが別folderにある場合に所在を区別できる。
- 星クリックが追加を発火しない。
- 追加済み表示が同期する。
- thumbnailのlazy loading／async decodingが残る。
- Triggerと長い名前がDOM上で全文を失わず、表示だけ省略される。
- 閉じるが主要ライム操作ではない。

### 設定管理

- category、compatibility、preview有無filterが維持される。
- checkbox、Weight、Trigger、Negative、profile、衣装preset、編集が従来どおり動く。
- hover preview、クリック固定、選択／解除が同期する。
- 中幅以下の詳細modalで選択／解除と編集ができる。
- modalを閉じても検索／filter／一覧状態を失わない。
- 長いLoRA名・folder名・Base modelで横overflowしない。
- folder treeとカテゴリ／互換性filterを組み合わせられる。
- 詳細に安全な相対保存場所が表示され、絶対pathが出ない。
- 既存「LoRAフォルダを開く」がfolder paneから機能する。
- Runtime切替と再読込のdisabled状態を壊さない。

### 表示条件

- 1366×768 / 100%
- 1366×768 / 125%
- 1920×1080
- 2560×1440
- 390〜430px幅

目視または既存browser harnessで次を確認する。

- 生成Pickerの本文が13px以上で読める。
- 作例画像が強く切れない。
- folder chipが複数段で一覧を押し下げない。
- folder treeから`Anima > Character > ...`の所在を追える。
- 設定詳細が一覧の末尾へ埋もれない。
- page／modal本体に不要な横スクロールがない。
- keyboard focus、Escape、閉じる操作が正常。

## 検証コマンド

```powershell
npm run check
node --test test/ui-shell.test.js test/layout-overflow.test.js
npm test
git diff --check
```

実3030／Forge Neo／ReForge、実History、実outputs、実LoRA registryを変更しない。

## 完了条件

1. 生成Pickerの名前、分類、Trigger、操作が読み分けられる。
2. 作例画像が`contain`で確認できる。
3. folder treeとbreadcrumbで、どのfolderに何があるか追跡できる。
4. 追加／追加済みとFavoriteが競合しない。
5. 閉じるが主要ライム操作ではない。
6. 設定一覧で名前、互換性、Weight、選択状態を読める。
7. 詳細情報と編集が一覧から分離される。
8. 中幅以下でも詳細が一覧末尾へ埋もれず開ける。
9. 既存の検索、filter、Favorite、選択、Weight、Trigger、衣装、編集が正常。
10. 長い名前とfolderで横スクロールが発生しない。
11. 同名LoRAを相対folderで区別できる。
12. 絶対pathを新たに公開しない。
13. 1366×768／125%と390〜430pxで操作できる。
14. 新規依存、API変更、保存形式変更がない。
15. 既存生成、Runtime、LoRA registry、Civitai追加を壊さない。
16. `npm run check`、関連test、`npm test`、`git diff --check`が成功する。

## Luna作業後の報告

- 変更ファイル一覧と変更数
- 生成Pickerの旧構造と新構造
- settings master-detailのDesktop／中幅／mobile構造
- folder treeの生成方法、再帰件数、filter規則
- breadcrumbと相対保存場所の表示方法
- 一覧から詳細へ移動した情報
- 長い名前、folder、Triggerの省略方法
- thumbnailの表示方法
- Favorite、追加／解除、Weight、編集のevent分離
- responsive breakpointと各表示条件の確認結果
- 追加／更新test
- 実行コマンドと結果
- API、保存形式、LoRA registry、Runtimeへ変更がないこと
- 残る制約

実装完了時は、この文書と`docs/CURRENT_TASK.md`のTask 25状態だけを次へ更新する。

```text
状態: **実装完了／監督レビュー待ち**
```

監督承認、commit、push、実機再起動を勝手に行わない。
