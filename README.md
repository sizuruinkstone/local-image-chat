# Local Image Chat

日本語の指示をOllamaでStable Diffusion向けタグに変換し、ReForge APIでローカル画像生成するツールです。

## v2.12の主な機能

- LoRAルート誤認の修正: `models/Lora`などの既知フォルダ名から判定し、`Anime`や`Characters`をルートと誤認しない。特定できない場合はインストールを停止する
- Civitai保存先UIの改善: 実在フォルダと推奨フォルダを分離し、前回使用・お気に入り・推奨・既存フォルダの順で1つのリストから選択できる
- LoRA重複チェック: インストール前に導入済みかを確認し、既存を使う／メタデータだけ更新／別名で保存／指定フォルダへ移動 を選べる
- LoRAメタデータ編集: 表示名・分類・Trigger Words・推奨Weight・対応Checkpoint・メモなどを編集し、Civitai再解析でも上書きされない
- パラメータ一括比較生成: LoRA weightやCFGなどを複数値まとめて1枚ずつ生成し、ひとつの実験としてまとめる
- 画像比較モード: 2〜4枚を並べてズーム同期・設定差分・Prompt差分を確認し、A/B投票を記録する
- ギャラリーからの派生生成: 同じSeedで再生成／LoRAだけ変更／衣装・背景・表情だけ変更／設定を複製
- Checkpoint別LoRAセット: Checkpointごとによく使うLoRAと生成設定を保存し、切替時に自動適用できる
- 生成失敗時の自動リカバリ: VRAM不足やタイムアウトを検出し、安全側の設定で1回だけ再試行する
- 履歴の実験グループ化: ギャラリーを「画像一覧 / 実験ごと」で切り替え、実験単位で比較・名前変更・一括削除できる
- トースト通知と共通モーダル（Escで閉じる、Enterで主操作、Tabがモーダル外へ抜けない）

## v2.11の主な機能

- Civitaiリンク導入時にLoRAの保存先フォルダを選択（左でジャンル、右でサブフォルダの2段選択＋新規フォルダ作成、例: `characters/Blue Archive`）
- 分類デフォルトは、Illustrious/NoobAI/SDXL直下の`character`・`style`など実在フォルダを自動採用
- 保存先はLoRAルート配下に限定し、パストラバーサル・絶対パス・予約名・禁止文字をサーバー側で検証
- 分類ごとに保存先デフォルト（キャラクター→Characters 等）と最後の保存先を記憶
- 既存ファイルが別フォルダにある場合は移動せず、その場所を再利用して通知

## v2.10の主な機能

