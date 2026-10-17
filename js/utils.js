/**
 * CSV Insight - Utilities & Pure Math / Data Functions
 * Free of DOM dependencies - fully testable in Node.js
 */

/** Configurable missing value tokens */
export const DEFAULT_MISSING_TOKENS = new Set([
  '',
  'na',
  'n/a',
  'null',
  'nan',
  'none',
  '-',
  '?',
  'undefined',
  '#n/a',
  '#na'
]);

/**
 * Checks if a raw string value represents a missing cell.
 * @param {unknown} val
 * @param {Set<string>} [tokens=DEFAULT_MISSING_TOKENS]
 * @returns {boolean}
 */
export function isMissingValue(val, tokens = DEFAULT_MISSING_TOKENS) {
  if (val === null || val === undefined) return true;
  const str = String(val).trim().toLowerCase();
  return tokens.has(str);
}

/**
 * Generates a safe, sanitized identifier key for internal row maps.
 * Never allows prototype pollution keys.
 * @param {string} rawHeader
 * @param {number} index
 * @param {Set<string>} existingKeys
 * @returns {string}
 */
export function generateSafeColumnKey(rawHeader, index, existingKeys = new Set()) {
  const rawLower = String(rawHeader || '').trim().toLowerCase();
  let baseKey = rawLower.replace(/[^a-z0-9_]+/g, '_');

  if (baseKey.includes('proto') || baseKey.includes('constructor') || baseKey.includes('prototype')) {
    baseKey = `safe_${baseKey}_${index}`;
  } else {
    baseKey = baseKey.replace(/^_+|_+$/g, '');
  }

  if (!baseKey) {
    baseKey = `col_${index}`;
  }

  let finalKey = baseKey;
  let counter = 1;
  while (existingKeys.has(finalKey)) {
    finalKey = `${baseKey}_${counter}`;
    counter++;
  }
  existingKeys.add(finalKey);
  return finalKey;
}

/**
 * Neutralizes formula injection risks for spreadsheet applications.
 * Prefixes cells starting with '=', '+', '-', '@', tab, or CR with a single quote (').
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeForFormulaInjection(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Attempts to parse a string as a number, supporting:
 * - currency symbols ($ € £ ¥ ₹)
 * - percentage symbols (%)
 * - thousands separators (1,000,000 or 1.000.000)
 * - parentheses for negative numbers e.g. (123.45) -> -123.45
 * - decimal comma (e.g. 1234,56)
 * @param {unknown} val
 * @param {'dot'|'comma'|'auto'} [decimalSeparator='auto']
 * @returns {number|null} Returns parsed number or null if invalid
 */
