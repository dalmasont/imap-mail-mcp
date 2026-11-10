import { describe, expect, test } from "bun:test";
import {
  AuthorizationError,
  type AuthRequest,
  type CompleteAuthorizationOptions,
  type ConsentDescription,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { handleAuthorize, type Limiter } from "../src/authorize.ts";

const PASSWORD = "correct horse battery staple";
const AUTHORIZE_URL = "https://mcp.example.workers.dev/authorize?client_id=c";
const authRequest = { clientId: "c", scope: ["calendar"] } as AuthRequest;

const consent: ConsentDescription = {
  clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
  clientName: "<script>alert(1)</script>",
  clientDomain: "claude.ai",
  redirectUri: "https://claude.ai/api/mcp/auth_callback",
  redirectHost: "claude.ai",
  redirectIsLoopback: false,
  scope: ["calendar"],
};

function fakeHelpers(description: ConsentDescription = consent) {
  const calls: string[] = [];
  const completed: CompleteAuthorizationOptions[] = [];
  const helpers = {
    parseAuthRequest: async () => authRequest,
    describeConsent: async () => description,
    beginConsent: async () => ({
      handle: "h-1",
      headers: new Headers({ "X-Frame-Options": "DENY" }),
    }),
    approveConsent: async (_request: Request, handle: string) => {
      calls.push(`approve ${handle}`);
      return {
        request: authRequest,
        headers: new Headers({ "Set-Cookie": "c=1" }),
      };
    },
    denyConsent: async (_request: Request, handle: string) => {
      calls.push(`deny ${handle}`);
      return {
        request: authRequest,
        redirectTo: "https://claude.ai/cb?error=access_denied",
        headers: new Headers({
          Location: "https://claude.ai/cb?error=access_denied",
        }),
      };
    },
    completeAuthorization: async (options: CompleteAuthorizationOptions) => {
      completed.push(options);
      return { redirectTo: "https://claude.ai/cb?code=xyz" };
    },
  } as unknown as OAuthHelpers;
  return { helpers, calls, completed };
}

const allow: Limiter = { limit: async () => ({ success: true }) };

const post = (fields: Record<string, string>) =>
  new Request(AUTHORIZE_URL, {
    method: "POST",
    body: new URLSearchParams(fields),
  });

async function showConsent(description: ConsentDescription) {
  const { helpers } = fakeHelpers(description);
  return handleAuthorize(new Request(AUTHORIZE_URL), {
    helpers,
    ownerPassword: PASSWORD,
    limiter: allow,
  });
}

describe("handleAuthorize: consent page", () => {
  test("renders the consent page with escaped client details", async () => {
    const response = await showConsent(consent);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(html).toContain("&#60;script&#62;alert(1)&#60;/script&#62;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("claude.ai");
    expect(html).toContain('name="handle" value="h-1"');
  });

  test("forbids scripts, plugins, and framing with a Content-Security-Policy", async () => {
    const response = await showConsent(consent);

    const policy = response.headers.get("Content-Security-Policy");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("script-src");
  });

  test.each(["https://claude.ai/logo.png", "https://cdn.claude.ai/logo.png"])(
    "shows the logo of a verified client hosted on its own domain: %s",
    async (logoUri) => {
      const response = await showConsent({ ...consent, logoUri });

      expect(await response.text()).toContain(`<img src="${logoUri}"`);
    },
  );

  test.each([
    ["an unsafe scheme", { logoUri: "javascript:alert(1)" }],
    ["plain http", { logoUri: "http://claude.ai/logo.png" }],
    ["another domain", { logoUri: "https://tracker.example/claude.png" }],
    ["a look-alike domain", { logoUri: "https://evilclaude.ai/logo.png" }],
    [
      "an unverified client",
      { clientDomain: undefined, logoUri: "https://claude.ai/logo.png" },
    ],
  ])("hides the client logo for %s", async (_, overrides) => {
    const response = await showConsent({ ...consent, ...overrides });
    const html = await response.text();

    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
  });

  test("warns about unverified clients and loopback redirects", async () => {
    const response = await showConsent({
      ...consent,
      clientDomain: undefined,
      redirectHost: "localhost",
      redirectIsLoopback: true,
    });
    const html = await response.text();

    expect(html).toContain("not verified");
    expect(html).toContain("an app on this computer");
  });
});

describe("handleAuthorize: decision", () => {
  test("redirects back to the client with access_denied when denied", async () => {
    const { helpers, calls } = fakeHelpers();

    const response = await handleAuthorize(
      post({ handle: "h-1", decision: "deny" }),
      { helpers, ownerPassword: PASSWORD, limiter: allow },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://claude.ai/cb?error=access_denied",
    );
    expect(calls).toEqual(["deny h-1"]);
  });

  test("asks for the password again with the same handle when it is wrong", async () => {
    const { helpers, calls } = fakeHelpers();

    const response = await handleAuthorize(
      post({ handle: "h-1", decision: "approve", password: "wrong" }),
      { helpers, ownerPassword: PASSWORD, limiter: allow },
    );
    const html = await response.text();

    expect(response.status).toBe(401);
    expect(html).toContain("Incorrect password");
    expect(html).toContain('name="handle" value="h-1"');
    expect(calls).toEqual([]);
  });

  test("issues an authorization code and redirects when the password matches", async () => {
    const { helpers, calls, completed } = fakeHelpers();

    const response = await handleAuthorize(
      post({ handle: "h-1", decision: "approve", password: PASSWORD }),
      { helpers, ownerPassword: PASSWORD, limiter: allow },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://claude.ai/cb?code=xyz",
    );
    expect(response.headers.get("Set-Cookie")).toBe("c=1");
    expect(calls).toEqual(["approve h-1"]);
    expect(completed).toEqual([
      {
        request: authRequest,
        userId: "owner",
        metadata: {},
        scope: ["calendar"],
        props: {},
      },
    ]);
  });

  test.each(["", "short"])(
    "refuses to authorize when AUTH_PASSWORD is missing or too short: '%s'",
    async (ownerPassword) => {
      const { helpers, calls } = fakeHelpers();

      const result = handleAuthorize(
        post({ handle: "h-1", decision: "approve", password: ownerPassword }),
        { helpers, ownerPassword, limiter: allow },
      );

      await expect(result).rejects.toThrow("AUTH_PASSWORD");
      expect(calls).toEqual([]);
    },
  );

  test("returns 429 without checking the password once the rate limit is hit", async () => {
    const { helpers, calls } = fakeHelpers();
    const keys: string[] = [];
    const limiter: Limiter = {
      limit: async ({ key }) => {
        keys.push(key);
        return { success: false };
      },
    };

    const response = await handleAuthorize(
      post({ handle: "h-1", decision: "approve", password: PASSWORD }),
      { helpers, ownerPassword: PASSWORD, limiter },
    );

    expect(response.status).toBe(429);
    expect(await response.text()).toContain("Too many attempts");
    expect(keys).toEqual(["owner"]);
    expect(calls).toEqual([]);
  });
});

describe("handleAuthorize: errors", () => {
  test("redirects authorization errors to a verified redirect URI", async () => {
    const { helpers } = fakeHelpers();
    helpers.parseAuthRequest = async () => {
      throw new AuthorizationError("invalid_scope", {
        description: "bad scope",
        redirectUri: "https://claude.ai/cb",
      });
    };

    const response = await handleAuthorize(new Request(AUTHORIZE_URL), {
      helpers,
      ownerPassword: PASSWORD,
      limiter: allow,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toStartWith(
      "https://claude.ai/cb?error=invalid_scope",
    );
  });

  test("renders authorization errors locally when the redirect URI is unverified", async () => {
    const { helpers } = fakeHelpers();
    helpers.parseAuthRequest = async () => {
      throw new AuthorizationError("invalid_request", {
        description: "unknown client",
      });
    };

    const response = await handleAuthorize(new Request(AUTHORIZE_URL), {
      helpers,
      ownerPassword: PASSWORD,
      limiter: allow,
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("unknown client");
  });
});