- 生成結果の仕上げ画像・候補画像・ギャラリー画像・LoRA作例を同じ拡大モーダルで表示（クリックで拡大、背景/×/Escで閉じる）
- 右パネルを「生成結果 / ギャラリー」タブへ再構成し、下部ギャラリーを廃止（ギャラリーは右タブへ移設）
- ギャラリー詳細から`Hiresする`で、元画像ベース（img2img）の高解像度仕上げを実行（結果は生成結果タブへ）
- 読込はギャラリータブを維持、生成・Hiresは生成結果タブへ自動切替
- 生成履歴カードの操作を👍・削除・読込・詳細へ整理し、画像クリックで拡大モーダル表示
- 履歴からの画像削除（history.jsonとoutputフォルダから安全に削除、`DELETE /api/history/:imageId`）
- 履歴カードにCheckpoint短縮名とLoRA数を表示し、詳細モーダルでCheckpoint・LoRA+Weight・生成設定・Prompt等を確認
- 新規生成時にCheckpoint名・hashを履歴へ保存（過去履歴は「Checkpoint記録なし」で後方互換）
- img2img・部分修正は詳細モーダル最下部へ移動
- 生成設定に「Noise schedule for sampling」（Automatic / Zero Terminal SNR）を追加し、生成前にReForgeのoptionsへ反映
- V-Pred系Checkpoint（NoobAI XL V-Pred 1.0、Obsession vPred V2.0）のプロフィールへ Zero Terminal SNR を設定し、Checkpoint切替の自動反映でも切り替え
- Civitaiの説明文・バージョン名から推奨Weight（単一値・範囲・全角/中国語表記）を抽出して登録情報へ保存
- 画風系LoRAをCivitaiからダウンロードした直後に推奨Weight・Trigger Wordsを初期適用（ユーザー設定は上書きしない）
- LoRA一覧の互換性バッジ横へ「推奨 0.80」「推奨 0.70～1.00」を表示（Civitaiから抽出できた場合のみ）
- 詳細プレビューにRecommended Weight・Recommended Range・現在値・「推奨値に戻す」ボタンを表示
- 実際に抽出できた値だけを推奨として扱い、fallback（0.75）は推奨表示しない
- LoRA一覧の各項目にCivitai登録済みの作例サムネイルを表示し、失敗時はプレースホルダーへ差し替え
- LoRA一覧の横に作例を大きく見る詳細プレビュー欄を追加（画面が狭いと上下配置へ切り替え）
- LoRAカードのホバー・フォーカスで一時プレビュー、クリックで固定。確認だけでLoRAは有効化されない
- 詳細欄にBase Model・互換性・Recommended Weight・Trigger Words・衣装プリセット数・Civitai情報・リンクを表示
- 現在のCheckpointとの互換性でLoRAを絞り込み（すべて／対応のみ／対応・近縁／非対応を隠す／プレビューありのみ）
- ReForgeの導入済みCheckpointを画面から一覧表示・切り替え
- WAI Illustrious、One Obsession、Nova Anime XL、iLustMixなどを判定し、解像度・Steps・CFG・Samplerを自動適用
- Civitai登録済みLoRAのベースモデルを現在のCheckpointと比較し、非対応や近縁モデルを警告
- PNG・JPEG・WebPのアップロード、生成候補、完成画像、履歴からのimg2img・Inpaint
- 元画像へ直接マスクを描き、白く塗った部分だけを変更する部分修正
- マスクのペン・消しゴム・ブラシサイズ・Undo/Redo・全消去
- Inpaint用Denoising、Mask blur、内部の埋め方、周辺余白の調整
- 用途別Denoisingプリセットと、元画像比率に合わせた解像度自動設定
- img2img候補を参照画像として再利用する高解像度仕上げ
- 全画像をPrompt・Seed・LoRA・生成設定付きのレシピとして履歴保存
- 画像単位の👍と、好みのタグ・LoRA・設定の自動集計
- 過去画像の構図・Seedを固定し、キャラクターまたは衣装だけ差し替え
- 画風・構図・光・雰囲気を独立したプロンプト部品として追加
- CivitaiモデルページURLからLoRA情報を確認し、ダウンロード・フォルダ配置・Trigger Words登録
- Civitaiリンク導入した既知キャラをモデルIDから判定し、衣装プリセットへ自動接続
- 未登録のCivitaiキャラもTrigger Wordsから`Civitai登録衣装`を自動作成
- キャラ特徴と服装タグを分離し、全キャラへ`衣装自由（服タグなし）`を用意
- Civitai説明文の複数衣装トリガーを検出し、全種類を独立プリセットとして登録
- CivitaiのTrigger Wordsが「トリガー＋髪＋衣装」の全部入り形式でも、各行を独立した衣装として登録
- 説明文の`Trigger Words`セクションから、API欄に載っていない追加衣装も補完
- 登録済みCivitai LoRAを再ダウンロードせず、一括で再解析して衣装情報を更新
- 複合LoRA用にキャラクターと衣装を別々のプルダウンから同時選択
- 導入済みLoRAのURLを貼り直した場合は再ダウンロードせず、分類と衣装情報だけ更新
- 画像生成を直列キュー化し、進捗・残り時間・中止操作を表示
- プロンプト変換後にOllamaを明示的にアンロードしてVRAMを確保
- GitHubの最新版を検知し、設定・履歴・画像を残したまま自己更新
- Windowsでは依存関係更新を`cmd.exe`経由で実行し、`spawn EINVAL`を回避

## 前提

- Node.js 20以上
- Ollamaと`qwen3:1.7b`
- `--api`を付けて起動したReForge
- ReForgeへ使用したいチェックポイントを導入済み

## 起動

1. Ollamaを起動する。
2. ReForgeを`--api`付きで起動する。
3. `start.bat`をダブルクリックする。
4. ブラウザで <http://127.0.0.1:3030> を開く。

初回だけ依存パッケージのインストールが走ります。

## 基本的な使い方

1. 日本語で生成内容を入力する。
2. 表にある候補枚数を`1〜4枚`から選び、`候補を生成`を押す。
3. 候補をクリックして1枚選ぶ。
4. `選択画像をHires.fix`を押して、そのSeedだけ1.5倍で仕上げる。

候補枚数は前回の選択をブラウザに記憶し、初期値は最速の1枚です。
複数候補もGPUメモリに同時展開せず、ReForge APIを1枚ずつ呼び出して安全に処理します。
元画像とHires.fix済み画像はすべて`outputs`にも保存されます。
画面を閉じても生成はサーバー側のキューで継続します。再度開いた場合は履歴から結果を確認できます。

