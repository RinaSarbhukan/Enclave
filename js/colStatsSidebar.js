/**
 * Column Statistics Sidebar Controller
 * Provides an interactive slide-in drawer displaying deep, per-column profiling:
 * - Coverage & missing value meter
 * - Key statistical measures (Min, Max, Mean, Median, StdDev, Sum, Range)
 * - Mini distribution histogram (Chart.js)
 * - Categorical frequency bars & top values
 * - Date span and yearly breakdown
 * - Quick column switcher
 */

import { computeHistogramBins, parseNumber, parseDate, isMissingValue } from './utils.js';

let sidebarEl = null;
let backdropEl = null;
let closeBtnEl = null;
let selectEl = null;
let histoChartInstance = null;
let getStateFn = null;

/**
 * Initializes the column statistics sidebar listeners.
 * @param {Function} getState - Function returning current global state
 */
export function setupColStatsSidebar(getState) {
  getStateFn = getState;
  sidebarEl = document.getElementById('colStatsSidebar');
  backdropEl = document.getElementById('colStatsBackdrop');
  closeBtnEl = document.getElementById('colStatsCloseBtn');
  selectEl = document.getElementById('colStatsSelect');

  if (!sidebarEl) return;

  // Close triggers
  closeBtnEl?.addEventListener('click', closeColumnStats);
  backdropEl?.addEventListener('click', closeColumnStats);

  // Keyboard shortcut: Esc closes sidebar
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebarEl && !sidebarEl.hasAttribute('hidden') && sidebarEl.classList.contains('open')) {
      closeColumnStats();
    }
  });

  // Column switcher dropdown
  if (selectEl) {
    selectEl.addEventListener('change', (e) => {
      const selectedCol = e.target.value;
      if (selectedCol) {
        populateColumnStats(selectedCol);
      }
    });
  }
}

/**
 * Opens the sidebar and populates stats for a given column key.
 * @param {string} colKey
 */
export function openColumnStats(colKey) {
  if (!sidebarEl || !getStateFn) return;
  const state = getStateFn();
  if (!state.cleanedData) return;

  // Ensure select options are up to date
  populateColumnSelectOptions(colKey);

  // Populate data for the target column
  populateColumnStats(colKey);

  // Show sidebar with smooth slide-in
  sidebarEl.removeAttribute('hidden');
  requestAnimationFrame(() => {
    sidebarEl.classList.add('open');
  });
}

/**
 * Closes the sidebar with a slide-out animation.
 */
export function closeColumnStats() {
  if (!sidebarEl) return;
  sidebarEl.classList.remove('open');
  setTimeout(() => {
    sidebarEl.setAttribute('hidden', '');
    if (histoChartInstance) {
      histoChartInstance.destroy();
      histoChartInstance = null;
    }
  }, 280);
}

/**
 * Populates the column switcher <select> with all available dataset columns.
 * @param {string} currentKey
 */
function populateColumnSelectOptions(currentKey) {
  if (!selectEl || !getStateFn) return;
  const state = getStateFn();
  const headers = state.cleanedData?.headers || [];

  selectEl.innerHTML = headers.map(h => {
    const isSelected = h.key === currentKey ? 'selected' : '';
    return `<option value="${h.key}" ${isSelected}>${h.label} (${h.type})</option>`;
  }).join('');
}

/**
 * Renders statistical cards, charts, and distribution for a specific column.
 * @param {string} colKey
 */
