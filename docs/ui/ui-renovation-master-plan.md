# Local Image Chat — UI Renovation Master Plan

> 2026-09-07追補: 本人がB＋Pearl Glass、A相当の小型LoRA画像、Gallery拡大metadataを採用。解像度プリセット・Sampler・Schedulerは主要設定の選択式。Production実装GOとAstra単独実施の指示あり。[実装記録](ui-glass-implementation.md)と[現行DESIGN](../../DESIGN.md)が現在状態。本書の未選択/未着手という記述は初回計画時点の記録であり、未確定の場面保存等まで実装済みを意味しない。


作成: 2026-09-07。**確認済みユーザー要件に基づく計画。Production実装は未承認・未着手。** 見た目の2方向と可変レイアウトは計画内の比較候補であり、ユーザーが最終選択したデザインではない。

## 1. 正本と目的

[user-ui-requirements](user-ui-requirements.md) は2026-09-07にユーザーが「合ってますね」と確認済み。[Final Audit](../refactor/final-architecture-audit.md)、[UI boundaries](../refactor/ui-renovation-boundaries.md)、[decisions](../implementation/decisions.md)を技術境界とし、見た目の現行基準は[DESIGN](../../DESIGN.md)。本計画は後者を黙って上書きしない。

刷新の中心は、画像を見ながらPrompt・LoRA・主要設定を調整し、生成結果や過去画像から次の生成へ戻る反復作業。生成用の長いフォームをただカードへ分割するのではなく、編集と確認に使う面積、到達手順、スクロールの安定を改善する。

最重要: Generate / Studio / Prompt / LoRA Selection / LoRA Management / Gallery。重要: Inpaint / IP / Settings / Mobile。Compare / Experiments / Referenceは現状の必要性が低いが削除しない。Settings先行はAuditの技術提案であり、今回の価値提供順はGenerate・Prompt・LoRA・Galleryを中心とする。

## 2. 成果物と計画の境界

- 本書: 体験、情報配置、既存ownerとの接続、機能追加との境界。
- [design-system-plan](design-system-plan.md): 2方向の見た目、共通部品、レスポンシブ、研究根拠と比較方法。
- [ui-phase-roadmap](ui-phase-roadmap.md): 独立差分、依存関係、担当、検証と停止条件。
- 本段階では文書のみ。2案の視覚モック、ブラウザー比較、Production変更は未実施。視覚比較を次の設計成果物とする。
- 要件確認は各実装Phaseやcontract変更のGOではない。コード/CSS/HTML/test/package、データ、provider、実送信、commit/pushを本計画作成で変更しない。

## 3. 情報構造の提案

| 入口 | 役割 | 主な操作 |
| --- | --- | --- |
| Generate | 編集と生成結果を同じ作業空間で扱う。Studioを別の新state ownerにしない | Prompt、主要設定、使用中LoRA、生成、Recent、結果確認 |
| Gallery | 高密度で過去・新規の画像を探し、拡大・お気に入り・再利用 | 通常/NSFW・Favorite、拡大metadata、設定読込、部分コピー |
| Library | LoRAの整理・導入の作業場所 | フォルダー、移動/分類、URL導入、reload、元ページ |
| Settings | 使用頻度が低い設定と状態の詳細 | 既存domain設定、検索、接続・異常詳細 |

Generate / Gallery / Library / Settingsという入口は設計提案。既存navigation名/hash/saved-viewとの対応表を実装前に作り、無断で永続キーを変えない。LoRA SelectionはGenerateから開く選択画面、Libraryは管理責務として分離する。既存Compare/Experiments/Referenceはアクセス手段を保持し、配置を変える場合はモックで示す。

## 4. Generate / Studio

### Desktopの面積とスクロール

- 広い画面は左の編集・中央の大きい画像・右のRecentを出発点とする。右側へ大量metadataを常設せず、画像面積を優先。
- PC実利用は27インチでAI:LICがおよそ1:2。物理解像度から決め打ちせず、実際のCSS viewport幅で判断する。
- 狭いPCでは画像とPromptを残し、Recentを開閉できる補助領域へ移す案と、編集/画像の比率を調整する案を比較する。3列の単純縮小はしない。
- 編集領域の主スクロールは1本とし、Generateフッターを通常フローで分離する。入力欄内部のスクロールが必要な場合も、親との競合を検証する。
- 幅調整ハンドルやパネル開閉は任意候補。初期幅の品質を優先し、ユーザーによる修理操作を前提にしない。保存キー追加は別判断。

### 編集の優先順位

- 主編集はキャラ → 画風/作者タグ → シチュエーション → 背景。これは本人の編集順であり、現Structured schemaに新フィールドを自動追加する指示ではない。
- 各欄は通常コンパクト、編集中のみ広げる案。import、クリア、戻す、部分置換がどこへ作用するかを明示する。
- 主要設定はSampler、Steps、CFG、解像度/縦横比、Seed、生成枚数。2列等の小さなまとまりにし、隠すために極小文字にしない。
- Runtime/Checkpointは選択時に開く。現在選択を短く表示する案をモックに含めるが、常時表示は本人の必須条件ではない。
- Negativeは閉じてよい。その他の詳細を全部隠す許可は未確認のため、消さずアクセス可能な配置を比較する。
- Generate位置は一定。再生成/設定読込は既存Recipe操作を呼び、その成功・部分失敗を表示してPromptへフォーカス誘導する。新たな自動submitは行わない。

