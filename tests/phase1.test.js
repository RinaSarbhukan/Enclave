import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseNumber,
  parseDate,
  parseBoolean,
  isMissingValue,
  computeNumericStats,
  computeCategoricalStats,
  computeDateStats,
  computePearsonCorrelation,
  computeHistogramBins,
  sanitizeForFormulaInjection,
  generateSafeColumnKey
} from '../js/utils.js';

import {
  parseCsvContent,
  normalizeHeaders,
  validateFileMetadata
} from '../js/csvParser.js';

import {
  inferColumnType,
  coerceRowTypes,
  countDuplicateRows,
  profileDataset
} from '../js/dataAnalyzer.js';

const FIXTURES_DIR = path.resolve('tests/fixtures');

function readFixture(filename) {
  return fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf8');
}

test('Utils - Number parsing with currency, commas, parentheses negative, and percent', () => {
  assert.equal(parseNumber('$1,234.56'), 1234.56);
  assert.equal(parseNumber('(500.25)'), -500.25);
  assert.equal(parseNumber('25%'), 0.25);
  assert.equal(parseNumber('1.234,56', 'comma'), 1234.56);
  assert.equal(parseNumber('NA'), null);
  assert.equal(parseNumber(''), null);
});

test('Utils - Date parsing handles ISO and slash dates', () => {
  const d1 = parseDate('2023-05-14');
  assert.ok(d1 instanceof Date);
  assert.equal(d1.getUTCFullYear(), 2023);
  assert.equal(d1.getUTCMonth(), 4);
  assert.equal(d1.getUTCDate(), 14);

  const d2 = parseDate('15/04/2020'); // DD/MM/YYYY auto disambiguated because 15 > 12
  assert.ok(d2 instanceof Date);
  assert.equal(d2.getUTCFullYear(), 2020);
  assert.equal(d2.getUTCMonth(), 3);
  assert.equal(d2.getUTCDate(), 15);
});

test('Utils - Formula injection sanitization', () => {
  assert.equal(sanitizeForFormulaInjection('=SUM(A1:A10)'), "'=SUM(A1:A10)");
  assert.equal(sanitizeForFormulaInjection('+cmd|'), "'+cmd|");
  assert.equal(sanitizeForFormulaInjection('-123'), "'-123");
  assert.equal(sanitizeForFormulaInjection('@HYPERLINK()'), "'@HYPERLINK()");
  assert.equal(sanitizeForFormulaInjection('Safe Text'), 'Safe Text');
});

test('Utils - Safe column key generation blocks prototype pollution', () => {
  const existing = new Set();
  const k1 = generateSafeColumnKey('__proto__', 0, existing);
  assert.notEqual(k1, '__proto__');
  assert.ok(k1.startsWith('safe___proto__'));

  const k2 = generateSafeColumnKey('constructor', 1, existing);
  assert.notEqual(k2, 'constructor');

  const k3 = generateSafeColumnKey('Sales Amount', 2, existing);
  assert.equal(k3, 'sales_amount');

  // Duplicate key disambiguation
  const k4 = generateSafeColumnKey('Sales Amount', 3, existing);
  assert.equal(k4, 'sales_amount_1');
});

test('Utils - Sample standard deviation & stats with n >= 2 and zero guard', () => {
  const emptyStats = computeNumericStats([]);
  assert.equal(emptyStats.count, 0);
  assert.equal(emptyStats.mean, null);
  assert.equal(emptyStats.stdDev, null);

  const singleStats = computeNumericStats([100]);
  assert.equal(singleStats.count, 1);
  assert.equal(singleStats.mean, 100);
  assert.equal(singleStats.stdDev, 0);

  // [10, 20, 30] -> mean = 20, variance = ((100 + 0 + 100) / 2) = 100 -> stdDev = 10
  const stats = computeNumericStats([10, 20, 30]);
  assert.equal(stats.count, 3);
  assert.equal(stats.sum, 60);
  assert.equal(stats.mean, 20);
  assert.equal(stats.median, 20);
  assert.equal(stats.stdDev, 10);
});

