# 現在の実装対象：Task 28「gfx1031 Anima GEMM / Transformer Bottleneck Lab」

更新日: 2026-09-06
状態: **Phase 1–2 実施中**
担当: Luna
設計・レビュー: Codex
優先度: 高（隔離Lab計測のみ）

正本の実装指示:

- `docs/luna-tasks/28_GFX1031_ANIMA_GEMM_TRANSFORMER_LAB.md`

Task 27でDao FlashAttentionの速度改善が小さく不採用となったため、既存の隔離LabでAnima 2.9Bの実Transformer内部を測る。今回の範囲はPhase 1「実shape・dtype・call回数捕捉」とPhase 2「1 denoising step GPU時間内訳」に限定する。

通常Anima（CFG 4、LoRAなし、4 steps）とTurbo（CFG 1、Turbo LoRA 0.8、8 steps）を576×832、Euler + sgm_uniform、seed 195504693で分離計測する。baselineはPyTorch Math SDPAを維持し、FlashAttention、TunableOp、FP16化、`torch.compile`等の最適化を混入しない。

本番Forge Neo、port 7860、本番venv、LICコード・設定・生成処理には触れない。作業対象は`C:\AI\Labs\Forge-Neo-gfx1031-Attention-Lab`のみ。Phase 1–2完了後は高速化を実装せず、Linear/MLP、Attention、cast/layout/offload、mixed/inconclusiveのどれが支配的かを証拠付きで報告する。

---

# Task 27「RX 6700 XT / gfx1031 Attention Lab」（完了記録）

更新日: 2026-09-06
状態: **検証完了／性能不足で不採用**
担当: Luna
設計・レビュー: Codex
優先度: 高（ただし本番非変更の実験）

正本の実装指示:

- `docs/luna-tasks/27_GFX1031_ATTENTION_LAB.md`

目的は、既存Forge Neoを完全に保護したまま、`C:\AI\Labs\Forge-Neo-gfx1031-Attention-Lab`、port `7862`、独立venvで`gfx1031`向け高速Attentionの成立性を検証すること。

検証候補は`triton-windows 3.7.x + Dao-AILab FlashAttention Triton AMD backend`に限定する。公式TheRock wheelの単純更新、AOTriton/PyTorch本体のソースビルド、SageAttention、CUDA wheel、本番Forge変更は対象外。

単体Triton probe、Anima実形状`H=16 / D=128 / S=1024,1872,3952`のFlashAttention直接probeに合格した場合だけ、Lab cloneへ明示opt-in付き最小統合を行う。失敗時は中止ログを成果とし、危険な回避策へ拡大しない。

2026-09-06実測: Phase 1は合格。Lab venvで本番同日版`torch 2.12.0+rocm7.15.0a20260727`、HIP `7.15.26296`、`gfx1031`を確認した。Phase 2の`triton-windows 3.7.1.post27` vector-add probeは、MSVC C++ Build ToolsおよびWindows SDKがシステムに未導入のため、HIP utility compile前に同一エラーで2回停止した。GPU/ROCmは正常。次へ進むにはシステム全体へVisual Studio Build ToolsのC++ workloadとWindows SDKを追加する必要があるため、ユーザー承認待ちとする。

ユーザーは最小Build Tools導入を承認済み。非昇格bootstrapperはexit `1602`、Codexセッションからの`Start-Process -Verb RunAs`はUAC本体へ到達せず、インストール実体を作成しなかった。再起動要求は出ていない。次はユーザーが管理者PowerShellからLabの`install-vs-buildtools.ps1`を1回実行し、終了コードを確認する。exit `3010`または`1641`なら再起動せず停止する。

ユーザーの管理者実行はexit `0`で完了し、Build Tools `17.14.37614.0`、MSVC `14.44.35207`、Windows SDK/UCRT `10.0.26100.0`、指定3 componentの導入を確認した。`vswhere`は`isComplete=true`、`isLaunchable=true`、`isRebootRequired=false`。ただしWindowsの`PendingFileRenameOperations`にVisual Studio bootstrapper関連ファイルが残っているため、ユーザー指示に従いTriton再probe前に停止した。Windows再起動後、pending状態を再監査してPhase 2を再開する。

再起動後、Triton vector-addはgfx1031で正常実行し、CPU参照との最大誤差`0.0`、warm中央値`0.000329秒`でPhase 2合格。Dao FlashAttention `2.8.4`もBF16、H=16、D=128、Self/CrossのS/Q=1024/1872/3952でfiniteかつS=256 Math比較`rtol=0.05, atol=0.05`合格。ただしS=3952性能比較はSelfがMath比`1.110729x`、Crossが`0.433969x`で、採用基準`1.5x`に未達。CrossはMathの方が約2.3倍速いため、Lab Forge統合・起動・画像benchmarkは行わず不採用とする。

既存Forge Neo、既存venv、port 7860、Local Image Chat、共通モデル、LIC runtime設定を変更・停止・再起動してはならない。速度測定時は本番Forgeがidleであることを確認し、既存Jobをcancelしない。

---

# Task 25「LoRA選択・管理UIの可読性改善」（既存・監督レビュー待ち）

更新日: 2026-08-29
状態: **実装完了／監督レビュー待ち**
担当: Luna
設計・レビュー: Codex
優先度: 中

正本の実装指示:

- `docs/luna-tasks/25_LORA_UI_READABILITY.md`

並行して実装可能な小Task:

- Task 26「Civitai APIキーの`.env`永続化」
- 正本: `docs/luna-tasks/26_CIVITAI_ENV_TOKEN.md`
- Task 25のUI・LoRA folder treeとは変更対象がほぼ重ならない。Lunaが同時作業中なら同じファイルへ競合する変更を避け、別turnで実施する。

生成画面の「LoRAを追加」をfolder tree＋カードの選択ブラウザーへ、設定画面の「LoRA管理」をfolder tree＋一覧＋詳細の3ペインへ整理する。breadcrumbと安全な相対保存場所を表示し、どのfolderへ何が入っているか追跡できることを最優先とする。UIのみを対象とし、API、保存形式、LoRA registry、Runtime、生成処理は変更しない。

以下は過去Taskの記録として維持する。

---

## Task 22 Phase B（過去記録）：実環境の全CheckpointをForge Neo Profileへ登録

ユーザー承認済み方針: 現在Forge Neoが認識しているCheckpointをすべて`config.local.json`のProfile allowlistへ登録する。

実施順序:

1. `docs/REVIEW_FIXES.md`先頭のTask 22限定追加修正を完了する。
2. 自動テストと監督再レビューを受ける。
3. その後に本Phase Bの`config.local.json`変更を行う。
4. 設定編集だけでは3030／Neoを再起動しない。再起動と実機Smoke Testは別途ユーザーの明示GOを待つ。

### 事前に確認済みの実Neo catalog

2026-08-14にGET-onlyで確認した値:

- Checkpoint: 13件
- additional module: 2件
- 現在active: `sd\\oneObsessionAnima_v30.safetensors`
- 現在preset: `anima`
- 保存済みAnima modules:
  - `qwen_image_vae.safetensors`
  - `oneObsessionAnima_v30_txt.safetensors`
- 保存済みXL checkpoint: なし
- 保存済みXL modules: 空

Safetensors headerもread-only確認済み。次の3件は`model`だけを持つAnima系model-only checkpointである。

- `oneObsessionAnima_v30.safetensors`
- `waiANIMA_v10Base10.safetensors`
- `fnMomentAnimaTurbo_v20.safetensors`

その他10件は`conditioner`、`first_stage_model`、`model`を持つSDXL系full checkpointである。したがって、Anima 3件には現在Neoで保存済みの2 modulesを明示し、SDXL 10件は`preset: "xl"`かつ`additionalModules: []`とする。未知moduleやVAEを推測して追加しない。

### `config.local.json`変更内容

`runtimes.default`は`forge-neo-anima`を維持する。`runtimes.forgeNeoAnima`の`enabled`、`url`、`timeoutMs`も現在値を維持し、次のように変更する。

