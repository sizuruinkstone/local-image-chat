// Presentation projection only. Draft, Job, candidate and history ownership stay in R1.
export function generationView(snapshot) {
  const g = snapshot.generation;
  const runtime = snapshot.runtime.activeRuntime;
  const available = runtime && runtime.available !== false && runtime.ok !== false;
  const locked = !snapshot.ready || g.busy || snapshot.selectingModel || snapshot.reusing || snapshot.runtime.switching;
  let phase = "ready";
  if (!snapshot.ready) phase = "empty";
  else if (g.cancelRequested && g.busy) phase = "cancelling";
  else if (g.phase === "cancelled") phase = "cancelled";
  else if (g.phase === "failed" && !g.busy) phase = "error";
  else if (g.busy && !g.activeJobId) phase = "submitting";
  else if (g.busy) phase = g.job?.status === "failed" ? "recovery" : g.job?.status === "queued" ? "queued" : "generating";
  else if (snapshot.currentImage) phase = "completed";
  const labels = { empty: "Connecting", ready: "Ready", submitting: "Submitting", queued: "Queued / Preparing", generating: "Generating", completed: "Completed", error: "Error", cancelling: "Cancelling", cancelled: "Cancelled", recovery: "Recovery approval" };
  const images = snapshot.completed?.images ?? [];
  return { phase, label: labels[phase], locked, available, busy: g.busy,
    canGenerate: !locked && available && Boolean(snapshot.prompt.prompt.trim()),
    canCancel: g.busy && Boolean(g.activeJobId) && !g.cancelRequested && !["done", "failed", "cancelled"].includes(g.job?.status),
    image: snapshot.currentImage, images, index: images.findIndex((image) => image.id === snapshot.currentImage?.id),
    error: g.error, message: g.job?.message ?? "", progress: g.job?.progress };
}
