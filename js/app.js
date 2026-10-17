/**
 * CSV Insight - Application Coordinator & Single Source of Truth Store
 * Orchestrates parsing, profiling, recommendations, table exploration, cleaning, and export.
 */

import { parseCsvContent, validateFileMetadata } from './csvParser.js';
import { profileDataset, coerceRowTypes } from './dataAnalyzer.js';
import { recommendCharts, buildChartData } from './chartRecommender.js';
import { renderChart, destroyAllCharts, getChartThemeKey, setChartThemeKey, CHART_THEMES } from './chartRenderer.js';
import { renderSummaryCards, renderQualityWarnings, renderChartCard, validateChartSuitability, renderChartSkeletons } from './dashboard.js';
import { applyFilters, sortRows, renderTableBody } from './tableManager.js';
import { applyOperations, previewCleaningOperation } from './dataCleaner.js';
import { exportToCsv, exportPdfReport } from './exportManager.js';
import { debounce } from './utils.js';
import { setupColStatsSidebar, openColumnStats } from './colStatsSidebar.js';
import { renderCorrelationCard, openScatterModal } from './correlationMatrix.js';
import { renderSmartInsightsCard, generateSmartInsights } from './smartInsights.js';

/**
 * Global App State
 */
export const state = {
  fileName: '',
  fileSize: 0,
  originalData: null, // { headers, rows, meta, malformedRows }
  cleaningOps: [],     // Array<CleaningOp> (undo stack)
  cleanedData: null,  // { headers, rows }
  profile: null,      // Dataset profile from cleanedData
  recommendations: [],// Array<ChartRecommendation>
  renderedCharts: [], // Active chart configs
  filters: {
    globalSearch: '',
    columnFilters: {}
  },
  viewData: [],       // Filtered rows for rendering
  tableState: {
    sortCol: '',
    sortDir: 'asc',
    pageSize: 25,
    currentPage: 1
  },
  abortController: null
};

// Immediate early theme application to prevent flash of wrong theme
if (typeof document !== 'undefined') {
  try {
    const savedTheme = localStorage.getItem('csv_insight_theme') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', savedTheme);
  } catch (e) {
    // ignore
  }
}

/**
 * Initializes Application Event Listeners & Router
 */
export function initApp() {
  setupThemeToggle();
  setupSidebarInteractions();
  setupChartThemeSelector();
  setupNavigation();
  setupUploadDropzone();
  setupDemoHandlers();
  setupTableEventListeners();
  setupCleaningEventListeners();
  setupExportEventListeners();
  setupAddChartModal();
  setupCommandPalette();
  setupColStatsSidebar(() => state);

  // Jump to correlation matrix button in dashboard header
  const jumpCorrBtn = document.getElementById('toggleCorrelationSectionBtn');
  if (jumpCorrBtn) {
    jumpCorrBtn.addEventListener('click', () => {
      const mount = document.getElementById('dashboardCorrelationMount');
      if (mount) {
        mount.scrollIntoView({ behavior: 'smooth' });
        mount.classList.add('shadow-lg');
        setTimeout(() => mount.classList.remove('shadow-lg'), 1200);
      }
    });
  }

  // Jump to Executive Smart Insights button in dashboard header
  const jumpSmartBtn = document.getElementById('toggleSmartInsightsBtn');
  if (jumpSmartBtn) {
    jumpSmartBtn.addEventListener('click', () => {
      const mount = document.getElementById('dashboardSmartInsightsMount');
      if (mount) {
        mount.scrollIntoView({ behavior: 'smooth' });
        mount.classList.add('shadow-lg');
        setTimeout(() => mount.classList.remove('shadow-lg'), 1200);
      }
    });
  }

  // Scroll listener for sticky bar elevation shadow
  window.addEventListener('scroll', () => {
    const stickyBar = document.getElementById('dashboardStickyBar');
    if (stickyBar) {
      if (window.scrollY > 20) {
        stickyBar.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.05)';
      } else {
        stickyBar.style.boxShadow = 'none';
      }
    }
  }, { passive: true });

  // Load route from hash or default to #welcome
  handleHashChange();
  window.addEventListener('hashchange', handleHashChange);
}