```json
{
  "enabled": true,
  "url": "http://127.0.0.1:7860",
  "activationMode": "managed-options",
  "profiles": [
    {
      "id": "anima-one-obsession-v30",
      "label": "Anima / oneObsession v3.0",
      "checkpoint": "sd\\oneObsessionAnima_v30.safetensors",
      "preset": "anima",
      "additionalModules": [
        "qwen_image_vae.safetensors",
        "oneObsessionAnima_v30_txt.safetensors"
      ]
    },
    {
      "id": "anima-wai-v10",
      "label": "Anima / WAI v1.0",
      "checkpoint": "sd\\waiANIMA_v10Base10.safetensors",
      "preset": "anima",
      "additionalModules": [
        "qwen_image_vae.safetensors",
        "oneObsessionAnima_v30_txt.safetensors"
      ]
    },
    {
      "id": "anima-fn-moment-turbo-v20",
      "label": "Anima / FN Moment Turbo v2.0",
      "checkpoint": "sd\\fnMomentAnimaTurbo_v20.safetensors",
      "preset": "anima",
      "additionalModules": [
        "qwen_image_vae.safetensors",
        "oneObsessionAnima_v30_txt.safetensors"
      ]
    },
    {
      "id": "xl-miaomiao-realskin-v14",
      "label": "SDXL / Miaomiao Realskin v1.4",
      "checkpoint": "sd\\miaomiaoRealskin_epsV14.safetensors",
      "preset": "xl",
      "additionalModules": []
    },
    {
      "id": "xl-noobai-vpred-10",
      "label": "NoobAI XL / V-Pred 1.0",
      "checkpoint": "sd\\noobaiXLNAIXL_vPred10Version.safetensors",
      "preset": "xl",
      "additionalModules": []
    },
    {
      "id": "xl-rin-flanime-v44",
      "label": "Illustrious / RIN Flanime v4.4",
      "checkpoint": "sd\\rinFlanimeIllustrious_v44.safetensors",
      "preset": "xl",
      "additionalModules": []
    },
    {
      "id": "xl-cyberrealistic-v100",
      "label": "SDXL / CyberRealistic v10.0",
      "checkpoint": "sd\\cyberrealisticXL_v100.safetensors",
      "preset": "xl",
      "additionalModules": []
    },
    {
      "id": "xl-wai-illustrious-v170",
      "label": "Illustrious / WAI v17.0",
      "checkpoint": "sd\\waiIllustriousSDXL_v170.safetensors",
      "preset": "xl",
      "additionalModules": []
    },
    {
      "id": "xl-creation-nai-2025-oct-v125",
      "label": "NAI XL / Creation 2025 Oct v1.25",
      "checkpoint": "sd\\creationNAIXL2025Oct_epsV1251001.safetensors",
      "preset": "xl",
      "additionalModules": []
    },
    {
      "id": "xl-nova-flat-v90",
      "label": "SDXL / Nova Flat v9.0",
      "checkpoint": "sd\\novaFlatXL_v90.safetensors",
      "preset": "xl",
      "additionalModules": []
    },
    {
      "id": "xl-illustrious-v01",
      "label": "Illustrious XL v0.1",
      "checkpoint": "sd\\illustriousXL_v01.safetensors",
      "preset": "xl",
      "additionalModules": []
    },
    {
      "id": "xl-obsession-illustrious-vpred-v20",
      "label": "Illustrious / Obsession V-Pred v2.0",
      "checkpoint": "sd\\obsessionIllustrious_vPredV20.safetensors",
      "preset": "xl",
      "additionalModules": []
    },
    {
      "id": "xl-chosen-mix-v41",
      "label": "SDXL / Chosen Mix v4.1",
      "checkpoint": "sd\\chosenMixXL_v41.safetensors",
      "preset": "xl",
      "additionalModules": []
    }
  ],
  "timeoutMs": 900000
}
```

旧単一fieldの`preset`、`checkpoint`、`additionalModules`は、明示`profiles`と二重管理しないため削除する。

### 設定変更時の保護条件

- 編集前に現在の`forgeNeoAnima`ブロックを作業報告へ記録する。
- JSON全体を機械的に並べ替えたり、無関係な設定を変更しない。
- Discord、storage、Favorite、LoRA registry、History、outputsへ触れない。
- Neoへoptions POSTを送らない。
- 3030／7860／Neoを停止・再起動しない。
- `config.local.json`をGitへ追加しない。
- Anima共通modulesで生成品質や互換性に問題が出た場合、別moduleを自動推測せずSmoke Test結果として停止・報告する。

### 設定編集後の静的確認

- JSON parse成功。
- `normalizeForgeNeoConfig()`で13 Profileを受理。
- Profile ID、Checkpointが全件一意。
- Anima 3件が`preset=anima`かつ2 modules。
- XL 10件が`preset=xl`かつmodules空。
- absolute path、hash suffix、URL、`..`をProfileへ保存していない。
- `runtimes.default`、Neo URL、timeoutが維持されている。
- Git上で`config.local.json`が追跡対象になっていない。

設定編集後は再起動せず、監督へ報告する。実機反映Phaseではactive jobs 0を確認後に3030だけを通常再起動し、GET catalogで13件を確認してから、Anima 1件・XL 1件の低負荷Smoke Testへ進む。全13件の実生成は一度に行わない。

## Task 22：Forge Neo Primary Runtime / Multi-Profile Migration

### 0. 前提と目的

Task 20「Forge Neo / Anima Runtime」とTask 21「Checkpoint再読み込み修正」は実装・監督レビュー完了、最終承認済みとする。両Taskを再設計せず、既存Forge Neo providerをMulti-Profile化する。

今回の目的は、普段のtxt2imgをForge Neoだけで運用できる状態へ進めることである。ReForge providerを削除せず、Legacy compatibilityとして維持する。

目標構造:

```text
Web UI / API v1 / MCP
          │
          ▼
Generation Service / JobManager
          │ runtimeId + checkpoint(public id)
          ▼
Forge Neo Provider（Primary）
          │
          ├─ Anima Profile
          │   ├─ checkpoint
          │   ├─ preset=anima
          │   └─ Qwen VAE + Anima Text Encoder
          │
          └─ SDXL / Illustrious Profile(s)
              ├─ checkpoint
              ├─ preset=xl
              └─ profileで明示したadditional modules

ReForge Provider（Legacy compatibility）
```

成功条件は、Checkpoint文字列だけを切り替えることではない。Checkpoint、`forge_preset`、`forge_additional_modules`を設定済みProfileとして一体で解決し、Jobが実際に実行されるqueue境界内で安全に適用すること。

### 1. 今回の範囲

Task 22で実装するもの:

1. Forge Neo設定の複数Profile対応。
2. 旧単一Anima設定の後方互換。
3. 設定済みProfileだけをCheckpoint catalogへ公開。
4. 公開Checkpoint IDからProfileを一意に解決。
5. Job実行時のcoordinated activation。
6. UIの既存Checkpoint selectorによるProfile選択。
7. Neoを設定上のPrimary Runtimeとして通常利用できることの確認。
8. History、API v1、MCPの既存`runtimeId + checkpoint`契約の維持。
9. Anima／SDXL間でadditional modulesを正しく入れ替えること。
10. Profile切替と2件のqueued jobが競合しないことのテスト。

Task 22で実装しないもの:

- Hires.fix
- img2img
- inpaint
- IP-Adapter
- Reference Asset IP-Adapter
- ControlNet／OpenPose
- Forge Neoの動画生成
- ReForge provider削除
- Runtime ID全面改名
- History migration
- MCP Tool追加
- 新しい設定default基盤
- 任意Checkpoint自動分類
- Neo catalog全件の無条件公開

上記のFeature parityはTask 23へ分離する。

### 2. Runtime IDと後方互換

Task 22では公開Runtime ID `forge-neo-anima`を変更しない。

理由:

- 既存Historyの`runtime.id`
- API v1／MCP request
- localStorageのRuntime選択
- Task 20／21 test
- 既存の派生生成

に既に保存・利用されているため。

表示labelは`Forge Neo`へ変更してよいが、`forge-neo`へのRuntime ID改名、alias追加、History書換えは今回行わない。将来のID整理は独立migration taskとする。

旧Historyで`runtime.id = forge-neo-anima`のものは、引き続き同じproviderへ解決できなければならない。

### 3. 設定モデル

既存の`runtimes.forgeNeoAnima`を維持し、optionalな`profiles`を追加する。

概念例:

```json
{
  "runtimes": {
    "default": "forge-neo-anima",
    "forgeNeoAnima": {
      "enabled": true,
      "url": "http://127.0.0.1:7860",
      "activationMode": "managed-options",
      "profiles": [
        {
          "id": "anima-default",
          "label": "Anima / oneObsession v3.0",
          "checkpoint": "sd\\oneObsessionAnima_v30.safetensors",
          "preset": "anima",
          "additionalModules": [
            "qwen_image_vae.safetensors",
            "oneObsessionAnima_v30_txt.safetensors"
          ]
        },
        {
          "id": "illustrious-obsession-v20",
          "label": "Illustrious / Obsession v20",
          "checkpoint": "sd\\obsessionIllustrious_vPredV20.safetensors",
          "preset": "xl",
          "additionalModules": []
        }
      ]
    }
  }
}
```

これは概念例である。実際のSDXL Profileのadditional modulesは、実Neoの保存済み`forge_checkpoint_xl`／`forge_additional_modules_xl`またはUIで正常に生成できる構成をread-onlyで確認してから確定する。推測したVAE／Text Encoderを自動設定しない。

Profile validation:

- `id`: 安全な公開identifier、Profile内で一意。
- `label`: UI表示用。pathや内部情報を含めない。
- `checkpoint`: 相対identifierだけ。drive path、UNC、absolute path、`..`を拒否。
- `preset`: Neoが実装する既知presetのallowlist。初期対応は`anima`と`xl`だけに限定してよい。
- `additionalModules`: basename相当の安全なidentifierだけ。最大件数を既存制約内に限定。
- 同一Checkpointを複数Profileへ曖昧登録しない。
- 空Profile、重複ID、重複Checkpoint、危険path、不明presetは起動時またはprovider構築時に安全に拒否。
- 公開DTOへpreset、module path、Neo URLを出さない。

### 4. 旧単一設定の互換

`profiles`が存在しない場合、既存の次のfieldから内部Profileを1件生成する。

```text
checkpoint
preset
additionalModules
```

これにより現在の`config.local.json`、Task 20のAnima設定、既存testを壊さない。

`profiles`が存在する場合はProfile一覧を正本とし、旧単一fieldと暗黙mergeしない。どちらを使ったかが曖昧にならないようにする。

### 5. Catalogと公開identifier

`listCheckpoints()`はNeoの`/sdapi/v1/sd-models`全件を公開してはならない。

処理:

```text
Neo catalog
→ 設定済みprofilesだけを照合
→ 見つかったprofile/checkpointだけをsafe public DTOへ変換
→ 設定順を維持して返す
```

要件:

- catalog titleのhash suffixとoptionsのhashなし表記をTask 20の既存比較で同一視する。
- absolute filenameは比較にだけ使用し、公開しない。
- basename衝突や曖昧一致は拒否する。
- Profileに登録したCheckpointがcatalogに無い場合、他Profileまで全滅させず、そのProfileを利用不能として安全に扱える構造を検討する。ただし生成要求されたProfileが無ければ明示的に失敗する。
- `activeCheckpoint`は`sd_model_checkpoint`だけでなく、可能なら現在のpresetとmodule setもProfileと一致する場合にのみactive扱いとする。
- Capabilitiesで返したCheckpoint公開identifierをgeneration requestへそのまま戻せる。
- UI/API/MCP利用者はProfile ID、preset、moduleを直接指定しない。既存`settings.checkpoint`だけを使用する。

### 6. Profile解決

`resolveV1Checkpoint(requested)`は設定済みProfileだけから一意に解決する。

許可候補:

- providerが返した公開Checkpoint ID
- providerが返した安全なtitle

不許可:

- 任意filename
- absolute path
- catalogにあるがProfile未登録のCheckpoint
- basenameだけで複数候補になる曖昧指定
- presetやmoduleをrequest bodyで上書きする指定

未登録Checkpointは`RUNTIME_CHECKPOINT_NOT_ALLOWED`等の既存安全な4xxへ変換し、Neo URL、path、raw catalog、stackを返さない。

### 7. Queue内coordinated activation

Checkpoint選択UIや`POST /api/checkpoints/select`の時点ではNeoのoptionsを変更しない。

選択時:

```text
公開Checkpointをvalidation
→ 次回生成設定として保持
```

Job実行時:

```text
requested checkpoint
→ Profile解決
→ 現在optionsをGET
→ checkpoint + preset + module setを比較
→ 完全一致ならPOST 0回
→ 不一致なら1回のPOST /sdapi/v1/options
→ 同じ3項目を一体で送信
→ GETで再検証
→ 一致後だけtxt2img
```

POST payload:

```json
{
  "sd_model_checkpoint": "<profile checkpoint identifier>",
  "forge_preset": "<profile preset>",
  "forge_additional_modules": ["<profile modules>"]
}
```

SDXL Profileの`additionalModules: []`は「変更しない」ではなく、Anima用modulesを解除する明示値として扱う。

次を禁止する。

- API request受信直後のoptions変更
- UIのCheckpoint選択直後のoptions変更
- queue外のモデル切替
- 複数回に分けたoptions POST
- Checkpointだけ先に切り替えること
- failure時のReForge silent fallback
- provider独自retry
- Profile不一致のままtxt2imgを開始すること

### 8. managed-optionsとpreloaded

`managed-options`:

- 完全一致ならoptions POST 0回。
- 不一致ならcoordinated POST 1回。
- POST後にcheckpoint、preset、module setをGETで再検証。
- 再検証失敗なら生成せずJob failed。

`preloaded`:

- options POSTは常に0回。
- requested Profileと現在のcheckpoint、preset、modulesが完全一致するかGET-onlyで検証。
- 不一致なら「Forge Neoで選択Profileが読み込まれていません」と安全に失敗。
- 別Profileへ自動切替しない。

### 9. Primary Runtimeの意味

リポジトリ共通`config.json`へ環境固有Neo URLやCheckpointを追加しない。

現在の`config.local.json`にある次の指定を尊重する。

```json
{
  "runtimes": {
    "default": "forge-neo-anima"
  }
}
```

明示defaultがNeoでありNeoがonlineなら、Web UI、API省略時、MCP省略時のPrimaryはNeoとする。

Neo停止中に同じrequestをReForgeへ自動送信しない。UIは生成を無効化し、手動でReForgeを選択した場合だけReForgeを使用する。

Neoが未設定の既存環境ではReForgeを従来どおり利用できなければならない。Task 22のために全ユーザーのdefaultを強制変更しない。

運用予約port:

```text
Local Image Chat = 3030
Forge Neo        = 7860
ReForge          = 7861
```

Runtime selectorはprocess起動、停止、port自動変更を行わない。

### 10. UI

新しい大規模Profile管理UIは作らない。既存Checkpoint selectorを再利用する。

要件:

- Runtime labelは`Forge Neo`へ簡潔化してよい。
- Checkpoint selectorには設定済みProfileに対応するCheckpointだけを表示。
- 選択しても直ちにNeoをロードせず、「次回生成で切替」相当の正確な状態表示にする。
- 実際にactiveなProfileと、次回生成に選択中のProfileを混同しない。
- 生成開始後、Job queue内でactivationされる。
- Prompt、Seed、LoRA選択、生成枚数をProfile切替で失わない。
- NeoではTask 20どおり未対応のHires、img2img、inpaint、IP-Adapterを無効化したままにする。
- ReForgeへ戻した場合の既存機能を壊さない。
- Checkpoint手動再読込はTask 21のPOST→GET契約を維持し、再読込後も設定済みProfileだけを表示する。

### 11. LoRA

Task 22ではLoRA registryの新形式を作らない。

- Neoの既存LoRA階層、displayName、Trigger Words、衣装情報を維持。
- 選択中Checkpointに対する既存base model互換判定・警告を再利用。
- 未確認の互換性を理由にLoRAを自動削除しない。
- 明確な不一致は既存UI警告を表示する。
- AnimaからSDXLへ切り替えた際、前Runtime／前Profileだけに存在するLoRAを生成payloadへ黙って残さない既存同期処理を確認する。
- NeoのLoRA root走査やCivitai registryをProfileごとに重複実装しない。

厳密なProfile別LoRA allowlistは、実環境のmodel family metadataを確認してから別タスクで判断する。

### 12. History／API／MCP

既存契約を維持する。

History:

- `runtime.id = forge-neo-anima`
- `runtime.provider = forge-neo`
- 実際に使用した公開Checkpoint
- 実Seed、settings、LoRA、画像

を既存形式で保存する。

内部Profile ID、preset、additional moduleの保存が再現性のため必要か調査する。保存する場合もsafe metadataとしてallowlistし、absolute pathを保存・公開しない。既存History schemaの破壊的migrationは行わない。

API v1／MCP:

- `runtimeId`は既存値を維持。
- `settings.checkpoint`へCapabilitiesの公開identifierを指定。
- preset、module、Profile内部設定を新しいrequest fieldとして公開しない。
- MCP Tool数を増やさない。
- MCP側にProfile解決、options切替、fallbackを実装しない。

### 13. Security

以下を公開または入力可能にしない。

- Windows absolute path
- UNC path
- Neo install path
- ReForge install path
- Checkpoint absolute filename
- module absolute filename
- Neo URL／port
- raw options response
- stack trace
- shell command
- 任意URL

DTOはallowlistで構築する。内部objectをcloneして危険fieldをdeleteする方式を避ける。

### 14. 変更対象候補と上限

原則8ファイル以内:

- `src/forge-neo.js`
- `src/generation-runtimes.js`（provider label／config接続が必要な場合）
- `public/app.js`（状態表示の最小修正が必要な場合）
- `test/task20.test.js`またはTask 22専用test 1ファイル
- `test/ui-shell.test.js`（UI変更時のみ）
- `docs/FORGE_NEO.md`
- `docs/CURRENT_TASK.md`（状態行のみ）
- 必要な既存設定schema／test 1ファイル

8ファイルを超える場合、実装前に理由と追加対象を報告して停止する。

変更しないもの:

- `src/reforge.js`（Task 22の都合で変更しない）
- `src/job-manager.js`
- History storage全面変更
- MCP Tool実装
- API v1 route構造
- Web UI全面変更
- package dependency
- `package-lock.json`
- ReForge本体
- Forge Neo本体
- 実History／outputs

既存dirty差分を削除、reset、整形、移動、巻き戻ししない。

### 15. 実装Phase

Phase A: read-only調査

- 実Neoのcatalog。
- 現在のAnima options。
- Neoに保存された`forge_checkpoint_xl`／`forge_additional_modules_xl`。
- SDXL／Illustrious Profileに必要なpreset／module。
- basename衝突。
- LoRA catalogとbase model metadata。

この段階でprocess停止、再起動、options POST、生成を行わない。不明なSDXL構成を推測で実装しない。

Phase B: config normalization／Profile catalog

- 複数Profile validation。
- 旧単一設定互換。
- 設定済みProfileだけの公開catalog。
- safe identifierとpath非公開。

Phase C: queue内activation

- Profile解決。
- no-op判定。
- coordinated options POST。
- 再GET検証。
- preloaded GET-only。
- queued jobsのProfile競合防止。

Phase D: UI／History回帰

- 既存Checkpoint selector。
- 次回生成で切替表示。
- Task 21 refresh維持。
- History復元。
- ReForge互換。

Phase E: mock／isolated test

- 実3030／7860／7861を使わずに完了する。

Phase F: 監督レビュー後の実機Smoke Test

- Lunaは監督承認前に実施しない。
- active jobs 0を確認。
- まず現在Animaのno-op生成。
- 次に許可された場合だけSDXL Profileへ1回切替・低負荷txt2img。
- 必要ならAnimaへ戻すが、無断でoptions POSTしない。
- ReForgeは停止・再起動しない。

### 16. 必須テスト