test('Utils - Pearson correlation coefficient', () => {
  const x = [1, 2, 3, 4, 5];
  const y = [2, 4, 6, 8, 10]; // perfectly correlated
  const r = computePearsonCorrelation(x, y);
  assert.equal(r, 1);

  const yInv = [10, 8, 6, 4, 2]; // perfectly negatively correlated
  const rInv = computePearsonCorrelation(x, yInv);
  assert.equal(rInv, -1);
});

test('Fixture 1: normal-sales.csv - parse, infer types, and calculate aggregates', async () => {
  const csv = readFixture('normal-sales.csv');
  const parsed = await parseCsvContent(csv);

  assert.equal(parsed.rows.length, 10);
  assert.equal(parsed.headers.length, 5);

  const profile = profileDataset(parsed.headers, parsed.rows);
  assert.equal(profile.totalRows, 10);
  assert.equal(profile.totalColumns, 5);
  assert.equal(profile.duplicateRows, 0);

  const dateCol = parsed.headers.find(h => h.key === 'date');
  const salesCol = parsed.headers.find(h => h.key === 'sales');
  const qtyCol = parsed.headers.find(h => h.key === 'quantity');
  const catCol = parsed.headers.find(h => h.key === 'category');

  assert.equal(dateCol.type, 'date');
  assert.equal(salesCol.type, 'numeric');
  assert.equal(qtyCol.type, 'numeric');
  assert.equal(catCol.type, 'categorical');

  const salesProfile = profile.columnProfiles.get('sales');
  // Sum = 150.5 + 200 + 450 + 300 + 45 + 25.5 + 180 + 900 + 320 + 51 = 2622
  assert.equal(salesProfile.stats.sum, 2622);
  assert.equal(salesProfile.stats.min, 25.5);
  assert.equal(salesProfile.stats.max, 900);
});

test('Fixture 2: numeric-only.csv - accurate multi-column statistics', async () => {
  const csv = readFixture('numeric-only.csv');
  const parsed = await parseCsvContent(csv);
  assert.equal(parsed.rows.length, 8);

  const profile = profileDataset(parsed.headers, parsed.rows);
  for (const h of parsed.headers) {
    assert.equal(h.type, 'numeric');
  }

  const ageProfile = profile.columnProfiles.get('age');
  assert.equal(ageProfile.stats.count, 8);
  assert.equal(ageProfile.stats.min, 22);
  assert.equal(ageProfile.stats.max, 50);
});

test('Fixture 3: categorical-only.csv - mode and frequency distribution', async () => {
  const csv = readFixture('categorical-only.csv');
  const parsed = await parseCsvContent(csv);
  const profile = profileDataset(parsed.headers, parsed.rows);

  for (const h of parsed.headers) {
    assert.equal(h.type, 'categorical');
  }

  const deptProfile = profile.columnProfiles.get('department');
  assert.equal(deptProfile.stats.distinctCount, 4);
  assert.equal(deptProfile.stats.mode, 'Engineering');
  assert.equal(deptProfile.stats.frequencies[0].count, 3);
});

test('Fixture 4: date-numeric.csv - timeline date span & bucket stats', async () => {
  const csv = readFixture('date-numeric.csv');
  const parsed = await parseCsvContent(csv);
  const profile = profileDataset(parsed.headers, parsed.rows);

  const tsCol = parsed.headers[0];
  assert.equal(tsCol.type, 'date');
  const tsProfile = profile.columnProfiles.get(tsCol.key);
  assert.equal(tsProfile.stats.spanDays, 7);
  assert.equal(tsProfile.stats.min, '2024-01-01');
  assert.equal(tsProfile.stats.max, '2024-01-08');
});

