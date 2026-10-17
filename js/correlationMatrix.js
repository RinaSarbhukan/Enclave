/**
 * CSV Insight - Correlation Matrix & Heatmap Module
 * Computes bivariate Pearson correlation coefficients, linear regression,
 * and renders an interactive, color-interpolated heatmap grid with scatter plot drilldown.
 */

import { computePearsonCorrelation } from './utils.js';

/**
 * Computes simple linear regression (y = mx + b) for two numeric arrays.
 * @param {number[]} arrX
 * @param {number[]} arrY
 * @returns {{ slope: number, intercept: number, r: number, rSquared: number, minX: number, maxX: number, predict: (x: number) => number } | null}
 */
export function computeLinearRegression(arrX, arrY) {
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
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;

  for (const [x, y] of pairs) {
    sumX += x;
    sumY += y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
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

  if (denomX <= 0) return null;

  const slope = numerator / denomX;
  const intercept = meanY - slope * meanX;

  let r = null;
  if (denomY > 0) {
    r = numerator / (Math.sqrt(denomX) * Math.sqrt(denomY));
    r = Math.max(-1, Math.min(1, r));
  } else {
    r = 0;
  }

  const rSquared = r !== null ? Number((r * r).toFixed(4)) : 0;

  return {
    slope: Number(slope.toFixed(4)),
    intercept: Number(intercept.toFixed(4)),
    r: Number(r.toFixed(4)),
    rSquared,
    minX,
    maxX,
    predict: (xVal) => Number((slope * xVal + intercept).toFixed(4))
  };
}

/**
 * Classifies Pearson correlation strength and direction into human-readable description.
 * @param {number|null} r
 * @returns {{ strength: string, direction: string, label: string }}
 */
export function classifyCorrelation(r) {
  if (r === null || !Number.isFinite(r)) {
    return { strength: 'None', direction: 'neutral', label: 'Insufficient data' };
  }
  const abs = Math.abs(r);
  let strength = 'None';
  if (abs >= 0.7) strength = 'Strong';
  else if (abs >= 0.4) strength = 'Moderate';
  else if (abs >= 0.15) strength = 'Weak';
  else strength = 'Negligible';

  let direction = 'neutral';
  if (r > 0.05) direction = 'positive';
  else if (r < -0.05) direction = 'negative';

  let label = `${strength} ${direction} correlation`;
  if (strength === 'Negligible' || direction === 'neutral') {
    label = 'No linear correlation';
  }

  return { strength, direction, label };
}

/**
 * Computes full N x N correlation matrix across all numeric columns.
 * @param {Array<{ key: string, label: string, type: string, isIdentifier?: boolean }>} headers
 * @param {Array<Map<string, any>>} rows
 * @param {object} [options={}]
 * @param {boolean} [options.excludeIdentifiers=true]
 * @returns {{ columns: Array<{ key: string, label: string }>, matrix: Array<Array<object>>, topPairs: Array<object> }}
 */
export function computeCorrelationMatrix(headers, rows, options = {}) {
  const excludeIdentifiers = options.excludeIdentifiers !== false;

  const numericCols = headers.filter(h => {
    if (h.type !== 'numeric') return false;
    if (excludeIdentifiers && (h.isIdentifier || h.type === 'identifier')) return false;
    return true;
  });

  if (numericCols.length < 2) {
    return {
      columns: numericCols.map(c => ({ key: c.key, label: c.label })),
      matrix: [],
      topPairs: [],
      error: 'At least 2 numeric columns are required to compute correlations.'
    };
  }

  // Pre-extract numeric arrays
  const colData = new Map();
  for (const col of numericCols) {
    colData.set(col.key, rows.map(r => r.get(col.key)));
  }

  const n = numericCols.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(null));
  const topPairs = [];

  for (let i = 0; i < n; i++) {
    const colI = numericCols[i];
    const valsI = colData.get(colI.key);

    for (let j = 0; j < n; j++) {
      const colJ = numericCols[j];

      if (i === j) {
        matrix[i][j] = {
          xKey: colI.key,
          xLabel: colI.label,
          yKey: colJ.key,
          yLabel: colJ.label,
          r: 1.0,
          isDiagonal: true,
          classification: { strength: 'Perfect', direction: 'positive', label: 'Identity (1.00)' }
        };
      } else if (i < j) {
        const valsJ = colData.get(colJ.key);
        const r = computePearsonCorrelation(valsI, valsJ);
        const classification = classifyCorrelation(r);

        const cellData = {
          xKey: colI.key,
          xLabel: colI.label,
          yKey: colJ.key,
          yLabel: colJ.label,
          r,
          isDiagonal: false,
          classification
        };

        matrix[i][j] = cellData;
        // Symmetric mirror
        matrix[j][i] = {
          ...cellData,
          xKey: colJ.key,
          xLabel: colJ.label,
          yKey: colI.key,
          yLabel: colI.label
        };

        if (r !== null) {
          topPairs.push({
            col1: colI,
            col2: colJ,
            r,
            absR: Math.abs(r),
            classification
          });
        }
      }
    }
  }

  // Sort top pairs by absolute correlation strength descending
  topPairs.sort((a, b) => b.absR - a.absR);

  return {
    columns: numericCols.map(c => ({ key: c.key, label: c.label })),
    matrix,
    topPairs
  };
}

