# Local Image Chat — User UI Requirements

> 2026-09-07追補: 本人がB＋Pearl Glass、A相当の小型LoRA画像、Gallery拡大metadataを採用。解像度プリセット・Sampler・Schedulerは主要設定の選択式。Production実装GOとAstra単独実施の指示あり。[実装記録](ui-glass-implementation.md)と[現行DESIGN](../../DESIGN.md)が現在状態。本書の未選択/未着手という記述は初回計画時点の記録であり、未確定の場面保存等まで実装済みを意味しない。


作成: 2026-09-07。状態: **ユーザー確認済み**。同日の要約提示に対し、本人が「合ってますね」と回答した。未確認と明記した細部や、今後提示する視覚案・contract変更まで承認されたことを意味しない。

本書は今回のユーザー本人への全11ラウンドのヒアリングを整理したもの。ユーザー発言を要件の正本とし、実装方法・技術側の推奨・未確認事項を分ける。後半で明示された優先順位を最終回答として採用する。優先度が低い、または不要という回答は、既存機能の削除許可を意味しない。

確認を受け、[Master Plan](ui-renovation-master-plan.md) / [Design System Plan](design-system-plan.md) / [UI Phase Roadmap](ui-phase-roadmap.md)を作成した。Production UI実装にはさらに別途GOが必要。今回コード・CSS・HTML・test・packageは変更しない。

## Inputs / evidence

- ユーザーによる今回のヒアリング回答。頻度は本人の定性的な申告であり、利用ログによる計測ではない。
- [AGENTS.md](../../AGENTS.md)、[current-state](../implementation/current-state.md)、[DESIGN.md](../../DESIGN.md)。
- [Final architecture audit](../refactor/final-architecture-audit.md)、[UI renovation boundaries](../refactor/ui-renovation-boundaries.md)、[継続する設計判断](../implementation/decisions.md)。
- 既存Auditの「Settings shellを最初に」という提案は技術側の推奨。ユーザーが選んだ優先順位や着工順の承認とは扱わない。

## Typical workflows

### 通常の生成と再利用

1. Checkpointを選び、生成設定を調整し、LoRAを追加し、分割プロンプトを調整して生成する。
2. 主なPrompt編集順はキャラ → 画風 → シチュエーション → 背景。作者タグも使う。
3. 画風とCheckpoint特有の推奨設定は一度決めるとあまり変えない。シチュエーションとキャラクターをよく変える。
4. 通常1枚生成し、クリック拡大で出来を確認する。よければお気に入りにする。
5. 合わなければ設定を読み込み、主にPrompt、ときどきLoRAや生成設定を変更して再生成する。
6. 「再生成」は設定読込と編集場所への移動を望む。押した時点では生成を開始しない。同条件で即座にもう1枚作る専用操作は不要で、Generateを押せばよい。

### AI / MCP / import

- MCPはよく使う。各AIに指示し、LICで結果を見る。あまり使っていないのはLICの進捗確認であり、MCP生成自体ではない。
- AIから受け取る分割用テキストのPrompt importを頻繁に使う。AI Shareという機能は認識していない。
- AIにCheckpointを調べさせないと画風タグが適当になるため、AI側で直させている。AIとのやり取りでの問題として記録し、import parserの不具合とは断定しない。

### 保存して育てる場面集（ユーザーが希望する使い方）

- 場面を複数保存し、名前とプレビューで選びたい。自分の生成から育てる使い方が中心。
- 例: 都市、クロップド丈の服とショートパンツ、立ち姿、太ももより上の画角。
- シチュエーション・背景・服装・構図・画風のPrompt、画風/Turbo LoRA、Negative、主要生成設定、画像サイズを含めたい。
- キャラクターLoRAやキャラタグを入れれば、その場面のキャラクターが生成できるようにしたい。保存した場面の読込時は現在のキャラクターを残したい。
- 推奨設定が違うためCheckpointごとに分けたい。ポーズごとに通常/NSFWを分類できるとなおよい。
- プレビューは、その設定で生成した画像を自分で指定する方法でよい。
- 追加要望: **Checkpointごとの推奨設定を自動で入れられるような設定が欲しい**。自動適用のタイミング、対象項目、設定の出所は未確定。