## Checkpoint

`Checkpoint`欄にはReForgeが認識しているモデルが表示されます。選択を変えるとReForge側でもモデルが切り替わり、`切替時に推奨設定を適用`が有効なら幅・高さ・Steps・CFG・Sampler・Scheduler・Noise schedule for samplingをモデル別プロフィールへ合わせます。Prompt、Negative prompt、LoRA、Seedは変更しません。V-Pred系Checkpointでは`Noise schedule for sampling`が自動で`Zero Terminal SNR`になり、生成前にReForgeのoptionsへ反映されます（optionsのキーがReForgeで異なる場合は`config.local.json`の`reforge.noiseScheduleOptionKey`で上書きできます）。

モデル名から判定できない場合は`設定プロフィール`を手動で選択できます。選択内容はCheckpointごとにブラウザへ保存されます。ReForgeで別のモデルへ切り替えてから画面を開いた場合は、ReForgeの実際の選択状態を優先します。

Civitai URLから登録したLoRAにはベースモデル情報が保存されます。現在のCheckpointと一致しない場合はLoRA行と選択中一覧へ警告を表示します。警告があっても生成は止めないため、近縁モデルを試すことはできます。手動配置だけでベースモデル情報のないLoRAは判定対象外です。

## img2img

1. 生成モードを`元画像から生成`へ切り替える。
2. PNG・JPEG・WebPをドロップするか、`画像を選択`を押す。20MBまで読み込める。
3. 変化プリセットを選び、日本語で変更内容を入力する。
4. 候補枚数を選び、`img2img候補を生成`を押す。
5. 候補を選び、`選択画像をimg2img仕上げ`を押すと、その候補を参照画像として1.5倍で再生成する。

生成候補、完成画像、履歴にある`img2img`または`img2imgへ`を押すと、ファイルを選び直さず参照画像へ設定できます。
アップロードした参照画像は内容ごとに`outputs`へ1回保存し、履歴には元画像との関係、Denoising、リサイズ方法を記録します。

変化プリセットの目安:

| プリセット | Denoising | 用途 |
| --- | ---: | --- |
| ほぼ維持 | 0.25 | 色・質感・細部の修正 |
| 画風を変更 | 0.35 | 構図を残してテイスト変更 |
| 衣装を変更 | 0.45 | 顔と構図をなるべく維持 |
| キャラを変更 | 0.60 | ポーズを残して別キャラ化 |
| 大きく描き直す | 0.72 | 元画像を下敷きとして使用 |

Denoisingが低いほど元画像に近く、高いほどPromptとLoRAの影響が強くなります。
元画像との縦横比が異なる場合は`比率を保って中央クロップ`が既定です。画像選択時は現在の長辺を基準に、64刻みで元画像の比率へ幅・高さを自動調整します。

## 部分修正（Inpaint）

1. 生成モードを`部分修正`へ切り替える。
2. 元画像をドロップするか、候補・完成画像・履歴の`修正`または`部分修正`を押す。
3. 画像上で変更したい場所を白く塗る。`消す`でマスクだけを消せる。
4. 日本語で変更内容を入力し、`部分修正候補を生成`を押す。
5. 候補を選び、`選択画像を部分修正仕上げ`を押すと、その候補全体を高解像度化する。

マスクは白い場所だけが変更対象で、黒い場所は維持されます。服を変更する場合は服の輪郭より少し外側まで塗り、顔だけ直す場合は髪や首を避けると境界が崩れにくくなります。
`Mask blur`は塗った境界をReForge側でなじませる値です。まずは`4`、境界が目立つ場合は`8〜12`を試してください。
`Denoising`は`0.55`が既定です。元の形を強く残すなら`0.35〜0.50`、大きく描き直すなら`0.60〜0.75`が目安です。
通常の部分修正ではマスクも`outputs/`へ内容単位で保存され、履歴レシピから元画像・マスク・設定の関係を確認できます。

## 履歴・👍・構図固定

生成した画像は右パネルの`ギャラリー`タブ（`生成履歴と好み`）へ自動追加されます。右上のタブで`生成結果`と`ギャラリー`を切り替えられ、生成やHires実行時は自動で`生成結果`タブへ、`読込`時は`ギャラリー`タブのまま維持します。保存先は次のとおりです。

