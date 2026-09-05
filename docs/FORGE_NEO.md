# Forge Neo / Anima Runtime

Task 20で追加したForge Neo / Anima対応と、Task 22で追加したRuntime Profile対応の運用メモです。既存のReForge Runtime、JobManager、History、画像配信、MCP Toolはそのまま共有します。

## 設定例

`config.local.json`へ、実際の環境に合わせて次のRuntime設定を追加します。`config.json`へ実機固有のURLやパスは記録しません。

```json
{
  "runtimes": {
    "default": "reforge",
    "forgeNeoAnima": {
      "enabled": true,
      "id": "forge-neo-anima",
      "label": "Forge Neo / Anima",
      "url": "http://127.0.0.1:7860",
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

`id`、`label`、対応モードはBackend側のallowlistで固定されます。NeoのCheckpointは設定した1つだけが許可され、任意のファイル名やパスを生成要求から受け付けません。

## Task 22 Profile設定

`profiles`を設定した場合は、旧単一設定の`checkpoint`、`preset`、`additionalModules`を暗黙にmergeせず、`profiles`だけを正本として扱います。各Profileは次の4項目を一体で持ちます。

```json
{
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
      "id": "xl-approved-profile",
      "label": "SDXL / Illustrious（承認済み設定）",
      "checkpoint": "sd\\approved-xl-checkpoint.safetensors",
      "preset": "xl",
      "additionalModules": []
    }
  ]
}
```

実際のSDXL ProfileのCheckpointと追加moduleは、Neoの保存値およびcatalogを読み取り確認したうえで設定します。未確認のモデルやmoduleを推測で追加しません。`id`は安全なidentifier、`checkpoint`は相対identifier、`preset`は`anima`または`xl`、`additionalModules`は安全なbasenameだけを受け付けます。空Profile、重複Profile ID、重複・曖昧Checkpoint、危険なpath、重複moduleはprovider構築時に拒否します。

`profiles`がない既存設定は、旧単一Anima設定から`anima-default`という内部Profileを1件だけ生成します。これによりTask 20の設定とHistory／API v1／MCPの公開Runtime ID `forge-neo-anima`を維持します。

Neoの`/sdapi/v1/sd-models`全件を公開せず、設定済みProfileに一致したCheckpointだけを設定順で公開します。catalog titleのhash suffix、optionsのhashなし表記、absolute filenameのbasenameは既存の安全な比較規則で解決します。absolute filenameそのものやmodule pathは公開DTOへ出しません。

## 有効化とReadiness

`managed-options`では生成Jobの実行直前に、選択されたProfileに対して次の順でNeo APIを確認します。

1. `/sdapi/v1/options`
2. `/sdapi/v1/sd-models`
3. `/sdapi/v1/sd-modules`
4. 設定済みProfileのCheckpointと、そのProfileのrequired moduleを解決
5. 現在状態が一致しなければ、Checkpoint・`forge_preset`・Profileのrequired modulesを1回のoptions POSTへ送信
6. optionsを再取得し、完全一致を確認してからtxt2imgへ進む

`preloaded`ではoptions POSTを行わず、現在状態が一致しない場合にJobを失敗させます。`/cmd-flags`はReadiness判定に使用しません。

Checkpoint selectorでの選択は公開catalogとLocal Image Chatの状態だけを更新します。Neoへのoptions POSTやモデル切替は行わず、実際のProfile activationはqueue内のJob実行時だけに行います。Animaから追加moduleなしのProfileへ移る場合も、空配列をoptions POSTへ明示送信してmoduleを解除します。

Neoの初期対応範囲はtxt2img、negative prompt、width／height、steps、CFG、seed、sampler／scheduler、候補枚数、Anima LoRA、Job status／cancelです。img2img、inpaint、Hires.fix、IP-Adapter、Reference Asset IP-AdapterはBackendとUIの両方で利用不可として扱います。ReForgeへ自動fallbackは行いません。

Runtimeの失敗は該当Jobだけをfailedにし、独自retryやNeo processの再起動は行いません。公開DTOにはRuntime ID・provider以外のURL、port、絶対パス、module path、stack、Neo raw responseを含めません。

## Task 22 Phase Aの実機確認

2026-08-14に、Neoが待ち受ける`127.0.0.1:7860`へGETだけを実施しました。現在の保存状態はAnima preset、Anima Checkpoint、AnimaのVAE／text encoder moduleです。Checkpoint catalogは13件、module catalogは2件、LoRA catalogは100件で、Anima系とSDXL／Illustrious系のbase metadataが混在しています。

Neo保存値のSDXL用Checkpointと追加moduleは未設定でした。そのため、Task 22の実装ではSDXLの具体的な固定値を追加せず、監督承認済みのProfile設定だけを正本として扱う構造にしています。実機でoptions POST、生成、process停止・再起動は行っていません。

## 検証上の注意

実機Neo／ReForgeのprocess停止・kill、実履歴への生成、3030／7860への本番smokeは、設計監督から明示的な許可を受けてから実行します。通常の自動テストではmock HTTP serverを使用します。
