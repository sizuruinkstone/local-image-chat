import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  createLocalImageChatClient,
  MCP_DEFAULT_BASE_URL,
  MCP_DEFAULT_TIMEOUT_MS,
  resolveTimeoutMs
} from "../src/mcp/local-image-chat-client.js";

const VALID_WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x08, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20
]);

test("MCP clientはdefault URLと安全なURL設定を受け付ける", () => {
  const client = createLocalImageChatClient({ fetchImpl: async () => responseFor({}) });
  assert.equal(client.baseUrl, MCP_DEFAULT_BASE_URL);
  assert.equal(client.timeoutMs, MCP_DEFAULT_TIMEOUT_MS);
  assert.equal(createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030/",
    fetchImpl: async () => responseFor({})
  }).baseUrl, MCP_DEFAULT_BASE_URL);
  assert.equal(resolveTimeoutMs("1000"), 1000);
  assert.equal(resolveTimeoutMs("not-a-timeout"), MCP_DEFAULT_TIMEOUT_MS);

  for (const baseUrl of [
    "ftp://127.0.0.1:3030",
    "http://user:pass@127.0.0.1:3030",
    "http://127.0.0.1:3030?token=secret",
    "http://127.0.0.1:3030/#fragment",
    "http://127.0.0.1:3030/api"
  ]) {
    assert.throws(
      () => createLocalImageChatClient({ baseUrl, fetchImpl: async () => responseFor({}) }),
      (error) => error.code === "LOCAL_IMAGE_CHAT_INVALID_CONFIG"
    );
  }
});

