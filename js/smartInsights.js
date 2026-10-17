/**
 * CSV Insight - Automated Smart Insights & Executive Storytelling Engine
 * Performs client-side statistical profiling, driver analysis, Pareto 80/20 detection,
 * anomaly radar, and plain-English executive narrative generation.
 */

import { parseNumber, parseDate, isMissingValue, computeNumericStats, computeBoxPlotStats, computePearsonCorrelation } from './utils.js';

/**
 * @typedef {Object} InsightItem
 * @property {string} id
 * @property {'driver'|'pareto'|'risk'|'anomaly'|'correlation'|'velocity'} type
 * @property {string} icon - Bootstrap icon class
 * @property {string} badge - Human-friendly category pill
 * @property {string} badgeClass - CSS modifier class
 * @property {string} title - High-level headline
 * @property {string} narrative - Plain-English explanation
 * @property {string} recommendation - Prescriptive action recommendation
 * @property {object} [data] - Statistical metadata for drilldown
 */

/**
 * Formats a numeric value nicely for human reading (e.g. $14.2k, 1.2M, or 2 decimals).
 * @param {number} val
 * @param {string} [colName='']
 * @returns {string}
 */
export function formatMetricValue(val, colName = '') {
  if (typeof val !== 'number' || !Number.isFinite(val)) return '0';
  const isCurrency = /(sales|revenue|profit|price|cost|amount|budget|income|spend)/i.test(colName);
  const prefix = isCurrency ? '$' : '';
  const abs = Math.abs(val);

  let formatted = '';
  if (abs >= 1_000_000) {
    formatted = `${(val / 1_000_000).toFixed(1)}M`;
  } else if (abs >= 10_000) {
    formatted = `${(val / 1_000).toFixed(1)}k`;
  } else if (Number.isInteger(val)) {
    formatted = val.toLocaleString();
  } else {
    formatted = val.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  }

  if (val < 0 && prefix) {
    return `-${prefix}${formatted.replace('-', '')}`;
  }
  return `${prefix}${formatted}`;
}

/**
 * Analyzes categorical columns against key metrics to find primary drivers and volume leaders.
 * @param {Array<Map<string, any>>} rows
 * @param {Array<{ key: string, label: string }>} categoricalCols
 * @param {Array<{ key: string, label: string }>} numericCols
 * @returns {InsightItem[]}
 */
export function analyzeDominanceAndDrivers(rows, categoricalCols, numericCols) {
  const insights = [];
  if (rows.length < 2 || categoricalCols.length === 0 || numericCols.length === 0) return insights;

  // Pick primary metric (prioritize Sales, Revenue, Profit, Amount, or fallback to first numeric)
  const primaryMetric = numericCols.find(c => /(sales|revenue|profit|amount|spend)/i.test(c.label)) || numericCols[0];

  // Evaluate each categorical column (limit to top 3 dimensions)
  for (const catCol of categoricalCols.slice(0, 3)) {
    const groupTotals = new Map();
    let totalMetric = 0;

    for (const r of rows) {
      const catVal = String(r.get(catCol.key) || 'Missing').trim();
      let num = r.get(primaryMetric.key);
      if (typeof num !== 'number') num = parseNumber(num);
      if (typeof num !== 'number' || !Number.isFinite(num)) continue;

      groupTotals.set(catVal, (groupTotals.get(catVal) || 0) + num);
      totalMetric += num;
    }

    if (totalMetric <= 0 || groupTotals.size < 2) continue;

    const sortedGroups = Array.from(groupTotals.entries()).sort((a, b) => b[1] - a[1]);
    const [leaderName, leaderVal] = sortedGroups[0];
    const leaderPct = (leaderVal / totalMetric) * 100;

    // Leader generates a significant portion of volume (> 28%)
    if (leaderPct >= 28) {
      const secondPlace = sortedGroups[1];
      const secondName = secondPlace ? secondPlace[0] : '';
      const secondVal = secondPlace ? secondPlace[1] : 0;
      const secondPct = secondPlace ? (secondVal / totalMetric) * 100 : 0;

      insights.push({
        id: `driver_${catCol.key}_${primaryMetric.key}`,
        type: 'driver',
        icon: 'bi-trophy',
        badge: 'Primary Driver',
        badgeClass: 'badge-driver',
        title: `"${leaderName}" accounts for ${leaderPct.toFixed(1)}% of total ${primaryMetric.label}`,
        narrative: `"${leaderName}" is the primary driver of ${primaryMetric.label}, generating ${formatMetricValue(leaderVal, primaryMetric.label)} of ${formatMetricValue(totalMetric, primaryMetric.label)} overall. It outpaces #2 "${secondName}" (${secondPct.toFixed(1)}%, ${formatMetricValue(secondVal, primaryMetric.label)}) by ${(leaderVal / (secondVal || 1)).toFixed(1)}×.`,
        recommendation: `Prioritize operational bandwidth, supply inventory, and key accounts in "${leaderName}" to protect primary revenue stream.`,
        data: { catCol: catCol.key, leaderName, leaderPct, totalMetric }
      });
      break; // Pick the best driver
    }
  }

  return insights;
}

