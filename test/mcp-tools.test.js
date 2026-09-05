import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  LocalImageChatError
} from "../src/mcp/local-image-chat-client.js";
import { main as startMcpServer } from "../src/mcp/server.js";
import { createMcpServer, MCP_TOOL_NAMES } from "../src/mcp/tools.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

test("MCP Serverは9つのToolだけを登録し、descriptionとschemaを公開する", () => {
  const { server } = makeServer();
  const registered = server._registeredTools;
  assert.deepEqual(Object.keys(registered), MCP_TOOL_NAMES);
  assert.match(registered.generate_image.description, /非同期txt2img/);
  assert.match(registered.generate_image.description, /get_generation/);
  assert.match(registered.generate_image.description, /ipAdapter\.referenceImageId/);
  assert.match(registered.get_history.description, /cursor pagination/);
  assert.match(registered.get_history_item.description, /安全な生成レシピ/);
  assert.match(registered.get_history_item.description, /IP-Adapter参照画像ID/);
  assert.match(registered.regenerate_image.description, /instructionだけではPromptは変わらず/);
  assert.match(registered.regenerate_image.description, /元Historyと元画像は変更せず/);
  assert.match(registered.regenerate_image.description, /元HistoryのIP-Adapterを継承せずOFF/);
  assert.match(registered.get_image.description, /軽量thumbnail/);
  assert.match(registered.get_image.description, /画像生成/);
  assert.match(registered.import_reference_image.description, /実際に受け取ったローカルattachment path/);
  assert.match(registered.import_reference_image.description, /推測・検索・列挙せず/);
  assert.equal(registered.get_capabilities.inputSchema.safeParse({}).success, true);
  assert.equal(registered.generate_image.inputSchema.safeParse({
    prompt: { rawOverride: "keep order" }
  }).success, true);
  assert.equal(registered.generate_image.inputSchema.safeParse({
    prompt: { rawOverride: "keep order" },
    ipAdapter: {
      referenceImageId: "image-12345678",
      weight: 0,
      guidanceStart: 0,
      guidanceEnd: 1
    }
  }).success, true);
  assert.equal(registered.generate_image.inputSchema.safeParse({
    prompt: { rawOverride: "keep order" },
    ipAdapter: { referenceImageId: "image-12345678", enabled: true }
  }).success, false);
  assert.equal(registered.generate_image.inputSchema.safeParse({
    prompt: { rawOverride: "keep order" },
    ipAdapter: { referenceImageId: "image-12345678", url: "https://outside.example/image.png" }
  }).success, false);
  assert.equal(registered.generate_image.inputSchema.safeParse({
    prompt: { rawOverride: "keep order" },
    ipAdapter: { referenceImageId: "image-12345678", guidanceStart: 1, guidanceEnd: 1 }
  }).success, false);
  assert.equal(registered.generate_image.inputSchema.safeParse({
    prompt: { rawOverride: "keep order" },
    metadata: { client: "caller" }
  }).success, false);
  assert.equal(registered.generate_image.inputSchema.safeParse({
    mode: "img2img",
    prompt: { rawOverride: "keep order" }
  }).success, false);
  assert.equal(registered.get_generation.inputSchema.safeParse({ id: "bad/id" }).success, false);
  assert.equal(registered.get_history_item.inputSchema.safeParse({ id: "history-12345678" }).success, true);
  assert.equal(registered.get_image.inputSchema.safeParse({ imageId: "image-12345678" }).success, true);
  assert.equal(registered.get_image.inputSchema.safeParse({ imageId: "image/12345678" }).success, false);
  assert.equal(registered.get_image.inputSchema.safeParse({
    imageId: "image-12345678",
    variant: "thumbnail"
  }).success, false);
  assert.equal(registered.import_reference_image.inputSchema.safeParse({
    attachmentPath: "C:\\Users\\example\\Downloads\\reference.png"
  }).success, true);
  assert.equal(registered.import_reference_image.inputSchema.safeParse({
    attachmentPath: "C:\\Users\\example\\Downloads\\reference.png",
    url: "https://outside.example/reference.png"
  }).success, false);
  assert.equal(registered.import_reference_image.inputSchema.safeParse({
    attachmentPath: "C:\\Users\\example\\Downloads\\reference.png",
    base64: "AAAA"
  }).success, false);
  assert.equal(registered.regenerate_image.inputSchema.safeParse({
    historyId: "history-12345678",
    sourceImageId: "image-12345678",
    prompt: { structured: {
      character: "1girl",
      appearance: "",
      composition: "",
      situation: "",
      style: "",
      extra: ""
    } },
    instruction: "background"
  }).success, true);
  assert.equal(registered.regenerate_image.inputSchema.safeParse({
    historyId: "history-12345678",
    sourceImageId: "image-12345678",
    prompt: { structured: { character: "partial" } }
  }).success, false);
  assert.equal(registered.regenerate_image.inputSchema.safeParse({
    historyId: "history-12345678",
    sourceImageId: "image-12345678",
    metadata: { client: "caller" }
  }).success, false);
});

