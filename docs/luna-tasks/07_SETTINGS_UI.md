# Luna Task 07：設定画面UI改善

## このタスクの担当範囲

既存の設定値、保存方式、API、イベント処理を維持したまま、設定画面を「左カテゴリナビ + 右設定本文」の2カラムへ整理してください。

- Vanilla HTML / CSS / JavaScript と Express 構成を維持する
- 新規リポジトリ・新規依存・UIフレームワークを追加しない
- `public/ui-kit.js`、既存Option Picker、native input/select/checkboxを優先する
- 設定値、保存先、API、データ形式、ReForge/Discord/Civitai処理を変更しない
- Task 06（ギャラリー画面）へ関係するDOM・CSS・処理は変更しない

`DESIGN.md` は2026-08-05時点のリポジトリ直下には存在しません。作業開始時に再確認し、存在していれば先に全文を読んでください。存在しない場合は、本書と既存の `public/style.css` のトークンを基準にしてください。

## 現行実装で確認済みの事実

- 設定ルートは `public/index.html` の `#viewSettings > .viewPanel`
- 現在は多くのトップレベル `<details>` が縦に直列配置されている
- `#studioGenerationSettingsMount` には起動時に `#promptPartsDetails` の実DOMが移される
- 生成設定フォーム本体は生成画面に残り、設定画面へは「プロンプト部品・好み補助」だけを移している
- 現在の主セクション:
  - `#titleGenerationDetails`
  - アプリ管理（IDなしの `<details>`）
  - `#checkpointDetails`
  - `#settingsLoraDetails`
  - `#civitaiDetails`
  - `#promptTemplateDetails`
  - `#discordDetails`
  - `#mobileAccessDetails`
  - `#updateDetails`
- 生成画面の「LoRA管理」は現在 `showView("settings")` 後に `settingsLoraDetails.open = true` と `scrollIntoView()` を実行する
- 保存方式はlocalStorage、自動保存、個別API、サーバーJSON Storeが混在する
- Discord Webhookはサーバー側保存で、画面へ値を戻さない
- Checkpointセット、LoRAレジストリ、Civitai、Grokテンプレート、更新処理はそれぞれ既存関数とイベントを持つ

## 変更予定ファイル

原則として次の4ファイル以内に収めてください。

- `public/index.html`
- `public/app.js`
- `public/style.css`
- `test/ui-shell.test.js`（必要なら `test/ui.test.js` / `test/layout-overflow.test.js` も更新）

サーバー側、API、データモジュールは変更しないでください。設定検索のためだけに新しいJSファイルや依存を増やす必要はありません。範囲が増える場合は変更前に理由を報告してください。

## 目標構造

```text
#viewSettings
└─ .settingsLayout
   ├─ .settingsSidebar
   │  ├─ 設定検索
   │  ├─ カテゴリナビ
   │  └─ 接続・通知・更新の簡易状態
   └─ .settingsContent
      ├─ 選択カテゴリ見出し
      ├─ 保存状態
      └─ 選択カテゴリの既存設定DOM
```

デスクトップ基準:

```css
.settingsLayout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 24px;
  min-width: 0;
}

.settingsContent {
  width: 100%;
  max-width: 860px;
  min-width: 0;
}
```

- 右側の空白を減らしながら、本文を読みづらい超横長にはしない
- 左ナビは設定画面内だけでstickyにしてよいが、アプリヘッダーへ重ねない
- ページ全体と設定本文に競合する二重スクロールを作らない
- absolute、fixed、負marginで2カラムを作らない
- 設定DOMを複製せず、各既存IDは1個だけにする

## カテゴリ構成

次のカテゴリを基準にし、既存項目だけを割り当ててください。実設定が1件もないカテゴリは表示しません。

### 一般

- アプリ管理
- 接続確認、最新版確認、Grok用全コピー、AI共有CSV更新のうち一般操作
- 既存のアプリ全体に関する補助状態

### プロンプト

- `#studioGenerationSettingsMount`
- `#promptPartsDetails` の既存「プロンプト部品・好み補助」
- DOMを複製せず、現在の起動時append方式を維持または同等の一度だけの移動にする

### モデル

- `#checkpointDetails`
- Checkpointプロフィール
- LoRAセット
- 既定値・自動適用

### LoRA

- `#settingsLoraDetails`
- LoRA検索、分類、Preview、編集・選択関連の既存機能
- `#civitaiDetails`（Civitai URLからLoRAを追加）
- Civitai機能は生成画面へ戻さず、このカテゴリ内だけに残す

### 履歴・ギャラリー

- `#titleGenerationDetails`
- 履歴タイトル生成方式
- 既存のギャラリー関連設定が追加済みならここへ配置

### Discord通知

- `#discordDetails`
- Favorite通知と生成完了通知
- Webhook、添付、表示項目、テスト通知、保存状態

### 接続

- `#mobileAccessDetails`
- スマホ接続 / Tailscale等の案内
- ReForgeの既存接続状態の読み取り専用要約

### 外観

- 現行リポジトリに設定項目がない場合はカテゴリ自体を表示しない
- このタスクでテーマ、配色、密度設定などを新設しない

