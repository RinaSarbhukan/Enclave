/**
 * CSV Insight - Dashboard Component Module
 * Manages KPI summary cards, quality alerts, chart grid cards, and chart controls.
 */

import { formatBytes, animateCounter } from './utils.js';
import { renderChart, exportChartToPng, destroyChart, buildChartTableHtml } from './chartRenderer.js';
import { buildChartData } from './chartRecommender.js';

/**
 * Renders skeleton loading cards for the charts grid while datasets profile.
 * @param {HTMLElement} container
 * @param {number} [count=4]
 */
export function renderChartSkeletons(container, count = 4) {
  if (!container) return;
  container.innerHTML = Array.from({ length: count }, (_, i) => `
    <div class="col-12 col-lg-6 mb-4 skeleton-card-col" style="--stagger-i: ${i};">
      <div class="card-insight h-100 skeleton-card">
        <div class="card-insight-header">
          <div class="skeleton-shimmer skeleton-title-pill"></div>
          <div class="d-flex gap-1">
            <div class="skeleton-shimmer skeleton-btn-pill"></div>
            <div class="skeleton-shimmer skeleton-btn-pill"></div>
          </div>
        </div>
        <div class="card-insight-body">
          <div class="skeleton-shimmer skeleton-subtitle-pill mb-3"></div>
          <div class="skeleton-chart-placeholder">
            <div class="skeleton-shimmer skeleton-bar" style="height: 45%;"></div>
            <div class="skeleton-shimmer skeleton-bar" style="height: 75%;"></div>
            <div class="skeleton-shimmer skeleton-bar" style="height: 60%;"></div>
            <div class="skeleton-shimmer skeleton-bar" style="height: 90%;"></div>
            <div class="skeleton-shimmer skeleton-bar" style="height: 35%;"></div>
            <div class="skeleton-shimmer skeleton-bar" style="height: 70%;"></div>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

/**
 * Renders executive KPI summary strip.
 * Stats shown as one divided strip with tabular mono numbers and smooth count-up animations.
 * @param {HTMLElement} container
 * @param {object} profile
 */
export function renderSummaryCards(container, profile) {
  if (!container || !profile) return;

  const cards = [
    {
      id: 'kpi-rows',
      title: 'Total rows',
      numericVal: profile.totalRows,
      formatType: 'int',
      subtitle: `${profile.duplicateRows} duplicate${profile.duplicateRows === 1 ? '' : 's'}`
    },
    {
      id: 'kpi-cols',
      title: 'Columns',
      numericVal: profile.totalColumns,
      formatType: 'int',
      subtitle: `${profile.typeCounts?.numeric || 0} numeric, ${profile.typeCounts?.date || 0} date`
    },
    {
      id: 'kpi-missing',
      title: 'Missing cells',
      numericVal: profile.missingPercentage,
      formatType: 'percent',
      subtitle: `${(profile.totalMissingCells || 0).toLocaleString()} empty cells`
    },
    {
      id: 'kpi-mem',
      title: 'Memory in browser',
      numericVal: profile.memoryEstimateBytes,
      formatType: 'bytes',
      subtitle: 'Tabular array cache'
    }
  ];

  container.innerHTML = cards.map((c, idx) => `
    <div class="stat-cell stagger-in" style="--stagger-i: ${idx};">
      <span class="stat-label">${c.title}</span>
      <span class="stat-value font-mono" id="${c.id}">0</span>
      <span class="stat-note font-mono">${c.subtitle}</span>
    </div>
  `).join('');

  // Smoothly animate the numeric values into place
  cards.forEach((c) => {
    const el = container.querySelector(`#${c.id}`);
    if (!el) return;

    if (c.formatType === 'int') {
      animateCounter(el, c.numericVal, { duration: 650, decimals: 0 });
    } else if (c.formatType === 'percent') {
      animateCounter(el, c.numericVal, { duration: 650, decimals: 1, suffix: '%' });
    } else if (c.formatType === 'bytes') {
      animateCounter(el, c.numericVal, {
        duration: 650,
        formatter: (val) => formatBytes(Math.round(val))
      });
    }
  });
}


