/**
 * Enclave - Query UI Module (AI Query)
 * Question bar, consent dialog, payload preview, API key setup,
 * SQL editor panel, result table, chart pinning, history, and suggestions.
 *
 * All cell values rendered via textContent only (XSS-safe, FR-23).
 */

import {
  setApiKey, getApiKey, hasApiKey, clearApiKey,
  hasConsent, recordConsent,
  setExcludedColumns, getExcludedColumns,
  setAnonymizeColumns, getAnonymizeColumns,
  setIncludeSampleValues, getIncludeSampleValues,
  buildSchemaPayload, estimatePayloadSize,
  queryGroq, validateApiKey,
  deAnonymizeSql,
  LlmError,
} from './llmClient.js';
import { validateSql, executeSql, SqlEngineError } from './sqlEngine.js';

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

/** Last 10 questions for history (session only, never persisted). */
const _history = [];

/** Current anonymization map from the last buildSchemaPayload call. */
let _currentAnonMap = new Map();

/** AbortController for the current pending query. */
let _queryAbortController = null;

/** Flag to prevent double-submit. */
let _isQuerying = false;

/** Rate-limit countdown interval ID. */
let _rateLimitInterval = null;

/** Reference to the active dataset state getter (set via init). */
let _getState = null;

/** Reference to app-level showToast. */
let _showToast = null;

/** Reference to chartRecommender's recommendCharts. */
let _recommendCharts = null;

/** Reference to chartRenderer's renderChart. */
let _renderChart = null;

/** Reference to app-level pinChart callback. */
let _onPinChart = null;

/** Reference to exportManager's exportToCsv. */
let _exportToCsv = null;

/** Max retries on SQL validation/execution error (FR-34, FR-47). */
const MAX_RETRIES = 2;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initializes the AI Query UI feature.
 * Must be called once after the DOM is ready and a dataset has been loaded.
 *
 * @param {object} opts
 * @param {function(): object} opts.getState - Returns current app state
 * @param {function(string, string): void} opts.showToast
 * @param {function(object): void} opts.onPinChart - Called with chart config to pin
 * @param {function} opts.recommendCharts - From chartRecommender.js
 * @param {function} opts.renderChart - From chartRenderer.js
 * @param {function} [opts.exportToCsv] - From exportManager.js (optional)
 */
export function initQueryUI({ getState, showToast, onPinChart, recommendCharts, renderChart, exportToCsv }) {
  _getState = getState;
  _showToast = showToast;
  _onPinChart = onPinChart;
  _recommendCharts = recommendCharts;
  _renderChart = renderChart;
  _exportToCsv = exportToCsv;

  _renderQuestionBar();
  _setupKeyboardShortcut();
  _setupOnlineOfflineListeners();
  _updateOnlineStatus();
}

/**
 * Called whenever a new dataset is loaded — rebuilds suggestions.
 */
export function onDatasetLoaded() {
  _renderSuggestions();
  _updateOnlineStatus();
  // Clear results from previous dataset
  const resultsMount = document.getElementById('aiQueryResultsMount');
  if (resultsMount) resultsMount.innerHTML = '';
}

// ---------------------------------------------------------------------------
// Question Bar
// ---------------------------------------------------------------------------

function _renderQuestionBar() {
  const mount = document.getElementById('aiQueryBarMount');
  if (!mount) return;

  mount.innerHTML = `
    <div class="ai-query-bar card-insight mb-4" id="aiQueryBar">
      <div class="card-insight-body p-3">
        <div class="d-flex align-items-center gap-2 mb-2">
          <i class="bi bi-stars text-accent fs-5"></i>
          <span class="fw-semibold" style="font-family: var(--font-serif);">AI Query</span>
          <span class="badge bg-light text-muted border font-mono ms-1" style="font-size:0.68rem;">In-Browser SQL</span>
          <div class="ms-auto d-flex align-items-center gap-2">
            <span class="small text-muted font-mono" style="font-size:0.72rem;">
              <i class="bi bi-shield-check text-success me-1"></i>Schema only · Zero row data sent
            </span>
          </div>
        </div>

        <!-- Offline / unavailable banner -->
        <div id="aiQueryOfflineBanner" class="d-none ai-query-offline-banner mb-3" role="alert">
          <div class="d-flex align-items-center gap-3 flex-grow-1 flex-wrap">
            <div class="ai-query-offline-icon">
              <i class="bi bi-cloud-slash" id="aiQueryOfflineIcon"></i>
            </div>
            <div class="ai-query-offline-content">
              <div class="ai-query-offline-title" id="aiQueryOfflineTitle">
                <span>AI Translation Offline</span>
                <span class="ai-query-offline-badge">Local SQL Ready</span>
              </div>
              <div class="ai-query-offline-desc" id="aiQueryOfflineDesc">
                Natural-language translation requires internet to reach Groq. Your dataset is loaded locally and fully queryable with in-browser SQL.
              </div>
            </div>
          </div>
          <div class="ai-query-offline-actions">
            <button class="btn btn-sm ai-query-offline-sql-toggle" id="aiQueryDirectSqlBtn" type="button" title="Write or run SQL directly in browser">
              <i class="bi bi-terminal me-1"></i>Direct SQL
            </button>
            <button class="btn btn-sm ai-query-offline-retry" id="aiQueryRetryBtn" type="button" title="Check internet connection">
              <i class="bi bi-arrow-clockwise me-1" id="aiQueryRetryIcon"></i>Check Connection
            </button>
          </div>
        </div>

        <div class="ai-query-input-row">
          <div class="input-group">
            <input
              type="text"
              class="form-control font-sans"
              id="aiQueryInput"
              placeholder="Ask a question about your data…"
              aria-label="Natural language query"
              autocomplete="off"
              disabled
            >
            <button class="btn btn-primary" id="aiQuerySubmitBtn" disabled aria-label="Run query">
              <i class="bi bi-arrow-right"></i>
            </button>
          </div>
          <button class="btn btn-sm btn-outline-danger d-none ms-2" id="aiQueryCancelBtn" aria-label="Cancel query">
            <i class="bi bi-x-lg"></i> Cancel
          </button>
        </div>

        <div id="aiQuerySuggestions" class="mt-2 d-flex flex-wrap gap-1"></div>

        <div id="aiQueryHistory" class="mt-1 d-flex flex-wrap gap-1"></div>
      </div>
    </div>
  `;

  // Wire up events
  const input = document.getElementById('aiQueryInput');
  const submitBtn = document.getElementById('aiQuerySubmitBtn');
  const cancelBtn = document.getElementById('aiQueryCancelBtn');
  const retryBtn = document.getElementById('aiQueryRetryBtn');
  const directSqlBtn = document.getElementById('aiQueryDirectSqlBtn');

  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        _handleSubmit();
      }
    });
    // Enable submit button when there's text
    input.addEventListener('input', () => {
      if (submitBtn) submitBtn.disabled = !input.value.trim() || !_isAvailable() || _isQuerying;
    });
  }

  if (submitBtn) submitBtn.addEventListener('click', _handleSubmit);
  if (cancelBtn) cancelBtn.addEventListener('click', _handleCancel);
  if (retryBtn) retryBtn.addEventListener('click', () => { _updateOnlineStatus(true); });

  if (directSqlBtn) {
    directSqlBtn.addEventListener('click', () => {
      let hero = document.getElementById('aiQueryOfflineHero');
      if (!hero) {
        _renderOfflineHero();
        hero = document.getElementById('aiQueryOfflineHero');
      }
      hero?.scrollIntoView({ behavior: 'smooth' });
      document.getElementById('aiQueryOfflineSqlInput')?.focus();
    });
  }

  _refreshBarState();
}

