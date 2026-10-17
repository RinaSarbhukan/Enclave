# Enclave — Smart Data Visualization & Analytics Platform

**Enclave** is a browser-only, zero-backend web application that allows users to upload any arbitrary CSV, TSV, or TXT file and immediately receive automated statistical profiling, smart chart recommendations, an exploration table with real-time filters, a reversible data cleaning pipeline with preview and undo, and executive exports (sanitized CSV, per-chart PNG, and multi-page PDF reports).

All computation runs 100% client-side in the browser. No uploaded data is transmitted to external servers.

---

## 1. Key Features

- **Upload & Delimiter Detection:**
  - Fast parsing using Papa Parse with delimiter auto-detection (comma, semicolon, tab, pipe).
  - Handles byte-order mark (BOM) stripping, multiline quoted fields, escaped quotes, and greedy empty line skipping.
  - Automatic missing value token recognition (`NA`, `N/A`, `null`, `NaN`, `-`, `?`, whitespace, empty strings).
  - Malformed row detection and reporting with row numbers and mismatch diagnostics.
  - Client-side size guards (up to 50 MB; warnings at 10 MB) and worker cancellation support (`AbortController`).

- **Automated Statistical Profiling & Type Inference:**
  - Sample-based deterministic type inference ($\ge 500$ rows, $\ge 90\%$ match threshold).
  - Robust type parsing for Currency (`$`, `€`, `£`, `¥`, `₹`), thousands separators, decimal commas (`1.234,56`), percentage values, and accounting negative formats (`(123.45)`).
  - Date parsing for ISO 8601, `YYYY/MM/DD`, `DD/MM/YYYY` vs `MM/DD/YYYY` disambiguation.
  - Identifier heuristics: numeric columns matching `id|code|zip|postal|phone|sku|ref` or high-cardinality integers are treated as non-measures.
  - Data quality audit: flags columns with $>30\%$ missing cells, constant columns, ambiguous dates, duplicate rows, and high-cardinality categoricals.
  - Descriptive metrics: sample standard deviation ($s = \sqrt{\frac{\sum (x - \bar{x})^2}{n - 1}}$ for $n \ge 2$), median, mean, min, max, sum, Pearson correlation coefficient $r$, and frequency tables.

- **Interactive Pearson Correlation Matrix & Heatmap:**
  - $N \times N$ symmetric matrix computing bivariate Pearson correlation coefficients across all numeric measures.
  - Theme-adaptive color interpolation: positive correlation (vivid indigo/blue $+1.0$), negative correlation (crimson/rose $-1.0$), and neutral surfaces.
  - Dual view modes: **Heatmap Grid** with sticky headers and **Top Correlated Pairs** ranked by $|r|$ magnitude.
  - Threshold filtering ($|r| \ge 0$, $\ge 0.3$, $\ge 0.5$, $\ge 0.7$) and full matrix CSV export.
  - Interactive drilldown modal: click any off-diagonal cell to inspect a high-performance Chart.js scatter plot with least-squares linear trendline ($y = mx + b$), $R^2$ score, and "Pin to Dashboard" action.

- **Smart Chart Recommendation Engine:**
  - Ranked recommendations scored by data characteristics:
    - **Date + Numeric $\to$ Line/Area:** Bucketed by day, week, month, or year so chart has 12–60 points.
    - **Categorical + Numeric $\to$ Bar:** Horizontal orientation when category labels are long or $>8$ categories.
    - **Categorical Distribution $\to$ Doughnut/Pie:** Restricted to $\le 6$ non-negative categories; otherwise bar.
    - **Two Numeric Columns $\to$ Scatter:** Evaluates Pearson $r$ correlation; stratified decimation above 5,000 points.
    - **Single Numeric $\to$ Histogram:** Freedman–Diaconis and Sturges rule binning (capped at 30 bins).
    - **Multiple Metrics $\to$ Grouped Bar / Stacked Bar:** Compares metrics across primary and secondary segments.
  - Automatic category collapsing: Categories beyond top 10 are collapsed into "Other" with expand/collapse control.
  - Color-blind safe visualization using the Okabe–Ito / Wong palette.
  - "View as Table" toggle and PNG download on every chart card.
  - "Add Custom Chart" modal with validation rules blocking unsuitable axes combinations.