export function populateColumnStats(colKey) {
  if (!getStateFn) return;
  const state = getStateFn();
  if (!state.cleanedData || !state.profile) return;

  const header = state.cleanedData.headers.find(h => h.key === colKey);
  const profile = state.profile.columnProfiles?.get(colKey);
  if (!header || !profile) return;

  // 1. Header & Title
  const titleEl = document.getElementById('colStatsTitle');
  const subtitleEl = document.getElementById('colStatsSubtitle');
  if (titleEl) titleEl.textContent = header.label;

  const typeBadgeColors = {
    numeric: 'bg-primary-subtle text-primary border-primary-subtle',
    categorical: 'bg-info-subtle text-info-emphasis border-info-subtle',
    date: 'bg-success-subtle text-success border-success-subtle',
    boolean: 'bg-warning-subtle text-warning-emphasis border-warning-subtle',
    identifier: 'bg-secondary-subtle text-secondary border-secondary-subtle',
    text: 'bg-light text-dark border'
  };
  const badgeCls = typeBadgeColors[profile.type] || 'bg-light text-secondary border';

  if (subtitleEl) {
    subtitleEl.innerHTML = `
      <span class="badge border ${badgeCls} text-capitalize">${profile.type}</span>
      <span>${profile.stats?.distinctCount ?? 0} unique values</span>
    `;
  }

  // Sync column select
  if (selectEl && selectEl.value !== colKey) {
    selectEl.value = colKey;
  }

  // 2. Coverage & Missing Bar
  renderCoverageBar(profile, state.cleanedData.rows.length);

  // 3. Type-Specific Details
  const numericGrid = document.getElementById('colStatsNumericGrid');
  const histoWrapper = document.getElementById('colStatsHistoWrapper');
  const catWrapper = document.getElementById('colStatsCatWrapper');
  const dateWrapper = document.getElementById('colStatsDateWrapper');
  const boolWrapper = document.getElementById('colStatsBoolWrapper');

  // Reset visibility
  numericGrid?.classList.add('d-none');
  histoWrapper?.classList.add('d-none');
  catWrapper?.classList.add('d-none');
  dateWrapper?.classList.add('d-none');
  boolWrapper?.classList.add('d-none');

  if (profile.type === 'numeric') {
    renderNumericStats(profile, state.cleanedData.rows, colKey);
  } else if (profile.type === 'categorical' || profile.type === 'identifier' || profile.type === 'text') {
    renderCategoricalStats(profile);
  } else if (profile.type === 'date') {
    renderDateStats(profile);
  } else if (profile.type === 'boolean') {
    renderBooleanStats(profile);
  }
}

/**
 * Renders the data completeness/missing progress bar.
 */
function renderCoverageBar(profile, totalRows) {
  const container = document.getElementById('colStatsCoverage');
  if (!container) return;

  const missing = profile.missingCount || 0;
  const valid = Math.max(0, totalRows - missing);
  const validPct = totalRows > 0 ? ((valid / totalRows) * 100).toFixed(1) : 0;
  const missingPct = totalRows > 0 ? ((missing / totalRows) * 100).toFixed(1) : 0;

  const isHealthy = missingPct < 5;
  const isWarning = missingPct >= 5 && missingPct <= 25;
  const barColor = isHealthy ? '#16A34A' : (isWarning ? '#D97706' : '#DC2626');

  container.innerHTML = `
    <div class="col-stats-cov-header">
      <span class="text-muted">Data Completeness</span>
      <span class="font-mono fw-semibold">${validPct}%</span>
    </div>
    <div class="col-stats-cov-bar">
      <div class="col-stats-cov-fill" style="width: ${validPct}%; background-color: ${barColor};"></div>
    </div>
    <div class="d-flex justify-content-between align-items-center mt-2 small font-mono text-muted" style="font-size: 0.75rem;">
      <span><i class="bi bi-check-circle me-1 text-success"></i>${valid.toLocaleString()} valid</span>
      <span><i class="bi bi-slash-circle me-1 ${missing > 0 ? 'text-warning' : 'text-muted'}"></i>${missing.toLocaleString()} missing (${missingPct}%)</span>
    </div>
  `;
}

/**
 * Formats a numeric value gracefully for the stats cards.
 */
function formatStatNumber(val) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  if (Math.abs(val) >= 1e6) return (val / 1e6).toFixed(2) + 'M';
  if (Math.abs(val) >= 1e3) return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Number.isInteger(val)) return val.toLocaleString();
  return val.toFixed(val < 0.01 && val > 0 ? 4 : 2);
}

/**
 * Renders numeric grid and mini histogram.
 */
