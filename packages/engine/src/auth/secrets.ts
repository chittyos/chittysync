import type { Env } from "../worker";

export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsError";
  }
}

/**
 * Resolve a secret dynamically from ChittySecrets (secrets.chitty.cc).
 * If the secrets manager is unreachable or authentication fails, this fails closed.
 */
export async function resolveSecret(name: string, env: Env): Promise<string> {
  const secretsUrl = env.CHITTYSECRETS_URL || "https://secrets.chitty.cc";
  const clientId = env.CF_ACCESS_CLIENT_ID;
  const clientSecret = env.CF_ACCESS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    // Development-only fallback: read directly from wrangler dev vars.
    // This path MUST NOT be reachable in production or staging; CF_ACCESS_CLIENT_ID
    // and CF_ACCESS_CLIENT_SECRET are required secrets for those environments.
    if (env.ENVIRONMENT === "development") {
      const directValue = env[name as keyof Env] as string | undefined;
      if (directValue) {
        console.warn(`[secrets] DEV FALLBACK: resolved '${name}' from wrangler env (not ChittySecrets)`);
        return directValue;
      }
      throw new SecretsError(`Secret '${name}' not found in wrangler dev vars and CF Access credentials are absent`);
    }
    // In staging and production, missing Access credentials is a hard failure.
    throw new SecretsError(
      `CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required in ${env.ENVIRONMENT || "production"} to resolve secret: ${name}`
    );
  }

  try {
    const res = await fetch(`${secretsUrl}/mcp/service/secrets/reveal`, {
      method: "POST",
      headers: {
        "CF-Access-Client-Id": clientId,
        "CF-Access-Client-Secret": clientSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(15000), // Enforce 15s timeout
    });

    if (!res.ok) {
      let errMsg = `ChittySecrets returned HTTP ${res.status} ${res.statusText}`;
      try {
        const errJson = await res.json() as any;
        if (errJson.error) {
          errMsg += `: ${errJson.error} (${errJson.reason || "no reason"})`;
        }
      } catch {}
      throw new SecretsError(errMsg);
    }

    const json = await res.json() as any;
    if (json.error) {
      throw new SecretsError(`ChittySecrets resolution error: ${json.error}`);
    }

    const value = json.value;
    if (!value) {
      throw new SecretsError(`ChittySecrets returned empty value for secret: ${name}`);
    }

    return value.trim();
  } catch (err: any) {
    throw new SecretsError(`Failed to resolve secret ${name}: ${err.message}`);
  }
}