export function parseNumber(val, decimalSeparator = 'auto') {
  if (isMissingValue(val)) return null;
  let str = String(val).trim();

  // Check parentheses negative e.g. (120.50)
  let isNegative = false;
  if (/^\(.*\)$/.test(str)) {
    isNegative = true;
    str = str.slice(1, -1).trim();
  } else if (str.startsWith('-')) {
    isNegative = true;
    str = str.slice(1).trim();
  } else if (str.startsWith('+')) {
    str = str.slice(1).trim();
  }

  // Remove currency symbols and whitespace
  str = str.replace(/[$€£¥₹]/g, '').trim();

  // Check percentage
  let isPercent = false;
  if (str.endsWith('%')) {
    isPercent = true;
    str = str.slice(0, -1).trim();
  }

  if (!str) return null;

  // Handle decimal separators
  if (decimalSeparator === 'comma' || (decimalSeparator === 'auto' && /^\d{1,3}(\.\d{3})*,\d+$/.test(str))) {
    // German/French style: 1.234,56
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (decimalSeparator === 'dot' || (decimalSeparator === 'auto' && /^\d{1,3}(,\d{3})*\.\d+$/.test(str))) {
    // US/UK style: 1,234.56
    str = str.replace(/,/g, '');
  } else if (str.includes(',') && !str.includes('.')) {
    // Only comma present: could be decimal (e.g. 45,5) or thousands (e.g. 1,000)
    const parts = str.split(',');
    if (parts.length === 2 && parts[1].length !== 3) {
      str = str.replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else {
    // Remove typical thousands commas
    str = str.replace(/,/g, '');
  }

  const num = Number(str);
  if (Number.isNaN(num) || !Number.isFinite(num)) return null;

  let result = isNegative ? -num : num;
  if (isPercent) result = result / 100;
  return result;
}

/**
 * Attempts to parse a date string.
 * Supports ISO 8601, YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY vs MM/DD/YYYY, and standard timestamps.
 * @param {unknown} val
 * @param {'DMY'|'MDY'|'auto'} [dateOrder='auto']
 * @returns {Date|null}
 */
export function parseDate(val, dateOrder = 'auto') {
  if (isMissingValue(val)) return null;
  const str = String(val).trim();
  if (!str || str.length < 4) return null;

  // Pure 4-digit year or numeric timestamps without separators are usually years or numbers, not full dates
  if (/^\d{4}$/.test(str)) {
    const yr = Number(str);
    if (yr >= 1900 && yr <= 2100) {
      return new Date(Date.UTC(yr, 0, 1));
    }
    return null;
  }

  // ISO 8601 or YYYY-MM-DD / YYYY/MM/DD
  const isoMatch = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(str);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]) - 1;
    const day = Number(isoMatch[3]);
    const hour = Number(isoMatch[4] || 0);
    const minute = Number(isoMatch[5] || 0);
    const second = Number(isoMatch[6] || 0);

    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, month, day, hour, minute, second));
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  // DD/MM/YYYY or MM/DD/YYYY
  const slashMatch = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(str);
  if (slashMatch) {
    let p1 = Number(slashMatch[1]);
    let p2 = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    const hour = Number(slashMatch[4] || 0);
    const minute = Number(slashMatch[5] || 0);
    const second = Number(slashMatch[6] || 0);

    let day, month;
    if (p1 > 12 && p2 <= 12) {
      // Must be DD/MM/YYYY
      day = p1;
      month = p2 - 1;
    } else if (p2 > 12 && p1 <= 12) {
      // Must be MM/DD/YYYY
      month = p1 - 1;
      day = p2;
    } else if (dateOrder === 'DMY') {
      day = p1;
      month = p2 - 1;
    } else {
      // Default / MDY
      month = p1 - 1;
      day = p2;
    }

    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, month, day, hour, minute, second));
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  // Try standard Date.parse
  const timestamp = Date.parse(str);
  if (!Number.isNaN(timestamp)) {
    const d = new Date(timestamp);
    const yr = d.getUTCFullYear();
    if (yr >= 1900 && yr <= 2150) {
      return d;
    }
  }

  return null;
}

/**
 * Checks if a string represents a boolean.
 * @param {unknown} val
 * @returns {boolean|null} Returns boolean value or null if not boolean
 */
export function parseBoolean(val) {
  if (isMissingValue(val)) return null;
  const str = String(val).trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 't'].includes(str)) return true;
  if (['false', 'no', 'n', '0', 'f'].includes(str)) return false;
  return null;
}

/**
 * Computes descriptive statistics for an array of numbers.
 * Uses sample standard deviation: s = sqrt( sum((x - mean)^2) / (n - 1) ) for n >= 2.
 * @param {number[]} numbers
 * @returns {{
 *   count: number,
 *   sum: number,
 *   mean: number|null,
 *   median: number|null,
 *   min: number|null,
 *   max: number|null,
 *   range: number|null,
 *   stdDev: number|null
 * }}
 */
