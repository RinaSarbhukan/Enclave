import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  isColumnChartable,
  determineDateBucket,
  formatDateBucket,
  recommendCharts,
  buildChartData
} from '../js/chartRecommender.js';

import {
  applyFilters,
  sortRows
} from '../js/tableManager.js';

import {
  applySingleOperation,
  applyOperations,
  previewCleaningOperation
} from '../js/dataCleaner.js';

import { parseCsvContent } from '../js/csvParser.js';
import { profileDataset } from '../js/dataAnalyzer.js';

test('Recommender - Date bucketing algorithm yields ~12-60 points', () => {
  assert.equal(determineDateBucket(20), 'day');
  assert.equal(determineDateBucket(100), 'week');
  assert.equal(determineDateBucket(400), 'month');
  assert.equal(determineDateBucket(2000), 'year');
});

test('Recommender - Column chartability rules', () => {
  assert.equal(isColumnChartable({ type: 'identifier', missingPercentage: 0 }), false);
  assert.equal(isColumnChartable({ type: 'text', missingPercentage: 0 }), false);
  assert.equal(isColumnChartable({ type: 'numeric', missingPercentage: 60 }), false);
  assert.equal(isColumnChartable({ type: 'numeric', missingPercentage: 10, stats: { distinctCount: 1 } }), false);
  assert.equal(isColumnChartable({ type: 'numeric', missingPercentage: 5, stats: { distinctCount: 20 } }), true);
});

test('Recommender - Produces ranked recommendations on sample sales data', async () => {
  const csv = fs.readFileSync('data/sample-sales.csv', 'utf8');
  const parsed = await parseCsvContent(csv);
  const profile = profileDataset(parsed.headers, parsed.rows);

  const recommendations = recommendCharts(parsed.headers, profile.columnProfiles, parsed.rows);
  assert.ok(recommendations.length >= 3);

  // Top recommendation should be Line or Bar with high score (>= 90)
  const topRec = recommendations[0];
  assert.ok(topRec.score >= 90);
  assert.ok(['line', 'bar'].includes(topRec.type));

  // Verify chart data aggregation
  const chartData = buildChartData(topRec, parsed.rows, parsed.headers);
  assert.ok(chartData.labels.length > 0);
  assert.ok(chartData.datasets[0].data.length > 0);
});

test('Recommender - Collapses categories beyond top 10 into Other', () => {
  const headers = [{ key: 'cat', label: 'Category' }, { key: 'val', label: 'Value' }];
  const rows = [];
  for (let i = 1; i <= 20; i++) {
    const row = new Map();
    row.set('cat', `Category_${i}`);
    row.set('val', i * 10);
    rows.push(row);
  }

  const chartConfig = { type: 'bar', x: 'cat', y: 'val', aggregation: 'sum' };
  const dataCollapsed = buildChartData(chartConfig, rows, headers, { expandOther: false });

  // Top 10 + 1 "Other"
  assert.equal(dataCollapsed.labels.length, 11);
  assert.ok(dataCollapsed.labels[10].startsWith('Other'));

  // When expandOther is true, all 20 categories rendered
  const dataExpanded = buildChartData(chartConfig, rows, headers, { expandOther: true });
  assert.equal(dataExpanded.labels.length, 20);
});

test('Table Manager - Filtering across search, numeric range, and categories', () => {
  const headers = [
    { key: 'name', type: 'text' },
    { key: 'dept', type: 'categorical' },
    { key: 'score', type: 'numeric' }
  ];

  const r1 = new Map([['name', 'Alice'], ['dept', 'Engineering'], ['score', 95]]);
  const r2 = new Map([['name', 'Bob'], ['dept', 'Design'], ['score', 80]]);
  const r3 = new Map([['name', 'Charlie'], ['dept', 'Engineering'], ['score', 65]]);
  const rows = [r1, r2, r3];

  // 1. Global search
  const filteredSearch = applyFilters(rows, headers, { globalSearch: 'alice' });
  assert.equal(filteredSearch.length, 1);
  assert.equal(filteredSearch[0].get('name'), 'Alice');

  // 2. Numeric min/max filter
  const filteredNum = applyFilters(rows, headers, {
    columnFilters: { score: { type: 'numeric', min: 70, max: 90 } }
  });
  assert.equal(filteredNum.length, 1);
  assert.equal(filteredNum[0].get('name'), 'Bob');

  // 3. Categorical multiselect
  const filteredCat = applyFilters(rows, headers, {
    columnFilters: { dept: { type: 'categorical', selectedValues: ['Engineering'] } }
  });
  assert.equal(filteredCat.length, 2);
});