test('Fixture 5: missing-values.csv - all missing value tokens recognized', async () => {
  const csv = readFixture('missing-values.csv');
  const parsed = await parseCsvContent(csv);
  const profile = profileDataset(parsed.headers, parsed.rows);

  // Missing tokens in Score column: NA, -, ?, NaN -> 4 missing values out of 8 rows (50%)
  const scoreProfile = profile.columnProfiles.get('score');
  assert.equal(scoreProfile.missingCount, 4);
  assert.equal(scoreProfile.missingPercentage, 50);
  assert.ok(profile.totalMissingCells > 0);
});

test('Fixture 6: duplicates.csv - counts exact duplicate rows', async () => {
  const csv = readFixture('duplicates.csv');
  const parsed = await parseCsvContent(csv);
  const profile = profileDataset(parsed.headers, parsed.rows);

  assert.equal(parsed.rows.length, 7);
  // Paris occurs 3 times (2 duplicates), Tokyo occurs 2 times (1 duplicate), total duplicates = 3
  assert.equal(profile.duplicateRows, 3);
});

test('Fixture 7: quoted-multiline.csv - multiline fields and quotes handled', async () => {
  const csv = readFixture('quoted-multiline.csv');
  const parsed = await parseCsvContent(csv);
  assert.equal(parsed.rows.length, 3);

  const descCol = parsed.headers.find(h => h.key === 'description');
  const firstRowDesc = parsed.rows[0].get(descCol.key);
  assert.ok(firstRowDesc.includes('\n'));
  assert.ok(firstRowDesc.includes('"quotes"'));
});

test('Fixture 8: unusual-headers.csv - safely handles __proto__, constructor, and duplicate headers', async () => {
  const csv = readFixture('unusual-headers.csv');
  const parsed = await parseCsvContent(csv);

  assert.equal(parsed.rows.length, 2);
  const keys = parsed.headers.map(h => h.key);
  assert.ok(!keys.includes('__proto__'));
  assert.ok(!keys.includes('constructor'));
  assert.ok(keys.includes('revenue'));
  assert.ok(keys.includes('revenue_1')); // duplicate renamed safely

  // Row Map prototype not polluted
  assert.equal(typeof Object.prototype.polluted, 'undefined');
  const r0 = parsed.rows[0];
  assert.equal(r0.get(keys[2]), '100');
  assert.equal(r0.get(keys[3]), '200');
});

test('Fixture 9: empty-file.csv - rejects with clean descriptive error', async () => {
  const csv = readFixture('empty-file.csv');
  await assert.rejects(
    async () => {
      await parseCsvContent(csv);
    },
    /empty/i
  );
});

test('Fixture 10: malformed-file.csv - detects and reports malformed row errors', async () => {
  const csv = readFixture('malformed-file.csv');
  const parsed = await parseCsvContent(csv);
  assert.ok(parsed.malformedRows.length > 0);
});

test('Demo dataset: sample-sales.csv - profiling and warnings verification', async () => {
  const csv = fs.readFileSync('data/sample-sales.csv', 'utf8');
  const parsed = await parseCsvContent(csv);

  assert.equal(parsed.rows.length, 800);
  assert.equal(parsed.headers.length, 8);

  const profile = profileDataset(parsed.headers, parsed.rows);
  assert.equal(profile.totalRows, 800);
  assert.equal(profile.totalColumns, 8);
  assert.equal(profile.duplicateRows, 8); // We intentionally seeded 8 duplicate rows
  assert.ok(profile.totalMissingCells >= 5); // We intentionally seeded missing cells

  // Order ID should be inferred as identifier
  const orderIdCol = parsed.headers.find(h => h.label === 'Order ID');
  assert.equal(orderIdCol.type, 'identifier');

  // Revenue should be numeric
  const revCol = parsed.headers.find(h => h.label === 'Revenue');
  assert.equal(revCol.type, 'numeric');

  // Order Date should be date
  const dateCol = parsed.headers.find(h => h.label === 'Order Date');
  assert.equal(dateCol.type, 'date');
});
