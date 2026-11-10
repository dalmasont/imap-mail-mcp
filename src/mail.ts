/**
 * Mail tool logic over IMAP. Pure of Cloudflare specifics: a `Connector`
 * opens an authenticated session for an account, so tests can fake it.
 */

export type Account = { email: string; secret: string };

export type MessageSummary = {
  uid: number;
  date: string;
  from: string[];
  to: string[];
  subject: string;
  seen: boolean;
  flagged: boolean;
  size: number;
};

export type MessageDetail = MessageSummary & {
  cc: string[];
  text: string;
  truncated: boolean;
  attachments: { filename: string; mimeType: string; size: number }[];
};

/** The subset of cf-imap's CFImap used here */
export type ImapSession = {
  getFolders(namespace: string, filter?: string): Promise<Folder[]>;
  selectFolder(folder: string): Promise<{ emails: number }>;
  examine(folder: string): Promise<{ emails: number }>;
  searchEmails(props: Record<string, unknown>): Promise<number[]>;
  fetchEmails(props: {
    limit: [number, number] | number;
    fetchBody?: boolean;
    peek?: boolean;
    useUid?: boolean;
  }): Promise<FetchedEmail[]>;
  storeFlags(
    target: string,
    flags: string[],
    mode?: "add" | "remove" | "replace",
    useUid?: boolean,
  ): Promise<unknown>;
  move(target: string, range: string, useUid?: boolean): Promise<unknown>;
  copy(target: string, range: string, useUid?: boolean): Promise<unknown>;
  expunge(opts?: { range?: string; useUid?: boolean }): Promise<unknown>;
  capabilities: string[];
  logout(): Promise<boolean>;
};

export type Folder = { name: string; delimiter: string; attributes: string[] };

export type FetchedEmail = {
  uid: number;
  flags: string[];
  internalDate: Date;
  size: number;
  from: string[];
  to: string[];
  cc: string[];
  subject: string;
  body: { text?: string; html?: string };
  attachments: {
    filename: string;
    mimeType: string;
    size: number;
    isInline: boolean;
  }[];
};

export type Connector = (account: Account) => Promise<ImapSession>;

export class MailError extends Error {
  override name = "MailError";
}

const MAX_LIST = 50;
const DEFAULT_LIST = 20;
const DEFAULT_TEXT_CHARS = 20000;
const TRASH_NAMES = [
  "trash",
  "lixeira",
  "deleted",
  "deleted items",
  "deleted messages",
  "itens excluídos",
];