## Feature usage frequency

| 領域・操作 | 本人が述べた使い方・頻度 |
| --- | --- |
| LoRA Selection | 最頻用操作の一つ。フォルダー中心 |
| 過去画像設定読込 | 最頻用操作の一つ。全部読み込んで一部を変更するのが基本 |
| MCP生成 | よく使う。結果をLICで見る |
| Structured Prompt / import | 中心的な入力方法。importは頻繁 |
| Raw Prompt | 見づらく、ほぼ使わない |
| Gallery | 生成のたび、設定探索、昔の画像の閲覧、生成待ち時間に開く |
| Recent History | ときどき画像を選ぶ |
| 画像お気に入り | 見返し、再利用候補、保存に使う |
| Rating / LoRAお気に入り | 現在使っていない |
| Hires | 現デフォルトが重すぎると感じ、使っていない |
| Compare / Experiments | 必要性を感じない。1枚ずつ生成し自分で比べればよい |
| img2img / Reference | 面倒で必要にも迫られておらず、あまり使わない。ポーズ固定には関心あり |
| Inpaint | ほぼ使わないが、へそが二重になった画像の修正に1回使用。最終優先度は重要 |
| IP-Adapter | 利用時のForge Neoで非対応だったため未使用。最終優先度は重要 |
| Settings / Discord / Storage / Update | 最近あまり開かない。問題があれば知らせてほしい |
| Mobile | 外出中・ベッドで生成。利用量は本人表現でPCの約1/3 |

## Pain points

| 場面 | 困り方と現在の対処 | 求める結果 |
| --- | --- | --- |
| 狭いPCウィンドウの生成設定 | スクロールが崩れ選びづらい。画面比率やアコーディオンを調整して対処 | 狭くしても入力・選択を継続できる |
| Prompt / LoRA / 生成設定 | 縦に長くスクロールが多い | 押しやすさを保って密度を上げ、主要操作へ早く到達できる |
| LoRA追加 | 毎回anima/character/animeなどの階層をたどる | 開閉の間はフォルダー位置を保持。ツリーが見えると便利 |
| 過去生成の部分再利用 | シチュエーション等の一部分だけコピーするのが面倒 | 必要部分を置き換えで再利用しやすい |
| Gallery通常/NSFW区分 | 時々横にはみ出す。無視している | 区分を使えて横にはみ出さない |
| Galleryのソート/絞り込み | 本人認識では20枚ずつ読んだ範囲にしか効かず、目的を果たさない | 履歴全体から意図した対象を探せる。原因とソート/絞り込みの区別は未調査 |
| iPhone Prompt | キーボードに隠れ、書きにくい・貼り付けにくい。時々意図せず拡大 | 入力内容が見え、貼り付けや編集を続けやすい |
| Hires | デフォルトの処理が重い | 性能/設定の問題として保留。UIだけで解決すると約束しない |

## Generate / Studio requirements

- Promptより画像に広い場所を使いたい。
- Runtime/Checkpointの選択は必要時に開けばよい。現在名を常時表示するかは未確認。
- すぐ触りたい主要項目: Sampler、CFG、Steps、解像度/画像サイズ・縦横比、Seed、生成枚数。「画質」は本人の最終回答では解像度のことかもしれない。
- Generateボタンはスクロールしても同じ位置に置きたい。
- 設定読込後はPrompt編集へ早く移りたい。
- 通常1枚生成。拡大中に前後の画像へ移動できると便利。
- Recent Historyは利用するため残す方向。metadataは主にGalleryで確認する。
- 進捗率、処理段階、経過時間、待ち件数、途中画像、キャンセルは「全部あってもよさそう」。全情報を大きく常時表示する要求ではない。

## Prompt requirements

- Structured PromptとAIからの分割用テキストimportを中心にする。Raw/Structuredの既存semanticsを変える要求ではない。
- まとめて貼り付け、部分差し替え、クリア、前の内容に戻す、別生成からのコピーを使う。
- 全設定読込後の編集を維持しつつ、ケースに応じた部分再利用も簡単にしたい。置き換えが基本。
- テキスト欄に加えてチップ操作もあるとよい。編集中の欄だけ広げる形はよさそう。
- NegativeはCheckpointごとにほぼ固定。普段は閉じていてよい。
- Trigger Wordsの編集場所は分割プロンプト側が自然そう。

