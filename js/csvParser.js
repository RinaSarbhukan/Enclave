/**
 * CSV Insight - CSV Parser Module
 * Pure parsing and validation logic without DOM dependencies.
 */

import { generateSafeColumnKey, isMissingValue, DEFAULT_MISSING_TOKENS } from './utils.js';

export const MAX_FILE_SIZE_DEFAULT = 50 * 1024 * 1024; // 50MB
export const WARN_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Resolves PapaParse instance across browser and Node.js environments.
 * @returns {Promise<any>}
 */
export async function getPapa() {
  if (typeof globalThis !== 'undefined' && globalThis.Papa) {
    return globalThis.Papa;
  }
  try {
    const mod = await import('papaparse');
    return mod.default || mod;
  } catch (err) {
    throw new Error('PapaParse library could not be loaded.');
  }
}

/**
 * Strips UTF-8 BOM if present.
 * @param {string} text
 * @returns {string}
 */
export function stripBOM(text) {
  if (text && text.charCodeAt(0) === 0xFEFF) {
    return text.slice(1);
  }
  return text;
}

/**
 * Validates file metadata before parsing.
 * @param {{ name?: string, size?: number, type?: string }} fileInfo
 * @param {number} [maxBytes=MAX_FILE_SIZE_DEFAULT]
 * @returns {{ valid: boolean, warning?: string, error?: string }}
 */
export function validateFileMetadata(fileInfo, maxBytes = MAX_FILE_SIZE_DEFAULT) {
  if (!fileInfo) {
    return { valid: false, error: 'No file provided.' };
  }

  const name = fileInfo.name || '';
  const size = fileInfo.size !== undefined ? fileInfo.size : 0;
  const extension = name.split('.').pop()?.toLowerCase();

  const allowedExtensions = ['csv', 'tsv', 'txt'];
  if (name && !allowedExtensions.includes(extension)) {
    return {
      valid: false,
      error: `Unsupported file extension ".${extension}". Please upload a CSV, TSV, or TXT file.`
    };
  }

  if (size === 0) {
    return { valid: false, error: 'The selected file is empty (0 bytes).' };
  }

  if (size > maxBytes) {
    return {
      valid: false,
      error: `File size exceeds the ${(maxBytes / (1024 * 1024)).toFixed(0)} MB limit.`
    };
  }

  let warning;
  if (size > WARN_FILE_SIZE) {
    warning = `File size is ${(size / (1024 * 1024)).toFixed(1)} MB. Parsing and charting may take a few seconds.`;
  }

  return { valid: true, warning };
}

/**
 * Normalizes raw header strings into structured column descriptors with unique safe keys.
 * Preserves original labels, handles empty, duplicate, and dangerous headers (__proto__, constructor).
 * @param {string[]} rawHeaders
 * @returns {Array<{ key: string, label: string, raw: string, index: number }>}
 */
export function normalizeHeaders(rawHeaders) {
  const existingKeys = new Set();
  const labelCounts = new Map();

  return rawHeaders.map((raw, idx) => {
    const trimmed = (raw === null || raw === undefined) ? '' : String(raw).trim();
    let displayLabel = trimmed;

    if (!displayLabel) {
      displayLabel = `Column_${idx + 1}`;
    }

    // Handle duplicate display labels cleanly
    const count = labelCounts.get(displayLabel) || 0;
    labelCounts.set(displayLabel, count + 1);
    if (count > 0) {
      displayLabel = `${displayLabel} (${count + 1})`;
    }

    const key = generateSafeColumnKey(trimmed, idx, existingKeys);

    return {
      key,
      label: displayLabel,
      raw: String(raw ?? ''),
      index: idx
    };
  });
}

/**
 * Parses raw CSV string or File/Blob using PapaParse with full error recovery,
 * malformed rows tracking, and safe Map-based row storage.
 * @param {string|File|Blob} input
 * @param {object} [options={}]
 * @param {string} [options.delimiter] - Explicit delimiter override (comma, tab, semicolon, pipe)
 * @param {number} [options.headerRowIndex=0] - 0-indexed row for headers
 * @param {Set<string>} [options.missingTokens=DEFAULT_MISSING_TOKENS]
 * @param {(progress: number) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{
 *   headers: Array<{ key: string, label: string, raw: string, index: number }>,
 *   rows: Array<Map<string, any>>,
 *   meta: { delimiter: string, linebreak: string, rowCount: number, colCount: number },
 *   malformedRows: Array<{ row: number, type: string, code: string, message: string }>,
 *   rawRowCount: number
 * }>}
 */
