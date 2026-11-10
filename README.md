# imap-mail-mcp

Remote MCP server on Cloudflare Workers that gives Claude access to IMAP mailboxes:
list and search messages (headers only), read a message, mark read/unread,
move to another folder, and delete (move to the account's Trash).
Flagged (starred) messages are never moved or deleted. Nothing is ever deleted permanently.

## Configuration (`wrangler.jsonc`)

- `IMAP_HOST`, `IMAP_PORT`, `IMAP_TLS`: server (Hostinger: `imap.hostinger.com`, `993`, `true`).
- `IMAP_ACCOUNTS`: comma-separated addresses.

## Secrets (Cloudflare dashboard → Worker → Settings → Variables and Secrets)

- `AUTH_PASSWORD`: password for the consent page when connecting Claude (16+ characters).
- One per account: `PASS_` + the address in capitals with every non-letter/digit replaced by `_`.

## Connect

Add `https://<worker>.workers.dev/mcp` as a custom connector in Claude and approve with `AUTH_PASSWORD`.

Based on retogo/icloud-calendar-mcp (MIT) for the OAuth/consent layer; IMAP via cf-imap (MIT).
