import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createLocalImageChatClient,
  LocalImageChatError
} from "./local-image-chat-client.js";
import { createAttachmentReader } from "./attachment-reader.js";
import { createMcpServer } from "./tools.js";

export { createMcpServer };

export async function main({ env = process.env, stdin, stdout, fetchImpl } = {}) {
  const client = createLocalImageChatClient({ env, fetchImpl });
  const attachmentReader = createAttachmentReader({ env });
  const server = createMcpServer({ client, attachmentReader });
  const transport = new StdioServerTransport(stdin, stdout);
  await server.connect(transport);
  return { server, transport };
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

function safeStartupMessage(error) {
  if (error instanceof LocalImageChatError && typeof error.message === "string") {
    return error.message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
  }
  return "MCP Serverの起動に失敗しました";
}

if (isEntrypoint()) {
  main().catch((error) => {
    console.error(`[MCP] ${safeStartupMessage(error)}`);
    process.exitCode = 1;
  });
}