/**
 * Displays user-friendly toast notifications.
 * @param {string} message
 * @param {'success'|'error'|'info'} [type='info']
 */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-custom ${type}`;
  toast.setAttribute('role', 'alert');

  const iconClass = type === 'success' ? 'bi-check-circle-fill text-success' : (type === 'error' ? 'bi-exclamation-triangle-fill text-danger' : 'bi-info-circle-fill text-primary');
  toast.innerHTML = `
    <i class="bi ${iconClass} fs-5"></i>
    <div class="flex-grow-1">${message}</div>
    <button type="button" class="btn-close btn-close-white ms-2" aria-label="Close"></button>
  `;

  toast.querySelector('.btn-close').addEventListener('click', () => toast.remove());
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}

/**
 * Theme Management: System detection, persistence, toggle button, and charts re-render
 */
const THEME_STORAGE_KEY = 'csv_insight_theme';

export function getPreferredTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_STORAGE_KEY, theme);

  // Update navbar button icon and text
  const icon = document.getElementById('themeToggleIcon');
  const text = document.getElementById('themeToggleText');
  const btn = document.getElementById('themeToggleBtn');

  if (icon) {
    icon.className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon';
  }
  if (text) {
    text.textContent = theme === 'dark' ? 'Light' : 'Dark';
  }
  if (btn) {
    btn.setAttribute('title', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }

  // Update mobile toggle if present
  const mobileBtn = document.getElementById('mobileThemeToggleBtn');
  if (mobileBtn) {
    mobileBtn.innerHTML = theme === 'dark' ? '<i class="bi bi-sun"></i> Light theme' : '<i class="bi bi-moon"></i> Dark theme';
  }

  // Re-render active charts and correlation heatmap if dashboard view is active so theme updates dynamically
  const chartsGrid = document.getElementById('chartsGrid');
  if (chartsGrid && !chartsGrid.closest('.d-none') && state.renderedCharts && state.renderedCharts.length > 0) {
    renderDashboardCharts();
  }
  const corrMount = document.getElementById('dashboardCorrelationMount');
  if (corrMount && !corrMount.closest('.d-none') && state.cleanedData) {
    renderDashboardCorrelation();
  }
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  showToast(`Switched to ${next} theme`, 'info');
}

export function setupThemeToggle() {
  const initialTheme = getPreferredTheme();
  applyTheme(initialTheme);

  const toggleBtn = document.getElementById('themeToggleBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleTheme);
  }

  const mobileToggleBtn = document.getElementById('mobileThemeToggleBtn');
  if (mobileToggleBtn) {
    mobileToggleBtn.addEventListener('click', toggleTheme);
  }

  // Listen for system theme changes if user hasn't explicitly set preference
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem(THEME_STORAGE_KEY)) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }
}

/**
 * Sidebar Navigation Collapsing & Draggable Resizing
 */
export function setupSidebarInteractions() {
  const sidebar = document.getElementById('appSidebar');
  const collapseBtn = document.getElementById('sidebarCollapseBtn');
  const collapseIcon = document.getElementById('sidebarCollapseIcon');
  const topToggleBtn = document.getElementById('topSidebarToggleBtn');
  const topToggleIcon = document.getElementById('topSidebarToggleIcon');
  const resizer = document.getElementById('sidebarResizer');
  if (!sidebar) return;

  const updateUI = (collapsed) => {
    if (collapseIcon) {
      collapseIcon.className = collapsed ? 'bi bi-chevron-right' : 'bi bi-chevron-left';
    }
    if (collapseBtn) {
      collapseBtn.setAttribute('title', collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)');
      collapseBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    }
    if (topToggleBtn) {
      topToggleBtn.classList.toggle('active', collapsed);
      topToggleBtn.setAttribute('title', collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)');
    }
    if (topToggleIcon) {
      topToggleIcon.className = collapsed ? 'bi bi-layout-sidebar' : 'bi bi-layout-sidebar-inset';
    }
  };

  // Restore saved collapse state or width
  const isCollapsed = localStorage.getItem('csv_sidebar_collapsed') === 'true';
  const savedWidth = localStorage.getItem('csv_sidebar_width');
  if (isCollapsed) {
    sidebar.classList.add('collapsed');
    updateUI(true);
  } else {
    updateUI(false);
    if (savedWidth) {
      sidebar.style.width = `${Math.min(380, Math.max(160, parseInt(savedWidth, 10)))}px`;
    }
  }

  // Toggle Collapse
  const toggleCollapse = () => {
    const collapsed = sidebar.classList.toggle('collapsed');
    localStorage.setItem('csv_sidebar_collapsed', collapsed ? 'true' : 'false');
    updateUI(collapsed);
    if (!collapsed && savedWidth) {
      sidebar.style.width = `${savedWidth}px`;
    } else if (collapsed) {
      sidebar.style.width = '';
    }
    // Reflow charts & responsive elements after animation completes
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 240);
  };

  if (collapseBtn) collapseBtn.addEventListener('click', toggleCollapse);
  if (topToggleBtn) topToggleBtn.addEventListener('click', toggleCollapse);

  // Keyboard shortcut: Ctrl+B / ⌘B to toggle sidebar
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      toggleCollapse();
    }
  });

  // Draggable splitter resizing
  if (resizer) {
    let isDragging = false;
    resizer.addEventListener('mousedown', (e) => {
      if (sidebar.classList.contains('collapsed')) return;
      isDragging = true;
      resizer.classList.add('is-dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const newWidth = Math.min(420, Math.max(160, e.clientX));
      sidebar.style.width = `${newWidth}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        resizer.classList.remove('is-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        const currentWidth = parseInt(sidebar.style.width, 10);
        if (currentWidth) {
          localStorage.setItem('csv_sidebar_width', currentWidth);
        }
      }
    });
  }
}

/**
 * Chart Color Theme Selector Dropdown
 */
export function setupChartThemeSelector() {
  const currentKey = getChartThemeKey();
  const theme = CHART_THEMES[currentKey] || CHART_THEMES.default;
  const labelEl = document.getElementById('activeThemeLabel');
  const swatchEl = document.getElementById('activeThemeSwatchDot');
  if (labelEl) labelEl.textContent = theme.label;
  if (swatchEl) swatchEl.style.backgroundColor = theme.badgeColor;

  const menu = document.getElementById('chartThemeMenu');
  if (!menu) return;

  const updateDropdownActive = (activeKey) => {
    menu.querySelectorAll('.dropdown-item').forEach(btn => {
      if (btn.getAttribute('data-theme-key') === activeKey) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  };
  updateDropdownActive(currentKey);

  menu.querySelectorAll('.dropdown-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const themeKey = btn.getAttribute('data-theme-key');
      if (themeKey && setChartThemeKey(themeKey)) {
        const selectedTheme = CHART_THEMES[themeKey];
        if (labelEl) labelEl.textContent = selectedTheme.label;
        if (swatchEl) swatchEl.style.backgroundColor = selectedTheme.badgeColor;
        updateDropdownActive(themeKey);

        // Re-render dashboard charts with new theme
        if (state.renderedCharts && state.renderedCharts.length > 0) {
          renderDashboardCharts();
        }
        showToast(`Chart color theme set to ${selectedTheme.label}`, 'info');
      }
    });
  });
}


/**
 * Hash-based Router
 */
function setupNavigation() {
  const navLinks = document.querySelectorAll('.nav-link-custom');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const targetHash = link.getAttribute('href');
      if (targetHash.startsWith('#') && targetHash !== '#welcome' && !state.originalData) {
        e.preventDefault();
        showToast('Please upload a CSV or load demo data first.', 'info');
      }
    });
  });
}

function handleHashChange() {
  const hash = window.location.hash || '#welcome';
  const views = ['welcome', 'dashboard', 'data', 'clean', 'export'];

  let activeView = hash.replace('#', '');
  if (!views.includes(activeView)) activeView = 'welcome';

  if (!state.originalData && activeView !== 'welcome') {
    window.location.hash = '#welcome';
    return;
  }

  // Update navigation link highlights
  document.querySelectorAll('.nav-link-custom').forEach(link => {
    const linkHash = link.getAttribute('href');
    if (linkHash === `#${activeView}`) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Toggle View sections
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) {
      if (v === activeView) {
        el.classList.remove('d-none');
      } else {
        el.classList.add('d-none');
      }
    }
  });

  // Re-render view-specific components
  if (activeView === 'data') {
    renderTable();
  } else if (activeView === 'clean') {
    renderCleaningView();
  } else if (activeView === 'dashboard') {
    renderDashboardCharts();
  }
}

/**
 * File Dropzone and Upload Handlers
 */
function setupUploadDropzone() {
  const dropzone = document.getElementById('uploadDropzone');
  const fileInput = document.getElementById('csvFileInput');
  const progressWrapper = document.getElementById('uploadProgressWrapper');
  const progressBar = document.getElementById('uploadProgressBar');
  const cancelBtn = document.getElementById('cancelUploadBtn');

  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFileUpload(fileInput.files[0]);
    }
  });

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (state.abortController) {
        state.abortController.abort();
        state.abortController = null;
        showToast('File upload cancelled.', 'info');
        if (progressWrapper) progressWrapper.classList.add('d-none');
      }
    });
  }
}

/**
 * Processes File Upload
 * @param {File} file
 */