### 結果と生成状態

- 通常1枚を大きく表示し、複数候補の既存選択機能も維持する。拡大表示に前後移動と全画面候補を用意。
- Recentは残し、Galleryとのmetadata重複を抑える。MCP生成結果も既存History/Queue経路で確認する。
- 接続と生成稼働状態を小さく把握できる表示。展開時に進捗、段階、経過時間、待ち件数、途中画像、cancelを表示する提案。
- データが提供されない進捗項目は推測値で埋めない。MCP Jobと画面自身のactive Jobを混同せず、cancel対象を明示する。

## 5. Promptと場面再利用

### 表示改善で先行する範囲

- AIからの分割テキストimportを目立つ位置にする。既存parserと適用優先順位は保持。
- Rawは詳細入口に残し、Structured主導の利用を阻害しない。Raw override中は現在の状態を明示し、見かけだけStructuredを変える新bindingを作らない。
- テキストを正本とし、チップは補助表現として候補化する。括弧/weight/カンマ/LoRA tag等を壊す分割ならチップ編集を保留し、既存テキスト編集を先行する。
- Gallery詳細に既存の全設定読込と、対象部分のコピー入口を分ける。履歴に分割情報がない場合は推測でキャラ/場面を分類しない。
- 単なる文字列コピーで済む範囲と、Prompt ownerへ直接適用する新操作を区別する。部分置換はactive Prompt、既存undo/保存/LoRA同期への影響を確認してから実装範囲にする。

### 場面集とCheckpoint推奨設定

ユーザー要望は、場面をCheckpointごとに保存して名前/プレビューで選び、画風/Turbo・Negative・主要設定を含めて適用しつつ、現在のキャラを残すこと。既存LoRA outfit/presetを単に「場面」と改名して完成としない。

2026-09-07のread-only source確認で分かった現状（test/実機検証ではない）:

| 既存機構 / source | 確認した動作 | 今回要望との関係 |
| --- | --- | --- |
| [checkpoint-profiles.js](../../public/checkpoint-profiles.js)、[app.js](../../public/app.js)のapplyCheckpointSettings / checkpointAutoApply | 内蔵profileの自動判定またはCheckpointごとの手動割当。自動適用ONでwidth/height/steps/CFG/sampler/scheduler/noiseScheduleを反映 | 限定的な推奨設定自動適用は既にある。新機能として作り直す前に入口と出所を説明するUIを改善できる |
| [checkpoint-sets.js](../../public/features/checkpoint-sets.js)のcurrentSetPayload/apply/applyAuto | Checkpointに対応するSetを保存/自動適用。設定→LoRA全体restore→保存PromptがあればRaw positive/negativeの適用。Profileより後にSetが適用される | 重複設定はSetが最終値。現在キャラを保持する契約ではない。単なる設定だけの自動適用と混同させない |
| app read/writeStructuredSections、AI import、applyPresetToField | 対象欄への置換/追記の土台あり。History RecipeのStructured全体復元も存在 | 欄単位コピーの実装材料はあるが、過去画像から欄を選ぶ導線は別。保存Sceneの分類/preview/LoRA役割指定までは存在しない |

Setが保存するpromptBoostsは適用側で利用されておらず、場面保存の完成機能とみなさない。希望する場面集は現行Setの表示変更だけでは満たせない。キャラを失うriskを避け、既存Setは意味を維持し、当面は既存importの使い勝手を先行改善し、過去画像からの欄コピーは適合確認後に追加する案を採る。完全な保存場面には新domainまたはversioned拡張の独立contract設計が必要。

次を独立した適合設計で整理する。

1. 既存Checkpoint Sets / profile / Recipe / Structured履歴の保存・適用対象と公開portを対応表にする。
2. 推奨設定の自動適用を既存Profile/Checkpoint Setsの入口改善で満たせる範囲を検証する。両者の対象/順序を表示し、外部推奨値の自動取得やAIによる書換えは要求されたと推定しない。
3. 場面読込で保持するキャラと置換する画風/衣装/背景、重複LoRAやRaw時の扱い、手動調整と自動適用の優先順を明示する。
4. 既存API/schema/Recipeを保てる最小案を先に提示する。保存先・分類・プレビューのために新contractが必要なら、変更内容、risk、互換性、代替案を独立提案にする。

この適合設計は表示刷新と同時に検討できるが、成立を待って他の最重要UIを止めない。実現不能のまま場面保存完了とは扱わない。

## 6. LoRA Selection / Management

### Selection