- 画像本体: `outputs/`
- 👍を付けた画像の複製: `outputs/favorite/`
- Prompt・Seed・LoRA・設定・👍: `data/history.json`

候補または履歴の👍を押すと、好きなタグ・LoRA・解像度設定を集計します。
同時にその画像を`outputs/`から`outputs/favorite/`へ複製するので、気に入った画像だけをフォルダで見返せます。👍を外すと`outputs/favorite/`側の複製は削除されます（`outputs/`の元画像と履歴は残ります）。
サーバー起動時に、既に👍が付いている画像で`outputs/favorite/`に無いものを自動で複製します。
保存先を変えたい場合は環境変数`LOCAL_IMAGE_CHAT_FAVORITES_DIR`で指定できます。
`👍の傾向を追加`を押すと、頻出タグ上位を次回生成のプロンプト部品として使用します。

履歴カードの操作は左から`👍`・`削除`・`読込`・`詳細`です。`読込`を押すと、元画像のPrompt・Seed・設定・LoRAを読み込み、構図を固定します。
その後にキャラLoRAや衣装プリセットだけ変更して生成すると、構図をなるべく維持した差分を作れます。
Seed固定は厳密なポーズ固定ではないため、キャラクターの体格やLoRAの影響が強い場合は構図も多少変化します。
`削除`は確認のうえ、その画像を履歴と`outputs/`から削除します（同じ生成の最後の1枚を消すと生成ごと削除します）。カード画像をクリックすると拡大表示、`詳細`でCheckpoint・LoRA+Weight・生成設定・Prompt・Negative Promptを確認でき、詳細の最下部から`img2imgへ`・`部分修正`を実行できます。過去の履歴でCheckpoint情報がない場合は`Checkpoint記録なし`と表示します。

## LoRA

1. Stability Matrixのモデルブラウザで、種類が`LoRA`の`.safetensors`を追加する。
2. キャラLoRAはReForgeのLoRAフォルダ内に`Characters`、`Character`、`Chara`、`キャラ`、`キャラクター`のいずれかのフォルダを作って移動する。
3. Local Image Chatの`LoRA`欄を開き、`再読込`を押す。
4. `キャラクター`または`画風・体型・構図`タブからLoRAを選び、スライダーで強度を調整する。
5. 必要なら各LoRAの`衣装・Trigger設定`または`Trigger・Negative設定`を開き、配布ページ記載の語句を入力する。
6. 通常どおり候補を生成する。選択したLoRA・強度・Trigger WordsはHires.fixにもそのまま引き継がれる。

ReForgeが返すサブフォルダをそのまま画面内の折り畳みグループとして表示します。登録済みキャラプロフィールはフォルダ名に関係なく`キャラクター`へ分類し、それ以外は`画風・体型・構図`へ分類します。

各LoRAには、Civitai URLから登録した作例のサムネイルが表示されます。一覧は左35%・プレビュー右65%の配置で作例を大きく確認でき、プレビュー画像をクリックすると全画面のモーダルで拡大表示します（ESCまたは背景クリックで閉じる）。サムネイルやカードへマウスを乗せる（またはフォーカスする）と右側のプレビュー欄へ一時表示し、クリックすると固定できます。一覧カードはサムネイル・名前・互換性・強度・追加チェックのみのコンパクト表示にし、Category・Civitai情報などの補足はプレビュー欄の「詳細情報」に折りたたんでいます。プレビューを確認しただけではLoRAは有効化されません。有効化・解除はチェックボックスまたはプレビュー欄の`LoRAを選択`ボタンで行います。プレビュー欄にはBase Model・現在のCheckpointとの互換性・Recommended Weight・Trigger Words・衣装プリセット数・Civitaiのモデル名やバージョン、配布ページへのリンクを表示します。作例画像はCivitai URLから登録したLoRAにのみ表示され、手動配置だけのLoRAはプレースホルダーになります。
`LoRAを検索`の隣の絞り込みで、現在のCheckpointとの互換性による表示（すべて／対応のみ／対応・近縁／非対応を隠す／プレビューありのみ）を切り替えられます。テキスト検索・分類タブと組み合わせて使えます。

Civitai URLから登録した画風系LoRAは、Civitaiの説明文やバージョン名に書かれた推奨Weight（`Weight: 0.8`、`Weight 0.7-1.0`、`推奨強度 0.6〜0.8` など）を自動抽出して保存します。ダウンロード直後は、この推奨値とTrigger Wordsを初期値として適用します（すでに手動で強度を変えたLoRAは、再解析や再起動でも上書きしません）。一覧の互換性バッジの横に`推奨 0.80`や`推奨 0.70～1.00`が表示され、詳細プレビューにはRecommended Weight・Recommended Range・現在値と`推奨値に戻す`ボタンが並びます。Civitaiから実際に抽出できた値だけを推奨として表示し、抽出できず初期値0.75を使う場合は推奨として表示しません。`登録済みを一括再解析`で推奨値やTrigger Wordsの登録情報を更新できますが、あなたが変更した現在の強度は保持されます。

