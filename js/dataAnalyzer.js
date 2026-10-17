/**
 * CSV Insight - Data Analyzer & Type Inference Engine
 * Pure analytics and profiling logic without DOM dependencies.
 */

import {
  parseNumber,
  parseDate,
  parseBoolean,
  isMissingValue,
  computeNumericStats,
  computeCategoricalStats,
  computeDateStats,
  estimateMemoryBytes
} from './utils.js';

export const TYPE_THRESHOLD = 0.90; // >= 90% non-missing values must match
export const SAMPLE_SIZE = 500; // >= 500 rows sample

const IDENTIFIER_REGEX = /\b(id|code|zip|postal|phone|sku|ref|uuid|guid|ssn|serial|order_?id|account_?id)\b/i;

/**
 * Detects whether a column's decimal format uses dot or comma.
 * @param {string[]} values
 * @returns {'dot'|'comma'}
 */
export function detectColumnDecimalSeparator(values) {
  let commaDecimals = 0;
  let dotDecimals = 0;

  for (const v of values) {
    if (!v) continue;
    const str = String(v).trim();
    if (/^\d{1,3}(\.\d{3})*,\d+$/.test(str) || (/,\d{1,2}$/.test(str) && !str.includes('.'))) {
      commaDecimals++;
    } else if (/^\d{1,3}(,\d{3})*\.\d+$/.test(str) || (/\.\d+$/.test(str) && !str.includes(','))) {
      dotDecimals++;
    }
  }

  return commaDecimals > dotDecimals ? 'comma' : 'dot';
}

/**
 * Checks if dates in column have ambiguity between DD/MM and MM/DD.
 * @param {string[]} values
 * @returns {boolean}
 */
export function detectDateAmbiguity(values) {
  let ambiguousCount = 0;
  for (const v of values) {
    if (!v) continue;
    const match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(String(v).trim());
    if (match) {
      const p1 = Number(match[1]);
      const p2 = Number(match[2]);
      if (p1 <= 12 && p2 <= 12 && p1 !== p2) {
        ambiguousCount++;
      }
    }
  }
  return ambiguousCount > 0;
}

/**
 * Infers the data type of a column based on a representative sample of values.
 * @param {string} colKey
 * @param {string} colLabel
 * @param {string[]} values
 * @param {object} [options={}]
 * @returns {{
 *   type: 'numeric'|'date'|'boolean'|'categorical'|'text'|'identifier',
 *   confidence: number,
 *   decimalSeparator: 'dot'|'comma',
 *   isAmbiguousDate: boolean,
 *   distinctCount: number,
 *   distinctRatio: number
 * }}
 */