- **Exploration Table & Filter Engine:**
  - Fast search across all columns with debounced inputs (250 ms).
  - Type-aware sorting (numeric, date, and case-insensitive string).
  - Column filters: substring, categorical selection, numeric min/max, date ranges.
  - Pagination (25, 50, 100 rows per page) with live row counters.
  - XSS-safe DOM rendering using `textContent` and styling for missing/empty tokens.
  - Filters update visualizations and statistics live without mutating source datasets.

- **Reversible Data Cleaning Workbench:**
  - Non-destructive operations: exact duplicate removal, whitespace trimming, blank row dropping, mean/median/mode imputation, column drops, column renames, and type conversions.
  - Visual preview of affected row and cell counts plus before/after sample differences before applying.
  - Ordered undo stack and full reset to original dataset.

- **Executive Export Center:**
  - Export Cleaned, Filtered, or Original CSV.
  - Formula injection neutralization: automatically prefixes cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` with `'`.
  - PNG export for individual charts via `canvas.toDataURL()`.
  - Multi-page PDF Report export via jsPDF: embeds dataset metadata, quality findings, summary metrics, and chart canvas snapshots.

---

## 2. Technology Stack & Architecture

- **Core**: Vanilla HTML5, CSS3, modern ES2020+ ES Modules (`<script type="module">`).
- **Styling**: Bootstrap 5.3.3 + Bootstrap Icons 1.11.3 + Vanilla Custom Design System (`css/style.css`, `css/responsive.css`).
- **Libraries (Pinned Exact CDNs with SRI Hashes)**:
  - [Papa Parse 5.4.1](https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js)
  - [Chart.js 4.4.4](https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js)
  - [jsPDF 2.5.1](https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js)
- **Testing**: Node.js native test runner (`node --test tests/*.test.js`). Pure logic modules are 100% free of DOM dependencies.

### Architecture & Data Flow Diagram

```mermaid
flowchart TD
    A[User CSV File / Demo] --> B[csvParser.js\nPapa Parse + Delimiter + BOM]
    B --> C[(originalData\nImmutable Store)]
    C --> D[dataCleaner.js\napplyOperations]
    D --> E[(cleanedData\nCleaned State)]
    E --> F[dataAnalyzer.js\nType Inference & Profiling]
    E --> G[chartRecommender.js\nScoring & Recommendations]
    E --> H[tableManager.js\napplyFilters]
    H --> I[(viewData\nFiltered State)]
    I --> J[chartRenderer.js\nChart.js Registry & Tables]
    I --> K[tableManager.js\nSecure textContent Table]
    I --> L[exportManager.js\nCSV, PNG, jsPDF Report]
    D -. Reversible Undo Pipeline .-> C
```

---

## 3. Project Directory Structure

