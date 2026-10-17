import test from 'node:test';
import assert from 'node:assert/strict';
import { profileDataset } from '../js/dataAnalyzer.js';
import { computeHistogramBins, computeNumericStats, computeCategoricalStats, computeDateStats } from '../js/utils.js';

test('Column Stats - Computes comprehensive statistics for numeric columns', () => {
  const numbers = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const stats = computeNumericStats(numbers);

  assert.equal(stats.count, 10);
  assert.equal(stats.min, 10);
  assert.equal(stats.max, 100);
  assert.equal(stats.mean, 55);
  assert.equal(stats.median, 55);
  assert.equal(stats.range, 90);
  assert.equal(stats.sum, 550);
  assert.ok(stats.stdDev > 0);

  const bins = computeHistogramBins(numbers, 5);
  assert.ok(bins.length >= 4);
  const totalBinCount = bins.reduce((acc, b) => acc + b.count, 0);
  assert.equal(totalBinCount, 10);
});

test('Column Stats - Categorical frequencies and mode', () => {
  const categories = ['North', 'South', 'East', 'North', 'North', 'West', 'East'];
  const stats = computeCategoricalStats(categories);

  assert.equal(stats.distinctCount, 4);
  assert.equal(stats.mode, 'North');
  assert.equal(stats.frequencies[0].value, 'North');
  assert.equal(stats.frequencies[0].count, 3);
  assert.ok(Math.abs(stats.frequencies[0].percentage - 42.86) < 0.1);
});

test('Column Stats - Date distribution and timespan', () => {
  const dates = [
    new Date('2023-01-01'),
    new Date('2023-06-15'),
    new Date('2024-03-20')
  ];
  const stats = computeDateStats(dates);

  assert.equal(stats.count, 3);
  assert.ok(stats.spanDays > 400);
  assert.equal(stats.byYear.length, 2);
  const y2023 = stats.byYear.find(y => y.label === '2023');
  assert.equal(y2023.count, 2);
});

test('Column Stats - profileDataset generates complete columnProfiles Map', () => {
  const headers = [
    { key: 'id', label: 'ID', type: 'identifier' },
    { key: 'revenue', label: 'Revenue', type: 'numeric' },
    { key: 'category', label: 'Category', type: 'categorical' },
    { key: 'active', label: 'Active', type: 'boolean' }
  ];

  const rows = [
    new Map([['id', '1'], ['revenue', 100], ['category', 'Tech'], ['active', true]]),
    new Map([['id', '2'], ['revenue', 250], ['category', 'Books'], ['active', false]]),
    new Map([['id', '3'], ['revenue', null], ['category', 'Tech'], ['active', true]]),
    new Map([['id', '4'], ['revenue', 500], ['category', 'Tech'], ['active', true]])
  ];

  const profile = profileDataset(headers, rows);
  assert.ok(profile.columnProfiles instanceof Map);

  const revProfile = profile.columnProfiles.get('revenue');
  assert.equal(revProfile.key, 'revenue');
  assert.equal(revProfile.missingCount, 1);
  assert.equal(revProfile.missingPercentage, 25);
  assert.equal(revProfile.stats.count, 3);
  assert.equal(revProfile.stats.min, 100);
  assert.equal(revProfile.stats.max, 500);

  const catProfile = profile.columnProfiles.get('category');
  assert.equal(catProfile.missingCount, 0);
  assert.equal(catProfile.stats.distinctCount, 2);
  assert.equal(catProfile.stats.frequencies[0].value, 'Tech');
  assert.equal(catProfile.stats.frequencies[0].count, 3);
});
