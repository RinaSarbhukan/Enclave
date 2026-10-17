/**
 * CSV Insight - Chart Renderer Module
 * Handles Chart.js lifecycle, color-blind safe palettes, view-as-table toggles, and memory cleanup.
 */

// Color Theme Presets
export const CHART_THEMES = {
  default: {
    id: 'default',
    label: 'Electric Cobalt',
    badgeColor: '#2563EB',
    light: [
      '#2563EB', '#16A34A', '#DC2626', '#D97706', '#7C3AED', '#0891B2',
      '#DB2777', '#65A30D', '#EA580C', '#0F766E', '#9333EA', '#B45309'
    ],
    dark: [
      '#60A5FA', '#34D399', '#F87171', '#FBBF24', '#A78BFA', '#22D3EE',
      '#F472B6', '#A3E635', '#FB923C', '#2DD4BF', '#C084FC', '#FCD34D'
    ]
  },
  emerald: {
    id: 'emerald',
    label: 'Emerald Mint',
    badgeColor: '#059669',
    light: [
      '#059669', '#0D9488', '#10B981', '#14B8A6', '#047857', '#0F766E',
      '#65A30D', '#22C55E', '#15803D', '#2DD4BF', '#0284C7', '#34D399'
    ],
    dark: [
      '#34D399', '#2DD4BF', '#6EE7B7', '#5EEAD4', '#A7F3D0', '#14B8A6',
      '#A3E635', '#4ADE80', '#86EFAC', '#99F6E4', '#38BDF8', '#6EE7B7'
    ]
  },
  sunset: {
    id: 'sunset',
    label: 'Sunset Amber',
    badgeColor: '#EA580C',
    light: [
      '#EA580C', '#D97706', '#F59E0B', '#DC2626', '#E11D48', '#B45309',
      '#F97316', '#C026D3', '#7C3AED', '#BE123C', '#EAB308', '#9333EA'
    ],
    dark: [
      '#FB923C', '#FBBF24', '#FCD34D', '#F87171', '#FB7185', '#F59E0B',
      '#FDBA74', '#E879F9', '#C084FC', '#FDA4AF', '#FDE047', '#D8B4FE'
    ]
  },
  cyber: {
    id: 'cyber',
    label: 'Cyber Neon',
    badgeColor: '#EC4899',
    light: [
      '#06B6D4', '#EC4899', '#8B5CF6', '#10B981', '#F59E0B', '#3B82F6',
      '#F43F5E', '#6366F1', '#14B8A6', '#D946EF', '#EAB308', '#0EA5E9'
    ],
    dark: [
      '#22D3EE', '#F472B6', '#A78BFA', '#34D399', '#FBBF24', '#60A5FA',
      '#FB7185', '#818CF8', '#2DD4BF', '#F0ABFC', '#FDE047', '#38BDF8'
    ]
  },
  pastel: {
    id: 'pastel',
    label: 'Pastel Calm',
    badgeColor: '#8B5CF6',
    light: [
      '#64748B', '#0284C7', '#8B5CF6', '#059669', '#D97706', '#E11D48',
      '#6366F1', '#0D9488', '#DB2777', '#4B5563', '#2563EB', '#16A34A'
    ],
    dark: [
      '#94A3B8', '#38BDF8', '#C084FC', '#6EE7B7', '#FCD34D', '#FDA4AF',
      '#A5B4FC', '#5EEAD4', '#F472B6', '#CBD5E1', '#93C5FD', '#86EFAC'
    ]
  }
};

let currentThemeKey = 'default';

export function getChartThemeKey() {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('csv_chart_theme') || currentThemeKey;
  }
  return currentThemeKey;
}

export function setChartThemeKey(key) {
  if (CHART_THEMES[key]) {
    currentThemeKey = key;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('csv_chart_theme', key);
    }
    return true;
  }
  return false;
}

export function getActivePalettes() {
  const key = getChartThemeKey();
  const theme = CHART_THEMES[key] || CHART_THEMES.default;
  const darkMode = isDarkMode();
  const basePalette = darkMode ? theme.dark : theme.light;
  const alphaPalette = basePalette.map(hex => `${hex}${darkMode ? '40' : '30'}`);
  return { palette: basePalette, paletteAlpha: alphaPalette };
}

