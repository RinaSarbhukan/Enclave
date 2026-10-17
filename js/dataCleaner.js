/**
 * CSV Insight - Data Cleaning Pipeline
 * Pure, reversible data cleaning engine with preview and undo/redo capabilities.
 * Free of DOM dependencies - fully testable in Node.js.
 */

import {
  parseNumber,
  parseDate,
  parseBoolean,
  isMissingValue,
  computeNumericStats,
  computeCategoricalStats
} from './utils.js';

/**
 * Deep clones dataset headers and Map-based rows.
 * @param {Array<{ key: string, label: string, raw: string, type: string, userType?: string }>} headers
 * @param {Array<Map<string, any>>} rows
 * @returns {{ headers: typeof headers, rows: typeof rows }}
 */
export function cloneDataset(headers, rows) {
  const clonedHeaders = headers.map(h => ({ ...h }));
  const clonedRows = rows.map(r => new Map(r));
  return { headers: clonedHeaders, rows: clonedRows };
}

/**
 * Generates an affected rows/cells preview and sample diff before applying an operation.
 * @param {object} op
 * @param {Array<{ key: string, label: string, type: string }>} headers
 * @param {Array<Map<string, any>>} rows
 * @returns {{
 *   opType: string,
 *   affectedRowsCount: number,
 *   affectedCellsCount: number,
 *   beforeSamples: Array<Record<string, any>>,
 *   afterSamples: Array<Record<string, any>>,
 *   description: string
 * }}
 */
export function previewCleaningOperation(op, headers, rows) {
  const applied = applySingleOperation(op, headers, rows);
  let affectedRowsCount = 0;
  let affectedCellsCount = 0;
  const beforeSamples = [];
  const afterSamples = [];

  const maxSamples = 5;

  if (op.type === 'remove_duplicates' || op.type === 'remove_invalid_rows' || op.type === 'remove_outliers' || (op.type === 'handle_blanks' && op.mode === 'drop_rows')) {
    affectedRowsCount = rows.length - applied.rows.length;
    affectedCellsCount = affectedRowsCount * headers.length;
    for (let i = 0; i < Math.min(maxSamples, rows.length); i++) {
      beforeSamples.push(Object.fromEntries(rows[i]));
    }
    for (let i = 0; i < Math.min(maxSamples, applied.rows.length); i++) {
      afterSamples.push(Object.fromEntries(applied.rows[i]));
    }
  } else if (op.type === 'drop_columns' || op.type === 'drop_empty_columns') {
    const droppedCols = op.columns || (op.columnKey ? [op.columnKey] : (headers.length - applied.headers.length));
    const droppedCount = typeof droppedCols === 'number' ? droppedCols : droppedCols.length;
    affectedRowsCount = rows.length;
    affectedCellsCount = rows.length * droppedCount;
    for (let i = 0; i < Math.min(maxSamples, rows.length); i++) {
      beforeSamples.push(Object.fromEntries(rows[i]));
      afterSamples.push(Object.fromEntries(applied.rows[i]));
    }
  } else {
    // Cell-level modifications: trim, rename, fill_value, convert_type
    for (let i = 0; i < rows.length; i++) {
      const rowBefore = rows[i];
      const rowAfter = applied.rows[i];
      let rowDiff = false;

      for (const h of headers) {
        if (rowBefore.get(h.key) !== rowAfter.get(h.key)) {
          affectedCellsCount++;
          rowDiff = true;
        }
      }

      if (rowDiff) {
        affectedRowsCount++;
        if (beforeSamples.length < maxSamples) {
          beforeSamples.push(Object.fromEntries(rowBefore));
          afterSamples.push(Object.fromEntries(rowAfter));
        }
      }
    }
  }

  return {
    opType: op.type,
    affectedRowsCount,
    affectedCellsCount,
    beforeSamples,
    afterSamples,
    description: op.description || `Cleaning operation: ${op.type}`
  };
}

/**
 * Applies a single cleaning operation on immutable copies of headers and rows.
 * @param {object} op
 * @param {Array<{ key: string, label: string, type: string }>} headers
 * @param {Array<Map<string, any>>} rows
 * @returns {{ headers: typeof headers, rows: typeof rows, report?: object }}
 */
