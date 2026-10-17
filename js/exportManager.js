/**
 * CSV Insight - Export Manager Module
 * Handles CSV export with formula injection protection, PNG chart downloads, and jsPDF report generation.
 */

import { sanitizeForFormulaInjection } from './utils.js';
import { getChartPngDataUrl } from './chartRenderer.js';

/**
 * Resolves PapaParse unparse method across browser and Node.js.
 * @returns {Promise<any>}
 */
async function getPapaUnparse() {
  if (typeof globalThis !== 'undefined' && globalThis.Papa) {
    return globalThis.Papa.unparse;
  }
  try {
    const mod = await import('papaparse');
    return (mod.default || mod).unparse;
  } catch {
    throw new Error('PapaParse unparse is unavailable.');
  }
}

/**
 * Triggers a browser download for a Blob.
 * @param {Blob} blob
 * @param {string} filename
 */
export function triggerDownload(blob, filename) {
  if (typeof window === 'undefined' || !window.document) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exports rows and headers to a CSV file with optional formula injection neutralization.
 * @param {Array<{ key: string, label: string }>} headers
 * @param {Array<Map<string, any>>} rows
 * @param {string} filename
 * @param {object} [options={}]
 * @param {boolean} [options.neutralizeFormulas=true]
 * @returns {Promise<Blob>}
 */
export async function exportToCsv(headers, rows, filename = 'export.csv', options = {}) {
  const unparse = await getPapaUnparse();
  const neutralize = options.neutralizeFormulas !== false;

  const fields = headers.map(h => h.label);
  const data = rows.map(r => {
    return headers.map(h => {
      let val = r.get(h.key);
      if (val === null || val === undefined) return '';
      if (val instanceof Date) {
        val = val.toISOString().split('T')[0];
      }
      if (neutralize) {
        val = sanitizeForFormulaInjection(val);
      }
      return val;
    });
  });

  const csvString = unparse({
    fields,
    data
  }, {
    quotes: true,
    quoteChar: '"',
    escapeChar: '"',
    delimiter: ',',
    header: true,
    newline: '\r\n'
  });

  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
  return blob;
}

/**
 * Downloads a rendered chart as a PNG image.
 * @param {string} chartId
 * @param {string} filename
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
 * Generates and downloads a multi-page PDF executive summary report using jsPDF.
 * Embeds dataset profiling, quality warnings, summary statistics, and chart images.
 * @param {object} reportData
 * @param {string} reportData.datasetName
 * @param {number} reportData.rowCount
 * @param {number} reportData.colCount
 * @param {Array<{ title: string, value: string|number }>} reportData.summaryCards
 * @param {Array<{ message: string, severity: string }>} reportData.qualityWarnings
 * @param {Array<{ id: string, title: string, reason: string }>} reportData.charts
 * @param {string} [filename='csv-insight-report.pdf']
 * @returns {Promise<boolean>}
 */
export async function exportPdfReport(reportData, filename = 'csv-insight-report.pdf') {
  if (typeof window === 'undefined' || !window.jspdf) {
    throw new Error('jsPDF library is not loaded.');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  let cursorY = margin;

  // Header Bar
  doc.setFillColor(11, 31, 58); // #0B1F3A Navy
  doc.rect(0, 0, pageWidth, 60, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Enclave — Analytics & Quality Report', margin, 38);

  cursorY = 85;

  // Metadata
  doc.setTextColor(50, 50, 50);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Dataset: ${reportData.datasetName || 'Uploaded Dataset'}`, margin, cursorY);
  doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth - margin - 150, cursorY);
  cursorY += 20;

  doc.setDrawColor(220, 225, 235);
  doc.setLineWidth(1);
  doc.line(margin, cursorY, pageWidth - margin, cursorY);
  cursorY += 20;

  // Summary Metrics Section
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(11, 31, 58);
  doc.text('1. Dataset Overview & Key Metrics', margin, cursorY);
  cursorY += 20;

  const cardWidth = (pageWidth - margin * 2 - 30) / 4;
  const cards = reportData.summaryCards || [
    { title: 'Total Rows', value: reportData.rowCount },
    { title: 'Total Columns', value: reportData.colCount },
    { title: 'Missing Cells', value: `${reportData.missingPercentage || 0}%` },
    { title: 'Duplicate Rows', value: reportData.duplicateRows || 0 }
  ];

  cards.slice(0, 4).forEach((c, idx) => {
    const x = margin + idx * (cardWidth + 10);
    doc.setFillColor(245, 247, 251);
    doc.roundedRect(x, cursorY, cardWidth, 45, 6, 6, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 110, 125);
    doc.text(String(c.title), x + 8, cursorY + 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(11, 31, 58);
    doc.text(String(c.value), x + 8, cursorY + 36);
  });
  cursorY += 65;

  // Data Quality Warnings
  const warnings = reportData.qualityWarnings || [];
  if (warnings.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(11, 31, 58);
    doc.text('2. Data Quality & Profiling Warnings', margin, cursorY);
    cursorY += 18;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);

    warnings.slice(0, 6).forEach(w => {
      const isDanger = w.severity === 'danger';
      doc.setTextColor(isDanger ? 180 : 120, isDanger ? 30 : 80, 20);
      doc.text(`• [${(w.severity || 'warning').toUpperCase()}] ${w.message}`, margin + 5, cursorY);
      cursorY += 15;
    });
    cursorY += 15;
  }

  // Visualizations Section
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(11, 31, 58);
  doc.text('3. Key Visualizations & Insights', margin, cursorY);
  cursorY += 20;

  const chartList = reportData.charts || [];
  for (const c of chartList) {
    const imgData = getChartPngDataUrl(c.id);
    if (!imgData) continue;

    // Check if new page is needed
    if (cursorY + 220 > pageHeight - margin) {
      doc.addPage();
      cursorY = margin;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(11, 31, 58);
    doc.text(c.title || 'Chart', margin, cursorY);
    cursorY += 12;

    if (c.reason) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 110, 125);
      doc.text(`Why: ${c.reason}`, margin, cursorY);
      cursorY += 12;
    }

    const imgWidth = pageWidth - margin * 2;
    const imgHeight = 160;
    doc.addImage(imgData, 'PNG', margin, cursorY, imgWidth, imgHeight, undefined, 'FAST');
    cursorY += imgHeight + 25;
  }

  // Footer on each page
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Enclave Report | Page ${i} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 20,
      { align: 'center' }
    );
  }

  doc.save(filename);
  return true;
}
