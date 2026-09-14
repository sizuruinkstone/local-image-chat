# Local Image Chat — Design System Plan

> 2026-09-07追補: 本人がB＋Pearl Glass、A相当の小型LoRA画像、Gallery拡大metadataを採用。解像度プリセット・Sampler・Schedulerは主要設定の選択式。Production実装GOとAstra単独実施の指示あり。[実装記録](ui-glass-implementation.md)と[現行DESIGN](../../DESIGN.md)が現在状態。本書の未選択/未着手という記述は初回計画時点の記録であり、未確定の場面保存等まで実装済みを意味しない。


作成: 2026-09-07。[確認済み要件](user-ui-requirements.md)に基づく設計計画。**数値・配色・2案は提案値。Production変更と視覚案の採択は未実施。** [Master Plan](ui-renovation-master-plan.md)と[Roadmap](ui-phase-roadmap.md)に接続する。

## 1. 方針と現DESIGNとの差分

画像と編集内容を主役にし、四角寄り、細い区切り、押しやすい密度、素早い動きで揃える。作者タグや長いLoRA名を実際に入れた状態で設計し、空のカードだけで完成させない。

| 現行DESIGN | 今回の扱い |
| --- | --- |
| black + lime固定基準 | 本人が変更可と回答。2案で比較し、採択前にProduction tokenを変えない |
| Desktop 3カラム | 本人は維持必須ではない。広い画面の出発点とし、狭いPCは画像/Prompt優先の代案を比較 |
| 画像配信・a11y・安全なレイアウト | 維持。配色変更の許可で撤廃しない |
| 強いグラデーション/常時発光/過剰なカード等の禁止 | 現基準を継続。本人の「AIっぽさ」の具体的定義として捏造しない |

## 2. 公式資料の調査と採用する考え方

2026-09-07に公開資料を確認。現行アプリのログイン画面を操作・計測したものではない。古い設計記事を2026年の実画面の証拠にしない。