/**
 * Calculates accessible HSL color representation for correlation coefficient r.
 * Positive r: vibrant deep blue / indigo (hsl(217, 85%, 52%))
 * Negative r: warm coral / crimson (hsl(350, 80%, 54%))
 * Zero r: neutral subtle surface
 * @param {number|null} r
 * @param {boolean} isDarkTheme
 * @returns {{ bg: string, text: string, border: string }}
 */
export function getCorrelationColor(r, isDarkTheme = false) {
  if (r === null || !Number.isFinite(r)) {
    return {
      bg: isDarkTheme ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)',
      text: isDarkTheme ? '#888' : '#777',
      border: 'transparent'
    };
  }

  const abs = Math.abs(r);

  if (r > 0) {
    // Blue/Indigo scale
    // Opacity scales from 0.08 (weak) up to 0.88 (strong)
    const alpha = (0.10 + abs * 0.78).toFixed(2);
    const bg = `rgba(31, 79, 216, ${alpha})`;
    const text = abs > 0.45 ? '#FFFFFF' : (isDarkTheme ? '#EDEDEB' : '#141413');
    return { bg, text, border: `rgba(31, 79, 216, 0.2)` };
  } else if (r < 0) {
    // Crimson / Rose scale
    const alpha = (0.10 + abs * 0.78).toFixed(2);
    const bg = `rgba(225, 29, 72, ${alpha})`;
    const text = abs > 0.45 ? '#FFFFFF' : (isDarkTheme ? '#EDEDEB' : '#141413');
    return { bg, text, border: `rgba(225, 29, 72, 0.2)` };
  } else {
    return {
      bg: isDarkTheme ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
      text: isDarkTheme ? '#C2C1BA' : '#444340',
      border: 'transparent'
    };
  }
}

/**
 * Renders the complete Correlation Matrix Card component.
 * @param {HTMLElement} container
 * @param {object} params
 * @param {Array<{ key: string, label: string, type: string }>} params.headers
 * @param {Array<Map<string, any>>} params.rows
 * @param {(colX: object, colY: object, r: number) => void} params.onInspectScatter
 */
