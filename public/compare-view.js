import { openModal, toast } from "./ui-kit.js";
import { configureThumbnailImage, originalImageUrl } from "./image-delivery.js";

// 2〜4枚の画像を並べて比較するモーダル。
// ズーム・パンは全ペインで同期し、設定差分とPrompt差分を表示する。

const COMPARE_SETTING_KEYS = [
  ["checkpoint", "Checkpoint"],
  ["samplerName", "Sampler"],
  ["scheduler", "Scheduler"],
  ["noiseSchedule", "Noise schedule"],
  ["steps", "Steps"],
  ["cfgScale", "CFG"],
  ["width", "幅"],
  ["height", "高さ"],
  ["img2imgDenoising", "img2img Denoising"],
  ["inpaintDenoising", "Inpaint Denoising"],
  ["hiresScale", "Hires倍率"],
  ["hiresSteps", "Hires Steps"],
  ["hiresDenoising", "Hires Denoising"]
];

// 差分のあるキーだけを返す。全て同じなら空配列。
export function diffSettings(entries) {
  const rows = [];
  for (const [key, label] of COMPARE_SETTING_KEYS) {
    const values = entries.map((entry) => entry.generation?.settings?.[key] ?? "");
    if (values.every((value) => String(value) === String(values[0]))) continue;
    rows.push({ key, label, values: values.map((value) => (value === "" ? "—" : String(value))) });
  }
  return rows;
}

export function diffLoras(entries) {
  const rows = [];
  const names = new Set(entries.flatMap((entry) => (entry.generation?.loras ?? []).map((lora) => lora.name)));
  for (const name of names) {
    const values = entries.map((entry) => {
      const lora = (entry.generation?.loras ?? []).find((item) => item.name === name);
      return lora ? Number(lora.weight).toFixed(2) : "—";
    });
    if (values.every((value) => value === values[0])) continue;
    rows.push({ key: name, label: name, values });
  }
  return rows;
}

// Promptをタグ単位で比較し、最初の画像を基準に「追加/削除」を出す。
export function diffPrompts(entries) {
  const split = (value) => String(value ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
  const base = split(entries[0]?.generation?.prompt);
  const baseSet = new Set(base.map((tag) => tag.toLowerCase()));
  return entries.map((entry, index) => {
    if (index === 0) return { added: [], removed: [] };
    const tags = split(entry.generation?.prompt);
    const set = new Set(tags.map((tag) => tag.toLowerCase()));
    return {
      added: tags.filter((tag) => !baseSet.has(tag.toLowerCase())),
      removed: base.filter((tag) => !set.has(tag.toLowerCase()))
    };
  });
}

// 自動リカバリで下げた設定を「幅: 896 → 832」の形にまとめる。
export function describeRetryInfo(retryInfo) {
  if (!retryInfo) return "";
  const label = retryInfo.retryReasonLabel || "自動リカバリ";
  const original = retryInfo.originalSettings ?? {};
  const retry = retryInfo.retrySettings ?? {};
  const changes = Object.entries(retry)
    .filter(([key, value]) => String(original[key]) !== String(value))
    .map(([key, value]) => `${key}: ${original[key]} → ${value}`);
  return changes.length
    ? `${label}のため設定を下げて再試行しました（${changes.join("・")}）`
    : `${label}のため再試行しました`;
}

export function openCompareView({ entries, onVote }) {
  if (!Array.isArray(entries) || entries.length < 2) {
    toast.warning("比較するには2枚以上を選んでください");
    return Promise.resolve(null);
  }
  const items = entries.slice(0, 4);
  const zoom = { scale: 1, x: 0, y: 0 };
  const panes = [];

  return openModal({
    title: `画像比較（${items.length}枚）`,
    subtitle: "ホイールで拡大・ドラッグで移動（全画像が同期します）",
    size: "large",
    dismissValue: null,
    build: (body, close) => {
      const grid = document.createElement("div");
      grid.className = `compareGrid count-${items.length}`;

      for (const [index, entry] of items.entries()) {
        const pane = document.createElement("figure");
        pane.className = "comparePane";
        const stage = document.createElement("div");
        stage.className = "compareStage";
        const image = document.createElement("img");
        configureThumbnailImage(image, entry.image);
        image.alt = `比較 ${labelFor(index)}`;
        image.draggable = false;
        stage.append(image);

        const caption = document.createElement("figcaption");
        const title = document.createElement("strong");
        title.textContent = `${labelFor(index)}・Seed ${entry.image.seed}`;
        caption.append(title);
        const compared = entry.generation?.comparedParameter
          ? `${entry.generation.comparedParameter}: ${entry.generation.comparedValue}`
          : "";
        if (compared) {
          const badge = document.createElement("span");
          badge.className = "compareBadge";
          badge.textContent = compared;
          caption.append(badge);
        }
        // 自動リカバリで設定を下げて生成した画像は、同条件の比較にならないため明示する。
        const retryInfo = entry.generation?.retryInfo;
        if (retryInfo) {
          const recovered = document.createElement("span");
          recovered.className = "compareBadge recovered";
          recovered.textContent = "設定を下げて再試行";
          recovered.title = describeRetryInfo(retryInfo);
          caption.append(recovered);
        }
        const size = document.createElement("span");
        size.className = "compareMeta";
        size.textContent = `${entry.image.width ?? "?"}×${entry.image.height ?? "?"}`;
        caption.append(size);

        pane.append(stage, caption);
        grid.append(pane);
        panes.push({ image, originalUrl: originalImageUrl(entry.image) });

        stage.addEventListener("wheel", (event) => {
          event.preventDefault();
          const next = zoom.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15);
          zoom.scale = Math.min(6, Math.max(1, next));
          if (zoom.scale === 1) { zoom.x = 0; zoom.y = 0; }
          applyZoom();
        }, { passive: false });

        let dragging = false;
        let last = null;
        stage.addEventListener("pointerdown", (event) => {
          if (zoom.scale === 1) return;
          dragging = true;
          last = { x: event.clientX, y: event.clientY };
          stage.setPointerCapture?.(event.pointerId);
        });
        stage.addEventListener("pointermove", (event) => {
          if (!dragging || !last) return;
          zoom.x += event.clientX - last.x;
          zoom.y += event.clientY - last.y;
          last = { x: event.clientX, y: event.clientY };
          applyZoom();
        });
        for (const name of ["pointerup", "pointercancel", "pointerleave"]) {
          stage.addEventListener(name, () => { dragging = false; last = null; });
        }
      }

      function applyZoom() {
        for (const { image } of panes) {
          image.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
        }
      }

      body.append(grid);

      const loadOriginals = document.createElement("button");
      loadOriginals.type = "button";
      loadOriginals.className = "secondary smallButton compareReset";
      loadOriginals.textContent = "原寸で比較";
      loadOriginals.title = "選択した画像だけを1枚ずつ原寸へ切り替えます";
      loadOriginals.addEventListener("click", async () => {
        loadOriginals.disabled = true;
        loadOriginals.textContent = "原寸を読み込み中…";
        for (const pane of panes) {
          if (!pane.originalUrl) continue;
          pane.image.src = pane.originalUrl;
          await waitForImage(pane.image);
        }
        loadOriginals.textContent = "原寸を読み込み済み";
      });
      body.append(loadOriginals);

      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "ghost smallButton compareReset";
      reset.textContent = "ズームを戻す";
      reset.addEventListener("click", () => {
        zoom.scale = 1;
        zoom.x = 0;
        zoom.y = 0;
        applyZoom();
      });
      body.append(reset);

      body.append(buildDiffTable("設定の差分", diffSettings(items), items));
      body.append(buildDiffTable("LoRA weightの差分", diffLoras(items), items));
      body.append(buildPromptDiff(items));

      if (typeof onVote === "function") {
        const vote = document.createElement("div");
        vote.className = "compareVote";
        const heading = document.createElement("strong");
        heading.textContent = "どちらが良い？";
        vote.append(heading);
        const row = document.createElement("div");
        row.className = "compareVoteRow";
        for (const [index, entry] of items.entries()) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "secondary";
          button.textContent = items.length === 2
            ? `${labelFor(index)}が良い`
            : `${labelFor(index)}を選ぶ`;
          button.addEventListener("click", async () => {
            await onVote({ winnerImageId: entry.image.id, result: index === 0 ? "a" : "b", entries: items });
            close("voted");
          });
          row.append(button);
        }
        const draw = document.createElement("button");
        draw.type = "button";
        draw.className = "ghost";
        draw.textContent = "引き分け";
        draw.addEventListener("click", async () => {
          await onVote({ winnerImageId: null, result: "draw", entries: items });
          close("voted");
        });
        row.append(draw);
        vote.append(row);
        body.append(vote);
      }
    },
    actions: [{ label: "閉じる", value: null, primary: true }]
  }).promise;
}