test('Table Manager - Type-aware sorting', () => {
  const r1 = new Map([['val', 10]]);
  const r2 = new Map([['val', 5]]);
  const r3 = new Map([['val', 20]]);
  const rows = [r1, r2, r3];

  const sortedAsc = sortRows(rows, 'val', 'asc', 'numeric');
  assert.equal(sortedAsc[0].get('val'), 5);
  assert.equal(sortedAsc[2].get('val'), 20);

  const sortedDesc = sortRows(rows, 'val', 'desc', 'numeric');
  assert.equal(sortedDesc[0].get('val'), 20);
  assert.equal(sortedDesc[2].get('val'), 5);
});

test('Data Cleaner - Remove duplicates, trim whitespace, and handle blanks', () => {
  const headers = [
    { key: 'id', label: 'ID', type: 'identifier' },
    { key: 'city', label: 'City', type: 'text' },
    { key: 'val', label: 'Val', type: 'numeric' }
  ];

  const r1 = new Map([['id', '1'], ['city', '  Paris  '], ['val', 10]]);
  const r2 = new Map([['id', '1'], ['city', 'Paris'], ['val', 10]]);
  const r3 = new Map([['id', '2'], ['city', null], ['val', null]]);
  const rows = [r1, r2, r3];

  // Trim whitespace
  const trimOp = { type: 'trim_whitespace', columnKey: 'city' };
  const trimmed = applySingleOperation(trimOp, headers, rows);
  assert.equal(trimmed.rows[0].get('city'), 'Paris');

  // Preview remove duplicates
  const dupOp = { type: 'remove_duplicates' };
  const preview = previewCleaningOperation(dupOp, headers, trimmed.rows);
  assert.equal(preview.affectedRowsCount, 1);

  // Apply remove duplicates
  const deduped = applySingleOperation(dupOp, headers, trimmed.rows);
  assert.equal(deduped.rows.length, 2);

  // Drop rows with blanks
  const blankOp = { type: 'handle_blanks', mode: 'drop_rows', columnKey: 'val' };
  const cleaned = applySingleOperation(blankOp, headers, deduped.rows);
  assert.equal(cleaned.rows.length, 1);
  assert.equal(cleaned.rows[0].get('id'), '1');
});

test('Data Cleaner - Full multi-step pipeline with undo capability', () => {
  const headers = [
    { key: 'a', label: 'Col A', type: 'numeric' },
    { key: 'b', label: 'Col B', type: 'numeric' }
  ];
  const rows = [
    new Map([['a', 10], ['b', 100]]),
    new Map([['a', 20], ['b', 200]]),
    new Map([['a', 20], ['b', 200]]) // duplicate
  ];

  const ops = [
    { type: 'remove_duplicates' },
    { type: 'drop_columns', columns: ['b'] }
  ];

  // Run pipeline
  const res = applyOperations(ops, headers, rows);
  assert.equal(res.rows.length, 2);
  assert.equal(res.headers.length, 1);
  assert.equal(res.headers[0].key, 'a');

  // Undo last operation (drop b) by running ops.slice(0, 1)
  const undone = applyOperations(ops.slice(0, 1), headers, rows);
  assert.equal(undone.rows.length, 2);
  assert.equal(undone.headers.length, 2);
  assert.ok(undone.headers.some(h => h.key === 'b'));
});