/**
 * Renders data quality audit findings.
 * Quiet hairline container with plain microcopy.
 * @param {HTMLElement} container
 * @param {Array<{ type: string, message: string, severity: string }>} warnings
 */
export function renderQualityWarnings(container, warnings) {
  if (!container) return;

  if (!warnings || warnings.length === 0) {
    container.innerHTML = `
      <div class="quality-box">
        <div class="small text-muted font-mono">Quality audit: 0 column anomalies detected.</div>
      </div>
    `;
    return;
  }

  const itemsHtml = warnings.map(w => `
    <div class="quality-line">
      <span class="quality-tag ${w.severity}">${w.severity}</span>
      <span>${w.message}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="quality-box">
      <div class="small text-muted font-mono text-uppercase mb-2">Quality Audit: ${warnings.length} finding${warnings.length > 1 ? 's' : ''}</div>
      ${itemsHtml}
    </div>
  `;
}

/**
 * Creates and appends a single chart card to the chart grid with varied column spans.
 * @param {HTMLElement} gridContainer
 * @param {object} chartConfig
 * @param {Array<Map<string, any>>} viewData
 * @param {Array<{ key: string, label: string, type: string }>} headers
 * @param {object} callbacks
 * @param {(chartId: string, newConfig: object) => void} callbacks.onUpdate
 * @param {(chartId: string) => void} callbacks.onDelete
 * @param {(chartId: string) => void} callbacks.onReset
 * @param {number} [index=0]
 */
export function renderChartCard(gridContainer, chartConfig, viewData, headers, callbacks, index = 0) {
  const colDiv = document.createElement('div');
  
  // Varied editorial grid spans or custom fullWidth
  let colSpan = chartConfig.fullWidth ? 'col-12' : 'col-12 col-lg-6';
  if (!chartConfig.fullWidth) {
    if (index === 0) colSpan = 'col-12 col-lg-8';
    else if (index === 1) colSpan = 'col-12 col-lg-4';
    else if (index === 4) colSpan = 'col-12 col-lg-7';
    else if (index === 5) colSpan = 'col-12 col-lg-5';
  }
  
  colDiv.className = `${colSpan} mb-4 stagger-in`;
  colDiv.style.setProperty('--stagger-i', index);
  colDiv.id = `card-wrapper-${chartConfig.id}`;

  const card = document.createElement('div');
  card.className = 'card-insight h-100';

  // Card Header
  const cardHeader = document.createElement('div');
  cardHeader.className = 'card-insight-header';

  const titleWrapper = document.createElement('div');
  titleWrapper.className = 'd-flex align-items-center gap-2';
  titleWrapper.innerHTML = `
    <span class="fw-semibold font-sans small text-main" id="title-text-${chartConfig.id}">${chartConfig.title}</span>
  `;

  // Controls Dropdown & Toolbar
  const toolsWrapper = document.createElement('div');
  toolsWrapper.className = 'd-flex align-items-center gap-1';
  toolsWrapper.innerHTML = `
    <button class="btn btn-sm btn-outline-secondary py-1 px-2 btn-table-toggle" title="Toggle Table View" id="toggle-table-${chartConfig.id}">
      <i class="bi bi-table"></i>
    </button>
    <button class="btn btn-sm btn-outline-secondary py-1 px-2 btn-export-png" title="Download PNG" id="export-png-${chartConfig.id}">
      <i class="bi bi-download"></i>
    </button>
    <button class="btn btn-sm btn-outline-secondary py-1 px-2 btn-card-resize" title="Toggle Full Width / Normal Width" id="resize-${chartConfig.id}">
      <i class="bi ${chartConfig.fullWidth ? 'bi-arrows-angle-contract' : 'bi-arrows-angle-expand'}"></i>
    </button>
    <button class="btn btn-sm btn-outline-secondary py-1 px-2 btn-chart-col-stats" title="View Column Statistics" id="col-stats-${chartConfig.id}" data-col="${chartConfig.x}">
      <i class="bi bi-bar-chart-line"></i>
    </button>
    <div class="dropdown">
      <button class="btn btn-sm btn-outline-secondary py-1 px-2 dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="Options">
        <i class="bi bi-three-dots"></i>
      </button>
      <ul class="dropdown-menu dropdown-menu-end font-sans small">
        <li><a class="dropdown-item btn-move-up" href="#" id="move-up-${chartConfig.id}"><i class="bi bi-arrow-up me-2"></i>Move up in dashboard</a></li>
        <li><a class="dropdown-item btn-move-down" href="#" id="move-down-${chartConfig.id}"><i class="bi bi-arrow-down me-2"></i>Move down in dashboard</a></li>
        <li><a class="dropdown-item btn-toggle-span" href="#" id="span-${chartConfig.id}"><i class="bi bi-arrows-expand me-2"></i>${chartConfig.fullWidth ? 'Reset card width' : 'Expand full width'}</a></li>
        <li><hr class="dropdown-divider"></li>
        <li><a class="dropdown-item btn-edit-config" href="#" id="edit-${chartConfig.id}">Customize axes & type</a></li>
        <li><a class="dropdown-item btn-reset-chart" href="#" id="reset-${chartConfig.id}">Reset to recommended</a></li>
        <li><hr class="dropdown-divider"></li>
        <li><a class="dropdown-item text-danger btn-delete-chart" href="#" id="delete-${chartConfig.id}">Delete chart</a></li>
      </ul>
    </div>
  `;

  cardHeader.appendChild(titleWrapper);
  cardHeader.appendChild(toolsWrapper);
  card.appendChild(cardHeader);

  // Card Body
  const cardBody = document.createElement('div');
  cardBody.className = 'card-insight-body';

  const reasonTag = document.createElement('div');
  reasonTag.className = 'chart-reason';
  reasonTag.textContent = `Why this chart: ${chartConfig.reason || 'Visualizes relationship between selected attributes.'}`;
  cardBody.appendChild(reasonTag);

  // View Containers (Canvas vs Table)
  const canvasWrapper = document.createElement('div');
  canvasWrapper.className = 'chart-card-canvas-wrapper';
  canvasWrapper.id = `canvas-wrapper-${chartConfig.id}`;

  const canvas = document.createElement('canvas');
  canvas.id = `canvas-${chartConfig.id}`;
  canvasWrapper.appendChild(canvas);
  cardBody.appendChild(canvasWrapper);

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'chart-card-table-wrapper d-none';
  tableWrapper.id = `table-wrapper-${chartConfig.id}`;
  cardBody.appendChild(tableWrapper);

  card.appendChild(cardBody);
  colDiv.appendChild(card);
  gridContainer.appendChild(colDiv);

  // Render initial Chart.js with click-to-filter support
  const chartData = buildChartData(chartConfig, viewData, headers);
  renderChart(canvas, chartConfig, chartData, {
    onElementClick: (label, cfg) => {
      if (callbacks.onFilterByElement) {
        callbacks.onFilterByElement(cfg.x, label);
      }
    }
  });

  // Event Listeners for controls
  const toggleBtn = toolsWrapper.querySelector(`#toggle-table-${chartConfig.id}`);
  toggleBtn.addEventListener('click', () => {
    const isShowingTable = !tableWrapper.classList.contains('d-none');
    if (isShowingTable) {
      tableWrapper.classList.add('d-none');
      canvasWrapper.classList.remove('d-none');
      toggleBtn.innerHTML = '<i class="bi bi-table"></i>';
      toggleBtn.title = 'Toggle Table View';
    } else {
      tableWrapper.innerHTML = buildChartTableHtml(chartData, chartConfig);
      canvasWrapper.classList.add('d-none');
      tableWrapper.classList.remove('d-none');
      toggleBtn.innerHTML = '<i class="bi bi-bar-chart"></i>';
      toggleBtn.title = 'Toggle Chart View';
    }
  });

  const exportBtn = toolsWrapper.querySelector(`#export-png-${chartConfig.id}`);
  exportBtn.addEventListener('click', () => {
    exportChartToPng(chartConfig.id, `${chartConfig.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.png`);
  });

  const deleteBtn = toolsWrapper.querySelector(`#delete-${chartConfig.id}`);
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    destroyChart(chartConfig.id);
    colDiv.remove();
    if (callbacks.onDelete) callbacks.onDelete(chartConfig.id);
  });

  const resetBtn = toolsWrapper.querySelector(`#reset-${chartConfig.id}`);
  resetBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (callbacks.onReset) callbacks.onReset(chartConfig.id);
  });

  const editBtn = toolsWrapper.querySelector(`#edit-${chartConfig.id}`);
  editBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openChartCustomizationModal(chartConfig, headers, (updatedConfig) => {
      Object.assign(chartConfig, updatedConfig);
      titleWrapper.querySelector('h6').textContent = chartConfig.title;
      const updatedData = buildChartData(chartConfig, viewData, headers);
      renderChart(canvas, chartConfig, updatedData);
      if (callbacks.onUpdate) callbacks.onUpdate(chartConfig.id, chartConfig);
    });
  });

  const colStatsBtn = toolsWrapper.querySelector(`#col-stats-${chartConfig.id}`);
  if (colStatsBtn) {
    colStatsBtn.addEventListener('click', () => {
      const col = colStatsBtn.getAttribute('data-col') || chartConfig.x;
      if (col && callbacks.onViewColStats) callbacks.onViewColStats(col);
    });
  }

  // Dashboard Customization: Move Up / Move Down & Toggle Width
  const moveUpBtn = toolsWrapper.querySelector(`#move-up-${chartConfig.id}`);
  if (moveUpBtn) {
    moveUpBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (callbacks.onMove) callbacks.onMove(chartConfig.id, 'up');
    });
  }

  const moveDownBtn = toolsWrapper.querySelector(`#move-down-${chartConfig.id}`);
  if (moveDownBtn) {
    moveDownBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (callbacks.onMove) callbacks.onMove(chartConfig.id, 'down');
    });
  }

  const toggleWidthAction = () => {
    chartConfig.fullWidth = !chartConfig.fullWidth;
    if (callbacks.onToggleWidth) {
      callbacks.onToggleWidth(chartConfig.id, chartConfig.fullWidth);
    } else {
      colDiv.className = `${chartConfig.fullWidth ? 'col-12' : 'col-12 col-lg-6'} mb-4`;
      const btn = toolsWrapper.querySelector(`#resize-${chartConfig.id}`);
      if (btn) btn.innerHTML = `<i class="bi ${chartConfig.fullWidth ? 'bi-arrows-angle-contract' : 'bi-arrows-angle-expand'}"></i>`;
    }
  };

  const resizeBtn = toolsWrapper.querySelector(`#resize-${chartConfig.id}`);
  if (resizeBtn) resizeBtn.addEventListener('click', toggleWidthAction);

  const spanBtn = toolsWrapper.querySelector(`#span-${chartConfig.id}`);
  if (spanBtn) spanBtn.addEventListener('click', (e) => { e.preventDefault(); toggleWidthAction(); });
}