export function renderCorrelationCard(container, { headers, rows, onInspectScatter }) {
  if (!container) return;

  const result = computeCorrelationMatrix(headers, rows);

  if (result.error || result.columns.length < 2) {
    container.innerHTML = `
      <div class="card-insight">
        <div class="card-insight-body p-4 text-center">
          <i class="bi bi-grid-3x3 text-muted fs-4 d-block mb-2"></i>
          <div class="fw-semibold small text-main mb-1">Correlation Heatmap Unavailable</div>
          <div class="text-muted small">At least 2 numeric measure columns are required to calculate bivariate Pearson correlations.</div>
        </div>
      </div>
    `;
    return;
  }

  const { columns, matrix, topPairs } = result;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  let currentMinThreshold = 0; // Filter threshold: 0, 0.3, 0.5, 0.7
  let currentViewMode = 'grid'; // 'grid' | 'pairs'

  const cardHtml = `
    <div class="card-insight mb-4" id="correlationHeatmapCard">
      <!-- Card Header -->
      <div class="card-insight-header d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div class="d-flex align-items-center gap-2">
          <i class="bi bi-grid-3x3 text-primary"></i>
          <div>
            <span class="fw-semibold font-sans small text-main">Pearson Correlation Matrix</span>
            <span class="badge bg-light text-muted border ms-2 font-mono" id="corrVariableCount">${columns.length} measures</span>
          </div>
        </div>

        <!-- Controls Toolbar -->
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <!-- View Switcher -->
          <div class="btn-group btn-group-sm" role="group" aria-label="Correlation view mode">
            <button type="button" class="btn btn-outline-secondary active" id="btnCorrViewGrid" title="Heatmap Grid View">
              <i class="bi bi-grid-3x3-gap"></i> Grid
            </button>
            <button type="button" class="btn btn-outline-secondary" id="btnCorrViewPairs" title="Ranked Pairs View">
              <i class="bi bi-list-ol"></i> Top Pairs
            </button>
          </div>

          <!-- Threshold Filter -->
          <div class="d-flex align-items-center gap-1">
            <label class="small text-muted font-sans mb-0 d-none d-sm-inline" for="corrThresholdSelect">Filter:</label>
            <select class="form-select form-select-sm font-sans" id="corrThresholdSelect" style="width: auto;">
              <option value="0">All (|r| ≥ 0)</option>
              <option value="0.3">Mild (|r| ≥ 0.3)</option>
              <option value="0.5">Moderate (|r| ≥ 0.5)</option>
              <option value="0.7">Strong (|r| ≥ 0.7)</option>
            </select>
          </div>

          <!-- Download Matrix CSV -->
          <button type="button" class="btn btn-sm btn-outline-secondary" id="btnExportCorrCsv" title="Download Correlation Matrix CSV">
            <i class="bi bi-download"></i> CSV
          </button>
        </div>
      </div>

      <!-- Card Body -->
      <div class="card-insight-body p-3">
        <!-- Interactive Legend -->
        <div class="corr-legend-bar d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3 p-2 rounded">
          <div class="d-flex align-items-center gap-2 small">
            <span class="text-muted font-sans">Correlation scale:</span>
            <span class="corr-legend-pill negative">-1.0 (Inverse)</span>
            <div class="corr-legend-gradient"></div>
            <span class="corr-legend-pill positive">+1.0 (Direct)</span>
          </div>
          <div class="text-muted small font-mono">
            <i class="bi bi-cursor-fill me-1 text-primary"></i> Click cell to inspect scatter plot & regression fit
          </div>
        </div>

        <!-- Heatmap Grid View -->
        <div id="corrGridView" class="corr-scroll-container">
          <div id="corrTableMount"></div>
        </div>

        <!-- Ranked Pairs View (Hidden by default) -->
        <div id="corrPairsView" class="d-none">
          <div class="table-responsive">
            <table class="table table-sm table-hover align-middle mb-0 font-sans">
              <thead>
                <tr class="text-muted small text-uppercase">
                  <th style="width: 50px;">Rank</th>
                  <th>Variable X</th>
                  <th>Variable Y</th>
                  <th class="text-center" style="width: 140px;">Correlation (r)</th>
                  <th>Relationship</th>
                  <th class="text-end" style="width: 130px;">Action</th>
                </tr>
              </thead>
              <tbody id="corrPairsTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = cardHtml;

  // Mount table renderer
  function updateHeatmapView() {
    const mount = container.querySelector('#corrTableMount');
    if (!mount) return;

    let tableHtml = `
      <table class="table table-bordered corr-matrix-table mb-0">
        <thead>
          <tr>
            <th class="corr-corner-cell"></th>
    `;

    for (const col of columns) {
      tableHtml += `
        <th class="corr-col-header text-truncate font-mono small" title="${col.label}">
          ${col.label}
        </th>
      `;
    }
    tableHtml += `</tr></thead><tbody>`;

    for (let i = 0; i < columns.length; i++) {
      const rowCol = columns[i];
      tableHtml += `
        <tr>
          <th class="corr-row-header text-truncate font-mono small" title="${rowCol.label}">
            ${rowCol.label}
          </th>
      `;

      for (let j = 0; j < columns.length; j++) {
        const cell = matrix[i][j];
        const rVal = cell.r;
        const absVal = rVal !== null ? Math.abs(rVal) : 0;
        const isDimmed = !cell.isDiagonal && absVal < currentMinThreshold;

        const colors = getCorrelationColor(rVal, isDark);
        const rDisplay = cell.isDiagonal ? '1.00' : (rVal !== null ? (rVal > 0 ? `+${rVal.toFixed(2)}` : rVal.toFixed(2)) : '—');

        const cellTooltip = cell.isDiagonal
          ? `${rowCol.label}: Identity (1.00)`
          : `${rowCol.label} vs ${columns[j].label} (r = ${rVal !== null ? rVal : 'N/A'})\n${cell.classification.label}\nClick to inspect scatter plot`;

        tableHtml += `
          <td class="corr-cell font-mono ${cell.isDiagonal ? 'corr-diagonal' : ''} ${isDimmed ? 'corr-dimmed' : ''}"
              data-row="${i}"
              data-col="${j}"
              style="background-color: ${colors.bg}; color: ${colors.text};"
              title="${cellTooltip}"
              tabindex="0"
              role="button"
              aria-label="${cellTooltip}">
            ${rDisplay}
          </td>
        `;
      }
      tableHtml += `</tr>`;
    }

    tableHtml += `</tbody></table>`;
    mount.innerHTML = tableHtml;

    // Attach click events to non-diagonal cells
    mount.querySelectorAll('.corr-cell:not(.corr-diagonal)').forEach(td => {
      td.addEventListener('click', () => {
        const i = parseInt(td.getAttribute('data-row'), 10);
        const j = parseInt(td.getAttribute('data-col'), 10);
        const cell = matrix[i][j];
        if (cell && onInspectScatter) {
          onInspectScatter(columns[j], columns[i], cell.r);
        }
      });
      td.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          td.click();
        }
      });
    });
  }

  function updatePairsView() {
    const tbody = container.querySelector('#corrPairsTableBody');
    if (!tbody) return;

    const filtered = topPairs.filter(p => p.absR >= currentMinThreshold);

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center py-4 text-muted small">
            No variable pairs meet the minimum correlation threshold of |r| ≥ ${currentMinThreshold}.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map((pair, idx) => {
      const colors = getCorrelationColor(pair.r, isDark);
      const rFormatted = pair.r > 0 ? `+${pair.r.toFixed(3)}` : pair.r.toFixed(3);
      const barWidth = Math.round(pair.absR * 100);
      const barColor = pair.r > 0 ? '#1f4fd8' : '#e11d48';

      return `
        <tr>
          <td class="font-mono small text-muted">${idx + 1}</td>
          <td class="fw-semibold small">${pair.col1.label}</td>
          <td class="fw-semibold small">${pair.col2.label}</td>
          <td class="text-center font-mono">
            <span class="badge" style="background-color: ${colors.bg}; color: ${colors.text}; border: 1px solid ${colors.border}; min-width: 65px;">
              ${rFormatted}
            </span>
          </td>
          <td>
            <div class="d-flex align-items-center gap-2">
              <div class="corr-mini-bar-track flex-grow-1" style="height: 6px; background: rgba(0,0,0,0.06); border-radius: 3px; max-width: 80px;">
                <div style="height: 100%; width: ${barWidth}%; background-color: ${barColor}; border-radius: 3px;"></div>
              </div>
              <span class="small text-muted">${pair.classification.label}</span>
            </div>
          </td>
          <td class="text-end">
            <button class="btn btn-xs btn-outline-primary btn-plot-pair" data-idx="${idx}">
              <i class="bi bi-graph-up me-1"></i> Scatter
            </button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-plot-pair').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const pair = filtered[idx];
        if (pair && onInspectScatter) {
          onInspectScatter(pair.col1, pair.col2, pair.r);
        }
      });
    });
  }

  // Export Matrix as CSV
  const exportBtn = container.querySelector('#btnExportCorrCsv');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      let csvContent = 'data:text/csv;charset=utf-8,Variable,' + columns.map(c => `"${c.label.replace(/"/g, '""')}"`).join(',') + '\n';
      for (let i = 0; i < columns.length; i++) {
        const row = [ `"${columns[i].label.replace(/"/g, '""')}"` ];
        for (let j = 0; j < columns.length; j++) {
          const val = matrix[i][j].r;
          row.push(val !== null ? val.toString() : '');
        }
        csvContent += row.join(',') + '\n';
      }
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', 'correlation-matrix.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }

  // View mode switcher
  const btnGrid = container.querySelector('#btnCorrViewGrid');
  const btnPairs = container.querySelector('#btnCorrViewPairs');
  const gridView = container.querySelector('#corrGridView');
  const pairsView = container.querySelector('#corrPairsView');

  if (btnGrid && btnPairs) {
    btnGrid.addEventListener('click', () => {
      currentViewMode = 'grid';
      btnGrid.classList.add('active');
      btnPairs.classList.remove('active');
      gridView.classList.remove('d-none');
      pairsView.classList.add('d-none');
      updateHeatmapView();
    });

    btnPairs.addEventListener('click', () => {
      currentViewMode = 'pairs';
      btnPairs.classList.add('active');
      btnGrid.classList.remove('active');
      pairsView.classList.remove('d-none');
      gridView.classList.add('d-none');
      updatePairsView();
    });
  }

  // Threshold filter select
  const thresholdSelect = container.querySelector('#corrThresholdSelect');
  if (thresholdSelect) {
    thresholdSelect.addEventListener('change', (e) => {
      currentMinThreshold = parseFloat(e.target.value) || 0;
      if (currentViewMode === 'grid') {
        updateHeatmapView();
      } else {
        updatePairsView();
      }
    });
  }

  // Initial render
  updateHeatmapView();
}