/**
 * Analyzes Pareto concentration (80/20 distribution rule).
 * @param {Array<Map<string, any>>} rows
 * @param {Array<{ key: string, label: string }>} categoricalCols
 * @param {Array<{ key: string, label: string }>} numericCols
 * @returns {InsightItem[]}
 */
export function analyzeParetoConcentration(rows, categoricalCols, numericCols) {
  const insights = [];
  if (rows.length < 5 || categoricalCols.length === 0 || numericCols.length === 0) return insights;

  const targetMetric = numericCols.find(c => /(sales|revenue|profit|amount|quantity)/i.test(c.label)) || numericCols[0];

  for (const catCol of categoricalCols) {
    const groupTotals = new Map();
    let totalSum = 0;

    for (const r of rows) {
      const catVal = String(r.get(catCol.key) || 'Missing').trim();
      let num = r.get(targetMetric.key);
      if (typeof num !== 'number') num = parseNumber(num);
      if (typeof num !== 'number' || !Number.isFinite(num)) continue;

      groupTotals.set(catVal, (groupTotals.get(catVal) || 0) + num);
      totalSum += num;
    }

    const uniqueCount = groupTotals.size;
    if (uniqueCount < 4 || totalSum <= 0) continue;

    const sortedGroups = Array.from(groupTotals.entries()).sort((a, b) => b[1] - a[1]);

    let runningSum = 0;
    let itemsToEighty = 0;
    for (let i = 0; i < sortedGroups.length; i++) {
      runningSum += sortedGroups[i][1];
      itemsToEighty = i + 1;
      if (runningSum / totalSum >= 0.75) break;
    }

    const entityRatio = itemsToEighty / uniqueCount;
    const actualSharePct = (runningSum / totalSum) * 100;

    // True concentration: <= 35% of entities account for >= 75% of volume
    if (entityRatio <= 0.35 && uniqueCount >= 5) {
      const topNames = sortedGroups.slice(0, Math.min(3, itemsToEighty)).map(g => `"${g[0]}"`).join(', ');

      insights.push({
        id: `pareto_${catCol.key}`,
        type: 'pareto',
        icon: 'bi-pie-chart',
        badge: 'Pareto 80/20 Rule',
        badgeClass: 'badge-pareto',
        title: `High Concentration: Top ${itemsToEighty} ${catCol.label}s drive ${actualSharePct.toFixed(0)}% of volume`,
        narrative: `A classic Pareto distribution was detected: just ${itemsToEighty} of ${uniqueCount} ${catCol.label}s (${(entityRatio * 100).toFixed(0)}%) generate ${actualSharePct.toFixed(1)}% of all ${targetMetric.label}. Key contributors include ${topNames}.`,
        recommendation: `Heavy concentration creates single-point dependency. Develop secondary ${catCol.label} segments to de-risk aggregate performance.`,
        data: { catCol: catCol.key, itemsToEighty, uniqueCount, actualSharePct }
      });
      break;
    }
  }

  return insights;
}

/**
 * Scans for negative metrics, margin bleed, or significant underperformance.
 * @param {Array<Map<string, any>>} rows
 * @param {Array<{ key: string, label: string }>} categoricalCols
 * @param {Array<{ key: string, label: string }>} numericCols
 * @returns {InsightItem[]}
 */