test("MCP clientは既存7 endpointと画像取得を正しくmappingする", async () => {
  const requests = [];
  await withMockServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({ method: request.method, url: request.url, body });
    const path = new URL(request.url, "http://mock").pathname;
    if (path === "/api/v1/capabilities") {
      return sendJson(response, 200, {
        checkpoints: [],
        samplers: ["Euler a"],
        schedulers: ["Automatic"],
        loras: [],
        defaults: { width: 512 }
      });
    }
    if (path === "/api/v1/generations" && request.method === "POST") {
      return sendJson(response, 202, { id: "job-12345678", status: "queued" });
    }
    if (path === "/api/v1/generations/job-12345678" && request.method === "GET") {
      return sendJson(response, 200, {
        id: "job-12345678",
        status: "done",
        progress: 1,
        result: {
          historyId: "history-12345678",
          images: [{
            id: "image-12345678",
            originalUrl: "/api/images/image-12345678/original",
            thumbnailUrl: "/api/images/image-12345678/thumbnail"
          }]
        }
      });
    }
    if (path === "/api/v1/generations/job-12345678/cancel" && request.method === "POST") {
      return sendJson(response, 200, { id: "job-12345678", status: "cancelled", progress: 0 });
    }
    if (path === "/api/v1/history" && request.method === "GET") {
      return sendJson(response, 200, {
        generations: [{
          id: "history-12345678",
          images: [{
            id: "image-12345678",
            originalUrl: "/api/images/image-12345678/original",
            thumbnailUrl: "/api/images/image-12345678/thumbnail"
          }]
        }],
        limit: 10,
        total: 1,
        nextCursor: null,
        hasMore: false
      });
    }
    if (path === "/api/v1/history/history-12345678" && request.method === "GET") {
      return sendJson(response, 200, {
        id: "history-12345678",
        createdAt: "2026-08-10T00:00:00.000Z",
        mode: "txt2img",
        prompt: {
          structured: null,
          rawPromptOverride: true,
          rawPrompt: "keep order",
          effectivePrompt: "keep order",
          negativePrompt: ""
        },
        settings: { checkpoint: "checkpoint-x", width: 512, height: 512, steps: 20, seed: 4 },
        loras: [],
        ipAdapter: {
          referenceImageId: "image-reference1",
          weight: 0.65,
          guidanceStart: 0,
          guidanceEnd: 1
        },
        images: [{
          id: "image-12345678",
          seed: 4,
          originalUrl: "/api/images/image-12345678/original",
          thumbnailUrl: "/api/images/image-12345678/thumbnail"
        }],
        parentGenerationId: null,
        parentImageId: null,
        derivation: null
      });
    }
    if (path === "/api/v1/history/history-12345678/regenerations" && request.method === "POST") {
      return sendJson(response, 202, { id: "job-87654321", status: "queued" });
    }
    if (path === "/api/images/image-12345678/thumbnail" && request.method === "GET") {
      assert.equal(request.headers.accept, "image/webp");
      return sendImage(response, 200, VALID_WEBP, "image/webp; charset=binary");
    }
    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "not found" } });
  }, async (baseUrl) => {
    const client = createLocalImageChatClient({ baseUrl, timeoutMs: 1000 });
    assert.deepEqual((await client.getCapabilities()).samplers, ["Euler a"]);
    assert.deepEqual(await client.createGeneration({
      prompt: { rawOverride: "keep order" },
      ipAdapter: {
        referenceImageId: "image-reference1",
        weight: 0.65,
        guidanceStart: 0,
        guidanceEnd: 1
      }
    }), {
      id: "job-12345678",
      status: "queued"
    });

    const generation = await client.getGeneration("job-12345678");
    assert.equal(generation.status, "done");
    assert.equal(generation.progress, 1);
    assert.equal(generation.result.images[0].originalUrl, `${baseUrl}/api/images/image-12345678/original`);
    assert.equal(generation.result.images[0].thumbnailUrl, `${baseUrl}/api/images/image-12345678/thumbnail`);

    assert.equal((await client.cancelGeneration("job-12345678")).status, "cancelled");
    const history = await client.getHistory({
      limit: 10,
      cursor: "image-12345678",
      favorites: true,
      rating: "nsfw"
    });
    assert.equal(history.hasMore, false);
    assert.equal(history.generations[0].images[0].thumbnailUrl, `${baseUrl}/api/images/image-12345678/thumbnail`);

    const item = await client.getHistoryItem("history-12345678");
    assert.equal(item.id, "history-12345678");
    assert.equal(item.prompt.rawPromptOverride, true);
    assert.equal("rawOverride" in item.prompt, false);
    assert.deepEqual(item.ipAdapter, {
      referenceImageId: "image-reference1",
      weight: 0.65,
      guidanceStart: 0,
      guidanceEnd: 1
    });
    assert.equal(item.images[0].originalUrl, `${baseUrl}/api/images/image-12345678/original`);
    const regenerated = await client.createRegeneration("history-12345678", {
      historyId: "should-not-be-sent",
      sourceImageId: "image-12345678",
      prompt: { rawOverride: "revised" },
      ipAdapter: {
        referenceImageId: "image-reference1",
        weight: 0.7,
        guidanceStart: 0.1,
        guidanceEnd: 0.9
      },
      metadata: { client: "caller" }
    });
    assert.deepEqual(regenerated, { id: "job-87654321", status: "queued" });
    assert.deepEqual(await client.getImage("image-12345678"), {
      imageId: "image-12345678",
      variant: "thumbnail",
      mimeType: "image/webp",
      byteLength: VALID_WEBP.length,
      bytes: VALID_WEBP
    });

    const capabilityRequest = requests.find((item) => item.url === "/api/v1/capabilities");
    assert.deepEqual(capabilityRequest, {
      method: "GET",
      url: "/api/v1/capabilities",
      body: null
    });
    const generationRequest = requests.find((item) => item.url === "/api/v1/generations");
    assert.equal(generationRequest.method, "POST");
    assert.deepEqual(generationRequest.body, {
      prompt: { rawOverride: "keep order" },
      ipAdapter: {
        referenceImageId: "image-reference1",
        weight: 0.65,
        guidanceStart: 0,
        guidanceEnd: 1
      }
    });
    const historyRequest = requests.find((item) => item.url.startsWith("/api/v1/history"));
    const query = new URL(`http://mock${historyRequest.url}`).searchParams;
    assert.equal(query.get("limit"), "10");
    assert.equal(query.get("cursor"), "image-12345678");
    assert.equal(query.get("favorites"), "1");
    assert.equal(query.get("rating"), "nsfw");
    const itemRequest = requests.find((entry) => entry.url === "/api/v1/history/history-12345678");
    assert.deepEqual(itemRequest, {
      method: "GET",
      url: "/api/v1/history/history-12345678",
      body: null
    });
    const regenerationRequest = requests.find((entry) => entry.url === "/api/v1/history/history-12345678/regenerations");
    assert.equal(regenerationRequest.method, "POST");
    assert.deepEqual(regenerationRequest.body, {
      sourceImageId: "image-12345678",
      prompt: { rawOverride: "revised" },
      ipAdapter: {
        referenceImageId: "image-reference1",
        weight: 0.7,
        guidanceStart: 0.1,
        guidanceEnd: 0.9
      },
      metadata: { client: "mcp" }
    });
    const imageRequest = requests.find((entry) => entry.url === "/api/images/image-12345678/thumbnail");
    assert.deepEqual(imageRequest, {
      method: "GET",
      url: "/api/images/image-12345678/thumbnail",
      body: null
    });
  });
});

