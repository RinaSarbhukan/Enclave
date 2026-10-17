import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLinearRegression,
  classifyCorrelation,
  computeCorrelationMatrix,
  getCorrelationColor
} from '../js/correlationMatrix.js';

test('Correlation - computeLinearRegression calculates exact slope, intercept, and R²', () => {
  // y = 2x + 1
  const x = [1, 2, 3, 4, 5];
  const y = [3, 5, 7, 9, 11];

  const reg = computeLinearRegression(x, y);
  assert.ok(reg !== null);
  assert.equal(reg.slope, 2);
  assert.equal(reg.intercept, 1);
  assert.equal(reg.r, 1);
  assert.equal(reg.rSquared, 1);
  assert.equal(reg.predict(10), 21);
});

test('Correlation - computeLinearRegression handles inverse linear relationship', () => {
  // y = -3x + 10
  const x = [1, 2, 3, 4, 5];
  const y = [7, 4, 1, -2, -5];

  const reg = computeLinearRegression(x, y);
  assert.ok(reg !== null);
  assert.equal(reg.slope, -3);
  assert.equal(reg.intercept, 10);
  assert.equal(reg.r, -1);
  assert.equal(reg.rSquared, 1);
});

test('Correlation - computeLinearRegression guards against zero variance and small n', () => {
  // All x values identical -> zero variance in X
  const xSame = [5, 5, 5, 5];
  const y = [1, 2, 3, 4];
  assert.equal(computeLinearRegression(xSame, y), null);

  // Less than 2 pairs
  assert.equal(computeLinearRegression([1], [2]), null);
});

test('Correlation - classifyCorrelation categorizes strengths and directions correctly', () => {
  const c1 = classifyCorrelation(0.85);
  assert.equal(c1.strength, 'Strong');
  assert.equal(c1.direction, 'positive');

  const c2 = classifyCorrelation(-0.62);
  assert.equal(c2.strength, 'Moderate');
  assert.equal(c2.direction, 'negative');

  const c3 = classifyCorrelation(0.02);
  assert.equal(c3.strength, 'Negligible');

  const c4 = classifyCorrelation(null);
  assert.equal(c4.strength, 'None');
});

test('Correlation - computeCorrelationMatrix computes symmetric matrix and ranks top pairs', () => {
  const headers = [
    { key: 'id', label: 'ID', type: 'identifier' },
    { key: 'units', label: 'Units Sold', type: 'numeric' },
    { key: 'unit_price', label: 'Unit Price', type: 'numeric' },
    { key: 'total_revenue', label: 'Total Revenue', type: 'numeric' },
    { key: 'region', label: 'Region', type: 'categorical' }
  ];

  const rows = [
    new Map([['id', '1'], ['units', 10], ['unit_price', 100], ['total_revenue', 1000], ['region', 'East']]),
    new Map([['id', '2'], ['units', 20], ['unit_price', 90], ['total_revenue', 1800], ['region', 'West']]),
    new Map([['id', '3'], ['units', 30], ['unit_price', 80], ['total_revenue', 2400], ['region', 'North']]),
    new Map([['id', '4'], ['units', 40], ['unit_price', 70], ['total_revenue', 2800], ['region', 'South']]),
    new Map([['id', '5'], ['units', 50], ['unit_price', 60], ['total_revenue', 3000], ['region', 'East']])
  ];

  const result = computeCorrelationMatrix(headers, rows);
  assert.equal(result.columns.length, 3); // units, unit_price, total_revenue (excludes id and region)
  assert.equal(result.matrix.length, 3);

  // Check diagonals are 1.00
  assert.equal(result.matrix[0][0].r, 1.0);
  assert.equal(result.matrix[1][1].r, 1.0);
  assert.equal(result.matrix[2][2].r, 1.0);

  // Check symmetry r[i][j] === r[j][i]
  assert.equal(result.matrix[0][1].r, result.matrix[1][0].r);
  assert.equal(result.matrix[0][2].r, result.matrix[2][0].r);
  assert.equal(result.matrix[1][2].r, result.matrix[2][1].r);

  // Units vs Unit Price should have negative correlation
  assert.ok(result.matrix[0][1].r < 0);

  // Units vs Total Revenue should have positive correlation
  assert.ok(result.matrix[0][2].r > 0);

  // Check topPairs length (3 combinations: (0,1), (0,2), (1,2))
  assert.equal(result.topPairs.length, 3);
  assert.ok(result.topPairs[0].absR >= result.topPairs[1].absR);
  assert.ok(result.topPairs[1].absR >= result.topPairs[2].absR);
});

test('Correlation - getCorrelationColor produces distinct styles for positive, negative, and neutral', () => {
  const pos = getCorrelationColor(0.8);
  const neg = getCorrelationColor(-0.8);
  const zero = getCorrelationColor(0);
  const nullColor = getCorrelationColor(null);

  assert.ok(pos.bg.includes('31, 79, 216')); // blue
  assert.ok(neg.bg.includes('225, 29, 72')); // red
  assert.ok(zero.text.length > 0);
  assert.ok(nullColor.text.length > 0);
});
