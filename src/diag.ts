/**
 * Temporary connection diagnostics: shows, step by step, how far a socket
 * from this Worker gets with an IMAP server (TCP open, TLS, first bytes).
 * Never sends credentials.
 */
import { connect } from "cloudflare:sockets";

type Step = { step: string; ok: boolean; ms: number; detail: string };

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`timeout after ${ms}ms (${label})`)),
        ms,
      ),
    ),
  ]);
}

function describe(err: unknown): string {
  const e = err as Error & { cause?: unknown };
  return `${e?.name ?? "Error"}: ${e?.message ?? String(err)}${
    e?.cause ? ` | cause: ${JSON.stringify(e.cause)}` : ""
  }`;
}

async function attempt(
  host: string,
  port: number,
  secureTransport: "off" | "on",
): Promise<Step[]> {
  const steps: Step[] = [];
  const t0 = Date.now();
  let socket: ReturnType<typeof connect> | undefined;
  try {
    socket = connect(
      { hostname: host, port },
      { secureTransport, allowHalfOpen: true },
    );
    socket.closed.catch(() => undefined);
    const info = await withTimeout(socket.opened, 10000, "opened");
    steps.push({
      step: `${secureTransport === "on" ? "TLS" : "TCP"} opened`,
      ok: true,
      ms: Date.now() - t0,
      detail: `remote=${info?.remoteAddress ?? "?"}`,
    });
  } catch (err) {
    steps.push({
      step: "open",
      ok: false,
      ms: Date.now() - t0,
      detail: describe(err),
    });
    console.error(
      `[diag] ${host}:${port} ${secureTransport} open failed: ${describe(err)}`,
    );
    return steps;
  }
  const reader = socket.readable.getReader();
  try {
    const r = await withTimeout(reader.read(), 10000, "first read");
    const text = r.value ? new TextDecoder().decode(r.value).slice(0, 200) : "";
    steps.push({
      step: "first bytes",
      ok: !r.done,
      ms: Date.now() - t0,
      detail: r.done ? "stream ended with no data" : JSON.stringify(text),
    });
  } catch (err) {
    steps.push({
      step: "first bytes",
      ok: false,
      ms: Date.now() - t0,
      detail: describe(err),
    });
  } finally {
    reader.releaseLock();
    await socket.close().catch(() => undefined);
  }
  console.log(
    `[diag] ${host}:${port} ${secureTransport} ${JSON.stringify(steps)}`,
  );
  return steps;
}

/** Plain TCP and TLS attempts against the same host/port */
export async function diagnoseConnection(host: string, port: number) {
  const tls = await attempt(host, port, "on");
  const plain = await attempt(host, port, "off");
  return { host, port, tls, plain };
}