export function computeNumericStats(numbers) {
  const valid = numbers.filter(n => typeof n === 'number' && Number.isFinite(n));
  const n = valid.length;
  if (n === 0) {
    return {
      count: 0,
      sum: 0,
      mean: null,
      median: null,
      min: null,
      max: null,
      range: null,
      stdDev: null
    };
  }

  let sum = 0;
  let min = valid[0];
  let max = valid[0];

  for (let i = 0; i < n; i++) {
    const val = valid[i];
    sum += val;
    if (val < min) min = val;
    if (val > max) max = val;
  }

  const mean = sum / n;

  // Median
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  // Sample standard deviation (n >= 2)
  let stdDev = null;
  if (n >= 2) {
    let varianceSum = 0;
    for (let i = 0; i < n; i++) {
      const diff = valid[i] - mean;
      varianceSum += diff * diff;
    }
    stdDev = Math.sqrt(varianceSum / (n - 1));
  } else {
    stdDev = 0;
  }

  return {
    count: n,
    sum: Number(sum.toFixed(4)),
    mean: Number(mean.toFixed(4)),
    median: Number(median.toFixed(4)),
    min,
    max,
    range: Number((max - min).toFixed(4)),
    stdDev: stdDev !== null ? Number(stdDev.toFixed(4)) : null
  };
}

/**
 * Computes Tukey's box plot statistics: min, Q1, median, Q3, max, IQR, lower/upper whiskers, and outliers.
 * @param {number[]} values
 * @returns {{
 *   count: number,
 *   min: number,
 *   q1: number,
 *   median: number,
 *   q3: number,
 *   max: number,
 *   iqr: number,
 *   lowerWhisker: number,
 *   upperWhisker: number,
 *   outliers: number[],
 *   mean: number
 * } | null}
 */
export function computeBoxPlotStats(values) {
  const nums = values
    .filter(v => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);

  const n = nums.length;
  if (n === 0) return null;

  const getPercentile = (p) => {
    if (n === 1) return nums[0];
    const idx = p * (n - 1);
    const low = Math.floor(idx);
    const high = Math.ceil(idx);
    const weight = idx - low;
    return Number((nums[low] * (1 - weight) + nums[high] * weight).toFixed(4));
  };

  const min = nums[0];
  const max = nums[n - 1];
  const sum = nums.reduce((acc, v) => acc + v, 0);
  const mean = Number((sum / n).toFixed(4));
  const q1 = getPercentile(0.25);
  const median = getPercentile(0.50);
  const q3 = getPercentile(0.75);
  const iqr = Number((q3 - q1).toFixed(4));

  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;

  // Tukey convention: whiskers reach to the most extreme data points within fences
  let lowerWhisker = q1;
  for (let i = 0; i < n; i++) {
    if (nums[i] >= lowerFence) {
      lowerWhisker = nums[i];
      break;
    }
  }

  let upperWhisker = q3;
  for (let i = n - 1; i >= 0; i--) {
    if (nums[i] <= upperFence) {
      upperWhisker = nums[i];
      break;
    }
  }

  const outliers = nums.filter(v => v < lowerFence || v > upperFence);

  return {
    count: n,
    min,
    q1,
    median,
    q3,
    max,
    iqr,
    lowerWhisker,
    upperWhisker,
    outliers,
    mean
  };
}

/**
 * Computes frequency distribution and mode for categorical values.
 * @param {string[]} values
 * @returns {{
 *   distinctCount: number,
 *   mode: string|null,
 *   frequencies: Array<{ value: string, count: number, percentage: number }>,
 *   missingCount: number
 * }}
 */
export function computeCategoricalStats(values) {
  const freqMap = new Map();
  let missingCount = 0;
  let totalValid = 0;

  for (const v of values) {
    if (isMissingValue(v)) {
      missingCount++;
      continue;
    }
    const str = String(v).trim();
    totalValid++;
    freqMap.set(str, (freqMap.get(str) || 0) + 1);
  }

  const distinctCount = freqMap.size;
  if (distinctCount === 0) {
    return {
      distinctCount: 0,
      mode: null,
      frequencies: [],
      missingCount
    };
  }

  // Sort descending by count
  const sorted = Array.from(freqMap.entries())
    .map(([value, count]) => ({
      value,
      count,
      percentage: totalValid > 0 ? Number(((count / totalValid) * 100).toFixed(2)) : 0
    }))
    .sort((a, b) => b.count - a.count);

  const mode = sorted.length > 0 ? sorted[0].value : null;

  return {
    distinctCount,
    mode,
    frequencies: sorted,
    missingCount
  };
}

