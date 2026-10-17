/**
 * CSV Insight - Table & Filter Exploration Engine
 * Pure filtering logic and secure DOM table rendering via textContent.
 */

import { parseNumber, parseDate, isMissingValue } from './utils.js';

/**
 * Filter definition interface
 * @typedef {{
 *   globalSearch?: string,
 *   columnFilters?: Record<string, {
 *     type: string,
 *     text?: string,
 *     selectedValues?: string[],
 *     min?: number|null,
 *     max?: number|null,
 *     startDate?: Date|null,
 *     endDate?: Date|null
 *   }>
 * }} FilterState
 */

/**
 * Applies active filter state onto a dataset without mutating the source data.
 * Pure logic function - testable in Node.js.
 * @param {Array<Map<string, any>>} rows
 * @param {Array<{ key: string, type: string }>} headers
 * @param {FilterState} filterState
 * @returns {Array<Map<string, any>>} filtered rows
 */
export function applyFilters(rows, headers, filterState) {
  if (!filterState) return rows;

  const globalQuery = (filterState.globalSearch || '').trim().toLowerCase();
  const colFilters = filterState.columnFilters || {};
  const activeColKeys = Object.keys(colFilters).filter(k => {
    const f = colFilters[k];
    if (!f) return false;
    if (f.text && f.text.trim()) return true;
    if (f.selectedValues && f.selectedValues.length > 0) return true;
    if (f.min !== null && f.min !== undefined) return true;
    if (f.max !== null && f.max !== undefined) return true;
    if (f.startDate || f.endDate) return true;
    return false;
  });

  if (!globalQuery && activeColKeys.length === 0) {
    return rows;
  }

  return rows.filter(row => {
    // 1. Check Global Search
    if (globalQuery) {
      let matchedGlobal = false;
      for (const h of headers) {
        const val = row.get(h.key);
        if (val !== null && val !== undefined) {
          const str = val instanceof Date ? val.toISOString() : String(val);
          if (str.toLowerCase().includes(globalQuery)) {
            matchedGlobal = true;
            break;
          }
        }
      }
      if (!matchedGlobal) return false;
    }

    // 2. Check Column-Specific Filters
    for (const colKey of activeColKeys) {
      const f = colFilters[colKey];
      const val = row.get(colKey);

      // Missing check
      if (val === null || val === undefined || isMissingValue(val)) {
        return false;
      }

      // Text / Categorical Substring
      if (f.text) {
        const query = f.text.trim().toLowerCase();
        const str = String(val).toLowerCase();
        if (!str.includes(query)) return false;
      }

      // Categorical Multiselect
      if (f.selectedValues && f.selectedValues.length > 0) {
        const str = String(val).trim();
        if (!f.selectedValues.includes(str)) return false;
      }

      // Numeric Min / Max
      if (f.min !== null && f.min !== undefined) {
        const num = typeof val === 'number' ? val : parseNumber(val);
        if (num === null || num < f.min) return false;
      }
      if (f.max !== null && f.max !== undefined) {
        const num = typeof val === 'number' ? val : parseNumber(val);
        if (num === null || num > f.max) return false;
      }

      // Date Range
      if (f.startDate || f.endDate) {
        const d = val instanceof Date ? val : parseDate(val);
        if (!d || Number.isNaN(d.getTime())) return false;
        const time = d.getTime();
        if (f.startDate && time < f.startDate.getTime()) return false;
        if (f.endDate && time > f.endDate.getTime()) return false;
      }
    }

    return true;
  });
}

/**
 * Sorts rows deterministically according to column key, direction, and inferred type.
 * Pure logic function - testable in Node.js.
 * @param {Array<Map<string, any>>} rows
 * @param {string} colKey
 * @param {'asc'|'desc'} direction
 * @param {string} colType
 * @returns {Array<Map<string, any>>} sorted rows
 */
export function sortRows(rows, colKey, direction = 'asc', colType = 'text') {
  if (!colKey) return rows;
  const modifier = direction === 'desc' ? -1 : 1;

  return [...rows].sort((a, b) => {
    const valA = a.get(colKey);
    const valB = b.get(colKey);

    // Missing values always go to the bottom
    const missingA = valA === null || valA === undefined || isMissingValue(valA);
    const missingB = valB === null || valB === undefined || isMissingValue(valB);

    if (missingA && missingB) return 0;
    if (missingA) return 1;
    if (missingB) return -1;

    if (colType === 'numeric') {
      const numA = typeof valA === 'number' ? valA : parseNumber(valA);
      const numB = typeof valB === 'number' ? valB : parseNumber(valB);
      if (numA === null && numB === null) return 0;
      if (numA === null) return 1;
      if (numB === null) return -1;
      return (numA - numB) * modifier;
    }

    if (colType === 'date') {
      const dateA = valA instanceof Date ? valA : parseDate(valA);
      const dateB = valB instanceof Date ? valB : parseDate(valB);
      const tA = dateA ? dateA.getTime() : 0;
      const tB = dateB ? dateB.getTime() : 0;
      return (tA - tB) * modifier;
    }

    return String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' }) * modifier;
  });
}

/**
 * Securely renders a page of table rows into a DOM container using textContent only.
 * @param {HTMLElement} tableTbody
 * @param {Array<Map<string, any>>} pageRows
 * @param {Array<{ key: string, label: string, type: string }>} headers
 * @param {number} startIndex
 */
export function renderTableBody(tableTbody, pageRows, headers, startIndex = 0) {
  tableTbody.innerHTML = '';

  if (pageRows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = headers.length + 1;
    td.className = 'text-center text-muted py-4';
    td.textContent = 'No matching rows found.';
    tr.appendChild(td);
    tableTbody.appendChild(tr);
    return;
  }

  const fragment = document.createDocumentFragment();

  pageRows.forEach((row, idx) => {
    const tr = document.createElement('tr');

    // Row number index
    const tdIndex = document.createElement('td');
    tdIndex.className = 'text-muted small table-row-index';
    tdIndex.textContent = String(startIndex + idx + 1);
    tr.appendChild(tdIndex);

    // Columns
    headers.forEach(h => {
      const td = document.createElement('td');
      const val = row.get(h.key);

      if (val === null || val === undefined || isMissingValue(val)) {
        const em = document.createElement('span');
        em.className = 'text-muted fst-italic cell-missing';
        em.textContent = 'empty';
        td.appendChild(em);
      } else if (val instanceof Date) {
        td.textContent = val.toISOString().split('T')[0];
      } else if (typeof val === 'number') {
        td.textContent = val.toLocaleString(undefined, { maximumFractionDigits: 3 });
        td.className = 'text-end';
      } else {
        td.textContent = String(val);
      }

      tr.appendChild(td);
    });

    fragment.appendChild(tr);
  });

  tableTbody.appendChild(fragment);
}