/** Secret name holding an account's password, e.g. PASS_CONTATO_EXAMPLE_COM_BR */
export function secretNameFor(email: string): string {
  return `PASS_${email.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

export function parseAccounts(list: string): Account[] {
  return list
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .map((email) => ({ email, secret: secretNameFor(email) }));
}

function summarize(e: FetchedEmail): MessageSummary {
  return {
    uid: e.uid,
    date: e.internalDate.toISOString(),
    from: e.from,
    to: e.to,
    subject: e.subject,
    seen: e.flags.includes("Seen"),
    flagged: e.flags.includes("Flagged"),
    size: e.size,
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function findTrash(folders: Folder[]): string | undefined {
  const bySpecialUse = folders.find((f) =>
    f.attributes.some((a) => a.toLowerCase() === "trash"),
  );
  if (bySpecialUse) return bySpecialUse.name;
  for (const f of folders) {
    const leaf =
      (f.delimiter ? f.name.split(f.delimiter).pop() : f.name) ?? f.name;
    if (TRASH_NAMES.includes(leaf.toLowerCase())) return f.name;
  }
  return undefined;
}

/** MOVE when the server has it (RFC 6851 / IMAP4rev2), else COPY + \\Deleted + UID EXPUNGE */
export async function moveUids(
  s: ImapSession,
  target: string,
  uids: number[],
): Promise<void> {
  const range = uids.join(",");
  const caps = s.capabilities.map((c) => c.toUpperCase());
  if (caps.includes("MOVE") || caps.includes("IMAP4REV2")) {
    await s.move(target, range, true);
    return;
  }
  await s.copy(target, range, true);
  await s.storeFlags(range, ["Deleted"], "add", true);
  await s.expunge({ range, useUid: true });
}

export class MailTools {
  readonly #accounts: Map<string, Account>;
  readonly #connect: Connector;
  readonly #hasSecret: (account: Account) => boolean;

  constructor(
    accounts: Account[],
    connect: Connector,
    hasSecret: (a: Account) => boolean,
  ) {
    this.#accounts = new Map(accounts.map((a) => [a.email, a]));
    this.#connect = connect;
    this.#hasSecret = hasSecret;
  }

  listAccounts() {
    return [...this.#accounts.values()].map((a) => ({
      email: a.email,
      configured: this.#hasSecret(a),
      secretName: a.secret,
    }));
  }

  async #with<T>(
    email: string,
    fn: (s: ImapSession) => Promise<T>,
  ): Promise<T> {
    const account = this.#accounts.get(email.trim().toLowerCase());
    if (!account)
      throw new MailError(`Unknown account: ${email}. Use list_accounts.`);
    if (!this.#hasSecret(account)) {
      throw new MailError(
        `Account ${account.email} has no password secret (${account.secret}).`,
      );
    }
    const session = await this.#connect(account);
    try {
      return await fn(session);
    } finally {
      await session.logout().catch(() => false);
    }
  }

  listFolders(account: string) {
    return this.#with(account, async (s) => {
      const folders = await s.getFolders("", "*");
      return { folders, trash: findTrash(folders) ?? null };
    });
  }

  async #summaries(s: ImapSession, uids: number[]): Promise<MessageSummary[]> {
    const out: MessageSummary[] = [];
    for (const uid of uids) {
      const [e] = await s.fetchEmails({
        limit: [uid, uid],
        fetchBody: false,
        peek: true,
        useUid: true,
      });
      if (e) out.push(summarize(e));
    }
    return out;
  }

  /** Newest first */
  listMessages(input: {
    account: string;
    folder?: string;
    limit?: number;
    unreadOnly?: boolean;
    from?: string;
    subject?: string;
    text?: string;
    since?: string;
    before?: string;
  }) {
    const folder = input.folder ?? "INBOX";
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIST, 1), MAX_LIST);
    return this.#with(input.account, async (s) => {
      const box = await s.examine(folder);
      const criteria: Record<string, unknown> = { useUid: true };
      if (input.unreadOnly) criteria.seen = false;
      if (input.from) criteria.from = input.from;
      if (input.subject) criteria.subject = input.subject;
      if (input.text) criteria.text = input.text;
      if (input.since) criteria.since = new Date(input.since);
      if (input.before) criteria.before = new Date(input.before);
      const hasFilter = Object.keys(criteria).length > 1;
      const uids =
        box.emails === 0
          ? []
          : await s.searchEmails(
              hasFilter ? criteria : { useUid: true, all: true },
            );
      const picked = [...uids].sort((a, b) => b - a).slice(0, limit);
      return {
        folder,
        total: uids.length,
        messages: await this.#summaries(s, picked),
      };
    });
  }

  getMessage(input: {
    account: string;
    folder?: string;
    uid: number;
    maxChars?: number;
  }) {
    const folder = input.folder ?? "INBOX";
    const max = input.maxChars ?? DEFAULT_TEXT_CHARS;
    return this.#with(input.account, async (s) => {
      await s.examine(folder);
      const [e] = await s.fetchEmails({
        limit: [input.uid, input.uid],
        fetchBody: true,
        peek: true,
        useUid: true,
      });
      if (!e)
        throw new MailError(`Message ${input.uid} not found in ${folder}.`);
      const full =
        e.body.text?.trim() || (e.body.html ? htmlToText(e.body.html) : "");
      const detail: MessageDetail = {
        ...summarize(e),
        cc: e.cc,
        text: full.slice(0, max),
        truncated: full.length > max,
        attachments: e.attachments
          .filter((a) => !a.isInline)
          .map((a) => ({
            filename: a.filename,
            mimeType: a.mimeType,
            size: a.size,
          })),
      };
      return detail;
    });
  }

  /** Flagged (starred) messages are never moved or deleted */
  async #movable(s: ImapSession, uids: number[]) {
    const summaries = await this.#summaries(s, uids);
    const found = new Set(summaries.map((m) => m.uid));
    return {
      movable: summaries.filter((m) => !m.flagged).map((m) => m.uid),
      flagged: summaries.filter((m) => m.flagged).map((m) => m.uid),
      notFound: uids.filter((u) => !found.has(u)),
    };
  }

  moveMessages(input: {
    account: string;
    folder?: string;
    uids: number[];
    toFolder: string;
  }) {
    const folder = input.folder ?? "INBOX";
    return this.#with(input.account, async (s) => {
      await s.selectFolder(folder);
      const { movable, flagged, notFound } = await this.#movable(s, input.uids);
      if (movable.length > 0) await moveUids(s, input.toFolder, movable);
      return {
        moved: movable,
        to: input.toFolder,
        skippedFlagged: flagged,
        notFound,
      };
    });
  }

  /** Moves to the account's Trash, like deleting in a mail app */
  deleteMessages(input: { account: string; folder?: string; uids: number[] }) {
    const folder = input.folder ?? "INBOX";
    return this.#with(input.account, async (s) => {
      const trash = findTrash(await s.getFolders("", "*"));
      if (!trash)
        throw new MailError(
          "No Trash folder found in this account; nothing was deleted.",
        );
      if (trash === folder)
        throw new MailError(
          "Messages are already in the Trash; permanent deletion is not offered.",
        );
      await s.selectFolder(folder);
      const { movable, flagged, notFound } = await this.#movable(s, input.uids);
      if (movable.length > 0) await moveUids(s, trash, movable);
      return { deleted: movable, trash, skippedFlagged: flagged, notFound };
    });
  }

  setRead(input: {
    account: string;
    folder?: string;
    uids: number[];
    read: boolean;
  }) {
    const folder = input.folder ?? "INBOX";
    return this.#with(input.account, async (s) => {
      await s.selectFolder(folder);
      await s.storeFlags(
        input.uids.join(","),
        ["Seen"],
        input.read ? "add" : "remove",
        true,
      );
      return { uids: input.uids, read: input.read };
    });
  }
}