test("MCP clientのimportReferenceImageはbase64 JSONではなくraw bytesを送信し、asset DTOを検証する", async () => {
  const requests = [];
  const sourceBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await withMockServer(async (request, response) => {
    const body = await readRawBody(request);
    requests.push({
      method: request.method,
      url: request.url,
      contentType: request.headers["content-type"],
      body
    });
    if (request.url === "/api/v1/assets/images") {
      return sendJson(response, 201, {
        id: "asset-12345678-1234-4234-8234-123456789012",
        kind: "reference-asset",
        mimeType: "image/png",
        width: 1,
        height: 1,
        byteLength: 91,
        createdAt: "2026-08-11T00:00:00.000Z",
        originalUrl: "/api/images/asset-12345678-1234-4234-8234-123456789012/original",
        thumbnailUrl: "/api/images/asset-12345678-1234-4234-8234-123456789012/thumbnail"
      });
    }
    return sendJson(response, 404, { error: { code: "NOT_FOUND", message: "not found" } });
  }, async (baseUrl) => {
    const client = createLocalImageChatClient({ baseUrl, timeoutMs: 1000 });
    const asset = await client.importReferenceImage({ bytes: sourceBytes, mimeType: "image/png" });
    assert.equal(asset.id, "asset-12345678-1234-4234-8234-123456789012");
    assert.equal(asset.originalUrl, `${baseUrl}/api/images/asset-12345678-1234-4234-8234-123456789012/original`);
    assert.equal(asset.thumbnailUrl, `${baseUrl}/api/images/asset-12345678-1234-4234-8234-123456789012/thumbnail`);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].contentType, "image/png");
    assert.deepEqual(requests[0].body, sourceBytes);
    assert.equal(requests[0].body.toString("base64").includes("sourceBytes"), false);
  });

  const malformed = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    fetchImpl: async () => responseFor({
      id: "asset-12345678",
      kind: "reference-asset",
      mimeType: "image/png",
      width: 1,
      height: 1,
      byteLength: 1,
      createdAt: "2026-08-11T00:00:00.000Z",
      originalUrl: "C:\\secret\\original.png",
      thumbnailUrl: "/api/images/asset-12345678/thumbnail"
    }, 201)
  });
  await assert.rejects(
    malformed.importReferenceImage({ bytes: sourceBytes, mimeType: "image/png" }),
    (error) => error.code === "LOCAL_IMAGE_CHAT_INVALID_RESPONSE"
  );
});

