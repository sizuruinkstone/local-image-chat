// ヘッダー右上のキュー表示。通常生成と比較実験を1か所でまとめて見せる。
// 進捗率が取れない状態では、偽のパーセントを出さず状態だけを表示する。

export const QUEUE_STATUS_LABELS = {
  queued: "待機中",
  running: "生成中",
  saving: "保存中",
  done: "完了",
  completed: "完了",
  failed: "失敗",
  cancelled: "中止"
};

export function queueStatusLabel(status) {
  return QUEUE_STATUS_LABELS[status] ?? String(status ?? "");
}

function isActiveStatus(status) {
  return ["queued", "running", "saving"].includes(status);
}

// 進捗率が取れない（null/空）ときは空文字。0%とみなして偽の数字を出さない。
function percentText(progress) {
  if (progress === null || progress === undefined || progress === "") return "";
  const value = Number(progress);
  return Number.isFinite(value) ? `${Math.round(value)}%` : "";
}

// 比較実験の進捗。パターン数と（分かる場合は）画像枚数を返す。
export function formatComparisonProgress(entry) {
  const total = Number(entry?.totalCases) || 0;
  const done = Number(entry?.completedCases) || 0;
  const lines = [];
  if (total) lines.push(`条件 ${done}/${total}`);
  const totalImages = Number(entry?.totalImages) || 0;
  const doneImages = Number(entry?.completedImages) || 0;
  // 1パターン1枚のときは同じ数字が並ぶだけなので出さない。
  if (totalImages && totalImages !== total) lines.push(`画像 ${doneImages}/${totalImages}`);
  const failed = Number(entry?.failedCases) || 0;
  if (failed) lines.push(`${failed}件失敗`);
  return lines.join("・");
}

// ヘッダーの1行表示。進捗率が取れるときだけ % を付ける。
export function summarizeQueue(queue) {
  const generation = queue?.generation ?? [];
  const comparison = queue?.comparison ?? [];
  const activeGeneration = generation.filter((item) => isActiveStatus(item.status));
  const activeComparison = comparison.filter((item) => isActiveStatus(item.status));
  const activeCount = activeGeneration.length + activeComparison.length;

  if (!activeCount) {
    const failed = generation.some((item) => item.status === "failed")
      || comparison.some((item) => item.status === "failed");
    if (failed) return { visible: true, tone: "error", text: "生成に失敗しました", activeCount: 0 };
    const finishedComparison = comparison.find((item) => item.status === "completed");
    if (finishedComparison) {
      return {
        visible: true,
        tone: "done",
        text: (Number(finishedComparison.failedCases) || 0)
          ? `比較実験 ${formatComparisonProgress(finishedComparison)}`
          : "比較実験が完了しました",
        activeCount: 0
      };
    }
    if (generation.some((item) => item.status === "done")) {
      return { visible: true, tone: "done", text: "生成完了", activeCount: 0 };
    }
    return { visible: false, tone: "idle", text: "", activeCount: 0 };
  }

  // 実行中が1件だけならその内容を、複数なら件数をまとめて出す。
  if (activeCount > 1) {
    return { visible: true, tone: "busy", text: `処理中 ${activeCount}件`, activeCount };
  }
  const [entry] = [...activeGeneration, ...activeComparison];
  if (entry.type === "comparison") {
    const progress = formatComparisonProgress(entry);
    const percent = entry.status === "running" ? percentText(entry.progress) : "";
    return {
      visible: true,
      tone: "busy",
      text: [`比較実験 ${queueStatusLabel(entry.status)}`, progress, percent].filter(Boolean).join(" "),
      activeCount
    };
  }
  const percent = entry.status === "running" ? percentText(entry.progress) : "";
  return {
    visible: true,
    tone: "busy",
    text: [queueStatusLabel(entry.status), percent].filter(Boolean).join(" "),
    activeCount
  };
}

function line(text, className = "") {
  const span = document.createElement("span");
  if (className) span.className = className;
  span.textContent = text;
  return span;
}

function sectionHeading(text) {
  const heading = document.createElement("strong");
  heading.className = "queueSectionHeading";
  heading.textContent = text;
  return heading;
}

