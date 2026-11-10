import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";

export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src https:; frame-ancestors 'none'; base-uri 'none'";

const HTML_SPECIALS = /[&<>"']/g;
const HTTPS_PROTOCOL = "https:";

function escapeHtml(value: string): string {
  return value.replace(HTML_SPECIALS, (char) => `&#${char.charCodeAt(0)};`);
}

const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #f5f5f7;
  --glow-a: rgba(255, 94, 87, 0.28);
  --glow-b: rgba(94, 92, 230, 0.26);
  --card: rgba(255, 255, 255, 0.72);
  --card-border: rgba(255, 255, 255, 0.9);
  --text: #1d1d1f;
  --muted: #6e6e73;
  --hairline: rgba(0, 0, 0, 0.08);
  --field: rgba(118, 118, 128, 0.12);
  --accent: #0071e3;
  --accent-text: #ffffff;
  --success: #248a3d;
  --warning-bg: rgba(255, 159, 10, 0.14);
  --warning-text: #a05a00;
  --danger: #d70015;
  --shadow: 0 30px 80px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.04);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #000000;
    --glow-a: rgba(255, 69, 58, 0.22);
    --glow-b: rgba(94, 92, 230, 0.3);
    --card: rgba(28, 28, 30, 0.72);
    --card-border: rgba(255, 255, 255, 0.08);
    --text: #f5f5f7;
    --muted: #98989d;
    --hairline: rgba(255, 255, 255, 0.1);
    --field: rgba(118, 118, 128, 0.24);
    --accent: #0a84ff;
    --success: #30d158;
    --warning-bg: rgba(255, 159, 10, 0.18);
    --warning-text: #ffb340;
    --danger: #ff453a;
    --shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
  }
}
* { box-sizing: border-box; margin: 0; }
body {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px 16px;
  font: 15px/1.47 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  color: var(--text);
  background:
    radial-gradient(40rem 28rem at 15% 10%, var(--glow-a), transparent 70%),
    radial-gradient(44rem 30rem at 90% 95%, var(--glow-b), transparent 70%),
    var(--bg);
}
main {
  width: 100%;
  max-width: 400px;
  padding: 36px 28px 28px;
  border-radius: 28px;
  background: var(--card);
  border: 1px solid var(--card-border);
  box-shadow: var(--shadow);
  backdrop-filter: saturate(180%) blur(30px);
  -webkit-backdrop-filter: saturate(180%) blur(30px);
  text-align: center;
}
.pair { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 24px; }
.tile {
  width: 64px; height: 64px; border-radius: 15px;
  display: grid; place-items: center; overflow: hidden;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.14), inset 0 0 0 0.5px rgba(0, 0, 0, 0.08);
}
.tile svg { width: 36px; height: 36px; }
.calendar { background: linear-gradient(160deg, #ff6a5c 0%, #ff2d55 100%); color: #ffffff; }
.agent { background: linear-gradient(160deg, #7d7aff 0%, #5e5ce6 55%, #3634a3 100%); color: #ffffff; font: 600 28px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
.agent img { width: 100%; height: 100%; object-fit: cover; background: #ffffff; }
.link { display: flex; gap: 5px; }
.link span { width: 5px; height: 5px; border-radius: 50%; background: var(--muted); opacity: 0.35; animation: pulse 1.6s infinite ease-in-out; }
.link span:nth-child(2) { animation-delay: 0.2s; }
.link span:nth-child(3) { animation-delay: 0.4s; }
@keyframes pulse { 0%, 100% { opacity: 0.25; transform: scale(0.85); } 50% { opacity: 0.9; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .link span { animation: none; } }
h1 { font: 600 22px/1.25 -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.origin { margin-top: 10px; font-size: 13px; color: var(--muted); }
.badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; }
.verified { color: var(--success); background: color-mix(in srgb, var(--success) 12%, transparent); }
.unverified { color: var(--warning-text); background: var(--warning-bg); }
.permissions { list-style: none; padding: 0; margin: 24px 0 0; text-align: left; border-top: 1px solid var(--hairline); }
.permissions li { display: flex; align-items: center; gap: 12px; padding: 12px 2px; border-bottom: 1px solid var(--hairline); }
.permissions svg { flex: none; width: 20px; height: 20px; color: var(--accent); }
.notice { margin-top: 16px; padding: 10px 12px; border-radius: 12px; font-size: 13px; text-align: left; background: var(--warning-bg); color: var(--warning-text); }
.destination { margin-top: 14px; font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
.destination strong { color: var(--text); font-weight: 500; }
form { margin-top: 24px; display: grid; gap: 12px; }
input[type="password"] {
  width: 100%; padding: 13px 16px; border: 0; border-radius: 12px;
  font: inherit; color: var(--text); background: var(--field); outline: none;
}
input[type="password"]:focus { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent); }
.error { color: var(--danger); font-size: 13px; }
button { font: inherit; cursor: pointer; border: 0; }
.primary { padding: 13px 16px; border-radius: 12px; font-weight: 600; color: var(--accent-text); background: var(--accent); transition: filter 0.15s; }
.primary:hover { filter: brightness(1.08); }
.secondary { padding: 6px; color: var(--accent); background: none; font-size: 14px; }
footer { margin-top: 22px; font-size: 11px; color: var(--muted); }
`;

const CALENDAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r="0.6" fill="currentColor"/><circle cx="12" cy="14.5" r="0.6" fill="currentColor"/><circle cx="15.5" cy="14.5" r="0.6" fill="currentColor"/></svg>`;
const VIEW_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EDIT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;
const CHECK_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
${body}
<footer>Self-hosted icloud-calendar-mcp · Not affiliated with Apple</footer>
</main>
</body>
</html>`;
}

/** Only a verified (CIMD) client may show a logo, and only one hosted on its own domain */
function verifiedLogo(details: ConsentDescription): string | undefined {
  const { clientDomain, logoUri } = details;
  if (!clientDomain || !logoUri || !URL.canParse(logoUri)) return undefined;
  const logo = new URL(logoUri);
  const onClientDomain =
    logo.hostname === clientDomain ||
    logo.hostname.endsWith(`.${clientDomain}`);
  return logo.protocol === HTTPS_PROTOCOL && onClientDomain
    ? logo.href
    : undefined;
}

function agentTile(details: ConsentDescription): string {
  const logo = verifiedLogo(details);
  if (logo) {
    return `<div class="tile agent"><img src="${escapeHtml(logo)}" alt=""></div>`;
  }
  const initial = Array.from(details.clientName.trim())[0] ?? "?";
  return `<div class="tile agent" aria-hidden="true">${escapeHtml(initial.toUpperCase())}</div>`;
}

const CALENDAR_TILE = `<div class="tile calendar">${CALENDAR_ICON}</div>`;

function pair(agent: string): string {
  return `<div class="pair">${agent}<div class="link" aria-hidden="true"><span></span><span></span><span></span></div>${CALENDAR_TILE}</div>`;
}

function passwordForm(handle: string, error?: string): string {
  return `<form method="post">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<input type="password" name="password" placeholder="Password" aria-label="Password" autocomplete="current-password" required autofocus>
${error ? `<p class="error" role="alert">${error}</p>` : ""}
<button class="primary" name="decision" value="approve">Allow</button>
<button class="secondary" name="decision" value="deny" formnovalidate>Cancel</button>
</form>`;
}

export function consentPage(
  details: ConsentDescription,
  handle: string,
): string {
  const name = escapeHtml(details.clientName);
  const origin = details.clientDomain
    ? `<span class="badge verified">${CHECK_ICON}${escapeHtml(details.clientDomain)}</span>`
    : `<span class="badge unverified">Name not verified</span>`;
  const loopback = details.redirectIsLoopback
    ? `<p class="notice">Access will be sent to an app on this computer. Continue only if you started connecting from it.</p>`
    : "";
  return layout(
    `Connect ${name} to iCloud Calendar`,
    `${pair(agentTile(details))}
<h1>Connect ${name} to your iCloud Calendar</h1>
<p class="origin">${origin}</p>
<ul class="permissions">
<li>${VIEW_ICON}<span>See your calendars and events</span></li>
<li>${EDIT_ICON}<span>Create and delete events</span></li>
</ul>
${loopback}
<p class="destination">Access goes to <strong>${escapeHtml(details.redirectHost)}</strong></p>
${passwordForm(handle)}`,
  );
}

export function retryPage(handle: string): string {
  return layout(
    "Incorrect password",
    `<div class="pair">${CALENDAR_TILE}</div>
<h1>Enter your password</h1>
${passwordForm(handle, "Incorrect password. Try again.")}`,
  );
}

export function messagePage(title: string, message: string): string {
  return layout(
    escapeHtml(title),
    `<h1>${escapeHtml(title)}</h1>
<p class="destination">${escapeHtml(message)}</p>`,
  );
}