test("MCP clientのgetImageは不正Image IDと任意URLを受け付けない", async () => {
  let requestCount = 0;
  const client = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    fetchImpl: async () => {
      requestCount += 1;
      return responseForImage(VALID_WEBP);
    }
  });
  for (const imageId of [
    "",
    "short",
    "image/12345678",
    "image\\12345678",
    "../image-12345678",
    "C:/secret/image-12345678",
    "\\\\server\\share\\image-12345678",
    "image-12345678?token=secret",
    "image-12345678#fragment",
    "https://outside.example/image-12345678"
  ]) {
    await assert.rejects(() => client.getImage(imageId), (error) => {
      assert.equal(error.code, "INVALID_REQUEST");
      return true;
    });
  }
  assert.equal(requestCount, 0);
});

test("MCP clientのgetImageはWebP MIME、0 byte、RIFF/WEBP headerを検証する", async () => {
  for (const scenario of [
    { name: "missing MIME", contentType: null, body: VALID_WEBP },
    { name: "PNG MIME", contentType: "image/png", body: VALID_WEBP },
    { name: "empty body", contentType: "image/webp", body: Buffer.alloc(0) },
    { name: "broken header", contentType: "image/webp", body: Buffer.from("not-webp") },
    { name: "wrong RIFF form", contentType: "image/webp", body: Buffer.from("RIFF1234NOPE", "ascii") }
  ]) {
    const client = createLocalImageChatClient({
      baseUrl: "http://127.0.0.1:3030",
      fetchImpl: async () => responseForImage(scenario.body, {
        contentType: scenario.contentType,
        contentLength: scenario.body.length
      })
    });
    await assert.rejects(() => client.getImage("image-12345678"), (error) => {
      assert.equal(error.code, "LOCAL_IMAGE_CHAT_INVALID_RESPONSE", scenario.name);
      assert.doesNotMatch(error.message, /not-webp|RIFF|base64/i);
      return true;
    });
  }
});

test("MCP clientのgetImageは404/422のBackend errorを保持する", async () => {
  for (const scenario of [
    { status: 404, code: "NOT_FOUND", message: "画像が見つかりません" },
    { status: 422, code: "INVALID_IMAGE", message: "画像IDが不正です" }
  ]) {
    await withMockServer(async (request, response) => {
      assert.equal(request.url, "/api/images/image-12345678/thumbnail");
      sendJson(response, scenario.status, { error: { code: scenario.code, message: scenario.message } });
    }, async (baseUrl) => {
      const client = createLocalImageChatClient({ baseUrl, timeoutMs: 1000 });
      await assert.rejects(() => client.getImage("image-12345678"), (error) => {
        assert.equal(error.code, scenario.code);
        assert.equal(error.status, scenario.status);
        assert.equal(error.message, scenario.message);
        return true;
      });
    });
  }
});

test("MCP clientのgetImageはContent-Lengthとstream累積byte数の2MiB上限を強制する", async () => {
  const maximum = 2 * 1024 * 1024;
  let readBeforeHeaderReject = false;
  const headerTooLarge = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    fetchImpl: async () => responseForImage(VALID_WEBP, {
      contentLength: maximum + 1,
      body: {
        getReader: () => ({
          read: () => {
            readBeforeHeaderReject = true;
            throw new Error("body should not be read");
          },
          cancel: async () => {},
          releaseLock: () => {}
        })
      }
    })
  });
  await assert.rejects(() => headerTooLarge.getImage("image-12345678"), (error) => {
    assert.equal(error.code, "LOCAL_IMAGE_CHAT_PAYLOAD_TOO_LARGE");
    assert.equal(error.status, 413);
    return true;
  });
  assert.equal(readBeforeHeaderReject, false);

  const streamTooLarge = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    fetchImpl: async () => responseForImage(Buffer.alloc(maximum + 1), {
      contentLength: null
    })
  });
  await assert.rejects(() => streamTooLarge.getImage("image-12345678"), (error) => {
    assert.equal(error.code, "LOCAL_IMAGE_CHAT_PAYLOAD_TOO_LARGE");
    assert.equal(error.status, 413);
    return true;
  });
});