export function analyzeMarginAndPerformanceRisks(rows, categoricalCols, numericCols) {
  const insights = [];
  if (rows.length < 5) return insights;

  // 1. Check for negative profit or margin
  const profitCol = numericCols.find(c => /(profit|margin|net|gain)/i.test(c.label));
  const salesCol = numericCols.find(c => /(sales|revenue|amount)/i.test(c.label));
  const discountCol = numericCols.find(c => /(discount|rebate|promo)/i.test(c.label));

  if (profitCol && categoricalCols.length > 0) {
    for (const catCol of categoricalCols.slice(0, 3)) {
      const catStats = new Map();

      for (const r of rows) {
        const catVal = String(r.get(catCol.key) || 'Missing').trim();
        let p = r.get(profitCol.key);
        if (typeof p !== 'number') p = parseNumber(p);
        if (typeof p !== 'number' || !Number.isFinite(p)) continue;

        let s = salesCol ? r.get(salesCol.key) : 0;
        if (typeof s !== 'number') s = parseNumber(s);
        if (typeof s !== 'number' || !Number.isFinite(s)) s = 0;

        let d = discountCol ? r.get(discountCol.key) : 0;
        if (typeof d !== 'number') d = parseNumber(d);
        if (typeof d !== 'number' || !Number.isFinite(d)) d = 0;

        if (!catStats.has(catVal)) catStats.set(catVal, { profit: 0, sales: 0, discountSum: 0, count: 0 });
        const entry = catStats.get(catVal);
        entry.profit += p;
        entry.sales += s;
        entry.discountSum += d;
        entry.count += 1;
      }

      // Check if any significant group has negative net profit
      for (const [groupName, stats] of catStats.entries()) {
        if (stats.count >= 3 && stats.profit < -10) {
          const avgDisc = stats.count > 0 ? (stats.discountSum / stats.count) : 0;
          const discText = discountCol && avgDisc > 0 ? ` (average ${discountCol.label}: ${(avgDisc * (avgDisc <= 1 ? 100 : 1)).toFixed(1)}%)` : '';

          insights.push({
            id: `risk_neg_profit_${catCol.key}_${groupName}`,
            type: 'risk',
            icon: 'bi-exclamation-triangle',
            badge: 'Red Flag Alert',
            badgeClass: 'badge-risk',
            title: `Net Loss in "${groupName}" (${formatMetricValue(stats.profit, profitCol.label)})`,
            narrative: `The "${groupName}" ${catCol.label} generated a cumulative net deficit of ${formatMetricValue(stats.profit, profitCol.label)} across ${stats.count} transactions${discText}, eroding net margins despite positive gross sales.`,
            recommendation: `Conduct an immediate pricing and contract audit on "${groupName}" to cap discounts and halt margin bleed.`,
            data: { catCol: catCol.key, groupName, profit: stats.profit }
          });
          break;
        }
      }
      if (insights.length > 0) break;
    }
  }

  return insights;
}

/**
 * Statistical Outlier Radar: Detects extreme anomalies across numeric metrics using Tukey IQR.
 * @param {Array<Map<string, any>>} rows
 * @param {Array<{ key: string, label: string }>} numericCols
 * @returns {InsightItem[]}
 */
export function analyzeStatisticalAnomalies(rows, numericCols) {
  const insights = [];
  if (rows.length < 8 || numericCols.length === 0) return insights;

  for (const numCol of numericCols) {
    const rawVals = [];
    for (const r of rows) {
      let v = r.get(numCol.key);
      if (typeof v !== 'number') v = parseNumber(v);
      if (typeof v === 'number' && Number.isFinite(v)) rawVals.push(v);
    }

    if (rawVals.length < 8) continue;
    const boxStats = computeBoxPlotStats(rawVals);
    if (!boxStats || boxStats.iqr <= 0) continue;

    // Check for extreme outliers (> Q3 + 2.5 * IQR)
    const extremeThreshold = boxStats.q3 + 2.5 * boxStats.iqr;
    const extremeOutliers = rawVals.filter(v => v > extremeThreshold);

    if (extremeOutliers.length >= 1 && extremeOutliers.length <= Math.max(8, rawVals.length * 0.05)) {
      const maxVal = Math.max(...extremeOutliers);
      const ratio = boxStats.median > 0 ? (maxVal / boxStats.median).toFixed(1) : 'significantly';

      insights.push({
        id: `anomaly_${numCol.key}`,
        type: 'anomaly',
        icon: 'bi-shield-exclamation',
        badge: 'Statistical Anomaly',
        badgeClass: 'badge-anomaly',
        title: `${extremeOutliers.length} extreme outlier${extremeOutliers.length === 1 ? '' : 's'} in ${numCol.label}`,
        narrative: `${extremeOutliers.length} record${extremeOutliers.length === 1 ? '' : 's'} exceeded the statistical upper threshold (> ${formatMetricValue(extremeThreshold, numCol.label)}). The peak transaction reached ${formatMetricValue(maxVal, numCol.label)} (${ratio}× the median of ${formatMetricValue(boxStats.median, numCol.label)}).`,
        recommendation: `Review flagged outlier rows in the Data Table to verify whether these are VIP institutional transactions or clerical entry errors.`,
        data: { numCol: numCol.key, count: extremeOutliers.length, maxVal, threshold: extremeThreshold }
      });
      break; // One strong anomaly is sufficient
    }
  }

  return insights;
}