| 参照 | 資料が述べること | LICへの設計側の解釈 |
| --- | --- | --- |
| [USWDS Design principles](https://designsystem.digital.gov/design-principles/) | 実際のユーザーの必要性を起点にし、継続して評価する | 装飾の好みだけでなく、今回の反復生成や狭い画面で操作できるかを評価軸にする |
| [YouTube: Decoding the design language, 2022](https://blog.youtube/inside-youtube/youtube-ambient-color-mode-visual-language-redesign/) | buttonとthumbnailの基礎要素、視聴体験のvisual languageを説明 | 画像・操作の階層に着目。ambient glowや大きな角丸はLICの好みに合わないため移植しない |
| [Discord: Squircles, styles, spacing](https://discord.com/blog/improving-mobile-with-squircles-styles-and-spacing) | platform間の一貫性と、形・spacing・入力周辺の改善を説明 | PC/mobileで操作の意味を揃え、配置と密度は端末ごとに調整する。Discordの形や色を模倣しない |
| [X: timeline](https://help.x.com/en/using-x/x-timeline)、[Bookmarks](https://help.x.com/en/using-x/bookmarks) | timelineと保存した投稿へ再アクセスする操作を説明 | 一覧→詳細→保存/再訪の手順を検討する参照。LICのFavoriteとXのbookmarkを同じ保存仕様とはみなさない |

「AIらしいデザイン」を機械的に識別する普遍的ルールが確認できたわけではない。以下は本人の好みと上記資料から立てた**設計側の対策仮説**であり、視覚比較で確かめる。

- 大きい挨拶/宣伝見出し、装飾だけの統計カード、無意味なバッジで作業面積を減らさない。
- すべてを同じカードに入れず、画像、入力、フォルダー、状態それぞれの役割に沿う見せ方にする。
- 色やアイコンで飾る前に、どの値を変え、どこへ戻るかを明確にする。
- 等間隔の巨大余白や過剰なpill化を避け、本人が求める高密度と四角寄りを表現する。
- 正常・異常・未対応、短い/長いPrompt、3個以上のLoRAを含む実利用に近い状態で評価する。

## 3. 視覚比較する2方向

両案は同じ情報構造・同じ画像・同じPrompt・同じ操作対象で比較し、色だけを変えた案にしない。画像素材は利用許可済みのlocal fixture/非privateサンプルを使い、ユーザー画像を外部サービスへ送らない。

| 項目 | A: 制作ツール寄り | B: 整ったアプリ寄り |
| --- | --- | --- |
| 表面 | ほぼフラットな暗い面、細線で領域を区切る | わずかな明度差で大きな領域を分ける。カードの入れ子なし |
| 見出し | 小さく明瞭、設定名を揃えた行 | 小さいが強弱をつけ、入力群に呼吸できる間隔 |
| 情報密度 | 高密度の行・グリッド。操作対象は縮めない | 画像面積を優先し、編集のまとまりを明確にする |
| 角丸候補 | 2〜4px | 4〜6px。pillは必須用途だけ |
| 色候補 | neutral dark + 控えめlime | neutral charcoal + 控えめblue |
| 強みの仮説 | 頻繁な設定調整が速く見渡せる | 画像確認から次の編集へ視線を戻しやすい |
| 注意点 | 小文字・過密・暗すぎる補助文字にしない | 余白過剰や汎用SaaSのカード一覧にしない |

どちらも採択済みではない。本人が両方見たいと回答したため、次の設計工程でGenerate・Gallery・LoRAを同条件で提示し、混合も許容する。色の変更を必須にせず、lime維持案を比較に含める。

## 4. Token候補と共通規則

既存native CSSで実装する将来設計。framework、icon package、font配信、build依存を追加しない。

| 分類 | 設計候補 / 制約 |
| --- | --- |
| 色 | bg/surface/raised/border/text/muted/accent/danger/focusに意味を分ける。候補A bg #0B0C0D, text #F2F2F2, accent #B7E82E。候補B bg #101214, text #F2F4F6, accent #8BB7F0。contrastは採択前に実測 |
| spacing | 4/8/12/16/24pxの少数段階。Gallery gapは2〜4pxから比較 |
| type | 既存system font。本文14〜16px候補。iPhoneの入力は16px以上を候補に実機で確認。数値は揃えて読みやすくする |
| controls | desktop可視高さ32〜36px候補、touch targetは44px程度を初期案。密度のために押しやすさを犠牲にしない |
| border/radius | 1px境界、A/Bの角丸。強い枠を全要素へ重ねない |
| motion | 100〜160ms程度の短い表示遷移を候補。連続の高さanimationを避け、reduced-motion時は抑制 |
| focus | 明瞭なfocus ring。色だけの状態判別やhover限定の必須操作を避ける |

これらはユーザーが指定したpx値ではない。現DESIGNとの差分は視覚採択後の限定taskで明文化する。

## 5. Component inventory

| 部品 | 表示と操作 | 保護する接続 |
| --- | --- | --- |
| Navigation / status | 小さい接続・稼働表示、Generate/Gallery等の入口、mobile bottom nav | 既存navigation stateとapp lifetime |
| Prompt section | compact/expanded editing、label、import、clear/undo、copy/replace | active Raw/Structured、form adapter、undo/保存順 |
| Main settings | label付き小grid、数値、select、seed、resolution | form正本とsummary。hidden form複製禁止 |
| Generate footer | 位置一定、busy/cancel対象明示、入力遮蔽なし | GenerationとQueueの別owner |
| Folder tree / LoRA row | folder選択、thumbnail、名前、±、数値、衣装、disabled | catalogとselectionの分離、既存weight/tag semantics |
| Gallery tile | 密な画像、Favorite、明確な選択状態 | 同ID Favorite同期、thumbnail URL |
| Image detail | 大きい画像、前後、metadata、再利用、close | 明示原寸、focus復帰、既存Recipe/action |
| URL import panel | 必要時のみ入力/結果/進捗 | Civitaiのrequest/token/install owner |
| Queue details | progress/stage/elapsed/wait/preview、unavailable state | 既存snapshot。第二pollerなし |
| Inpaint toolbar | paint/erase/undo/redo/brushと必要設定 | canvas座標/bitmap/source/undo owner |

すべての該当部品でnormal/hover/focus/selected/disabled/loading/error/emptyを定義。unsupported IPは設定を消すdisabledではなく、理由を伝える表示にする。

## 6. Layout / responsive候補

- 目安の比較幅: 1440px以上は3領域、900〜1439pxは編集+画像と開閉Recent、899px以下は縦配置または編集/画像切替。これはモック用仮説でありbreakpoint確定ではない。
- 中間幅でも画像とPromptが中心。27インチの比率だけから数値を確定しない。
- 実装検証では1366×768 100%/125%、1920×1080、2560×1440、390/430px、実際の狭いPC分割幅を含める。480〜900px付近の中間幅も往復して崩れを探す。
- CSS grid/flexのmin-sizeとoverflow所有を明示。生成フッターを設定の上へ重ねない。bodyのoverflow clipで合格にしない。
- Mobileではsafe area、browser chrome、keyboard open/closed、縦横切替を扱う。生成ボタン非表示でも入力を終了する操作を奪わない。
- フォルダーpickerはmobile全画面候補。閉じたら元のPrompt/LoRA操作へfocus/scrollを戻す。

## 7. 視覚モックの成果物と評価

次の設計工程でA/BそれぞれGenerate、Gallery、LoRA Selectionのdesktopと390pxを制作する。最初に比較する範囲を固定し、全画面の完成モックを一度に要求しない。

共通fixture: 長いCheckpoint/LoRA名、キャラ+Turbo+画風、作者タグ入り分割Prompt、通常/NSFW分類がある画像一覧、busy/empty/errorの代表状態。外部送信/実生成/実installはしない。

評価項目:

1. 最初に画像が目に入り、編集場所が分かるか。
2. Prompt/import/LoRA/主要設定への操作数とスクロール量が現状より悪化しないか。
3. 狭いPCでも無理なく使えるか。mobile keyboard時に入力が読めるか。
4. 密なGalleryでFavoriteと拡大が押し分けられるか。
5. 本人が「AIっぽい」と感じる部分はどこか。具体的に指摘された箇所を修正する。

主観的な採択と、実layout/操作の合格を分ける。色だけの投票や、CSS文字列testで視覚確認を代用しない。現時点ではモック未作成・評価未実施。