export async function parseCsvContent(input, options = {}) {
  const Papa = await getPapa();
  const missingTokens = options.missingTokens || DEFAULT_MISSING_TOKENS;

  return new Promise((resolve, reject) => {
    let aborted = false;
    let abortFn = null;

    if (options.signal) {
      if (options.signal.aborted) {
        return reject(new Error('Parsing aborted by user.'));
      }
      options.signal.addEventListener('abort', () => {
        aborted = true;
        if (abortFn) abortFn();
        reject(new Error('Parsing aborted by user.'));
      });
    }

    let rawString = '';
    if (typeof input === 'string') {
      rawString = stripBOM(input);
      if (!rawString.trim()) {
        return reject(new Error('File is empty or contains only whitespace.'));
      }
    }

    const config = {
      delimiter: options.delimiter || '', // empty triggers auto-detection
      skipEmptyLines: 'greedy',
      comments: false,
      header: false, // We parse as matrix to robustly handle header overrides & duplicates
      dynamicTyping: false, // Type inference is done deterministically by dataAnalyzer
      fastMode: false,
      chunkSize: 1024 * 1024 * 2, // 2MB chunking
      beforeFirstChunk: (chunk) => {
        return stripBOM(chunk);
      },
      error: (err) => {
        reject(new Error(`CSV Parsing Error: ${err.message || 'Unknown parsing failure'}`));
      },
      complete: (results) => {
        if (aborted) return;
        try {
          const matrix = results.data;
          const errors = results.errors || [];

          if (!matrix || matrix.length === 0) {
            return reject(new Error('No data found in CSV.'));
          }

          const headerIndex = options.headerRowIndex || 0;
          if (headerIndex >= matrix.length) {
            return reject(new Error(`Specified header row index (${headerIndex}) exceeds total row count (${matrix.length}).`));
          }

          const rawHeaderRow = matrix[headerIndex];
          if (!Array.isArray(rawHeaderRow) || rawHeaderRow.length === 0) {
            return reject(new Error('Header row is empty or invalid.'));
          }

          const headers = normalizeHeaders(rawHeaderRow);
          const colCount = headers.length;

          const rows = [];
          const malformedRows = [];

          // Map PapaParse row errors
          for (const err of errors) {
            if (err.row !== undefined) {
              malformedRows.push({
                row: err.row + 1,
                type: err.type || 'FieldMismatch',
                code: err.code || 'MALFORMED',
                message: err.message || 'Mismatched row structure'
              });
            }
          }

          // Process data rows
          for (let r = headerIndex + 1; r < matrix.length; r++) {
            const rawRow = matrix[r];
            if (!rawRow || rawRow.length === 0) continue;

            if (rawRow.length !== colCount) {
              malformedRows.push({
                row: r + 1,
                type: 'LengthMismatch',
                code: rawRow.length < colCount ? 'TOO_FEW_FIELDS' : 'TOO_MANY_FIELDS',
                message: `Row ${r + 1} has ${rawRow.length} values, expected ${colCount}.`
              });
            }

            const rowMap = new Map();
            for (let c = 0; c < colCount; c++) {
              const header = headers[c];
              const cellVal = rawRow[c];
              if (isMissingValue(cellVal, missingTokens)) {
                rowMap.set(header.key, null);
              } else {
                rowMap.set(header.key, String(cellVal));
              }
            }
            rows.push(rowMap);
          }

          resolve({
            headers,
            rows,
            meta: {
              delimiter: results.meta?.delimiter || ',',
              linebreak: results.meta?.linebreak || '\n',
              rowCount: rows.length,
              colCount: headers.length
            },
            malformedRows,
            rawRowCount: matrix.length
          });
        } catch (processError) {
          reject(processError);
        }
      }
    };

    if (options.onProgress) {
      config.step = undefined; // standard complete mode or chunk mode
    }

    try {
      const parser = Papa.parse(rawString || input, config);
      abortFn = () => {
        if (parser && typeof parser.abort === 'function') {
          parser.abort();
        }
      };
    } catch (parseCallError) {
      reject(parseCallError);
    }
  });
}
