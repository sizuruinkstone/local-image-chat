import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  capabilitiesInputSchema,
  generateImageInputSchema,
  historyInputSchema,
  historyItemInputSchema,
  imageInputSchema,
  importReferenceImageInputSchema,
  jobInputSchema,
  regenerateImageInputSchema
} from "./schemas.js";
import { LocalImageChatError } from "./local-image-chat-client.js";
import { createAttachmentReader } from "./attachment-reader.js";

export const MCP_TOOL_NAMES = Object.freeze([
  "get_capabilities",
  "generate_image",
  "get_generation",
  "cancel_generation",
  "get_history",
  "get_history_item",
  "regenerate_image",
  "get_image",
  "import_reference_image"
]);

export function createMcpServer({ client, attachmentReader } = {}) {
  if (!client || typeof client.getCapabilities !== "function"
    || typeof client.createGeneration !== "function"
    || typeof client.getGeneration !== "function"
    || typeof client.cancelGeneration !== "function"
    || typeof client.getHistory !== "function"
    || typeof client.getHistoryItem !== "function"
    || typeof client.createRegeneration !== "function"
    || typeof client.getImage !== "function") {
    throw new Error("MCP Toolへ接続するLocal Image Chat clientが不正です");
  }

  const server = new McpServer({
    name: "local-image-chat-mcp",
    version: "1.0.0"
  });
  registerMcpTools(server, client, {
    attachmentReader: attachmentReader ?? createAttachmentReader()
  });
  return server;
}

export function registerMcpTools(server, client, { attachmentReader = createAttachmentReader() } = {}) {
  server.registerTool("get_capabilities", {
    description: "Local Image Chatで利用可能なCheckpoint、Sampler、Scheduler、LoRA、既定生成設定を取得する。runtimeIdを省略するとBackendの既定Runtimeを使う。generate_imageでCheckpointやLoRAを指定する前の確認に使用する。",
    inputSchema: capabilitiesInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }, async ({ runtimeId } = {}) => runTool(() => client.getCapabilities(runtimeId)));

  server.registerTool("generate_image", {
    description: "Local Image Chatで非同期txt2img生成を開始する。contentRatingはgeneralまたはnsfwの明示的な整理用metadataで、Promptを解析・変更しない。runtimeIdは任意で、省略時はBackendの既定Runtimeを使う。生成完了画像は待たず、Job IDとqueued状態を返す。状態と結果はget_generationで確認する。ipAdapter.referenceImageIdにはget_history_itemまたはget_imageで確認した既存画像IDを指定でき、指定を省略するとIP-Adapterは使用しない。顔・衣装・構図の完全一致は保証しない。同じrequestを自動再送しない。",
    inputSchema: generateImageInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  }, async (input) => runTool(() => client.createGeneration({
    ...input,
    mode: "txt2img",
    metadata: { client: "mcp" }
  })));

  server.registerTool("get_generation", {
    description: "generate_imageが返したJob IDの状態、0〜1の進捗、完了時のHistory IDと画像URL、失敗情報を取得する。terminal状態になるまで必要に応じて呼び出す。",
    inputSchema: jobInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }, async ({ id }) => runTool(() => client.getGeneration(id)));

  server.registerTool("cancel_generation", {
    description: "指定したLocal Image Chat Jobをキャンセルする。queuedまたはrunning Jobだけが対象で、完了済み等はBackendのJOB_NOT_CANCELLABLEを返す。",
    inputSchema: jobInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    }
  }, async ({ id }) => runTool(() => client.cancelGeneration(id)));

  server.registerTool("get_history", {
    description: "Local Image Chatの生成履歴をcursor paginationで取得する。ratingは明示保存されたgeneral、nsfw、古い履歴のunratedを絞り込む。一度に全履歴を取得せず、続きは返されたnextCursorを指定して取得する。",
    inputSchema: historyInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }, async (input) => runTool(() => client.getHistory(input)));

  server.registerTool("get_history_item", {
    description: "指定したHistory IDの安全な生成レシピ、画像、Prompt、設定、LoRA、派生元情報、使用時のIP-Adapter参照画像IDと設定を取得する。Job状態の確認にはget_generationを使い、画像URLはBackendと同一originのものだけを利用する。",
    inputSchema: historyItemInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }, async ({ id }) => runTool(() => client.getHistoryItem(id)));

  server.registerTool("regenerate_image", {
    description: "既存txt2img Historyの指定画像を元に、AI Hostが明示したPromptと任意の設定差分で新しい非同期生成を開始する。contentRatingは省略時に元履歴から継承し、Promptを解析・変更しない。runtimeIdは任意で、未指定時は元HistoryのRuntimeを継承する。ipAdapter.referenceImageIdには既存Local Image Chat画像の公開IDを指定でき、指定を省略すると元HistoryのIP-Adapterを継承せずOFFにする。顔・衣装・構図の完全一致は保証しない。instructionだけではPromptは変わらず、未指定項目は元Historyを継承する。元Historyと元画像は変更せず、新しいJob IDとqueuedだけを返すためget_generationで確認する。同じrequestを自動再送しない。",
    inputSchema: regenerateImageInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  }, async ({ historyId, ...request }) => runTool(() => client.createRegeneration(historyId, request)));

  server.registerTool("get_image", {
    description: "指定した公開image IDの軽量thumbnailをAI Hostの視覚確認用MCP image contentで返す。画像生成、画像内容の評価、Prompt修正は行わず、ユーザーへ提示するoriginal URLはget_generationまたはget_history_itemの結果を使う。",
    inputSchema: imageInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }, async ({ imageId }) => runImageTool(() => client.getImage(imageId)));

  server.registerTool("import_reference_image", {
    description: "AI Hostがユーザーのattach・paste・drop操作で実際に受け取ったローカルattachment pathだけを読み、Local Image Chatへ安全に参照画像として取り込む。pathを推測・検索・列挙せず、URL・base64・filename・任意filesystem pathは受け付けない。取り込み後は返された公開imageIdをgenerate_imageまたはregenerate_imageのipAdapter.referenceImageIdへ渡し、視覚確認が必要ならget_imageを使う。",
    inputSchema: importReferenceImageInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }, async ({ attachmentPath }) => runTool(async () => {
    const attachment = await attachmentReader.read(attachmentPath);
    if (typeof client.importReferenceImage !== "function") {
      throw new LocalImageChatError(
        "ATTACHMENT_IMPORT_NOT_CONFIGURED",
        "参照画像取り込みを利用できません",
        503
      );
    }
    return client.importReferenceImage(attachment);
  }));

  return server;
}