function emptyLine(text) {
  const paragraph = document.createElement("p");
  paragraph.className = "uiFieldNote";
  paragraph.textContent = text;
  return paragraph;
}

function actionButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function buildGenerationRow(entry, handlers) {
  const row = document.createElement("div");
  row.className = `queueRow status-${entry.status}`;

  const head = document.createElement("div");
  head.className = "queueRowHead";
  const status = queueStatusLabel(entry.status);
  head.append(
    line(entry.queuePosition ? `${status} ${entry.queuePosition}` : status, "queueRowStatus"),
    line(entry.label || "画像生成", "queueRowTitle")
  );
  const percent = entry.status === "running" ? percentText(entry.progress) : "";
  if (percent) head.append(line(percent, "queueRowProgress"));
  row.append(head);

  if (entry.message && isActiveStatus(entry.status)) row.append(line(entry.message, "queueRowMeta"));
  if (entry.status === "failed" && entry.errorMessage) {
    row.append(line(entry.errorMessage, "queueRowError"));
  }

  if (isActiveStatus(entry.status) && typeof handlers?.onCancelGeneration === "function") {
    const actions = document.createElement("div");
    actions.className = "queueRowActions";
    actions.append(actionButton("中止", "historyDelete smallButton", () => handlers.onCancelGeneration(entry)));
    row.append(actions);
  }
  return row;
}

function buildComparisonRow(entry, handlers) {
  const row = document.createElement("div");
  row.className = `queueRow status-${entry.status}`;

  const head = document.createElement("div");
  head.className = "queueRowHead";
  const status = queueStatusLabel(entry.status);
  head.append(
    line(entry.queuePosition ? `${status} ${entry.queuePosition}` : status, "queueRowStatus"),
    line(entry.name || "比較実験", "queueRowTitle")
  );
  const progress = formatComparisonProgress(entry);
  if (progress) head.append(line(progress, "queueRowProgress"));
  row.append(head);

  if (entry.subject) row.append(line(entry.subject, "queueRowMeta"));
  if (entry.currentCaseLabel) {
    const percent = entry.status === "running" ? percentText(entry.progress) : "";
    row.append(line([`処理中: ${entry.currentCaseLabel}`, percent].filter(Boolean).join(" "), "queueRowMeta"));
  }
  if (entry.errorMessage) row.append(line(entry.errorMessage, "queueRowError"));

  const actions = document.createElement("div");
  actions.className = "queueRowActions";
  if (isActiveStatus(entry.status) && typeof handlers?.onCancelComparison === "function") {
    actions.append(actionButton("中断", "historyDelete smallButton", () => handlers.onCancelComparison(entry)));
  }
  if (entry.resultId && typeof handlers?.onOpenComparisonResult === "function") {
    actions.append(actionButton("結果を見る", "secondary smallButton", () => handlers.onOpenComparisonResult(entry)));
  }
  if (actions.children.length) row.append(actions);
  return row;
}

// キュー詳細パネルの中身。通常生成と比較実験をセクションで分ける。
export function buildQueuePanel(queue, handlers = {}) {
  const container = document.createElement("div");
  container.className = "queuePanel";

  const generation = queue?.generation ?? [];
  const comparison = queue?.comparison ?? [];

  const generationSection = document.createElement("section");
  generationSection.className = "queueSection";
  generationSection.append(sectionHeading("画像生成"));
  if (generation.length) {
    for (const entry of generation) generationSection.append(buildGenerationRow(entry, handlers));
  } else {
    generationSection.append(emptyLine("実行中・待機中の生成はありません"));
  }

  const comparisonSection = document.createElement("section");
  comparisonSection.className = "queueSection";
  comparisonSection.append(sectionHeading("比較実験"));
  if (comparison.length) {
    for (const entry of comparison) comparisonSection.append(buildComparisonRow(entry, handlers));
  } else {
    comparisonSection.append(emptyLine("実行中・待機中の比較実験はありません"));
  }

  container.append(generationSection, comparisonSection);
  return container;
}