function renderNumericStats(profile, rows, colKey) {
  const numericGrid = document.getElementById('colStatsNumericGrid');
  const histoWrapper = document.getElementById('colStatsHistoWrapper');
  const stats = profile.stats;
  if (!stats) return;

  if (numericGrid) {
    numericGrid.classList.remove('d-none');
    numericGrid.innerHTML = `
      <div class="col-stats-card">
        <div class="col-stats-card-label">Mean (Average)</div>
        <div class="col-stats-card-val">${formatStatNumber(stats.mean)}</div>
      </div>
      <div class="col-stats-card">
        <div class="col-stats-card-label">Median</div>
        <div class="col-stats-card-val">${formatStatNumber(stats.median)}</div>
      </div>
      <div class="col-stats-card">
        <div class="col-stats-card-label">Minimum</div>
        <div class="col-stats-card-val">${formatStatNumber(stats.min)}</div>
      </div>
      <div class="col-stats-card">
        <div class="col-stats-card-label">Maximum</div>
        <div class="col-stats-card-val">${formatStatNumber(stats.max)}</div>
      </div>
      <div class="col-stats-card">
        <div class="col-stats-card-label">Std Deviation</div>
        <div class="col-stats-card-val">${formatStatNumber(stats.stdDev)}</div>
      </div>
      <div class="col-stats-card">
        <div class="col-stats-card-label">Range (Max - Min)</div>
        <div class="col-stats-card-val">${formatStatNumber(stats.range)}</div>
      </div>
      <div class="col-stats-card">
        <div class="col-stats-card-label">Sum Total</div>
        <div class="col-stats-card-val">${formatStatNumber(stats.sum)}</div>
      </div>
      <div class="col-stats-card">
        <div class="col-stats-card-label">Valid Count</div>
        <div class="col-stats-card-val">${(stats.count || 0).toLocaleString()}</div>
      </div>
    `;
  }

  // Render Histogram
  if (histoWrapper) {
    histoWrapper.classList.remove('d-none');
    const canvas = document.getElementById('colStatsHistoCanvas');
    if (canvas && window.Chart) {
      if (histoChartInstance) {
        histoChartInstance.destroy();
        histoChartInstance = null;
      }

      // Collect numeric values
      const numbers = [];
      for (const r of rows) {
        const v = r.get(colKey);
        if (typeof v === 'number' && !isNaN(v)) {
          numbers.push(v);
        } else if (v !== null && v !== undefined && !isMissingValue(v)) {
          const num = parseNumber(v);
          if (num !== null) numbers.push(num);
        }
      }

      const bins = computeHistogramBins(numbers, 8);
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const barColor = isDark ? '#457BFF' : '#1F4FD8';
      const textColor = isDark ? '#A09E97' : '#73726E';
      const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

      histoChartInstance = new window.Chart(canvas, {
        type: 'bar',
        data: {
          labels: bins.map(b => b.label),
          datasets: [{
            data: bins.map(b => b.count),
            backgroundColor: barColor,
            borderRadius: 3,
            maxBarThickness: 32
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => `Range: ${items[0]?.label || ''}`,
                label: (ctx) => `Count: ${ctx.parsed.y.toLocaleString()} rows`
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                color: textColor,
                font: { size: 9, family: 'IBM Plex Mono' },
                maxRotation: 45,
                minRotation: 0
              }
            },
            y: {
              beginAtZero: true,
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                font: { size: 9, family: 'IBM Plex Mono' },
                precision: 0
              }
            }
          }
        }
      });
    }
  }
}

/**
 * Renders categorical top frequency bars.
 */