export function inferColumnType(colKey, colLabel, values, options = {}) {
  const sample = values.slice(0, SAMPLE_SIZE);
  const nonMissing = sample.filter(v => !isMissingValue(v));

  if (nonMissing.length === 0) {
    return {
      type: 'text',
      confidence: 1.0,
      decimalSeparator: 'dot',
      isAmbiguousDate: false,
      distinctCount: 0,
      distinctRatio: 0
    };
  }

  const n = nonMissing.length;
  const distinctSet = new Set(nonMissing.map(v => String(v).trim()));
  const distinctCount = distinctSet.size;
  const distinctRatio = distinctCount / n;
  const isNameIdentifier = IDENTIFIER_REGEX.test(colLabel) || IDENTIFIER_REGEX.test(colKey);

  // 1. Test Date
  const isAmbiguousDate = detectDateAmbiguity(nonMissing);
  let dateMatches = 0;
  for (const v of nonMissing) {
    if (parseDate(v) !== null) dateMatches++;
  }

  if (dateMatches / n >= TYPE_THRESHOLD) {
    return {
      type: 'date',
      confidence: dateMatches / n,
      decimalSeparator: 'dot',
      isAmbiguousDate,
      distinctCount,
      distinctRatio
    };
  }

  // 2. Test Boolean
  let boolMatches = 0;
  for (const v of nonMissing) {
    if (parseBoolean(v) !== null) boolMatches++;
  }
  if (boolMatches / n >= TYPE_THRESHOLD) {
    return {
      type: 'boolean',
      confidence: boolMatches / n,
      decimalSeparator: 'dot',
      isAmbiguousDate: false,
      distinctCount,
      distinctRatio
    };
  }

  // 3. Test Numeric & Identifier Heuristic for numeric columns
  const decimalSep = detectColumnDecimalSeparator(nonMissing);
  let numMatches = 0;
  for (const v of nonMissing) {
    if (parseNumber(v, decimalSep) !== null) numMatches++;
  }

  if (numMatches / n >= TYPE_THRESHOLD) {
    // Check if numeric column is an identifier
    if (isNameIdentifier || (distinctRatio >= 0.95 && n >= 20)) {
      const allInts = nonMissing.every(v => {
        const num = parseNumber(v, decimalSep);
        return num !== null && Number.isInteger(num);
      });
      if (allInts) {
        return {
          type: 'identifier',
          confidence: 0.95,
          decimalSeparator: decimalSep,
          isAmbiguousDate: false,
          distinctCount,
          distinctRatio
        };
      }
    }

    return {
      type: 'numeric',
      confidence: numMatches / n,
      decimalSeparator: decimalSep,
      isAmbiguousDate: false,
      distinctCount,
      distinctRatio
    };
  }

  // 4. Test String-based Identifiers (e.g. ORD-10001, SKU-9901)
  if (isNameIdentifier && (distinctRatio > 0.8 || distinctCount > 30)) {
    return {
      type: 'identifier',
      confidence: 0.95,
      decimalSeparator: 'dot',
      isAmbiguousDate: false,
      distinctCount,
      distinctRatio
    };
  }

  // 5. Categorical vs Text
  // Categorical if distinct ratio <= 50% or distinct count <= 50
  if (distinctRatio <= 0.50 || distinctCount <= 50) {
    return {
      type: 'categorical',
      confidence: 1.0,
      decimalSeparator: 'dot',
      isAmbiguousDate: false,
      distinctCount,
      distinctRatio
    };
  }

  // Otherwise Free Text
  return {
    type: 'text',
    confidence: 1.0,
    decimalSeparator: 'dot',
    isAmbiguousDate: false,
    distinctCount,
    distinctRatio
  };
}

/**
 * Converts raw string rows into typed values according to column types.
 * Returns new array of Maps with typed values.
 * @param {Array<Map<string, any>>} rows
 * @param {Array<{ key: string, type: string, decimalSeparator?: string }>} headers
 * @returns {Array<Map<string, any>>}
 */
export function coerceRowTypes(rows, headers) {
  return rows.map(row => {
    const typedRow = new Map();
    for (const h of headers) {
      const rawVal = row.get(h.key);
      if (rawVal === null || rawVal === undefined || isMissingValue(rawVal)) {
        typedRow.set(h.key, null);
        continue;
      }

      const type = h.userType || h.type;
      if (type === 'numeric') {
        typedRow.set(h.key, parseNumber(rawVal, h.decimalSeparator || 'auto'));
      } else if (type === 'date') {
        const d = parseDate(rawVal);
        typedRow.set(h.key, d);
      } else if (type === 'boolean') {
        typedRow.set(h.key, parseBoolean(rawVal));
      } else {
        typedRow.set(h.key, String(rawVal).trim());
      }
    }
    return typedRow;
  });
}

/**
 * Finds exact duplicate rows in the dataset (after trimming string values).
 * @param {Array<Map<string, any>>} rows
 * @param {Array<{ key: string }>} headers
 * @returns {number} count of duplicate rows
 */
export function countDuplicateRows(rows, headers) {
  const seen = new Set();
  let duplicateCount = 0;

  for (const row of rows) {
    const signature = headers.map(h => {
      const val = row.get(h.key);
      if (val === null || val === undefined) return '';
      if (val instanceof Date) return val.toISOString();
      return String(val).trim();
    }).join('|#|');

    if (seen.has(signature)) {
      duplicateCount++;
    } else {
      seen.add(signature);
    }
  }

  return duplicateCount;
}

/**
 * Full profiling pass over the dataset.
 * @param {Array<{ key: string, label: string, raw: string, type?: string, userType?: string }>} headers
 * @param {Array<Map<string, any>>} rows
 * @returns {{
 *   totalRows: number,
 *   totalColumns: number,
 *   typeCounts: Record<string, number>,
 *   totalMissingCells: number,
 *   missingPercentage: number,
 *   duplicateRows: number,
 *   memoryEstimateBytes: number,
 *   columnProfiles: Map<string, any>,
 *   qualityWarnings: Array<{ type: string, column?: string, message: string, severity: 'warning'|'danger'|'info' }>
 * }}
 */
