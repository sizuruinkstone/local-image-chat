// 生成失敗の原因を判定し、「安全側へ下げた設定」を1回だけ提案・再試行する。
// 無限再試行はしない（retryCountで必ず打ち切る）。

export const MAX_RETRY_COUNT = 1;

const OOM_PATTERN = /out of memory|cuda out of memory|hip out of memory|allocation on device|vram|memory allocat|torch\.(?:cuda|OutOfMemory)/i;
const TIMEOUT_PATTERN = /timeout|timed out|タイムアウト|ETIMEDOUT/i;
const NETWORK_PATTERN = /ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|fetch failed|network error|接続できません/i;
const SERVER_ERROR_PATTERN = /HTTP 5\d\d/;
const HIRES_PATTERN = /hires|upscal|hr_scale|second pass/i;

export function classifyGenerationError(error) {
  const message = String(error?.message ?? error ?? "");
  const name = String(error?.name ?? "");

  if (name === "AbortError" || /中止/.test(message)) {
    return { kind: "aborted", label: "中止", retryable: false, message: "生成を中止しました" };
  }
  if (OOM_PATTERN.test(message)) {
    return {
      kind: "oom",
      label: "VRAM不足",
      retryable: true,
      message: "VRAMが不足しました"
    };
  }
  if (name === "TimeoutError" || TIMEOUT_PATTERN.test(message)) {
    return { kind: "timeout", label: "タイムアウト", retryable: true, message: "ReForgeの応答がタイムアウトしました" };
  }
  if (NETWORK_PATTERN.test(message)) {
    return { kind: "network", label: "接続エラー", retryable: true, message: "ReForgeとの接続が切れました" };
  }
  if (SERVER_ERROR_PATTERN.test(message)) {
    // Hires中のHTTP 500はVRAM不足のことが多いので、Hiresを下げて再試行する。
    const kind = HIRES_PATTERN.test(message) ? "hires" : "server";
    return { kind, label: "ReForgeエラー", retryable: true, message: "ReForgeが一時的なエラーを返しました" };
  }
  return { kind: "unknown", label: "エラー", retryable: false, message: message || "生成に失敗しました" };
}

// 安全側の設定を作る。変更点が1つも作れない場合はnull（＝再試行しない）。
export function buildRecoveryPlan(settings, kind) {
  if (kind === "timeout" || kind === "network" || kind === "server") {
    // 設定は変えず、同じ内容でもう一度だけ試す。
    return { settings: { ...settings }, changes: [] };
  }
  if (kind !== "oom" && kind !== "hires") return null;

  const next = { ...settings };
  const changes = [];
  const record = (key, label, from, to) => {
    if (String(from) === String(to)) return;
    next[key] = to;
    changes.push({ key, label, from, to });
  };

  // 1) 候補枚数を1へ
  if (Number(next.candidateCount) > 1) record("candidateCount", "候補枚数", next.candidateCount, 1);

  if (next.hiresEnabled) {
    // 2) Hires倍率を0.2下げる
    const scale = Number(next.hiresScale) || 1.5;
    if (scale > 1.2) record("hiresScale", "Hires倍率", scale, Number((scale - 0.2).toFixed(2)));
    // 3) Hires Stepsを減らす
    const hiresSteps = Number(next.hiresSteps) || 20;
    if (hiresSteps > 12) record("hiresSteps", "Hires Steps", hiresSteps, Math.max(12, Math.floor(hiresSteps * 0.6)));
    // 5) 倍率をこれ以上下げられないならHiresを無効化
    if (!changes.length && scale <= 1.2) record("hiresEnabled", "Hires.fix", "ON", false);
  }

  // 4) それでも下げ幅が足りなければ解像度を64単位で縮小
  if (!changes.length) {
    const width = Number(next.width) || 896;
    const height = Number(next.height) || 1152;
    if (width > 512 && height > 512) {
      record("width", "幅", width, Math.max(512, width - 64));
      record("height", "高さ", height, Math.max(512, height - 64));
    }
  }

  if (!changes.length) return null;
  return { settings: next, changes };
}

export function describeRecoveryPlan(classification, plan) {
  return {
    kind: classification.kind,
    label: classification.label,
    reason: classification.message,
    changes: plan.changes.map((change) => ({
      key: change.key,
      label: change.label,
      from: String(change.from),
      to: String(change.to)
    })),
    settings: plan.settings
  };
}

// 履歴へ残す再試行情報。
export function buildRetryInfo({ originalSettings, retrySettings, classification, previousCount = 0 }) {
  return {
    retryReason: classification.kind,
    retryReasonLabel: classification.label,
    retryCount: previousCount + 1,
    retriedAt: new Date().toISOString(),
    originalSettings: pickTrackedSettings(originalSettings),
    retrySettings: pickTrackedSettings(retrySettings)
  };
}

const TRACKED_SETTING_KEYS = [
  "width", "height", "steps", "cfgScale", "candidateCount",
  "hiresEnabled", "hiresScale", "hiresSteps", "hiresDenoising"
];

function pickTrackedSettings(settings = {}) {
  const picked = {};
  for (const key of TRACKED_SETTING_KEYS) {
    if (settings[key] !== undefined) picked[key] = settings[key];
  }
  return picked;
}