/**
 * Returns bootstrap icon class for chart types.
 * @param {string} type
 * @returns {string}
 */
export function getChartIconClass(type) {
  switch (type) {
    case 'line':
    case 'area':
      return 'bi-graph-up';
    case 'doughnut':
    case 'pie':
      return 'bi-pie-chart';
    case 'scatter':
      return 'bi-distribute-vertical';
    case 'histogram':
      return 'bi-bar-chart-steps';
    default:
      return 'bi-bar-chart';
  }
}

/**
 * Opens chart customization modal.
 * @param {object} chartConfig
 * @param {Array<{ key: string, label: string, type: string }>} headers
 * @param {(config: object) => void} onSave
 */
export function openChartCustomizationModal(chartConfig, headers, onSave) {
  const modalEl = document.getElementById('chartCustomModal');
  if (!modalEl) return;

  const titleInput = document.getElementById('modalChartTitle');
  const typeSelect = document.getElementById('modalChartType');
  const xSelect = document.getElementById('modalChartX');
  const ySelect = document.getElementById('modalChartY');
  const aggSelect = document.getElementById('modalChartAgg');
  const legendCheck = document.getElementById('modalChartLegend');

  titleInput.value = chartConfig.title || '';
  typeSelect.value = chartConfig.type || 'bar';

  // Populate X and Y dropdowns
  xSelect.innerHTML = headers.map(h => `<option value="${h.key}" ${h.key === chartConfig.x ? 'selected' : ''}>${h.label} (${h.type})</option>`).join('');
  ySelect.innerHTML = `<option value="">-- None (Count only) --</option>` + headers.map(h => `<option value="${h.key}" ${h.key === chartConfig.y ? 'selected' : ''}>${h.label} (${h.type})</option>`).join('');
  aggSelect.value = chartConfig.aggregation || 'sum';

  const saveBtn = document.getElementById('modalSaveChartBtn');
  const newSaveBtn = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

  newSaveBtn.addEventListener('click', () => {
    const updated = {
      title: titleInput.value.trim() || 'Custom Chart',
      type: typeSelect.value,
      x: xSelect.value,
      y: ySelect.value || undefined,
      aggregation: aggSelect.value,
      showLegend: legendCheck.checked
    };

    onSave(updated);
    const bsModal = window.bootstrap.Modal.getInstance(modalEl);
    if (bsModal) bsModal.hide();
  });

  const bsModal = new window.bootstrap.Modal(modalEl);
  bsModal.show();
}