export async function handleFileUpload(file) {
  const validation = validateFileMetadata(file);
  if (!validation.valid) {
    showToast(validation.error || 'Invalid file.', 'error');
    return;
  }

  if (validation.warning) {
    showToast(validation.warning, 'info');
  }

  state.fileName = file.name;
  state.fileSize = file.size;

  const progressWrapper = document.getElementById('uploadProgressWrapper');
  const progressBar = document.getElementById('uploadProgressBar');
  if (progressWrapper) progressWrapper.classList.remove('d-none');
  if (progressBar) progressBar.style.width = '25%';

  state.abortController = new AbortController();

  try {
    const parsed = await parseCsvContent(file, {
      signal: state.abortController.signal,
      onProgress: (p) => {
        if (progressBar) progressBar.style.width = `${Math.min(90, Math.round(p))}%`;
      }
    });

    if (progressBar) progressBar.style.width = '100%';
    setTimeout(() => {
      if (progressWrapper) progressWrapper.classList.add('d-none');
    }, 400);

    loadDatasetIntoState(parsed, file.name);
  } catch (err) {
    if (progressWrapper) progressWrapper.classList.add('d-none');
    showToast(`Parsing failed: ${err.message}`, 'error');
  } finally {
    state.abortController = null;
  }
}

/**
 * Demo and Sample dataset handlers
 */
function setupDemoHandlers() {
  const loadDemoBtn = document.getElementById('loadDemoBtn');
  const loadDemoTopBtn = document.getElementById('loadDemoTopBtn');
  const downloadSampleBtn = document.getElementById('downloadSampleBtn');
  const loadMessyBtn = document.getElementById('loadMessyBtn');

  const loadDemo = async () => {
    try {
      showToast('Loading sample sales data...', 'info');
      const grid = document.getElementById('chartsGrid');
      if (grid) renderChartSkeletons(grid, 4);
      const res = await fetch('data/sample-sales.csv');
      const csvText = await res.text();
      const parsed = await parseCsvContent(csvText);
      loadDatasetIntoState(parsed, 'sample-sales.csv');
      showToast('Sample dataset loaded successfully!', 'success');
    } catch (e) {
      showToast(`Failed to load demo: ${e.message}`, 'error');
    }
  };

  if (loadDemoBtn) loadDemoBtn.addEventListener('click', loadDemo);
  if (loadDemoTopBtn) loadDemoTopBtn.addEventListener('click', loadDemo);

  if (loadMessyBtn) {
    loadMessyBtn.addEventListener('click', async () => {
      try {
        const grid = document.getElementById('chartsGrid');
        if (grid) renderChartSkeletons(grid, 4);
        const res = await fetch('data/messy-sample.csv');
        const csvText = await res.text();
        const parsed = await parseCsvContent(csvText);
        loadDatasetIntoState(parsed, 'messy-sample.csv');
        showToast('Messy sample dataset loaded!', 'success');
      } catch (e) {
        showToast(`Failed to load messy demo: ${e.message}`, 'error');
      }
    });
  }

  if (downloadSampleBtn) {
    downloadSampleBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('data/sample-sales.csv');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'sample-sales.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        showToast('Could not download sample file.', 'error');
      }
    });
  }
}

/**
 * Loads parsed dataset into store and computes profiling & recommendations.
 * @param {object} parsedResult
 * @param {string} datasetName
 */
export function loadDatasetIntoState(parsedResult, datasetName) {
  // 1. Immutable original data
  state.fileName = datasetName || 'dataset.csv';
  state.originalData = parsedResult;
  state.cleaningOps = [];

  // Initial profiling to detect column types
  state.profile = profileDataset(parsedResult.headers, parsedResult.rows);

  // Coerce row types based on inferred types
  const typedRows = coerceRowTypes(parsedResult.rows, parsedResult.headers);
  state.cleanedData = {
    headers: parsedResult.headers,
    rows: typedRows
  };

  // Re-run profiling with typed data
  state.profile = profileDataset(state.cleanedData.headers, state.cleanedData.rows);

  // Recommendations computed from cleanedData (stable across filtering)
  state.recommendations = recommendCharts(state.cleanedData.headers, state.profile.columnProfiles, state.cleanedData.rows);
  state.renderedCharts = state.recommendations.slice(0, 6);

  // Reset filters and viewData
  state.filters = { globalSearch: '', columnFilters: {} };
  state.viewData = [...state.cleanedData.rows];

  updateGlobalUIHeader();
  renderDashboard();
  renderTableFilters();

  window.location.hash = '#dashboard';
}

/**
 * Updates dataset name and row badges in top navbar.
 */
function updateGlobalUIHeader() {
  const titleEl = document.getElementById('navbarDatasetName');
  const countEl = document.getElementById('navbarDatasetRows');
  if (titleEl) titleEl.textContent = state.fileName;
  if (countEl) countEl.textContent = `${state.viewData.length.toLocaleString()} rows`;
}

/**
 * Dashboard Rendering
 */
export function renderDashboard() {
  if (!state.profile) return;

  const kpiContainer = document.getElementById('dashboardKpis');
  const warningsContainer = document.getElementById('dashboardWarnings');

  renderSummaryCards(kpiContainer, state.profile);
  renderDashboardSmartInsights();
  renderQualityWarnings(warningsContainer, state.profile.qualityWarnings);
  renderDashboardCorrelation();
  renderDashboardCharts();
}

/**
 * Renders the Executive Smart Insights & Storytelling Banner
 */
export function renderDashboardSmartInsights() {
  const mount = document.getElementById('dashboardSmartInsightsMount');
  if (!mount || !state.cleanedData) return;

  // Build columnTypes map { [key]: 'numeric'|'date'|'categorical'|... }
  const columnTypes = {};
  if (state.profile && state.profile.columnProfiles) {
    for (const [key, profile] of state.profile.columnProfiles.entries()) {
      columnTypes[key] = profile.type;
    }
  }

  renderSmartInsightsCard(mount, {
    rows: state.viewData,
    headers: state.cleanedData.headers,
    columnTypes,
    onCopyFeedback: msg => showToast(msg, 'success')
  });
}

/**
 * Renders the interactive Pearson Correlation Matrix Heatmap
 */
export function renderDashboardCorrelation() {
  const mount = document.getElementById('dashboardCorrelationMount');
  if (!mount || !state.cleanedData) return;

  renderCorrelationCard(mount, {
    headers: state.cleanedData.headers,
    rows: state.viewData,
    onInspectScatter: (colX, colY, r) => {
      openScatterModal({
        colX,
        colY,
        r,
        rows: state.viewData,
        onPinChart: (cx, cy, rVal) => {
          const newConfig = {
            id: `scatter_corr_${Date.now()}`,
            type: 'scatter',
            title: `${cy.label} vs ${cx.label}`,
            x: cx.key,
            y: cy.key,
            aggregation: 'none',
            pearsonR: rVal,
            score: 95,
            reason: `Pinned from Pearson Correlation Heatmap (r = ${rVal > 0 ? '+' : ''}${typeof rVal === 'number' ? rVal.toFixed(3) : rVal}).`
          };
          state.renderedCharts.unshift(newConfig);
          renderDashboardCharts();
          showToast(`Pinned "${newConfig.title}" to Dashboard!`, 'success');

          // Smooth scroll to charts grid
          setTimeout(() => {
            document.getElementById('chartsGrid')?.scrollIntoView({ behavior: 'smooth' });
          }, 150);
        }
      });
    }
  });
}

