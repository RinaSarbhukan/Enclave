/**
 * CSV Insight - Chart Recommendation & Aggregation Engine
 * Pure logic module without DOM dependencies.
 */

import {
  computePearsonCorrelation,
  computeHistogramBins,
  decimateScatterPoints,
  computeBoxPlotStats,
  parseNumber,
  parseDate
} from './utils.js';

/**
 * Validates whether a column qualifies for charting.
 * Rules: Never chart ID/text columns, constant columns, or columns > 50% missing.
 * @param {object} profile - Column profile from dataAnalyzer
 * @returns {boolean}
 */
export function isColumnChartable(profile) {
  if (!profile) return false;
  if (profile.type === 'identifier' || profile.type === 'text') return false;
  if (profile.missingPercentage > 50) return false;
  if (profile.stats?.distinctCount === 1) return false; // constant column
  return true;
}

/**
 * Determines appropriate date bucketing interval so chart points fall within ~12-60 points.
 * @param {number} spanDays
 * @returns {'day'|'week'|'month'|'year'}
 */
export function determineDateBucket(spanDays) {
  if (spanDays <= 45) return 'day';
  if (spanDays <= 250) return 'week';
  if (spanDays <= 1500) return 'month';
  return 'year';
}

/**
 * Formats a Date object into a bucket label string.
 * @param {Date} date
 * @param {'day'|'week'|'month'|'year'} bucket
 * @returns {string}
 */
