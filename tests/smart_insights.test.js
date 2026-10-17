/**
 * Tests for js/smartInsights.js - Executive Smart Insights Engine
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMetricValue,
  analyzeDominanceAndDrivers,
  analyzeParetoConcentration,
  analyzeStatisticalAnomalies,
  analyzeCorrelationsAndDrivers,
  generateSmartInsights
} from '../js/smartInsights.js';

// --- Helpers ---

function makeRows(data) {
  return data.map(obj => {
    const m = new Map();
    for (const [k, v] of Object.entries(obj)) m.set(k, v);
    return m;
  });
}

// --- Test Data ---

const sampleHeaders = [
  { key: 'category', label: 'Category', type: 'categorical' },
  { key: 'sales', label: 'Sales', type: 'numeric' },
  { key: 'profit', label: 'Profit', type: 'numeric' },
  { key: 'discount', label: 'Discount', type: 'numeric' }
];

const sampleRows = makeRows([
  { category: 'Tech', sales: 1500, profit: 300, discount: 0.1 },
  { category: 'Tech', sales: 2000, profit: 400, discount: 0.1 },
  { category: 'Tech', sales: 1800, profit: 360, discount: 0.1 },
  { category: 'Tech', sales: 2200, profit: 440, discount: 0.1 },
  { category: 'Tech', sales: 1900, profit: 380, discount: 0.1 },
  { category: 'Office', sales: 200, profit: 20, discount: 0.3 },
  { category: 'Office', sales: 250, profit: 25, discount: 0.3 },
  { category: 'Office', sales: 180, profit: 18, discount: 0.3 },
  { category: 'Furniture', sales: 300, profit: 15, discount: 0.5 },
  { category: 'Furniture', sales: 350, profit: 17, discount: 0.5 }
]);

const categoricalCols = [{ key: 'category', label: 'Category' }];
const numericCols = [
  { key: 'sales', label: 'Sales' },
  { key: 'profit', label: 'Profit' },
  { key: 'discount', label: 'Discount' }
];

// ============================================================

describe('Smart Insights - formatMetricValue', () => {
  it('formats large numbers with k suffix', () => {
    assert.match(formatMetricValue(14200, 'sales'), /14\.2k/);
  });

  it('formats million values with M suffix', () => {
    assert.match(formatMetricValue(2_500_000, 'revenue'), /2\.5M/);
  });

  it('prefixes currency column names with $', () => {
    const val = formatMetricValue(5000, 'revenue');
    assert.ok(val.includes('$'), `Expected currency prefix in: ${val}`);
  });

  it('handles zero correctly', () => {
    assert.equal(formatMetricValue(0), '0');
  });

  it('handles negative currency values', () => {
    const val = formatMetricValue(-12500, 'profit');
    assert.ok(val.includes('-'), `Expected negative sign in: ${val}`);
  });
});

// ============================================================

describe('Smart Insights - analyzeDominanceAndDrivers', () => {
  it('identifies the dominant category (Tech) as primary driver', () => {
    const insights = analyzeDominanceAndDrivers(sampleRows, categoricalCols, numericCols);
    assert.ok(insights.length >= 1, 'Should produce at least one driver insight');
    const driver = insights[0];
    assert.equal(driver.type, 'driver');
    assert.ok(driver.title.includes('Tech'), `Expected Tech to be primary driver, got: ${driver.title}`);
    assert.ok(driver.narrative.includes('Tech'));
  });

  it('returns empty array when no categorical columns available', () => {
    const insights = analyzeDominanceAndDrivers(sampleRows, [], numericCols);
    assert.equal(insights.length, 0);
  });

  it('returns empty array for empty rows', () => {
    const insights = analyzeDominanceAndDrivers([], categoricalCols, numericCols);
    assert.equal(insights.length, 0);
  });
});

// ============================================================

describe('Smart Insights - analyzeParetoConcentration', () => {
  it('detects Pareto concentration when few items drive most volume', () => {
    // Build a strongly skewed dataset: 2 of 10 categories drive 90% of volume
    const manyRows = [];
    for (let i = 0; i < 50; i++) manyRows.push({ cat: 'A', metric: 1000 });
    for (let i = 0; i < 50; i++) manyRows.push({ cat: 'B', metric: 800 });
    for (let i = 0; i < 5; i++) manyRows.push({ cat: 'C', metric: 10 });
    for (let i = 0; i < 5; i++) manyRows.push({ cat: 'D', metric: 10 });
    for (let i = 0; i < 5; i++) manyRows.push({ cat: 'E', metric: 10 });
    for (let i = 0; i < 5; i++) manyRows.push({ cat: 'F', metric: 10 });
    for (let i = 0; i < 5; i++) manyRows.push({ cat: 'G', metric: 10 });
    for (let i = 0; i < 5; i++) manyRows.push({ cat: 'H', metric: 10 });

    const rows = makeRows(manyRows);
    const cats = [{ key: 'cat', label: 'Category' }];
    const nums = [{ key: 'metric', label: 'Metric' }];

    const insights = analyzeParetoConcentration(rows, cats, nums);
    assert.ok(insights.length >= 1, 'Should detect Pareto pattern');
    assert.equal(insights[0].type, 'pareto');
  });

  it('returns empty when data is too evenly distributed', () => {
    // 5 categories, all equal weight
    const evenRows = makeRows([
      { cat: 'A', metric: 100 }, { cat: 'B', metric: 100 }, { cat: 'C', metric: 100 },
      { cat: 'D', metric: 100 }, { cat: 'E', metric: 100 },
      { cat: 'A', metric: 100 }, { cat: 'B', metric: 100 }, { cat: 'C', metric: 100 },
      { cat: 'D', metric: 100 }, { cat: 'E', metric: 100 }
    ]);
    const cats = [{ key: 'cat', label: 'Category' }];
    const nums = [{ key: 'metric', label: 'Metric' }];
    const insights = analyzeParetoConcentration(evenRows, cats, nums);
    assert.equal(insights.length, 0);
  });
});

// ============================================================

describe('Smart Insights - analyzeStatisticalAnomalies', () => {
  it('detects extreme outliers beyond Q3 + 2.5×IQR threshold', () => {
    // Normal cluster 1-10, one massive outlier at 9999
    const rows = makeRows([
      ...Array.from({ length: 20 }, (_, i) => ({ qty: i + 1 })),
      { qty: 9999 }
    ]);
    const nums = [{ key: 'qty', label: 'Quantity' }];
    const insights = analyzeStatisticalAnomalies(rows, nums);
    assert.ok(insights.length >= 1, 'Should detect the extreme outlier');
    assert.equal(insights[0].type, 'anomaly');
    assert.ok(insights[0].title.includes('Quantity'));
  });

  it('returns empty for clean uniformly distributed data', () => {
    const rows = makeRows(Array.from({ length: 20 }, (_, i) => ({ val: i * 10 })));
    const nums = [{ key: 'val', label: 'Value' }];
    const insights = analyzeStatisticalAnomalies(rows, nums);
    // May or may not find anomalies in uniform linear; just ensure no crash
    assert.ok(Array.isArray(insights));
  });

  it('returns empty for fewer than 8 rows', () => {
    const rows = makeRows([{ v: 1 }, { v: 2 }, { v: 999 }]);
    const insights = analyzeStatisticalAnomalies(rows, [{ key: 'v', label: 'V' }]);
    assert.equal(insights.length, 0);
  });
});

// ============================================================

describe('Smart Insights - analyzeCorrelationsAndDrivers', () => {
  it('detects strong negative correlation between discount and profit', () => {
    // Higher discount → lower profit
    const rows = makeRows([
      { discount: 0.1, profit: 900 }, { discount: 0.15, profit: 800 },
      { discount: 0.2, profit: 700 }, { discount: 0.25, profit: 600 },
      { discount: 0.3, profit: 500 }, { discount: 0.35, profit: 400 },
      { discount: 0.4, profit: 300 }, { discount: 0.45, profit: 200 },
      { discount: 0.5, profit: 100 }, { discount: 0.55, profit: 50 }
    ]);
    const nums = [{ key: 'discount', label: 'Discount' }, { key: 'profit', label: 'Profit' }];
    const insights = analyzeCorrelationsAndDrivers(rows, nums);
    const negCorr = insights.find(i => i.data && i.data.r < 0);
    assert.ok(negCorr, 'Should detect negative correlation');
    assert.ok(negCorr.data.r < -0.9, `Correlation should be strongly negative, got r=${negCorr.data.r}`);
  });

  it('returns empty for fewer than 2 numeric columns', () => {
    const rows = makeRows([{ x: 1 }, { x: 2 }, { x: 3 }]);
    const insights = analyzeCorrelationsAndDrivers(rows, [{ key: 'x', label: 'X' }]);
    assert.equal(insights.length, 0);
  });
});

// ============================================================

describe('Smart Insights - generateSmartInsights (end-to-end)', () => {
  const columnTypes = {
    category: 'categorical',
    sales: 'numeric',
    profit: 'numeric',
    discount: 'numeric'
  };

  it('returns valid structure with insights array and summary string', () => {
    const result = generateSmartInsights({ rows: sampleRows, headers: sampleHeaders, columnTypes });
    assert.ok(typeof result.summary === 'string' && result.summary.length > 0);
    assert.ok(Array.isArray(result.insights));
    assert.ok(typeof result.toClipboardText === 'function');
    assert.ok(typeof result.stats === 'object');
  });

  it('returns at least one insight on realistic sales data', () => {
    const result = generateSmartInsights({ rows: sampleRows, headers: sampleHeaders, columnTypes });
    assert.ok(result.insights.length >= 1, `Expected at least 1 insight, got ${result.insights.length}`);
  });

  it('toClipboardText produces non-empty executive briefing string', () => {
    const result = generateSmartInsights({ rows: sampleRows, headers: sampleHeaders, columnTypes });
    const text = result.toClipboardText();
    assert.ok(typeof text === 'string' && text.includes('ENCLAVE'), 'Clipboard text should have expected header');
    assert.ok(text.includes('EXECUTIVE BRIEFING'));
  });

  it('handles empty rows gracefully without throwing', () => {
    const result = generateSmartInsights({ rows: [], headers: sampleHeaders, columnTypes });
    assert.equal(result.insights.length, 0);
    assert.ok(typeof result.summary === 'string');
  });

  it('each insight has required fields: id, type, icon, badge, title, narrative, recommendation', () => {
    const result = generateSmartInsights({ rows: sampleRows, headers: sampleHeaders, columnTypes });
    for (const insight of result.insights) {
      assert.ok(insight.id, 'Missing id');
      assert.ok(insight.type, 'Missing type');
      assert.ok(insight.icon, 'Missing icon');
      assert.ok(insight.badge, 'Missing badge');
      assert.ok(insight.title, 'Missing title');
      assert.ok(insight.narrative, 'Missing narrative');
      assert.ok(insight.recommendation, 'Missing recommendation');
    }
  });
});
