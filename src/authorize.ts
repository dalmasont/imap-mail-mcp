import {
  AuthorizationError,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import {
  CONTENT_SECURITY_POLICY,
  consentPage,
  messagePage,
  retryPage,
} from "./consent-page.ts";

/** Same shape as the Workers Rate Limiting binding */
export type Limiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type AuthorizeDependencies = {
  helpers: OAuthHelpers;
  ownerPassword: string;
  limiter: Limiter;
};

/** A single owner grants every authorization */
const OWNER_USER_ID = "owner";
const MIN_OWNER_PASSWORD_LENGTH = 16;
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";
const utf8 = new TextEncoder();

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", utf8.encode(value)),
  );
}

async function passwordMatches(
  candidate: string,
  expected: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([digest(candidate), digest(expected)]);
  let difference = 0;
  for (const [i, byte] of a.entries()) {
    difference |= byte ^ (b[i] ?? 0);
  }
  return difference === 0;
}

function html(body: string, status: number, headers = new Headers()) {
  headers.set("Content-Type", HTML_CONTENT_TYPE);
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  return new Response(body, { status, headers });
}

async function showConsent(
  request: Request,
  helpers: OAuthHelpers,
): Promise<Response> {
  const authRequest = await helpers.parseAuthRequest(request);
  const details = await helpers.describeConsent(authRequest);
  const consent = await helpers.beginConsent(authRequest);
  return html(consentPage(details, consent.handle), 200, consent.headers);
}

async function decideConsent(
  request: Request,
  { helpers, ownerPassword, limiter }: AuthorizeDependencies,
): Promise<Response> {
  const form = await request.formData();
  const handle = String(form.get("handle"));
  if (form.get("decision") !== "approve") {
    const denied = await helpers.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  if (ownerPassword.length < MIN_OWNER_PASSWORD_LENGTH) {
    throw new Error(
      `AUTH_PASSWORD must be at least ${MIN_OWNER_PASSWORD_LENGTH} characters`,
    );
  }
  if (!(await limiter.limit({ key: OWNER_USER_ID })).success) {
    return html(
      messagePage(
        "Too many attempts",
        "Wait a minute, then go back and try again.",
      ),
      429,
    );
  }
  if (!(await passwordMatches(String(form.get("password")), ownerPassword))) {
    return html(retryPage(handle), 401);
  }
  const approved = await helpers.approveConsent(request, handle);
  const { redirectTo } = await helpers.completeAuthorization({
    request: approved.request,
    userId: OWNER_USER_ID,
    metadata: {},
    scope: approved.request.scope,
    props: {},
  });
  approved.headers.set("Location", redirectTo);
  return new Response(null, { status: 302, headers: approved.headers });
}

export async function handleAuthorize(
  request: Request,
  dependencies: AuthorizeDependencies,
): Promise<Response> {
  try {
    return request.method === "POST"
      ? await decideConsent(request, dependencies)
      : await showConsent(request, dependencies.helpers);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.redirectTo
        ? Response.redirect(error.redirectTo, 302)
        : new Response(error.description, {
            status: 400,
            headers: { "Content-Type": TEXT_CONTENT_TYPE },
          });
    }
    throw error;
  }
}