### 詳細

- `#promptTemplateDetails`（Grok向け指示テンプレート）
- その他、既存の高度な管理項目だけ

### アプリ情報

- `#updateDetails`
- バージョン / 更新確認 / 更新適用
- 既存情報が取得できる範囲だけを表示し、新しい更新APIは作らない

## カテゴリナビ

- button要素で構成し、キーボード操作可能にする
- 選択中は `aria-current="page"` または `aria-selected="true"` を付ける
- ライムは細い左線、下線、または文字色だけに限定する
- 大きなライム背景、発光、太い枠を使用しない
- ReForge接続済み、Discord未設定、更新あり、エラーあり等は小さなドットまたは短い補助テキストで表示してよい
- 状態を得るために新しいポーリングやAPIを追加しない
- `checkHealth()`、`loadDiscordSettings()`、更新確認など既存結果を受けて同じ表示stateを更新する
- 未確認状態を「接続済み」と推測表示しない

カテゴリ切替では選択カテゴリのDOMだけを表示し、他カテゴリをCSSで画面外へ追い出したり `opacity: 0` にしたりしないでください。`hidden` 属性または既存 `.hidden` で非選択パネルをレンダリング済みDOM上から非表示にするのは許可します。要素の複製・再生成は避けてください。

## 生成画面からLoRA管理への導線

既存の `openLoraManagementButton` は次の挙動へ更新してください。

1. 現在のPromptと生成設定stateはそのまま保持
2. `showView("settings")`
3. 設定カテゴリ「LoRA」を選択
4. `#settingsLoraDetails` を表示
5. 必要なら既存LoRAセクションを開く
6. 見える位置へスクロールまたは最初の操作要素へフォーカス

この導線を共通の `activateSettingsCategory(categoryId, { targetId })` 相当の小さな関数へ寄せてください。既存テストの `settingsLoraDetails.open = true` という実装文字列に固執せず、実際の導線と状態保持を検証するテストへ更新して構いません。

## 設定検索

左上へ設定名・補助説明を検索できるnative `input type="search"` を追加してください。

### 最小実装

- 既存カテゴリと主要セクションを静的な検索インデックスとして `public/app.js` 内に定義する
- 各項目は `categoryId`、表示名、既存target ID、検索用キーワードを持つ
- 実DOMや設定値を複製して検索結果へ埋め込まない
- 入力値はtrimし、大文字小文字を区別せず検索する
- 結果は入力中だけ左ナビ領域に一覧表示する
- 結果クリックで該当カテゴリを選択し、既存targetを表示・スクロール・フォーカスする
- 0件なら「一致する設定がありません」
- 空文字なら通常のカテゴリナビへ戻す
- ハイライトは不要。追加する場合も強いライム背景を使わない

検索対象には少なくとも以下を含めてください。

- 履歴タイトル
- アプリ管理
- Checkpoint / モデル / LoRAセット
- LoRA管理 / Civitai
- プロンプト部品
- Grok向け指示
- Discord / Webhook / 生成完了通知
- スマホ接続 / ReForge / Tailscale
- アップデート / GitHub Token

## 設定本文

- 選択カテゴリの内容だけを右へ表示する
- カテゴリ内はセクション見出し、短い説明、divider、既存フォーム部品を基本にする
- 設定項目ごとに巨大なカードを作らない
- カードの中へカードを作らない
- トップレベルの全セクションを閉じた `<details>` のまま並べない
- 詳細設定、長い補助ツール、危険操作だけは `<details>` を維持してよい
- 既存 `<details>` を `<section>` へ変える場合も、IDと子input/button IDを維持する
- LoRA一覧のように既存の内部アコーディオン挙動が機能上必要なら無理に撤去しない
- native input/select/checkboxと既存Option Pickerを維持する
- ラベルと説明が長い値で右カラムを押し広げないよう `min-width: 0`、ellipsis、`overflow-wrap` を使い分ける

## 保存状態

最初に各カテゴリ内の既存保存方式を確認し、変更しないでください。

- localStorage項目はlocalStorageのまま
- 自動保存項目は自動保存のまま
- 手動保存ボタンは手動保存のまま
- Discord Webhookはサーバー側保存のまま
- LoRAレジストリとCivitaiは既存APIのまま
- Checkpointセットは既存APIのまま
- Grokテンプレートは既存保存処理のまま
- GitHub Tokenと更新処理は既存仕様のまま

カテゴリ上部の保存状態は、既存処理が明確に判定できる場合だけ次を控えめに表示してください。

- 保存中
- 保存済み
- 保存に失敗
- 未保存

既存保存処理から判定できない項目へ、時間経過だけで「保存済み」と表示しないでください。すべての保存方式を統一する新しい保存マネージャーは作らないでください。手動保存ボタンを画面下部へfixed/sticky配置しないでください。

## 接続状態の簡易表示

左ナビ下部に、既存結果から判断可能なものだけを短く表示してください。

- ReForge: 接続済み / 未接続 / 確認中
- Discord: 設定済み / 未設定 / エラー
- 更新: 更新あり / 最新 / 未確認

