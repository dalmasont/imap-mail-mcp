# CLAUDE.md

Remote MCP server for IMAP mailboxes on Cloudflare Workers. README.md is for users deploying it; this file is for working on the code.

## Layout

| Path                                | Role                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                      | Worker entry: `OAuthProvider` routes `/mcp` to the MCP handler and everything else to the consent page |
| `src/authorize.ts`                  | Consent flow: password check, rate limit, approve/deny                                                 |
| `src/consent-page.ts`               | Consent page HTML and its Content-Security-Policy                                                      |
| `src/mcp-server.ts`                 | MCP tool registration and input schemas (zod)                                                          |
| `src/mail.ts`                       | Mail tool logic over an IMAP session (cf-imap); flagged messages are never moved or deleted            |
| `scripts/smoke.sh`                  | End-to-end check of OAuth and MCP against a running server                                             |

## Commands

```sh
bun run test        # unit tests (bun test, preload stubs cloudflare:workers)
bun run typecheck   # regenerates worker-configuration.d.ts, then tsc for src and tests
bun run lint        # biome
bun run dev         # wrangler dev on :8787, secrets from .dev.vars (see .dev.vars.example)
bun run build       # bundle to dist/ without deploying (wrangler deploy --dry-run)
bun run deploy      # wrangler deploy with the Wrangler login
```

Run test, typecheck, and lint before committing. CI (`.github/workflows/ci.yml`) runs the same plus `bun run build` on every pull request and on `main`.

## Dependency updates

- Dependabot (`.github/dependabot.yml`) opens one grouped pull request per ecosystem (bun, GitHub Actions) every Monday, and only for releases at least 7 days old.
- Dependabot security updates are intentionally off, so no bot pull request skips that wait. Dependabot alerts are on: when one reports a vulnerability that cannot wait, update by hand (`bun update <package>` or `bun add <package>@<version>`), run the checks, and open a pull request like any other change.

## Conventions

- Test-first: add a failing test in `tests/` before changing behavior.
- All code, comments, tests, tool descriptions, and UI text are in English.
- `wrangler.jsonc` is the single source for the Worker's configuration and bindings, for both `wrangler dev` and `wrangler deploy`. Secrets are listed in `secrets.required`; their values live only in Cloudflare (`wrangler secret put`) and `.dev.vars`.
- Commit messages use Conventional Commits (`feat:`, `fix:`, `chore:` …).

## Security invariants

Keep these covered by tests when touching the related code:

- Event periods must be both dates or both offset date-times before they reach `buildEvent` or `applyEventChanges`.
- `update_event` edits the stored calendar data in place (`applyEventChanges`) rather than rebuilding it, and writes back with `If-Match` on the ETag it read. Read that ETag as the DAV `getetag` via `calendar-multiget`, never from a GET's `ETag` header, which can arrive weakened and then never matches.
- Recurrence expansion is bounded per event and per `list_events` call by one shared `RecurrenceBudget`; an event over budget is skipped and reported in `skipped`, never failing the whole listing. `parseEvents` also resets the global `ICAL.TimezoneService` after each calendar so one calendar's `VTIMEZONE` cannot change another's times.
- The consent page escapes every client-provided string, shows a logo only for a verified (CIMD) client when it is an `https:` URL on that client's domain, and is served with a CSP that allows no scripts.
- Authorization fails closed when `AUTH_PASSWORD` is shorter than 16 characters, and password attempts go through the rate limiter first.