/**
 * Renders or updates chart cards in the dashboard grid.
 */
export function renderDashboardCharts() {
  const gridContainer = document.getElementById('chartsGrid');
  if (!gridContainer) return;

  destroyAllCharts();
  gridContainer.innerHTML = '';

  if (state.renderedCharts.length === 0) {
    gridContainer.innerHTML = `
      <div class="col-12 text-center py-5">
        <p class="text-muted small mb-3">No suitable attributes qualify for automated charts.</p>
        <button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById('addCustomChartBtn').click()">Add custom chart</button>
      </div>
    `;
    return;
  }

  state.renderedCharts.forEach((chartConfig, idx) => {
    renderChartCard(gridContainer, chartConfig, state.viewData, state.cleanedData.headers, {
      onUpdate: (id, newCfg) => {
        const i = state.renderedCharts.findIndex(c => c.id === id);
        if (i !== -1) state.renderedCharts[i] = newCfg;
      },
      onDelete: (id) => {
        state.renderedCharts = state.renderedCharts.filter(c => c.id !== id);
      },
      onReset: (id) => {
        const orig = state.recommendations.find(c => c.id === id);
        if (orig) {
          const i = state.renderedCharts.findIndex(c => c.id === id);
          if (i !== -1) {
            state.renderedCharts[i] = { ...orig };
            renderDashboardCharts();
          }
        }
      },
      onFilterByElement: (colKey, labelVal) => {
        if (!state.filters.columnFilters[colKey]) {
          state.filters.columnFilters[colKey] = { type: 'text' };
        }
        state.filters.columnFilters[colKey].text = labelVal;
        applyActiveFilters();
        showToast(`Filtered: ${labelVal}`, 'info');
      },
      onViewColStats: (colKey) => {
        openColumnStats(colKey);
      },
      onMove: (id, direction) => {
        const i = state.renderedCharts.findIndex(c => c.id === id);
        if (i === -1) return;
        if (direction === 'up' && i > 0) {
          const temp = state.renderedCharts[i];
          state.renderedCharts[i] = state.renderedCharts[i - 1];
          state.renderedCharts[i - 1] = temp;
          renderDashboardCharts();
          showToast('Moved chart up in dashboard', 'info');
        } else if (direction === 'down' && i < state.renderedCharts.length - 1) {
          const temp = state.renderedCharts[i];
          state.renderedCharts[i] = state.renderedCharts[i + 1];
          state.renderedCharts[i + 1] = temp;
          renderDashboardCharts();
          showToast('Moved chart down in dashboard', 'info');
        }
      },
      onToggleWidth: (id, isFull) => {
        const i = state.renderedCharts.findIndex(c => c.id === id);
        if (i !== -1) {
          state.renderedCharts[i].fullWidth = isFull;
          renderDashboardCharts();
          showToast(isFull ? 'Expanded card to full width' : 'Restored standard card width', 'info');
        }
      }
    }, idx);
  });

  // Setup "Show More Recommendations" button
  const moreBtn = document.getElementById('showMoreRecsBtn');
  if (moreBtn) {
    if (state.recommendations.length > 6 && state.renderedCharts.length <= 6) {
      moreBtn.classList.remove('d-none');
      moreBtn.textContent = `Show More Recommendations (${state.recommendations.length - 6} more)`;
      moreBtn.onclick = () => {
        state.renderedCharts = [...state.recommendations];
        renderDashboardCharts();
      };
    } else if (state.renderedCharts.length > 6) {
      moreBtn.classList.remove('d-none');
      moreBtn.textContent = 'Show Top 6 Only';
      moreBtn.onclick = () => {
        state.renderedCharts = state.recommendations.slice(0, 6);
        renderDashboardCharts();
      };
    } else {
      moreBtn.classList.add('d-none');
    }
  }
}

/**
 * Exploration Table & Filters
 */
function setupTableEventListeners() {
  const searchInput = document.getElementById('tableGlobalSearch');
  const clearFiltersBtn = document.getElementById('clearFiltersBtn');
  const pageSizeSelect = document.getElementById('tablePageSize');

  if (searchInput) {
    searchInput.addEventListener('input', debounce((e) => {
      state.filters.globalSearch = e.target.value;
      applyActiveFilters();
    }, 250));
  }

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      state.filters = { globalSearch: '', columnFilters: {} };
      if (searchInput) searchInput.value = '';
      document.querySelectorAll('.col-filter-input').forEach(inp => inp.value = '');
      applyActiveFilters();
      showToast('All filters cleared.', 'info');
    });
  }

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', (e) => {
      state.tableState.pageSize = Number(e.target.value);
      state.tableState.currentPage = 1;
      renderTable();
    });
  }

  // Keyboard shortcut: '/' or Ctrl+K to jump to search
  window.addEventListener('keydown', (e) => {
    if ((e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      if (window.location.hash !== '#data') {
        window.location.hash = '#data';
      }
      setTimeout(() => {
        searchInput?.focus();
        searchInput?.select();
      }, 50);
    }
  });
}

/**
 * Builds filter inputs for each column.
 */
function renderTableFilters() {
  const container = document.getElementById('tableColumnFilters');
  if (!container || !state.cleanedData) return;

  container.innerHTML = state.cleanedData.headers.map(h => `
    <div class="col-12 col-sm-6 col-md-4 col-lg-3 mb-2">
      <label class="form-label small fw-semibold text-truncate d-block mb-1" title="${h.label}">
        ${h.label} <span class="badge bg-light text-muted border">${h.type}</span>
      </label>
      <input type="text" class="form-control form-control-sm col-filter-input" data-col="${h.key}" placeholder="Filter ${h.label}...">
    </div>
  `).join('');

  container.querySelectorAll('.col-filter-input').forEach(input => {
    input.addEventListener('input', debounce((e) => {
      const colKey = e.target.getAttribute('data-col');
      const text = e.target.value.trim();
      if (!state.filters.columnFilters[colKey]) {
        state.filters.columnFilters[colKey] = { type: 'text' };
      }
      state.filters.columnFilters[colKey].text = text;
      applyActiveFilters();
    }, 250));
  });
}

/**
 * Applies filters and updates viewData, summary row count, table page, and charts.
 */
export function applyActiveFilters() {
  state.viewData = applyFilters(state.cleanedData.rows, state.cleanedData.headers, state.filters);
  state.tableState.currentPage = 1;

  updateGlobalUIHeader();
  renderTable();
  renderActiveFilterChips();

  // Re-aggregate and re-render dashboard charts on viewData
  const gridContainer = document.getElementById('chartsGrid');
  if (gridContainer && !gridContainer.closest('.d-none')) {
    state.renderedCharts.forEach(cfg => {
      const canvas = document.getElementById(`canvas-${cfg.id}`);
      if (canvas) {
        const updatedData = buildChartData(cfg, state.viewData, state.cleanedData.headers);
        renderChart(canvas, cfg, updatedData);
      }
    });
  }

  // Re-render correlation heatmap on filtered viewData
  renderDashboardCorrelation();

  // Re-run executive smart insights on filtered viewData
  renderDashboardSmartInsights();
}