おすすめの配置例:

```text
Lora/
├─ Characters/
├─ Style/
├─ Body/
└─ Pose/
```

`Style`、`Body`、`Pose`はすべて`画風・体型・構図`タブ内に表示され、その中で実フォルダ別にまとまります。ルート直下のLoRAは`未分類（画風など）`へ表示されます。

登録済みキャラLoRAは初回検出時に`衣装自由（キャラ特徴のみ）`が選ばれ、本人のTrigger Wordsだけを追加します。
標準衣装のタグはLoRA行の赤い抑制欄からNegative promptへ自動追加されるため、生成内容に書いた私服・スーツ・水着などへ着替えやすくなります。抑制したくない単語は画面で削除できます。
原作衣装を使う場合は衣装プリセットを選ぶと、衣装用Trigger Wordsへ切り替わり、抑制タグは解除されます。ファイル名を変更して自動認識されない場合も、プロフィールを手動で選択できます。
v1.8以前で標準衣装が自動選択されていたプロフィールは、初回起動時に衣装自由へ移行します。手動編集済みのTrigger Wordsや、標準以外を選んだ衣装は保持します。

### 登録済みLoRAプロフィール

- 藍沢エマ v2.0: 衣装自由＋23衣装
- ラストライト: 衣装自由／標準衣装
- ドライツェーン: 衣装自由／ケープあり／なし
- 倉持めると: 衣装自由＋3パターン
- 石神のぞみ: 衣装自由＋3衣装
- Zoe Rayne IL v2: 衣装自由／標準衣装
- ロキシー・ミグルディア v2.0: 衣装自由／魔術師A／魔術師B／Cozy
- キュアアルカナ・シャドウ v2.0: 衣装自由／全身衣装／ロッド持ち
- シャニマス v2.0: 画風＋28キャラ＋2衣装
- 周防パトラ: 衣装自由＋2衣装

最大4個まで同時に使用できます。既定強度は`0.70`で、`config.json`から変更できます。
WAI Illustriousでは、`Illustrious`または`NoobAI`対応と明記されたLoRAを優先してください。
SD1.5、Flux、Pony専用LoRAは互換性がなく、崩れたり効果が出なかったりする場合があります。
配布ページにTrigger WordsがあるLoRAは、生成内容またはPrompt欄にもその語を入力してください。
Trigger WordsはブラウザへLoRA名ごとに自動保存され、次回そのLoRAを選ぶとPromptへ自動追加されます。

### Civitai URLから直接追加

1. `Civitai URLからLoRAを追加`を開く。
2. `https://civitai.com/models/...`形式のモデルページURLを貼る。
3. キャラクター・画風・体型・構図の分類を選ぶ。
4. `保存先フォルダ`を選ぶ。前回使用・お気に入り・推奨・既存フォルダから選ぶか、`＋ 新しいフォルダを作成`で相対フォルダ名を入力する。
5. `内容を確認`でベースモデル、ファイル名、Trigger Words、保存先を確認する。
6. `ダウンロードして登録`を押す。すでに導入済みなら重複確認画面が出る。

保存先フォルダはLoRAルート配下の任意の既存フォルダまたは新規サブフォルダを指定できます。分類と保存先は別項目で、分類ごとに前回の保存先を記憶します。保存先は必ずLoRAルート配下に限定され、`../`や絶対パス、Windows予約名（CON等）、禁止文字（`< > : " | ? *`）はサーバー側で拒否します。同名ファイルが別フォルダに既にある場合は移動せず、その場所を再利用して通知します。
LoRAルートの判定順と、検出できない場合の対処は「LoRAルートの設定方法」を参照してください。

閲覧制限付きモデルでCivitai APIキーが必要な場合だけ、画面のAPIキー欄へ入力します。
キーは現在のブラウザタブのセッションにのみ保持され、履歴やGitHubには保存しません。

### LoRAルートの設定方法

`Civitai URLからLoRAを追加`の上部に、現在認識しているLoRAルートを表示します。

```text
LoRAルート: C:\StableDiffusion\ReForge\models\Lora   [設定済み]
```

