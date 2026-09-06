# Frontend Refactor Phase 1 — JSON Transport Extraction

実施日: 2026-09-06。Baseline: [frontend-refactor-discovery.md](frontend-refactor-discovery.md)。Phase 1のみ完了。ロードマップ・CURRENT_TASK・過去記録は変更していない。

- `public/core/http-client.js` へ `getJson`、`postJson`、`patchJson`、`deleteJson` をnamed exportとして抽出した。現在の実装はPUTではなくPATCH。関数名・引数・Promiseの挙動を維持した。
- `public/app.js` はimport追加と旧定義削除のみ。全69 caller（GET 21、POST 28、PATCH 16、DELETE 4）、direct fetch、caller側error handlingは変更していない。抽出前後の関数本体と、helper以外のappコードを機械的に照合した。
- GETは `fetch(url)` のまま、POST/PATCHは既存method・Content-Type・JSON.stringify、DELETEはmethodだけを指定する。全helperで `response.json()` が `response.ok` 判定より先。legacyの `data.error ?? HTTP fallback`、解析失敗・network rejectionの伝播を維持した。retry、timeout、AbortController、API v1対応は追加していない。
- `test/http-client.test.js` の48件を、まずapp内の旧helperを読み出して実行し、抽出後は新moduleのimportへ切り替えて同じassertを実行した。成功、backend error、nullish fallback、空文字/false/object error、2xx/non-2xxのJSON parse失敗、network rejection、serialization失敗、request回数を確認した。
- `package.json` のcheck対象へ新moduleを追加した。依存追加・lockfile変更なし。

検証結果:

| コマンド | 結果 |
| --- | --- |
| `node --test test/http-client.test.js`（抽出前/後） | 両方48 passed、0 failed |
| `npm.cmd run check` | 成功 |
| `npm.cmd test` | 530 passed、0 failed、0 skipped |

backend/API/History/storage/runtime、HTML/CSS、既存public helperは変更していない。実ブラウザと実生成のSmoke Testは未実施。新しいES module assetを配信物に含める必要はあるが、import pathは既存Expressのpublic static配下にある。Phase 2を別タスクとして検討できる状態で停止し、Phase 2以降は実装していない。