Webhook URL、Token、内部エラー全文、ローカルファイルパスは表示しないでください。状態クリックで対応カテゴリを選択できるようにして構いませんが、状態確認の副作用として保存や更新適用を実行してはいけません。

## レスポンシブ

- デスクトップは220px + 本文の2カラム
- 860px前後以下では左ナビを上部のnativeカテゴリselectへ縮退してよい
- select変更でもデスクトップナビと同じ `activateSettingsCategory()` を使う
- 本文は `min-width: 0; width: 100%`
- 既存フォームの2列gridは狭幅で1列にする
- タップ領域は最低36〜40px程度を確保
- ページ全体の横スクロールを発生させない
- 既存の下部ナビとコンテンツを重ねない
- 新規transitionは150〜200ms以内とし、`prefers-reduced-motion` に対応する

## デザイン制約

- 既存の `:root` トークン（背景、panel、line、text、muted、accent）を使用
- 角丸は8px以下を基本にする
- 強い影、常時発光、ガラスモーフィズムを追加しない
- ライムは選択カテゴリ、成功、主要操作だけ
- デフォルトではカードを作らない
- 情報階層は見出し、説明、divider、入力欄の余白で表現する
- 本文13〜14px以上を目安にし、極小英字ラベルを追加しない

## 禁止事項

- API、Expressルート、DB、JSONデータ形式の変更
- 設定保存方式の統一・移行
- 既存IDの一括リネーム
- 同じ設定DOMのカテゴリ間複製
- ReForge、LoRA、Civitai、Discord、Grok、更新ロジックの再実装
- 新しいテーマ・外観設定の追加
- 新しい通知機能・接続監視・更新機能の追加
- Prompt、生成設定、LoRA選択stateの初期化
- 生成画面へCivitai追加を再表示すること
- fixed/absolute/負marginでの2カラム位置合わせ
- Task 06のギャラリー変更

## 必須テスト

既存テストを更新し、少なくとも次を自動検証してください。

- `.settingsLayout` が220px前後 + `minmax(0, 1fr)` の2カラム
- `.settingsContent` が `min-width: 0` かつ最大幅860px前後
- 主要カテゴリが存在し、空の「外観」は表示されない
- カテゴリ切替で選択カテゴリだけが表示される
- デスクトップナビと狭幅selectが同じ切替関数を使用する
- 検索が設定名・補助語に一致し、結果クリックで正しいカテゴリとtargetを開く
- 検索0件の空状態
- 各既存設定要素IDが1個だけ存在する
- `#promptPartsDetails` が1個だけで、生成画面のPrompt/設定stateを壊さない
- 生成画面の「LoRA管理」からLoRAカテゴリと `#settingsLoraDetails` へ到達する
- `#civitaiDetails` がLoRAカテゴリ内だけに存在する
- Discord、Checkpoint、LoRA、Civitai、Grok、更新の既存イベント参照が維持される
- 既存API/localStorage/手動保存呼び出しが残る
- 狭幅でページ全体に横スクロールがない

## 手動確認

- 1366×768 / 1920×1080 / ブラウザズーム125%
- 860px以下とモバイル幅
- 全カテゴリ選択
- 設定検索: Checkpoint、衣装、Discord、Webhook、スマホ、更新、存在しない語
- 手動保存設定の保存と再読込
- 自動保存設定の再読込復元
- Checkpointプロフィール / LoRAセット
- LoRA検索・編集・Civitai登録
- Discord設定保存・テスト通知（送信可能なローカル環境だけ）
- Grokテンプレート保存・コピー
- 更新確認（適用は明示的に必要な場合だけ）
- 生成画面からLoRA管理へ移動し、入力中Prompt、LoRA、生成設定が保持される
- ReForge/Discord/更新状態が既存結果と一致し、秘密値を表示しない

## 実行コマンド

```powershell
npm run check
node --test test/ui-shell.test.js test/ui.test.js test/layout-overflow.test.js
npm test
```

## 完了条件

1. デスクトップ設定画面が左ナビ + 右本文の2カラム
2. カテゴリから既存設定を探せる
3. 設定検索と0件空状態が利用できる
4. 現在のReForge、Discord、更新状態が既存情報の範囲で分かる
5. 右側の過大な空白が減り、本文幅が安定する
6. 全設定が閉じたアコーディオンとして直列表示されない
7. 設定DOMとIDが重複しない
8. 生成画面からLoRAカテゴリへ直接移動できる
9. Civitai追加はLoRAカテゴリ内だけに残る
10. Promptと現在の生成設定が画面移動で失われない
11. 既存の各保存方式、設定値、APIが維持される
12. モバイル幅でカテゴリを選べ、横スクロールがない
13. 新規依存、API、データ形式変更がない
14. 型/構文チェックと関連テスト、全テストが成功する

## 作業後の報告

- 変更ファイル一覧と各ファイルの役割
- 旧構造と新構造
- カテゴリと既存セクションの対応表
- 設定検索のインデックス、照合、遷移仕様
- LoRA管理への既存導線の更新方法
- 保存方式を維持した根拠
- 接続・通知・更新状態の取得元
- レスポンシブ確認結果
- 実行したコマンドと結果
- 未対応事項
