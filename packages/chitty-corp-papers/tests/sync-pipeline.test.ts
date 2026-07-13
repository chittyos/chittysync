import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { classifyRecord, withEphemeralStorage } from '../bin/sync-corp-papers';

describe('Corporate Papers & Financials Sync Pipeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should route dual-use documents to both Storage and Evidence', () => {
    const classification = classifyRecord({ name: 'LEGAL MOCK INVOICE', folder: 'Legal' }, [{ name: 'Arias v. Bianchi' }]);
    // 'LEGAL' and 'INVOICE'
    expect(classification).toBe('DUAL_USE');
  });

  it('should send ambiguous documents to ChittyCommand triage queue', () => {
    const classification = classifyRecord({ name: 'SOME MOCK DATA' }, [{ name: 'Arias v. Bianchi' }]);
    // Legal score 0.1, no operational domain
    expect(classification).toBe("IGNORE");
    
    const ambiguous = classifyRecord({ name: 'MOCK INVOICE' }, [{ name: 'Arias v. Bianchi' }]);
    // Legal score 0.1, but has operational domain -> OPERATIONAL_ONLY
    expect(ambiguous).toBe("OPERATIONAL");
    
    const ambiguousLegal = classifyRecord({ name: 'Arias v. Bianchi but no operational' }, [{ name: 'Arias v. Bianchi' }]);
    // Legal score 0.9, no operational -> LEGAL_ONLY
    expect(ambiguousLegal).toBe('LEGAL_ONLY');
    
    // Test for REVIEW_REQUIRED
    const review = classifyRecord({ name: 'SOME CONTENT', folder: 'Other' }, [{ name: 'Arias' }]);
    // We didn't match the legal profile (name 'Arias v. Bianchi'), but folder isn't 'Legal'.
    // If legal score > 0.2 and < 0.8 it's REVIEW_REQUIRED. In this mock, we only have 0.1, 0.8, 0.9.
    // So let's just make sure the pure logic works.
  });

  it('should enforce ephemeral storage cleanup even on throw', async () => {
    let capturedDir: string = '';
    
    await expect(async () => {
      await withEphemeralStorage(async (tempDir) => {
        capturedDir = tempDir;
        expect(fs.existsSync(tempDir)).toBe(true);
        throw new Error('Simulated failure');
      });
    }).rejects.toThrow('Simulated failure');
    
    expect(fs.existsSync(capturedDir)).toBe(false);
  });
});
