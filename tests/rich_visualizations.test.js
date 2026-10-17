import test from 'node:test';
import assert from 'node:assert/strict';

import { computeBoxPlotStats } from '../js/utils.js';
import { recommendCharts, buildChartData } from '../js/chartRecommender.js';
import { validateChartSuitability } from '../js/dashboard.js';

test('Visualizations - computeBoxPlotStats computes quartiles, whiskers, and detects outliers', () => {
  // Ordered numbers with a high outlier 250
  const numbers = [10, 20, 25, 30, 35, 40, 45, 50, 55, 60, 250];
  const stats = computeBoxPlotStats(numbers);

  assert.ok(stats !== null);
  assert.equal(stats.count, 11);
  assert.equal(stats.min, 10);
  assert.equal(stats.max, 250);
  assert.equal(stats.median, 40);
  assert.ok(stats.q1 < stats.median);
  assert.ok(stats.q3 > stats.median);
  assert.ok(stats.iqr > 0);
  assert.ok(stats.lowerWhisker >= stats.min);
  assert.ok(stats.upperWhisker <= 65); // Outlier 250 is beyond upper fence
  assert.equal(stats.outliers.length, 1);
  assert.equal(stats.outliers[0], 250);
});

test('Visualizations - buildChartData constructs accurate boxplot data with floating bars and stats', () => {
  const headers = [
    { key: 'region', label: 'Region', type: 'categorical' },
    { key: 'revenue', label: 'Revenue', type: 'numeric' }
  ];

  const rows = [
    new Map([['region', 'North'], ['revenue', 100]]),
    new Map([['region', 'North'], ['revenue', 150]]),
    new Map([['region', 'North'], ['revenue', 200]]),
    new Map([['region', 'North'], ['revenue', 250]]),
    new Map([['region', 'North'], ['revenue', 300]]),
    new Map([['region', 'South'], ['revenue', 50]]),
    new Map([['region', 'South'], ['revenue', 80]]),
    new Map([['region', 'South'], ['revenue', 120]]),
    new Map([['region', 'South'], ['revenue', 140]]),
    new Map([['region', 'South'], ['revenue', 180]])
  ];

  const cfg = {
    type: 'boxplot',
    x: 'region',
    y: 'revenue'
  };

  const chartData = buildChartData(cfg, rows, headers);
  assert.equal(chartData.labels.length, 2);
  assert.ok(chartData.labels.includes('North'));
  assert.ok(chartData.labels.includes('South'));

  const dataset = chartData.datasets[0];
  assert.equal(dataset.data.length, 2);
  // Each data point is a [q1, q3] range for Chart.js floating bars
  assert.ok(Array.isArray(dataset.data[0]));
  assert.equal(dataset.data[0].length, 2);
  assert.ok(dataset._boxPlotStats.length === 2);
});

test('Visualizations - buildChartData constructs multi-metric bubble data with radius scaling', () => {
  const headers = [
    { key: 'cost', label: 'Cost', type: 'numeric' },
    { key: 'revenue', label: 'Revenue', type: 'numeric' },
    { key: 'units', label: 'Units', type: 'numeric' },
    { key: 'category', label: 'Category', type: 'categorical' }
  ];

  const rows = [
    new Map([['cost', 50], ['revenue', 100], ['units', 10], ['category', 'Tech']]),
    new Map([['cost', 80], ['revenue', 200], ['units', 50], ['category', 'Tech']]),
    new Map([['cost', 120], ['revenue', 300], ['units', 100], ['category', 'Office']])
  ];

  const cfg = {
    type: 'bubble',
    x: 'cost',
    y: 'revenue',
    z: 'units',
    categoryCol: 'category'
  };

  const chartData = buildChartData(cfg, rows, headers);
  assert.ok(chartData.datasets.length >= 2); // 'Tech' and 'Office'
  const techDs = chartData.datasets.find(d => d.label === 'Tech');
  assert.ok(techDs);
  assert.equal(techDs.data.length, 2);
  assert.equal(techDs.data[0].x, 50);
  assert.equal(techDs.data[0].y, 100);
  assert.ok(techDs.data[0].r >= 4); // Radius normalized
});

test('Visualizations - buildChartData constructs 2D heatmap matrix cross-tabulation', () => {
  const headers = [
    { key: 'region', label: 'Region', type: 'categorical' },
    { key: 'segment', label: 'Segment', type: 'categorical' },
    { key: 'profit', label: 'Profit', type: 'numeric' }
  ];

  const rows = [
    new Map([['region', 'East'], ['segment', 'Consumer'], ['profit', 500]]),
    new Map([['region', 'East'], ['segment', 'Corporate'], ['profit', 300]]),
    new Map([['region', 'West'], ['segment', 'Consumer'], ['profit', 400]]),
    new Map([['region', 'West'], ['segment', 'Corporate'], ['profit', 200]])
  ];

  const cfg = {
    type: 'heatmap',
    x: 'region',
    y: 'segment',
    z: 'profit',
    aggregation: 'sum'
  };

  const chartData = buildChartData(cfg, rows, headers);
  assert.equal(chartData.labels.length, 2); // East, West
  assert.equal(chartData.yLabels.length, 2); // Consumer, Corporate
  assert.equal(chartData.matrix.length, 2);
  assert.equal(chartData.matrix[0].length, 2);
  assert.ok(chartData.maxVal >= 500);
});

test('Visualizations - validateChartSuitability enforces rules for new chart types', () => {
  // Boxplot requires X categorical and Y numeric
  assert.equal(validateChartSuitability('boxplot', 'categorical', 'numeric', 'none').valid, true);
  assert.equal(validateChartSuitability('boxplot', 'numeric', 'numeric', 'none').valid, false);
  assert.equal(validateChartSuitability('boxplot', 'categorical', 'categorical', 'none').valid, false);

  // Bubble requires X numeric and Y numeric
  assert.equal(validateChartSuitability('bubble', 'numeric', 'numeric', 'none').valid, true);
  assert.equal(validateChartSuitability('bubble', 'categorical', 'numeric', 'none').valid, false);

  // Heatmap requires X categorical and Y categorical
  assert.equal(validateChartSuitability('heatmap', 'categorical', 'categorical', 'sum').valid, true);
  assert.equal(validateChartSuitability('heatmap', 'numeric', 'categorical', 'sum').valid, false);
});