// Vibrant, visually distinct light-mode palette (backwards-compatible alias)
export const COLOR_PALETTE = CHART_THEMES.default.light;
export const COLOR_PALETTE_ALPHA = COLOR_PALETTE.map(hex => `${hex}30`);

// Vibrant dark-mode palette (backwards-compatible alias)
export const DARK_COLOR_PALETTE = CHART_THEMES.default.dark;
export const DARK_COLOR_PALETTE_ALPHA = DARK_COLOR_PALETTE.map(hex => `${hex}40`);


/**
 * Checks whether dark mode is currently active.
 * @returns {boolean}
 */
export function isDarkMode() {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

/**
 * Chart instances registry to prevent memory leaks and canvas conflicts.
 * @type {Map<string, any>}
 */
const chartRegistry = new Map();

/**
 * Destroys any existing Chart.js instance for the given chart ID.
 * @param {string} chartId
 */
export function destroyChart(chartId) {
  if (chartRegistry.has(chartId)) {
    try {
      const chart = chartRegistry.get(chartId);
      chart.destroy();
    } catch (e) {
      console.warn(`Error destroying chart ${chartId}:`, e);
    }
    chartRegistry.delete(chartId);
  }
}

/**
 * Destroys all currently rendered chart instances.
 */
export function destroyAllCharts() {
  for (const [id, chart] of chartRegistry.entries()) {
    try {
      chart.destroy();
    } catch (e) {
      console.warn(`Error destroying chart ${id}:`, e);
    }
  }
  chartRegistry.clear();
}

/**
 * Checks if user prefers reduced motion.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return false;
}

/**
 * Resolves the global Chart instance.
 * @returns {any}
 */
export function getChartJs() {
  if (typeof window !== 'undefined' && window.Chart) {
    return window.Chart;
  }
  return null;
}

/**
 * Renders or updates a chart onto a canvas element.
 * @param {HTMLCanvasElement} canvas
 * @param {object} chartConfig
 * @param {{ labels: string[], datasets: any[] }} chartData
 * @param {object} [options={}]
 * @returns {any} Chart instance
 */
export function renderChart(canvas, chartConfig, chartData, options = {}) {
  const Chart = getChartJs();
  if (!Chart) {
    console.error('Chart.js is not loaded.');
    return null;
  }

  if (chartConfig.type === 'heatmap') {
    return renderCanvasHeatmap(canvas, chartConfig, chartData, options);
  }

  const chartId = chartConfig.id;
  destroyChart(chartId);

  const reducedMotion = prefersReducedMotion();
  const darkMode = isDarkMode();
  const { palette, paletteAlpha } = getActivePalettes();

  const isHorizontal = chartConfig.horizontal || false;
  const isPieOrDoughnut = chartConfig.type === 'doughnut' || chartConfig.type === 'pie';
  const isScatter = chartConfig.type === 'scatter';
  const isBubble = chartConfig.type === 'bubble';
  const isBoxPlot = chartConfig.type === 'boxplot';

  // Apply vivid colorful styling per chart type
  const datasets = chartData.datasets.map((ds, idx) => {
    const color = palette[idx % palette.length];
    const alphaColor = paletteAlpha[idx % paletteAlpha.length];

    if (isPieOrDoughnut) {
      // Expand palette cyclically to cover all label slices
      const sliceColors = chartData.labels.map((_, i) => palette[i % palette.length]);
      const sliceAlpha = chartData.labels.map((_, i) => paletteAlpha[i % paletteAlpha.length]);
      return {
        ...ds,
        backgroundColor: sliceColors,
        hoverBackgroundColor: sliceColors.map(c => c + 'CC'),
        borderColor: darkMode ? '#111110' : '#FFFFFF',
        borderWidth: 2
      };
    }

    if (chartConfig.type === 'line' || chartConfig.type === 'area') {
      return {
        ...ds,
        borderColor: color,
        backgroundColor: alphaColor,
        borderWidth: 2.5,
        tension: 0.35,
        pointBackgroundColor: color,
        pointBorderColor: darkMode ? '#1a1a18' : '#ffffff',
        pointBorderWidth: 1.5,
        pointRadius: chartData.labels.length > 50 ? 0 : 3,
        pointHoverRadius: 5.5,
        fill: ds.fill ?? (chartConfig.type === 'area')
      };
    }

    if (isScatter) {
      return {
        ...ds,
        backgroundColor: color + 'BB',
        borderColor: color,
        borderWidth: 1,
        pointRadius: 4,
        pointHoverRadius: 6
      };
    }

    if (isBubble) {
      return {
        ...ds,
        backgroundColor: alphaColor,
        borderColor: color,
        borderWidth: 1.5,
        hoverRadius: 2
      };
    }

    if (isBoxPlot) {
      const numBoxes = chartData.labels.length;
      const boxColors = chartData.labels.map((_, i) => paletteAlpha[i % paletteAlpha.length]);
      const borderColors = chartData.labels.map((_, i) => palette[i % palette.length]);
      return {
        ...ds,
        backgroundColor: boxColors,
        hoverBackgroundColor: borderColors.map(c => c + 'AA'),
        borderColor: borderColors,
        borderWidth: 1.5,
        borderRadius: 4,
        borderSkipped: false
      };
    }

    // Bar / histogram: each bar gets a different colour from the palette
    const numBars = chartData.labels.length;
    const barColors = chartData.labels.map((_, i) => palette[i % palette.length]);
    const barAlpha = chartData.labels.map((_, i) => paletteAlpha[i % paletteAlpha.length]);

    // Multiple datasets (grouped bar) → single colour per dataset series
    const isMultiSeries = chartData.datasets.length > 1;
    return {
      ...ds,
      backgroundColor: isMultiSeries ? color : barColors,
      hoverBackgroundColor: isMultiSeries ? color + 'CC' : barColors.map(c => c + 'CC'),
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius: 4,
      borderSkipped: false
    };
  });

  let chartType = chartConfig.type;
  if (chartConfig.type === 'histogram' || chartConfig.type === 'boxplot') {
    chartType = 'bar';
  } else if (chartConfig.type === 'area') {
    chartType = 'line';
  }

  // Box & Whisker custom Chart.js rendering plugin
  const boxPlotPlugin = {
    id: 'boxPlotPlugin',
    afterDatasetsDraw(chart) {
      if (!isBoxPlot) return;
      const ctx = chart.ctx;
      const meta = chart.getDatasetMeta(0);
      const statsList = chartData.datasets[0]?._boxPlotStats;
      if (!meta || !statsList) return;

      const yScale = chart.scales.y;
      const whiskerColor = darkMode ? '#EDEDEB' : '#141413';
      const medianColor = darkMode ? '#FFFFFF' : '#000000';
      const outlierColor = '#E11D48';

      ctx.save();
      meta.data.forEach((bar, idx) => {
        const stats = statsList[idx];
        if (!stats) return;

        const x = bar.x;
        const width = bar.width;
        const capWidth = Math.max(8, width * 0.45);

        const yLower = yScale.getPixelForValue(stats.lowerWhisker);
        const yQ1 = yScale.getPixelForValue(stats.q1);
        const yMedian = yScale.getPixelForValue(stats.median);
        const yQ3 = yScale.getPixelForValue(stats.q3);
        const yUpper = yScale.getPixelForValue(stats.upperWhisker);

        ctx.strokeStyle = whiskerColor;
        ctx.lineWidth = 1.5;

        // Lower whisker
        ctx.beginPath();
        ctx.moveTo(x, yQ1);
        ctx.lineTo(x, yLower);
        ctx.stroke();

        // Lower cap
        ctx.beginPath();
        ctx.moveTo(x - capWidth / 2, yLower);
        ctx.lineTo(x + capWidth / 2, yLower);
        ctx.stroke();

        // Upper whisker
        ctx.beginPath();
        ctx.moveTo(x, yQ3);
        ctx.lineTo(x, yUpper);
        ctx.stroke();

        // Upper cap
        ctx.beginPath();
        ctx.moveTo(x - capWidth / 2, yUpper);
        ctx.lineTo(x + capWidth / 2, yUpper);
        ctx.stroke();

        // Median line across the box
        ctx.strokeStyle = medianColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x - width / 2, yMedian);
        ctx.lineTo(x + width / 2, yMedian);
        ctx.stroke();

        // Outliers
        if (stats.outliers && stats.outliers.length > 0) {
          ctx.fillStyle = outlierColor;
          ctx.strokeStyle = whiskerColor;
          ctx.lineWidth = 1;
          stats.outliers.forEach(outlierVal => {
            const yOut = yScale.getPixelForValue(outlierVal);
            ctx.beginPath();
            ctx.arc(x, yOut, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          });
        }
      });
      ctx.restore();
    }
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: reducedMotion ? false : { duration: 150 }, // 120-200ms fades
    indexAxis: isHorizontal ? 'y' : 'x',
    onHover: (evt, elements) => {
      if (evt.native?.target) {
        evt.native.target.style.cursor = elements && elements.length > 0 ? 'pointer' : 'default';
      }
    },
    onClick: (evt, elements) => {
      if (elements && elements.length > 0 && typeof options.onElementClick === 'function') {
        const first = elements[0];
        const label = chartData.labels[first.index];
        if (label && !label.startsWith('Other')) {
          options.onElementClick(label, chartConfig);
        }
      }
    },
    plugins: {
      title: {
        display: false
      },
      legend: {
        display: options.showLegend ?? (datasets.length > 1),
        position: 'top',
        align: 'end',
        labels: {
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: true,
          font: { family: "'IBM Plex Sans', sans-serif", size: 11 },
          color: darkMode ? '#B5B4AE' : '#73726E'
        }
      },
      tooltip: {
        backgroundColor: darkMode ? '#1E1E1C' : '#FFFFFF',
        borderColor: darkMode ? '#2E2E2A' : '#E7E5DF',
        borderWidth: 1,
        padding: 8,
        cornerRadius: 4,
        titleFont: { family: "'IBM Plex Sans', sans-serif", size: 11, weight: '600' },
        titleColor: darkMode ? '#EDEDEB' : '#141413',
        bodyFont: { family: "'IBM Plex Mono', monospace", size: 11 },
        bodyColor: darkMode ? '#B5B4AE' : '#444340',
        displayColors: false,
        boxShadow: 'none',
        callbacks: isBoxPlot ? {
          title: (items) => items[0]?.label || '',
          label: (ctx) => {
            const stats = chartData.datasets[0]?._boxPlotStats?.[ctx.dataIndex];
            if (!stats) return '';
            return [
              `Max: ${stats.max}`,
              `Upper Whisker: ${stats.upperWhisker}`,
              `Q3 (75%): ${stats.q3}`,
              `Median: ${stats.median}`,
              `Mean: ${stats.mean}`,
              `Q1 (25%): ${stats.q1}`,
              `Lower Whisker: ${stats.lowerWhisker}`,
              `Min: ${stats.min}`,
              `IQR: ${stats.iqr}`,
              stats.outliers.length > 0 ? `Outliers: ${stats.outliers.length} (${stats.outliers.slice(0, 4).join(', ')}${stats.outliers.length > 4 ? '...' : ''})` : 'Outliers: 0'
            ];
          }
        } : (isBubble ? {
          label: (ctx) => {
            const raw = ctx.raw || {};
            const cat = ctx.dataset.label || '';
            return `${cat ? cat + ': ' : ''}(${chartConfig.x}: ${raw.x}, ${chartConfig.y}: ${raw.y}, Size: ${raw.z !== undefined ? raw.z : raw.r})`;
          }
        } : {})
      }
    },
    scales: isPieOrDoughnut ? {} : {
      x: {
        stacked: chartConfig.stacked || false,
        grid: { display: false }, // No vertical gridlines
        border: { display: false }, // No canvas borders
        ticks: {
          font: { family: "'IBM Plex Sans', sans-serif", size: 10.5 },
          color: darkMode ? '#82817A' : '#73726E',
          maxRotation: isHorizontal ? 0 : 45,
          autoSkip: true,
          maxTicksLimit: 15
        }
      },
      y: {
        stacked: chartConfig.stacked || false,
        beginAtZero: chartConfig.type !== 'scatter' && chartConfig.type !== 'boxplot',
        grid: { color: darkMode ? '#242421' : '#EFEFEA' }, // Light horizontal gridlines only
        border: { display: false }, // No canvas borders
        ticks: {
          font: { family: "'IBM Plex Mono', monospace", size: 10.5 },
          color: darkMode ? '#82817A' : '#73726E',
          maxTicksLimit: 7
        }
      }
    }
  };

  const chartInstance = new Chart(canvas, {
    type: chartType,
    data: {
      labels: chartData.labels,
      datasets
    },
    options: chartOptions,
    plugins: isBoxPlot ? [boxPlotPlugin] : []
  });

  chartRegistry.set(chartId, chartInstance);
  return chartInstance;
}

/**
 * Returns a PNG data URL for a given chart ID.
 * @param {string} chartId
 * @returns {string|null}
 */
export function getChartPngDataUrl(chartId) {
  const chart = chartRegistry.get(chartId);
  if (!chart || !chart.canvas) return null;
  return chart.toBase64Image('image/png', 1.0);
}

/**
 * Downloads a rendered chart canvas as a PNG file.
 * @param {string} chartId
 * @param {string} [filename='chart.png']
 * @returns {boolean}
 */
export function exportChartToPng(chartId, filename = 'chart.png') {
  const dataUrl = getChartPngDataUrl(chartId);
  if (!dataUrl) {
    console.error(`Unable to retrieve canvas image for chart: ${chartId}`);
    return false;
  }

  if (typeof window === 'undefined' || !window.document) return false;
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return true;
}

/**
 * Renders an accessible HTML table representation for a chart's data.
 * @param {{ labels: string[], datasets: any[] }} chartData
 * @param {object} chartConfig
 * @returns {string} HTML table string
 */
export function buildChartTableHtml(chartData, chartConfig) {
  if (chartConfig.type === 'boxplot') {
    const statsList = chartData.datasets[0]?._boxPlotStats || [];
    const labels = chartData.labels || [];
    const rowsHtml = labels.map((lbl, idx) => {
      const s = statsList[idx];
      if (!s) return '';
      return `
        <tr>
          <td><strong>${lbl}</strong></td>
          <td class="font-mono">${s.min}</td>
          <td class="font-mono">${s.q1}</td>
          <td class="font-mono fw-bold">${s.median}</td>
          <td class="font-mono">${s.mean}</td>
          <td class="font-mono">${s.q3}</td>
          <td class="font-mono">${s.max}</td>
          <td class="font-mono">${s.iqr}</td>
          <td class="font-mono ${s.outliers.length > 0 ? 'text-danger fw-bold' : 'text-muted'}">${s.outliers.length}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="table-responsive" style="max-height: 280px;">
        <table class="table table-sm table-striped table-hover mb-0">
          <thead class="table-light sticky-top">
            <tr>
              <th>Category</th>
              <th>Min</th>
              <th>Q1 (25%)</th>
              <th>Median (50%)</th>
              <th>Mean</th>
              <th>Q3 (75%)</th>
              <th>Max</th>
              <th>IQR</th>
              <th>Outliers</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="9" class="text-center text-muted">No data</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }

  if (chartConfig.type === 'bubble') {
    const datasets = chartData.datasets || [];
    let rowsHtml = '';
    let count = 0;
    for (const ds of datasets) {
      for (const pt of ds.data || []) {
        count++;
        if (count <= 100) {
          rowsHtml += `
            <tr>
              <td>${count}</td>
              <td>${ds.label || 'Default'}</td>
              <td class="font-mono">${typeof pt.x === 'number' ? pt.x.toFixed(2) : pt.x}</td>
              <td class="font-mono">${typeof pt.y === 'number' ? pt.y.toFixed(2) : pt.y}</td>
              <td class="font-mono">${pt.z !== undefined ? pt.z : pt.r}</td>
            </tr>
          `;
        }
      }
    }

    return `
      <div class="table-responsive" style="max-height: 280px;">
        <table class="table table-sm table-striped table-hover mb-0">
          <thead class="table-light sticky-top">
            <tr>
              <th>#</th>
              <th>Series</th>
              <th>${chartConfig.x}</th>
              <th>${chartConfig.y}</th>
              <th>Size (${chartConfig.z || 'Radius'})</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="5" class="text-center text-muted">No bubble points</td></tr>'}
          </tbody>
        </table>
        ${count > 100 ? `<div class="p-2 text-muted small text-center">Showing first 100 of ${count} points</div>` : ''}
      </div>
    `;
  }

  if (chartConfig.type === 'heatmap') {
    const xLabels = chartData.labels || [];
    const yLabels = chartData.yLabels || [];
    const matrix = chartData.matrix || [];

    const thCols = ['Y \\ X', ...xLabels].map(c => `<th>${c}</th>`).join('');
    const rowsHtml = yLabels.map((yLbl, rIdx) => {
      const rowCells = xLabels.map((_, cIdx) => {
        const val = matrix[rIdx]?.[cIdx];
        return `<td class="font-mono">${val !== undefined && val !== null ? val : '-'}</td>`;
      }).join('');
      return `<tr><td><strong>${yLbl}</strong></td>${rowCells}</tr>`;
    }).join('');

    return `
      <div class="table-responsive" style="max-height: 280px;">
        <table class="table table-sm table-striped table-hover mb-0">
          <thead class="table-light sticky-top">
            <tr>${thCols}</tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="2" class="text-center text-muted">No matrix data</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }

  const isScatter = chartConfig.type === 'scatter';
  if (isScatter) {
    const points = chartData.datasets[0]?.data || [];
    const rowsHtml = points.slice(0, 100).map((pt, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${typeof pt.x === 'number' ? pt.x.toFixed(2) : pt.x}</td>
        <td>${typeof pt.y === 'number' ? pt.y.toFixed(2) : pt.y}</td>
      </tr>
    `).join('');

    return `
      <div class="table-responsive" style="max-height: 280px;">
        <table class="table table-sm table-striped table-hover mb-0">
          <thead class="table-light sticky-top">
            <tr>
              <th>#</th>
              <th>${chartConfig.x}</th>
              <th>${chartConfig.y}</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="3" class="text-center text-muted">No points</td></tr>'}
          </tbody>
        </table>
        ${points.length > 100 ? `<div class="p-2 text-muted small text-center">Showing first 100 of ${points.length} points</div>` : ''}
      </div>
    `;
  }

  const labels = chartData.labels || [];
  const datasets = chartData.datasets || [];

  const headerCols = ['Category / Interval', ...datasets.map(d => d.label || 'Value')];
  const thHtml = headerCols.map(c => `<th>${c}</th>`).join('');

  const rowsHtml = labels.map((lbl, idx) => {
    const valuesHtml = datasets.map(d => {
      const val = d.data[idx];
      return `<td>${val !== undefined && val !== null ? val : '-'}</td>`;
    }).join('');
    return `<tr><td><strong>${lbl}</strong></td>${valuesHtml}</tr>`;
  }).join('');

  return `
    <div class="table-responsive" style="max-height: 280px;">
      <table class="table table-sm table-striped table-hover mb-0">
        <thead class="table-light sticky-top">
          <tr>${thHtml}</tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="2" class="text-center text-muted">No data</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Custom Canvas Renderer for 2D Category Heatmap.
 * Generates an executive Seaborn/D3 quality color-interpolated density grid with interactive tooltips.
 * @param {HTMLCanvasElement} canvas
 * @param {object} chartConfig
 * @param {object} chartData
 * @param {object} [options={}]
 * @returns {object} Controller with destroy() and toBase64Image()
 */
function renderCanvasHeatmap(canvas, chartConfig, chartData, options = {}) {
  const chartId = chartConfig.id;
  destroyChart(chartId);

  const darkMode = isDarkMode();
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const dpr = window.devicePixelRatio || 1;
  const xLabels = chartData.labels || [];
  const yLabels = chartData.yLabels || [];
  const matrix = chartData.matrix || [];
  const minVal = chartData.minVal ?? 0;
  const maxVal = chartData.maxVal ?? 1;

  let width = 520;
  let height = 280;
  let hoveredCell = null;
  let leftMargin = 100;
  let topMargin = 68;
  let bottomMargin = 32;
  let rightMargin = 20;

  function draw() {
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const numCols = Math.max(1, xLabels.length);
    const numRows = Math.max(1, yLabels.length);

    // Compute dynamic margins
    const needsRotate = numCols > 4 || xLabels.some(l => (l || '').length > 7);
    topMargin = needsRotate ? 74 : 36;
    const maxCharsY = Math.max(0, ...yLabels.map(l => (l || '').length));
    leftMargin = Math.min(135, Math.max(85, maxCharsY * 6.5 + 18));
    bottomMargin = 28;
    rightMargin = 18;

    const plotWidth = Math.max(20, width - leftMargin - rightMargin);
    const plotHeight = Math.max(20, height - topMargin - bottomMargin);

    const cellWidth = plotWidth / numCols;
    const cellHeight = plotHeight / numRows;

    // Draw Column Headers (X labels)
    ctx.font = "500 10.5px 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = darkMode ? '#B5B4AE' : '#666560';

    for (let c = 0; c < numCols; c++) {
      const xCenter = leftMargin + c * cellWidth + cellWidth / 2;
      const label = xLabels[c] || '';

      if (needsRotate) {
        ctx.save();
        ctx.translate(xCenter, topMargin - 8);
        ctx.rotate(-Math.PI / 4.3); // ~42° rotation
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const maxLen = Math.floor(topMargin / 5.2);
        const truncated = label.length > maxLen ? label.slice(0, maxLen - 1) + '…' : label;
        ctx.fillText(truncated, 0, 0);
        ctx.restore();
      } else {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, xCenter, topMargin - 6);
      }
    }

    // Draw Row Headers (Y labels)
    ctx.font = "500 10.5px 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = darkMode ? '#B5B4AE' : '#666560';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let r = 0; r < numRows; r++) {
      const yCenter = topMargin + r * cellHeight + cellHeight / 2;
      const label = yLabels[r] || '';
      const maxAllowed = Math.floor((leftMargin - 16) / 6.5);
      const truncated = label.length > maxAllowed ? label.slice(0, maxAllowed - 1) + '…' : label;
      ctx.fillText(truncated, leftMargin - 10, yCenter);
    }

    // Draw Cells
    const span = maxVal - minVal || 1;

    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const val = matrix[r]?.[c] ?? 0;
        const isHovered = hoveredCell && hoveredCell.r === r && hoveredCell.c === c;

        const cellX = leftMargin + c * cellWidth + 1.5;
        const cellY = topMargin + r * cellHeight + 1.5;
        const w = Math.max(1, cellWidth - 3);
        const h = Math.max(1, cellHeight - 3);

        if (val === 0) {
          ctx.fillStyle = darkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)';
        } else {
          const norm = Math.max(0, Math.min(1, (val - minVal) / span));
          const alpha = (0.16 + norm * 0.78).toFixed(2);
          ctx.fillStyle = darkMode
            ? `rgba(69, 123, 255, ${alpha})`
            : `rgba(31, 79, 216, ${alpha})`;
        }

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(cellX, cellY, w, h, 3);
        } else {
          ctx.rect(cellX, cellY, w, h);
        }
        ctx.fill();

        if (isHovered) {
          ctx.strokeStyle = darkMode ? '#FFFFFF' : '#141413';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Cell Text Value
        if (w > 26 && h > 14) {
          ctx.font = "600 10px 'IBM Plex Mono', monospace";
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          if (val === 0) {
            ctx.fillStyle = darkMode ? '#555450' : '#A09E97';
            ctx.fillText('—', cellX + w / 2, cellY + h / 2);
          } else {
            const norm = (val - minVal) / span;
            ctx.fillStyle = norm > 0.42 ? '#FFFFFF' : (darkMode ? '#EDEDEB' : '#141413');

            let formattedVal = val.toLocaleString();
            if (Math.abs(val) >= 1000000) formattedVal = (val / 1000000).toFixed(1) + 'M';
            else if (Math.abs(val) >= 1000) formattedVal = (val / 1000).toFixed(1) + 'k';
            ctx.fillText(formattedVal, cellX + w / 2, cellY + h / 2);
          }
        }
      }
    }

    // Draw Bottom Color Legend Bar
    const legendW = 110;
    const legendH = 6;
    const legendX = leftMargin + (plotWidth - legendW) / 2;
    const legendY = height - 16;

    const grad = ctx.createLinearGradient(legendX, 0, legendX + legendW, 0);
    grad.addColorStop(0, darkMode ? 'rgba(69, 123, 255, 0.15)' : 'rgba(31, 79, 216, 0.15)');
    grad.addColorStop(1, darkMode ? 'rgba(69, 123, 255, 0.95)' : 'rgba(31, 79, 216, 0.95)');
    ctx.fillStyle = grad;
    ctx.fillRect(legendX, legendY, legendW, legendH);

    ctx.font = "400 9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = darkMode ? '#9E9D95' : '#73726E';
    ctx.textAlign = 'right';
    ctx.fillText(minVal >= 1000 ? (minVal / 1000).toFixed(1) + 'k' : minVal.toString(), legendX - 6, legendY + 5);
    ctx.textAlign = 'left';
    ctx.fillText(maxVal >= 1000 ? (maxVal / 1000).toFixed(1) + 'k' : maxVal.toString(), legendX + legendW + 6, legendY + 5);

    ctx.restore();
  }

  function updateDimensions() {
    const parent = canvas.parentElement;
    const parentRect = parent ? parent.getBoundingClientRect() : canvas.getBoundingClientRect();
    width = parentRect.width > 0 ? parentRect.width : 520;
    height = parentRect.height > 0 ? parentRect.height : 280;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    draw();
  }

  function onMouseMove(e) {
    const clientRect = canvas.getBoundingClientRect();
    const mx = e.clientX - clientRect.left;
    const my = e.clientY - clientRect.top;

    const plotWidth = Math.max(20, width - leftMargin - rightMargin);
    const plotHeight = Math.max(20, height - topMargin - bottomMargin);

    const cellW = plotWidth / (xLabels.length || 1);
    const cellH = plotHeight / (yLabels.length || 1);

    if (mx >= leftMargin && mx <= width - rightMargin && my >= topMargin && my <= height - bottomMargin) {
      const c = Math.floor((mx - leftMargin) / cellW);
      const r = Math.floor((my - topMargin) / cellH);
      if (r >= 0 && r < yLabels.length && c >= 0 && c < xLabels.length) {
        if (!hoveredCell || hoveredCell.r !== r || hoveredCell.c !== c) {
          hoveredCell = { r, c };
          canvas.style.cursor = 'pointer';
          const val = matrix[r]?.[c] ?? 0;
          canvas.title = `${xLabels[c]} × ${yLabels[r]}: ${val.toLocaleString()}`;
          draw();
        }
        return;
      }
    }
    if (hoveredCell !== null) {
      hoveredCell = null;
      canvas.style.cursor = 'default';
      canvas.title = '';
      draw();
    }
  }

  function onMouseLeave() {
    if (hoveredCell !== null) {
      hoveredCell = null;
      canvas.style.cursor = 'default';
      canvas.title = '';
      draw();
    }
  }

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onMouseLeave);

  let resizeObserver = null;
  if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
    resizeObserver = new ResizeObserver(() => {
      updateDimensions();
    });
    resizeObserver.observe(canvas.parentElement);
  }

  updateDimensions();

  const controller = {
    canvas,
    destroy() {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      if (resizeObserver) resizeObserver.disconnect();
      chartRegistry.delete(chartId);
    },
    toBase64Image() {
      return canvas.toDataURL('image/png');
    }
  };

  chartRegistry.set(chartId, controller);
  return controller;
}
