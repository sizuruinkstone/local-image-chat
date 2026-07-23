import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, dependencyInstallCommand } from "../src/updater.js";

test("セマンティックバージョンを比較する", () => {
  assert.equal(compareVersions("2.1.0", "2.0.9"), 1);
  assert.equal(compareVersions("2.1.0", "2.1.0"), 0);
  assert.equal(compareVersions("2.0.9", "2.1.0"), -1);
});

test("Windowsではnpm.cmdをcmd.exe経由で起動する", () => {
  assert.deepEqual(dependencyInstallCommand("win32", "C:\\Windows\\System32\\cmd.exe"), {
    command: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", "npm.cmd install --omit=dev --no-audit --no-fund"]
  });
});

test("Windows以外ではnpmを直接起動する", () => {
  assert.deepEqual(dependencyInstallCommand("linux"), {
    command: "npm",
    args: ["install", "--omit=dev", "--no-audit", "--no-fund"]
  });
});