/** Refreshes disabled/enabled state of the question bar. */
function _refreshBarState() {
  const input = document.getElementById('aiQueryInput');
  const submitBtn = document.getElementById('aiQuerySubmitBtn');
  const available = _isAvailable();

  if (input) {
    input.disabled = !available || _isQuerying;
    if (!navigator.onLine) {
      input.placeholder = "AI translation offline — click 'Direct SQL' above or select a question below to run locally…";
    } else if (!hasApiKey()) {
      input.placeholder = "Awaiting Groq API key configuration in js/llmClient.js...";
    } else {
      input.placeholder = "Ask a question about your data (e.g. 'Top 5 regions by revenue')...";
    }
  }
  if (submitBtn) {
    submitBtn.disabled = !available || _isQuerying || !(input?.value?.trim());
  }
}

/** Returns true if the feature is usable right now. */
function _isAvailable() {
  return navigator.onLine && hasApiKey();
}

// ---------------------------------------------------------------------------
// Query Submission
// ---------------------------------------------------------------------------

async function _handleSubmit() {
  if (_isQuerying) return;

  const input = document.getElementById('aiQueryInput');
  const question = input?.value?.trim();
  if (!question) return;

  if (!hasApiKey()) {
    _showToast?.('Groq API key has not been configured in js/llmClient.js yet.', 'info');
    return;
  }

  // Consent check (FR-6)
  if (!hasConsent()) {
    _showConsentDialog(question);
    return;
  }

  await _executeQuery(question);
}

function _handleCancel() {
  if (_queryAbortController) {
    _queryAbortController.abort();
    _queryAbortController = null;
  }
  _setLoadingState(false);
}

/**
 * Core query pipeline: build payload → call Groq → validate SQL → execute → render.
 * @param {string} question
 * @param {number} [retryCount=0]
 * @param {string|null} [prevSqlError=null] - Previous SQL error for retry loop
 */
async function _executeQuery(question, retryCount = 0, prevSqlError = null) {
  const state = _getState?.();
  if (!state?.cleanedData) return;

  _setLoadingState(true);

  const { headers, rows } = state.cleanedData;
  const profile = state.profile;

  // Build schema payload (FR-12 to FR-16)
  const { payload: schemaPayload, anonymizationMap } = buildSchemaPayload(
    headers,
    profile?.columnProfiles ?? new Map(),
    rows,
  );
  _currentAnonMap = anonymizationMap;

  // For retry, augment question with previous error context (FR-34, FR-47)
  let effectiveQuestion = question;
  if (prevSqlError && retryCount > 0) {
    effectiveQuestion = `${question}\n\n[Previous attempt produced this SQL error: ${prevSqlError}. Please fix the SQL.]`;
  }

  _queryAbortController = new AbortController();

  let llmResult;
  try {
    llmResult = await queryGroq({
      question: effectiveQuestion,
      schemaPayload,
      recentQuestions: _history.slice(-3).map(h => h.question),
      signal: _queryAbortController.signal,
    });
  } catch (err) {
    _setLoadingState(false);
    _handleLlmError(err, question, retryCount);
    return;
  }

  _setLoadingState(false);

  let { sql, explanation, confidence, ambiguities } = llmResult;

  // De-anonymize SQL if anonymization was used
  if (_currentAnonMap.size > 0) {
    sql = deAnonymizeSql(sql, _currentAnonMap, headers);
  }

  // If there are ambiguities, show picker before executing (FR-26)
  if (ambiguities && ambiguities.length > 0 && retryCount === 0) {
    _renderAmbiguityPicker(question, sql, explanation, confidence, ambiguities);
    return;
  }

  // Validate SQL (FR-18, FR-19)
  const validation = validateSql(sql, headers, getExcludedColumns());
  if (!validation.valid) {
    if (retryCount < MAX_RETRIES) {
      await _executeQuery(question, retryCount + 1, validation.reason);
    } else {
      _renderError(`SQL validation failed: ${validation.reason}`, sql);
    }
    return;
  }

  // Execute SQL (FR-17 to FR-21)
  let execResult;
  try {
    execResult = await executeSql(sql, headers, rows, _queryAbortController?.signal);
  } catch (err) {
    if (err instanceof SqlEngineError && err.code !== 'CANCELLED') {
      if (retryCount < MAX_RETRIES) {
        await _executeQuery(question, retryCount + 1, err.message);
        return;
      }
    }
    _renderError(err.message || 'Query execution failed.', sql);
    return;
  }

  // Add to history
  _addToHistory(question, sql);

  // Render results (FR-22 to FR-27)
  _renderResults({ question, sql, explanation, confidence, execResult, headers });
}

function _setLoadingState(loading) {
  _isQuerying = loading;
  const submitBtn = document.getElementById('aiQuerySubmitBtn');
  const cancelBtn = document.getElementById('aiQueryCancelBtn');
  const input = document.getElementById('aiQueryInput');
  const resultsMount = document.getElementById('aiQueryResultsMount');

  if (submitBtn) {
    submitBtn.disabled = loading;
    submitBtn.innerHTML = loading
      ? '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>'
      : '<i class="bi bi-arrow-right"></i>';
  }
  if (cancelBtn) cancelBtn.classList.toggle('d-none', !loading);
  if (input) input.disabled = loading;

  if (loading && resultsMount) {
    resultsMount.innerHTML = `
      <div class="card-insight mb-3">
        <div class="card-insight-body p-4 text-center text-muted">
          <div class="spinner-border spinner-border-sm me-2" role="status"></div>
          Generating SQL query…
        </div>
      </div>
    `;
  }
}

// ---------------------------------------------------------------------------
// LLM Error Handling
// ---------------------------------------------------------------------------

function _handleLlmError(err, question, retryCount) {
  if (!(err instanceof LlmError)) {
    _renderError('An unexpected error occurred. Please try again.', '');
    return;
  }

  switch (err.code) {
    case 'CANCELLED':
      return; // User cancelled, don't show error
    case 'RATE_LIMIT': {
      const seconds = err.extra?.retryAfter ?? 60;
      _renderRateLimitMessage(question, seconds);
      break;
    }
    case 'OFFLINE':
    case 'NETWORK':
    case 'TIMEOUT':
      _renderError(err.message, '', true);
      break;
    case 'INVALID_KEY':
      _renderError(err.message, '');
      _showToast?.(err.message, 'error');
      break;
    default:
      _renderError(err.message, '');
  }
}

// ---------------------------------------------------------------------------
// Result Rendering (FR-22 to FR-27)
// ---------------------------------------------------------------------------