1. 旧単一Anima設定が内部Profile 1件として動く。
2. Anima＋SDXLの複数Profileを設定順で公開する。
3. Neo catalogの未登録Checkpointを公開しない。
4. absolute filename／URL／module pathをDTOへ出さない。
5. 重複Profile IDを拒否する。
6. 重複／曖昧Checkpointを拒否する。
7. 不明preset、危険path、不正moduleを拒否する。
8. hash付きtitleとhashなし設定値を同一解決する。
9. 完全一致Profileではoptions POST 0回。
10. Anima→SDXLでoptions POST 1回。
11. SDXL→Animaでoptions POST 1回。
12. POST bodyにcheckpoint、preset、modulesの3項目が同時に入る。
13. SDXLの空module配列がAnima modulesを明示解除する。
14. POST後の再GET不一致ではtxt2imgを呼ばない。
15. preloaded不一致ではPOSTせず安全に失敗する。
16. Profile未登録Checkpoint requestを4xxで拒否する。
17. Checkpoint選択APIはoptions POSTを行わない。
18. 2件のqueued jobが別Profileでも、各Job実行時に正しいProfileを適用する。
19. Job AのProfile切替がJob Bの待機中requestを変更しない。
20. Task 21の手動refresh後も設定済みProfileだけを返す。
21. 旧Historyの`forge-neo-anima`を復元できる。
22. ReForge txt2img／Hires／img2img／inpaint／IP-Adapterの既存testが通る。
23. MCPの既存runtimeId／checkpoint契約が通る。
24. `npm run check`、関連test、`npm test`、`git diff --check`が成功する。

### 17. 完了条件

1. Neoが設定上のPrimary Runtimeとして利用できる。
2. AnimaとSDXL／Illustriousの設定済みProfileを選択できる。
3. 任意Neo Checkpointは選択できない。
4. Profileごとにcheckpoint、preset、modulesが一体で適用される。
5. Anima modulesがSDXLへ残らない。
6. Profile切替がqueue内だけで行われる。
7. no-op時にoptions POSTしない。
8. 切替時のoptions POSTは1回だけ。
9. 再検証失敗時に生成しない。
10. UI選択時に即ロードしない。
11. Task 21の再読み込みが壊れていない。
12. History、API v1、MCPが既存契約のまま動く。
13. Neo停止時にReForgeへsilent fallbackしない。
14. ReForgeを手動選択すれば既存機能が動く。
15. 新規依存がない。
16. 全検証が成功する。

### 18. Lunaの作業後報告

必ず次を報告する。

- 変更ファイル一覧とTask 22由来／既存dirty差分の区別。
- 実Neoからread-onlyで確認したAnima／SDXL構成。
- Profile configの正規化方式。
- 旧単一設定の互換方式。
- 公開Checkpoint identifier。
- Profile解決と曖昧一致拒否。
- managed-options／preloadedの挙動。
- queue内activationのcall flow。
- Anima modules解除方法。
- UIの選択中／active表示。
- History／API／MCP互換。
- securityとpath非公開。
- 追加・更新したtest。
- `npm run check`、関連test、`npm test`、`git diff --check`の結果。
- 3030／7860／7861へ接続したか、processや実データを変更したか。
- Task 23へ残したFeature parity項目。

実装完了後は状態行を次へだけ変更する。

```text
状態: **実装完了／監督レビュー待ち**
```

commit、push、実機再起動、実options POST、実生成、最終承認を勝手に行わない。

---

# 完了済み：Task 21「Forge Neo Checkpoint再読み込み不具合修正」

## Task 21：Forge Neo Checkpoint再読み込み不具合修正

Task 20「Forge Neo / Anima Runtime対応」のRuntime追加・実機txt2img・History・画像配信は完了済みとする。Task 20を再設計せず、Checkpointの手動再読み込み経路だけを修正する。

詳細な原因、実装要件、変更対象候補、必須テスト、禁止事項は`docs/REVIEW_FIXES.md`先頭のTask 21指示を正本とする。

Task 21の要点:

1. 再読み込みボタンのclickイベントで`MouseEvent`をRuntime contextとして`loadCheckpoints()`へ渡さない。
2. 初期表示とRuntime切替時のCheckpoint取得はGET-onlyを維持する。
3. ユーザーによる手動再読み込み時だけ、選択中Runtimeに対応するrefresh処理を呼ぶ。
4. Forge Neoでは`POST /sdapi/v1/refresh-checkpoints`を1回実行してからcatalogを再取得する。
5. 再読み込みはcatalog再走査だけとし、Checkpoint、preset、additional modulesを切り替えない。
6. Task 21では現在のAnima固定allowlistを維持し、Neoが検出した任意モデルを公開しない。
7. Prompt、LoRA、Seed、生成設定、Job、History、画像、Runtime選択を変更しない。
8. Runtime切替競合時は古いresponseをUIへ適用しない。
9. ReForgeの既存再読み込み挙動を壊さない。
10. 新規依存を追加しない。

Task 21の完了条件:

- ReForge／Forge Neoのどちらでも再読み込みボタンが反応する。
- Neoの手動再読み込みで正式なrefresh endpointが1回だけ呼ばれる。
- 初期表示・Runtime切替ではrefresh POSTが発生しない。
- 再読み込み後もTask 20の固定allowlist契約が維持される。
- 生成中・Runtime切替中のdisabled制御が維持される。
- `npm run check`、関連test、`npm test`、`git diff --check`が成功する。

監督レビュー結果（2026-08-13）:

- click handlerは無引数wrapperへ修正され、`MouseEvent`をRuntime contextへ渡さない。
- 初期表示／Runtime切替の`loadCheckpoints()`はGET-onlyを維持している。
- 手動再読込だけがRuntime-awareな`POST /api/checkpoints/refresh`を使用する。
- Forge Neo providerは正式な`POST /sdapi/v1/refresh-checkpoints`を1回実行後、options／models／modulesを再取得する。
- refresh経路はoptions POST、Checkpoint切替、preset変更、additional modules変更、Job作成を行わない。
- Neo公開一覧は設定済みAnima固定allowlist 1件を維持する。
- Runtime tokenにより切替後の古いresponseを破棄する。
- ReForgeは既存のGET再取得挙動を維持する。
- `npm run check`成功、Task 20／Task 21＋UI関連59件成功、全455件成功、`git diff --check`成功。
- 実運用で確認されたReForge切替不能はコード不具合ではなく、設定上ReForge=`7861`に対してReForgeを`7860`で起動したポート不一致が原因。ReForgeを`7861`で起動して解消済み。

Task 21は最終承認とし、追加コード修正を要求しない。

実装完了後は状態行を`実装完了／監督レビュー待ち`へ変更し、実機3030／7860／Neoの再起動・Checkpoint切替・生成は監督承認前に行わないこと。

## 次タスク予約：Task 22「Forge Neo Multi-Profile Runtime」

Task 21の監督承認後に着手する。Task 21へ便乗実装しない。

目的は、Forge Neo本体が対応する複数アーキテクチャのうち、Local Image Chatで明示的に設定したモデルを、Checkpoint単体ではなくRuntime Profileとして安全に選択できるようにすること。

想定するProfile単位:

```text
Checkpoint
+ forge_preset
+ forge_additional_modules
+ 公開identifier
+ 対応機能・推奨default
```

初期範囲は次の2系統を第一候補とする。

- Anima: `anima` preset、Anima Checkpoint、Qwen VAE、Anima Text Encoder。
- SDXL／Illustrious: `xl` preset、明示的に許可したSDXL／Illustrious Checkpoint、モデルに適合するadditional modules。

Task 22の設計原則:

1. Neoが返す全Checkpointを無条件に選択可能にしない。
2. 任意filesystem pathをAPI、UI、MCPから受け取らない。
3. 設定済みProfileの公開identifierだけをCapabilitiesとCheckpoint一覧へ公開する。
4. Checkpoint変更時は、対応するpresetとadditional modulesを同じqueue実行境界で一体として切り替える。
5. Anima用Qwen VAE／Text EncoderをSDXL／Illustriousへ残さない。
6. Profile切替はJobが実際に実行される時点で行い、待機Job同士の設定競合を防ぐ。
7. managed-optionsでは完全一致ならoptions POSTを行わず、不一致時だけ協調payloadを1回送って再検証する。
8. preloadedではGET-only検証を維持し、設定不一致時に勝手に切り替えない。
9. Neo失敗時にReForgeへsilent fallbackしない。
10. 旧HistoryのRuntime情報、Task 20のAnima設定、既存ReForge生成との後方互換性を維持する。
11. LoRAは選択中Profile／アーキテクチャで実際に利用可能なものだけを扱える設計を別途確認する。
12. UIではProfileまたは公開Checkpointを選択できるが、presetや内部moduleを重複編集させない。

Task 22着手前に、実Neo環境のCheckpoint分類、各モデルに必要なpreset・VAE・Text Encoder、LoRA互換範囲をread-onlyで確認し、Luna向けの正式な実装指示へ落とすこと。上記は予約仕様であり、現時点ではTask 22のコード変更を許可しない。

---

# 完了済み基盤：Task 20「Forge Neo / Anima Runtime対応」

## 0. 正本と前提

この文書をTask 20の実装・検証の正本とする。

Task 18「Chat Attachment Reference Assets」は修正確認済み・最終承認とする。Task 11〜18の既存API、MCP、Reference Asset、IP-Adapter、History、画像配信を再設計しないこと。

