import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// The require logic handles testing vs direct execution
let config: any;
try { config = require('../config.json'); } catch { config = { entities: {} }; }

// --- Types & Interfaces ---

export interface SecretStore {
  CHITTYCONNECT_ACCESS: string;
  EVIDENCE_COLLECT_AUTH: string;
  COMMAND_SYNC_AUTH: string;
  CHITTYSTORAGE_AUTH: string;
}

export interface EntityIDs {
  govId: string;
  financeTenantId: string;
}

export type ClassificationResult = 'OPERATIONAL' | 'LEGAL_ONLY' | 'DUAL_USE' | 'REVIEW_REQUIRED' | 'IGNORE';

// --- 1. ChittySecrets Bootstrap ---

export async function fetchSecrets(accessToken: string): Promise<SecretStore> {
  console.log('[Bootstrap] Authenticating to ChittySecrets using access token...');
  const res = await fetch(`https://secrets.chitty.cc/mcp`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'secrets_resolve',
      params: { identity: 'chitty-corp-papers' }
    })
  });
  
  if (!res.ok) {
    throw new Error(`Failed to fetch secrets: ${res.statusText} ${await res.text()}`);
  }
  
  const mcpResponse = await res.json() as any;
  const data = JSON.parse(mcpResponse.content[0].text);
  
  return {
    CHITTYCONNECT_ACCESS: data.CHITTYCONNECT_ACCESS,
    EVIDENCE_COLLECT_AUTH: data.EVIDENCE_COLLECT_AUTH,
    COMMAND_SYNC_AUTH: data.COMMAND_SYNC_AUTH,
    CHITTYSTORAGE_AUTH: data.CHITTYSTORAGE_AUTH
  };
}

// --- 3. 2D Classifier ---

export function classifyRecord(metadata: any, activeLegalProfiles: any[]): ClassificationResult {
  let legalScore = 0.1;
  let hasOperationalDomain = false;

  if (metadata.folder === 'Legal' || metadata.labels?.includes('legal')) legalScore = 0.8;
  
  const nameUpper = (metadata.name || '').toUpperCase();
  for (const profile of activeLegalProfiles) {
    if (nameUpper.includes(profile.name.toUpperCase())) legalScore = Math.max(legalScore, 0.9);
  }

  if (nameUpper.includes('INVOICE') || nameUpper.includes('STATEMENT') || nameUpper.includes('LEASE')) {
    hasOperationalDomain = true;
  }

  if (legalScore >= 0.8 && hasOperationalDomain) return 'DUAL_USE';
  if (legalScore >= 0.8 && !hasOperationalDomain) return 'LEGAL_ONLY';
  if (legalScore > 0.2 && legalScore < 0.8) return 'REVIEW_REQUIRED';
  if (legalScore <= 0.2 && hasOperationalDomain) return 'OPERATIONAL';
  
  return 'IGNORE';
}

// --- 4. Ephemeral Storage Hardening ---