function _renderResults({ question, sql, explanation, confidence, execResult, headers }) {
  const mount = document.getElementById('aiQueryResultsMount');
  if (!mount) return;

  const { rows: resultRows, truncated } = execResult;
  const resultHeaders = resultRows.length > 0 ? Object.keys(resultRows[0]) : [];

  // Build confidence badge
  const confColor = confidence === 'high' ? 'success' : confidence === 'medium' ? 'warning' : 'secondary';

  mount.innerHTML = `
    <div class="card-insight mb-3 ai-query-result" id="aiQueryResultCard">
      <div class="card-insight-header d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div class="d-flex align-items-center gap-2">
          <i class="bi bi-stars text-accent"></i>
          <span class="fw-semibold small">${_escHtml(question)}</span>
        </div>
        <div class="d-flex gap-1 align-items-center">
          <span class="badge bg-${confColor}-subtle text-${confColor}-emphasis border font-mono" style="font-size:0.68rem;">
            ${confidence} confidence
          </span>
          <button class="btn btn-sm btn-outline-secondary" id="aiQueryCopySqlBtn" title="Copy SQL">
            <i class="bi bi-clipboard"></i> Copy SQL
          </button>
          <button class="btn btn-sm btn-outline-secondary" id="aiQueryExportBtn" title="Export result as CSV">
            <i class="bi bi-download"></i> Export
          </button>
        </div>
      </div>

      <div class="card-insight-body p-3">
        <!-- SQL Editor Panel (FR-22) -->
        <div class="mb-3">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <label class="form-label small fw-semibold text-muted mb-0 font-mono">Generated SQL</label>
            <button class="btn btn-sm btn-primary" id="aiQueryRunEditedBtn">
              <i class="bi bi-play-fill me-1"></i>Run
            </button>
          </div>
          <textarea
            class="form-control form-control-sm font-mono ai-query-sql-editor"
            id="aiQuerySqlEditor"
            rows="3"
            spellcheck="false"
            aria-label="Generated SQL — editable"
          >${_escHtml(sql)}</textarea>
        </div>

        ${explanation ? `
        <!-- One-line explanation (FR-24) -->
        <div class="ai-query-explanation mb-3 text-muted small">
          <i class="bi bi-lightbulb me-1 text-warning"></i>${_escHtml(explanation)}
        </div>
        ` : ''}

        ${truncated ? `
        <div class="alert alert-info py-2 px-3 small mb-2">
          <i class="bi bi-info-circle me-1"></i>
          Showing first ${resultRows.length.toLocaleString()} rows. The full result was larger.
        </div>
        ` : ''}

        <!-- Result Table (FR-23) -->
        <div id="aiQueryResultTableWrapper">
          ${_buildResultTable(resultRows, resultHeaders)}
        </div>

        <!-- Chart recommendation area (FR-25) -->
        <div id="aiQueryChartMount" class="mt-3"></div>
      </div>
    </div>
  `;

  // Wire up Copy SQL
  document.getElementById('aiQueryCopySqlBtn')?.addEventListener('click', () => {
    const editor = document.getElementById('aiQuerySqlEditor');
    const txt = editor?.value || sql;
    navigator.clipboard.writeText(txt).then(() => _showToast?.('SQL copied to clipboard!', 'success'));
  });

  // Wire up Export (FR-27)
  document.getElementById('aiQueryExportBtn')?.addEventListener('click', () => {
    _exportResults(resultRows, resultHeaders);
  });

  // Wire up Run button on edited SQL
  document.getElementById('aiQueryRunEditedBtn')?.addEventListener('click', () => {
    const editor = document.getElementById('aiQuerySqlEditor');
    const editedSql = editor?.value?.trim();
    if (!editedSql) return;
    _runEditedSql(editedSql, question);
  });

  // Render chart suggestion (FR-25)
  _renderResultChart(resultRows, resultHeaders);
}