`docs/luna-tasks/19_OBSIDIAN_GENERATION_KNOWLEDGE.md`が既に存在するため、本件はTask 19ではなくTask 20とする。

既存worktreeには未コミット差分がある。無関係な変更を削除、reset、整形、移動、巻き戻ししないこと。

## 1. 目的

Local Image Chatへ、既存ReForge Runtimeを維持したまま、Forge Neo上のAnima Runtimeを正式な生成先として追加する。

目標構造:

```text
Web UI / API v1 / MCP
          │
          ▼
Generation Service
          │ runtimeId
          ▼
Generation Runtime Registry
     ┌────┴─────────────┐
     ▼                  ▼
ReForge Provider   Forge Neo Provider
     │                  │
     └──── JobManager ──┘
              │
        History / Images
```

Forge Neo対応を別アプリ、別Queue、別History、MCP専用生成経路として作らないこと。Web UI、旧API、API v1、MCPは同じGeneration ServiceとJobManagerへ合流させる。

## 2. 現状確認済み事項

### Local Image Chat

- `src/services/generation-service.js`のGeneration Runtimeは現在`src/reforge.js`を直接利用している。
- JobManagerは単一の直列Queueであり、モデル切替をjob実行時へ閉じ込められる。
- `/api/jobs`、`/api/generate`、`/api/v1/generations`は同じGeneration Runtimeへ合流済み。
- Checkpoint切替はAPI v1ではQueue内部で行われる。
- History、画像保存、サムネイル、Favorite、Discord、IP-Adapter、Reference Assetは既存共通経路にある。
- MCPはBackend API v1を呼ぶ薄いHTTP clientである。

### Forge Neo

対象環境:

```text
Forge Neo repository:
C:\AI\StabilityMatrix-win-x64\Data\Packages\Stable Diffusion WebUI Forge - Neo

既存ReForge repository:
C:\AI\StabilityMatrix-win-x64\Data\Packages\reforge

Anima checkpoint:
oneObsessionAnima_v30.safetensors

Anima text encoder:
oneObsessionAnima_v30_txt.safetensors

Anima VAE:
qwen_image_vae.safetensors
```

調査で確認したNeoの正式API:

- `GET/POST /sdapi/v1/options`
- `GET /sdapi/v1/sd-models`
- `GET /sdapi/v1/sd-modules`
- `GET /sdapi/v1/samplers`
- `GET /sdapi/v1/schedulers`
- `GET /sdapi/v1/loras`
- `POST /sdapi/v1/txt2img`
- `GET /sdapi/v1/progress`
- `POST /sdapi/v1/interrupt`

Neoの`set_config()`は、1回の`POST /sdapi/v1/options`に含まれる`sd_model_checkpoint`と`forge_additional_modules`を処理した後、一度だけloading parametersを更新する。この正式APIを利用する。

`forge_preset = anima`だけを変更してもGUI側のpreset連動処理は自動実行されない。Checkpoint、Anima text encoder、Qwen VAEを明示的かつ同一options requestで設定する必要がある。

`GET /sdapi/v1/cmd-flags`は環境により500を返し得る。health、readiness、Anima構成確認の必須条件にしてはならない。

## 3. 絶対禁止事項

- Forge Neo本体のpatch、Python import、内部module直接呼出し
- Gradio画面、DOM、Playwright等によるGUI自動操作
- Neo専用Queue、History、画像保存、Prompt Service、MCP Tool群の新設
- Checkpointだけを切り替え、text encoder／VAEを置き去りにすること
- request受信時点でのモデル切替
- generationごとの任意URL、任意port、filesystem pathの受付
- `sd-modules`のabsolute filenameやNeo install pathを公開DTOへ出すこと
- `/cmd-flags`失敗をruntime unavailableとして扱うこと
- Neo失敗時に黙ってReForgeへfallbackすること
- unsupported機能を黙って無視すること
- ReForge、History、JobManager、Reference Assetの全面リファクタリング
- 新規依存追加、package-lockの無関係な更新
- 実装中の3030／7860／Neo process停止・再起動
- 実装中の実outputs、History、Favorite、Discord、storage settings変更

## 4. Runtime設定

既存`config.reforge`を後方互換の正本として残す。Runtime設定が存在しない既存環境は、従来どおりReForgeだけを使用しなければならない。

新設定は既存config loaderに自然に追加する。概念例:

```json
{
  "runtimes": {
    "default": "reforge",
    "forgeNeoAnima": {
      "enabled": true,
      "id": "forge-neo-anima",
      "label": "Forge Neo / Anima",
      "url": "http://127.0.0.1:7861",
      "activationMode": "managed-options",
      "preset": "anima",
      "checkpoint": "sd\\oneObsessionAnima_v30.safetensors",
      "additionalModules": [
        "qwen_image_vae.safetensors",
        "oneObsessionAnima_v30_txt.safetensors"
      ],
      "supportedModes": ["txt2img"],
      "timeoutMs": 900000
    }
  }
}
```

要件:

1. 上記は概念形であり、既存config正規化規則へ合わせる。
2. `config.reforge`は暗黙の`runtimeId: "reforge"`として登録する。
3. 接続URLはserver configだけから取得し、API/MCP requestから受け取らない。
4. `checkpoint`は公開identifier、`additionalModules`はbasename/model nameで保存する。
5. absolute module pathをsource、API DTO、Historyへ保存しない。
6. `activationMode`は`managed-options`と`preloaded`だけを許可する。
7. 未設定時のdefault Runtimeは`reforge`とし、旧挙動を変えない。
8. `config.json`は利用者ローカルデータのため、実値を勝手にcommitしない。設定例はdocumentationへ記載する。

## 5. Runtime Provider境界

`generation-service.js`を第二の`server.js`にしない。小さなRuntime registry/provider境界を追加する。

配置候補:

```text
src/
├─ generation-runtimes.js
├─ forge-neo.js
├─ reforge.js
└─ services/generation-service.js
```

既存構成により`src/runtimes/`が明らかに自然なら使用可。ただし既存ファイル移動はしない。

Providerの最小責務:

- runtimeのsafe descriptor（id、label、provider、supportedModes、features）
- health/readiness
- Checkpoint、Sampler、Scheduler、LoRAの公開catalog取得
- requestのCheckpoint解決
- Queue内部でのruntime準備
- 既存生成処理との接続
- provider固有errorの安全な正規化

Providerへ残さない責務:

- Queue実装
- Job／AbortController管理
- History保存
- 画像保存／thumbnail生成
- Discord通知
- Prompt結合
- MCP state

ReForge Providerは既存`src/reforge.js`を薄く包む。ReForgeの挙動変更を最小限にする。

## 6. Forge Neo / Anima activation

### 6.1 managed-options

jobがQueueで実行される直前にだけ、次の処理を行う。

1. `GET /sdapi/v1/options`
2. `GET /sdapi/v1/sd-models`
3. `GET /sdapi/v1/sd-modules`
4. configured checkpointを公開catalogから解決
5. configured additional module basenamesをcatalogから解決
6. 現在のcheckpoint、preset、module集合が完全一致する場合はPOSTしない
7. 不一致なら、1回の`POST /sdapi/v1/options`へ次を同時に送る

```json
{
  "forge_preset": "anima",
  "forge_additional_modules": [
    "qwen_image_vae.safetensors",
    "oneObsessionAnima_v30_txt.safetensors"
  ],
  "sd_model_checkpoint": "sd\\oneObsessionAnima_v30.safetensors"
}
```

8. POST後に`GET /sdapi/v1/options`でcheckpointとmodule basename集合を再確認
9. 完全一致しなければ生成を開始せず明示的に失敗

Checkpointだけを先にPOSTする、moduleを別POSTに分ける、GUI preset buttonを模倣する実装は禁止する。

### 6.2 preloaded

`activationMode: "preloaded"`では`POST /options`を一切行わない。現在のcheckpointとrequired modulesが完全一致する場合のみ生成し、不一致なら明示的に失敗する。

managedからpreloaded、preloadedからmanagedへ暗黙fallbackしない。

### 6.3 cmd-flags

Neo Providerのhealth/readinessは`/options`、`/sd-models`、必要なcatalogで判定する。`/cmd-flags`を呼ばなくても生成可能でなければならない。

既存ReForgeのLoRA directory補助取得が`cmd-flags`をbest effortで使う場合、その既存挙動は維持してよい。

## 7. 対応機能

Task 20初期版のForge Neo Runtimeは`txt2img`のみ正式対応とする。

最低限:

- txt2img
- structured／Raw Prompt
- Negative Prompt
- Width／Height
- Steps／CFG／Seed
- Sampler／Scheduler
- candidateCount 1以上の既存逐次生成
- Anima用LoRA構文
- Job status／cancel
- History保存
- original／thumbnail配信
- API v1／MCP／Web UIからのruntime選択

初期版で安全性を証明できない次の機能はNeo Runtimeで明示的にunsupportedとする。

- img2img
- inpaint
- Hires.fix
- IP-Adapter
- Reference Assetを用いたIP-Adapter生成

UIではunsupported操作をdisabledにし理由を表示する。APIは安全な4xx errorを返す。ReForgeへ黙って転送したり、指定を捨てて通常txt2imgを実行しない。

## 8. LoRA

- NeoのLoRA一覧は`GET /sdapi/v1/loras`から取得する。
- 既存のLoRA prompt構文とvalidation経路を再利用する。
- Neo用のLoRA registry、Trigger管理、History形式を新設しない。
- absolute LoRA pathを公開しない。
- Anima LoRAの実機確認は、LoRAなしの基本生成が成功した後に最大1件だけ行う。
- LoRA構文・weightをProvider側で勝手に書き換えない。