test("generate_imageはtxt2imgとmetadata.client=mcpを注入し、queuedだけを返す", async () => {
  const fake = makeFakeClient();
  const server = createMcpServer({ client: fake.client });
  const result = await server._registeredTools.generate_image.handler({
    prompt: { rawOverride: "unchanged, order" },
    contentRating: "nsfw",
    mode: "img2img",
    metadata: { client: "caller" },
    ipAdapter: {
      referenceImageId: "image-12345678",
      weight: 0.65,
      guidanceStart: 0,
      guidanceEnd: 1
    }
  });

  assert.deepEqual(fake.calls.createGeneration, [{
    prompt: { rawOverride: "unchanged, order" },
    contentRating: "nsfw",
    mode: "txt2img",
    ipAdapter: {
      referenceImageId: "image-12345678",
      weight: 0.65,
      guidanceStart: 0,
      guidanceEnd: 1
    },
    metadata: { client: "mcp" }
  }]);
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { id: "job-12345678", status: "queued" });
  assert.deepEqual(JSON.parse(result.content[0].text), { id: "job-12345678", status: "queued" });
});

test("get_imageはmetadataだけをtext/structuredContentへ返し、base64をimage blockへ限定する", async () => {
  const imageBytes = Buffer.from("RIFF1234WEBP", "ascii");
  const imageData = imageBytes.toString("base64");
  const fake = makeFakeClient({
    getImage: async (imageId) => {
      fake.calls.getImage.push(imageId);
      return {
        imageId,
        variant: "thumbnail",
        mimeType: "image/webp",
        byteLength: imageBytes.length,
        bytes: imageBytes
      };
    }
  });
  const server = createMcpServer({ client: fake.client });
  const result = await server._registeredTools.get_image.handler({ imageId: "image-12345678" });

  assert.equal(result.isError, undefined);
  assert.equal(result.content.length, 2);
  assert.equal(result.content[0].type, "text");
  assert.equal(result.content[1].type, "image");
  assert.equal(result.content[1].mimeType, "image/webp");
  assert.equal(result.content[1].data, imageData);
  assert.deepEqual(JSON.parse(result.content[0].text), {
    imageId: "image-12345678",
    variant: "thumbnail",
    mimeType: "image/webp",
    byteLength: 12
  });
  assert.deepEqual(result.structuredContent, JSON.parse(result.content[0].text));
  assert.doesNotMatch(result.content[0].text, new RegExp(imageData));
  assert.equal("data" in result.structuredContent, false);
  assert.deepEqual(fake.calls.getImage, ["image-12345678"]);
});

test("get_imageのBackend errorはimage blockを返さずisErrorへ変換する", async () => {
  const fake = makeFakeClient({
    getImage: async () => {
      throw new LocalImageChatError("NOT_FOUND", "画像が見つかりません", 404);
    }
  });
  const server = createMcpServer({ client: fake.client });
  const result = await server._registeredTools.get_image.handler({ imageId: "image-12345678" });

  assert.equal(result.isError, true);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(JSON.parse(result.content[0].text), {
    error: { code: "NOT_FOUND", message: "画像が見つかりません", status: 404 }
  });

  const mismatch = makeFakeClient({
    getImage: async () => ({
      imageId: "image-12345678",
      variant: "thumbnail",
      mimeType: "image/webp",
      byteLength: 13,
      bytes: Buffer.from("RIFF1234WEBP", "ascii")
    })
  });
  const mismatchServer = createMcpServer({ client: mismatch.client });
  const mismatchResult = await mismatchServer._registeredTools.get_image.handler({ imageId: "image-12345678" });
  assert.equal(mismatchResult.isError, true);
  assert.match(mismatchResult.content[0].text, /LOCAL_IMAGE_CHAT_INVALID_RESPONSE/);
});