function _buildResultTable(rows, colKeys) {
  if (rows.length === 0) {
    return `<div class="text-muted small text-center py-3">No rows matched.</div>`;
  }

  // Build header row
  let thead = '<tr>' + colKeys.map(k => `<th class="th-sortable-result" data-col="${_escAttr(k)}">${_escHtml(k)}</th>`).join('') + '</tr>';

  // Build data rows — textContent equivalent using _escHtml (XSS-safe, FR-23)
  let tbody = rows.map(row => {
    const cells = colKeys.map(k => {
      const val = row[k];
      const display = val === null || val === undefined ? '' : String(val);
      return `<td>${_escHtml(display)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `
    <div class="table-responsive" style="max-height:360px;overflow-y:auto;">
      <table class="table-insight ai-query-result-table">
        <thead id="aiQueryResultThead">${thead}</thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
    <div class="small text-muted font-mono mt-1">${rows.length.toLocaleString()} row${rows.length === 1 ? '' : 's'}</div>
  `;
}

/** Renders a recommended chart for the query result (FR-25). */
function _renderResultChart(rows, colKeys) {
  const chartMount = document.getElementById('aiQueryChartMount');
  if (!chartMount || !_recommendCharts || !_renderChart) return;
  if (rows.length === 0 || colKeys.length === 0) return;

  // Build synthetic headers and Map rows for the chart recommender
  const syntheticHeaders = colKeys.map(k => ({
    key: k,
    label: k,
    type: _inferSimpleType(rows, k),
  }));
  const syntheticRows = rows.map(row => {
    const m = new Map();
    for (const k of colKeys) m.set(k, row[k]);
    return m;
  });

  let recs;
  try {
    recs = _recommendCharts(syntheticHeaders, _buildSyntheticProfiles(syntheticHeaders, syntheticRows), syntheticRows);
  } catch {
    return;
  }

  if (!recs || recs.length === 0) return;

  const topRec = recs[0];

  chartMount.innerHTML = `
    <div class="border-top pt-3">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <span class="small fw-semibold text-muted">Suggested Chart</span>
        <button class="btn btn-sm btn-outline-secondary" id="aiQueryPinChartBtn">
          <i class="bi bi-pin-angle me-1"></i>Pin to Dashboard
        </button>
      </div>
      <div style="position:relative;height:240px;">
        <canvas id="aiQueryResultCanvas"></canvas>
      </div>
    </div>
  `;

  const canvas = document.getElementById('aiQueryResultCanvas');
  if (canvas) {
    try {
      const { buildChartData } = _getBuildChartDataFn();
      const chartData = buildChartData(topRec, syntheticRows, syntheticHeaders);
      _renderChart(canvas, topRec, chartData);
    } catch {
      // Chart rendering is best-effort
    }
  }

  document.getElementById('aiQueryPinChartBtn')?.addEventListener('click', () => {
    _onPinChart?.(topRec);
    _showToast?.(`Pinned "${topRec.title}" to Dashboard!`, 'success');
  });
}

let _buildChartDataFn = null;
function _getBuildChartDataFn() {
  // Dynamically resolve buildChartData from chartRecommender (already loaded in app)
  if (!_buildChartDataFn) {
    // If it was passed in during init, use it. Otherwise fall back to a no-op.
    _buildChartDataFn = globalThis._enclaveBuildChartData || (() => ({ labels: [], datasets: [] }));
  }
  return { buildChartData: _buildChartDataFn };
}

/** Infers a simple type from result rows for charting. */
function _inferSimpleType(rows, key) {
  for (const row of rows.slice(0, 20)) {
    const val = row[key];
    if (val === null || val === undefined) continue;
    if (typeof val === 'number') return 'numeric';
    if (val instanceof Date) return 'date';
    const n = Number(val);
    if (!isNaN(n) && String(val).trim() !== '') return 'numeric';
    return 'categorical';
  }
  return 'text';
}

/** Builds minimal column profiles for the chart recommender. */
function _buildSyntheticProfiles(headers, rows) {
  const profiles = new Map();
  for (const h of headers) {
    const vals = rows.map(r => r.get(h.key)).filter(v => v !== null && v !== undefined);
    const distinctCount = new Set(vals.map(v => String(v))).size;
    profiles.set(h.key, {
      key: h.key, label: h.label, type: h.type,
      missingCount: 0, missingPercentage: 0,
      stats: { distinctCount, min: Math.min(...vals.filter(v => typeof v === 'number')), max: Math.max(...vals.filter(v => typeof v === 'number')) },
    });
  }
  return profiles;
}

// ---------------------------------------------------------------------------
// Run edited SQL
// ---------------------------------------------------------------------------

async function _runEditedSql(editedSql, originalQuestion) {
  const state = _getState?.();
  if (!state?.cleanedData) return;
  const { headers, rows } = state.cleanedData;

  const validation = validateSql(editedSql, headers, getExcludedColumns());
  if (!validation.valid) {
    _showToast?.(`SQL validation: ${validation.reason}`, 'error');
    const tableWrapper = document.getElementById('aiQueryResultTableWrapper');
    if (tableWrapper) {
      tableWrapper.innerHTML = `<div class="alert alert-danger small py-2">${_escHtml(validation.reason)}</div>`;
    } else {
      _renderError(`SQL validation failed: ${validation.reason}`, editedSql);
    }
    return;
  }

  const tableWrapper = document.getElementById('aiQueryResultTableWrapper');
  if (tableWrapper) {
    tableWrapper.innerHTML = `<div class="text-center text-muted py-3"><span class="spinner-border spinner-border-sm me-2"></span>Running…</div>`;
  }

  try {
    const execResult = await executeSql(editedSql, headers, rows);
    _addToHistory(originalQuestion || editedSql, editedSql);
    _showToast?.('Query executed.', 'success');

    if (tableWrapper) {
      const resultHeaders = execResult.rows.length > 0 ? Object.keys(execResult.rows[0]) : [];
      tableWrapper.innerHTML = _buildResultTable(execResult.rows, resultHeaders);
      _renderResultChart(execResult.rows, resultHeaders);
    } else {
      _renderResults({
        question: originalQuestion || 'Executed SQL Query',
        sql: editedSql,
        explanation: 'Query executed successfully.',
        confidence: 'high',
        execResult,
        headers,
      });
    }
  } catch (err) {
    if (tableWrapper) {
      tableWrapper.innerHTML = `<div class="alert alert-danger small py-2">${_escHtml(err.message)}</div>`;
    } else {
      _renderError(err.message || 'Query execution failed.', editedSql);
    }
    _showToast?.(err.message, 'error');
  }
}

/**
 * Executes SQL directly without validation — used by "Try running anyway" and Offline Direct SQL.
 * @param {string} sql
 * @param {string} [question='Direct SQL Query']
 */
async function _forceExecuteSql(sql, question = 'Direct SQL Query') {
  if (!sql) return;
  const state = _getState?.();
  if (!state?.cleanedData) return;
  const { headers, rows } = state.cleanedData;

  const mount = document.getElementById('aiQueryResultsMount');
  if (mount) {
    mount.innerHTML = `
      <div class="card-insight mb-3">
        <div class="card-insight-body p-4 text-center text-muted">
          <div class="spinner-border spinner-border-sm me-2" role="status"></div>
          Running query locally…
        </div>
      </div>
    `;
  }

  try {
    const execResult = await executeSql(sql, headers, rows);
    _renderResults({
      question,
      sql,
      explanation: 'Executed locally in your browser using AlaSQL (100% offline).',
      confidence: 'high',
      execResult,
      headers,
    });
    _addToHistory(question, sql);
    _showToast?.('Query executed locally.', 'success');
  } catch (err) {
    _renderError(err.message || 'Query execution failed.', sql);
    _showToast?.(err.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// Ambiguity Picker (FR-26)
// ---------------------------------------------------------------------------

function _renderAmbiguityPicker(question, sql, explanation, confidence, ambiguities) {
  const mount = document.getElementById('aiQueryResultsMount');
  if (!mount) return;

  const items = ambiguities.map((amb, i) => {
    const opts = (amb.candidates || []).map(c =>
      `<button class="btn btn-sm btn-outline-secondary me-1 mb-1 amb-candidate" data-amb="${i}" data-col="${_escAttr(c)}">${_escHtml(c)}</button>`
    ).join('');
    return `
      <div class="mb-2">
        <div class="small fw-semibold">"${_escHtml(amb.term)}"</div>
        <div class="small text-muted mb-1">Which column did you mean?</div>
        ${opts}
      </div>
    `;
  }).join('');

  mount.innerHTML = `
    <div class="card-insight mb-3">
      <div class="card-insight-header">
        <i class="bi bi-question-circle text-warning me-1"></i>
        <span class="fw-semibold small">Clarification needed</span>
      </div>
      <div class="card-insight-body p-3">
        <p class="small text-muted mb-3">The AI is unsure about some terms. Pick the column you meant:</p>
        ${items}
        <button class="btn btn-sm btn-primary mt-2" id="ambIgnoreBtn">Run anyway</button>
      </div>
    </div>
  `;

  // Clicking a candidate re-asks with the disambiguation context
  mount.querySelectorAll('.amb-candidate').forEach(btn => {
    btn.addEventListener('click', () => {
      const col = btn.getAttribute('data-col');
      const ambIdx = parseInt(btn.getAttribute('data-amb'), 10);
      const amb = ambiguities[ambIdx];
      const clarifiedQuestion = `${question} (when I said "${amb.term}" I meant the column "${col}")`;
      _executeQuery(clarifiedQuestion);
    });
  });

  document.getElementById('ambIgnoreBtn')?.addEventListener('click', () => {
    _executeQuery(question, 0, null);
  });
}

// ---------------------------------------------------------------------------
// Error Rendering
// ---------------------------------------------------------------------------

function _renderError(message, sql, isOffline = false) {
  const mount = document.getElementById('aiQueryResultsMount');
  if (!mount) return;

  mount.innerHTML = `
    <div class="card-insight mb-3">
      <div class="card-insight-body p-3">
        <div class="alert alert-danger py-2 mb-2 small">
          <i class="bi bi-exclamation-triangle me-1"></i>${_escHtml(message)}
        </div>
        ${sql ? `
          <div class="mb-2">
            <label class="form-label small fw-semibold text-muted font-mono mb-1">Generated SQL</label>
            <textarea class="form-control form-control-sm font-mono ai-query-sql-editor" rows="3" id="aiQueryErrorSqlEditor" spellcheck="false">${_escHtml(sql)}</textarea>
          </div>
          <button class="btn btn-sm btn-outline-secondary" id="aiQueryRunErrorSqlBtn">
            <i class="bi bi-play-fill me-1"></i>Try running anyway
          </button>
        ` : ''}
        ${isOffline ? `<button class="btn btn-sm btn-outline-secondary ms-2" id="aiQueryOfflineRetry">Retry</button>` : ''}
      </div>
    </div>
  `;

  document.getElementById('aiQueryRunErrorSqlBtn')?.addEventListener('click', () => {
    const editor = document.getElementById('aiQueryErrorSqlEditor');
    if (editor) _forceExecuteSql(editor.value.trim());
  });

  document.getElementById('aiQueryOfflineRetry')?.addEventListener('click', () => {
    _updateOnlineStatus();
  });
}

function _renderRateLimitMessage(question, seconds) {
  const mount = document.getElementById('aiQueryResultsMount');
  if (!mount) return;

  let remaining = seconds;
  mount.innerHTML = `
    <div class="card-insight mb-3">
      <div class="card-insight-body p-3">
        <div class="alert alert-warning py-2 mb-2 small">
          <i class="bi bi-hourglass me-1"></i>
          You've hit the free limit. Retrying automatically in <strong id="aiQueryRateLimitTimer">${remaining}</strong> seconds…
        </div>
      </div>
    </div>
  `;

  // Disable submit during countdown
  const submitBtn = document.getElementById('aiQuerySubmitBtn');
  if (submitBtn) submitBtn.disabled = true;

  _rateLimitInterval = setInterval(() => {
    remaining--;
    const timerEl = document.getElementById('aiQueryRateLimitTimer');
    if (timerEl) timerEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(_rateLimitInterval);
      if (submitBtn) submitBtn.disabled = false;
      if (mount) mount.innerHTML = '';
      _executeQuery(question);
    }
  }, 1000);
}

// ---------------------------------------------------------------------------
// Suggested Questions (FR-3)
// ---------------------------------------------------------------------------

function _renderSuggestions() {
  const container = document.getElementById('aiQuerySuggestions');
  if (!container) return;

  const state = _getState?.();
  if (!state?.cleanedData) { container.innerHTML = ''; return; }

  const suggestions = _generateSuggestions(state.cleanedData.headers, state.profile);

  container.innerHTML = suggestions.map(s =>
    `<button class="btn btn-sm btn-outline-secondary suggestion-pill" style="font-size:0.78rem;">${_escHtml(s)}</button>`
  ).join('');

  container.querySelectorAll('.suggestion-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.textContent.trim();
      const input = document.getElementById('aiQueryInput');
      if (input) {
        input.value = q;
        input.focus();
        document.getElementById('aiQuerySubmitBtn')?.removeAttribute('disabled');
      }
      // If offline, execute query directly using the template SQL
      if (!navigator.onLine) {
        const state = _getState?.();
        if (state?.cleanedData?.headers) {
          const sql = _suggestionToSql(q, state.cleanedData.headers);
          if (sql) {
            _forceExecuteSql(sql, q);
          }
        }
      }
    });
  });
}

/**
 * Generates 4–6 suggested questions from the dataset schema (FR-3).
 * @param {Array<{key:string,label:string,type:string}>} headers
 * @param {object} profile
 * @returns {string[]}
 */
function _generateSuggestions(headers, profile) {
  const suggestions = [];
  const numeric = headers.filter(h => h.type === 'numeric');
  const categorical = headers.filter(h => h.type === 'categorical');
  const date = headers.filter(h => h.type === 'date');

  if (numeric.length > 0 && categorical.length > 0) {
    suggestions.push(`Total ${numeric[0].label} by ${categorical[0].label}`);
    if (numeric.length > 1) {
      suggestions.push(`Average ${numeric[1].label} by ${categorical[0].label}`);
    }
  }

  if (categorical.length > 0) {
    suggestions.push(`Top 5 ${categorical[0].label} by count`);
  }

  if (numeric.length > 0) {
    suggestions.push(`Which row has the highest ${numeric[0].label}?`);
  }

  if (date.length > 0 && numeric.length > 0) {
    suggestions.push(`${numeric[0].label} trend over time by ${date[0].label}`);
  }

  if (profile?.totalMissingCells > 0) {
    suggestions.push('How many rows have missing values?');
  }

  if (numeric.length >= 2) {
    suggestions.push(`Correlation between ${numeric[0].label} and ${numeric[1].label}`);
  }

  return suggestions.slice(0, 6);
}

// ---------------------------------------------------------------------------
// History (FR-4)
// ---------------------------------------------------------------------------

function _addToHistory(question, sql) {
  // Avoid duplicates
  const exists = _history.some(h => h.question === question);
  if (!exists) {
    _history.unshift({ question, sql });
    if (_history.length > 10) _history.pop();
  }
  _renderHistory();
}

function _renderHistory() {
  const container = document.getElementById('aiQueryHistory');
  if (!container || _history.length === 0) return;

  container.innerHTML = `
    <div class="w-100 mt-1">
      <div class="small text-muted font-mono mb-1" style="font-size:0.7rem;">RECENT</div>
      <div class="d-flex flex-wrap gap-1" id="aiQueryHistoryPills">
        ${_history.slice(0, 5).map(h =>
          `<button class="btn btn-sm btn-outline-secondary history-pill" style="font-size:0.75rem;" title="${_escAttr(h.question)}">${_escHtml(h.question.slice(0, 40))}${h.question.length > 40 ? '…' : ''}</button>`
        ).join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('.history-pill').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      const entry = _history[i];
      if (entry) {
        const input = document.getElementById('aiQueryInput');
        if (input) {
          input.value = entry.question;
          input.focus();
          document.getElementById('aiQuerySubmitBtn')?.removeAttribute('disabled');
        }
        if (!navigator.onLine && entry.sql) {
          _forceExecuteSql(entry.sql, entry.question);
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Export (FR-27)
// ---------------------------------------------------------------------------

function _exportResults(rows, colKeys) {
  if (rows.length === 0) {
    _showToast?.('No results to export.', 'info');
    return;
  }

  // Build CSV manually with formula injection protection (reuse pattern from exportManager)
  const sanitize = val => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    // Prefix formula-injection triggers with apostrophe
    if (/^[=+\-@]/.test(str)) return `'${str}`;
    return str;
  };

  const lines = [
    colKeys.map(k => `"${k.replace(/"/g, '""')}"`).join(','),
    ...rows.map(row => colKeys.map(k => {
      const v = sanitize(row[k]);
      return `"${v.replace(/"/g, '""')}"`;
    }).join(',')),
  ];

  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ai_query_result.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  _showToast?.('Result exported as CSV.', 'success');
}

// ---------------------------------------------------------------------------
// Consent Dialog (Privacy & Schema Review)
// ---------------------------------------------------------------------------

function _showConsentDialog(pendingQuestion) {
  const state = _getState?.();
  const headers = state?.cleanedData?.headers ?? [];
  const profile = state?.profile;
  const rows = state?.cleanedData?.rows ?? [];

  // Build payload preview
  const { payload: previewPayload } = buildSchemaPayload(
    headers,
    profile?.columnProfiles ?? new Map(),
    rows,
  );
  const payloadBytes = estimatePayloadSize(previewPayload);

  // Build column chips for advanced privacy controls
  const colChips = headers.map(h => `
    <label class="consent-col-chip" id="chip_${_escAttr(h.key)}" title="Click to include or exclude ${h.label} from AI context">
      <input class="consent-col-check" type="checkbox" checked data-col-key="${_escAttr(h.key)}">
      <i class="bi bi-check2 text-success chip-check-icon"></i>
      <span class="fw-medium">${_escHtml(h.label)}</span>
      <span class="badge bg-surface text-muted border font-mono" style="font-size:0.62rem;">${h.type}</span>
    </label>
  `).join('');

  // Insert modal into DOM
  const existing = document.getElementById('aiConsentModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'aiConsentModal';
  modal.className = 'modal fade';
  modal.setAttribute('tabindex', '-1');
  modal.setAttribute('aria-labelledby', 'aiConsentModalTitle');
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content consent-modal-content">
        <div class="modal-header border-bottom py-3 px-4 bg-surface">
          <div class="d-flex align-items-center gap-3">
            <div class="consent-header-shield">
              <i class="bi bi-shield-check"></i>
            </div>
            <div>
              <h5 class="modal-title fw-semibold fs-6 mb-0 font-sans" id="aiConsentModalTitle">AI Query &mdash; Privacy &amp; Consent</h5>
              <div class="text-secondary small">Your data stays strictly on your device. Review how AI interacts with your schema.</div>
            </div>
          </div>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>

        <div class="modal-body p-4">
          <!-- Split Privacy Breakdown Cards -->
          <div class="row g-3 mb-3">
            <div class="col-12 col-md-6">
              <div class="consent-card safe h-100 p-3 border">
                <div class="d-flex align-items-center gap-2 mb-2">
                  <div class="consent-icon-circle bg-success-subtle text-success">
                    <i class="bi bi-lock-fill"></i>
                  </div>
                  <div>
                    <span class="badge bg-success-subtle text-success font-mono" style="font-size:0.65rem; letter-spacing:0.04em;">100% PRIVATE</span>
                    <div class="fw-semibold text-main small">Never Leaves Device</div>
                  </div>
                </div>
                <div class="small text-secondary" style="line-height:1.45;">
                  All raw dataset rows, personal numbers, and cell contents stay in your browser memory. No row data is ever sent to Groq or any server.
                </div>
              </div>
            </div>

            <div class="col-12 col-md-6">
              <div class="consent-card shared h-100 p-3 border">
                <div class="d-flex align-items-center gap-2 mb-2">
                  <div class="consent-icon-circle bg-primary-subtle text-primary">
                    <i class="bi bi-cpu-fill"></i>
                  </div>
                  <div>
                    <span class="badge bg-primary-subtle text-primary font-mono" style="font-size:0.65rem; letter-spacing:0.04em;">METADATA ONLY</span>
                    <div class="fw-semibold text-main small">Sent to Groq AI</div>
                  </div>
                </div>
                <div class="small text-secondary" style="line-height:1.45;">
                  Only column headers, data types, and high-level ranges (~${_formatBytes(payloadBytes)}) so AI can translate your question into local SQL.
                </div>
              </div>
            </div>
          </div>

          <!-- Concise Groq Disclaimer Pill Bar -->
          <div class="d-flex align-items-center justify-content-between p-2 px-3 rounded bg-surface-subtle border mb-3 small text-secondary flex-wrap gap-2">
            <div class="d-flex align-items-center gap-2">
              <i class="bi bi-shield-lock text-success"></i>
              <span>SQL executes locally via AlaSQL. Groq only performs English-to-SQL translation.</span>
            </div>
            <div class="d-flex align-items-center gap-2 font-sans" style="font-size:0.75rem;">
              <a href="https://groq.com/privacy-policy" target="_blank" rel="noopener noreferrer" class="text-decoration-none text-accent">Privacy Policy</a>
              <span>&middot;</span>
              <a href="https://groq.com/terms" target="_blank" rel="noopener noreferrer" class="text-decoration-none text-accent">Terms</a>
            </div>
          </div>

          <!-- Advanced Privacy Controls (Collapsible) -->
          <div class="mb-2">
            <div class="consent-advanced-header d-flex align-items-center justify-content-between" id="consentAdvancedToggle">
              <div class="d-flex align-items-center gap-2 small fw-medium text-main">
                <i class="bi bi-sliders2 text-primary"></i>
                <span>Customize Privacy &amp; Exclude Columns</span>
              </div>
              <div class="d-flex align-items-center gap-2">
                <span class="badge bg-surface text-muted border font-mono small" style="font-size:0.68rem;" id="consentExcludedBadge">All ${headers.length} columns active</span>
                <i class="bi bi-chevron-down text-muted transition-transform" id="consentChevron"></i>
              </div>
            </div>

            <div class="consent-advanced-body d-none" id="consentAdvancedBody">
              <!-- Column inclusion/exclusion chips -->
              <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
                <div class="small fw-semibold text-main font-sans">
                  Click column to include / exclude from AI context:
                </div>
                <div class="d-flex gap-2">
                  <button type="button" class="btn btn-link btn-xs text-decoration-none p-0 text-accent font-sans" id="btnSelectAllCols">Select All</button>
                  <span class="text-muted small">&middot;</span>
                  <button type="button" class="btn btn-link btn-xs text-decoration-none p-0 text-muted font-sans" id="btnDeselectAllCols">Deselect All</button>
                </div>
              </div>

              <div class="d-flex flex-wrap gap-2 mb-3" style="max-height: 140px; overflow-y: auto;">
                ${colChips}
              </div>

              <!-- Privacy toggles -->
              <div class="row g-2 mb-3 pt-2 border-top">
                <div class="col-12 col-md-6">
                  <div class="form-check form-switch mb-0">
                    <input class="form-check-input" type="checkbox" id="consentAnonCols">
                    <label class="form-check-label small text-main" for="consentAnonCols">
                      Anonymize column names <span class="text-muted d-block" style="font-size:0.7rem;">Sends col_1, col_2 instead of header text</span>
                    </label>
                  </div>
                </div>
                <div class="col-12 col-md-6">
                  <div class="form-check form-switch mb-0">
                    <input class="form-check-input" type="checkbox" id="consentNoSamples">
                    <label class="form-check-label small text-main" for="consentNoSamples">
                      Omit sample category values <span class="text-muted d-block" style="font-size:0.7rem;">Sends schema types only</span>
                    </label>
                  </div>
                </div>
              </div>

              <!-- Exact Payload Preview -->
              <details>
                <summary class="small text-muted cursor-pointer font-mono" style="font-size:0.74rem;">
                  <i class="bi bi-code-slash me-1"></i>Inspect exact JSON schema sent to Groq (~${_formatBytes(payloadBytes)})
                </summary>
                <pre class="mt-2 p-2 border rounded font-mono ai-query-payload-preview small" style="max-height:160px;overflow:auto;font-size:0.72rem;">${_escHtml(JSON.stringify(previewPayload, null, 2))}</pre>
              </details>
            </div>
          </div>

          <div class="text-center text-muted small mt-3" style="font-size:0.73rem;">
            <i class="bi bi-info-circle me-1"></i>Consent is session-only and resets on page reload. Zero data is stored on external servers.
          </div>
        </div>

        <div class="modal-footer border-top py-3 px-4 bg-surface-subtle d-flex justify-content-between align-items-center">
          <button type="button" class="btn btn-sm btn-outline-secondary px-3" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-sm btn-primary d-flex align-items-center gap-2 px-4 shadow-xs" id="aiConsentProceedBtn">
            <i class="bi bi-check-lg fs-6"></i>
            <span class="fw-medium font-sans">I Understand &mdash; Enable AI Query</span>
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const bsModal = new globalThis.bootstrap.Modal(modal);
  bsModal.show();

  // Wire Advanced Toggle
  const advToggle = modal.querySelector('#consentAdvancedToggle');
  const advBody = modal.querySelector('#consentAdvancedBody');
  const advChevron = modal.querySelector('#consentChevron');
  if (advToggle && advBody && advChevron) {
    advToggle.addEventListener('click', () => {
      const isClosed = advBody.classList.toggle('d-none');
      advToggle.classList.toggle('expanded', !isClosed);
      advChevron.className = isClosed ? 'bi bi-chevron-down text-muted' : 'bi bi-chevron-up text-muted';
    });
  }

  // Update excluded badge count helper
  const updateExcludedBadge = () => {
    const total = headers.length;
    const checks = modal.querySelectorAll('.consent-col-check');
    const checkedCount = Array.from(checks).filter(c => c.checked).length;
    const badge = modal.querySelector('#consentExcludedBadge');
    if (badge) {
      if (checkedCount === total) {
        badge.textContent = `All ${total} columns active`;
      } else {
        badge.textContent = `${checkedCount} of ${total} columns active`;
      }
    }
  };

  // Wire Column Chips
  modal.querySelectorAll('.consent-col-chip').forEach(chip => {
    const check = chip.querySelector('.consent-col-check');
    const icon = chip.querySelector('.chip-check-icon');

    chip.addEventListener('click', (e) => {
      if (e.target !== check) {
        check.checked = !check.checked;
      }
      chip.classList.toggle('excluded', !check.checked);
      if (icon) {
        icon.className = check.checked ? 'bi bi-check2 text-success chip-check-icon' : 'bi bi-x text-muted chip-check-icon';
      }
      updateExcludedBadge();
    });
  });

  // Select / Deselect All
  modal.querySelector('#btnSelectAllCols')?.addEventListener('click', () => {
    modal.querySelectorAll('.consent-col-chip').forEach(chip => {
      const check = chip.querySelector('.consent-col-check');
      const icon = chip.querySelector('.chip-check-icon');
      if (check) check.checked = true;
      chip.classList.remove('excluded');
      if (icon) icon.className = 'bi bi-check2 text-success chip-check-icon';
    });
    updateExcludedBadge();
  });

  modal.querySelector('#btnDeselectAllCols')?.addEventListener('click', () => {
    modal.querySelectorAll('.consent-col-chip').forEach(chip => {
      const check = chip.querySelector('.consent-col-check');
      const icon = chip.querySelector('.chip-check-icon');
      if (check) check.checked = false;
      chip.classList.add('excluded');
      if (icon) icon.className = 'bi bi-x text-muted chip-check-icon';
    });
    updateExcludedBadge();
  });

  // Proceed button
  document.getElementById('aiConsentProceedBtn')?.addEventListener('click', () => {
    // Collect excluded columns
    const excluded = new Set();
    modal.querySelectorAll('.consent-col-check').forEach(cb => {
      if (!cb.checked) excluded.add(cb.getAttribute('data-col-key'));
    });
    setExcludedColumns(excluded);
    setAnonymizeColumns(document.getElementById('consentAnonCols')?.checked ?? false);
    setIncludeSampleValues(!(document.getElementById('consentNoSamples')?.checked ?? false));

    recordConsent();
    bsModal.hide();

    // Proceed with the pending question
    if (pendingQuestion) _executeQuery(pendingQuestion);
  });

  modal.addEventListener('hidden.bs.modal', () => modal.remove());
}

// ---------------------------------------------------------------------------
// Online/Offline listeners & Offline State (FR-29 to FR-32)
// ---------------------------------------------------------------------------

function _setupOnlineOfflineListeners() {
  window.addEventListener('online', () => { _updateOnlineStatus(false); });
  window.addEventListener('offline', () => { _updateOnlineStatus(false); });
}

async function _updateOnlineStatus(isManualRetry = false) {
  const retryBtn = document.getElementById('aiQueryRetryBtn');
  const retryIcon = document.getElementById('aiQueryRetryIcon');

  if (isManualRetry && retryIcon) {
    retryIcon.classList.add('spinner-border', 'spinner-border-sm');
    retryIcon.classList.remove('bi-arrow-clockwise');
  }

  let online = navigator.onLine;

  if (isManualRetry) {
    try {
      await fetch('https://api.groq.com/openai/v1/models', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${getApiKey()}` },
        signal: AbortSignal.timeout(3000),
      });
      online = true;
    } catch {
      if (!navigator.onLine) online = false;
    }
  }

  if (isManualRetry && retryIcon) {
    retryIcon.classList.remove('spinner-border', 'spinner-border-sm');
    retryIcon.classList.add('bi-arrow-clockwise');
  }

  const banner = document.getElementById('aiQueryOfflineBanner');
  if (banner) banner.classList.toggle('d-none', online);

  _refreshBarState();

  const resultsMount = document.getElementById('aiQueryResultsMount');
  if (!online) {
    if (resultsMount && (!resultsMount.children.length || document.getElementById('aiQueryOfflineHero'))) {
      _renderOfflineHero();
    }
    if (isManualRetry) {
      _showToast?.('Still offline. You can use Direct SQL Mode below.', 'info');
    }
  } else {
    if (document.getElementById('aiQueryOfflineHero') && resultsMount) {
      resultsMount.innerHTML = '';
    }
    if (isManualRetry) {
      _showToast?.('Connection active! Natural-language queries are ready.', 'success');
    }
  }
}

/**
 * Renders an informative, interactive offline state card with local SQL scratchpad.
 */
function _renderOfflineHero() {
  const mount = document.getElementById('aiQueryResultsMount');
  if (!mount) return;

  const state = _getState?.();
  const headers = state?.cleanedData?.headers ?? [];

  const sampleQueries = _generateSampleQueries(headers);

  const pillsHtml = sampleQueries.map(sq => `
    <button class="sql-quick-pill mb-1 me-1 text-start" data-sql="${_escAttr(sq.sql)}" title="Run this query offline">
      <i class="bi bi-play-circle text-accent me-1"></i>${_escHtml(sq.label)}
    </button>
  `).join('');

  mount.innerHTML = `
    <div class="ai-query-offline-hero" id="aiQueryOfflineHero">
      <div class="ai-query-offline-hero-header">
        <div class="ai-query-offline-hero-icon">
          <i class="bi bi-hdd-network"></i>
        </div>
        <div>
          <div class="ai-query-offline-hero-title">Client-Side Compute Active · Offline Ready</div>
          <div class="text-muted small">
            Enclave is designed offline-first. All parsing, profiling, cleaning, charting, and SQL queries run locally in your browser.
          </div>
        </div>
      </div>

      <div class="ai-query-offline-feature-grid">
        <div class="ai-query-offline-feature-box">
          <div class="feature-title text-success"><i class="bi bi-shield-check"></i> 100% Private Data</div>
          <div class="feature-desc">Your rows never leave your computer. Compute stays strictly inside your browser memory.</div>
        </div>
        <div class="ai-query-offline-feature-box">
          <div class="feature-title text-primary"><i class="bi bi-lightning-charge"></i> Local AlaSQL Engine</div>
          <div class="feature-desc">Run full SQL with GROUP BY, aggregations, and sorting at sub-second speed with zero internet.</div>
        </div>
        <div class="ai-query-offline-feature-box">
          <div class="feature-title text-warning"><i class="bi bi-wifi-off"></i> AI Translation Paused</div>
          <div class="feature-desc">Natural-language translation needs internet to reach Groq. Reconnect or run SQL directly below.</div>
        </div>
      </div>

      <!-- Direct SQL Scratchpad -->
      <div class="ai-query-sql-scratchpad">
        <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
          <div class="fw-semibold small font-mono">
            <i class="bi bi-terminal text-accent me-1"></i>Direct SQL Editor (Runs 100% Offline)
          </div>
          <button class="btn btn-sm btn-primary px-3" id="aiQueryOfflineRunSqlBtn">
            <i class="bi bi-play-fill me-1"></i>Run SQL
          </button>
        </div>

        <div class="mb-2">
          <textarea
            class="form-control form-control-sm font-mono ai-query-sql-editor"
            id="aiQueryOfflineSqlInput"
            rows="3"
            placeholder="SELECT * FROM data LIMIT 10"
            spellcheck="false"
          >${_escHtml(sampleQueries[0]?.sql || 'SELECT * FROM data LIMIT 10')}</textarea>
        </div>

        <div>
          <div class="small text-muted font-mono mb-1" style="font-size:0.72rem;">Click a quick query template to run it on your dataset:</div>
          <div class="d-flex flex-wrap">${pillsHtml}</div>
        </div>
      </div>
    </div>
  `;

  // Wire up template pills
  mount.querySelectorAll('.sql-quick-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const sql = btn.getAttribute('data-sql');
      const textarea = document.getElementById('aiQueryOfflineSqlInput');
      if (textarea && sql) {
        textarea.value = sql;
        textarea.focus();
        _forceExecuteSql(sql, btn.textContent.trim());
      }
    });
  });

  // Wire up Run button
  document.getElementById('aiQueryOfflineRunSqlBtn')?.addEventListener('click', () => {
    const textarea = document.getElementById('aiQueryOfflineSqlInput');
    const sql = textarea?.value?.trim();
    if (sql) {
      _forceExecuteSql(sql, 'Offline Direct SQL');
    }
  });
}

/**
 * Generates sample SQL queries matched to dataset columns.
 * @param {Array<{key:string,label:string,type:string}>} headers
 * @returns {Array<{label:string, sql:string}>}
 */
function _generateSampleQueries(headers) {
  const queries = [];
  const numeric = headers.filter(h => h.type === 'numeric');
  const categorical = headers.filter(h => h.type === 'categorical');
  const date = headers.filter(h => h.type === 'date');

  if (categorical.length > 0 && numeric.length > 0) {
    queries.push({
      label: `Total ${numeric[0].label} by ${categorical[0].label}`,
      sql: `SELECT ${categorical[0].key}, SUM(${numeric[0].key}) AS total_${numeric[0].key} FROM data GROUP BY ${categorical[0].key} ORDER BY total_${numeric[0].key} DESC`,
    });
  }

  if (numeric.length > 0) {
    queries.push({
      label: `Top 10 highest ${numeric[0].label}`,
      sql: `SELECT * FROM data ORDER BY ${numeric[0].key} DESC LIMIT 10`,
    });
  }

  if (categorical.length > 0) {
    queries.push({
      label: `Row count by ${categorical[0].label}`,
      sql: `SELECT ${categorical[0].key}, COUNT(*) AS count FROM data GROUP BY ${categorical[0].key} ORDER BY count DESC`,
    });
  }

  if (date.length > 0 && numeric.length > 0) {
    queries.push({
      label: `${numeric[0].label} by ${date[0].label}`,
      sql: `SELECT ${date[0].key}, SUM(${numeric[0].key}) AS total FROM data GROUP BY ${date[0].key} ORDER BY ${date[0].key} ASC`,
    });
  }

  if (queries.length === 0) {
    queries.push({
      label: 'Preview first 10 rows',
      sql: 'SELECT * FROM data LIMIT 10',
    });
  }

  return queries;
}

/**
 * Heuristically translates a standard question suggestion to SQL offline.
 * @param {string} question
 * @param {Array<{key:string,label:string,type:string}>} headers
 * @returns {string|null}
 */
function _suggestionToSql(question, headers) {
  const numeric = headers.filter(h => h.type === 'numeric');
  const categorical = headers.filter(h => h.type === 'categorical');
  const date = headers.filter(h => h.type === 'date');
  const qLower = question.toLowerCase();

  if (qLower.includes('total') && qLower.includes('by') && numeric.length > 0 && categorical.length > 0) {
    const matchedNum = numeric.find(n => qLower.includes(n.label.toLowerCase())) || numeric[0];
    const matchedCat = categorical.find(c => qLower.includes(c.label.toLowerCase())) || categorical[0];
    return `SELECT ${matchedCat.key}, SUM(${matchedNum.key}) AS total_${matchedNum.key} FROM data GROUP BY ${matchedCat.key} ORDER BY total_${matchedNum.key} DESC`;
  }

  if (qLower.includes('average') && qLower.includes('by') && numeric.length > 0 && categorical.length > 0) {
    const matchedNum = numeric.find(n => qLower.includes(n.label.toLowerCase())) || (numeric[1] || numeric[0]);
    const matchedCat = categorical.find(c => qLower.includes(c.label.toLowerCase())) || categorical[0];
    return `SELECT ${matchedCat.key}, ROUND(AVG(${matchedNum.key}), 2) AS avg_${matchedNum.key} FROM data GROUP BY ${matchedCat.key} ORDER BY avg_${matchedNum.key} DESC`;
  }

  if (qLower.includes('top') && qLower.includes('count') && categorical.length > 0) {
    const matchedCat = categorical.find(c => qLower.includes(c.label.toLowerCase())) || categorical[0];
    return `SELECT ${matchedCat.key}, COUNT(*) AS count FROM data GROUP BY ${matchedCat.key} ORDER BY count DESC LIMIT 5`;
  }

  if (qLower.includes('highest') && numeric.length > 0) {
    const matchedNum = numeric.find(n => qLower.includes(n.label.toLowerCase())) || numeric[0];
    return `SELECT * FROM data ORDER BY ${matchedNum.key} DESC LIMIT 1`;
  }

  if (qLower.includes('trend') && date.length > 0 && numeric.length > 0) {
    const matchedNum = numeric.find(n => qLower.includes(n.label.toLowerCase())) || numeric[0];
    const matchedDate = date.find(d => qLower.includes(d.label.toLowerCase())) || date[0];
    return `SELECT ${matchedDate.key}, SUM(${matchedNum.key}) AS total_${matchedNum.key} FROM data GROUP BY ${matchedDate.key} ORDER BY ${matchedDate.key} ASC`;
  }

  if (qLower.includes('missing')) {
    return `SELECT COUNT(*) AS total_rows FROM data`;
  }

  if (numeric.length > 0) {
    return `SELECT * FROM data ORDER BY ${numeric[0].key} DESC LIMIT 10`;
  }

  return 'SELECT * FROM data LIMIT 10';
}

// ---------------------------------------------------------------------------
// Keyboard shortcut (FR-5: '/' focuses AI Query question bar)
// ---------------------------------------------------------------------------

function _setupKeyboardShortcut() {
  window.addEventListener('keydown', e => {
    if (
      e.key === '/' &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
    ) {
      e.preventDefault();
      if (window.location.hash !== '#ai-query') {
        window.location.hash = '#ai-query';
      }
      setTimeout(() => {
        const input = document.getElementById('aiQueryInput');
        input?.focus();
        input?.select();
      }, 80);
    }
  });
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** HTML-escapes a string for safe DOM insertion. */
function _escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Attribute-safe escape. */
function _escAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Formats byte count for display. */
function _formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

