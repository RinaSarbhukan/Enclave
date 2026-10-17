import test from 'node:test';
import assert from 'node:assert/strict';
import { applySingleOperation, applyOperations, previewCleaningOperation } from '../js/dataCleaner.js';

test('Data Cleaner - Case conversion (Title Case, UPPERCASE, lowercase)', () => {
  const headers = [{ key: 'name', label: 'Name', type: 'text' }];
  const rows = [
    new Map([['name', 'john doe']]),
    new Map([['name', 'ALICE SMITH']])
  ];

  // Title Case
  const titleResult = applySingleOperation({ type: 'change_case', mode: 'title' }, headers, rows);
  assert.equal(titleResult.rows[0].get('name'), 'John Doe');
  assert.equal(titleResult.rows[1].get('name'), 'Alice Smith');

  // Upper
  const upperResult = applySingleOperation({ type: 'change_case', mode: 'upper' }, headers, rows);
  assert.equal(upperResult.rows[0].get('name'), 'JOHN DOE');

  // Lower
  const lowerResult = applySingleOperation({ type: 'change_case', mode: 'lower' }, headers, rows);
  assert.equal(lowerResult.rows[1].get('name'), 'alice smith');
});

test('Data Cleaner - Round numbers to decimal places', () => {
  const headers = [{ key: 'price', label: 'Price', type: 'numeric' }];
  const rows = [
    new Map([['price', 19.9942]]),
    new Map([['price', 4.5678]])
  ];

  const round2 = applySingleOperation({ type: 'round_numbers', decimals: 2 }, headers, rows);
  assert.equal(round2.rows[0].get('price'), 19.99);
  assert.equal(round2.rows[1].get('price'), 4.57);

  const round0 = applySingleOperation({ type: 'round_numbers', decimals: 0 }, headers, rows);
  assert.equal(round0.rows[0].get('price'), 20);
  assert.equal(round0.rows[1].get('price'), 5);
});

test('Data Cleaner - Strip special characters', () => {
  const headers = [{ key: 'code', label: 'Code', type: 'text' }];
  const rows = [
    new Map([['code', '#Item-100!*']]),
    new Map([['code', 'PROD_200$$$']])
  ];

  const result = applySingleOperation({ type: 'strip_special_chars' }, headers, rows);
  assert.equal(result.rows[0].get('code'), 'Item-100');
  assert.equal(result.rows[1].get('code'), 'PROD_200');
});

test('Data Cleaner - Standardize dates to ISO format', () => {
  const headers = [{ key: 'date', label: 'Date', type: 'date' }];
  const rows = [
    new Map([['date', '2023/04/15']]),
    new Map([['date', new Date('2024-11-20')]])
  ];

  const result = applySingleOperation({ type: 'standardize_dates' }, headers, rows);
  assert.equal(result.rows[0].get('date'), '2023-04-15');
  assert.equal(result.rows[1].get('date'), '2024-11-20');
});

test('Data Cleaner - Filter statistical outliers using IQR', () => {
  const headers = [{ key: 'val', label: 'Val', type: 'numeric' }];
  // 10 normal numbers around 50, and one massive outlier 9999
  const rows = [
    new Map([['val', 45]]),
    new Map([['val', 48]]),
    new Map([['val', 50]]),
    new Map([['val', 52]]),
    new Map([['val', 55]]),
    new Map([['val', 58]]),
    new Map([['val', 60]]),
    new Map([['val', 9999]]) // Outlier
  ];

  const result = applySingleOperation({ type: 'remove_outliers', columnKey: 'val' }, headers, rows);
  assert.equal(result.rows.length, 7);
  assert.ok(!result.rows.some(r => r.get('val') === 9999));
});

test('Data Cleaner - Drop empty columns', () => {
  const headers = [
    { key: 'id', label: 'ID', type: 'identifier' },
    { key: 'empty_col', label: 'Empty Col', type: 'text' },
    { key: 'name', label: 'Name', type: 'text' }
  ];
  const rows = [
    new Map([['id', '1'], ['empty_col', null], ['name', 'Item A']]),
    new Map([['id', '2'], ['empty_col', ''], ['name', 'Item B']]),
    new Map([['id', '3'], ['empty_col', undefined], ['name', 'Item C']])
  ];

  const result = applySingleOperation({ type: 'drop_empty_columns' }, headers, rows);
  assert.equal(result.headers.length, 2);
  assert.ok(!result.headers.some(h => h.key === 'empty_col'));
  assert.ok(!result.rows[0].has('empty_col'));
});

test('Data Cleaner - Impute median and mode', () => {
  const headers = [
    { key: 'price', label: 'Price', type: 'numeric' },
    { key: 'cat', label: 'Category', type: 'categorical' }
  ];
  const rows = [
    new Map([['price', 10], ['cat', 'A']]),
    new Map([['price', 20], ['cat', 'A']]),
    new Map([['price', 100], ['cat', 'B']]),
    new Map([['price', null], ['cat', null]])
  ];

  // Fill median
  const medianResult = applySingleOperation({ type: 'handle_blanks', mode: 'fill_median', columnKey: 'price' }, headers, rows);
  assert.equal(medianResult.rows[3].get('price'), 20);

  // Fill mode
  const modeResult = applySingleOperation({ type: 'handle_blanks', mode: 'fill_mode', columnKey: 'cat' }, headers, rows);
  assert.equal(modeResult.rows[3].get('cat'), 'A');
});