export function profileDataset(headers, rows) {
  const totalRows = rows.length;
  const totalColumns = headers.length;
  const totalCells = totalRows * totalColumns;

  let totalMissingCells = 0;
  const typeCounts = {
    numeric: 0,
    date: 0,
    categorical: 0,
    boolean: 0,
    text: 0,
    identifier: 0
  };

  const columnProfiles = new Map();
  const qualityWarnings = [];

  // Profile each column
  for (const h of headers) {
    const colKey = h.key;
    const colValues = rows.map(r => r.get(colKey));

    // Determine type if not already inferred or if userType not set
    let inferredType = h.userType || h.type;
    let inferenceInfo = { decimalSeparator: 'dot', isAmbiguousDate: false };

    if (!h.type) {
      inferenceInfo = inferColumnType(h.key, h.label, colValues);
      h.type = inferenceInfo.type;
      h.decimalSeparator = inferenceInfo.decimalSeparator;
      h.isAmbiguousDate = inferenceInfo.isAmbiguousDate;
      inferredType = h.type;
    }

    typeCounts[inferredType] = (typeCounts[inferredType] || 0) + 1;

    // Missing count
    let colMissing = 0;
    const nonMissingValues = [];
    for (const v of colValues) {
      if (v === null || v === undefined || isMissingValue(v)) {
        colMissing++;
      } else {
        nonMissingValues.push(v);
      }
    }
    totalMissingCells += colMissing;
    const colMissingPct = totalRows > 0 ? (colMissing / totalRows) * 100 : 0;

    let stats = null;
    if (inferredType === 'numeric') {
      const numbers = nonMissingValues.map(v => typeof v === 'number' ? v : parseNumber(v, h.decimalSeparator)).filter(v => v !== null);
      stats = computeNumericStats(numbers);
    } else if (inferredType === 'date') {
      const dates = nonMissingValues.map(v => v instanceof Date ? v : parseDate(v)).filter(v => v !== null);
      stats = computeDateStats(dates);
    } else if (inferredType === 'categorical' || inferredType === 'boolean' || inferredType === 'identifier') {
      stats = computeCategoricalStats(nonMissingValues);
    } else {
      // Text
      stats = { distinctCount: new Set(nonMissingValues).size, missingCount: colMissing };
    }

    columnProfiles.set(colKey, {
      key: colKey,
      label: h.label,
      type: inferredType,
      missingCount: colMissing,
      missingPercentage: Number(colMissingPct.toFixed(2)),
      stats
    });

    // Quality warnings per column
    if (colMissingPct > 30) {
      qualityWarnings.push({
        type: 'high_missing',
        column: h.label,
        message: `Column "${h.label}" has ${colMissingPct.toFixed(1)}% missing values.`,
        severity: colMissingPct > 50 ? 'danger' : 'warning'
      });
    }

    if (nonMissingValues.length > 0 && stats?.distinctCount === 1) {
      qualityWarnings.push({
        type: 'constant_column',
        column: h.label,
        message: `Column "${h.label}" has constant values (only 1 distinct value: "${stats.mode || nonMissingValues[0]}").`,
        severity: 'warning'
      });
    }

    if (h.isAmbiguousDate) {
      qualityWarnings.push({
        type: 'ambiguous_date',
        column: h.label,
        message: `Column "${h.label}" contains ambiguous dates (day and month <= 12). Defaulting to MDY; you can override.`,
        severity: 'info'
      });
    }

    if (inferredType === 'categorical' && stats?.distinctCount && stats.distinctCount > 40 && totalRows < 200) {
      qualityWarnings.push({
        type: 'high_cardinality_categorical',
        column: h.label,
        message: `Column "${h.label}" has high cardinality (${stats.distinctCount} distinct categories for ${totalRows} rows).`,
        severity: 'info'
      });
    }
  }

  const duplicateRows = countDuplicateRows(rows, headers);
  if (duplicateRows > 0) {
    qualityWarnings.push({
      type: 'duplicate_rows',
      message: `Detected ${duplicateRows} exact duplicate row${duplicateRows > 1 ? 's' : ''}.`,
      severity: 'info'
    });
  }

  const memoryEstimateBytes = estimateMemoryBytes(rows, headers);
  const missingPercentage = totalCells > 0 ? Number(((totalMissingCells / totalCells) * 100).toFixed(2)) : 0;

  return {
    totalRows,
    totalColumns,
    typeCounts,
    totalMissingCells,
    missingPercentage,
    duplicateRows,
    memoryEstimateBytes,
    columnProfiles,
    qualityWarnings
  };
}
