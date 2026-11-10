import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
  interface Env {
    /** Injected into defaultHandler by OAuthProvider */
    OAUTH_PROVIDER: OAuthHelpers;
    /** Secret: password for the consent page */
    AUTH_PASSWORD: string;
  }
}