/**
 * Computes bivariate Pearson correlation drivers and inverse trade-offs.
 * @param {Array<Map<string, any>>} rows
 * @param {Array<{ key: string, label: string }>} numericCols
 * @returns {InsightItem[]}
 */
export function analyzeCorrelationsAndDrivers(rows, numericCols) {
  const insights = [];
  if (rows.length < 8 || numericCols.length < 2) return insights;

  // Extract arrays
  const colData = new Map();
  for (const c of numericCols) {
    const vals = [];
    for (const r of rows) {
      let v = r.get(c.key);
      if (typeof v !== 'number') v = parseNumber(v);
      vals.push(typeof v === 'number' && Number.isFinite(v) ? v : null);
    }
    colData.set(c.key, vals);
  }

  let strongestPositive = null;
  let strongestNegative = null;

  for (let i = 0; i < numericCols.length; i++) {
    for (let j = i + 1; j < numericCols.length; j++) {
      const c1 = numericCols[i];
      const c2 = numericCols[j];
      const vals1 = colData.get(c1.key);
      const vals2 = colData.get(c2.key);

      const pairsX = [];
      const pairsY = [];
      for (let k = 0; k < rows.length; k++) {
        const v1 = vals1[k];
        const v2 = vals2[k];
        if (v1 !== null && v2 !== null) {
          pairsX.push(v1);
          pairsY.push(v2);
        }
      }

      if (pairsX.length < 8) continue;
      const r = computePearsonCorrelation(pairsX, pairsY);
      if (r === null || !Number.isFinite(r)) continue;

      if (r >= 0.50) {
        if (!strongestPositive || r > strongestPositive.r) {
          strongestPositive = { c1, c2, r };
        }
      } else if (r <= -0.40) {
        if (!strongestNegative || r < strongestNegative.r) {
          strongestNegative = { c1, c2, r };
        }
      }
    }
  }

  if (strongestNegative) {
    const { c1, c2, r } = strongestNegative;
    insights.push({
      id: `corr_neg_${c1.key}_${c2.key}`,
      type: 'correlation',
      icon: 'bi-arrow-down-right',
      badge: 'Inverse Trade-off',
      badgeClass: 'badge-risk',
      title: `Inverse Relationship: ${c1.label} & ${c2.label} (r = ${r.toFixed(2)})`,
      narrative: `A statistically significant inverse relationship exists between ${c1.label} and ${c2.label} (r = ${r.toFixed(2)}). As ${c1.label} increases, ${c2.label} systematically declines.`,
      recommendation: `Re-evaluate discount or cost policies to ensure that gains in ${c1.label} do not erode net ${c2.label}.`,
      data: { c1: c1.key, c2: c2.key, r }
    });
  }

  if (strongestPositive) {
    const { c1, c2, r } = strongestPositive;
    insights.push({
      id: `corr_pos_${c1.key}_${c2.key}`,
      type: 'correlation',
      icon: 'bi-arrow-up-right',
      badge: 'Predictive Driver',
      badgeClass: 'badge-driver',
      title: `Strong Synergy: ${c1.label} & ${c2.label} (r = +${r.toFixed(2)})`,
      narrative: `A strong positive correlation exists between ${c1.label} and ${c2.label} (r = +${r.toFixed(2)}). Increases in ${c1.label} reliably scale alongside ${c2.label}.`,
      recommendation: `Use ${c1.label} as a reliable leading operational indicator to forecast expected ${c2.label}.`,
      data: { c1: c1.key, c2: c2.key, r }
    });
  }

  return insights;
}