test("MCP clientのgetImageはheader前後timeout、redirect、別originを安全に拒否する", async () => {
  let requestCount = 0;
  let seenOptions;
  const redirectClient = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    timeoutMs: 1000,
    fetchImpl: async (_url, options) => {
      requestCount += 1;
      seenOptions = options;
      return responseForImage(VALID_WEBP, { status: 302 });
    }
  });
  await assert.rejects(() => redirectClient.getImage("image-12345678"), (error) => {
    assert.equal(error.code, "LOCAL_IMAGE_CHAT_REQUEST_FAILED");
    return true;
  });
  assert.equal(seenOptions.redirect, "error");
  assert.equal(seenOptions.headers.Accept, "image/webp");
  assert.equal(requestCount, 1);

  const outsideOriginClient = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    fetchImpl: async () => responseForImage(VALID_WEBP, {
      url: "https://outside.example/api/images/image-12345678/thumbnail"
    })
  });
  await assert.rejects(() => outsideOriginClient.getImage("image-12345678"), (error) => {
    assert.equal(error.code, "LOCAL_IMAGE_CHAT_REQUEST_FAILED");
    return true;
  });
});

test("MCP clientのgetImageはbody stallをtimeoutし、自動retryしない", async () => {
  let requestCount = 0;
  let aborted = false;
  const client = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    timeoutMs: 1000,
    fetchImpl: async (_url, { signal }) => {
      requestCount += 1;
      signal.addEventListener("abort", () => {
        aborted = true;
      }, { once: true });
      return responseForImage(null, {
        contentLength: null,
        body: {
          getReader: () => ({
            read: () => new Promise(() => {}),
            cancel: async () => {},
            releaseLock: () => {}
          })
        }
      });
    }
  });
  await assert.rejects(() => client.getImage("image-12345678"), (error) => {
    assert.equal(error.code, "LOCAL_IMAGE_CHAT_TIMEOUT");
    return true;
  });
  assert.equal(aborted, true);
  assert.equal(requestCount, 1);
});

test("MCP clientはfavorites falseをqueryへ追加せずcursorを一度だけencodeする", async () => {
  let requestUrl = "";
  await withMockServer(async (request, response) => {
    requestUrl = request.url;
    sendJson(response, 200, { generations: [], nextCursor: null, hasMore: false });
  }, async (baseUrl) => {
    const client = createLocalImageChatClient({ baseUrl, timeoutMs: 1000 });
    await client.getHistory({ cursor: "cursor-12345678", favorites: false });
    const query = new URL(`http://mock${requestUrl}`).searchParams;
    assert.equal(query.get("cursor"), "cursor-12345678");
    assert.equal(query.has("favorites"), false);
  });
});

test("MCP clientはBackend error code/statusを保持し、500詳細を隠す", async () => {
  for (const scenario of [
    { status: 400, code: "INVALID_REQUEST", message: "入力が不正です", expectedMessage: "入力が不正です" },
    { status: 404, code: "NOT_FOUND", message: "見つかりません", expectedMessage: "見つかりません" },
    { status: 409, code: "JOB_NOT_CANCELLABLE", message: "キャンセルできません", expectedMessage: "キャンセルできません" },
    { status: 500, code: "INTERNAL_ERROR", message: "C:\\secret\\stack", expectedMessage: "Local Image Chat Backendの処理に失敗しました" }
  ]) {
    await withMockServer(async (_request, response) => {
      sendJson(response, scenario.status, { error: { code: scenario.code, message: scenario.message } });
    }, async (baseUrl) => {
      const client = createLocalImageChatClient({ baseUrl, timeoutMs: 1000 });
      await assert.rejects(() => client.getCapabilities(), (error) => {
        assert.equal(error.code, scenario.code);
        assert.equal(error.status, scenario.status);
        assert.equal(error.message, scenario.expectedMessage);
        assert.doesNotMatch(error.message, /secret|stack/i);
        return true;
      });
    });
  }
});