バッジは`設定済み`（`config.local.json`で明示）、`ReForge設定`（ReForgeの`/sdapi/v1/cmd-flags`から取得）、`自動検出`（既存LoRAのパスから推定）のいずれかです。
`LoRAフォルダを開く`でエクスプローラーが開きます。開く対象はサーバー側で確定したLoRAルートだけで、任意パスは渡せません。

判定は次の優先順です。

1. `config.local.json`（または`config.json`）の`lora.installDir`
2. ReForgeの設定APIから取得できるLoRAディレクトリ
3. 既存LoRAのパス中の`models/Lora`・`models/Loras`・`models/LyCORIS`（大文字小文字は区別しない）
4. 安全に特定できない場合は自動インストールを停止

`Anime`・`Character`・`Characters`・`Style`・`Body`・`Pose`・`Illustrious`・`NoobAI`・`SDXL`・`Pony`などの整理用サブフォルダは、ルート候補として採用しません。
特定できない場合は次のメッセージを表示し、フォルダを勝手に作りません。

```text
LoRA保存先を安全に特定できません。
config.local.json の lora.installDir にReForgeのLoRAルートを設定してください
```

`config.local.example.json`を`config.local.json`へコピーして、実際のパスへ書き換えてください。

```json
{
  "lora": {
    "installDir": "C:\\StableDiffusion\\ReForge\\models\\Lora"
  }
}
```

パスはお使いの環境に合わせて変更してください（Stability Matrixなら`...\Data\Models\Lora`など）。

### 保存先フォルダの選び方

保存先は1つのリストから選びます。並び順は次のとおりです。

1. 前回使用した保存先（分類ごとに直近3件を記憶）
2. お気に入り保存先（☆を押すと登録、★で解除）
3. 推奨保存先（キャラクター→Characters、画風→Style、体型→Body、構図・ポーズ→Pose）
4. 既存フォルダ（実在するフォルダだけ）
5. ＋ 新しいフォルダを作成

実在しない推奨フォルダは`推奨: Characters（新規作成）`と表示し、既存フォルダ一覧へは混ぜません。
選択中の相対パス全体と、新規作成されるかどうかは常に画面下へ表示します。

### 重複していた場合

すでに導入済みのLoRAを入れようとすると、インストール前に確認画面が出ます。

```text
既に導入済みです
保存場所: Anime/Style/FlatPainting.safetensors
登録バージョン: v1.0
Civitaiバージョン: v1.1
```

選べる操作は次の4つです。

- 既存を使う: ダウンロードせず、登録情報だけ現在の保存場所へ紐付ける
- メタデータだけ更新: ファイルに触れず、Trigger Wordsや推奨Weightなどを更新する
- 別名で保存: `FlatPainting-v1.1.safetensors`のような候補名でダウンロードする
- 指定フォルダへ移動: 既存ファイルを選んだフォルダへ移動する（確認ダイアログあり）

上書き・削除・自動移動は行いません。移動では`.safetensors`と、存在する`.preview.png`・`.png`・`.json`も一緒に扱い、移動先に同名ファイルがあれば何も動かさずに中止します。

### LoRAメタデータの編集

プレビュー欄の`編集`から、表示名・分類・サブ分類・Trigger Words・Negative Words・推奨weight（値／最小／最大）・対応Checkpointファミリー・メモ・お気に入り・保存先・プレビュー画像URLを編集できます。
内容は`data/lora-registry.json`へ保存します。編集した項目は`manualFields`として記録し、`登録済みを一括再解析`を実行してもユーザーの編集を上書きしません。
保存先を変更した場合だけ実ファイル移動の確認を出し、移動後はregistry更新・ReForgeのLoRA再読込・UI再取得まで行います。
Civitai経由でないLoRAも、編集を開いた時点で登録が作られるので同じように扱えます。

## パラメータ比較と実験グループ

`パラメータ比較`を開き、比較対象・試す値（カンマ区切り）・Seed固定を指定して`比較生成`を押します。

```text
比較対象: LoRA weight
対象LoRA: Flat Painting
試す値:   0.5, 0.6, 0.7, 0.8
Seed固定: ON
```

- 比較できるのは LoRA weight / CFG / Steps / Seed / Denoising / Sampler / Scheduler / Hires倍率 / Hires Denoising のうち1項目です
- 生成は並列ではなく1枚ずつ直列に実行し、`2 / 4 生成中・Flat Painting: 0.6`のように進捗を表示します
- 既定は最大8枚、`config.json`の`experiments.maxImages`で最大12枚まで許可できます。5枚以上は確認ダイアログが出ます
- `中断`で途中キャンセルできます。完了済みの画像は履歴に残ります

