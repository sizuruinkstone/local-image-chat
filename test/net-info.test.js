import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  describeBinding,
  isLoopbackHost,
  listLanUrls,
  resolveServerBinding
} from "../src/net-info.js";

const INTERFACES = {
  "Loopback Pseudo-Interface 1": [
    { address: "127.0.0.1", family: "IPv4", internal: true },
    { address: "::1", family: "IPv6", internal: true }
  ],
  "Wi-Fi": [
    { address: "192.168.1.23", family: "IPv4", internal: false },
    { address: "fe80::1", family: "IPv6", internal: false }
  ],
  Tailscale: [{ address: "100.101.102.103", family: "IPv4", internal: false }]
};

test("既定はPC内だけ（127.0.0.1）", () => {
  const binding = resolveServerBinding();
  assert.deepEqual(binding, { host: DEFAULT_HOST, port: DEFAULT_PORT, exposed: false });
  assert.equal(resolveServerBinding({ config: { port: 3099 } }).port, 3099);
});

test("環境変数はconfigより優先される", () => {
  const binding = resolveServerBinding({
    env: { LOCAL_IMAGE_CHAT_HOST: "0.0.0.0", LOCAL_IMAGE_CHAT_PORT: "4000" },
    config: { host: "127.0.0.1", port: 3030 }
  });
  assert.deepEqual(binding, { host: "0.0.0.0", port: 4000, exposed: true });
});

test("不正なホスト・ポートは既定値へ戻す", () => {
  assert.equal(resolveServerBinding({ env: { LOCAL_IMAGE_CHAT_HOST: "0.0.0.0 --evil" } }).host, DEFAULT_HOST);
  assert.equal(resolveServerBinding({ env: { LOCAL_IMAGE_CHAT_PORT: "0" } }).port, DEFAULT_PORT);
  assert.equal(resolveServerBinding({ env: { LOCAL_IMAGE_CHAT_PORT: "99999" } }).port, DEFAULT_PORT);
  assert.equal(resolveServerBinding({ env: { LOCAL_IMAGE_CHAT_PORT: "abc" } }).port, DEFAULT_PORT);
  assert.equal(resolveServerBinding({ config: { host: "" } }).host, DEFAULT_HOST);
});

test("ループバック判定", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.equal(isLoopbackHost("192.168.1.23"), false);
});

test("LAN内から開くURLを列挙する（内部インターフェースとIPv6は除く）", () => {
  assert.deepEqual(listLanUrls(3030, INTERFACES), [
    "http://192.168.1.23:3030",
    "http://100.101.102.103:3030"
  ]);
  assert.deepEqual(listLanUrls(3030, {}), []);
});

test("起動ログはPC内のみか外部から見えるかを説明する", () => {
  const local = describeBinding({ host: "127.0.0.1", port: 3030 }, INTERFACES);
  assert.match(local[0], /このPCからのみ/);
  assert.match(local[1], /LOCAL_IMAGE_CHAT_HOST=0\.0\.0\.0/);

  const exposed = describeBinding({ host: "0.0.0.0", port: 3030 }, INTERFACES);
  assert.equal(exposed[0], "http://127.0.0.1:3030");
  assert.match(exposed[1], /192\.168\.1\.23:3030/);
  assert.match(exposed[2], /100\.101\.102\.103:3030/);
  // ログイン機能が無いことを起動時に知らせる
  assert.match(exposed.at(-1), /ログイン機能はありません/);
});