function waitForImage(image) {
  if (image.complete) return Promise.resolve();
  return new Promise((resolve) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
  });
}

function labelFor(index) {
  return ["A", "B", "C", "D"][index] ?? `#${index + 1}`;
}

function buildDiffTable(title, rows, items) {
  const section = document.createElement("section");
  section.className = "compareDiff";
  const heading = document.createElement("strong");
  heading.textContent = title;
  section.append(heading);
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "uiFieldNote";
    empty.textContent = "差分はありません";
    section.append(empty);
    return section;
  }
  const table = document.createElement("div");
  table.className = "compareDiffTable";
  table.style.setProperty("--compare-count", String(items.length));
  const header = document.createElement("div");
  header.className = "compareDiffRow head";
  header.append(cell(""));
  for (const [index] of items.entries()) header.append(cell(labelFor(index)));
  table.append(header);
  for (const row of rows) {
    const line = document.createElement("div");
    line.className = "compareDiffRow";
    line.append(cell(row.label));
    for (const value of row.values) line.append(cell(value));
    table.append(line);
  }
  section.append(table);
  return section;
}

function buildPromptDiff(items) {
  const section = document.createElement("section");
  section.className = "compareDiff";
  const heading = document.createElement("strong");
  heading.textContent = "Promptの差分（Aを基準）";
  section.append(heading);
  const diffs = diffPrompts(items);
  let hasDiff = false;
  for (const [index, diff] of diffs.entries()) {
    if (index === 0) continue;
    if (!diff.added.length && !diff.removed.length) continue;
    hasDiff = true;
    const row = document.createElement("p");
    row.className = "comparePromptDiff";
    row.append(document.createTextNode(`${labelFor(index)}: `));
    if (diff.added.length) {
      const added = document.createElement("span");
      added.className = "diffAdded";
      added.textContent = `+ ${diff.added.join(", ")}`;
      row.append(added);
    }
    if (diff.removed.length) {
      const removed = document.createElement("span");
      removed.className = "diffRemoved";
      removed.textContent = `− ${diff.removed.join(", ")}`;
      row.append(removed);
    }
    section.append(row);
  }
  if (!hasDiff) {
    const empty = document.createElement("p");
    empty.className = "uiFieldNote";
    empty.textContent = "Promptは同じです";
    section.append(empty);
  }
  return section;
}

function cell(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div;
}