生成結果は`experimentId`でひとまとまりになり、ギャラリーの`実験ごと`タブに実験カードとして表示されます。

```text
Flat Painting LoRA weight test   完了
4枚（完了 4） / Seed 1753486420 / 0.5 / 0.6 / 0.7 / 0.8
[開く] [比較] [名前変更] [削除]
```

`削除`では「履歴だけ削除」と「履歴と画像を削除」を選べます。どちらも確認が必要です。

### 画像比較

ギャラリーの各カードの`比較`（または詳細の`比較対象へ追加`）で2〜4枚を選び、上部の`比較する`を押します。実験カードの`比較`からも開けます。

- 画像を横に並べ、ホイールで拡大・ドラッグで移動。倍率と位置は全画像で同期します
- Seed・比較パラメータ・設定差分・LoRA weight差分・Prompt差分（Aを基準に追加/削除）を表示します
- `Aが良い` / `Bが良い` / `引き分け` を選ぶと結果を保存します。勝敗は履歴画像の`vote`と`data/experiments.json`へ残り、実験の最良画像としても記録されます

### ギャラリーからの派生生成

履歴カードの`詳細`から次の操作ができます。

- 同じSeedで再生成: Prompt・Negative・Seed・Checkpoint・LoRA・Sampler・Scheduler・Steps・CFG・解像度を復元して生成画面へ読み込む
- LoRAだけ変更: 元レシピを読み込んだうえで、専用モーダルからLoRAの追加・解除・weight変更を行う
- 衣装だけ変更 / 背景だけ変更 / 表情だけ変更: 指示（例`夜の東京の屋上`）を入力すると、元Promptへ追加指示を加えて読み込む
- 設定を複製: Seedはランダムのまま設定だけ複製する
- 比較対象へ追加: 比較画面の対象に加える

追加した指示は履歴へ`derivationType`・`derivationInstruction`として保存します。

## Checkpoint別LoRAセット

`Checkpoint`欄の`LoRAセット`から、Checkpointごとによく使うLoRAと生成設定をまとめて保存できます。

- 保存内容: Checkpoint / LoRA一覧と各weight / Trigger Words / Negative Words / Sampler / Scheduler / Noise Schedule / Steps / CFG / Width / Height / Hires設定 / Promptプリセット
- 操作: 現在の設定を保存・読込・名前変更・複製・削除・自動適用ON/OFF
- 自動適用は同じCheckpointにつき1つだけ有効です
- Checkpoint切替時、自動適用ONのセットがあれば読み込み、`NoobAI 基本セットを適用しました`と通知します
- 設定を編集していた場合は確認ダイアログを出し、勝手に上書きしません
- 未導入のLoRAはスキップし、警告で知らせます

保存先は`data/checkpoint-lora-sets.json`です。既存のCheckpointプロフィール・LoRAプロフィールとは別管理で、互換性に影響しません。

## 生成失敗時の自動リカバリ

VRAM不足・タイムアウト・接続断・一時的なHTTP 5xxを検出すると、安全側の設定で**1回だけ**再試行できます。

```text
VRAM不足のため、以下の設定で1回だけ再試行します
- 候補枚数: 4 → 1
- Hires倍率: 1.8 → 1.6
- Hires Steps: 20 → 12
[再試行する] [中止]
```

調整の優先順は 候補枚数を1へ → Hires倍率を0.2下げる → Hires Stepsを減らす → 解像度を64単位で縮小 → Hiresを無効化 です。
タイムアウトや接続断は同じ設定のまま1回だけ再接続します。
`生成設定`の`VRAM不足・タイムアウト時に、安全設定で1回だけ自動再試行する`をONにすると、確認なしで再試行します。
再試行は必ず1回で打ち切り、無限に繰り返しません。履歴には`originalSettings`・`retrySettings`・`retryReason`・`retryCount`を保存します。
OllamaのVRAM解放に失敗しても、ReForgeの生成が可能なら警告扱いで続行します。

## バックアップ

起動時に`data/`のデータ形式を確認し、必要ならschemaVersionを上げます。書き換える前に必ずバックアップを作成します。

```text
data/backups/history-20260726.json
data/backups/lora-registry-20260726.json
```

