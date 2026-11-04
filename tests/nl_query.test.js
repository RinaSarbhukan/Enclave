/**
 * Enclave - AI Query Feature Tests
 * Tests for payload builder, SQL validator, offline handling, and anonymization.
 * Run with: node --test tests/nl_query.test.js
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------

import {
  buildSchemaPayload,
  estimatePayloadSize,
  buildMessages,
  parseGroqResponse,
  setApiKey, getApiKey, hasApiKey, clearApiKey,
  hasConsent, recordConsent,
  setExcludedColumns, getExcludedColumns,
  setAnonymizeColumns, getAnonymizeColumns,
  setIncludeSampleValues,
  deAnonymizeSql,
  LlmError,
} from '../js/llmClient.js';

import {
  validateSql,
  SqlEngineError,
} from '../js/sqlEngine.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal headers array.
 * @param {Array<{key:string,label:string,type:string}>} cols
 * @returns {Array}
 */
function makeHeaders(cols) {
  return cols.map(c => ({ key: c.key, label: c.label, type: c.type }));
}

/**
 * Builds a minimal column profiles Map.
 * @param {Array<{key:string,type:string,stats?:object,missingCount?:number}>} cols
 * @returns {Map}
 */
function makeProfiles(cols) {
  const m = new Map();
  for (const c of cols) {
    m.set(c.key, {
      key: c.key,
      label: c.label ?? c.key,
      type: c.type,
      missingCount: c.missingCount ?? 0,
      missingPercentage: 0,
      stats: c.stats ?? { distinctCount: 5 },
    });
  }
  return m;
}

/**
 * Builds minimal Map rows.
 * @param {Array<{key:string}>} headers
 * @param {Array<object>} rowObjects
 * @returns {Array<Map>}
 */
function makeRows(headers, rowObjects) {
  return rowObjects.map(obj => {
    const m = new Map();
    for (const h of headers) m.set(h.key, obj[h.key] ?? null);
    return m;
  });
}

// ---------------------------------------------------------------------------
// Test: API Key state
// ---------------------------------------------------------------------------

describe('API Key management', () => {
  it('starts with no key', () => {
    clearApiKey();
    assert.strictEqual(hasApiKey(), false);
    assert.strictEqual(getApiKey(), '');
  });

  it('sets and retrieves a key from memory', () => {
    setApiKey('gsk_test_key_12345');
    assert.strictEqual(hasApiKey(), true);
    assert.strictEqual(getApiKey(), 'gsk_test_key_12345');
  });

  it('clears the key', () => {
    setApiKey('gsk_test_key_12345');
    clearApiKey();
    assert.strictEqual(hasApiKey(), false);
    assert.strictEqual(getApiKey(), '');
  });

  it('trims whitespace from keys', () => {
    setApiKey('  gsk_padded  ');
    assert.strictEqual(getApiKey(), 'gsk_padded');
    clearApiKey();
  });
});

// ---------------------------------------------------------------------------
// Test: Consent state
// ---------------------------------------------------------------------------

describe('Consent management', () => {
  it('recordConsent marks consent as given', () => {
    recordConsent();
    assert.strictEqual(hasConsent(), true);
  });
});

// ---------------------------------------------------------------------------
// Test: Payload Builder — row data exclusion
// ---------------------------------------------------------------------------