export function formatDateBucket(date, bucket) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Unknown';
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');

  if (bucket === 'year') return `${y}`;
  if (bucket === 'month') return `${y}-${m}`;
  if (bucket === 'day') return `${y}-${m}-${d}`;

  // Week calculation (Monday of week)
  const dayOfWeek = date.getUTCDay();
  const diff = date.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const mon = new Date(Date.UTC(y, date.getUTCMonth(), diff));
  return `W ${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, '0')}-${String(mon.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Generates ranked chart recommendations based on column types and statistical properties.
 * Computed from cleanedData so chart structure remains stable across filtering.
 * @param {Array<{ key: string, label: string, type: string }>} headers
 * @param {Map<string, any>} columnProfiles
 * @param {Array<Map<string, any>>} rows
 * @returns {Array<{
 *   id: string,
 *   type: 'line'|'area'|'bar'|'doughnut'|'pie'|'scatter'|'histogram'|'radar',
 *   title: string,
 *   x: string,
 *   y?: string,
 *   yCols?: string[],
 *   categoryCol?: string,
 *   bucket?: 'day'|'week'|'month'|'year',
 *   aggregation: 'sum'|'mean'|'count'|'min'|'max',
 *   horizontal?: boolean,
 *   score: number,
 *   reason: string,
 *   pearsonR?: number|null
 * }>}
 */
export function recommendCharts(headers, columnProfiles, rows) {
  const recommendations = [];

  const chartableHeaders = headers.filter(h => {
    const prof = columnProfiles.get(h.key);
    return isColumnChartable(prof);
  });

  const numericCols = chartableHeaders.filter(h => h.type === 'numeric');
  const dateCols = chartableHeaders.filter(h => h.type === 'date');
  const categoricalCols = chartableHeaders.filter(h => h.type === 'categorical' || h.type === 'boolean');

  let recIdCounter = 1;

  // 1. Date + Numeric -> Line or Area chart (Score 95)
  for (const dCol of dateCols) {
    const dProf = columnProfiles.get(dCol.key);
    const spanDays = dProf?.stats?.spanDays || 30;
    const bucket = determineDateBucket(spanDays);

    for (const nCol of numericCols.slice(0, 3)) {
      recommendations.push({
        id: `rec_${recIdCounter++}`,
        type: 'line',
        title: `${nCol.label} over Time (${bucket}ly)`,
        x: dCol.key,
        y: nCol.key,
        bucket,
        aggregation: 'sum',
        score: 95,
        reason: `Shows chronological trend of ${nCol.label} aggregated by ${bucket}.`
      });
    }
  }

  // 2. Categorical + Numeric -> Aggregated Bar chart (Score 90)
  for (const cCol of categoricalCols.slice(0, 2)) {
    const cProf = columnProfiles.get(cCol.key);
    const distinctCount = cProf?.stats?.distinctCount || 0;
    const isLongLabels = cProf?.stats?.frequencies?.some(f => f.value.length > 15) || distinctCount > 8;

    for (const nCol of numericCols.slice(0, 3)) {
      recommendations.push({
        id: `rec_${recIdCounter++}`,
        type: 'bar',
        title: `Total ${nCol.label} by ${cCol.label}`,
        x: cCol.key,
        y: nCol.key,
        aggregation: 'sum',
        horizontal: isLongLabels,
        score: 90,
        reason: `Compares total ${nCol.label} across ${cCol.label} categories.`
      });

      recommendations.push({
        id: `rec_${recIdCounter++}`,
        type: 'bar',
        title: `Average ${nCol.label} by ${cCol.label}`,
        x: cCol.key,
        y: nCol.key,
        aggregation: 'mean',
        horizontal: isLongLabels,
        score: 87,
        reason: `Compares average ${nCol.label} benchmarked by ${cCol.label}.`
      });
    }
  }

  // 3. Categorical distribution -> Doughnut (<=6 categories) or Bar (Score 82)
  for (const cCol of categoricalCols.slice(0, 3)) {
    const cProf = columnProfiles.get(cCol.key);
    const distinctCount = cProf?.stats?.distinctCount || 0;

    if (distinctCount >= 2 && distinctCount <= 6) {
      recommendations.push({
        id: `rec_${recIdCounter++}`,
        type: 'doughnut',
        title: `Distribution of ${cCol.label}`,
        x: cCol.key,
        aggregation: 'count',
        score: 84,
        reason: `Visualizes proportional breakdown of ${distinctCount} distinct ${cCol.label} segments.`
      });
    } else if (distinctCount > 1) {
      recommendations.push({
        id: `rec_${recIdCounter++}`,
        type: 'bar',
        title: `Frequency of ${cCol.label}`,
        x: cCol.key,
        aggregation: 'count',
        horizontal: distinctCount > 8,
        score: 80,
        reason: `Shows count frequency across top ${cCol.label} categories.`
      });
    }
  }

  // 4. Two numeric columns -> Scatter plot with Pearson r (Score 85)
  if (numericCols.length >= 2) {
    for (let i = 0; i < numericCols.length && i < 3; i++) {
      for (let j = i + 1; j < numericCols.length && j < 4; j++) {
        const col1 = numericCols[i];
        const col2 = numericCols[j];

        const xVals = rows.map(r => r.get(col1.key));
        const yVals = rows.map(r => r.get(col2.key));
        const r = computePearsonCorrelation(xVals, yVals);

        let correlationText = 'Correlation analysis';
        if (r !== null) {
          const strength = Math.abs(r) > 0.7 ? 'Strong' : Math.abs(r) > 0.4 ? 'Moderate' : 'Weak';
          const dir = r > 0 ? 'positive' : 'negative';
          correlationText = `${strength} ${dir} linear relationship (Pearson r = ${r})`;
        }

        recommendations.push({
          id: `rec_${recIdCounter++}`,
          type: 'scatter',
          title: `${col2.label} vs ${col1.label}`,
          x: col1.key,
          y: col2.key,
          aggregation: 'none',
          pearsonR: r,
          score: 85,
          reason: correlationText
        });
      }
    }
  }

  // 5. Single numeric -> Histogram (Freedman-Diaconis / Sturges) (Score 78)
  for (const nCol of numericCols.slice(0, 3)) {
    recommendations.push({
      id: `rec_${recIdCounter++}`,
      type: 'histogram',
      title: `Distribution of ${nCol.label}`,
      x: nCol.key,
      aggregation: 'count',
      score: 78,
      reason: `Displays statistical distribution and skewness across value bins.`
    });
  }

  // 6. Multiple numerics -> Grouped Bar by categorical (Score 82)
  if (numericCols.length >= 2 && categoricalCols.length >= 1) {
    const cCol = categoricalCols[0];
    const topNums = numericCols.slice(0, 3);
    recommendations.push({
      id: `rec_${recIdCounter++}`,
      type: 'bar',
      title: `Multi-Metric Comparison by ${cCol.label}`,
      x: cCol.key,
      yCols: topNums.map(n => n.key),
      aggregation: 'sum',
      score: 82,
      reason: `Compares multiple metrics (${topNums.map(n => n.label).join(', ')}) across ${cCol.label}.`
    });
  }

  // 7. Stacked bar -> Only when a second categorical has <= 6 levels
  if (categoricalCols.length >= 2 && numericCols.length >= 1) {
    const c1 = categoricalCols[0];
    const c2 = categoricalCols[1];
    const c2Prof = columnProfiles.get(c2.key);
    if (c2Prof?.stats?.distinctCount <= 6) {
      recommendations.push({
        id: `rec_${recIdCounter++}`,
        type: 'bar',
        title: `${numericCols[0].label} by ${c1.label} (Stacked by ${c2.label})`,
        x: c1.key,
        y: numericCols[0].key,
        categoryCol: c2.key,
        aggregation: 'sum',
        stacked: true,
        score: 79,
        reason: `Breaks down ${numericCols[0].label} across ${c1.label} sub-segmented by ${c2.label}.`
      });
    }
  }

  // 8. Categorical + Numeric -> Box & Whisker Plot (Score 84)
  if (categoricalCols.length >= 1 && numericCols.length >= 1 && rows.length >= 25) {
    const cCol = categoricalCols[0];
    const nCol = numericCols[0];
    recommendations.push({
      id: `rec_${recIdCounter++}`,
      type: 'boxplot',
      title: `${nCol.label} Distribution by ${cCol.label} (Box Plot)`,
      x: cCol.key,
      y: nCol.key,
      aggregation: 'none',
      score: 84,
      reason: `Displays statistical quartiles, medians, IQR spread, and outliers across ${cCol.label}.`
    });
  }

  // 9. Three Numeric (+ Optional Categorical) -> Bubble Chart (Score 83)
  if (numericCols.length >= 3) {
    const xN = numericCols[0];
    const yN = numericCols[1];
    const zN = numericCols[2];
    const catCol = categoricalCols[0];
    recommendations.push({
      id: `rec_${recIdCounter++}`,
      type: 'bubble',
      title: `${yN.label} vs ${xN.label} (Size: ${zN.label})`,
      x: xN.key,
      y: yN.key,
      z: zN.key,
      categoryCol: catCol ? catCol.key : undefined,
      aggregation: 'none',
      score: 83,
      reason: `Multi-metric scatter comparing ${yN.label} against ${xN.label} with radius sized by ${zN.label}${catCol ? ` and colored by ${catCol.label}` : ''}.`
    });
  }

  // 10. Two Categorical + Numeric -> 2D Category Heatmap (Score 81)
  if (categoricalCols.length >= 2 && numericCols.length >= 1) {
    const c1 = categoricalCols[0];
    const c2 = categoricalCols[1];
    const nCol = numericCols[0];
    recommendations.push({
      id: `rec_${recIdCounter++}`,
      type: 'heatmap',
      title: `${nCol.label} Heatmap (${c1.label} × ${c2.label})`,
      x: c1.key,
      y: c2.key,
      z: nCol.key,
      aggregation: 'sum',
      score: 81,
      reason: `Cross-tabulated 2D density heatmap of ${nCol.label} across ${c1.label} and ${c2.label}.`
    });
  }

  // Sort by score descending
  recommendations.sort((a, b) => b.score - a.score);

  return recommendations;
}

/**
 * Builds Chart.js datasets and labels from dataset rows for a given chart configuration.
 * Automatically handles collapsing beyond top 10 categories to "Other".
 * @param {object} chartConfig
 * @param {Array<Map<string, any>>} rows
 * @param {Array<{ key: string, label: string }>} headers
 * @param {object} [options={}]
 * @param {boolean} [options.expandOther=false]
 * @returns {{ labels: string[], datasets: Array<{ label: string, data: any[], backgroundColor?: any }> }}
 */
export function buildChartData(chartConfig, rows, headers, options = {}) {
  const headerMap = new Map(headers.map(h => [h.key, h.label]));
  const expandOther = options.expandOther || false;
  const maxCats = expandOther ? 50 : 10;

  // 1. Histogram
  if (chartConfig.type === 'histogram') {
    const xVals = rows.map(r => {
      const v = r.get(chartConfig.x);
      return typeof v === 'number' ? v : parseNumber(v);
    }).filter(v => typeof v === 'number' && Number.isFinite(v));
    const bins = computeHistogramBins(xVals, 25);
    return {
      labels: bins.map(b => b.label),
      datasets: [
        {
          label: `Count of ${headerMap.get(chartConfig.x) || chartConfig.x}`,
          data: bins.map(b => b.count)
        }
      ]
    };
  }

  // 1b. Box & Whisker Plot
  if (chartConfig.type === 'boxplot') {
    const catKey = chartConfig.x;
    const numKey = chartConfig.y;
    const groups = new Map();

    for (const r of rows) {
      const rawCat = r.get(catKey);
      const cat = String(rawCat !== null && rawCat !== undefined ? rawCat : 'Missing').trim();
      let val = r.get(numKey);
      if (typeof val !== 'number') val = parseNumber(val);
      if (typeof val === 'number' && Number.isFinite(val)) {
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(val);
      }
    }

    const sortedCats = Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, maxCats);

    const labels = [];
    const boxData = [];
    const statsList = [];

    for (const [catName, vals] of sortedCats) {
      const stats = computeBoxPlotStats(vals);
      if (stats) {
        labels.push(catName);
        boxData.push([stats.q1, stats.q3]);
        statsList.push(stats);
      }
    }

    return {
      labels,
      datasets: [
        {
          label: `${headerMap.get(numKey) || numKey} by ${headerMap.get(catKey) || catKey}`,
          data: boxData,
          _boxPlotStats: statsList
        }
      ]
    };
  }

  // 1c. Bubble Chart (Multi-Metric Scatter with Radius)
  if (chartConfig.type === 'bubble') {
    const xKey = chartConfig.x;
    const yKey = chartConfig.y;
    const zKey = chartConfig.z || chartConfig.sizeCol || xKey;
    const catKey = chartConfig.categoryCol;

    const validPoints = [];
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const r of rows) {
      let x = r.get(xKey);
      let y = r.get(yKey);
      let z = r.get(zKey);
      if (typeof x !== 'number') x = parseNumber(x);
      if (typeof y !== 'number') y = parseNumber(y);
      if (typeof z !== 'number') z = parseNumber(z);

      if (typeof x === 'number' && Number.isFinite(x) &&
          typeof y === 'number' && Number.isFinite(y) &&
          typeof z === 'number' && Number.isFinite(z)) {
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
        const cat = catKey ? String(r.get(catKey) || 'Other').trim() : 'All Data';
        validPoints.push({ x, y, z, cat });
      }
    }

    const zSpan = maxZ - minZ || 1;
    const pointsToRender = validPoints.length > 2000
      ? validPoints.filter((_, i) => i % Math.ceil(validPoints.length / 2000) === 0)
      : validPoints;

    const datasets = [];
    if (catKey) {
      const catGroups = new Map();
      for (const p of pointsToRender) {
        if (!catGroups.has(p.cat)) catGroups.set(p.cat, []);
        catGroups.get(p.cat).push(p);
      }

      const sortedCats = Array.from(catGroups.entries())
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 8);

      for (const [catName, pts] of sortedCats) {
        datasets.push({
          label: catName,
          data: pts.map(p => ({
            x: p.x,
            y: p.y,
            r: Number((4 + ((p.z - minZ) / zSpan) * 20).toFixed(1)),
            z: p.z
          }))
        });
      }
    } else {
      datasets.push({
        label: `${headerMap.get(yKey) || yKey} vs ${headerMap.get(xKey) || xKey}`,
        data: pointsToRender.map(p => ({
          x: p.x,
          y: p.y,
          r: Number((4 + ((p.z - minZ) / zSpan) * 20).toFixed(1)),
          z: p.z
        }))
      });
    }

    return {
      labels: [],
      datasets
    };
  }

  // 1d. 2D Category Heatmap
  if (chartConfig.type === 'heatmap') {
    const xCol = chartConfig.x;
    const yCol = chartConfig.y;
    const zCol = chartConfig.z || chartConfig.metric;
    const aggType = chartConfig.aggregation || 'sum';

    const xMap = new Map();
    const yMap = new Map();
    for (const r of rows) {
      const xVal = String(r.get(xCol) || 'Missing').trim();
      const yVal = String(r.get(yCol) || 'Missing').trim();
      xMap.set(xVal, (xMap.get(xVal) || 0) + 1);
      yMap.set(yVal, (yMap.get(yVal) || 0) + 1);
    }

    const topX = Array.from(xMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
    const topY = Array.from(yMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);

    const cellMap = new Map();
    let globalMin = Infinity;
    let globalMax = -Infinity;

    for (const r of rows) {
      const xVal = String(r.get(xCol) || 'Missing').trim();
      const yVal = String(r.get(yCol) || 'Missing').trim();
      if (!topX.includes(xVal) || !topY.includes(yVal)) continue;

      let num = zCol ? r.get(zCol) : 1;
      if (typeof num !== 'number') num = parseNumber(num);
      if (typeof num !== 'number' || !Number.isFinite(num)) num = 0;

      const key = `${yVal}:::${xVal}`;
      if (!cellMap.has(key)) cellMap.set(key, { sum: 0, count: 0, min: num, max: num });
      const e = cellMap.get(key);
      e.sum += num;
      e.count += 1;
      if (num < e.min) e.min = num;
      if (num > e.max) e.max = num;
    }

    const matrix = [];
    for (let yi = 0; yi < topY.length; yi++) {
      const rowVals = [];
      for (let xi = 0; xi < topX.length; xi++) {
        const key = `${topY[yi]}:::${topX[xi]}`;
        const e = cellMap.get(key);
        let val = 0;
        if (e) {
          if (aggType === 'mean') val = Number((e.sum / (e.count || 1)).toFixed(2));
          else if (aggType === 'count') val = e.count;
          else if (aggType === 'min') val = e.min;
          else if (aggType === 'max') val = e.max;
          else val = Number(e.sum.toFixed(2));
        }
        rowVals.push(val);
        if (val < globalMin) globalMin = val;
        if (val > globalMax) globalMax = val;
      }
      matrix.push(rowVals);
    }

    if (globalMin === Infinity) globalMin = 0;
    if (globalMax === -Infinity) globalMax = 1;

    return {
      labels: topX,
      yLabels: topY,
      matrix,
      minVal: globalMin,
      maxVal: globalMax,
      xLabel: headerMap.get(xCol) || xCol,
      yLabel: headerMap.get(yCol) || yCol,
      zLabel: zCol ? (headerMap.get(zCol) || zCol) : 'Count',
      datasets: [
        {
          label: `${aggType.toUpperCase()} of ${zCol ? (headerMap.get(zCol) || zCol) : 'Count'}`,
          data: matrix
        }
      ]
    };
  }

  // 2. Scatter plot
  if (chartConfig.type === 'scatter') {
    const rawPoints = [];
    for (const r of rows) {
      let x = r.get(chartConfig.x);
      let y = r.get(chartConfig.y);
      if (typeof x !== 'number') x = parseNumber(x);
      if (typeof y !== 'number') y = parseNumber(y);
      if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
        rawPoints.push({ x, y });
      }
    }
    const points = decimateScatterPoints(rawPoints, 5000);
    return {
      labels: [],
      datasets: [
        {
          label: `${headerMap.get(chartConfig.y) || chartConfig.y} vs ${headerMap.get(chartConfig.x) || chartConfig.x}`,
          data: points
        }
      ]
    };
  }

  // 3. Date + Numeric (Line or Area)
  if (chartConfig.type === 'line' || chartConfig.type === 'area') {
    const bucket = chartConfig.bucket || 'month';
    const aggType = chartConfig.aggregation || 'sum';
    const groupMap = new Map();

    for (const r of rows) {
      let d = r.get(chartConfig.x);
      let num = r.get(chartConfig.y);
      if (!(d instanceof Date)) d = parseDate(d);
      if (typeof num !== 'number') num = parseNumber(num);
      if (!d || Number.isNaN(d.getTime()) || num === null || !Number.isFinite(num)) continue;

      const label = formatDateBucket(d, bucket);
      if (!groupMap.has(label)) {
        groupMap.set(label, { sum: 0, count: 0, min: num, max: num });
      }
      const entry = groupMap.get(label);
      entry.sum += num;
      entry.count += 1;
      if (num < entry.min) entry.min = num;
      if (num > entry.max) entry.max = num;
    }

    const sortedLabels = Array.from(groupMap.keys()).sort((a, b) => a.localeCompare(b));
    const data = sortedLabels.map(lbl => {
      const e = groupMap.get(lbl);
      if (aggType === 'mean') return Number((e.sum / e.count).toFixed(2));
      if (aggType === 'count') return e.count;
      if (aggType === 'min') return e.min;
      if (aggType === 'max') return e.max;
      return Number(e.sum.toFixed(2));
    });

    return {
      labels: sortedLabels,
      datasets: [
        {
          label: `${aggType.toUpperCase()} of ${headerMap.get(chartConfig.y) || chartConfig.y}`,
          data,
          fill: chartConfig.type === 'area'
        }
      ]
    };
  }

  // 4. Multi-metric Grouped Bar
  if (chartConfig.yCols && Array.isArray(chartConfig.yCols)) {
    const catMap = new Map();
    for (const r of rows) {
      const cat = String(r.get(chartConfig.x) || 'Missing').trim();
      if (!catMap.has(cat)) {
        const metricsObj = {};
        for (const yCol of chartConfig.yCols) {
          metricsObj[yCol] = { sum: 0, count: 0 };
        }
        catMap.set(cat, metricsObj);
      }
      const entry = catMap.get(cat);
      for (const yCol of chartConfig.yCols) {
        const val = r.get(yCol);
        if (typeof val === 'number' && Number.isFinite(val)) {
          entry[yCol].sum += val;
          entry[yCol].count += 1;
        }
      }
    }

    const sortedCats = Array.from(catMap.keys()).slice(0, maxCats);
    const datasets = chartConfig.yCols.map(yCol => {
      const data = sortedCats.map(cat => {
        const e = catMap.get(cat)[yCol];
        return chartConfig.aggregation === 'mean'
          ? (e.count > 0 ? Number((e.sum / e.count).toFixed(2)) : 0)
          : Number(e.sum.toFixed(2));
      });
      return {
        label: headerMap.get(yCol) || yCol,
        data
      };
    });

    return {
      labels: sortedCats,
      datasets
    };
  }

  // 5. Stacked Bar with two categoricals
  if (chartConfig.stacked && chartConfig.categoryCol) {
    const mainCats = new Map();
    const subCatSet = new Set();

    for (const r of rows) {
      const main = String(r.get(chartConfig.x) || 'Missing').trim();
      const sub = String(r.get(chartConfig.categoryCol) || 'Missing').trim();
      const val = r.get(chartConfig.y);
      subCatSet.add(sub);

      if (!mainCats.has(main)) mainCats.set(main, new Map());
      const subMap = mainCats.get(main);
      const curr = subMap.get(sub) || 0;
      subMap.set(sub, curr + (typeof val === 'number' && Number.isFinite(val) ? val : 0));
    }

    const sortedMain = Array.from(mainCats.keys()).slice(0, maxCats);
    const subList = Array.from(subCatSet).slice(0, 6);

    const datasets = subList.map(sub => {
      const data = sortedMain.map(main => {
        const subMap = mainCats.get(main);
        return Number((subMap?.get(sub) || 0).toFixed(2));
      });
      return {
        label: sub,
        data
      };
    });

    return {
      labels: sortedMain,
      datasets
    };
  }

  // 6. Standard Categorical Bar or Doughnut / Pie
  const groupMap = new Map();
  const aggType = chartConfig.aggregation || 'count';

  for (const r of rows) {
    const cat = String(r.get(chartConfig.x) || 'Missing').trim();
    const num = chartConfig.y ? r.get(chartConfig.y) : 1;

    if (!groupMap.has(cat)) {
      groupMap.set(cat, { sum: 0, count: 0, min: num, max: num });
    }
    const entry = groupMap.get(cat);
    const val = typeof num === 'number' && Number.isFinite(num) ? num : 1;
    entry.sum += val;
    entry.count += 1;
    if (val < entry.min) entry.min = val;
    if (val > entry.max) entry.max = val;
  }

  // Sort descending by primary metric
  const sortedEntries = Array.from(groupMap.entries()).sort((a, b) => {
    return aggType === 'count' ? b[1].count - a[1].count : b[1].sum - a[1].sum;
  });

  const topEntries = sortedEntries.slice(0, maxCats);
  const otherEntries = sortedEntries.slice(maxCats);

  let finalLabels = topEntries.map(e => e[0]);
  let finalValues = topEntries.map(e => {
    const item = e[1];
    if (aggType === 'mean') return Number((item.sum / item.count).toFixed(2));
    if (aggType === 'count') return item.count;
    if (aggType === 'min') return item.min;
    if (aggType === 'max') return item.max;
    return Number(item.sum.toFixed(2));
  });

  // Collapse remaining into "Other"
  if (otherEntries.length > 0 && !expandOther) {
    let otherSum = 0;
    let otherCount = 0;
    for (const oe of otherEntries) {
      otherSum += oe[1].sum;
      otherCount += oe[1].count;
    }
    finalLabels.push(`Other (${otherEntries.length} more)`);
    finalValues.push(aggType === 'count' ? otherCount : Number(otherSum.toFixed(2)));
  }

  const metricName = chartConfig.y ? `${aggType.toUpperCase()} of ${headerMap.get(chartConfig.y) || chartConfig.y}` : `Count of ${headerMap.get(chartConfig.x) || chartConfig.x}`;

  return {
    labels: finalLabels,
    datasets: [
      {
        label: metricName,
        data: finalValues
      }
    ]
  };
}