test("import_reference_imageはHostが渡したpathだけをreaderへ渡し、公開DTOへraw bytesを出さない", async () => {
  const imageBytes = Buffer.from("raw-image-bytes");
  const fake = makeFakeClient({
    importReferenceImage: async (attachment) => {
      fake.calls.importReferenceImage.push(attachment);
      return {
        id: "asset-12345678-1234-4234-8234-123456789012",
        kind: "reference-asset",
        mimeType: "image/png",
        width: 1,
        height: 1,
        byteLength: 91,
        createdAt: "2026-08-11T00:00:00.000Z",
        originalUrl: "http://127.0.0.1:3030/api/images/asset-12345678/original",
        thumbnailUrl: "http://127.0.0.1:3030/api/images/asset-12345678/thumbnail"
      };
    }
  });
  const readerCalls = [];
  const server = createMcpServer({
    client: fake.client,
    attachmentReader: {
      read: async (attachmentPath) => {
        readerCalls.push(attachmentPath);
        return { bytes: imageBytes, mimeType: "image/png" };
      }
    }
  });
  const result = await server._registeredTools.import_reference_image.handler({
    attachmentPath: "C:\\Users\\example\\Downloads\\reference.png"
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(readerCalls, ["C:\\Users\\example\\Downloads\\reference.png"]);
  assert.equal(fake.calls.importReferenceImage.length, 1);
  assert.deepEqual(fake.calls.importReferenceImage[0], { bytes: imageBytes, mimeType: "image/png" });
  assert.equal(result.content.length, 1);
  assert.deepEqual(result.structuredContent, {
    id: "asset-12345678-1234-4234-8234-123456789012",
    kind: "reference-asset",
    mimeType: "image/png",
    width: 1,
    height: 1,
    byteLength: 91,
    createdAt: "2026-08-11T00:00:00.000Z",
    originalUrl: "http://127.0.0.1:3030/api/images/asset-12345678/original",
    thumbnailUrl: "http://127.0.0.1:3030/api/images/asset-12345678/thumbnail"
  });
  assert.doesNotMatch(result.content[0].text, /raw-image-bytes|Users|reference\.png/);
  assert.doesNotMatch(JSON.stringify(result.structuredContent), /base64|bytes|Users|reference\.png/);
});

test("MCP mainは明示envのAttachment Readerを使い、global envへfallbackしない", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-mcp-env-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const injectedRoot = path.join(workspace, "injected");
  const globalRoot = path.join(workspace, "global");
  const attachmentPath = path.join(injectedRoot, "attached.png");
  await fs.mkdir(injectedRoot, { recursive: true });
  await fs.mkdir(globalRoot, { recursive: true });
  await fs.writeFile(attachmentPath, ONE_PIXEL_PNG);

  const previousGlobalRoots = process.env.LOCAL_IMAGE_CHAT_IMPORT_ROOTS;
  process.env.LOCAL_IMAGE_CHAT_IMPORT_ROOTS = globalRoot;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let started;
  let request;
  try {
    started = await startMcpServer({
      env: {
        LOCAL_IMAGE_CHAT_URL: "http://127.0.0.1:3030",
        LOCAL_IMAGE_CHAT_IMPORT_ROOTS: injectedRoot
      },
      stdin,
      stdout,
      fetchImpl: async (url, options) => {
        request = { url: String(url), options };
        return new Response(JSON.stringify({
          id: "asset-12345678-1234-4234-8234-123456789012",
          kind: "reference-asset",
          mimeType: "image/png",
          width: 1,
          height: 1,
          byteLength: ONE_PIXEL_PNG.length,
          createdAt: "2026-08-11T00:00:00.000Z",
          originalUrl: "/api/images/asset-12345678-1234-4234-8234-123456789012/original",
          thumbnailUrl: "/api/images/asset-12345678-1234-4234-8234-123456789012/thumbnail"
        }), { status: 201, headers: { "Content-Type": "application/json" } });
      }
    });
    const result = await started.server._registeredTools.import_reference_image.handler({
      attachmentPath
    });
    assert.equal(result.isError, undefined);
    assert.equal(request.url, "http://127.0.0.1:3030/api/v1/assets/images");
    assert.equal(request.options.headers["Content-Type"], "image/png");
    assert.deepEqual(request.options.body, ONE_PIXEL_PNG);
    assert.doesNotMatch(result.content[0].text, /injected|global|attached\.png|base64/);
  } finally {
    await started?.server.close().catch(() => {});
    stdin.end();
    stdout.end();
    if (previousGlobalRoots === undefined) delete process.env.LOCAL_IMAGE_CHAT_IMPORT_ROOTS;
    else process.env.LOCAL_IMAGE_CHAT_IMPORT_ROOTS = previousGlobalRoots;
  }
});

test("get_generation、get_history、get_history_item、regenerate_imageはBackend DTOとrequestを変換する", async () => {
  const fake = makeFakeClient();
  const server = createMcpServer({ client: fake.client });
  const generation = await server._registeredTools.get_generation.handler({ id: "job-12345678" });
  const history = await server._registeredTools.get_history.handler({
    limit: 10,
    cursor: "image-12345678",
    favorites: true,
    rating: "nsfw"
  });
  const historyItem = await server._registeredTools.get_history_item.handler({ id: "history-12345678" });
  const regeneration = await server._registeredTools.regenerate_image.handler({
    historyId: "history-12345678",
    sourceImageId: "image-12345678",
    prompt: { rawOverride: "revised" },
    instruction: "audit only",
    contentRating: "general",
    ipAdapter: {
      referenceImageId: "image-reference1",
      weight: 0.7,
      guidanceStart: 0.1,
      guidanceEnd: 0.9
    }
  });

  assert.equal(generation.structuredContent.status, "running");
  assert.equal(generation.structuredContent.progress, 0.25);
  assert.equal(history.structuredContent.nextCursor, "image-12345678");
  assert.equal(history.structuredContent.hasMore, true);
  assert.equal(historyItem.structuredContent.id, "history-12345678");
  assert.deepEqual(regeneration.structuredContent, { id: "job-87654321", status: "queued" });
  assert.deepEqual(fake.calls.getGeneration, ["job-12345678"]);
  assert.deepEqual(fake.calls.getHistory, [{ limit: 10, cursor: "image-12345678", favorites: true, rating: "nsfw" }]);
  assert.deepEqual(fake.calls.getHistoryItem, ["history-12345678"]);
  assert.deepEqual(fake.calls.createRegeneration, [{
    historyId: "history-12345678",
    request: {
      sourceImageId: "image-12345678",
      prompt: { rawOverride: "revised" },
      instruction: "audit only",
      contentRating: "general",
      ipAdapter: {
        referenceImageId: "image-reference1",
        weight: 0.7,
        guidanceStart: 0.1,
        guidanceEnd: 0.9
      }
    }
  }]);
});

test("Backend errorはisError形式で返し、stackやraw exceptionを漏らさない", async () => {
  const backendError = makeFakeClient({
    getCapabilities: async () => {
      throw new LocalImageChatError("CAPABILITIES_UNAVAILABLE", "能力一覧を取得できません", 503);
    }
  });
  const backendServer = createMcpServer({ client: backendError.client });
  const backendResult = await backendServer._registeredTools.get_capabilities.handler({});
  assert.equal(backendResult.isError, true);
  assert.deepEqual(JSON.parse(backendResult.content[0].text), {
    error: {
      code: "CAPABILITIES_UNAVAILABLE",
      message: "能力一覧を取得できません",
      status: 503
    }
  });

  const unknownError = makeFakeClient({
    getCapabilities: async () => {
      throw new Error("C:\\secret\\raw stack");
    }
  });
  const unknownServer = createMcpServer({ client: unknownError.client });
  const unknownResult = await unknownServer._registeredTools.get_capabilities.handler({});
  const unknownPayload = JSON.parse(unknownResult.content[0].text);
  assert.equal(unknownResult.isError, true);
  assert.equal(unknownPayload.error.code, "LOCAL_IMAGE_CHAT_REQUEST_FAILED");
  assert.doesNotMatch(unknownResult.content[0].text, /secret|raw stack/i);
});

test("公式SDKのin-memory transportでinitialize、tools/list、get_capabilitiesを確認する", async () => {
  const fake = makeFakeClient();
  const server = createMcpServer({ client: fake.client });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "local-image-chat-mcp-test", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name), MCP_TOOL_NAMES);

  const result = await client.callTool({ name: "get_capabilities" });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, {
    checkpoints: [],
    samplers: [],
    schedulers: [],
    loras: [],
    defaults: {}
  });
  assert.equal(fake.calls.getCapabilities, 1);

  const imageResult = await client.callTool({
    name: "get_image",
    arguments: { imageId: "image-12345678" }
  });
  assert.equal(imageResult.isError, undefined);
  assert.equal(imageResult.content.length, 2);
  assert.equal(imageResult.content[1].type, "image");
  assert.equal(imageResult.content[1].mimeType, "image/webp");
  assert.equal(typeof imageResult.content[1].data, "string");
  assert.equal("data" in imageResult.structuredContent, false);
  assert.deepEqual(fake.calls.getImage, ["image-12345678"]);

  await client.close();
  await server.close();
});

