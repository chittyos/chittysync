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
    // In local development environment ONLY, allow reading from wrangler env vars as fallback
    if (env.ENVIRONMENT === "development" && env[name as keyof Env]) {
      return env[name as keyof Env] as string;
    }
    throw new SecretsError(`Missing Cloudflare Access credentials to resolve secret: ${name}`);
  }

  try {
    const res = await fetch(`${secretsUrl}/mcp`, {
      method: "POST",
      headers: {
        "CF-Access-Client-Id": clientId,
        "CF-Access-Client-Secret": clientSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        method: "tools/call",
        params: {
          name: "secrets_resolve",
          arguments: {
            name: name,
          },
        },
      }),
      signal: AbortSignal.timeout(15000), // Enforce 15s timeout
    });

    if (!res.ok) {
      throw new SecretsError(`ChittySecrets returned HTTP ${res.status} ${res.statusText}`);
    }

    const json = await res.json() as any;
    if (json.error) {
      throw new SecretsError(`ChittySecrets resolution error: ${json.error.message || json.error}`);
    }

    const value = json.result?.content?.[0]?.text || json.result?.value;
    if (!value) {
      throw new SecretsError(`ChittySecrets returned empty value for secret: ${name}`);
    }

    return value.trim();
  } catch (err: any) {
    throw new SecretsError(`Failed to resolve secret ${name}: ${err.message}`);
  }
}