/**
 * Renders removable active filter chips in both the dashboard and table filter bars.
 */
function renderActiveFilterChips() {
  const containers = [
    document.getElementById('dashboardActiveFilters'),
    document.getElementById('tableActiveFilters')
  ];

  const hasGlobal = state.filters.globalSearch.trim().length > 0;
  const colEntries = Object.entries(state.filters.columnFilters).filter(([, v]) => v.text && v.text.trim().length > 0);
  const hasAny = hasGlobal || colEntries.length > 0;

  containers.forEach(bar => {
    if (!bar) return;

    if (!hasAny) {
      bar.classList.add('d-none');
      bar.innerHTML = '';
      return;
    }

    bar.classList.remove('d-none');

    const chips = [];

    if (hasGlobal) {
      chips.push(`
        <span class="filter-chip">
          <span>Search: <strong>${_escChip(state.filters.globalSearch)}</strong></span>
          <button class="btn-chip-remove" data-remove-global="1" aria-label="Remove search filter">&times;</button>
        </span>
      `);
    }

    colEntries.forEach(([colKey, filterObj]) => {
      const header = state.cleanedData?.headers.find(h => h.key === colKey);
      const label = header ? header.label : colKey;
      chips.push(`
        <span class="filter-chip">
          <span>${_escChip(label)}: <strong>${_escChip(filterObj.text)}</strong></span>
          <button class="btn-chip-remove" data-remove-col="${_escChip(colKey)}" aria-label="Remove ${_escChip(label)} filter">&times;</button>
        </span>
      `);
    });

    chips.push(`<button class="btn-chip-remove ms-1" data-clear-all="1" style="font-size:0.78rem;color:var(--color-text-muted)">Clear all</button>`);

    bar.innerHTML = chips.join('');

    bar.querySelectorAll('[data-remove-global]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.filters.globalSearch = '';
        const searchInput = document.getElementById('tableGlobalSearch');
        if (searchInput) searchInput.value = '';
        applyActiveFilters();
      });
    });

    bar.querySelectorAll('[data-remove-col]').forEach(btn => {
      btn.addEventListener('click', () => {
        const col = btn.getAttribute('data-remove-col');
        delete state.filters.columnFilters[col];
        const inp = document.querySelector(`.col-filter-input[data-col="${col}"]`);
        if (inp) inp.value = '';
        applyActiveFilters();
      });
    });

    bar.querySelectorAll('[data-clear-all]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.filters = { globalSearch: '', columnFilters: {} };
        const searchInput = document.getElementById('tableGlobalSearch');
        if (searchInput) searchInput.value = '';
        document.querySelectorAll('.col-filter-input').forEach(inp => inp.value = '');
        applyActiveFilters();
      });
    });
  });
}

/** Minimal HTML escape for chip text */
function _escChip(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Renders table headers and rows.
 */
export function renderTable() {
  const thead = document.getElementById('dataTableThead');
  const tbody = document.getElementById('dataTableTbody');
  const countInfo = document.getElementById('tableRowsInfo');

  if (!thead || !tbody || !state.cleanedData) return;

  // Header row
  thead.innerHTML = `
    <tr>
      <th style="width: 45px;">#</th>
      ${state.cleanedData.headers.map(h => `
        <th class="cursor-pointer th-sortable" data-col="${h.key}" data-type="${h.type}">
          <div class="d-flex align-items-center justify-content-between gap-1">
            <div class="d-flex align-items-center gap-1 flex-grow-1">
              <span>${h.label}</span>
              <i class="bi ${state.tableState.sortCol === h.key ? (state.tableState.sortDir === 'asc' ? 'bi-sort-up text-primary' : 'bi-sort-down text-primary') : 'bi-arrow-down-up text-muted opacity-50'}"></i>
            </div>
            <button class="th-stats-btn" data-stats-col="${h.key}" title="Column statistics" aria-label="View stats for ${h.label}">
              <i class="bi bi-bar-chart-line"></i>
            </button>
          </div>
        </th>
      `).join('')}
    </tr>
  `;

  // Sort header click handlers
  thead.querySelectorAll('.th-sortable').forEach(th => {
    th.addEventListener('click', (e) => {
      if (e.target.closest('.th-stats-btn')) return;
      const col = th.getAttribute('data-col');
      const colType = th.getAttribute('data-type');
      if (state.tableState.sortCol === col) {
        state.tableState.sortDir = state.tableState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.tableState.sortCol = col;
        state.tableState.sortDir = 'asc';
      }
      state.viewData = sortRows(state.viewData, col, state.tableState.sortDir, colType);
      renderTable();
    });
  });

  // Column stats trigger click handlers
  thead.querySelectorAll('.th-stats-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const col = btn.getAttribute('data-stats-col');
      if (col) openColumnStats(col);
    });
  });

  // Pagination calculation
  const totalRows = state.viewData.length;
  const pageSize = state.tableState.pageSize;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  state.tableState.currentPage = Math.min(state.tableState.currentPage, totalPages);

  const startIdx = (state.tableState.currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalRows);
  const pageRows = state.viewData.slice(startIdx, endIdx);

  renderTableBody(tbody, pageRows, state.cleanedData.headers, startIdx);

  if (countInfo) {
    countInfo.textContent = `Showing ${totalRows === 0 ? 0 : startIdx + 1} to ${endIdx} of ${totalRows.toLocaleString()} rows (Cleaned Total: ${state.cleanedData.rows.length.toLocaleString()})`;
  }

  renderPaginationControls(totalPages);
}

/**
 * Renders pagination buttons.
 * @param {number} totalPages
 */
function renderPaginationControls(totalPages) {
  const container = document.getElementById('tablePagination');
  if (!container) return;

  const current = state.tableState.currentPage;
  container.innerHTML = `
    <li class="page-item ${current === 1 ? 'disabled' : ''}">
      <button class="page-link" id="pagePrev">Previous</button>
    </li>
    <li class="page-item disabled">
      <span class="page-link text-navy fw-semibold">Page ${current} of ${totalPages}</span>
    </li>
    <li class="page-item ${current === totalPages || totalPages === 0 ? 'disabled' : ''}">
      <button class="page-link" id="pageNext">Next</button>
    </li>
  `;

  const prevBtn = document.getElementById('pagePrev');
  const nextBtn = document.getElementById('pageNext');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (state.tableState.currentPage > 1) {
        state.tableState.currentPage--;
        renderTable();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (state.tableState.currentPage < totalPages) {
        state.tableState.currentPage++;
        renderTable();
      }
    });
  }
}

/**
 * Data Cleaning View & Undo Stack
 */