/**
 * Validates chart suitability when user adds or modifies charts manually.
 * @param {string} chartType
 * @param {string} xType
 * @param {string} yType
 * @param {string} agg
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateChartSuitability(chartType, xType, yType, agg) {
  if (chartType === 'scatter') {
    if (xType !== 'numeric' || yType !== 'numeric') {
      return {
        valid: false,
        reason: 'Scatter plots require two numeric columns (X and Y) to calculate linear relationships and scatter points.'
      };
    }
  }

  if (chartType === 'boxplot') {
    if (xType !== 'categorical' && xType !== 'boolean') {
      return {
        valid: false,
        reason: 'Box & Whisker plots require a categorical column for grouping categories on the X axis.'
      };
    }
    if (yType !== 'numeric') {
      return {
        valid: false,
        reason: 'Box & Whisker plots require a continuous numeric measure column on the Y axis to compute percentiles and outliers.'
      };
    }
  }

  if (chartType === 'bubble') {
    if (xType !== 'numeric' || yType !== 'numeric') {
      return {
        valid: false,
        reason: 'Bubble charts require continuous numeric columns on both X and Y axes.'
      };
    }
  }

  if (chartType === 'heatmap') {
    if ((xType !== 'categorical' && xType !== 'boolean') || (yType !== 'categorical' && yType !== 'boolean')) {
      return {
        valid: false,
        reason: '2D Heatmaps require categorical dimensions on both the X and Y axes to form a cross-tabulation matrix.'
      };
    }
  }

  if (chartType === 'line' || chartType === 'area') {
    if (xType !== 'date' && xType !== 'numeric') {
      return {
        valid: false,
        reason: 'Line / area trends require a chronological date or continuous numeric column on the X axis.'
      };
    }
  }

  if (['sum', 'mean'].includes(agg) && yType && yType !== 'numeric' && chartType !== 'heatmap') {
    return {
      valid: false,
      reason: `Aggregation "${agg.toUpperCase()}" can only be calculated on numeric measures.`
    };
  }

  return { valid: true };
}