/**
 * Analyzes chronological momentum if a date column is present.
 * @param {Array<Map<string, any>>} rows
 * @param {Array<{ key: string, label: string }>} dateCols
 * @param {Array<{ key: string, label: string }>} numericCols
 * @returns {InsightItem[]}
 */
export function analyzeTemporalVelocity(rows, dateCols, numericCols) {
  const insights = [];
  if (rows.length < 12 || dateCols.length === 0 || numericCols.length === 0) return insights;

  const dateCol = dateCols[0];
  const primaryMetric = numericCols.find(c => /(sales|revenue|profit|amount|quantity)/i.test(c.label)) || numericCols[0];

  const validDatedRows = [];
  for (const r of rows) {
    const rawDate = r.get(dateCol.key);
    const d = rawDate instanceof Date ? rawDate : parseDate(rawDate);
    let val = r.get(primaryMetric.key);
    if (typeof val !== 'number') val = parseNumber(val);
    if (d && !Number.isNaN(d.getTime()) && typeof val === 'number' && Number.isFinite(val)) {
      validDatedRows.push({ time: d.getTime(), val });
    }
  }

  if (validDatedRows.length < 12) return insights;

  validDatedRows.sort((a, b) => a.time - b.time);
  const mid = Math.floor(validDatedRows.length / 2);
  const firstHalfSum = validDatedRows.slice(0, mid).reduce((acc, curr) => acc + curr.val, 0);
  const secondHalfSum = validDatedRows.slice(mid).reduce((acc, curr) => acc + curr.val, 0);

  if (firstHalfSum > 0) {
    const changePct = ((secondHalfSum - firstHalfSum) / firstHalfSum) * 100;
    if (Math.abs(changePct) >= 12) {
      const isPositive = changePct > 0;
      insights.push({
        id: `velocity_${primaryMetric.key}`,
        type: 'velocity',
        icon: isPositive ? 'bi-graph-up-arrow' : 'bi-graph-down-arrow',
        badge: isPositive ? 'Growth Momentum' : 'Volume Contraction',
        badgeClass: isPositive ? 'badge-driver' : 'badge-risk',
        title: `${isPositive ? '+' : ''}${changePct.toFixed(1)}% period-over-period shift in ${primaryMetric.label}`,
        narrative: `${primaryMetric.label} shifted by ${isPositive ? '+' : ''}${changePct.toFixed(1)}% between the first half of the recorded timeline (${formatMetricValue(firstHalfSum, primaryMetric.label)}) and the second half (${formatMetricValue(secondHalfSum, primaryMetric.label)}).`,
        recommendation: isPositive
          ? `Sustain current momentum through aggressive marketing and cross-sell expansion.`
          : `Investigate customer churn and demand suppression behind recent volume drop.`,
        data: { primaryMetric: primaryMetric.key, changePct, firstHalfSum, secondHalfSum }
      });
    }
  }

  return insights;
}

/**
 * Main Smart Insights generator.
 * Synthesizes all analytical pipelines into a comprehensive executive briefing.
 * @param {object} params
 * @param {Array<Map<string, any>>} params.rows
 * @param {Array<{ key: string, label: string }>} params.headers
 * @param {object} [params.columnTypes={}]
 * @param {object} [params.metadata={}]
 * @returns {{
 *   summary: string,
 *   insights: InsightItem[],
 *   stats: object,
 *   toClipboardText: () => string
 * }}
 */
