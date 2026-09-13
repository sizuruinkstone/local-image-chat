# Checkpoint backup and untracked classification

2026-09-08。ユーザー依頼によるremoteバックアップと未追跡ファイルの分類。削除・移動・追加commitは行わず、.gitignoreも候補提示のみ。

## Remote backup

`checkpoint/frontend-refactor-phase13` を同名のorigin branchへpushし、upstreamを設定。
基準点: `25e11275ad19a8ec5d3566a5c09e19517d1dbcad`。
3段階: `a38f3b3` Core contract → `b7583c6` New Studio → `25e1127` Production cutover。
mainへのmerge、force push、Frontend本体変更なし。未commitの別作業・ローカル成果物はこのバックアップに含まれない。

## Untracked inventory

本記録追加前の `git ls-files --others --exclude-standard` による555ファイルを分類。内容の公開可否・将来commitの可否を確定する監査ではなく、pathと用途による分類。画像・大きなJSONの内容は読み込んでいない。

| 分類 | 対象 | 件数 | 扱い |
|---|---|---:|---|
| Artist catalog | `docs/artist-catalog/` | 520 | 別作業として保持。6管理・data・HTMLファイルと514 assets。画像もcatalog構成要素なので一括ignoreしない |
| Catalog更新script | `scripts/update-artist-catalog.js` | 1 | catalogと一緒に将来review |
| 旧illustrator資料 | `docs/twitter-illustrators.md`、`docs/twitter-illustrators-gallery/`、同名zip | 11 | HTML・参照画像・archiveを含む別成果物。不要・再生成可能と未確認のため保持 |
| Knowledge / Lab | `docs/AI_PROJECT_MEMORY.md`、`docs/luna-tasks/` | 4 | 別作業の文書として保持 |
| 旧architecture audit | `docs/refactor/` | 2 | 別作業の文書として保持 |
| Pearl Glass / 旧UI | `docs/ui/` | 6 | 既存tracked差分と合わせて将来review |
| 生成画像 | `output/imagegen/` | 8 | ignore候補。削除しない |
| Smoke画像 | `output/mcp-smoke/cafe-girl.png` | 1 | ignore候補。削除しない |
| 検証スクリーンショット | rootの `malice_civitai_optimized.png`、`malice_recent_latest.png` | 2 | ignore候補。削除しない |
| **合計** | | **555** | |

既存 `.gitignore` は `workbench/`、`data/`、`outputs/`配下の画像等を対象にしている。今回の未追跡画像は単数形 `output/` にあり、既存の `outputs/` ルールとは別。ignored成果物は555件に含まれない。

必要になった際の狭いignore候補（未適用）:

```gitignore
/output/imagegen/*.png
/output/mcp-smoke/*.png
/malice_civitai_optimized.png
/malice_recent_latest.png
```

`*.png`、`docs/`、`output/`全体などの広い指定は行わない。将来commit候補の文書やcatalog assetを隠さないため、今回の整理は分類までとする。

## Library smoke follow-up

checkpoint候補treeで `dev/studio/library-smoke.mjs` のviewport変更直後のoverflow assertionが一度失敗し、同一ソースの再実行でPASSした。これは過去checkpoint検証の記録で、今回は再実行していない。

再発時はresize直後のlayout確定前にassertionが走っていないかを最初に調査する。これは未確定の仮説。viewport、scrollWidth/clientWidth、overflowする要素、直前の操作を記録し、実際のlayout不具合と検証タイミングを切り分ける。現時点でCSS修正・assertion緩和・無条件retryは追加しない。

今回はpush・分類・文書整合のみ。check/test、実Provider生成、Production再起動は再実施していない。