## 9. API契約

### 9.1 runtimeId

次のrequestへoptionalな`runtimeId`を追加する。

- legacy `/api/jobs`
- legacy `/api/generate`
- `POST /api/v1/generations`
- `POST /api/v1/history/:id/regenerations`

省略時はconfigured default Runtime。既存環境ではReForgeとなる。

`runtimeId`はallowlisted IDだけを許可し、URLやpathとして解釈しない。

### 9.2 catalog/capabilities

最小変更でruntime別情報を取得できる安全な公開経路を用意する。

推奨:

- safe runtime一覧を`/api/config`または専用`GET /api/runtimes`で公開
- `/api/checkpoints?runtimeId=...`
- `/api/samplers?runtimeId=...`
- `/api/loras?runtimeId=...`
- `/api/v1/capabilities?runtimeId=...`

query省略時は従来のdefault Runtimeを返し、旧clientを壊さない。

公開Runtime DTO候補:

```json
{
  "id": "forge-neo-anima",
  "label": "Forge Neo / Anima",
  "provider": "forge-neo",
  "available": true,
  "supportedModes": ["txt2img"],
  "features": {
    "hires": false,
    "ipAdapter": false,
    "img2img": false,
    "inpaint": false
  }
}
```

URL、port、absolute path、module filename path、stack traceを返さない。

### 9.3 health

既存`/api/health`の`reforge` fieldを削除・改名しない。安全なRuntime status一覧をadditiveに追加してよい。

## 10. Checkpoint契約

- Capabilitiesで返した公開Checkpoint identifierをGeneration requestへそのまま指定可能にする。
- Forge Neo Anima初期版はconfigured fixed checkpointだけを許可する。省略時も同じconfigured checkpointを使う。
- requestで別Checkpointを指定された場合は`RUNTIME_CHECKPOINT_NOT_ALLOWED`等の4xxで拒否する。
- 任意filename/path探索を行わない。
- Checkpoint切替は必ずQueue内部のRuntime prepareで行う。
- ReForgeの既存Checkpoint選択UI／API挙動は維持する。

## 11. Web UI

全面改修は禁止。生成設定内へ最小のRuntime selectorを追加する。

要件:

1. ReForge／Forge Neo Animaを選択可能。
2. 既定値はserverのconfigured default。
3. Runtime変更時にCheckpoint、Sampler、Scheduler、LoRA、feature availabilityを対象Runtimeから再取得。
4. NeoのCheckpointは固定表示または唯一の選択肢とし、任意切替UIにしない。
5. 選択を現在の生成フォーム自動保存へ追加。
6. 履歴復元、再生成、派生生成で元のruntimeIdを復元。
7. unsupportedなimg2img、inpaint、Hires、IP-Adapterをdisabledにし理由を示す。
8. 左右3カラム、配色、既存v3.0デザインは変更しない。
9. mobile全面改修を行わない。
10. Runtime selector追加に伴う横幅超過を起こさない。

Runtime切替だけでモデルを即時ロードしない。実際のprepareはJob実行時とする。

## 12. MCP

MCPは薄いHTTP wrapperのまま維持する。Forge Neo専用Toolを追加しない。

既存Toolのうち最低限、次へoptionalな`runtimeId`を追加する。

- `get_capabilities`
- `generate_image`
- `regenerate_image`

`get_history_item`はHistory DTOのsafe runtime metadataを読めるようにする。

MCP側でRuntime catalogをcacheしない。Neoへ直接fetchしない。model/module切替をしない。Backend error codeと意味を維持する。

## 13. History

既存History schemaへadditiveかつsafeなruntime metadataを保存する。

推奨:

```json
{
  "runtime": {
    "id": "forge-neo-anima",
    "provider": "forge-neo"
  }
}
```

要件:

- URL、port、install path、module pathを保存しない。
- 旧Historyはmigrationなしで読める。
- runtime情報のない旧HistoryはReForge legacyとして扱える。
- History detail DTOへsafe runtime fieldをallowlistで追加。
- History listへ追加する必要がなければ追加しない。
- 派生再生成は元runtimeIdを既定で継承する。ただし明示runtimeIdがある場合は契約に従う。
- Neo generation完了時も既存History／image保存経路をそのまま利用する。

## 14. Error契約

内部errorを既存APIの安全なerror DTOへ変換する。候補:

- `RUNTIME_NOT_FOUND`
- `RUNTIME_UNAVAILABLE`
- `RUNTIME_TIMEOUT`
- `RUNTIME_MODE_NOT_SUPPORTED`
- `RUNTIME_CHECKPOINT_NOT_ALLOWED`
- `NEO_ANIMA_MODULE_NOT_FOUND`
- `NEO_ANIMA_MODULES_NOT_LOADED`
- `NEO_ANIMA_ACTIVATION_FAILED`

次を守ること:

- stack、absolute path、Neo raw response全文をclientへ返さない。
- network reset／timeout／process終了をJob failedへ正しく反映。
- 完了前にHistoryを保存しない。
- Neo failure時にReForgeへfallbackしない。
- cancelは既存Job Manager／interrupt経路へ接続する。

## 15. Runtime crash／再接続

- Providerで独自retry loopや自動process restartを追加しない。
- job実行中にNeo接続が切れた場合は、そのJobだけをfailedにする。
- 後続Jobは次回prepare時にhealthを再評価する。
- 実Neo processをkillするテストは禁止。mock serverで切断・timeoutを再現する。
- ROCm、PyTorch、GPU memoryの自動修復をLocal Image Chatへ追加しない。

## 16. 変更予定ファイルと上限

Provider境界、API、UI、MCP、History、テスト、documentationを跨ぐため、変更は18〜22ファイル程度を見込む。Task 20ではこれを事前承認範囲とする。

候補:

- `src/forge-neo.js`（新規）
- `src/generation-runtimes.js`または小さな`src/runtimes/*`（新規）
- `src/reforge.js`
- `src/services/generation-service.js`
- `src/server.js`
- `src/history.js`
- `src/api/v1/capabilities.js`
- `src/api/v1/generations.js`
- `src/api/v1/history.js`
- `public/index.html`
- `public/app.js`
- `public/style.css`
- `src/mcp/schemas.js`
- `src/mcp/tools.js`
- `src/mcp/local-image-chat-client.js`
- 関連test
- `docs/FORGE_NEO.md`または既存documentation
- `docs/CURRENT_TASK.md`（状態行のみ）
- `package.json`（check対象へ新規JSを追加する場合のみ）

22ファイルを超える見込みになった場合、実装を継続する前に理由と追加対象を報告すること。

`package-lock.json`は変更しない。新規dependencyは追加しない。

## 17. 実装順序

### Phase 1: ReForge回帰を保ったProvider境界

1. 現在のGeneration Runtime call flowをテストで固定。
2. Runtime registry/provider境界を追加。
3. ReForgeをProvider経由へ接続。
4. 旧API、API v1、txt2img、img2img、inpaint、Hires、IP-Adapter、History、cancelのmock回帰を実行。

Phase 1で既存ReForge挙動が壊れた場合、Neo実装へ進まない。

### Phase 2: Forge Neo Provider

1. safe config normalization。
2. catalogとhealth。
3. managed-options／preloaded prepare。
4. txt2img生成。
5. failure／timeout／cancel mapping。
6. History runtime metadata。

### Phase 3: API／UI／MCP

1. runtime list/capabilities。
2. optional runtimeId mapping。
3. UI selectorとfeature guard。
4. MCP schema／HTTP mapping。
5. documentation。

Phaseごとに関連テストを通すこと。

## 18. 必須自動テスト

### Forge Neo Provider

- `/cmd-flags`が500でもhealth/readinessと生成準備が成立。
- current checkpoint／modulesが正しければ`POST /options`を行わない。
- mismatch時はcheckpoint、preset、全required modulesを1回の`POST /options`へ送る。
- POST後の再検証成功。
- missing text encoder／VAEを明示errorにし、txt2imgを呼ばずHistoryを保存しない。
- preloaded modeは`POST /options`を一度も呼ばない。
- configured checkpoint以外を拒否。
- absolute `sd-modules.filename`を公開しない。
- disconnect、timeout、malformed responseを安全に失敗。
- generation中断を既存cancelへ接続。

### ReForge回帰

- configにruntimesがない旧環境。
- default ReForge generation。
- Checkpoint変更。
- txt2img／img2img／inpaint。
- Hires.fix。
- IP-Adapter／Reference Asset。
- History／Favorite／Discordの既存経路。
- Job status／cancel。

### API／History

- runtimeId省略時のdefault。
- unknown／disabled runtime。
- runtime別capabilities。
- unsupported mode／feature。
- Checkpoint allowlist。
- safe runtime DTO。
- History runtime保存、detail公開、旧History互換。
- absolute path、URL、module path、stack非漏洩。
- 派生再生成のruntime継承。

### UI

- Runtime selectorが1つだけ存在。
- Runtime変更時のcatalog再取得。
- 選択値のform保存／復元。
- History復元。
- Neoでunsupported操作がdisabled。
- ReForge時の既存操作が維持。
- 横スクロールを増やさない。

### MCP

- optional runtimeId schema。
- capabilities／generate／regenerateのHTTP mapping。
- runtimeId省略の後方互換。
- Backend errorの意味保持。
- Neo直接通信やHost固有分岐がないこと。