export function generateSmartInsights({ rows = [], headers = [], columnTypes = {}, metadata = {} }) {
  if (!rows || rows.length === 0 || !headers || headers.length === 0) {
    return {
      summary: 'No active dataset available for executive narrative synthesis.',
      insights: [],
      stats: { totalRows: 0, totalColumns: 0 },
      toClipboardText: () => 'Enclave: No data available.'
    };
  }

  // Classify column types
  const categoricalCols = [];
  const numericCols = [];
  const dateCols = [];

  for (const h of headers) {
    const type = columnTypes[h.key] || 'categorical';
    if (type === 'numeric') numericCols.push(h);
    else if (type === 'date') dateCols.push(h);
    else categoricalCols.push(h);
  }

  const allInsights = [
    ...analyzeDominanceAndDrivers(rows, categoricalCols, numericCols),
    ...analyzeMarginAndPerformanceRisks(rows, categoricalCols, numericCols),
    ...analyzeParetoConcentration(rows, categoricalCols, numericCols),
    ...analyzeStatisticalAnomalies(rows, numericCols),
    ...analyzeCorrelationsAndDrivers(rows, numericCols),
    ...analyzeTemporalVelocity(rows, dateCols, numericCols)
  ];

  // Synthesize executive 1-sentence synopsis
  const driverInsight = allInsights.find(i => i.type === 'driver');
  const riskInsight = allInsights.find(i => i.type === 'risk');
  const anomalyInsight = allInsights.find(i => i.type === 'anomaly');

  let summary = `Dataset of ${rows.length.toLocaleString()} records analyzed across ${headers.length} dimensions.`;
  if (driverInsight && riskInsight) {
    summary = `${driverInsight.title}, though ${riskInsight.title.toLowerCase()}.`;
  } else if (driverInsight) {
    summary = `${driverInsight.title} across active records.`;
  } else if (anomalyInsight) {
    summary = `${anomalyInsight.title} requiring auditor inspection.`;
  }

  const result = {
    summary,
    insights: allInsights,
    stats: {
      totalRows: rows.length,
      totalColumns: headers.length,
      numericCount: numericCols.length,
      categoricalCount: categoricalCols.length,
      insightCount: allInsights.length
    },
    toClipboardText: () => {
      const timestamp = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      const lines = [
        `==================================================`,
        `ENCLAVE - EXECUTIVE BRIEFING & SMART INSIGHTS`,
        `Generated: ${timestamp} | Scope: ${rows.length.toLocaleString()} rows`,
        `==================================================`,
        ``,
        `SUMMARY:`,
        summary,
        ``,
        `KEY TAKEAWAYS & ACTIONABLE RECOMMENDATIONS:`
      ];

      allInsights.forEach((item, idx) => {
        lines.push(`\n[${idx + 1}] ${item.badge.toUpperCase()}: ${item.title}`);
        lines.push(`    • Narrative: ${item.narrative}`);
        lines.push(`    • Action:    ${item.recommendation}`);
      });

      lines.push(`\n--------------------------------------------------`);
      lines.push(`Confidential | Powered by Enclave Client-Side Engine`);
      return lines.join('\n');
    }
  };

  return result;
}

/**
 * Renders the Executive Smart Insights Card into the DOM.
 * @param {HTMLElement} container
 * @param {object} params
 * @param {Array<Map<string, any>>} params.rows
 * @param {Array<{ key: string, label: string }>} params.headers
 * @param {object} [params.columnTypes={}]
 * @param {Function} [params.onCopyFeedback]
 */