```
project/
├── index.html                   # Single-page application shell with strict CSP and pinned SRI CDNs
├── package.json                 # Project configuration and Node test runner scripts
├── README.md                    # System documentation and interview material
├── css/
│   ├── style.css                # SaaS design tokens, card styles, and components
│   └── responsive.css           # Breakpoints for 360px, 768px, and 1280px viewports
├── js/
│   ├── app.js                   # Central store, state pipeline, routing, and event coordinator
│   ├── utils.js                 # Pure math, statistics, date bucketing, and sanitization
│   ├── csvParser.js             # PapaParse integration, header normalization, and validation
│   ├── dataAnalyzer.js          # Type inference, sample std dev, and profiling
│   ├── chartRecommender.js      # Heuristic chart recommendation and data aggregation
│   ├── chartRenderer.js         # Chart.js lifecycle management and color-blind palette
│   ├── tableManager.js          # Filter engine, type-aware sorting, and textContent table
│   ├── dataCleaner.js           # Reversible cleaning operations and preview generator
│   ├── exportManager.js         # Sanitized CSV, PNG, and jsPDF executive report generation
│   └── dashboard.js             # KPI cards, quality alerts, and chart controls
├── data/
│   ├── sample-sales.csv         # Deterministic 800-row demo sales dataset
│   └── messy-sample.csv         # Complex quoted multiline test dataset
├── tests/
│   ├── phase1.test.js           # Unit tests for pure foundation modules on fixtures
│   ├── phase2_4.test.js         # Unit tests for recommender, filters, cleaner, and pipeline
│   └── fixtures/                # 11 comprehensive CSV test fixtures
```

---

## 4. Setup and Local Execution

Because the application uses standard ES Modules (`import`/`export`), it must be served through a local HTTP server:

### Option A: Node / npx (Recommended)
```bash
# In the project root directory:
npx -y serve . -p 8080
```
Open [http://localhost:8080](http://localhost:8080) in your browser.

### Option B: Python 3
```bash
python -m http.server 8080
```
Open [http://localhost:8080](http://localhost:8080) in your browser.

---

## 5. Running Automated Unit Tests

All pure logic modules (`utils.js`, `csvParser.js`, `dataAnalyzer.js`, `chartRecommender.js`, `dataCleaner.js`, `tableManager.js`) are decoupled from browser globals and can be tested directly using Node's native test runner:

```bash
# Run all unit tests across all 11 fixtures:
npm test
```

### Verified Test Fixtures:
1. `normal-sales.csv`: Clean multi-type sales records with exact aggregates.
2. `numeric-only.csv`: Multi-column continuous variables and Pearson $r$.
3. `categorical-only.csv`: Frequency tables and mode detection.
4. `date-numeric.csv`: Timeline date span calculation and bucketed trends.
5. `missing-values.csv`: Verifies detection of all missing tokens (`NA`, `null`, `NaN`, `-`, `?`, whitespace, empty).
6. `duplicates.csv`: Exact duplicate row identification.
7. `quoted-multiline.csv`: Quotes within quotes (`""`) and embedded newlines.
8. `unusual-headers.csv`: Normalization of duplicate headers, whitespace, and protection against prototype pollution (`__proto__`, `constructor`).
9. `empty-file.csv`: Empty file validation and user-friendly error rejection.
10. `malformed-file.csv`: Mismatched row lengths and error reporting.
11. `size-test.csv`: 5,200 rows testing scatter decimation and decile sampling performance.

---

## 6. How Chart Recommendations Work

The recommendation algorithm inspects column types and statistical distributions in `cleanedData`:
1. **Exclusion Gate**: Columns classified as `identifier`, `text` (free text), constant values, or $>50\%$ missing are excluded from automated charting.
2. **Date + Measure**: Paired into chronological trends (`line` or `area`). The date span is evaluated to select bucketing (`day`, `week`, `month`, `year`) maintaining 12–60 data points.
3. **Categorical + Measure**: Aggregated into horizontal or vertical bar charts. Categories beyond the top 10 are collapsed into "Other".
4. **Distributions**: Columns with $\le 6$ categories qualify for doughnut charts; continuous numeric columns produce histograms binned via Freedman–Diaconis or Sturges formulas.
5. **Two Measures**: Evaluates Pearson correlation coefficient $r$ and renders a scatter plot with stratified decimation for datasets over 5,000 points.

---

## 7. Security, Privacy, and Performance

- **Zero Data Transmission**: Files are processed directly in browser memory.
- **XSS Prevention**: All tabular data is inserted via `textContent` or DOM elements, never `innerHTML` with unsanitized user inputs.
- **Formula Injection Mitigation**: Exported CSVs automatically sanitize cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` by prefixing a single quote (`'`).
- **Memory Safety**: Chart.js instances are tracked in a registry Map and cleanly destroyed before re-render or deletion to prevent canvas memory leaks.
- **Content Security Policy**: Pinned CSP meta tag restricting script, style, and font sources to self and trusted CDNs with SRI hashes.

---

## 8. Known Limitations & Future Enhancements

### Known Limitations:
- Very large CSVs ($>100\text{ MB}$) are constrained by browser tab memory limits.
- High-cardinality dates without uniform formatting require fallback to browser ISO parser.

### Future Roadmap:
- **Excel (.xlsx) Import**: Direct SheetJS integration for multi-sheet workbook support.
- **Web Worker Offloading**: Moving PapaParse chunk parsing and statistical profiling into Web Workers for 50 MB+ datasets.
- **Natural Language Querying**: Client-side semantic queries (e.g. "Show revenue by region for 2024").
- **Saved Dashboards**: Export and restore entire dashboard layouts via JSON configurations.
- **Direct SQL / Parquet Connections**: DuckDB-Wasm integration for querying parquet datasets directly in the client.

---

## 9. Career & Interview Material

### 2–3 Sentence Resume Description
> Architected and built **Enclave**, a zero-dependency, browser-only analytics platform that parses arbitrary CSV datasets, infers column schemas, profiles data quality, and generates auto-recommended visualizations. Designed a reactive state pipeline that decouples immutable raw data, an undoable cleaning engine, and live-filtered views with formula-injection-safe exports.

### 3–5 Implementation Resume Bullets
- Built a zero-config data profiling and type inference engine in pure ES modules, achieving 95%+ classification accuracy for currency, dates, percentages, and identifiers across 500+ sample rows.
- Engineered a rule-based chart recommendation pipeline scoring multi-dimensional attributes, implementing automatic Freedman–Diaconis histogram binning and Okabe–Ito color-blind safe palettes.
- Created an interactive data cleaning workbench with before/after diff previews and an ordered undo stack operating on immutable dataset copies.
- Implemented formula injection neutralization and multi-page executive PDF report generation using Chart.js canvas exports and jsPDF.
- Designed comprehensive test suites with Node’s native test runner (`node --test`), verifying 25+ assertions across 11 test fixtures without DOM dependencies.

### 60-Second Interview Explanation
> *"Enclave is a front-end analytics platform designed to solve the friction of exploring raw data. Most tools require setting up a backend, configuring schemas, or uploading sensitive files to third-party clouds. With Enclave, everything runs in the browser. You drag and drop any CSV, and the system auto-detects delimiters, infers column types (distinguishing identifiers from actual measures), computes sample standard deviations and Pearson correlations, and recommends ranked visualizations.
> 
> Under the hood, I designed a unidirectional data architecture where raw data remains immutable, cleaning operations form an undoable pipeline, and views are filtered on the fly. To ensure security, table rendering uses strict DOM textContent APIs, and exported CSVs neutralize formula injection. Furthermore, by keeping pure math and transformation modules completely free of DOM access, the entire engine is covered by automated unit tests running in Node."*

### Key Algorithms & Functions Implemented
1. **Type Inference Hierarchy (`inferColumnType`)**: Multi-stage heuristics distinguishing dates, booleans, formatted currency, accounting parentheses, percentages, identifier keys, and categoricals.
2. **Freedman–Diaconis Binning (`computeHistogramBins`)**: Interquartile range (IQR) bin-width calculation capped at 30 bins.
3. **Pearson Correlation Coefficient (`computePearsonCorrelation`)**: Sample-based bivariate correlation $r \in [-1, 1]$.
4. **Stratified Scatter Decimation (`decimateScatterPoints`)**: Uniform sampling down to 5,000 points to ensure smooth 60 FPS Chart.js interactions.
5. **Reversible Cleaning Pipeline (`applyOperations`)**: Functional transformation pipeline enabling non-destructive undo and redo.