/**
 * Computes date statistics: min, max, span in days, and buckets by day, month, year.
 * @param {Date[]} dates
 * @returns {{
 *   count: number,
 *   min: string|null,
 *   max: string|null,
 *   spanDays: number|null,
 *   byYear: Array<{ label: string, count: number }>,
 *   byMonth: Array<{ label: string, count: number }>
 * }}
 */
export function computeDateStats(dates) {
  const valid = dates.filter(d => d instanceof Date && !Number.isNaN(d.getTime()));
  if (valid.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      spanDays: null,
      byYear: [],
      byMonth: []
    };
  }

  let minTime = valid[0].getTime();
  let maxTime = valid[0].getTime();
  const yearMap = new Map();
  const monthMap = new Map();

  for (const d of valid) {
    const t = d.getTime();
    if (t < minTime) minTime = t;
    if (t > maxTime) maxTime = t;

    const y = String(d.getUTCFullYear());
    const m = `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

    yearMap.set(y, (yearMap.get(y) || 0) + 1);
    monthMap.set(m, (monthMap.get(m) || 0) + 1);
  }

  const spanDays = Math.round((maxTime - minTime) / (1000 * 60 * 60 * 24));

  const byYear = Array.from(yearMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const byMonth = Array.from(monthMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    count: valid.length,
    min: new Date(minTime).toISOString().split('T')[0],
    max: new Date(maxTime).toISOString().split('T')[0],
    spanDays,
    byYear,
    byMonth
  };
}

/**
 * Computes Pearson correlation coefficient between two numeric arrays.
 * Returns r in range [-1, 1], or null if insufficient valid pairs or zero variance.
 * @param {Array<number|null>} arrX
 * @param {Array<number|null>} arrY
 * @returns {number|null}
 */
export function computePearsonCorrelation(arrX, arrY) {
  const pairs = [];
  const len = Math.min(arrX.length, arrY.length);
  for (let i = 0; i < len; i++) {
    const x = arrX[i];
    const y = arrY[i];
    if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
      pairs.push([x, y]);
    }
  }

  const n = pairs.length;
  if (n < 3) return null;

  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of pairs) {
    sumX += x;
    sumY += y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (const [x, y] of pairs) {
    const dx = x - meanX;
    const dy = y - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  if (denomX <= 0 || denomY <= 0) return null;
  const r = numerator / (Math.sqrt(denomX) * Math.sqrt(denomY));
  return Number(Math.max(-1, Math.min(1, r)).toFixed(4));
}

/**
 * Computes histogram bins using Freedman-Diaconis or Sturges rule, capped at 30 bins.
 * @param {number[]} values
 * @param {number} [maxBins=30]
 * @returns {Array<{ label: string, min: number, max: number, count: number }>}
 */
export function computeHistogramBins(values, maxBins = 30) {
  const valid = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  const n = valid.length;
  if (n === 0) return [];

  const sorted = [...valid].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[n - 1];

  if (min === max) {
    return [{ label: String(min), min, max, count: n }];
  }

  // Sturges formula: k = ceil(log2(n) + 1)
  // Freedman-Diaconis: binWidth = 2 * IQR * n^(-1/3)
  const q25 = sorted[Math.floor(n * 0.25)];
  const q75 = sorted[Math.floor(n * 0.75)];
  const iqr = q75 - q25;

  let numBins;
  if (iqr > 0) {
    const binWidth = 2 * iqr * Math.pow(n, -1 / 3);
    numBins = Math.ceil((max - min) / binWidth);
  } else {
    numBins = Math.ceil(Math.log2(n) + 1);
  }

  numBins = Math.max(5, Math.min(maxBins, numBins));
  const binSize = (max - min) / numBins;

  const bins = [];
  for (let i = 0; i < numBins; i++) {
    const bMin = min + i * binSize;
    const bMax = i === numBins - 1 ? max : min + (i + 1) * binSize;
    bins.push({
      label: `${bMin.toFixed(1)} - ${bMax.toFixed(1)}`,
      min: bMin,
      max: bMax,
      count: 0
    });
  }

  for (const v of sorted) {
    let placed = false;
    for (let i = 0; i < bins.length; i++) {
      const b = bins[i];
      if (i === bins.length - 1 ? (v >= b.min && v <= b.max) : (v >= b.min && v < b.max)) {
        b.count++;
        placed = true;
        break;
      }
    }
    if (!placed && bins.length > 0) {
      bins[bins.length - 1].count++;
    }
  }

  return bins;
}

/**
 * Downsamples / decimates scatter points if greater than maxPoints.
 * Uses uniform stratified decimation to preserve distribution.
 * @param {Array<{ x: number, y: number, label?: string }>} points
 * @param {number} [maxPoints=5000]
 * @returns {Array<{ x: number, y: number, label?: string }>}
 */
export function decimateScatterPoints(points, maxPoints = 5000) {
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  const result = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.floor(i * step);
    if (idx < points.length) {
      result.push(points[idx]);
    }
  }
  return result;
}

/**
 * Estimates dataset memory footprint in bytes.
 * @param {Array<Map<string, any>>} rows
 * @param {Array<any>} headers
 * @returns {number} estimated memory in bytes
 */
export function estimateMemoryBytes(rows, headers) {
  const rowCount = rows.length;
  const colCount = headers.length;
  // Estimate ~64 bytes per cell average + Map overhead
  return Math.round(rowCount * (colCount * 64 + 128));
}

/**
 * Formats byte count to readable string (e.g. "1.2 MB").
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Simple debounce function for search and filter inputs.
 * @template {(...args: any[]) => void} T
 * @param {T} func
 * @param {number} wait
 * @returns {(...args: Parameters<T>) => void}
 */
export function debounce(func, wait = 250) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Smoothly animates a numeric DOM element from 0 (or start) to end value.
 * Respects prefers-reduced-motion.
 * @param {HTMLElement} element
 * @param {number} targetValue
 * @param {object} [options={}]
 * @param {number} [options.duration=700]
 * @param {string} [options.suffix='']
 * @param {string} [options.prefix='']
 * @param {number} [options.decimals=0]
 * @param {(val: number) => string} [options.formatter]
 */
export function animateCounter(element, targetValue, options = {}) {
  if (!element) return;
  const duration = options.duration ?? 700;
  const suffix = options.suffix ?? '';
  const prefix = options.prefix ?? '';
  const decimals = options.decimals ?? 0;
  const formatter = options.formatter;

  // Check prefers-reduced-motion
  const prefersReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced || duration <= 0 || typeof requestAnimationFrame === 'undefined' || typeof performance === 'undefined') {
    element.textContent = formatter ? formatter(targetValue) : `${prefix}${decimals > 0 ? targetValue.toFixed(decimals) : targetValue.toLocaleString()}${suffix}`;
    return;
  }

  const startTime = performance.now();
  const startValue = 0;

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // easeOutCubic curve: 1 - (1 - t)^3
    const easeProgress = 1 - Math.pow(1 - progress, 3);
    const currentValue = startValue + (targetValue - startValue) * easeProgress;

    if (formatter) {
      element.textContent = formatter(currentValue);
    } else {
      const formattedNumber = decimals > 0 
        ? currentValue.toFixed(decimals) 
        : Math.round(currentValue).toLocaleString();
      element.textContent = `${prefix}${formattedNumber}${suffix}`;
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      // Ensure exact final value
      if (formatter) {
        element.textContent = formatter(targetValue);
      } else {
        const formattedNumber = decimals > 0 
          ? targetValue.toFixed(decimals) 
          : Math.round(targetValue).toLocaleString();
        element.textContent = `${prefix}${formattedNumber}${suffix}`;
      }
    }
  }

  requestAnimationFrame(update);
}