export async function withEphemeralStorage<T>(work: (tempDir: string) => Promise<T>): Promise<T> {
  const tempDir = path.join('/tmp', `chitty-corp-papers-${crypto.randomBytes(8).toString('hex')}`);
  fs.mkdirSync(tempDir, { mode: 0o700, recursive: true });
  
  try {
    return await work(tempDir);
  } finally {
    console.log(`[Security] Purging ephemeral directory ${tempDir}`);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

// --- 6. Orchestration Main ---

export async function runSync(options?: { overrideConfig?: any, dryRun?: boolean, limit?: number }) {
  const activeConfig = options?.overrideConfig || config;
  const dryRun = options?.dryRun ?? false;
  const limit = options?.limit;
  
  if (dryRun) console.log('[Mode] Validation dry run. No mutations will occur.');

  const accessTokenFile = process.env.CHITTYSECRETS_ACCESS_TOKEN_FILE;
  if (!accessTokenFile) {
    console.error('[Fatal] CHITTYSECRETS_ACCESS_TOKEN_FILE not provided. Failing closed.');
    process.exit(1);
  }
  
  const accessToken = fs.readFileSync(accessTokenFile, 'utf-8').trim();
  const secrets = await fetchSecrets(accessToken);

  console.log('[Legal] Fetching active legal hold profiles from ChittyEvidence...');
  const evidenceRes = await fetch(`${activeConfig.evidence_url}/api/v1/cases?active=true`, {
    headers: { 'Authorization': `Bearer ${secrets.EVIDENCE_COLLECT_AUTH}` }
  });
  const legalProfiles = evidenceRes.ok ? await evidenceRes.json() as any[] : [{ name: 'Arias v. Bianchi' }];

  const ccUrl = "https://connect.chitty.cc/api/v1";

  for (const [key, entity] of Object.entries(activeConfig.entities as any)) {
    console.log(`[Sync] Processing ${key}`);

    const cursorRes = await fetch(`${activeConfig.storage_url}/mcp/call`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${secrets.CHITTYSTORAGE_AUTH}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'storage_sync_cursor_get', params: { source_type: 'gdrive', source_account: key, source_root_id: 'root' } })
    });
    
    let cursor = null;
    if (cursorRes.ok) {
       const cd = await cursorRes.json() as any;
       if (cd.content?.[0]?.text) {
          cursor = JSON.parse(cd.content[0].text)?.cursor ?? null;
       }
    }
    
    console.log(`[Connect] Calling GET /gdrive/files for account ${key} with cursor ${cursor}`);
    
    let url = `${ccUrl}/google/gdrive/files?pageSize=${limit ? limit : 50}`;
    if (cursor) {
      url += `&q=modifiedTime > '${cursor}'`;
    }

    const filesRes = await fetch(url, { headers: { 'Authorization': `Bearer ${secrets.CHITTYCONNECT_ACCESS}` } });
    if (!filesRes.ok) {
      console.error(`[Connect] Failed to list files: ${await filesRes.text()}`);
      continue;
    }
    const filesData = await filesRes.json() as any;
    let files = filesData.files || [];
    if (limit && files.length > limit) {
      files = files.slice(0, limit);
    }

    let maxModifiedTime = cursor;

    for (const file of files) {
      const classification = classifyRecord(file, legalProfiles);
      console.log(`[Classifier] Result for ${file.name}: ${classification}`);
      const sourceRef = `gdrive://${file.id}`;

      if (classification === 'IGNORE') {
        if (!maxModifiedTime || file.modifiedTime > maxModifiedTime) maxModifiedTime = file.modifiedTime;
        continue;
      }

      if (classification === 'LEGAL_ONLY' || classification === 'DUAL_USE') {
        if (dryRun) {
          console.log(`[DryRun] Would POST ${sourceRef} to Evidence`);
        } else {
          await fetch(`${activeConfig.evidence_url}/api/v1/evidence`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${secrets.EVIDENCE_COLLECT_AUTH}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_ref: sourceRef })
          });
        }
      }

      if (classification === 'DUAL_USE' || classification === 'REVIEW_REQUIRED' || classification === 'OPERATIONAL') {
        await withEphemeralStorage(async (tempDir) => {
          const localFilePath = path.join(tempDir, file.name || 'downloaded.bin');
          
          console.log(`[Connect] Downloading ${sourceRef} securely via ChittyConnect GET /gdrive/files/${file.id}/content`);
          const contentRes = await fetch(`${ccUrl}/google/gdrive/files/${file.id}/content`, {
             headers: { 'Authorization': `Bearer ${secrets.CHITTYCONNECT_ACCESS}` }
          });
          
          if (!contentRes.ok) {
             console.error(`[Connect] Failed to download: ${await contentRes.text()}`);
             return;
          }
          
          const buffer = await contentRes.arrayBuffer();
          fs.writeFileSync(localFilePath, Buffer.from(buffer), { mode: 0o600 });
          const base64 = Buffer.from(buffer).toString('base64');

          if (classification === 'OPERATIONAL' || classification === 'DUAL_USE') {
            if (dryRun) {
              console.log(`[DryRun] Would ingest ${sourceRef} to Operational Storage`);
            } else {
              const res = await fetch(`${activeConfig.storage_url}/mcp/call`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${secrets.CHITTYSTORAGE_AUTH}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'storage_ingest', params: { chitty_id: `doc_${crypto.randomUUID().replace(/-/g, '')}`, filename: path.basename(localFilePath), content_base64: base64, source_platform: 'gdrive' } })
              });
              if (res.ok) {
                const data = JSON.parse((await res.json() as any).content[0].text);
                console.log(`[Operational] Document registered. R2 Key: ${data.r2_key}`);
              }
            }
          }

          if (classification === 'REVIEW_REQUIRED') {
            if (dryRun) {
               console.log(`[DryRun] Would stage ${sourceRef} to Restricted and trigger ChittyCommand intent`);
            } else {
              const stageRes = await fetch(`${activeConfig.storage_url}/mcp/call`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${secrets.CHITTYSTORAGE_AUTH}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'storage_stage_restricted', params: { filename: path.basename(localFilePath), content_base64: base64, source_ref: sourceRef, created_by: 'chitty-corp-papers' } })
              });
              const stageData = JSON.parse((await stageRes.json() as any).content[0].text);
              const stagedChittyId = stageData.staged_id;
              
              await fetch(`${activeConfig.command_url}/api/triage/intents`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${secrets.COMMAND_SYNC_AUTH}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  intent_type: 'corporate_paper_review', privilege: 'privileged', space: 'business', priority: 5,
                  source_reference: sourceRef, document_chitty_id: stagedChittyId,
                  classification_scores: { legal_score: 0.5, has_operational_domain: true }, reason_codes: ['Score ambiguous']
                })
              });
            }
          }
        });
      }
      
      if (!maxModifiedTime || file.modifiedTime > maxModifiedTime) {
        maxModifiedTime = file.modifiedTime;
      }
    }
    
    if (maxModifiedTime && maxModifiedTime !== cursor) {
       if (dryRun) {
         console.log(`[DryRun] Would set sync cursor to ${maxModifiedTime}`);
       } else {
         await fetch(`${activeConfig.storage_url}/mcp/call`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${secrets.CHITTYSTORAGE_AUTH}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'storage_sync_cursor_set', params: { source_type: 'gdrive', source_account: key, source_root_id: 'root', cursor: maxModifiedTime, status: 'success' } })
         });
       }
    }
  }

  if (dryRun) {
    console.log('[DryRun] Would trigger synchronization via ChittyCommand...');
  } else {
    console.log('[Mercury] Triggering synchronization via ChittyCommand...');
    const mercuryRes = await fetch(`${activeConfig.command_url}/api/sync/trigger/mercury`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${secrets.COMMAND_SYNC_AUTH}`, 'Content-Type': 'application/json' }
    });
    if (mercuryRes.ok) {
       const mercuryData = await mercuryRes.json() as any;
       console.log(`[Mercury] Triggered sync, ID: ${mercuryData.sync_id}`);
    } else {
       console.error(`[Mercury] Failed: ${await mercuryRes.text()}`);
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const execute = args.includes('--execute');
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? parseInt(args[limitIndex + 1], 10) : undefined;
  
  if (!dryRun && !execute) {
    console.error("Must specify either --dry-run or --execute");
    process.exit(1);
  }
  
  runSync({ dryRun: dryRun && !execute, limit }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