/**
 * Controller for the Scatter Plot Drilldown Modal.
 * Renders a full interactive scatter plot with linear regression fit line,
 * Pearson r, R², equation, and "Pin to Dashboard" action.
 */
let scatterModalChart = null;

export function openScatterModal({ colX, colY, r, rows, onPinChart }) {
  const modalEl = document.getElementById('correlationScatterModal');
  if (!modalEl) return;

  const titleEl = document.getElementById('corrScatterModalTitle');
  const badgeREl = document.getElementById('corrScatterBadgeR');
  const badgeR2El = document.getElementById('corrScatterBadgeR2');
  const badgeEqEl = document.getElementById('corrScatterBadgeEq');
  const badgeCountEl = document.getElementById('corrScatterBadgeCount');
  const canvasEl = document.getElementById('corrScatterModalCanvas');
  const pinBtn = document.getElementById('corrScatterPinBtn');

  if (titleEl) titleEl.textContent = `${colY.label} vs ${colX.label}`;

  // Extract numeric points
  const rawX = rows.map(r => r.get(colX.key));
  const rawY = rows.map(r => r.get(colY.key));

  const regression = computeLinearRegression(rawX, rawY);

  const validPoints = [];
  for (let i = 0; i < rawX.length; i++) {
    const x = rawX[i];
    const y = rawY[i];
    if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
      validPoints.push({ x, y });
    }
  }

  // Stratified decimation if points exceed 3,000 for modal responsiveness
  let displayPoints = validPoints;
  if (validPoints.length > 3000) {
    const step = Math.ceil(validPoints.length / 3000);
    displayPoints = validPoints.filter((_, idx) => idx % step === 0);
  }

  if (badgeREl) {
    const rVal = regression ? regression.r : r;
    badgeREl.textContent = `Pearson r: ${rVal > 0 ? '+' : ''}${rVal.toFixed(3)}`;
  }
  if (badgeR2El) {
    badgeR2El.textContent = `R²: ${regression ? regression.rSquared.toFixed(3) : '0'}`;
  }
  if (badgeEqEl) {
    if (regression) {
      const sign = regression.intercept >= 0 ? '+' : '-';
      badgeEqEl.textContent = `Fit: y = ${regression.slope}x ${sign} ${Math.abs(regression.intercept)}`;
    } else {
      badgeEqEl.textContent = `Fit: N/A`;
    }
  }
  if (badgeCountEl) {
    badgeCountEl.textContent = `${validPoints.length.toLocaleString()} data pairs`;
  }

  // Destroy previous chart instance if existing
  if (scatterModalChart) {
    scatterModalChart.destroy();
    scatterModalChart = null;
  }

  // Render Chart.js scatter with regression line
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const Chart = window.Chart;

  if (Chart && canvasEl) {
    const datasets = [
      {
        type: 'scatter',
        label: `${colY.label} vs ${colX.label}`,
        data: displayPoints,
        backgroundColor: isDark ? 'rgba(69, 123, 255, 0.65)' : 'rgba(31, 79, 216, 0.65)',
        borderColor: isDark ? '#457BFF' : '#1F4FD8',
        borderWidth: 1,
        pointRadius: displayPoints.length > 500 ? 2.5 : 4,
        pointHoverRadius: 6
      }
    ];

    if (regression && regression.minX !== regression.maxX) {
      const minX = regression.minX;
      const maxX = regression.maxX;
      datasets.push({
        type: 'line',
        label: 'Linear Trendline',
        data: [
          { x: minX, y: regression.predict(minX) },
          { x: maxX, y: regression.predict(maxX) }
        ],
        borderColor: '#e11d48',
        borderWidth: 2.5,
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false,
        tension: 0
      });
    }

    scatterModalChart = new Chart(canvasEl, {
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: isDark ? '#EDEDEB' : '#141413',
              font: { family: "'IBM Plex Sans', sans-serif", size: 12 }
            }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                if (ctx.dataset.type === 'line') return `Trendline: y = ${ctx.parsed.y}`;
                return `(${colX.label}: ${ctx.parsed.x}, ${colY.label}: ${ctx.parsed.y})`;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            position: 'bottom',
            title: {
              display: true,
              text: colX.label,
              color: isDark ? '#C2C1BA' : '#444340',
              font: { family: "'IBM Plex Sans', sans-serif", weight: 'bold' }
            },
            grid: { color: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)' },
            ticks: { color: isDark ? '#9E9D95' : '#73726E' }
          },
          y: {
            type: 'linear',
            title: {
              display: true,
              text: colY.label,
              color: isDark ? '#C2C1BA' : '#444340',
              font: { family: "'IBM Plex Sans', sans-serif", weight: 'bold' }
            },
            grid: { color: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)' },
            ticks: { color: isDark ? '#9E9D95' : '#73726E' }
          }
        }
      }
    });
  }

  // Set up Pin to Dashboard button
  if (pinBtn) {
    // Clear old listeners
    const newPinBtn = pinBtn.cloneNode(true);
    pinBtn.parentNode.replaceChild(newPinBtn, pinBtn);

    newPinBtn.addEventListener('click', () => {
      if (onPinChart) {
        onPinChart(colX, colY, regression ? regression.r : r);
        const bsModal = window.bootstrap?.Modal?.getInstance(modalEl);
        if (bsModal) bsModal.hide();
      }
    });
  }

  const bsModal = new window.bootstrap.Modal(modalEl);
  bsModal.show();
}
