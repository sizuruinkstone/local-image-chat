# Local Image Chat — Agent working agreement

## セッション開始

1. 最初にこの `AGENTS.md` と [current-state.md](docs/implementation/current-state.md) を読む。
2. ユーザーが今回依頼した範囲・Phase・完了条件を確認する。ロードマップに次Phaseがあっても実装許可とはみなさない。
3. `git status --short` で既存差分を把握し、編集対象の差分だけを確認する。既存の `local-image-chat` を使用し、新しいrepositoryを作らない。
4. current-stateの入口から、対象Phaseの記録・関数・testだけを読む。設計判断には [decisions.md](docs/implementation/decisions.md) を参照する。

## 情報源と探索

- repository内documentをproject stateのsource of truthとする。会話履歴や外部memoryだけから進捗・仕様を決めない。現コードと文書が食い違えば対象コード/testで確認し、確認できた現在状態を文書へ反映する。今回の明示的なユーザー指示を優先する。
- current-stateは現在の作業状態、decisionsは継続する設計判断、各Phase文書は検証根拠、Discoveryはarchitecture baselineとロードマップ。`DESIGN.md` はUI設計の基準。
- repository-wide scanは依存範囲が分からない場合など、必要な理由があるときだけ行う。毎回README・全backend・巨大なapp.jsを全文読まない。
- まず `rg -n '対象symbol' public/app.js test` や対象directoryの `rg --files` で絞り、該当関数とcallerの必要範囲だけ読む。
- lockfile、generated/build artifact、大きなJSON、画像・archive、長いlogは、その内容が判断に必要な場合のみ読む。`node_modules/`、`output/`、ローカルdataや生成画像を探索の既定対象にしない。
- unchanged fileの全文readを繰り返さない。既読内容を利用し、変更後はdiffまたは関係する範囲を読む。

## Subagentと出力

- 独立して進められる詳細探索・test実行・長いlog解析・routine reviewは、利用可能なsubagentへ委譲する。小さな文書修正など、分割する有益な作業がない場合は親agentで完結する。
- 委譲時は対象files、質問またはcommand、変更可否、担当範囲を明示する。調査・test担当は原則read-only。共有workspaceで同じfileを複数agentが同時編集しない。
- subagentには「結論、根拠のfile/symbol、実行commandとexit code、pass/fail件数、重要なfailure、未確認事項」の短い報告を求める。全文log・大量の探索結果を親へ転送しない。
- 親agentはscope、設計判断、差分の統合review、完了判定を担当する。委譲済みの探索やfull suiteを理由なく重複実行しない。
- 長いtest outputはTEMP等のrepository外logへ保存し、終了codeと集計・必要なfailure周辺だけを表示する。subagentが使えない場合も同じ出力方針でローカル実行し、利用できないことだけで作業を止めない。

## 実装と既存差分の保護

- requested Phaseのみ実施し、完了後は結果を報告して停止する。UI redesign、API変更、framework導入、別feature整理を抽出Phaseへ混ぜない。
- 既存ユーザー差分、前Phaseの未コミット実装、未追跡file、設定・保存データを保持する。作業開始時のdirty treeを自分の変更と区別する。
- unrelated cleanup、差分の巻き戻し、`git reset --hard`、`git clean`、未追跡成果物の削除を行わない。今回対象外のfileは修正しない。
- commit/pushは依頼された場合に実施する。その場合も対象pathを明示し、`git add .` でローカル成果物・private dataを一括追加しない。
- backend/API/History/runtime/storage等の不変条件はdecisionsとDiscoveryで確認する。frontend分割の都合だけでcontractを変更しない。

## 検証と完了時の引き継ぎ

- コード変更では既存behaviorを先にcharacterizeし、対象unit testを優先する。例: `node --test test/navigation.test.js`。
- 実装Phaseのcompletion gateで `npm.cmd run check` と `npm.cmd test` を実行する。成功後の反復は新しい変更・failure・未解決の懸念がある場合だけ。UI関連はPhaseの条件に応じてbrowser確認も行う。
- failureは今回の差分によるものか既存かを根拠付きで区別する。別問題を無断修正せず、未解決なら完了扱いにしない。
- ドキュメントのみの変更はリンク・内容整合・差分・whitespaceを確認する。実装に影響しない文書変更だけでfull suiteを再実行する必要はない。過去のtest結果を今回の実行結果として報告しない。
- 終了時はcurrent-stateを簡潔な現在snapshotへ更新する。current/completed Phase、変更file、検証結果と実施時点、保持すべき差分、制約、次候補、最初に読むfilesを残す。長い日記や生logを追記しない。
- durableな判断だけdecisionsへ記録し、詳細なPhase検証は個別文書へ置く。Discoveryのロードマップや既存の `docs/CURRENT_TASK.md`・`docs/REVIEW_FIXES.md` の過去記録を全面上書きしない。

参考: [Codex AGENTS.md公式ガイド](https://learn.chatgpt.com/docs/agent-configuration/agents-md)。上記はこのrepositoryの作業方針。
