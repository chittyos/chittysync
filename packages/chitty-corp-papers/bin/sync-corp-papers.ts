import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import config from '../config.json' assert { type: 'json' };

// --- Types & Interfaces ---

interface SecretStore {
  CHITTYCONNECT_ACCESS: string;
  EVIDENCE_COLLECT_AUTH: string;
  COMMAND_SYNC_AUTH: string;
  CHITTYSTORAGE_AUTH: string;
}

interface EntityIDs {
  govId: string;
  financeTenantId: string;
}

type ClassificationResult = 'OPERATIONAL_ONLY' | 'LEGAL_ONLY' | 'DUAL_USE' | 'REVIEW_REQUIRED' | 'REJECTED';

// --- 1. ChittySecrets Bootstrap ---

async function fetchSecrets(accessId: string, accessSecret: string): Promise<SecretStore> {
  console.log('[Bootstrap] Authenticating to ChittySecrets with injected Cloudflare Access credentials...');
  
  // In a real implementation, we use fetch to https://secrets.chitty.cc/mcp
  // For this workload script, we mock the HTTP response for demonstration.
  return {
    CHITTYCONNECT_ACCESS: 'cc_access_token_mock',
    EVIDENCE_COLLECT_AUTH: 'evidence_collect_token_mock',
    COMMAND_SYNC_AUTH: 'command_sync_token_mock', // Must have chittycommand:sync:mercury scope
    CHITTYSTORAGE_AUTH: 'storage_auth_token_mock'
  };
}

// --- 2. Canonical Entity Resolution ---

async function resolveEntityIDs(entitySlug: string, financeSlug: string): Promise<EntityIDs> {
  console.log(`[Resolution] Fetching canonical IDs for ${entitySlug} from Gov and ${financeSlug} from Finance...`);
  // Mocking the GET /api/v1/tenants?slug=... calls
  return {
    govId: `uuid-gov-${entitySlug}`,
    financeTenantId: `uuid-fin-${financeSlug}`
  };
}

// --- 3. 2D Classifier ---

function classifyRecord(content: string, metadata: any, activeLegalProfiles: any[]): ClassificationResult {
  let legalScore = 0.1;
  let hasOperationalDomain = false;

  // 1. Explicit Legal-Hold manifest
  if (metadata.folder === 'Legal' || metadata.labels?.includes('legal')) legalScore = 0.8;
  
  // 2. Case Identifiers
  const contentUpper = content.toUpperCase();
  for (const profile of activeLegalProfiles) {
    if (contentUpper.includes(profile.name.toUpperCase())) legalScore = Math.max(legalScore, 0.9);
  }

  // Determine operational domain
  if (contentUpper.includes('INVOICE') || contentUpper.includes('STATEMENT') || contentUpper.includes('LEASE')) {
    hasOperationalDomain = true;
  }

  if (legalScore >= 0.8 && hasOperationalDomain) return 'DUAL_USE';
  if (legalScore >= 0.8 && !hasOperationalDomain) return 'LEGAL_ONLY';
  if (legalScore > 0.2 && legalScore < 0.8) return 'REVIEW_REQUIRED';
  if (legalScore <= 0.2 && hasOperationalDomain) return 'OPERATIONAL_ONLY';
  
  return 'REJECTED';
}

// --- 4. Ephemeral Storage Hardening ---