test("MCP clientは接続失敗とtimeoutを専用errorへ変換する", async () => {
  const unavailable = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:65530",
    timeoutMs: 1000
  });
  await assert.rejects(() => unavailable.getCapabilities(), (error) => {
    assert.equal(error.code, "LOCAL_IMAGE_CHAT_UNAVAILABLE");
    assert.equal(error.status, null);
    return true;
  });

  const timeoutClient = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    timeoutMs: 1000,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });
  await assert.rejects(() => timeoutClient.getCapabilities(), (error) => {
    assert.equal(error.code, "LOCAL_IMAGE_CHAT_TIMEOUT");
    return true;
  });
});

test("MCP clientはresponse header後のbody stallにもtimeoutを適用し、自動再送しない", async () => {
  let requestCount = 0;
  let aborted = false;
  const client = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    timeoutMs: 1000,
    fetchImpl: async (_url, { signal }) => {
      requestCount += 1;
      return {
        status: 200,
        ok: true,
        url: "http://127.0.0.1:3030/api/v1/capabilities",
        text: () => new Promise(() => {
          signal.addEventListener("abort", () => {
            aborted = true;
          }, { once: true });
        })
      };
    }
  });

  await assert.rejects(() => client.getCapabilities(), (error) => {
    assert.equal(error.code, "LOCAL_IMAGE_CHAT_TIMEOUT");
    assert.doesNotMatch(error.message, /127\.0\.0\.1|stack|raw/i);
    return true;
  });
  assert.equal(aborted, true);
  assert.equal(requestCount, 1);
});

test("MCP clientはmalformed JSONと不正DTOをinvalid responseへ変換する", async () => {
  const malformed = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    fetchImpl: async () => responseFor("not-json")
  });
  await assert.rejects(() => malformed.getCapabilities(), (error) => {
    assert.equal(error.code, "LOCAL_IMAGE_CHAT_INVALID_RESPONSE");
    return true;
  });

  const invalidDto = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    fetchImpl: async () => responseFor({ capabilities: [] })
  });
  await assert.rejects(() => invalidDto.getCapabilities(), (error) => {
    assert.equal(error.code, "LOCAL_IMAGE_CHAT_INVALID_RESPONSE");
    return true;
  });

  const invalidHistoryItem = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    fetchImpl: async () => responseFor({ id: "history-12345678", images: [] })
  });
  await assert.rejects(() => invalidHistoryItem.getHistoryItem("history-12345678"), (error) => {
    assert.equal(error.code, "LOCAL_IMAGE_CHAT_INVALID_RESPONSE");
    return true;
  });

  const aliasedHistoryItem = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    fetchImpl: async () => responseFor({
      id: "history-12345678",
      prompt: {
        structured: null,
        rawPromptOverride: true,
        rawOverride: true,
        rawPrompt: "",
        effectivePrompt: "",
        negativePrompt: ""
      },
      settings: {},
      loras: [],
      images: []
    })
  });
  await assert.rejects(() => aliasedHistoryItem.getHistoryItem("history-12345678"), (error) => {
    assert.equal(error.code, "LOCAL_IMAGE_CHAT_INVALID_RESPONSE");
    return true;
  });

  const unsafeIpAdapter = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    fetchImpl: async () => responseFor({
      id: "history-12345678",
      prompt: {
        structured: null,
        rawPromptOverride: true,
        rawPrompt: "",
        effectivePrompt: "",
        negativePrompt: ""
      },
      settings: {},
      loras: [],
      images: [],
      ipAdapter: {
        referenceImageId: "image-reference1",
        url: "https://outside.example/reference.png",
        weight: 0.65,
        guidanceStart: 0,
        guidanceEnd: 1
      }
    })
  });
  await assert.rejects(() => unsafeIpAdapter.getHistoryItem("history-12345678"), (error) => {
    assert.equal(error.code, "LOCAL_IMAGE_CHAT_INVALID_RESPONSE");
    return true;
  });

  const legacyHistoryItem = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    fetchImpl: async () => responseFor({
      id: "history-12345678",
      prompt: {
        structured: null,
        rawPromptOverride: false,
        rawPrompt: "",
        effectivePrompt: "",
        negativePrompt: ""
      },
      settings: {},
      loras: [],
      images: [],
      ipAdapter: null
    })
  });
  assert.equal((await legacyHistoryItem.getHistoryItem("history-12345678")).ipAdapter, null);
});

