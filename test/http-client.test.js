import assert from "node:assert/strict";
import test from "node:test";
import { getJson, postJson, patchJson, deleteJson } from "../public/core/http-client.js";

const url = "/api/jobs?runtimeId=forge-neo-anima&cursor=a%2Fb";
const body = { prompt: "日本語\n\"quoted\"", settings: { seed: "-1" }, missing: undefined };
const serializedBody = '{"prompt":"日本語\\n\\"quoted\\"","settings":{"seed":"-1"}}';
const helpers = [
  { name: "GET", invoke: () => getJson(url), args: [url] },
  { name: "POST", invoke: () => postJson(url, body), args: [url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: serializedBody
  }] },
  { name: "PATCH", invoke: () => patchJson(url, body), args: [url, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: serializedBody
  }] },
  { name: "DELETE", invoke: () => deleteJson(url), args: [url, { method: "DELETE" }] }
];

function mockResponse(t, helper, { ok = true, status = 200, data, parseError } = {}) {
  const events = [];
  const response = {
    get ok() { events.push("ok"); return ok; },
    status,
    json: t.mock.fn(async () => {
      events.push("json");
      if (parseError) throw parseError;
      return data;
    })
  };
  const fetch = t.mock.method(globalThis, "fetch", async () => response);
  t.after(() => {
    assert.equal(fetch.mock.callCount(), 1, "requests must never retry implicitly");
    assert.deepEqual(fetch.mock.calls[0].arguments, helper.args);
    assert.equal(response.json.mock.callCount(), 1);
    assert.deepEqual(events, parseError ? ["json"] : ["json", "ok"]);
  });
}

for (const helper of helpers) {
  test(`${helper.name}: preserves URL, method, headers, body and parsed response`, async (t) => {
    const data = { job: { id: "job-1", status: "queued" } };
    mockResponse(t, helper, { data });
    assert.strictEqual(await helper.invoke(), data);
  });

  test(`${helper.name}: successful JSON null remains null`, async (t) => {
    mockResponse(t, helper, { data: null });
    assert.strictEqual(await helper.invoke(), null);
  });

  for (const [label, data, message] of [
    ["backend error", { error: "生成に失敗しました" }, "生成に失敗しました"],
    ["missing error fallback", {}, "HTTP 503"],
    ["null error fallback", { error: null }, "HTTP 503"],
    ["empty error without fallback", { error: "" }, ""],
    ["false error without fallback", { error: false }, "false"],
    ["legacy object coercion", { error: { code: "FAILED" } }, "[object Object]"]
  ]) {
    test(`${helper.name}: ${label}, no retry`, async (t) => {
      mockResponse(t, helper, { ok: false, status: 503, data });
      await assert.rejects(helper.invoke(), (error) => {
        assert.strictEqual(error.constructor, Error);
        assert.equal(error.message, message);
        return true;
      });
    });
  }

  for (const status of [200, 503]) {
    test(`${helper.name}: JSON parse rejection precedes HTTP handling (${status}), no retry`, async (t) => {
      const parseError = new SyntaxError("invalid JSON");
      mockResponse(t, helper, { ok: status === 200, status, parseError });
      await assert.rejects(helper.invoke(), (error) => error === parseError);
    });
  }

  test(`${helper.name}: network rejection passes through unchanged, no retry`, async (t) => {
    const networkError = new TypeError("network unavailable");
    const fetch = t.mock.method(globalThis, "fetch", async () => { throw networkError; });
    await assert.rejects(helper.invoke(), (error) => error === networkError);
    assert.equal(fetch.mock.callCount(), 1);
    assert.deepEqual(fetch.mock.calls[0].arguments, helper.args);
  });
}

for (const [name, helper] of [["POST", postJson], ["PATCH", patchJson]]) {
  test(`${name}: undefined body uses JSON.stringify semantics`, async (t) => {
    const response = { ok: true, json: async () => ({}) };
    const fetch = t.mock.method(globalThis, "fetch", async () => response);
    await helper(url);
    assert.equal(fetch.mock.callCount(), 1);
    assert.deepEqual(fetch.mock.calls[0].arguments, [url, {
      method: name, headers: { "Content-Type": "application/json" }, body: undefined
    }]);
  });

  test(`${name}: serialization failure rejects before any request`, async (t) => {
    const serializationError = new Error("serialization failed");
    const fetch = t.mock.method(globalThis, "fetch", async () => {
      assert.fail("serialization failure must not send a request");
    });
    await assert.rejects(helper(url, { toJSON() { throw serializationError; } }),
      (error) => error === serializationError);
    assert.equal(fetch.mock.callCount(), 0);
  });
}