describe('buildSchemaPayload — privacy', () => {
  const headers = makeHeaders([
    { key: 'region', label: 'Region', type: 'categorical' },
    { key: 'revenue', label: 'Revenue', type: 'numeric' },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'order_date', label: 'Order Date', type: 'date' },
  ]);
  const profiles = makeProfiles([
    { key: 'region', label: 'Region', type: 'categorical', stats: { distinctCount: 4 } },
    { key: 'revenue', label: 'Revenue', type: 'numeric', stats: { min: 100, max: 9999, mean: 500, distinctCount: 50 } },
    { key: 'email', label: 'Email', type: 'text', stats: { distinctCount: 200 } },
    { key: 'order_date', label: 'Order Date', type: 'date', stats: { min: new Date('2023-01-01'), max: new Date('2024-12-31'), distinctCount: 100 } },
  ]);
  const rows = makeRows(headers, [
    { region: 'North', revenue: 500, email: 'alice@example.com', order_date: new Date('2024-01-15') },
    { region: 'South', revenue: 200, email: 'bob@example.com', order_date: new Date('2024-03-10') },
    { region: 'East',  revenue: 800, email: 'carol@example.com', order_date: new Date('2024-06-01') },
  ]);

  it('payload contains no row data', () => {
    const { payload } = buildSchemaPayload(headers, profiles, rows);
    const payloadStr = JSON.stringify(payload);
    // Row values like email addresses must NOT appear
    assert.ok(!payloadStr.includes('alice@example.com'), 'Row email must not appear in payload');
    assert.ok(!payloadStr.includes('bob@example.com'), 'Row email must not appear in payload');
    assert.ok(!payloadStr.includes('carol@example.com'), 'Row email must not appear in payload');
  });

  it('payload contains rowCount but NOT actual rows', () => {
    const { payload } = buildSchemaPayload(headers, profiles, rows);
    assert.strictEqual(payload.rowCount, 3);
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'rows'), 'payload must not have a "rows" field');
  });

  it('payload includes column names and types', () => {
    const { payload } = buildSchemaPayload(headers, profiles, rows);
    const keys = payload.columns.map(c => c.key);
    assert.ok(keys.includes('region'), 'region must be in payload');
    assert.ok(keys.includes('revenue'), 'revenue must be in payload');
  });

  it('email-like columns have no sample values', () => {
    const { payload } = buildSchemaPayload(headers, profiles, rows, { includeSamples: true });
    const emailCol = payload.columns.find(c => c.key === 'email');
    assert.ok(!emailCol?.sampleValues, 'Email column must not have sample values');
  });

  it('categorical columns with low cardinality include sample values', () => {
    const { payload } = buildSchemaPayload(headers, profiles, rows, { includeSamples: true });
    const regionCol = payload.columns.find(c => c.key === 'region');
    assert.ok(Array.isArray(regionCol?.sampleValues), 'Region should have sampleValues');
    assert.ok(regionCol.sampleValues.length > 0, 'Region sampleValues should not be empty');
  });

  it('sample values are truncated to 40 chars', () => {
    const longRows = makeRows(headers, [{
      region: 'A'.repeat(100), revenue: 100, email: 'x@x.com', order_date: new Date()
    }]);
    const { payload } = buildSchemaPayload(headers, profiles, longRows, { includeSamples: true });
    const regionCol = payload.columns.find(c => c.key === 'region');
    if (regionCol?.sampleValues) {
      for (const v of regionCol.sampleValues) {
        assert.ok(v.length <= 40, `Sample value length ${v.length} exceeds 40`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Test: Payload Builder — excluded columns
// ---------------------------------------------------------------------------

describe('buildSchemaPayload — column exclusion', () => {
  const headers = makeHeaders([
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'salary', label: 'Salary', type: 'numeric' },
    { key: 'dept', label: 'Department', type: 'categorical' },
  ]);
  const profiles = makeProfiles([
    { key: 'name', type: 'text' },
    { key: 'salary', type: 'numeric', stats: { min: 30000, max: 200000, mean: 80000, distinctCount: 100 } },
    { key: 'dept', type: 'categorical', stats: { distinctCount: 5 } },
  ]);
  const rows = makeRows(headers, [{ name: 'Alice', salary: 90000, dept: 'Eng' }]);

  it('excluded columns do not appear in payload', () => {
    const { payload } = buildSchemaPayload(headers, profiles, rows, { excludedColumns: new Set(['salary']) });
    const keys = payload.columns.map(c => c.key);
    assert.ok(!keys.includes('salary'), 'Excluded salary must not be in payload');
    assert.ok(keys.includes('dept'), 'Non-excluded dept must be in payload');
  });

  it('no excluded columns when exclusion set is empty', () => {
    const { payload } = buildSchemaPayload(headers, profiles, rows, { excludedColumns: new Set() });
    assert.strictEqual(payload.columns.length, 3);
  });
});

// ---------------------------------------------------------------------------
// Test: Payload Builder — anonymization
// ---------------------------------------------------------------------------

describe('buildSchemaPayload — anonymization', () => {
  const headers = makeHeaders([
    { key: 'customer_id', label: 'Customer ID', type: 'identifier' },
    { key: 'purchase_amt', label: 'Purchase Amount', type: 'numeric' },
  ]);
  const profiles = makeProfiles([
    { key: 'customer_id', type: 'identifier' },
    { key: 'purchase_amt', type: 'numeric', stats: { min: 10, max: 500, mean: 100, distinctCount: 90 } },
  ]);
  const rows = makeRows(headers, [{ customer_id: 'C001', purchase_amt: 120 }]);

  it('anonymized columns use col_N aliases', () => {
    const { payload, anonymizationMap } = buildSchemaPayload(headers, profiles, rows, { anonymize: true });
    const names = payload.columns.map(c => c.name);
    assert.ok(names.every(n => /^col_\d+$/.test(n)), 'All names should be col_N aliases');
    assert.ok(anonymizationMap.size > 0, 'anonymizationMap must have entries');
  });

  it('anonymizationMap maps alias to original key', () => {
    const { anonymizationMap } = buildSchemaPayload(headers, profiles, rows, { anonymize: true });
    const values = [...anonymizationMap.values()];
    assert.ok(values.includes('customer_id'), 'Map must reference customer_id');
    assert.ok(values.includes('purchase_amt'), 'Map must reference purchase_amt');
  });
});

// ---------------------------------------------------------------------------
// Test: deAnonymizeSql
// ---------------------------------------------------------------------------

describe('deAnonymizeSql', () => {
  it('replaces aliases back with original column keys', () => {
    const anonMap = new Map([['col_1', 'region'], ['col_2', 'revenue']]);
    const sql = 'SELECT col_1, SUM(col_2) FROM data GROUP BY col_1';
    const result = deAnonymizeSql(sql, anonMap, []);
    assert.ok(result.includes('region'), 'Should contain region');
    assert.ok(result.includes('revenue'), 'Should contain revenue');
    assert.ok(!result.includes('col_1'), 'Should not contain col_1 alias');
    assert.ok(!result.includes('col_2'), 'Should not contain col_2 alias');
  });

  it('returns original SQL when map is empty', () => {
    const sql = 'SELECT * FROM data';
    assert.strictEqual(deAnonymizeSql(sql, new Map(), []), sql);
  });
});

// ---------------------------------------------------------------------------
// Test: parseGroqResponse — malformed output handling
// ---------------------------------------------------------------------------

describe('parseGroqResponse', () => {
  it('parses valid JSON response', () => {
    const raw = JSON.stringify({
      sql: 'SELECT * FROM data',
      explanation: 'Returns all rows.',
      confidence: 'high',
      ambiguities: [],
    });
    const result = parseGroqResponse(raw);
    assert.strictEqual(result.sql, 'SELECT * FROM data');
    assert.strictEqual(result.confidence, 'high');
    assert.deepEqual(result.ambiguities, []);
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n{"sql":"SELECT 1","explanation":"","confidence":"low","ambiguities":[]}\n```';
    const result = parseGroqResponse(raw);
    assert.strictEqual(result.sql, 'SELECT 1');
  });

  it('throws LlmError for empty sql field', () => {
    const raw = JSON.stringify({ sql: '', explanation: '', confidence: 'low', ambiguities: [] });
    assert.throws(() => parseGroqResponse(raw), err => {
      assert.ok(err instanceof LlmError);
      assert.strictEqual(err.code, 'MISSING_SQL');
      return true;
    });
  });

  it('throws LlmError for invalid JSON', () => {
    assert.throws(() => parseGroqResponse('not json'), err => {
      assert.ok(err instanceof LlmError);
      assert.strictEqual(err.code, 'MALFORMED_RESPONSE');
      return true;
    });
  });

  it('normalizes unknown confidence values to "medium"', () => {
    const raw = JSON.stringify({ sql: 'SELECT 1', explanation: '', confidence: 'very-high', ambiguities: [] });
    const result = parseGroqResponse(raw);
    assert.strictEqual(result.confidence, 'medium');
  });

  it('handles missing ambiguities field gracefully', () => {
    const raw = JSON.stringify({ sql: 'SELECT 1', explanation: '', confidence: 'high' });
    const result = parseGroqResponse(raw);
    assert.deepEqual(result.ambiguities, []);
  });
});

// ---------------------------------------------------------------------------
// Test: SQL Validator — SELECT-only enforcement
// ---------------------------------------------------------------------------

describe('validateSql — SELECT-only enforcement', () => {
  const headers = makeHeaders([
    { key: 'region', label: 'Region', type: 'categorical' },
    { key: 'revenue', label: 'Revenue', type: 'numeric' },
  ]);

  it('accepts a valid SELECT', () => {
    const result = validateSql('SELECT region, SUM(revenue) FROM data GROUP BY region', headers);
    assert.strictEqual(result.valid, true);
  });

  it('rejects INSERT', () => {
    const r = validateSql("INSERT INTO data VALUES ('x', 1)", headers);
    assert.strictEqual(r.valid, false);
    assert.ok(r.reason, 'should have a reason');
  });

  it('rejects UPDATE', () => {
    const r = validateSql('UPDATE data SET revenue = 0', headers);
    assert.strictEqual(r.valid, false);
  });

  it('rejects DELETE', () => {
    const r = validateSql('DELETE FROM data WHERE revenue < 0', headers);
    assert.strictEqual(r.valid, false);
  });

  it('rejects DROP', () => {
    const r = validateSql('DROP TABLE data', headers);
    assert.strictEqual(r.valid, false);
  });

  it('rejects CREATE TABLE', () => {
    const r = validateSql('CREATE TABLE secret (id INT)', headers);
    assert.strictEqual(r.valid, false);
  });

  it('rejects multiple statements via semicolon', () => {
    const r = validateSql('SELECT 1; DROP TABLE data', headers);
    assert.strictEqual(r.valid, false);
  });

  it('accepts SELECT with trailing semicolon', () => {
    const r = validateSql('SELECT region FROM data;', headers);
    assert.strictEqual(r.valid, true);
  });

  it('rejects SQL comments', () => {
    const r = validateSql('SELECT region FROM data -- DROP TABLE data', headers);
    assert.strictEqual(r.valid, false);
  });
});

// ---------------------------------------------------------------------------
// Test: SQL Validator — function allow-list
// ---------------------------------------------------------------------------

describe('validateSql — function allow-list', () => {
  const headers = makeHeaders([
    { key: 'category', label: 'Category', type: 'categorical' },
    { key: 'amount', label: 'Amount', type: 'numeric' },
  ]);

  it('accepts COUNT(*)', () => {
    const r = validateSql('SELECT COUNT(*) FROM data', headers);
    assert.strictEqual(r.valid, true);
  });

  it('accepts SUM, AVG, MIN, MAX', () => {
    assert.strictEqual(validateSql('SELECT SUM(amount) FROM data', headers).valid, true);
    assert.strictEqual(validateSql('SELECT AVG(amount) FROM data', headers).valid, true);
    assert.strictEqual(validateSql('SELECT MIN(amount) FROM data', headers).valid, true);
    assert.strictEqual(validateSql('SELECT MAX(amount) FROM data', headers).valid, true);
  });

  it('accepts LOWER and UPPER', () => {
    assert.strictEqual(validateSql('SELECT LOWER(category) FROM data', headers).valid, true);
    assert.strictEqual(validateSql('SELECT UPPER(category) FROM data', headers).valid, true);
  });

  it('rejects disallowed function SLEEP', () => {
    const r = validateSql('SELECT SLEEP(5) FROM data', headers);
    assert.strictEqual(r.valid, false);
    assert.ok(r.reason?.includes('SLEEP') || r.reason?.includes('sleep'));
  });

  it('rejects disallowed function LOAD_FILE', () => {
    const r = validateSql("SELECT LOAD_FILE('/etc/passwd') FROM data", headers);
    assert.strictEqual(r.valid, false);
  });
});

// ---------------------------------------------------------------------------
// Test: SQL Validator — identifier allow-list
// ---------------------------------------------------------------------------

describe('validateSql — identifier allow-list (FR-19)', () => {
  const headers = makeHeaders([
    { key: 'product', label: 'Product', type: 'categorical' },
    { key: 'sales', label: 'Sales', type: 'numeric' },
  ]);

  it('accepts known column keys', () => {
    const r = validateSql('SELECT product, SUM(sales) FROM data GROUP BY product', headers);
    assert.strictEqual(r.valid, true);
  });

  // Note: The identifier checker is a best-effort heuristic.
  // The SQL engine itself does the final check, so false positives here
  // are less critical than false negatives.
});

// ---------------------------------------------------------------------------
// Test: Payload size estimation
// ---------------------------------------------------------------------------

describe('estimatePayloadSize', () => {
  it('returns a positive number for non-empty payload', () => {
    const payload = { rowCount: 100, tableName: 'data', columns: [{ name: 'col', type: 'numeric' }] };
    const size = estimatePayloadSize(payload);
    assert.ok(size > 0, 'Size should be positive');
  });

  it('returns 0 for null/undefined', () => {
    // Should not throw
    const size = estimatePayloadSize(null);
    assert.strictEqual(size, 0);
  });
});

// ---------------------------------------------------------------------------
// Test: buildMessages
// ---------------------------------------------------------------------------

describe('buildMessages', () => {
  const schemaPayload = { rowCount: 50, tableName: 'data', columns: [{ name: 'region', type: 'categorical' }] };

  it('always includes system message first', () => {
    const msgs = buildMessages(schemaPayload, 'Top 5 regions');
    assert.strictEqual(msgs[0].role, 'system');
    assert.ok(msgs[0].content.includes('SELECT'));
  });

  it('ends with user question', () => {
    const msgs = buildMessages(schemaPayload, 'Top 5 regions');
    const last = msgs[msgs.length - 1];
    assert.strictEqual(last.role, 'user');
    assert.ok(last.content.includes('Top 5 regions'));
  });

  it('includes recent questions context when provided', () => {
    const msgs = buildMessages(schemaPayload, 'How many rows?', ['Previous question 1']);
    const content = msgs.map(m => m.content).join(' ');
    assert.ok(content.includes('Previous question 1'));
  });

  it('schema block is delimited', () => {
    const msgs = buildMessages(schemaPayload, 'test');
    const sysContent = msgs[0].content;
    assert.ok(sysContent.includes('===BEGIN SCHEMA'));
    assert.ok(sysContent.includes('===END SCHEMA==='));
  });
});

// ---------------------------------------------------------------------------
// Test: LlmError
// ---------------------------------------------------------------------------

describe('LlmError', () => {
  it('has correct name, code, and message', () => {
    const err = new LlmError('OFFLINE', 'Not connected.', { retryAfter: 30 });
    assert.strictEqual(err.name, 'LlmError');
    assert.strictEqual(err.code, 'OFFLINE');
    assert.strictEqual(err.message, 'Not connected.');
    assert.strictEqual(err.extra.retryAfter, 30);
  });

  it('is an instance of Error', () => {
    const err = new LlmError('TIMEOUT', 'Timed out.');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof LlmError);
  });
});

// ---------------------------------------------------------------------------
// Test: SqlEngineError
// ---------------------------------------------------------------------------

describe('SqlEngineError', () => {
  it('has correct name and code', () => {
    const err = new SqlEngineError('EXECUTION_ERROR', 'Bad SQL');
    assert.strictEqual(err.name, 'SqlEngineError');
    assert.strictEqual(err.code, 'EXECUTION_ERROR');
    assert.ok(err instanceof Error);
  });
});