function setupCleaningEventListeners() {
  const undoBtn = document.getElementById('undoCleanOpBtn');
  const resetBtn = document.getElementById('resetCleanOpsBtn');

  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      if (state.cleaningOps.length > 0) {
        state.cleaningOps.pop();
        reapplyCleaningPipeline();
        showToast('Last operation undone.', 'info');
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (state.cleaningOps.length > 0) {
        state.cleaningOps = [];
        reapplyCleaningPipeline();
        showToast('All cleaning operations reset to original.', 'info');
      }
    });
  }

  // Hook cleaning action buttons
  document.querySelectorAll('.btn-clean-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const opType = btn.getAttribute('data-op');
      promptAndApplyCleaningOp(opType);
    });
  });
}

/**
 * Interactive preview and application of cleaning operation.
 * @param {string} opType
 */
function promptAndApplyCleaningOp(opType) {
  let op = { type: opType };

  if (opType === 'remove_duplicates') {
    op.description = 'Remove exact duplicate rows across all columns.';
  } else if (opType === 'trim_whitespace') {
    op.description = 'Trim leading and trailing whitespace across text fields.';
  } else if (opType === 'handle_blanks_drop') {
    op = { type: 'handle_blanks', mode: 'drop_rows', description: 'Drop all rows containing any blank or missing values.' };
  } else if (opType === 'handle_blanks_mean') {
    const numCol = state.cleanedData.headers.find(h => h.type === 'numeric');
    if (!numCol) {
      showToast('No numeric column found to impute mean.', 'error');
      return;
    }
    op = { type: 'handle_blanks', mode: 'fill_mean', columnKey: numCol.key, description: `Fill missing values in "${numCol.label}" with column average.` };
  } else if (opType === 'handle_blanks_median') {
    const numCol = state.cleanedData.headers.find(h => h.type === 'numeric');
    if (!numCol) {
      showToast('No numeric column found to impute median.', 'error');
      return;
    }
    op = { type: 'handle_blanks', mode: 'fill_median', columnKey: numCol.key, description: `Fill missing values in "${numCol.label}" with median.` };
  } else if (opType === 'handle_blanks_mode') {
    const catCol = state.cleanedData.headers.find(h => h.type === 'categorical');
    if (!catCol) {
      showToast('No categorical column found to impute mode.', 'error');
      return;
    }
    op = { type: 'handle_blanks', mode: 'fill_mode', columnKey: catCol.key, description: `Fill missing values in "${catCol.label}" with most frequent value (mode).` };
  } else if (opType === 'case_title') {
    op = { type: 'change_case', mode: 'title', description: 'Standardize text columns to Title Case (capitalizing each word).' };
  } else if (opType === 'case_upper') {
    op = { type: 'change_case', mode: 'upper', description: 'Convert text columns to UPPERCASE.' };
  } else if (opType === 'case_lower') {
    op = { type: 'change_case', mode: 'lower', description: 'Convert text columns to lowercase.' };
  } else if (opType === 'strip_special_chars') {
    op = { type: 'strip_special_chars', description: 'Strip symbols and special punctuation from text columns.' };
  } else if (opType === 'remove_outliers') {
    const numCol = state.cleanedData.headers.find(h => h.type === 'numeric');
    if (!numCol) {
      showToast('No numeric column found to evaluate outliers.', 'error');
      return;
    }
    op = { type: 'remove_outliers', columnKey: numCol.key, description: `Drop rows where "${numCol.label}" is beyond the 1.5 × IQR boundary.` };
  } else if (opType === 'round_numbers_2') {
    op = { type: 'round_numbers', decimals: 2, description: 'Round numeric values to 2 decimal places.' };
  } else if (opType === 'round_numbers_0') {
    op = { type: 'round_numbers', decimals: 0, description: 'Round numeric values to nearest integer (0 decimal places).' };
  } else if (opType === 'drop_empty_columns') {
    op = { type: 'drop_empty_columns', description: 'Detect and remove any column where 100% of cells are empty or missing.' };
  } else if (opType === 'standardize_dates') {
    op = { type: 'standardize_dates', description: 'Parse and standardize all date fields into ISO format (YYYY-MM-DD).' };
  }

  // Generate preview
  const preview = previewCleaningOperation(op, state.cleanedData.headers, state.cleanedData.rows);

  const previewModalEl = document.getElementById('cleaningPreviewModal');
  const descEl = document.getElementById('cleanModalDesc');
  const statsEl = document.getElementById('cleanModalStats');
  const applyBtn = document.getElementById('cleanModalApplyBtn');

  if (descEl) descEl.textContent = preview.description;
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="alert alert-info">
        <strong>Impact Preview:</strong><br>
        • Affected Rows: <strong>${preview.affectedRowsCount.toLocaleString()}</strong><br>
        • Affected Cells: <strong>${preview.affectedCellsCount.toLocaleString()}</strong>
      </div>
    `;
  }

  const newApplyBtn = applyBtn.cloneNode(true);
  applyBtn.parentNode.replaceChild(newApplyBtn, applyBtn);

  newApplyBtn.addEventListener('click', () => {
    state.cleaningOps.push(op);
    reapplyCleaningPipeline();
    const bsModal = window.bootstrap.Modal.getInstance(previewModalEl);
    if (bsModal) bsModal.hide();
    showToast('Cleaning operation applied successfully!', 'success');
  });

  const bsModal = new window.bootstrap.Modal(previewModalEl);
  bsModal.show();
}

/**
 * Re-runs the cleaning pipeline from originalData and updates downstream states.
 */
export function reapplyCleaningPipeline() {
  const result = applyOperations(state.cleaningOps, state.originalData.headers, state.originalData.rows);

  state.cleanedData = {
    headers: result.headers,
    rows: coerceRowTypes(result.rows, result.headers)
  };

  // Re-profile cleaned data
  state.profile = profileDataset(state.cleanedData.headers, state.cleanedData.rows);
  state.recommendations = recommendCharts(state.cleanedData.headers, state.profile.columnProfiles, state.cleanedData.rows);
  state.renderedCharts = state.recommendations.slice(0, 6);

  // Apply filters on newly cleaned rows
  applyActiveFilters();
  renderCleaningView();
  renderDashboard();
}

/**
 * Renders Cleaning history & badges
 */
function renderCleaningView() {
  const countEl = document.getElementById('cleanOpsCountBadge');
  const historyList = document.getElementById('cleanOpsHistoryList');
  const undoBtn = document.getElementById('undoCleanOpBtn');

  if (countEl) countEl.textContent = `${state.cleaningOps.length} applied`;
  if (undoBtn) undoBtn.disabled = state.cleaningOps.length === 0;

  if (historyList) {
    if (state.cleaningOps.length === 0) {
      historyList.innerHTML = `<li class="list-group-item text-muted">No cleaning operations applied yet. Data is in original state.</li>`;
    } else {
      historyList.innerHTML = state.cleaningOps.map((op, idx) => `
        <li class="list-group-item d-flex justify-content-between align-items-center">
          <div>
            <span class="badge bg-primary me-2">Step ${idx + 1}</span>
            <strong>${op.description || op.type}</strong>
          </div>
          <span class="cleaning-op-badge">${op.type}</span>
        </li>
      `).join('');
    }
  }
}

/**
 * Export Event Listeners
 */
function setupExportEventListeners() {
  const exportOriginalCsvBtn = document.getElementById('exportOriginalCsvBtn');
  const exportCleanedCsvBtn = document.getElementById('exportCleanedCsvBtn');
  const exportFilteredCsvBtn = document.getElementById('exportFilteredCsvBtn');
  const exportPdfBtn = document.getElementById('exportPdfReportBtn');
  const formulaCheck = document.getElementById('formulaProtectionCheck');

  if (exportOriginalCsvBtn) {
    exportOriginalCsvBtn.addEventListener('click', async () => {
      try {
        const neutralize = formulaCheck ? formulaCheck.checked : true;
        await exportToCsv(state.originalData.headers, state.originalData.rows, `original-${state.fileName}`, { neutralizeFormulas: neutralize });
        showToast('Original CSV downloaded.', 'success');
      } catch (e) {
        showToast(`Export failed: ${e.message}`, 'error');
      }
    });
  }

  if (exportCleanedCsvBtn) {
    exportCleanedCsvBtn.addEventListener('click', async () => {
      try {
        const neutralize = formulaCheck ? formulaCheck.checked : true;
        await exportToCsv(state.cleanedData.headers, state.cleanedData.rows, `cleaned-${state.fileName}`, { neutralizeFormulas: neutralize });
        showToast('Cleaned CSV downloaded.', 'success');
      } catch (e) {
        showToast(`Export failed: ${e.message}`, 'error');
      }
    });
  }

  if (exportFilteredCsvBtn) {
    exportFilteredCsvBtn.addEventListener('click', async () => {
      try {
        const neutralize = formulaCheck ? formulaCheck.checked : true;
        await exportToCsv(state.cleanedData.headers, state.viewData, `filtered-${state.fileName}`, { neutralizeFormulas: neutralize });
        showToast('Filtered CSV downloaded.', 'success');
      } catch (e) {
        showToast(`Export failed: ${e.message}`, 'error');
      }
    });
  }

  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', async () => {
      try {
        showToast('Compiling executive PDF report...', 'info');
        await exportPdfReport({
          datasetName: state.fileName,
          rowCount: state.cleanedData.rows.length,
          colCount: state.cleanedData.headers.length,
          missingPercentage: state.profile.missingPercentage,
          duplicateRows: state.profile.duplicateRows,
          qualityWarnings: state.profile.qualityWarnings,
          charts: state.renderedCharts
        }, `${state.fileName.replace(/\.[^/.]+$/, '')}-analytics-report.pdf`);
        showToast('PDF Report successfully generated!', 'success');
      } catch (e) {
        showToast(`PDF Export failed: ${e.message}`, 'error');
      }
    });
  }
}

/**
 * Add Custom Chart Modal Setup
 */
function setupAddChartModal() {
  const addChartBtn = document.getElementById('addCustomChartBtn');
  const modalEl = document.getElementById('addChartModal');
  if (!addChartBtn || !modalEl) return;

  addChartBtn.addEventListener('click', () => {
    if (!state.cleanedData) return;

    const xSelect = document.getElementById('newChartX');
    const ySelect = document.getElementById('newChartY');
    const typeSelect = document.getElementById('newChartType');
    const aggSelect = document.getElementById('newChartAgg');

    xSelect.innerHTML = state.cleanedData.headers.map(h => `<option value="${h.key}">${h.label} (${h.type})</option>`).join('');
    ySelect.innerHTML = `<option value="">-- None (Count only) --</option>` + state.cleanedData.headers.map(h => `<option value="${h.key}">${h.label} (${h.type})</option>`).join('');

    const zSelect = document.getElementById('newChartZ');
    const catSelect = document.getElementById('newChartCat');
    const zWrapper = document.getElementById('newChartZWrapper');
    const catWrapper = document.getElementById('newChartCatWrapper');

    if (zSelect) {
      zSelect.innerHTML = `<option value="">-- Auto Metric / Size --</option>` + state.cleanedData.headers.filter(h => h.type === 'numeric').map(h => `<option value="${h.key}">${h.label} (numeric)</option>`).join('');
    }
    if (catSelect) {
      catSelect.innerHTML = `<option value="">-- None --</option>` + state.cleanedData.headers.filter(h => h.type === 'categorical' || h.type === 'boolean').map(h => `<option value="${h.key}">${h.label}</option>`).join('');
    }

    const updateVisibility = () => {
      const type = typeSelect.value;
      if (type === 'bubble') {
        if (zWrapper) zWrapper.classList.remove('d-none');
        if (catWrapper) catWrapper.classList.remove('d-none');
      } else if (type === 'heatmap') {
        if (zWrapper) zWrapper.classList.remove('d-none');
        if (catWrapper) catWrapper.classList.add('d-none');
      } else {
        if (zWrapper) zWrapper.classList.add('d-none');
        if (catWrapper) catWrapper.classList.add('d-none');
      }
    };
    typeSelect.onchange = updateVisibility;
    updateVisibility();

    const bsModal = new window.bootstrap.Modal(modalEl);
    bsModal.show();
  });

  const confirmBtn = document.getElementById('confirmAddChartBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      const title = document.getElementById('newChartTitle').value.trim() || 'Custom Chart';
      const type = document.getElementById('newChartType').value;
      const x = document.getElementById('newChartX').value;
      const y = document.getElementById('newChartY').value || undefined;
      const z = document.getElementById('newChartZ')?.value || undefined;
      const categoryCol = document.getElementById('newChartCat')?.value || undefined;
      const agg = document.getElementById('newChartAgg').value;

      const headerMap = new Map(state.cleanedData.headers.map(h => [h.key, h]));
      const xType = headerMap.get(x)?.type;
      const yType = y ? headerMap.get(y)?.type : undefined;

      const validation = validateChartSuitability(type, xType, yType, agg);
      if (!validation.valid) {
        showToast(validation.reason, 'error');
        return;
      }

      const newConfig = {
        id: `custom_${Date.now()}`,
        type,
        title,
        x,
        y,
        z,
        categoryCol,
        aggregation: agg,
        score: 100,
        reason: 'User-configured custom visualization.'
      };

      state.renderedCharts.unshift(newConfig);
      renderDashboardCharts();

      const bsModal = window.bootstrap.Modal.getInstance(modalEl);
      if (bsModal) bsModal.hide();
      showToast('Custom chart added to dashboard!', 'success');
    });
  }
}

/**
 * Universal Command Palette (Ctrl+K / ⌘K)
 * Provides keyboard-driven navigation and quick actions.
 */
function setupCommandPalette() {
  const paletteModal = document.getElementById('commandPaletteModal');
  if (!paletteModal) return;

  const searchInput = document.getElementById('cmdPaletteSearchInput');
  const listEl = document.getElementById('cmdPaletteList');
  const cmdPaletteBtn = document.getElementById('cmdPaletteBtn');

  let bsModal = null;
  let activeIndex = -1;

  // All available commands
  const ALL_COMMANDS = [
    { label: 'Go to Welcome', desc: 'Upload a new file', action: () => { window.location.hash = '#welcome'; }, shortcut: '' },
    { label: 'Go to Dashboard', desc: 'Charts and summary statistics', action: () => { window.location.hash = '#dashboard'; }, shortcut: '' },
    { label: 'Go to Data Table', desc: 'Search, sort, and filter rows', action: () => { window.location.hash = '#data'; }, shortcut: '/' },
    { label: 'Go to Data Cleaning', desc: 'Apply reversible transformations', action: () => { window.location.hash = '#clean'; }, shortcut: '' },
    { label: 'Go to Export', desc: 'Download CSV, PNG, or PDF report', action: () => { window.location.hash = '#export'; }, shortcut: '' },
    { label: 'Load sample dataset', desc: 'Load built-in 800-row sales data', action: () => document.getElementById('loadDemoBtn')?.click(), shortcut: '' },
    { label: 'Upload CSV file', desc: 'Select a file from disk', action: () => document.getElementById('csvFileInput')?.click(), shortcut: '' },
    {
      label: 'Clear all filters', desc: 'Reset search and column filters', action: () => {
        state.filters = { globalSearch: '', columnFilters: {} };
        const s = document.getElementById('tableGlobalSearch');
        if (s) s.value = '';
        document.querySelectorAll('.col-filter-input').forEach(i => i.value = '');
        if (state.cleanedData) applyActiveFilters();
      }, shortcut: ''
    },
    { label: 'Toggle dark / light theme', desc: 'Switch appearance between light and dark', action: () => toggleTheme(), shortcut: '' },
    { label: 'Add custom chart', desc: 'Configure a new visualization', action: () => document.getElementById('addCustomChartBtn')?.click(), shortcut: '' },
    {
      label: 'Inspect column statistics', desc: 'Open detailed statistics and distribution panel', action: () => {
        const firstCol = state.cleanedData?.headers?.[0]?.key;
        if (firstCol) openColumnStats(firstCol);
        else showToast('Please load a dataset first.', 'info');
      }, shortcut: ''
    },
    {
      label: 'View Correlation Matrix', desc: 'Inspect bivariate Pearson correlations and heatmap', action: () => {
        window.location.hash = '#dashboard';
        setTimeout(() => {
          const mount = document.getElementById('dashboardCorrelationMount');
          if (mount) mount.scrollIntoView({ behavior: 'smooth' });
        }, 120);
      }, shortcut: ''
    },
    {
      label: 'View Executive Smart Insights', desc: 'Jump to automated drivers, red flags, anomalies, and trends', action: () => {
        window.location.hash = '#dashboard';
        setTimeout(() => {
          const mount = document.getElementById('dashboardSmartInsightsMount');
          if (mount) mount.scrollIntoView({ behavior: 'smooth' });
        }, 120);
      }, shortcut: ''
    },
    {
      label: 'Toggle sidebar navigation', desc: 'Collapse or expand navigation rail', action: () => {
        document.getElementById('sidebarCollapseBtn')?.click();
      }, shortcut: 'Ctrl+B'
    },
    {
      label: 'Cycle chart color palette', desc: 'Rotate between Cobalt, Emerald, Sunset, Cyber, and Pastel themes', action: () => {
        const keys = Object.keys(CHART_THEMES);
        const curr = getChartThemeKey();
        const nextIdx = (keys.indexOf(curr) + 1) % keys.length;
        const nextKey = keys[nextIdx];
        const nextTheme = CHART_THEMES[nextKey];
        if (setChartThemeKey(nextKey)) {
          const labelEl = document.getElementById('activeThemeLabel');
          const swatchEl = document.getElementById('activeThemeSwatchDot');
          if (labelEl) labelEl.textContent = nextTheme.label;
          if (swatchEl) swatchEl.style.backgroundColor = nextTheme.badgeColor;
          if (state.renderedCharts && state.renderedCharts.length > 0) {
            renderDashboardCharts();
          }
          showToast(`Palette: ${nextTheme.label}`, 'info');
        }
      }, shortcut: ''
    }
  ];

  function openPalette() {
    if (!bsModal) bsModal = new window.bootstrap.Modal(paletteModal);
    if (searchInput) searchInput.value = '';
    renderCommands('');
    bsModal.show();
    setTimeout(() => searchInput?.focus(), 80);
  }

  function closePalette() {
    bsModal?.hide();
  }

  function renderCommands(query) {
    if (!listEl) return;
    activeIndex = -1;
    const q = query.toLowerCase().trim();
    const filtered = q ? ALL_COMMANDS.filter(c =>
      c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
    ) : ALL_COMMANDS;

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="cmd-item" style="color:var(--color-text-muted)">No matching commands</div>`;
      return;
    }

    listEl.innerHTML = filtered.map((cmd, i) => `
      <div class="cmd-item" data-idx="${i}" tabindex="-1" role="option">
        <div>
          <div style="font-size:0.84rem">${_escChip(cmd.label)}</div>
          <div class="cmd-item-desc">${_escChip(cmd.desc)}</div>
        </div>
        ${cmd.shortcut ? `<span class="kbd-shortcut font-mono">${cmd.shortcut}</span>` : ''}
      </div>
    `).join('');

    listEl.querySelectorAll('.cmd-item').forEach((el, i) => {
      el.addEventListener('click', () => {
        filtered[i].action();
        closePalette();
      });
      el.addEventListener('mouseenter', () => {
        listEl.querySelectorAll('.cmd-item').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
        activeIndex = i;
      });
    });
  }

  // Keyboard: open palette on Ctrl+K / ⌘K from anywhere
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      openPalette();
      return;
    }
    // Navigate within palette
    if (!paletteModal.classList.contains('show')) return;
    const items = listEl?.querySelectorAll('.cmd-item');
    if (!items || items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items.forEach(el => el.classList.remove('active'));
      activeIndex = (activeIndex + 1) % items.length;
      items[activeIndex].classList.add('active');
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items.forEach(el => el.classList.remove('active'));
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      items[activeIndex].classList.add('active');
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      items[activeIndex].click();
    } else if (e.key === 'Escape') {
      closePalette();
    }
  });

  if (searchInput) {
    searchInput.addEventListener('input', (e) => renderCommands(e.target.value));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const items = listEl?.querySelectorAll('.cmd-item');
        if (items && items.length > 0) {
          const idx = activeIndex >= 0 ? activeIndex : 0;
          items[idx]?.click();
        }
      }
    });
  }

  if (cmdPaletteBtn) cmdPaletteBtn.addEventListener('click', openPalette);
}

// Auto-initialize on load
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', initApp);
}