async function withEphemeralStorage<T>(work: (tempDir: string) => Promise<T>): Promise<T> {
  const tempDir = path.join('/tmp', `chitty-corp-papers-${crypto.randomBytes(8).toString('hex')}`);
  // Mode 0700 ensures only the owner can read/write/execute
  fs.mkdirSync(tempDir, { mode: 0o700, recursive: true });
  
  try {
    return await work(tempDir);
  } finally {
    // Cleanup Guarantee
    console.log(`[Security] Purging ephemeral directory ${tempDir}`);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// --- 5. Routing Actions ---

async function routeToChittyStorage(filePath: string, auth: string): Promise<string> {
  console.log(`[Storage] Ingesting into ChittyStorage canonical R2...`);
  // Mock returns the sha256 hash
  return `sha256/mockhash123`;
}

async function routeToChittyEvidence(sourceRef: string, auth: string): Promise<void> {
  console.log(`[Evidence] Registering source reference ${sourceRef} to ChittyEvidence...`);
}

async function routeToTriageQueue(sourceRef: string, filePath: string, auth: string, reason: string): Promise<void> {
  console.log(`[Triage] Staging ambiguous bytes to ChittyStorage restricted staging mechanism...`);
  const stagedChittyId = `staged-id-${crypto.randomBytes(4).toString('hex')}`;
  
  console.log(`[Triage] Queueing intent in ChittyCommand for manual review: ${sourceRef}`);
  
  const payload = {
    intent_type: 'corporate_paper_review',
    privilege: 'privileged',
    space: 'business',
    priority: 5,
    source_reference: sourceRef,
    document_chitty_id: stagedChittyId,
    classification_scores: {
      legal_score: 0.5,
      has_operational_domain: true
    },
    reason_codes: [reason]
  };

  // Mocking the POST /api/triage/intents call
  console.log('[Triage] POST /api/triage/intents with payload:', payload);
}

// --- 6. Orchestration Main ---

async function runSync() {
  // 1. Get CF Access credentials securely injected by systemd-creds
  const cfAccessIdFile = process.env.CF_ACCESS_CLIENT_ID_FILE;
  const cfAccessSecretFile = process.env.CF_ACCESS_CLIENT_SECRET_FILE;
  
  const cfAccessId = cfAccessIdFile ? fs.readFileSync(cfAccessIdFile, 'utf-8').trim() : 'mock_systemd_id';
  const cfAccessSecret = cfAccessSecretFile ? fs.readFileSync(cfAccessSecretFile, 'utf-8').trim() : 'mock_systemd_secret';
  
  const secrets = await fetchSecrets(cfAccessId, cfAccessSecret);

  // 2. Fetch legal hold profiles dynamically
  console.log('[Legal] Fetching active legal hold profiles from ChittyEvidence...');
  const legalProfiles = [{ name: 'Arias v. Bianchi' }]; 

  // 3. Process Entities
  for (const [key, entity] of Object.entries(config.entities)) {
    const ids = await resolveEntityIDs(entity.gov_entity_slug, entity.finance_tenant_slug);
    console.log(`[Sync] Processing ${key} (Gov: ${ids.govId}, Fin: ${ids.financeTenantId})`);

    // Mock processing a document
    await withEphemeralStorage(async (tempDir) => {
      const sourceRef = `gdrive://mock-file-123`;
      const localFilePath = path.join(tempDir, 'downloaded.pdf');
      
      // Simulate ChittyConnect download
      console.log(`[Connect] Downloading ${sourceRef} securely to ${localFilePath}`);
      fs.writeFileSync(localFilePath, 'MOCK INVOICE CONTENT', { mode: 0o600 });
      
      const classification = classifyRecord('MOCK INVOICE CONTENT', {}, legalProfiles);
      console.log(`[Classifier] Result: ${classification}`);

      if (classification === 'OPERATIONAL_ONLY' || classification === 'DUAL_USE') {
        const hashId = await routeToChittyStorage(localFilePath, secrets.CHITTYSTORAGE_AUTH);
        console.log(`[Operational] Document registered. ChittyID: ${hashId}`);
      }

      if (classification === 'LEGAL_ONLY' || classification === 'DUAL_USE') {
        // Source reference ONLY! Does not upload bytes.
        await routeToChittyEvidence(sourceRef, secrets.EVIDENCE_COLLECT_AUTH);
      }

      if (classification === 'REVIEW_REQUIRED') {
        await routeToTriageQueue(sourceRef, localFilePath, secrets.COMMAND_SYNC_AUTH, 'Score ambiguous (0.5)');
      }
    });
  }

  // 4. Trigger Mercury Sync
  console.log('[Mercury] Triggering synchronization via ChittyCommand...');
  // POST /api/sync/trigger/mercury
  const syncId = 'mock_sync_id_789';
  
  // 5. Poll Status
  console.log(`[Mercury] Polling status for ${syncId}...`);
  // GET /api/sync/status/:sync_id
  console.log('[Mercury] Sync completed successfully.');
}

if (require.main === module) {
  runSync().catch(console.error);
}
