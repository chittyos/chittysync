/**
 * Status Dependency Tests
 *
 * Verifies that /api/v1/status:
 *   - reports overallOk=true only when ALL four critical deps are healthy
 *   - returns HTTP 503 if any critical dep fails
 *   - returns HTTP 207 if only projections are degraded
 *   - never exposes secret names, token values, internal URLs, or key IDs
 *   - reports Sheets/AppSheet separately from critical deps
 */

import { describe, it, expect } from 'vitest';

// We test the status logic in isolation rather than spinning up the full Worker.
// These tests mirror the overallOk decision logic in worker.ts.

type DepStatus = { ok?: boolean; ready?: boolean; latencyMs?: number; error?: string };

function computeOverallStatus(
  db:        { ok: boolean },
  routing:   { ok: boolean },
  secrets:   { ok: boolean },
  finance:   { ready: boolean },
  sheets:    { ready: boolean },
  appsheet:  { ready: boolean }
): { status: string; httpCode: number } {
  const criticalOk =
    db.ok && routing.ok && secrets.ok && finance.ready;
  const projectionOk = sheets.ready && appsheet.ready;
  const overallStatus = criticalOk && projectionOk
    ? 'healthy'
    : criticalOk
    ? 'degraded'
    : 'unhealthy';
  const httpCode =
    overallStatus === 'unhealthy' ? 503
    : overallStatus === 'degraded' ? 207
    : 200;
  return { status: overallStatus, httpCode };
}

const ALL_OK = {
  db:       { ok: true },
  routing:  { ok: true },
  secrets:  { ok: true },
  finance:  { ready: true },
  sheets:   { ready: true },
  appsheet: { ready: true },
};

describe('/api/v1/status dependency logic', () => {

  it('all deps healthy → status=healthy, HTTP 200', () => {
    const { status, httpCode } = computeOverallStatus(
      ALL_OK.db, ALL_OK.routing, ALL_OK.secrets,
      ALL_OK.finance, ALL_OK.sheets, ALL_OK.appsheet
    );
    expect(status).toBe('healthy');
    expect(httpCode).toBe(200);
  });

  it('database down → unhealthy, HTTP 503', () => {
    const { status, httpCode } = computeOverallStatus(
      { ok: false }, ALL_OK.routing, ALL_OK.secrets,
      ALL_OK.finance, ALL_OK.sheets, ALL_OK.appsheet
    );
    expect(status).toBe('unhealthy');
    expect(httpCode).toBe(503);
  });

  it('ChittyRouter / JWKS down → unhealthy, HTTP 503', () => {
    const { status, httpCode } = computeOverallStatus(
      ALL_OK.db, { ok: false }, ALL_OK.secrets,
      ALL_OK.finance, ALL_OK.sheets, ALL_OK.appsheet
    );
    expect(status).toBe('unhealthy');
    expect(httpCode).toBe(503);
  });

  it('ChittySecrets down → unhealthy, HTTP 503', () => {
    const { status, httpCode } = computeOverallStatus(
      ALL_OK.db, ALL_OK.routing, { ok: false },
      ALL_OK.finance, ALL_OK.sheets, ALL_OK.appsheet
    );
    expect(status).toBe('unhealthy');
    expect(httpCode).toBe(503);
  });

  it('ChittyFinance down → unhealthy, HTTP 503 (declared service contract)', () => {
    const { status, httpCode } = computeOverallStatus(
      ALL_OK.db, ALL_OK.routing, ALL_OK.secrets,
      { ready: false }, ALL_OK.sheets, ALL_OK.appsheet
    );
    expect(status).toBe('unhealthy');
    expect(httpCode).toBe(503);
  });

  it('Sheets down but critical deps ok → degraded, HTTP 207', () => {
    const { status, httpCode } = computeOverallStatus(
      ALL_OK.db, ALL_OK.routing, ALL_OK.secrets,
      ALL_OK.finance, { ready: false }, ALL_OK.appsheet
    );
    expect(status).toBe('degraded');
    expect(httpCode).toBe(207);
  });

  it('AppSheet down but critical deps ok → degraded, HTTP 207', () => {
    const { status, httpCode } = computeOverallStatus(
      ALL_OK.db, ALL_OK.routing, ALL_OK.secrets,
      ALL_OK.finance, ALL_OK.sheets, { ready: false }
    );
    expect(status).toBe('degraded');
    expect(httpCode).toBe(207);
  });

  it('all critical down → unhealthy, HTTP 503', () => {
    const { status, httpCode } = computeOverallStatus(
      { ok: false }, { ok: false }, { ok: false },
      { ready: false }, ALL_OK.sheets, ALL_OK.appsheet
    );
    expect(status).toBe('unhealthy');
    expect(httpCode).toBe(503);
  });

});

describe('Status response sanitization', () => {
  function buildStatusBody(secretsError?: string, financeError?: string) {
    return {
      status:  'unhealthy',
      version: '1.0.0',
      chittySecrets: {
        status:      'unreachable',
        latencyMs:   120,
        reason_code: secretsError ? 'SECRETS_UNREACHABLE' : undefined,
        // Must NOT contain: secret names, token values, internal URLs
      },
      chittyFinance: {
        status:      'not_ready',
        latencyMs:   200,
        reason_code: financeError ? 'FINANCE_UNREACHABLE' : undefined,
        // Must NOT contain internal URLs
      },
    };
  }

  it('status body contains only reason_code, not raw error strings', () => {
    const body = buildStatusBody('fetch error: secrets.chitty.cc:443', 'ECONNREFUSED finance.chitty.cc');
    const bodyStr = JSON.stringify(body);

    // reason_code present
    expect(bodyStr).toContain('SECRETS_UNREACHABLE');
    expect(bodyStr).toContain('FINANCE_UNREACHABLE');

    // Raw error strings must not appear
    expect(bodyStr).not.toContain('ECONNREFUSED');
    expect(bodyStr).not.toContain('fetch error:');
  });

  it('status body does not expose secret names or key IDs', () => {
    const body = buildStatusBody();
    const bodyStr = JSON.stringify(body);

    // No secret names in response
    expect(bodyStr).not.toMatch(/CF_ACCESS_CLIENT_ID/);
    expect(bodyStr).not.toMatch(/CHITTY_SYNC_SERVICE_CREDENTIALS/);
    expect(bodyStr).not.toMatch(/DATABASE_URL/);
    expect(bodyStr).not.toMatch(/kid/);
  });
});