- 左にフォルダーツリー、右にサムネイルと短い名前の選択領域を候補とする。狭い端末では全画面選択へ。
- 閉じて開き直すときのフォルダー位置を保持。翌日までの永続化を新規要件にしない。
- 使用中一覧は±、数値、衣装の状態が分かるコンパクトな行。スライダーは主操作にしない。
- Trigger Words/衣装は既存Prompt側の編集へつなぐ。disabledは現在の機能を維持し、好み未確認のため勝手に一覧から消さない。
- 最近使ったTurbo/画風は候補。既存履歴からの再利用可否を確認し、新しい保存履歴が必要なら保存仕様を別判断する。
- 合格目標: 同一セッションで再開すると前のフォルダーに戻る。見えているLoRAの選択は既存Outfit等の必要選択を除き余分な確認を増やさない。

### Management

- フォルダーツリー、分類・移動・reloadを中心にし、詳細metadataを常設しない。
- Civitai URL導入は小さい追加入口から必要時に開く案。既存Civitai controllerを再利用し、二重mountや直接POSTを作らない。
- 元ページへのアクセスを簡単にする。実ファイルmove/installはUI fixtureとは分離する。
- LibraryとSelectionで共通の見た目を使っても、catalogと選択stateのownerを統合しない。

## 7. Gallery / image detail

- 余白の少ない密なグリッドを採用候補にする。一覧metadataを絞り、Favoriteはタップでも利用可能にする。
- 一覧のcrop/全体表示は視覚比較で選ぶ。原寸比を歪めず、cropする場合は拡大で必ず全体が確認できる。
- 通常/NSFWは両方を初期候補にし、既存filterの意味と保存動作は維持する。Favoriteも短い操作で切り替える。
- 既存History ownerのloadMoreを自動追加の入口にする。loading/hasMoreと失敗時再試行を扱い、画面から独自fetch/cacheを作らない。キーボードで使える追加操作を予備入口として残す案。
- 戻る際にfilterと位置を保持。同一datasetでの復元を先に保証し、filter変更後の位置を無条件に再利用しない。
- 拡大上に画像操作とmetadataの展開入口。前後移動は読込済みの対象順を定義し、未取得画像の原寸先読みをしない。
- 最初にGallery filter raceを独立修正する。ユーザーの20枚問題についてserverとclientのfilter/sortを切り分け、原因を同一と断定しない。

## 8. Mobile / Settings / Inpaint / IP

- Mobileは最後の移植にしない。GenerateとGalleryの最初のモック/実装から390〜430pxを対象にする。
- 下部ナビは通常時に常設、Generateはキーボードを閉じたときに固定表示。入力中のナビ位置とviewport縮小は実Safariで判断し、キーボード上に操作を重ねない。
- 入力font、focus、paste、VisualViewport/ブラウザーUIの挙動を対象にし、UA判定だけで解決したとしない。
- Settingsは既存category/search/domain操作を保つ。問題時の表示と詳細への導線を整え、常時大きい管理ダッシュボードを追加しない。
- Inpaintは重要。必要時にキャンバスを開き、paint/erase/undo/redoを見失わない。表示scaleとmask座標/原寸/undoを分離したまま検証する。
- IPも重要。Runtime capabilityと利用不可理由を既存ownerから表示し、未対応providerの機能をUIで捏造しない。切替往復で保持stateを消さない。

## 9. 技術境界と変更種別

| 種別 | 例 | 計画上の扱い |
| --- | --- | --- |
| 表示/DOM adapter | 密度、配置、フォルダー表示、既存操作入口、status | 対象ownerとDOM contractを固定してfeature単位 |
| correctness prerequisite | Gallery race、Studio recent race、summary同期 | 表示変更と別差分。対象UI前にbehavior検証 |
| 機能・contract適合設計 | 場面保存、部分適用、自動推奨、recent保存 | 公開portで成立する範囲を確認。API/schema/semantics変更は独立判断 |
| 対象外 | Hires高速化、provider対応追加、全app分解、build導入、不要機能削除 | 今回のUI計画を理由に実装しない |

Runtime成功commit、Recipe rollback順/syncSize:false、Generation予約/one-shot、navigationから独立したQueue lifetime、Favorite owner、History schema/cursor、thumbnail/lazy/cache、session secrets、static/PWA/updateを維持する。詳細はUI boundariesを参照し、各Phaseで該当contractをtaskへ抜き出す。

## 10. 完了の判定と未確定事項

刷新の完成は見た目だけで判定しない。狭い画面で設定を選べる、読み込んでPromptへ戻れる、LoRA階層をたどり直さない、Galleryの全対象filterが正しい、iPhoneで入力を継続できることを検証する。

クリック数・スクロール量・画像表示面積は同じデータ/viewportでbefore/afterを比較する。未計測の短縮率を目標達成として報告しない。各PhaseのgateはRoadmapに定義する。

視覚2案の選択、詳細設定の折りたたみ範囲、場面保存/自動適用のcontract、拡大全画面の具体動作は未決定。長い再ヒアリングは行わず、具体的なモックや適合案を作ってから必要な判断を求める。