function makeServer() {
  const fake = makeFakeClient();
  return { server: createMcpServer({ client: fake.client }), fake };
}

function makeFakeClient(overrides = {}) {
  const calls = {
    createGeneration: [],
    getGeneration: [],
    getHistory: [],
    getHistoryItem: [],
    createRegeneration: [],
    getCapabilities: 0,
    getImage: [],
    importReferenceImage: []
  };
  const client = {
    getCapabilities: async () => {
      calls.getCapabilities += 1;
      return { checkpoints: [], samplers: [], schedulers: [], loras: [], defaults: {} };
    },
    createGeneration: async (request) => {
      calls.createGeneration.push(request);
      return { id: "job-12345678", status: "queued" };
    },
    getGeneration: async (id) => {
      calls.getGeneration.push(id);
      return {
        id,
        status: "running",
        progress: 0.25,
        message: "running",
        result: undefined
      };
    },
    cancelGeneration: async (id) => ({ id, status: "cancelled", progress: 0 }),
    getHistory: async (input) => {
      calls.getHistory.push(input);
      return {
        generations: [],
        limit: input.limit,
        total: 1,
        nextCursor: "image-12345678",
        hasMore: true
      };
    },
    getHistoryItem: async (id) => {
      calls.getHistoryItem.push(id);
      return {
        id,
        prompt: { structured: null, rawPromptOverride: true, rawPrompt: "source" },
        settings: {},
        loras: [],
        images: []
      };
    },
    createRegeneration: async (historyId, request) => {
      calls.createRegeneration.push({ historyId, request });
      return { id: "job-87654321", status: "queued" };
    },
    getImage: async (imageId) => {
      calls.getImage.push(imageId);
      return {
        imageId,
        variant: "thumbnail",
        mimeType: "image/webp",
        byteLength: 12,
        bytes: Buffer.from("RIFF1234WEBP", "ascii")
      };
    },
    importReferenceImage: async (attachment) => {
      calls.importReferenceImage.push(attachment);
      return {
        id: "asset-12345678-1234-4234-8234-123456789012",
        kind: "reference-asset",
        mimeType: "image/png",
        width: 1,
        height: 1,
        byteLength: attachment.bytes?.byteLength ?? 1,
        createdAt: "2026-08-11T00:00:00.000Z",
        originalUrl: "http://127.0.0.1:3030/api/images/asset-12345678/original",
        thumbnailUrl: "http://127.0.0.1:3030/api/images/asset-12345678/thumbnail"
      };
    },
    ...overrides
  };
  return { client, calls };
}