async function runImageTool(operation) {
  try {
    const image = await operation();
    if (!image || typeof image.imageId !== "string"
      || image.variant !== "thumbnail"
      || image.mimeType !== "image/webp"
      || !Number.isInteger(image.byteLength)
      || image.byteLength <= 0
      || !isImageBytes(image.bytes, image.byteLength)) {
      throw new LocalImageChatError(
        "LOCAL_IMAGE_CHAT_INVALID_RESPONSE",
        "画像データのresponseが不正です"
      );
    }
    const bytes = toImageBuffer(image.bytes);
    const data = bytes.toString("base64");
    const metadata = {
      imageId: image.imageId,
      variant: image.variant,
      mimeType: image.mimeType,
      byteLength: image.byteLength
    };
    return {
      content: [
        { type: "text", text: JSON.stringify(metadata) },
        { type: "image", data, mimeType: image.mimeType }
      ],
      structuredContent: metadata
    };
  } catch (error) {
    const mapped = mapToolError(error);
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({ error: mapped })
      }]
    };
  }
}

function isImageBytes(value, byteLength) {
  return (Buffer.isBuffer(value) || value instanceof Uint8Array)
    && value.byteLength === byteLength;
}

function toImageBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

async function runTool(operation) {
  try {
    const data = await operation();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(data, null, 2) ?? "null"
      }],
      structuredContent: data
    };
  } catch (error) {
    const mapped = mapToolError(error);
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({ error: mapped })
      }]
    };
  }
}

function mapToolError(error) {
  const isPublicError = error instanceof LocalImageChatError || hasPublicCode(error?.code);
  const code = isPublicError && hasPublicCode(error?.code)
    ? error.code
    : "LOCAL_IMAGE_CHAT_REQUEST_FAILED";
  const message = isPublicError && typeof error?.message === "string" && error.message.trim()
    ? safeText(error.message)
    : "Local Image Chat requestに失敗しました";
  const status = isPublicError && Number.isInteger(error?.statusCode)
    ? error.statusCode
    : isPublicError && Number.isInteger(error?.status)
      ? error.status
      : null;
  return { code, message, status };
}

function hasPublicCode(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value);
}

function safeText(value) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 500);
}