## 19. 検証コマンド

最低限:

```powershell
npm run check
node --test <Task20関連テスト>
npm test
git diff --check
```

テストはtemporary workspace、temporary port、mock ReForge、mock Forge Neo、temporary History／outputsを使用する。

実3030、実7860、実Neo、実History、実outputsを自動テストから利用しない。

## 20. 実機Smoke Testは監督承認後

実装完了時点では実機Smoke Testを開始しない。監督レビューとユーザーの明示許可後に別工程として行う。

開始前記録:

- Local Image Chat PID／port
- ReForge PID／port
- Forge Neo PID／port
- active jobs
- active Runtime／Checkpoint／additional modules
- output保存先／空き容量
- History件数またはfingerprint
- Favorite件数
- Discord generationAutoSend

注意:

- 3030の再起動が必要ならactive jobs 0を確認し、明示許可を得る。
- ReForge／Neoを勝手に停止・再起動しない。
- Neoが未起動なら停止して報告する。
- 最初にread-only health／catalog／capabilitiesを確認する。
- `/cmd-flags` 500があっても他の必須APIが正常なら失敗扱いしない。

最小生成:

```text
runtime: forge-neo-anima
mode: txt2img
resolution: 768 × 1024
steps: 16
CFG: 1
sampler: Euler
candidateCount: 1
Hires: off
IP-Adapter: off
LoRA: none
```

環境の実Sampler名が`Euler`と異なる場合はCapabilitiesの公開identifierから安全なEuler系を選ぶ。

確認:

- queued／running／done
- original／thumbnail 200
- History runtime metadata
- effective Prompt／settings／seed
- ReForge側の既存動作に副作用なし
- checkpointとAnima modulesが意図どおり
- absolute path漏洩なし

基本生成成功後、必要なら既知のAnima LoRAを1件だけ追加確認してよい。実生成は合計最大2件。実process crash testは禁止。

## 21. 完了条件

1. 既存ReForgeがdefaultのまま後方互換で動く。
2. Forge Neo Animaが独立Runtimeとして選択できる。
3. Checkpoint＋text encoder＋VAEが一体で検証・activationされる。
4. model transitionがJob Queue内部で直列化される。
5. 正しい状態では不要なmodel reloadをしない。
6. preloaded modeが設定変更なしで利用できる。
7. `/cmd-flags` 500が生成可否へ影響しない。
8. Neo txt2imgが既存Job／History／画像保存経路を利用する。
9. unsupported mode／featureを明示的に拒否する。
10. UIからRuntimeを選択でき、既存3カラムを壊さない。
11. API v1とMCPから同じruntimeIdを利用できる。
12. MCPはBackend APIの薄いwrapperのままである。
13. HistoryからRuntimeを識別・復元できる。
14. absolute path、module path、Neo URL、stackを公開しない。
15. Neo失敗時にReForgeへsilent fallbackしない。
16. img2img、inpaint、Hires、IP-AdapterのReForge既存機能を壊さない。
17. 新規依存がない。
18. `npm run check`と`npm test`が通る。

## 22. Lunaの作業後報告

以下を必ず報告する。

### 変更ファイル

追加・変更・削除ファイルと、Task 20由来か既存dirty差分かを区別する。

### Runtime Architecture

変更前後のcall flow、Provider contract、ReForge／Forge Neoの責務分離。

### Forge Neo Activation

- managed-options／preloadedの実装
- coordinated options payload
- no-op判定
- post-activation再検証
- cmd-flags非依存

### API／UI／MCP

- runtimeId契約
- catalog／capabilities
- UI selectorとunsupported feature表示
- MCP mapping

### History／Security

- 保存するruntime metadata
- 旧History互換
- path／URL漏洩対策

### Tests

- 追加・更新test
- Phaseごとの結果
- `npm run check`
- 関連test
- `npm test`
- `git diff --check`

### 実環境

- 3030／7860／Neoへ接続したか
- processを停止・再起動したか
- 実History／outputsを変更したか

### 残課題

- Neoのimg2img／inpaint
- NeoのHires／IP-Adapter
- 実機Smoke Test
- 環境依存の起動条件

状態行は実装完了後、次へだけ変更する。

```text
状態: **実装完了／監督レビュー待ち**
```

監督承認、commit、push、実機再起動を勝手に行わない。

---

# 現在の実装対象：Task 25「LoRA選択・管理UIの可読性改善」

更新日: 2026-08-29
状態: **設計完了／Luna実装待ち**
担当: Luna
設計・レビュー: Codex

正本の実装指示:

- `docs/luna-tasks/25_LORA_UI_READABILITY.md`

生成画面の「LoRAを追加」を読みやすい選択ブラウザーへ、設定画面の「LoRA管理」を一覧と詳細が明確なmaster-detailへ整理する。UIのみを対象とし、API、保存形式、LoRA registry、Runtime、生成処理は変更しない。

## 23. 最重要原則

成功条件は「Neoへtxt2imgを投げられた」だけではない。

```text
既存Web UI
旧API
API v1
MCP
      │
      ▼
同じGeneration Service／JobManager／History
      │
      ├─ ReForge
      └─ Forge Neo / Anima
```

この構造を、既存ReForgeの挙動を壊さず、小さなProvider境界で成立させることがTask 20の成果である。

---

## 24. ユーザー承認済み並行ドキュメントタスク：Task 19

Task 20は監督再レビュー待ちのまま維持する。コードへ触れない独立作業として、次のTask 19は実施可能とする。

```text
docs/luna-tasks/19_OBSIDIAN_GENERATION_KNOWLEDGE.md
```

Task 19では、`40_Prompts/90_取り込み待ち`へCheckpoint profile、LoRA registry、Prompt template、Trigger Words、比較実験、既存Prompt索引、画風候補を、出典付き・sanitized・未検証のRawカタログとして大量投入する。その後、モデルガイド、LoRAガイド、画風プリセットへ必要なものだけ整理する。

Task 20のコード、テスト、正式docsをTask 19の都合で変更しない。Task 20の再レビューで追加修正が発生した場合は、コード修正を優先し、Obsidian作業と混ぜないこと。

---

# Task 24「Gallery Content Rating / NSFW分離」

状態: **実装完了／監督レビュー待ち**
担当: Luna
設計・レビュー: Codex
優先度: 中

> ユーザーの2026-08-22の明示指示により、Task 24に限ってCodexが直接実装した。既存Task 22差分は巻き戻し・再設計せず、Task 24対象箇所への限定追記として実装した。

## 1. 目的

生成時に画像を明示的に「一般」または「NSFW」へ分類し、ギャラリーで分類ごとに正確に絞り込めるようにする。

この分類は、生成内容を検閲・解析・隠蔽する機能ではない。ユーザーが自分の生成履歴を整理するための明示的なメタデータである。

```text
生成フォーム
  └─ 一般 / NSFWを明示選択
          ↓
Generation Service / History
  └─ generation単位のcontentRatingとして保存
          ↓
Gallery
  └─ すべて / 一般 / NSFW / 未分類で絞り込み
```

## 2. 確定するデータ契約

正本となるフィールド名は、generation直下の`contentRating`とする。

新規生成で受け付ける値:

```text
general
nsfw
```

履歴の読み取り時に扱う値:

```text
general
nsfw
unrated
```

- 新規Web生成の既定値は`general`。
- 新規API v1／MCP生成で省略された場合も`general`。
- 古い履歴にフィールドがない場合は`unrated`として読み取る。
- 不明値・壊れた値も安全に`unrated`へフォールバックする。
- 古い履歴を起動時に一括書換えしない。
- `unrated`を暗黙に`general`へ変更しない。
- 1回のgenerationに複数画像がある場合、全画像が同じ分類を共有する。

`kind`、Favorite、比較実験、タグとは別の独立フィールドにする。既存の`kind`へ`nsfw`を追加してはならない。

## 3. 禁止する自動判定

次の処理は実装しない。

- Prompt内の単語によるNSFW自動判定
- 画像解析、AI分類、タグ推測
- Checkpoint／LoRA名による推測
- NSFW Promptの自動変更、除去、翻訳
- 自動ぼかし、自動非表示、年齢確認機能
- Discord通知挙動の変更
- NSFW画像の別フォルダへの移動
- History JSONの全面migration

分類はユーザーまたはAPI clientが明示した値だけを正本にする。

## 4. 生成画面UI

生成操作フッターまたは「生成設定」内のコンパクトな位置へ、次の2択を追加する。

```text
[ 一般 ] [ NSFW ]
```

要件:

- native radio、既存segmented control、既存Option Pickerのいずれかを再利用する。
- 大きな警告カードを作らない。
- NSFWを赤・黄・ライムの強い面で常時強調しない。
- 選択状態だけ既存の控えめな選択表現を使う。
- キーボード操作、label、focus-visibleを維持する。
- 現在の生成フォーム自動保存へ追加し、再読込後も復元する。
- 生成設定の復元時に`contentRating`を復元する。
- 古い履歴のレシピ復元では`unrated`を勝手に生成フォームの第3選択肢にせず、既定の`general`へ落とす。ただし履歴自体の表示は`unrated`を維持する。
- Prompt、Negative、Runtime、Checkpoint、LoRA、Seed、生成API payloadの既存意味を変更しない。

## 5. History保存・派生生成

`src/history.js`の既存normalize／保存経路を使い、generation単位で保存する。

要件:

- 新規生成は指定された`contentRating`を保存する。
- Hires結果、同一generationの候補画像は同じ分類を共有する。
- History recipe／設定復元で分類を返せるようにする。
- Historyからの派生再生成は、requestで分類が省略された場合に親generationの分類を継承する。
- 派生再生成で`general`または`nsfw`が明示された場合はその値で上書きする。
- 親Historyが古く`unrated`の場合、派生生成の省略値は安全な`general`とする。新規履歴へ`unrated`を書き込まない。
- 元History・元画像の分類は派生生成によって変更しない。
- 既存500件保持上限、rotation、Favorite、削除、Discord状態を変更しない。

## 6. 既存履歴の手動分類

古い履歴や誤分類を整理できるよう、既存画像の詳細または三点メニューから分類を変更可能にする。

推奨API:

```http
PATCH /api/history/:imageId/content-rating
Content-Type: application/json

{ "contentRating": "general" }
```

または:

```json
{ "contentRating": "nsfw" }
```

要件:

- `imageId`から所属generationを解決する。
- 更新対象は画像1枚ではなく所属generationの`contentRating`。
- 同じgeneration内の全候補画像が即時に同じ表示へ同期する。
- 他generationは変更しない。
- APIは`general`または`nsfw`だけを受け付ける。`unrated`への手動変更は初期版では不要。
- 不正値は400、存在しない画像は404。
- History JSON全件をクライアントへ送り返さない。
- 更新後は安全な最小DTOだけを返す。
- Favorite PATCHと同様の既存service／store更新方式を利用する。

## 7. ギャラリーUI

既存の`kind`フィルターと独立した`rating`フィルターを追加する。

```text
表示分類: [ すべて ] [ 一般 ] [ NSFW ] [ 未分類 ]
```

要件:

- `galleryFilter`へ`rating: "all"`を追加する。
- 許可値は`all / general / nsfw / unrated`。
- Favorite、通常生成、比較実験、Checkpoint、LoRA、期間、検索、タグと同時に利用可能にする。
- NSFWを選んでも表示順を変更しない。
- NSFW画像をFavoriteのように先頭へ移動しない。
- カードまたは詳細に、小さく静かな`NSFW`ラベルを表示する。
- `unrated`は必要な場合だけ「未分類」の補助ラベルを表示する。
- 一般画像へ常時`一般`badgeを大量表示する必要はない。
- badgeは画像操作やFavorite星、三点メニューを隠さない。
- 既存の画像クリック、詳細、比較、再利用、Favorite、スクロールを壊さない。
- モバイルでも横スクロールや極端なツールバー肥大を発生させない。

## 8. ページングを壊さないサーバー側絞り込み

NSFW分類はクライアントが取得済みの最初のページだけを絞る実装にしてはならない。全履歴に対して正確な件数、cursor、hasMoreを返すため、History Serviceの`listPage()`でgenerationを先に分類絞り込みし、その後に画像へ平坦化する。

legacy API:

```http
GET /api/history?rating=all
GET /api/history?rating=general
GET /api/history?rating=nsfw
GET /api/history?rating=unrated
```

要件:

- `rating`省略または`all`は従来どおり全件。
- `favorites=1&rating=nsfw`の組合せを正しく扱う。
- `total`、`nextCursor`、`hasMore`は絞り込み後datasetを基準にする。
- cursorへ絶対pathや分類値を埋め込む新形式は作らない。
- 不正ratingは400とし、暗黙に全件へフォールバックしない。
- 既存API利用者がratingを省略した場合のresponseと順序を変えない。

フロント側の`filterGalleryEntries()`にもrating判定を追加する。ただしこれは検索や取得済み表示の即時更新用であり、サーバー側ページングの代替にはしない。

## 9. API v1

API v1でも同じ分類を扱う。

### Generation

`POST /api/v1/generations` requestへoptionalなトップレベル`contentRating`を追加する。

```json
{
  "mode": "txt2img",
  "contentRating": "nsfw",
  "prompt": {},
  "settings": {}
}
```

- `general / nsfw`のみ許可。
- 省略時は`general`。
- `metadata.client`へ分類を埋め込まない。
- ReForge／Forge Neo payloadへ不要な独自fieldとして送らない。
- Generation Runtimeの画像生成意味を変えず、History metadataとして扱う。

### Regeneration

`POST /api/v1/history/:id/regenerations`にもoptionalな`contentRating`を追加し、前述の継承規則を適用する。

### History

- list/detailの公開allowlist DTOへ`contentRating`を追加する。
- list queryで`rating`を受け付ける。
- 内部path、filename、Prompt解析結果等を新たに公開しない。
- 古いHistoryは`unrated`として返す。

## 10. MCP

MCPから生成した画像も同じギャラリー分類を使えるようにする。

要件:

- `generate_image`へoptionalな`contentRating: "general" | "nsfw"`。
- `regenerate_image`へ同じoptional field。省略時の継承はBackendが正本であり、MCP側でHistoryを取得・mergeしない。
- `get_history`へoptionalな`rating: "all" | "general" | "nsfw" | "unrated"`。
- `get_history_item` DTOで`contentRating`を検証する。
- MCP clientはAPIへ同名で透過的に渡す。
- Tool descriptionに「分類は明示メタデータであり、Promptの解析や変更を行わない」と短く明記する。
- MCP側にNSFW判定、History cache、独自default、Prompt分類を追加しない。
- 現在のTool数を増やさない。

## 11. 変更候補ファイル

実装前に現コードとdirty worktreeを再確認し、原則として次の範囲へ限定する。

```text
src/history.js
src/server.js
src/services/generation-service.js
src/api/v1/history.js
src/mcp/schemas.js
src/mcp/local-image-chat-client.js
src/mcp/tools.js
public/index.html
public/app.js
public/gallery-filter.js
public/style.css
test/history.test.js
test/api-v1.test.js
test/mcp-client.test.js
test/mcp-tools.test.js
test/studio-history.test.js または test/ui-shell.test.js
```

上限は16ファイル。17ファイル以上が必要と判明した場合は、実装前に理由と追加対象を監督へ報告する。

Task 22、Forge Neo provider、Runtime registry、ReForge adapter、Reference Asset、IP-Adapter、package dependencies、起動バッチは変更しない。

## 12. 必須テスト

### History

- 新規`general`保存
- 新規`nsfw`保存
- 古いfieldなしが`unrated`
- 不明値・壊れた値が`unrated`
- `listPage({ rating: "nsfw" })`の正確なtotal／cursor／hasMore
- Favorite＋NSFWの組合せ
- 手動分類が所属generation全体へ反映
- 他generationを変更しない
- 不正値拒否

### Generation／API v1

- 省略時`general`
- 明示`nsfw`
- ReForge／Neo requestへ分類fieldを混入させない
- History detail／list DTO
- 派生生成の継承
- 派生生成の明示上書き
- 古い`unrated`親からの派生は`general`
- legacy API queryの後方互換

### Gallery／UI

- rating純粋filter
- kind／Favoriteとの組合せ
- filter summary
- 生成requestへ選択値を含める
- 自動保存・再読込復元
- History recipe復元
- 手動分類PATCH後に同generationの全カードが同期
- 既存比較、Favorite、詳細操作のイベント伝播を壊さない

### MCP

- generate／regenerate mapping
- history query mapping
- enum外値拒否
- History DTO検証
- 既存Tool数不変

## 13. 検証コマンド

最低限:

```powershell
npm run check
node --test test/history.test.js test/api-v1.test.js test/mcp-client.test.js test/mcp-tools.test.js test/studio-history.test.js test/ui-shell.test.js
npm test
git diff --check
```

実3030／7860／Forge Neoを自動テストで使用しない。temporary workspace、mock/stub、fixtureを利用する。実History、実outputs、Favorite、Discord、storage settingsを変更しない。

## 14. 完了条件

1. Web生成時に一般／NSFWを明示選択できる。
2. 選択値がgeneration単位でHistoryへ保存される。
3. 再読込・設定復元後も選択が維持される。
4. 古い履歴が壊れず`unrated`として表示される。
5. ギャラリーで一般／NSFW／未分類を正確に絞り込める。
6. Favorite等の既存filterと組み合わせられる。
7. サーバー側ページング後も件数・cursorが正しい。
8. 既存履歴を手動で一般／NSFWへ分類できる。
9. 同じgenerationの候補画像で分類が同期する。
10. API v1とMCPからも分類を指定できる。
11. 派生再生成の継承・上書き規則が一定である。
12. Promptや生成結果へ自動介入しない。
13. ReForge／Forge Neoの生成payloadを変更しない。
14. 既存History、Favorite、比較、Discord、画像配信を壊さない。
15. 新規依存を追加しない。
16. `npm run check`、関連test、`npm test`、`git diff --check`が成功する。

## 15. Luna作業後の報告

次を必ず報告する。

- 変更ファイル一覧と変更数
- `contentRating`の正規化・保存場所
- 新規生成の既定値
- 古いHistoryの扱い
- 派生再生成の継承規則
- Gallery filterとサーバー側paginationの構造
- 手動分類APIとgeneration単位同期
- API v1／MCP mapping
- Prompt・ReForge・Neo payloadへ影響しない根拠
- 追加／更新test
- 実行コマンドと件数
- 実3030／7860、実History／outputsを変更していないこと
- 残る制約

実装完了時は、このTask 24節の状態だけを次へ更新する。

```text
状態: **実装完了／監督レビュー待ち**
```

監督承認、commit、push、実機再起動を勝手に行わない。