## Desktop preferences

- 27インチモニターをAIとLICで約1:2に分ける。解像度・OS倍率の数値は未確認。
- 現3カラムに大きな不満はないが、よりよい構成も模索してほしい。3カラム維持をユーザー必須要件にしない。
- 広い画面は画像へ面積を使い、狭い画面は画像とPromptを優先。
- パネル幅調整/開閉は「できても面白い」という候補であり必須ではない。
- 画面全体で画像を見られると嬉しい。
- 接続の有無と生成の稼働状態を把握したい。

## Mobile preferences

- Promptで生成、少し変えて再生成、画像確認、Gallery閲覧が主な用途。
- 下部ナビは好印象で常時見えていてほしい。文字入力時のキーボードとの具体的な共存方法は設計対象。
- Generateはキーボードを閉じたとき固定位置に見えていればよい。文字入力中は不要。
- Promptのキーボード遮蔽・貼り付けづらさ・意図しない拡大を改善したい。端末だけが原因とは断定しない。
- LoRA選択は全画面でもよさそう。現選択操作には大きな不満なし。
- 拡大中の画像を左右に送れると嬉しい。
- iPhoneで高度な画像編集まではあまり望んでいない。

## LoRA requirements

### Generation Selection

- 通常キャラ・Turbo・画風を各1個程度。画風を複数使う場合もある。Checkpointによってキャラタグだけの場合もある。
- 主な探索はフォルダー。現在も分類でおおむね見つけられている。
- フォルダーツリーが見えると楽。位置保持は閉じて開き直す間で十分。再読込/翌日までの保持は必須ではない。
- 当初は深いフォルダーへの1クリック移動を希望。後続回答でツリー表示への好感が示された。近道登録の具体的な仕組みは未確定。
- サムネイルは選ぶ楽しさにつながる。
- Weightは生成結果を見つつ調整。主に±、時々数値入力。スライダーの必要性は低い。
- Trigger Wordsは基本自動内容を使い、主に衣装あり/なしを使い分ける。衣装区分を分割Promptへ付与するOutfit相当の機能は使用。
- preset/addonは認識していない。disabled LoRAの表示の好みは未確認。
- LoRAお気に入りは使わない。「最近使ったLoRA」はTurbo・画風の再追加に役立ちそう。

### Library Management

- フォルダー移動、分類、URLからのダウンロード、再読み込みが主な管理操作。
- 詳細はあまり見ず、設定がおかしいときに元ページを確認する。
- LibraryからURL追加できると便利そう。ただし表示スペースを気にしている。
- 小さな追加入口から必要時に開く形は技術側の候補であり、ユーザーが選択済みの配置ではない。
- 検索高度化、大量metadataの常時表示、改名頻度などはユーザー要件として追加しない。
- SelectionとManagementは別責務を維持する。

## Gallery requirements

- 高頻度の閲覧・確認・再利用の場所として扱う。
- iPhoneの写真一覧で好むのは、余白が少なく大量に並ぶ点。ピンチ密度変更・日付分類等まで要求したと解釈しない。
- お気に入りを一覧で付け外ししたい。見返す・再利用・保存に使う。Ratingは使っていない。
- 通常/NSFW、お気に入りで絞り込みたい。普段は通常/NSFWの両方を表示。
- 拡大した際にmetadataが出る形がよさそう。一覧へ出すmetadataの詳細は未確定。
- 自動で続きを読み込む方式が好み。戻った際の位置と絞り込みを保持したい。
- 拡大中の前後移動が欲しい。全設定読込と部分置換の両方の導線を検討する。
- フィルター/ソートの有効範囲への不満を解消する必要があるが、API・cursor・schema変更を承認したものではない。

## Reference / Inpaint / IP / Settings

