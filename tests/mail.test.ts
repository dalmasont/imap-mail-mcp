import { describe, expect, test } from "bun:test";
import {
  type FetchedEmail,
  findTrash,
  type ImapSession,
  MailTools,
  parseAccounts,
  secretNameFor,
} from "../src/mail.ts";

function email(uid: number, flags: string[] = []): FetchedEmail {
  return {
    uid,
    flags,
    internalDate: new Date(Date.UTC(2026, 10, uid)),
    size: 100,
    from: [`a${uid}@x.com`],
    to: ["me@y.com"],
    cc: [],
    subject: `S${uid}`,
    body: { html: "<p>Hello&nbsp;<b>there</b></p><script>x</script>" },
    attachments: [
      {
        filename: "f.pdf",
        mimeType: "application/pdf",
        size: 10,
        isInline: false,
      },
    ],
  };
}

function fake(store: FetchedEmail[], caps = ["IMAP4rev1", "MOVE"]) {
  const log: string[] = [];
  const s: ImapSession = {
    capabilities: caps,
    getFolders: async () => [
      { name: "INBOX", delimiter: ".", attributes: [] },
      { name: "INBOX.Trash", delimiter: ".", attributes: [] },
    ],
    selectFolder: async (f) => {
      log.push(`select ${f}`);
      return { emails: store.length };
    },
    examine: async (f) => {
      log.push(`examine ${f}`);
      return { emails: store.length };
    },
    searchEmails: async (p) => {
      log.push(`search ${JSON.stringify(p)}`);
      return store.map((e) => e.uid);
    },
    fetchEmails: async ({ limit }) => {
      const u = Array.isArray(limit) ? limit[0] : limit;
      return store.filter((e) => e.uid === u);
    },
    storeFlags: async (t, f, m) => {
      log.push(`store ${t} ${f} ${m}`);
      return [];
    },
    move: async (t, r) => {
      log.push(`move ${r} ${t}`);
      return null;
    },
    copy: async (t, r) => {
      log.push(`copy ${r} ${t}`);
      return null;
    },
    expunge: async (o) => {
      log.push(`expunge ${o?.range}`);
      return [];
    },
    logout: async () => {
      log.push("logout");
      return true;
    },
  };
  return { s, log };
}

const accounts = parseAccounts("Contato@Ex.com.br, b@ex.com");

describe("accounts", () => {
  test("secret names", () => {
    expect(secretNameFor("contato@carlosdalmaso.com.br")).toBe(
      "PASS_CONTATO_CARLOSDALMASO_COM_BR",
    );
    expect(accounts[0]?.email).toBe("contato@ex.com.br");
    expect(parseAccounts("Me@iCloud.com|imap.mail.me.com|me")[0]).toEqual({
      email: "me@icloud.com",
      secret: "PASS_ME_ICLOUD_COM",
      host: "imap.mail.me.com",
      username: "me",
    });
  });
  test("unknown or unconfigured accounts fail without connecting", async () => {
    const { s } = fake([]);
    const t = new MailTools(
      accounts,
      async () => s,
      (a) => a.email !== "b@ex.com",
    );
    expect(t.listMessages({ account: "zz@ex.com" })).rejects.toThrow(
      "Unknown account",
    );
    expect(t.listMessages({ account: "b@ex.com" })).rejects.toThrow(
      "no password secret",
    );
  });
});

describe("mail tools", () => {
  test("lists newest first with limit and logs out", async () => {
    const { s, log } = fake([email(1), email(2), email(3)]);
    const t = new MailTools(
      accounts,
      async () => s,
      () => true,
    );
    const r = await t.listMessages({
      account: "contato@ex.com.br",
      limit: 2,
      unreadOnly: true,
    });
    expect(r.total).toBe(3);
    expect(r.messages.map((m) => m.uid)).toEqual([3, 2]);
    expect(log).toContain('search {"useUid":true,"seen":false}');
    expect(log.at(-1)).toBe("logout");
  });
  test("reads body as text, lists attachments", async () => {
    const { s } = fake([email(5)]);
    const t = new MailTools(
      accounts,
      async () => s,
      () => true,
    );
    const m = await t.getMessage({ account: "contato@ex.com.br", uid: 5 });
    expect(m.text).toBe("Hello there");
    expect(m.attachments[0]?.filename).toBe("f.pdf");
  });
  test("delete moves to Trash and never touches flagged", async () => {
    const { s, log } = fake([email(1), email(2, ["Flagged"])]);
    const t = new MailTools(
      accounts,
      async () => s,
      () => true,
    );
    const r = await t.deleteMessages({
      account: "contato@ex.com.br",
      uids: [1, 2, 9],
    });
    expect(r).toEqual({
      deleted: [1],
      trash: "INBOX.Trash",
      skippedFlagged: [2],
      notFound: [9],
    });
    expect(log).toContain("move 1 INBOX.Trash");
  });
  test("falls back to copy + delete + expunge without MOVE", async () => {
    const { s, log } = fake([email(1)], ["IMAP4rev1"]);
    const t = new MailTools(
      accounts,
      async () => s,
      () => true,
    );
    await t.moveMessages({
      account: "contato@ex.com.br",
      uids: [1],
      toFolder: "INBOX.Archive",
    });
    expect(log).toContain("copy 1 INBOX.Archive");
    expect(log).toContain("store 1 Deleted add");
    expect(log).toContain("expunge 1");
  });
  test("trash detection", () => {
    expect(
      findTrash([{ name: "Lixeira", delimiter: "/", attributes: [] }]),
    ).toBe("Lixeira");
    expect(
      findTrash([{ name: "X", delimiter: "/", attributes: ["Trash"] }]),
    ).toBe("X");
  });
});