function renderCategoricalStats(profile) {
  const catWrapper = document.getElementById('colStatsCatWrapper');
  const catBars = document.getElementById('colStatsCatBars');
  if (!catWrapper || !catBars) return;

  catWrapper.classList.remove('d-none');
  const freqs = profile.stats?.frequencies || [];
  const topValues = freqs.slice(0, 8);

  if (topValues.length === 0) {
    catBars.innerHTML = `<div class="text-muted small">No categorical frequency data available.</div>`;
    return;
  }

  const maxPct = Math.max(...topValues.map(v => v.percentage), 1);
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const barColors = [
    '#2563EB', '#16A34A', '#DC2626', '#D97706',
    '#7C3AED', '#0891B2', '#DB2777', '#65A30D'
  ];

  catBars.innerHTML = topValues.map((item, idx) => {
    const fillPct = ((item.percentage / maxPct) * 100).toFixed(1);
    const color = barColors[idx % barColors.length];
    return `
      <div class="col-stats-bar-item">
        <div class="col-stats-bar-meta">
          <span class="col-stats-bar-val" title="${escapeHtml(item.value)}">${escapeHtml(item.value || '(blank)')}</span>
          <span class="col-stats-bar-count">${item.count.toLocaleString()} (${item.percentage.toFixed(1)}%)</span>
        </div>
        <div class="col-stats-bar-track">
          <div class="col-stats-bar-fill" style="width: ${fillPct}%; background-color: ${color};"></div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Renders date span and yearly breakdown.
 */
function renderDateStats(profile) {
  const dateWrapper = document.getElementById('colStatsDateWrapper');
  const dateInfo = document.getElementById('colStatsDateInfo');
  const yearBars = document.getElementById('colStatsYearBars');
  if (!dateWrapper) return;

  dateWrapper.classList.remove('d-none');
  const stats = profile.stats;

  if (dateInfo) {
    const minStr = stats?.min || (stats?.minDate ? formatDateFriendly(stats.minDate) : '—');
    const maxStr = stats?.max || (stats?.maxDate ? formatDateFriendly(stats.maxDate) : '—');
    const span = stats?.spanDays ?? stats?.rangeDays;
    const days = span !== undefined && span !== null ? `${span.toLocaleString()} days` : '—';

    dateInfo.innerHTML = `
      <div class="d-flex justify-content-between">
        <span class="text-muted">Earliest date:</span>
        <span class="font-mono fw-semibold">${minStr}</span>
      </div>
      <div class="d-flex justify-content-between">
        <span class="text-muted">Latest date:</span>
        <span class="font-mono fw-semibold">${maxStr}</span>
      </div>
      <div class="d-flex justify-content-between border-top pt-2">
        <span class="text-muted">Timespan:</span>
        <span class="font-mono fw-semibold">${days}</span>
      </div>
    `;
  }

  if (yearBars) {
    const years = stats?.byYear || stats?.distributionByYear || [];
    if (years.length === 0) {
      yearBars.innerHTML = `<div class="text-muted small">No yearly breakdown available.</div>`;
      return;
    }

    const totalYearCount = years.reduce((acc, y) => acc + y.count, 0) || 1;
    const maxYearCount = Math.max(...years.map(y => y.count), 1);

    yearBars.innerHTML = years.map(item => {
      const yearLabel = item.label || item.year;
      const pct = ((item.count / totalYearCount) * 100).toFixed(1);
      const fillPct = ((item.count / maxYearCount) * 100).toFixed(1);
      return `
        <div class="col-stats-bar-item">
          <div class="col-stats-bar-meta">
            <span class="col-stats-bar-val font-mono">${yearLabel}</span>
            <span class="col-stats-bar-count">${item.count.toLocaleString()} (${pct}%)</span>
          </div>
          <div class="col-stats-bar-track">
            <div class="col-stats-bar-fill" style="width: ${fillPct}%; background-color: #10B981;"></div>
          </div>
        </div>
      `;
    }).join('');
  }
}

/**
 * Renders boolean breakdown bars.
 */
function renderBooleanStats(profile) {
  const boolWrapper = document.getElementById('colStatsBoolWrapper');
  const boolBars = document.getElementById('colStatsBoolBars');
  if (!boolWrapper || !boolBars) return;

  boolWrapper.classList.remove('d-none');
  const freqs = profile.stats?.frequencies || [];
  const total = freqs.reduce((acc, f) => acc + f.count, 0) || 1;

  boolBars.innerHTML = freqs.map(item => {
    const isTrue = item.value === 'true' || item.value === '1' || item.value === 'yes';
    const color = isTrue ? '#16A34A' : '#DC2626';
    const fillPct = ((item.count / total) * 100).toFixed(1);

    return `
      <div class="col-stats-bar-item">
        <div class="col-stats-bar-meta">
          <span class="col-stats-bar-val font-mono">${escapeHtml(item.value)}</span>
          <span class="col-stats-bar-count">${item.count.toLocaleString()} (${item.percentage.toFixed(1)}%)</span>
        </div>
        <div class="col-stats-bar-track">
          <div class="col-stats-bar-fill" style="width: ${fillPct}%; background-color: ${color};"></div>
        </div>
      </div>
    `;
  }).join('');
}

function formatDateFriendly(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return String(date);
  return date.toISOString().split('T')[0];
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
