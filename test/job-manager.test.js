import assert from "node:assert/strict";
import test from "node:test";
import { createJobManager } from "../src/job-manager.js";

test("生成ジョブを同時実行せず、投入順に処理する", async () => {
  const events = [];
  const manager = createJobManager(async (payload, { report }) => {
    events.push(`start:${payload.name}`);
    report(50, `${payload.name} processing`);
    await new Promise((resolve) => setTimeout(resolve, 15));
    events.push(`end:${payload.name}`);
    return { name: payload.name };
  });

  const first = manager.create({ name: "first" });
  const second = manager.create({ name: "second" });
  await waitUntil(() => manager.get(second.id).status === "done");

  assert.deepEqual(events, ["start:first", "end:first", "start:second", "end:second"]);
  assert.equal(manager.get(first.id).progress, 100);
  assert.equal(manager.get(second.id).result.name, "second");
});

async function waitUntil(predicate) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 2000) throw new Error("job timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