export function renderSmartInsightsCard(container, params = {}) {
  if (!container) return;

  const { rows = [], headers = [], columnTypes = {}, onCopyFeedback } = params;

  if (!rows || rows.length === 0) {
    container.innerHTML = '';
    return;
  }

  const analysis = generateSmartInsights({ rows, headers, columnTypes });
  const { summary, insights, stats, toClipboardText } = analysis;

  if (insights.length === 0) {
    container.innerHTML = `
      <div class="smart-insights-card mb-4">
        <div class="smart-insights-header d-flex justify-content-between align-items-center">
          <div class="d-flex align-items-center gap-2">
            <span class="smart-pulse-dot"></span>
            <span class="smart-title font-sans fw-semibold">✦ Executive Smart Insights</span>
          </div>
          <span class="badge bg-secondary-subtle text-secondary font-mono small">Uniform Distribution</span>
        </div>
        <div class="p-3 text-muted small">
          Active data shows steady statistical balance without dominant concentration or red flag anomalies.
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="smart-insights-card mb-4" id="smartInsightsContainer">
      <div class="smart-insights-header d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div class="d-flex align-items-center gap-2">
          <span class="smart-pulse-dot"></span>
          <span class="smart-title font-sans fw-semibold">✦ Executive Smart Insights</span>
          <span class="smart-count-pill font-mono">${insights.length} key takeaway${insights.length === 1 ? '' : 's'}</span>
        </div>
        <div class="d-flex align-items-center gap-2">
          <button type="button" class="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1 font-sans" id="btnCopyExecutiveBriefing" title="Copy clean executive markdown briefing to clipboard">
            <i class="bi bi-clipboard"></i> <span>Copy Briefing</span>
          </button>
          <button type="button" class="btn btn-sm btn-outline-secondary" id="btnToggleSmartInsightsCollapse" title="Collapse or Expand Insights">
            <i class="bi bi-chevron-up" id="iconSmartCollapse"></i>
          </button>
        </div>
      </div>

      <div class="smart-insights-body" id="smartInsightsBody">
        <!-- High-Level Executive Synopsis Banner -->
        <div class="smart-synopsis-bar mb-3">
          <i class="bi bi-stars text-primary me-2"></i>
          <span class="fw-medium text-main">${summary}</span>
        </div>

        <!-- Filter Pill Chips -->
        <div class="smart-filter-strip mb-3 d-flex gap-2 flex-wrap" id="smartFilterStrip">
          <button class="smart-filter-pill active" data-filter="all">All (${insights.length})</button>
          ${insights.some(i => i.type === 'driver') ? `<button class="smart-filter-pill" data-filter="driver">Drivers</button>` : ''}
          ${insights.some(i => i.type === 'risk') ? `<button class="smart-filter-pill" data-filter="risk">Red Flags</button>` : ''}
          ${insights.some(i => i.type === 'pareto') ? `<button class="smart-filter-pill" data-filter="pareto">Pareto 80/20</button>` : ''}
          ${insights.some(i => i.type === 'anomaly') ? `<button class="smart-filter-pill" data-filter="anomaly">Anomalies</button>` : ''}
          ${insights.some(i => i.type === 'correlation') ? `<button class="smart-filter-pill" data-filter="correlation">Correlations</button>` : ''}
          ${insights.some(i => i.type === 'velocity') ? `<button class="smart-filter-pill" data-filter="velocity">Trends</button>` : ''}
        </div>

        <!-- Insights Grid -->
        <div class="row g-3" id="smartInsightsList">
          ${insights.map(item => `
            <div class="col-12 col-md-6 smart-insight-col" data-insight-type="${item.type}">
              <div class="smart-insight-item h-100">
                <div class="d-flex justify-content-between align-items-center mb-2">
                  <span class="smart-badge ${item.badgeClass}">
                    <i class="bi ${item.icon} me-1"></i>${item.badge}
                  </span>
                </div>
                <div class="smart-item-title mb-1">${item.title}</div>
                <div class="smart-item-narrative mb-2">${item.narrative}</div>
                <div class="smart-item-action">
                  <span class="action-tag">Action:</span> ${item.recommendation}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  // Wire Copy Button
  const btnCopy = container.querySelector('#btnCopyExecutiveBriefing');
  if (btnCopy) {
    btnCopy.addEventListener('click', async () => {
      const text = toClipboardText();
      try {
        await navigator.clipboard.writeText(text);
        btnCopy.innerHTML = `<i class="bi bi-check-lg text-success"></i> <span>Copied!</span>`;
        if (onCopyFeedback) onCopyFeedback('Executive briefing copied to clipboard!');
        setTimeout(() => {
          btnCopy.innerHTML = `<i class="bi bi-clipboard"></i> <span>Copy Briefing</span>`;
        }, 2200);
      } catch (err) {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        btnCopy.innerHTML = `<i class="bi bi-check-lg text-success"></i> <span>Copied!</span>`;
        if (onCopyFeedback) onCopyFeedback('Executive briefing copied to clipboard!');
        setTimeout(() => {
          btnCopy.innerHTML = `<i class="bi bi-clipboard"></i> <span>Copy Briefing</span>`;
        }, 2200);
      }
    });
  }

  // Wire Collapse / Expand Toggle
  const btnCollapse = container.querySelector('#btnToggleSmartInsightsCollapse');
  const bodyEl = container.querySelector('#smartInsightsBody');
  const iconEl = container.querySelector('#iconSmartCollapse');
  if (btnCollapse && bodyEl && iconEl) {
    btnCollapse.addEventListener('click', () => {
      const isCollapsed = bodyEl.classList.toggle('d-none');
      iconEl.className = isCollapsed ? 'bi bi-chevron-down' : 'bi bi-chevron-up';
    });
  }

  // Wire Filter Chips
  const filterPills = container.querySelectorAll('.smart-filter-pill');
  const insightCards = container.querySelectorAll('.smart-insight-col');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const filter = pill.getAttribute('data-filter');

      insightCards.forEach(card => {
        if (filter === 'all' || card.getAttribute('data-insight-type') === filter) {
          card.classList.remove('d-none');
        } else {
          card.classList.add('d-none');
        }
      });
    });
  });
}
