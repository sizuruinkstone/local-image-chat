# Local Image Chat — UI Visual Mock A/B

2026-09-07。Astraによる視覚・操作比較。**ユーザーはBを選択済み。現在はBの配色比較中。Production実装は未着手。** 初回A/Bはblack/limeで比較。以下の初回比較は履歴として保持する。現在のBは新配色へ更新済み。同じfixtureを使い、3個の選択LoRA、4画像、896×1152 / Euler / 28 steps / CFG 5 / seed -1 / 4 candidatesを共通化。画像は今回専用の安全なSVGイラストで、生成品質の例ではない。

## Mock A philosophy

**Production Tool** — 左の編集・中央画像・右Recent/metadataを同時に見渡す。フラットな面、細い区切り、コンパクトな行、横のnavigation。Runtime/Checkpoint/active/selectedを常に表示し、GenerateはStudio下端の右に固定する。

[Mock Aを開く](http://127.0.0.1:41867/renovation-a/) · [local HTML](../../workbench/ui-mocks/renovation-a/index.html) · [1920 screenshot](../../workbench/ui-mocks/renovation-shared/qa/mock-a-1920.png) · [1366 screenshot](../../workbench/ui-mocks/renovation-shared/qa/mock-a-1366.png) · [LoRA picker](../../workbench/ui-mocks/renovation-shared/qa/mock-a-lora.png)

## Mock B philosophy

**Refined App** — slim rail、短いmodel summary、編集の見出し、大きな画像領域、下のfilmstripで構成。Runtimeの詳細とmetadataは必要時に開く。Generateは編集パネルの下端に固定する。角丸は控えめにし、カードの入れ子で画面全体を組まない。

[Mock Bを開く](http://127.0.0.1:41867/renovation-b/) · [local HTML](../../workbench/ui-mocks/renovation-b/index.html) · [1920 screenshot](../../workbench/ui-mocks/renovation-shared/qa/mock-b-1920.png) · [1366 screenshot](../../workbench/ui-mocks/renovation-shared/qa/mock-b-1366.png) · [LoRA picker](../../workbench/ui-mocks/renovation-shared/qa/mock-b-lora.png)

## Major visual / interaction differences

| 比較軸 | A | B |
| --- | --- | --- |
| 中央画像優先度 | 右側情報と両立。1920で画像は約617×793px | 右側を通常空け、約639×822px。常時情報を減らして画像へ集中 |
| 操作速度 / 情報探索 | Runtime・状態・Recent・metadataを往復せず読める | 通常のPrompt編集はモデル情報に押されない。詳細閲覧は展開操作が増える |
| Visual hierarchy | 同じ高さの区切り行、密度と一覧性 | 見出しの強弱、surfaceの明度差、段階的な開示 |
| Prompt編集性 | 入力/操作を圧縮して並べる | ラベルと欄の間を少し広くし、モデルは初期折りたたみ |
| LoRA選択性 | フォルダーツリー＋小thumbnailの一覧行 | フォルダー＋大きいthumbnailの2列タイル |
| Settings密度 | 主要生成設定を小gridで一覧 | Output群としてまとめ、Adjustで開閉可能。下部設定へscrollが必要な場面あり |
| Recent / metadata | 右側で常設。候補は中央下 | 候補は下filmstrip。Recentボタンは簡易Galleryへ、metadataは右drawer |
| Generate位置 | 中央Studio下端右 | 編集パネル下端右 |
| 1366px耐性 | 3列を維持。左編集は内部scroll。右列の分だけ画像幅が狭い | 2領域を維持。内部scrollと固定footer。Promptと画像を残す |
| 将来mobile | 3列の表示切替/再配置が必要 | 2領域とdrawerは転用しやすいが、keyboard/rail/bottom navは別設計が必要 |

共通で試せるもの: Prompt開閉/編集、Runtime/Checkpoint選択と適用、LoRA folder/search/add/weight/disabled/remove、主要設定、advanced、候補/Recent/Galleryの画像選択、Favorite、metadata、拡大前後移動、Generateのqueued→generating→completeとcancel、Settings/Gallery navigation、Reference入力欄、Inpaint描画デモ、IP設定表示デモ。

## Strengths

- A: 現在の設定・結果・履歴を並行して確認しやすい。細い区切りとLoRA一覧行は既存view adapterへ段階的に接続しやすい。
- B: 常時必要でないモデル詳細を小さくでき、画像とPromptへ視線を集めやすい。LoRAのサムネイルを見て選ぶ楽しさを比較できる。
- 両案: Chromeで1920×1080 / 1366×768のページscrollWidth/scrollHeightがviewportと一致し、Generate全体が画面内に収まることを実測。LoRA操作・生成状態・画像遷移等を実操作で確認し、最終撮影passのconsole/HTTP errorは0。外部HTTP・本番API通信なし。生の記録と再表示方法は[QA README](../../workbench/ui-mocks/renovation-shared/qa/README.md)に隔離。

## Weaknesses

- A: 常時見える情報が多く、視線の行き先が散りやすい。1366pxではPromptを開いたまま主要設定へ行くために編集領域のscrollが必要。
- B: 同時に読める情報が減り、モデル/metadataを確認する操作が増える。LoRAタイルは一覧行より表示件数を稼ぎにくい。Outputの一部が初期画面下に入る。
- 両案: 完全なmobile版は未作成。大量履歴・深い実フォルダー・実Safari・実provider・本番状態のraceは検証していない。操作速度の短縮率は未計測。Settingsの一部は明示したデモ通知のみで、完成画面ではない。

## Production migration implications

- shared mock stateとrenderを本番へ移植しない。本番controllerをimportしておらず、DOM再生成を多用するモックはarchitecture contractの実装例ではない。
- Aは既存3領域のDOM portに近い。ただしRecipe/Prompt/LoRA/Favorite/Queueの更新責任をそのまま保持して接続する。
- Bはmodel disclosure、metadata drawer、nav railのDOM/focus接続が増える。隠すこととowner disposeを混同せず、画面遷移で監視やJobを停止しない。
- 本モックのSet selectorや簡易3行importは本番の復元/解析契約を再現していない。場面保存・キャラ保持は別contract設計のまま。
- 初回提出時はA/B選択待ちだったが、ユーザーはBを選択済み。現在の比較対象は以下の配色2案。今回の変更は隔離workbenchと本書だけとし、明示scopeを優先してcurrent-state等の既存文書も更新しない。tracked 237 filesの開始時hashはすべて一致。commit/push、Production test実行なし。

## B selected — palette and Gallery refinement (2026-09-07)

### Confirmed user feedback

Bをベースにする。LoRA画像はA程度の小型表示。Gallery拡大時はmetadataを表示する。黒ライムから配色を一新し、インターネット調査を踏まえて実装する。Liquid Glass風も比較したい。これは引き続き隔離モックへの指示として実施し、ProductionへのGOとは扱わない。

### Implemented studies

- [Slate / Indigo](http://127.0.0.1:41867/renovation-b/): 白い編集面、青みのグレーの画像背景、インディゴの主要操作。角丸と装飾を抑える。
- [Pearl Glass](http://127.0.0.1:41867/renovation-b/?theme=glass): 同じ配置。淡いブルーと暖色の環境色、操作バー・navigation・filmstripに透過、blur、細い反射線。入力面は安定した明度を保つ。Appleネイティブの光学的Liquid Glassの再現ではなくCSSによる視覚比較。
- 画面右上のSlate / Glassで入力内容を維持したまま切り替え可能。再読込時はURLの指定へ戻り、設定保存なし。
- BのLoRA pickerは54×54px画像の1列一覧へ変更。選択済みLoRAは40px画像を維持。
- Gallery画像ダイアログは左に画像全体、右に280pxのmetadata。狭い高さではmetadataだけscrollする。前後移動で画像名・Seed・Favoriteを同期。Checkpoint、Runtime、解像度、Sampler、Steps/CFG、LoRA、Structured Promptは生成画像用fixture snapshotで、編集中フォームを流用しない。
- Load all settings / Replace prompt onlyはダイアログを閉じ、Generateへ戻ってPromptにfocusする。

### Research and design judgment

[Radix: composing a palette](https://www.radix-ui.com/colors/docs/palette-composition/composing-a-palette)はSlateとIndigo等の対応、neutralとaccentの組み合わせを説明する。[Radix: scale roles](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)を参考に背景・境界・選択・文字へ役割を分けた。今回の個別カラー選定は設計提案であり、ユーザーによる色指定ではない。

[Apple: Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)はglassを主にnavigation/control層へ置き、content全体やglassの重ね掛けを避ける原則を示す。この原則を採用し、Promptやmetadataの長文を強い透過面にしない。CSSのreduced-transparency/reduced-motion対応は用意したが、実端末のOS設定連携は未検証。

### Evidence and limitations

Chromeで1920×1080 / 1366×768を実表示し撮影。1366でdocumentは1366×768、Generate下端761.8px。Galleryダイアログは画面内に収まり、右metadataのみscroll可能。前後画像の名前/Seed更新、設定読込でmodal close・Generate移動・Prompt focus、LoRA画像54px、テーマ切替を確認。console error 0。tracked 237 filesの初回mock開始時SHA256と全件一致。Production testは未実行。

[Slate 1920](../../workbench/ui-mocks/renovation-shared/qa/b-slate-1920.png) · [Slate 1366](../../workbench/ui-mocks/renovation-shared/qa/b-slate-1366.png) · [Glass 1920](../../workbench/ui-mocks/renovation-shared/qa/b-glass-1920.png) · [Glass 1366](../../workbench/ui-mocks/renovation-shared/qa/b-glass-1366.png) · [Gallery detail](../../workbench/ui-mocks/renovation-shared/qa/b-gallery-detail-1366.png) · [Compact LoRA](../../workbench/ui-mocks/renovation-shared/qa/b-lora-compact.png)

変更範囲: B index.html / themes.css / theme.js、shared app.js / gallery-detail.css、QA画像、本書。Aの配色は初回比較用に保持。実provider・実画像metadata・iPhone検証は今回対象外。配色の最終採用は未確定。

## Selected Glass and required generation selectors (2026-09-07)

ユーザーはGlassを支持。B layout + Pearl Glassを採用方向とし、ProductionへのGOとは区別する。追加の明示要件: Schedulerは主要生成設定に必須。解像度プリセット、Sampler、Schedulerを選択式にする。BモックのOutputへ3つのselectorを配置し、幅・高さの直接編集も維持。プリセットで幅高さを同期し、任意寸法ではカスタム表示。Sampler/Scheduler選択とStepsをfooterへ同期。Gallery metadataにも生成時fixtureのSchedulerを表示。候補値はモック用で推奨値ではない。本番移行時は既存sampler-pickerのRuntime由来候補・owner/適用契約を維持する。