export function applySingleOperation(op, headers, rows) {
  const { headers: nextHeaders, rows: nextRows } = cloneDataset(headers, rows);

  switch (op.type) {
    case 'remove_duplicates': {
      const seen = new Set();
      const filteredRows = [];

      for (const row of nextRows) {
        const signature = nextHeaders.map(h => {
          const val = row.get(h.key);
          if (val === null || val === undefined) return '';
          if (val instanceof Date) return val.toISOString();
          return String(val).trim();
        }).join('|#|');

        if (!seen.has(signature)) {
          seen.add(signature);
          filteredRows.push(row);
        }
      }

      return { headers: nextHeaders, rows: filteredRows };
    }

    case 'trim_whitespace': {
      const targetCol = op.columnKey;
      for (const row of nextRows) {
        for (const h of nextHeaders) {
          if (!targetCol || targetCol === h.key) {
            const val = row.get(h.key);
            if (typeof val === 'string') {
              const trimmed = val.trim();
              row.set(h.key, trimmed === '' ? null : trimmed);
            }
          }
        }
      }
      return { headers: nextHeaders, rows: nextRows };
    }

    case 'handle_blanks': {
      const { mode, columnKey, fillValue } = op;
      if (mode === 'drop_rows') {
        const filtered = nextRows.filter(row => {
          if (columnKey) {
            return !isMissingValue(row.get(columnKey));
          }
          for (const h of nextHeaders) {
            if (isMissingValue(row.get(h.key))) return false;
          }
          return true;
        });
        return { headers: nextHeaders, rows: filtered };
      }

      // Imputation: fill_value, fill_mean, fill_median, fill_mode
      let replacementVal = fillValue;
      if (columnKey) {
        const colVals = nextRows.map(r => r.get(columnKey)).filter(v => !isMissingValue(v));

        if (mode === 'fill_mean' || mode === 'fill_median') {
          const numVals = colVals.map(v => typeof v === 'number' ? v : parseNumber(v)).filter(v => v !== null);
          const stats = computeNumericStats(numVals);
          replacementVal = mode === 'fill_mean' ? stats.mean : stats.median;
        } else if (mode === 'fill_mode') {
          const catStats = computeCategoricalStats(colVals);
          replacementVal = catStats.mode || 'Unknown';
        }

        for (const row of nextRows) {
          if (isMissingValue(row.get(columnKey))) {
            row.set(columnKey, replacementVal);
          }
        }
      } else if (mode === 'fill_value') {
        for (const row of nextRows) {
          for (const h of nextHeaders) {
            if (isMissingValue(row.get(h.key))) {
              row.set(h.key, fillValue ?? '');
            }
          }
        }
      }

      return { headers: nextHeaders, rows: nextRows };
    }

    case 'drop_columns': {
      const droppedSet = new Set(op.columns || (op.columnKey ? [op.columnKey] : []));
      const filteredHeaders = nextHeaders.filter(h => !droppedSet.has(h.key));
      for (const row of nextRows) {
        for (const key of droppedSet) {
          row.delete(key);
        }
      }
      return { headers: filteredHeaders, rows: nextRows };
    }

    case 'rename_column': {
      const { columnKey, newLabel } = op;
      const target = nextHeaders.find(h => h.key === columnKey);
      if (target && newLabel) {
        target.label = String(newLabel).trim();
      }
      return { headers: nextHeaders, rows: nextRows };
    }

    case 'convert_type': {
      const { columnKey, targetType } = op;
      const targetHeader = nextHeaders.find(h => h.key === columnKey);
      let failedCount = 0;
      let coercedCount = 0;

      if (targetHeader) {
        targetHeader.userType = targetType;
        targetHeader.type = targetType;

        for (const row of nextRows) {
          const val = row.get(columnKey);
          if (isMissingValue(val)) continue;

          if (targetType === 'numeric') {
            const num = parseNumber(val);
            if (num !== null) {
              row.set(columnKey, num);
              coercedCount++;
            } else {
              row.set(columnKey, null);
              failedCount++;
            }
          } else if (targetType === 'date') {
            const d = parseDate(val);
            if (d !== null) {
              row.set(columnKey, d);
              coercedCount++;
            } else {
              row.set(columnKey, null);
              failedCount++;
            }
          } else if (targetType === 'boolean') {
            const b = parseBoolean(val);
            if (b !== null) {
              row.set(columnKey, b);
              coercedCount++;
            } else {
              row.set(columnKey, null);
              failedCount++;
            }
          } else {
            row.set(columnKey, String(val).trim());
            coercedCount++;
          }
        }
      }

      return {
        headers: nextHeaders,
        rows: nextRows,
        report: { failedCount, coercedCount }
      };
    }

    case 'remove_invalid_rows': {
      const { columnKey, expectedType } = op;
      const filtered = nextRows.filter(row => {
        const val = row.get(columnKey);
        if (isMissingValue(val)) return true; // keep missing or drop based on blanks op
        if (expectedType === 'numeric') {
          return typeof val === 'number' ? Number.isFinite(val) : parseNumber(val) !== null;
        }
        if (expectedType === 'date') {
          return val instanceof Date ? !Number.isNaN(val.getTime()) : parseDate(val) !== null;
        }
        return true;
      });
      return { headers: nextHeaders, rows: filtered };
    }

    case 'change_case': {
      const { mode = 'upper', columnKey } = op;
      const toTitleCase = (str) => str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());

      for (const row of nextRows) {
        for (const h of nextHeaders) {
          if (!columnKey || columnKey === h.key) {
            const val = row.get(h.key);
            if (typeof val === 'string' && val.trim() !== '') {
              if (mode === 'upper') row.set(h.key, val.toUpperCase());
              else if (mode === 'lower') row.set(h.key, val.toLowerCase());
              else if (mode === 'title') row.set(h.key, toTitleCase(val));
            }
          }
        }
      }
      return { headers: nextHeaders, rows: nextRows };
    }

    case 'round_numbers': {
      const { decimals = 2, columnKey } = op;
      const factor = Math.pow(10, decimals);
      for (const row of nextRows) {
        for (const h of nextHeaders) {
          if ((!columnKey && h.type === 'numeric') || columnKey === h.key) {
            const val = row.get(h.key);
            if (typeof val === 'number' && Number.isFinite(val)) {
              row.set(h.key, Math.round(val * factor) / factor);
            }
          }
        }
      }
      return { headers: nextHeaders, rows: nextRows };
    }

    case 'strip_special_chars': {
      const { columnKey } = op;
      for (const row of nextRows) {
        for (const h of nextHeaders) {
          if (!columnKey || columnKey === h.key) {
            const val = row.get(h.key);
            if (typeof val === 'string') {
              row.set(h.key, val.replace(/[^a-zA-Z0-9\s-_.]/g, '').trim());
            }
          }
        }
      }
      return { headers: nextHeaders, rows: nextRows };
    }

    case 'standardize_dates': {
      const { columnKey } = op;
      for (const row of nextRows) {
        for (const h of nextHeaders) {
          if ((!columnKey && h.type === 'date') || columnKey === h.key) {
            const val = row.get(h.key);
            if (val instanceof Date && !isNaN(val.getTime())) {
              row.set(h.key, val.toISOString().split('T')[0]);
            } else if (val !== null && val !== undefined && !isMissingValue(val)) {
              const parsed = parseDate(val);
              if (parsed) row.set(h.key, parsed.toISOString().split('T')[0]);
            }
          }
        }
      }
      return { headers: nextHeaders, rows: nextRows };
    }

    case 'remove_outliers': {
      const targetCol = op.columnKey || nextHeaders.find(h => h.type === 'numeric')?.key;
      if (!targetCol) return { headers: nextHeaders, rows: nextRows };

      const vals = [];
      for (const r of nextRows) {
        const v = r.get(targetCol);
        if (typeof v === 'number' && !isNaN(v)) vals.push(v);
        else if (v !== null && v !== undefined && !isMissingValue(v)) {
          const num = parseNumber(v);
          if (num !== null) vals.push(num);
        }
      }

      if (vals.length < 4) return { headers: nextHeaders, rows: nextRows };
      vals.sort((a, b) => a - b);
      const q1 = vals[Math.floor(vals.length * 0.25)];
      const q3 = vals[Math.floor(vals.length * 0.75)];
      const iqr = q3 - q1;
      const lowerBound = q1 - 1.5 * iqr;
      const upperBound = q3 + 1.5 * iqr;

      const filtered = nextRows.filter(row => {
        const v = row.get(targetCol);
        let num = typeof v === 'number' ? v : parseNumber(v);
        if (num === null || isNaN(num)) return true;
        return num >= lowerBound && num <= upperBound;
      });

      return { headers: nextHeaders, rows: filtered };
    }

    case 'drop_empty_columns': {
      const emptyCols = new Set();
      for (const h of nextHeaders) {
        let hasValue = false;
        for (const row of nextRows) {
          const val = row.get(h.key);
          if (!isMissingValue(val) && val !== '' && val !== null && val !== undefined) {
            hasValue = true;
            break;
          }
        }
        if (!hasValue) {
          emptyCols.add(h.key);
        }
      }

      if (emptyCols.size === 0) return { headers: nextHeaders, rows: nextRows };

      const filteredHeaders = nextHeaders.filter(h => !emptyCols.has(h.key));
      for (const row of nextRows) {
        for (const k of emptyCols) {
          row.delete(k);
        }
      }
      return { headers: filteredHeaders, rows: nextRows };
    }

    default:
      return { headers: nextHeaders, rows: nextRows };
  }
}

/**
 * Applies an ordered list of cleaning operations to the original dataset.
 * Always produces a new dataset without modifying originalData.
 * @param {Array<object>} operations
 * @param {Array<{ key: string, label: string, type: string }>} originalHeaders
 * @param {Array<Map<string, any>>} originalRows
 * @returns {{ headers: typeof originalHeaders, rows: typeof originalRows }}
 */
export function applyOperations(operations, originalHeaders, originalRows) {
  let currentHeaders = originalHeaders;
  let currentRows = originalRows;

  for (const op of operations) {
    const result = applySingleOperation(op, currentHeaders, currentRows);
    currentHeaders = result.headers;
    currentRows = result.rows;
  }

  return { headers: currentHeaders, rows: currentRows };
}
