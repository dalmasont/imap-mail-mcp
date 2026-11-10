import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { CFImap } from "cf-imap";
import { handleAuthorize } from "./authorize.ts";
import {
  type Account,
  type ImapSession,
  MailTools,
  parseAccounts,
} from "./mail.ts";
import { createMcpServer } from "./mcp-server.ts";

const MCP_ROUTE = "/mcp";
const AUTHORIZE_PATH = "/authorize";
const SCOPE = "mail";

const apiHandler = {
  fetch(request, env, ctx) {
    const secrets = env as unknown as Record<string, unknown>;
    const passwordOf = (a: Account) => {
      const value = secrets[a.secret];
      return typeof value === "string" && value.length > 0 ? value : undefined;
    };
    const connect = async (a: Account): Promise<ImapSession> => {
      const imap = new CFImap({
        host: a.host ?? env.IMAP_HOST,
        port: Number(env.IMAP_PORT),
        tls: String(env.IMAP_TLS) !== "false",
        auth: {
          username: a.username ?? a.email,
          password: passwordOf(a) ?? "",
        },
        timeoutMs: 20000,
      });
      const host = a.host ?? env.IMAP_HOST;
      const t0 = Date.now();
      console.log(`[imap] connecting ${a.email} -> ${host}:${env.IMAP_PORT}`);
      try {
        await imap.connect();
      } catch (err) {
        const e = err as Error & { cause?: unknown };
        console.error(
          `[imap] connect FAILED ${a.email} after ${Date.now() - t0}ms: ${e?.name}: ${e?.message}`,
          e?.cause ? `cause: ${JSON.stringify(e.cause)}` : "",
          e?.stack ?? "",
        );
        throw err;
      }
      console.log(`[imap] connected ${a.email} in ${Date.now() - t0}ms`);
      return imap as unknown as ImapSession;
    };
    const tools = new MailTools(
      parseAccounts(env.IMAP_ACCOUNTS),
      connect,
      (a) => passwordOf(a) !== undefined,
    );
    return createMcpHandler(() => createMcpServer(tools), { route: MCP_ROUTE })(
      request,
      env,
      ctx,
    );
  },
} satisfies ExportedHandler<Env>;

const defaultHandler = {
  async fetch(request, env) {
    if (new URL(request.url).pathname === AUTHORIZE_PATH) {
      return handleAuthorize(request, {
        helpers: env.OAUTH_PROVIDER,
        ownerPassword: env.AUTH_PASSWORD,
        limiter: env.AUTHORIZE_LIMITER,
      });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

const providers = new Map<string, OAuthProvider<Env>>();

/** The resource depends on the deployed URL, so build it from each request origin */
function providerFor(origin: string): OAuthProvider<Env> {
  let provider = providers.get(origin);
  if (!provider) {
    provider = new OAuthProvider<Env>({
      apiRoute: MCP_ROUTE,
      apiHandler,
      defaultHandler,
      authorizeEndpoint: AUTHORIZE_PATH,
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      clientIdMetadataDocumentEnabled: true,
      scopesSupported: [SCOPE],
      requiredScopes: [SCOPE],
      resourceMetadata: {
        resource: `${origin}${MCP_ROUTE}`,
        authorization_servers: [origin],
      },
    });
    providers.set(origin, provider);
  }
  return provider;
}

export default {
  fetch(request, env, ctx) {
    return providerFor(new URL(request.url).origin).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