- Reference/img2imgはあまり必要としていない。ドラッグ＆ドロップと小さめプレビューが好み。ポーズ固定は関心のある用途。
- Inpaintは重要。使用頻度が低いことと、最終優先度を混同しない。キャンバスの広さ・ツール位置は未確定/特に好みなし。
- IPは重要。未使用理由は本人が利用したForge Neoの非対応。現時点の対応状況を本ヒアリングで検証したわけではない。
- 画像入力/編集系は必要時に開く。モバイルの高度編集は積極的に求めない。
- Settingsは重要だが、最近はあまり開いていない。カテゴリ/検索の具体的要望は未確認。
- Discord/Storage/Updateは問題発生時に知らせてほしい。通常の更新通知の扱いなどは未確定。

## Visual preferences

- Black + limeにこだわりはなく、変更可。ライトテーマの要否は未確認。
- 無骨な制作ツール寄りと洗練されたアプリ寄りを両方見たい。最終スタイルは未選択。
- 四角に近い角丸が好み。細い線で区切る形がよさそう。
- 押しやすい大きさを保ちつつ情報を詰めたい。
- 見れば分かる操作はアイコンを使い、説明が必要な操作は文字も使う。
- 動きはテキパキした感じを好む。
- 「明らかにAIだろこれ」と感じるデザインを避けたい。ネットで調査して対策を検討してほしい。
- YouTube、Discord、Twitterは特に不満なく使っている。全面的な模倣や、その全要素を好きという意味ではない。
- 最初に改善を実感したいものは本人表現で「デザイン？とUI」。単独の機能ではなく、全体の見た目・使い心地への期待として要約確認する。

## Accessibility / preferences

- 個別の追加配慮は「特になし」。アクセシビリティ不要という意味ではない。
- 押しやすさ、スマホ入力時の見やすさ、意図しない拡大の防止は明示された使用上の要求。
- 既存のフォーカス、キーボード、aria、Escape、reduced-motion等は技術基準として維持する。本人の個別申告と区別する。

## Feature priorities

最終ラウンドの本人指定。順序が同じ区分内の着工順を意味するわけではない。

| 領域 | 最終優先順位 |
| --- | --- |
| Generate | 最重要 |
| Studio | 最重要 |
| Prompt | 最重要 |
| LoRA Selection | 最重要 |
| LoRA Management | 最重要 |
| Gallery | 最重要 |
| Inpaint | 重要 |
| IP-Adapter | 重要 |
| Settings | 重要 |
| Mobile | 重要 |
| Compare | 後回しというより現状不要と感じる |
| Experiments | 後回しというより現状不要と感じる |
| Reference | 後回しというより現状不要と感じる |

## Explicit dislikes

- 明らかにAIが作ったと感じる定型的なデザイン。ただし具体的な禁止装飾のリストはまだ本人から出ていない。
- 多すぎるスクロール、狭い画面で操作できなくなるスクロールの崩れ。
- Raw Promptの見づらさ、iPhoneで入力が隠れること・貼り付けづらさ・意図しない拡大。
- 毎回深いフォルダーをたどり直すこと、過去Promptの部分コピーの手間。
- Galleryの横はみ出し、履歴探索に役立たないと感じるソート動作。

## Must keep

- ユーザーが使っている分割Prompt/import、LoRAのフォルダー探索、画像の拡大・お気に入り、過去設定の再利用、Recent History、MCP生成結果のLICでの確認。
- 通常/NSFW分類。Galleryは通常両方を見られること。
- キャラと場面を変えて繰り返す生成フロー、押しやすい操作対象。
- 技術側の維持事項は後述。既存3カラムや配色は本人が固定を求めたものではない。

## Must change

- 狭い画面のスクロール破綻・横はみ出し・Prompt入力の遮蔽を改善する。
- 主要生成設定とPrompt/LoRAへの到達を速くし、過剰なスクロールを減らす。
- 画像を大きく、Galleryは余白を抑えて多数表示する。
- 再生成の設定読込からPrompt編集への流れ、過去Promptの再利用を容易にする。
- LoRA選択の開閉時に位置を保持し、階層移動を容易にする。
- 場面保存とCheckpoint推奨設定の自動適用という明示要望を計画で扱う。表示変更だけで実現可能かは未判定であり、即実装の確約ではない。

## Nice to have

- 拡大中の画像前後移動と画面全体の画像表示。
- 最近使ったTurbo/画風LoRA、テキストに加えたチップ操作。
- パネル幅調整/開閉、Libraryからの省スペースなURL導入入口。
- 場面のポーズ別通常/NSFW分類、ポーズ固定用途。
- 「よさそう」「できても面白い」等の回答をまとめたもの。機能単位の最終優先順位とは別軸。

