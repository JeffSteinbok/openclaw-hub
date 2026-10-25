/**
 * auth.ts — OAuth 2.1 resource-server checks for the bridge.
 *
 * Any OAuth 2.1 authorization server that signs JWT access tokens and honors
 * resource indicators works (WorkOS AuthKit, Auth0, Keycloak, …). Clients such as
 * ChatGPT discover it through the protected resource metadata (RFC 9728), sign
 * the user in, and send `resource=<MCP URL>`, which ends up in the token's `aud`.
 *
 * Every /mcp request must carry an AuthKit access token that:
 *   - verifies against AuthKit's JWKS,
 *   - has iss = the AuthKit issuer and aud = this server's resource URL,
 *   - is unexpired,
 *   - has a `sub` on the allowlist (one person).
 */

import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthConfig {
  /** Issuer, exactly as it appears in tokens' `iss`. */
  issuer: string;
  /** Canonical resource URL, e.g. https://<funnel-host>/mcp. */
  resource: string;
  /** WorkOS user ids (`sub`) allowed to use the server. Empty = nobody. */
  allowedSubjects: string[];
  /** Signing keys (create once, e.g. createRemoteJWKSet); defaults to <issuer>/oauth2/jwks (WorkOS). */
  keys?: JWTVerifyGetKey;
}

export type AuthResult =
  | { ok: true; sub: string }
  | { ok: false; status: 401 | 403; error: string; description: string; sub?: string };

export function jwksFor(issuer: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(`${issuer}/oauth2/jwks`));
}

export function resourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname === "/" ? "" : url.pathname}`;
}

export function protectedResourceMetadata(config: AuthConfig): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
  };
}

/** Value for the WWW-Authenticate header (and _meta["mcp/www_authenticate"]). */
export function challenge(config: AuthConfig, error: string, description: string): string {
  const quote = (s: string) => s.replace(/["\\]/g, "");
  return (
    `Bearer resource_metadata="${resourceMetadataUrl(config.resource)}", ` +
    `error="${quote(error)}", error_description="${quote(description)}"`
  );
}

export async function authenticate(header: string | undefined, config: AuthConfig): Promise<AuthResult> {
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(header ?? "");
  if (!match) {
    return { ok: false, status: 401, error: "invalid_request", description: "Authorization needed" };
  }
  try {
    const { payload } = await jwtVerify(match[1], config.keys ?? jwksFor(config.issuer), {
      issuer: config.issuer,
      audience: config.resource,
      algorithms: ["RS256", "ES256"],
      requiredClaims: ["sub", "exp"],
    });
    const sub = String(payload.sub);
    if (!config.allowedSubjects.includes(sub)) {
      return { ok: false, status: 403, error: "insufficient_scope", description: "This account is not allowed", sub };
    }
    return { ok: true, sub };
  } catch (e) {
    const description =
      e instanceof errors.JWTExpired
        ? "Token expired"
        : e instanceof errors.JWTClaimValidationFailed
          ? `Token ${e.claim} claim is not valid for this server`
          : "Invalid token";
    return { ok: false, status: 401, error: "invalid_token", description };
  }
}
