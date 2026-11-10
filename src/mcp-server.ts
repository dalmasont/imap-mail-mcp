import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { MailTools } from "./mail.ts";

const SERVER_INFO = { name: "imap-mail-mcp", version: "0.1.0" };

function json(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

const account = z
  .string()
  .email()
  .describe("Account e-mail address, as returned by list_accounts");
const folder = z
  .string()
  .optional()
  .describe('Folder name as returned by list_folders. Defaults to "INBOX"');
const uids = z
  .array(z.number().int().positive())
  .min(1)
  .max(50)
  .describe("Message UIDs from list_messages");
const date = z.iso.date().describe("YYYY-MM-DD");

export function createMcpServer(tools: MailTools): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    "list_accounts",
    {
      title: "List accounts",
      description:
        "List the configured IMAP mail accounts and whether each has its password secret set.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => json(tools.listAccounts()),
  );

  server.registerTool(
    "list_folders",
    {
      title: "List folders",
      description: "List the folders of an account and which one is the Trash.",
      inputSchema: z.object({ account }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => json(await tools.listFolders(input.account)),
  );

  server.registerTool(
    "list_messages",
    {
      title: "List or search messages",
      description:
        "List messages in a folder, newest first, headers only (no body, does not mark as read). Optional filters search on the server. `total` is how many matched; at most `limit` are returned.",
      inputSchema: z.object({
        account,
        folder,
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Default 20, max 50"),
        unreadOnly: z.boolean().optional(),
        from: z.string().optional(),
        subject: z.string().optional(),
        text: z.string().optional().describe("Search in headers and body"),
        since: date.optional(),
        before: date.optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => json(await tools.listMessages(input)),
  );

  server.registerTool(
    "get_message",
    {
      title: "Read message",
      description:
        "Read one message: headers, plain-text body (HTML converted to text) and attachment names. Does not mark it as read.",
      inputSchema: z.object({
        account,
        folder,
        uid: z.number().int().positive(),
        maxChars: z
          .number()
          .int()
          .min(500)
          .max(100000)
          .optional()
          .describe("Default 20000"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => json(await tools.getMessage(input)),
  );

  server.registerTool(
    "move_messages",
    {
      title: "Move messages",
      description:
        "Move messages to another folder (e.g. to archive). Flagged (starred) messages are never moved; they are returned in `skippedFlagged`.",
      inputSchema: z.object({
        account,
        folder,
        uids,
        toFolder: z.string().min(1),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input) => json(await tools.moveMessages(input)),
  );

  server.registerTool(
    "delete_messages",
    {
      title: "Delete messages",
      description:
        "Delete messages by moving them to the account's Trash (recoverable there). Flagged (starred) messages are never deleted; they are returned in `skippedFlagged`. Never deletes permanently.",
      inputSchema: z.object({ account, folder, uids }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (input) => json(await tools.deleteMessages(input)),
  );

  server.registerTool(
    "set_read",
    {
      title: "Mark read or unread",
      description:
        "Mark messages as read (`read: true`) or unread (`read: false`).",
      inputSchema: z.object({ account, folder, uids, read: z.boolean() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => json(await tools.setRead(input)),
  );

  return server;
}