test("MCP clientは外部origin、data、file、protocol-relative画像URLを拒否する", async () => {
  for (const imageUrl of [
    "https://outside.example/image.png",
    "data:image/png;base64,AA==",
    "file:///C:/secret/image.png",
    "//outside.example/image.png",
    ""
  ]) {
    const client = createLocalImageChatClient({
      baseUrl: "http://127.0.0.1:3030",
      fetchImpl: async () => responseFor({
        id: "job-12345678",
        status: "done",
        progress: 1,
        result: { historyId: "history-12345678", images: [{ id: "image-12345678", originalUrl: imageUrl }] }
      })
    });
    await assert.rejects(() => client.getGeneration("job-12345678"), (error) => {
      assert.equal(error.code, "LOCAL_IMAGE_CHAT_INVALID_RESPONSE");
      return true;
    });
  }
});

test("MCP clientはredirectを追従せず、最終originも検証する", async () => {
  let seenOptions;
  const client = createLocalImageChatClient({
    baseUrl: "http://127.0.0.1:3030",
    fetchImpl: async (_url, options) => {
      seenOptions = options;
      return {
        status: 302,
        ok: false,
        url: "http://127.0.0.1:3030/api/v1/capabilities",
        text: async () => ""
      };
    }
  });
  await assert.rejects(() => client.getCapabilities(), (error) => {
    assert.equal(error.code, "LOCAL_IMAGE_CHAT_REQUEST_FAILED");
    return true;
  });
  assert.equal(seenOptions.redirect, "error");
});

async function withMockServer(handler, callback) {
  const server = http.createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: { code: "INTERNAL_ERROR", message: "mock failure" } });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readRawBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function sendImage(response, status, body, contentType = "image/webp") {
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", String(body.length));
  response.end(body);
}

function responseForImage(body, options = {}) {
  const status = options.status ?? 200;
  const contentType = options.contentType === undefined ? "image/webp" : options.contentType;
  const contentLength = Object.hasOwn(options, "contentLength")
    ? options.contentLength
    : (body instanceof Uint8Array ? body.byteLength : null);
  const headers = new Headers();
  if (contentType !== null) headers.set("Content-Type", contentType);
  if (contentLength !== null) headers.set("Content-Length", String(contentLength));
  const bytes = body instanceof Uint8Array ? body : Buffer.alloc(0);
  return {
    status,
    ok: status >= 200 && status < 300,
    url: options.url ?? "http://127.0.0.1:3030/api/images/image-12345678/thumbnail",
    headers,
    body: options.body ?? streamFromChunks([bytes]),
    text: async () => ""
  };
}

function streamFromChunks(chunks) {
  let index = 0;
  return {
    getReader: () => ({
      read: async () => index < chunks.length
        ? { done: false, value: chunks[index++] }
        : { done: true, value: undefined },
      cancel: async () => {},
      releaseLock: () => {}
    })
  };
}

function responseFor(body, status = 200, baseUrl = "http://127.0.0.1:3030") {
  return {
    status,
    ok: status >= 200 && status < 300,
    url: `${baseUrl}/api/v1/capabilities`,
    text: async () => typeof body === "string" ? body : JSON.stringify(body)
  };
}