同じ日に複数回移行しても、最初のバックアップは上書きしません。
手動でバックアップしたい場合は、`data/`フォルダ（`history.json`・`lora-registry.json`・`experiments.json`・`checkpoint-lora-sets.json`）と`outputs/`をコピーしてください。
`config.local.json`はGit管理外なので、更新前に別途控えておくと安全です。

## 設定

接続先、Ollamaモデル、既定の生成設定は`config.json`で変更できます。
個人PC固有のパスはGit管理されない`config.local.json`へ書くと、`config.json`を上書きせず設定できます。

```json
{
  "lora": {
    "installDir": "C:\\StableDiffusion\\ReForge\\models\\Lora"
  }
}
```

実際のパスはお使いの環境に合わせて変更してください。
比較生成の最大枚数は`experiments.maxImages`（既定8、上限12）で変更できます。

Ollamaはプロンプト変換後にアンロードするため、画像生成時にVRAMを占有し続けません。
標準設定ではQwenのThinkingとJSON構造化出力を使わず、Illustrious/NoobAI向けの軽量なタグ変換だけを行います。Ollamaを5分、ReForgeを15分でタイムアウトします。
短い指示は最大48タグ、詳細な指示は最大96タグへ整理されます。同一タグの反復、低価値な定型句、`nude`と`detailed clothing`のような明白な矛盾は自動除去します。
Qwenの反復抑制は`ollama.repeatPenalty`、出力上限は`ollama.numPredict`、タグ上限は`ollama.maxTags`で調整できます。

WAI Illustrious v17向けの既定値は`Euler a / Automatic / 25 Steps / CFG 6 / 896x1152`です。
img2imgは`Denoising 0.45 / 中央クロップ`です。
Inpaintは`Denoising 0.55 / Mask blur 4 / 元画像を使う / マスク部分だけ高精細`です。
Hires.fixは`1.5倍 / 20 Steps / Denoising 0.4 / R-ESRGAN 4x+ Anime6B`です。
img2img・Inpaint仕上げはRX 6700 XT 12GBでの過大生成を避けるため、約260万画素を上限に縦横比を保って縮小します。

## GitHubから更新

`アプリのアップデート`を開いて`最新版を確認`を押すと、設定されたGitHubリポジトリの`package.json`と現在のバージョンを比較します。
更新時は`.updates/backup-*`へ旧版を退避し、以下を保持します。

- `config.json`と`config.local.json`
- `data/`の履歴・Civitai登録情報
- `outputs/`の生成画像

更新が成功したら`start.bat`の画面を閉じ、もう一度起動してください。
現在のリポジトリは非公開なので、GitHubのFine-grained PATを利用する場合は対象リポジトリ限定・`Contents: Read-only`で作成し、画面へ入力します。

## トラブルシューティング

- `ReForge: 接続失敗`: ReForgeが起動中か、`--api`が有効か確認する。
- `Ollama: 接続失敗`: WindowsのスタートメニューからOllamaを起動する。
- サンプラーエラー: 画面のSamplerをReForgeに存在する名前へ変更する。
- Hires upscalerエラー: ReForge側に`R-ESRGAN 4x+ Anime6B`があるか確認し、なければ画面で利用可能なUpscaler名へ変更する。
- LoRAが一覧に出ない: Stability Matrix側で配置先がLoRAになっていることを確認し、画面の`再読込`を押す。フォルダ移動後に反映されなければReForgeを再起動する。
- Civitaiから保存できない: `config.local.json`の`lora.installDir`を確認する。制限付きページはCivitai APIキーも入力する。
- GitHub更新を確認できない: 非公開リポジトリへアクセスできるFine-grained PATの`Contents: Read-only`権限を確認する。
- キャラLoRAが画風側に出る: 親フォルダ名を`Characters`または`キャラ`にして`再読込`する。登録済みプロフィールを手動選択したLoRAもキャラ側へ移動する。
- LoRAで絵が崩れる: 対応ベースモデルを確認し、強度を`0.4〜0.7`へ下げる。複数LoRAは1個ずつ試してから重ねる。
- メモリ不足: 解像度を`768×1024`以下にし、Batchを1のまま使う。
- img2imgが元画像とほぼ同じ: Denoisingを`0.45〜0.65`へ上げる。
- img2imgで顔や構図が崩れる: Denoisingを`0.25〜0.45`へ下げ、LoRAを1個ずつ試す。
- Inpaintで何も変わらない: 白いマスクが残っているか確認し、Denoisingを`0.55〜0.70`へ上げる。
- Inpaintの境界が目立つ: 塗る範囲を少し広げ、Mask blurを`8〜12`へ上げる。

出力画像は`outputs`にも保存されます。