## Deferred / open items

- Compare/Experiments/Referenceの刷新は積極的に求めない。削除は未承認。
- Hiresの重さは設定・性能課題として別途評価。デフォルト変更は未承認。
- 詳細設定全般を折りたたんでよいかは最後の質問で回答なし。Negative以外を一括で承認済み扱いにしない。
- 自動推奨設定の出所、対象項目、適用契機、手動値の保護、保存場面との優先順位は設計候補として残す。
- 場面の保存形式、キャラ/衣装/画風の判別、既存Outfitとの競合、部分置換の範囲は未確定。
- disabled LoRA表示、Settings検索、一覧metadata、ライトテーマ、具体的な画面幅など未回答の細部は未確認として残す。
- 大枠の要約確認前に追加の長い質問ラウンドを行わない。重大な誤解/contract衝突のみ必要な時点で確認する。

## Technical constraints / recommendations — not user requirements

既存native HTML/CSS/JavaScript、state ownerと公開port、API/History/cursor/storage、Runtime/Recipe/Generation、Prompt-LoRA、画像配信、PWA/update契約を維持する。SelectionとManagementを分離し、UIのための第二storeやprovider直結を追加しない。

| 要望・論点 | 現在資料の制約 / risk | contractを保つ検討方向 |
| --- | --- | --- |
| キャラを残して場面と設定を適用 | 現Recipeの復元対象・順序は固定。保存形式や部分適用の無断変更は設定混在/rollback不整合のrisk | 既存公開port・Preset/Profile/Checkpoint Setの表現範囲を確認。既存Recipeの意味を変えず明示した別操作として成立するか検討。新schema等が必要なら独立contract変更を提示 |
| Checkpoint推奨設定の自動適用 | 確認後の静的調査で内蔵Checkpoint Profile自動適用とSet autoApplyを確認。SetはLoRAとRaw Prompt全体も置換するため、キャラ保持の場面適用とは異なる | 既存の自動設定を理解しやすくする改善と、新しい場面保存/選択的適用の契約設計を分離。AI/外部情報の自動取得は依頼に含まれたと推定しない |
| Gallery全体へのfilter/sortと自動追加 | History cache/cursor/mergeは既存ownerの責務。Auditにfilter raceあり、今回の報告との同一性は未確認 | 既存server/ownerの検索・paging能力を確認し、関連bugを独立fixとして計画。view独自の全件fetch/cacheを作らない |
| IP・ポーズ固定 | Runtime capabilityをUIで変更できない。未対応stateは保持してpayloadから省略する契約 | 現capability内の機能と未対応理由を明示。provider対応追加をUI刷新へ混ぜない |
| パネル変更・画像全画面 | controllerはDOMを捕捉。無断remountはlistener/state/lifecycleを壊すrisk | page lifetimeと既存ownerを維持する表示変更を優先 |

Gallery filter race・390px overflow、Studio recent race、Checkpoint Set summary同期不足はAudit記載の関連UI前提。今回実測・修正していない。ユーザー優先順位と依存する修正順を分けて計画する。

ネット調査の初期参照: [USWDS Design principles](https://designsystem.digital.gov/design-principles/)、[GOV.UK Styles](https://design-system.service.gov.uk/styles/)。実利用に沿った判断、一貫した意味と操作を検討軸にするための資料であり、「AIっぽさ」を解消した証拠でも、その見た目を採用する決定でもない。確認後、YouTube/Discord/Xの公式公開資料の参照分析をDesign System Planへ追加した。2方向の視覚モック比較は未実施。

## Confirmation / next gate

- 本書の要約は2026-09-07に本人確認済み。重大な誤解の指摘なし。
- 確認完了後に `ui-renovation-master-plan.md`、`design-system-plan.md`、`ui-phase-roadmap.md` を作成した。これらの設計提案は本人発言と区別する。
- Planningが終わってもProduction UIは実装しない。別途ユーザーのGOが必要。
- 本書作成は文書のみ。テスト/ブラウザー/実provider検証は行わず、リンク・内容・差分・whitespaceを確認する。
