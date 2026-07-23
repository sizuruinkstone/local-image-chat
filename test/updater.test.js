import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions } from "../src/updater.js";

test("セマンティックバージョンを比較する", () => {
  assert.equal(compareVersions("2.1.0", "2.0.9"), 1);
  assert.equal(compareVersions("2.1.0", "2.1.0"), 0);
  assert.equal(compareVersions("2.0.9", "2.1.0"), -1);
});
