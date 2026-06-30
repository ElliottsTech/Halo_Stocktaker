const PDFDocument = require('pdfkit');

const MM = 2.83465;
const A4_W = 210 * MM;
const A4_H = 297 * MM;
const MARGIN = 12 * MM;
const CONTENT_W = A4_W - 2 * MARGIN;

const fmt = n => '$' + (Number(n) || 0).toFixed(2);
const fmtVar = v => (v > 0 ? '+' : '') + (Number(v) || 0);

function stripEmoji(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️‍]/gu, '').trim();
}

function drawHeader(doc, stocktake, report) {
  doc.font('Helvetica-Bold').fontSize(16)
    .text(`Stocktake Report — ${stocktake.name}`, MARGIN, MARGIN);
  doc.font('Helvetica').fontSize(9).fillColor('#555')
    .text(
      `Generated ${new Date(report.generatedAt).toLocaleString()}  •  ${report.summary.totalItemsChecked} items checked  •  ${report.summary.itemsWithVariance} with variance`,
      MARGIN, MARGIN + 20
    );
  doc.fillColor('#000');
  return MARGIN + 36;
}

function drawSummary(doc, report, y) {
  const rows = [
    ['Items checked', String(report.summary.totalItemsChecked)],
    ['Items with variance', String(report.summary.itemsWithVariance)],
    ['Total units variance (abs)', String(report.summary.totalVariance)],
    ['Total expected value (cost)', fmt(report.summary.totalExpectedValue)],
    ['Total counted value (cost)', fmt(report.summary.totalCountedValue)],
    ['Total variance value (cost)', fmt(report.summary.totalVarianceValue)]
  ];
  doc.font('Helvetica-Bold').fontSize(11).text('Summary', MARGIN, y);
  y += 16;
  doc.font('Helvetica').fontSize(9);
  for (const [label, value] of rows) {
    doc.text(label, MARGIN, y);
    const num = Number(String(value).replace(/[^0-9.-]/g, ''));
    if (num < 0) doc.fillColor('#c53030');
    else doc.fillColor('#000');
    doc.text(value, MARGIN + 200, y, { width: CONTENT_W - 200, align: 'right' });
    y += 13;
  }
  doc.fillColor('#000');
  return y + 8;
}

function ensureSpace(doc, y, needed) {
  if (y + needed > A4_H - MARGIN - 20) {
    doc.addPage({ size: [A4_W, A4_H], layout: 'portrait', margin: MARGIN });
    return MARGIN;
  }
  return y;
}

function drawTable(doc, y, title, columns, rows, totalsRow) {
  doc.font('Helvetica-Bold').fontSize(11);
  y = ensureSpace(doc, y, 30);
  doc.text(title, MARGIN, y);
  y += 16;

  const headerH = 18;
  const rowH = 14;

  y = ensureSpace(doc, y, headerH + 10);
  doc.font('Helvetica-Bold').fontSize(7.5);
  let x = MARGIN;
  for (const col of columns) {
    doc.text(col.label, x, y + 4, {
      width: col.w,
      align: col.align || 'left',
      lineBreak: false
    });
    x += col.w;
  }
  doc.moveTo(MARGIN, y + headerH - 2).lineTo(MARGIN + CONTENT_W, y + headerH - 2).stroke('#666');
  y += headerH;

  doc.font('Helvetica').fontSize(7.5);
  for (const row of rows) {
    if (y + rowH > A4_H - MARGIN - 20) {
      doc.addPage({ size: [A4_W, A4_H], layout: 'portrait', margin: MARGIN });
      y = MARGIN;
      // Redraw header on new page
      doc.font('Helvetica-Bold').fontSize(7.5);
      let xx = MARGIN;
      for (const col of columns) {
        doc.text(col.label, xx, y + 4, { width: col.w, align: col.align || 'left', lineBreak: false });
        xx += col.w;
      }
      doc.moveTo(MARGIN, y + headerH - 2).lineTo(MARGIN + CONTENT_W, y + headerH - 2).stroke('#666');
      y += headerH;
      doc.font('Helvetica').fontSize(7.5);
    }

    let xi = MARGIN;
    for (const col of columns) {
      const val = row[col.key];
      const isVariance = col.key === 'variance' || col.key === 'valueVariance';
      if (isVariance && val !== undefined && val !== '' && Number(val) !== 0) {
        doc.fillColor(Number(val) < 0 ? '#c53030' : '#2f855a');
      } else {
        doc.fillColor('#000');
      }
      let display = val;
      if (col.fmt) display = col.fmt(val);
      else if (val === undefined || val === null) display = '';
      else display = String(val);
      const truncated = display.length > col.maxChars ? display.slice(0, col.maxChars - 1) + '…' : display;
      doc.text(truncated, xi, y + 3, {
        width: col.w,
        align: col.align || 'left',
        lineBreak: false
      });
      xi += col.w;
    }
    y += rowH;
  }

  if (totalsRow) {
    y = ensureSpace(doc, y, rowH + 4);
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).stroke('#666');
    y += 3;
    let xt = MARGIN;
    for (const col of columns) {
      const val = totalsRow[col.key];
      if (val !== undefined && val !== '') {
        doc.font('Helvetica-Bold');
        if (col.key === 'valueVariance' && Number(val) !== 0) {
          doc.fillColor(Number(val) < 0 ? '#c53030' : '#2f855a');
        } else doc.fillColor('#000');
        const display = col.fmt ? col.fmt(val) : String(val);
        doc.text(display, xt, y + 3, { width: col.w, align: col.align || 'left', lineBreak: false });
      }
      xt += col.w;
    }
    doc.font('Helvetica').fillColor('#000');
    y += rowH;
  }

  return y + 10;
}

function generateReportPDF(stocktake) {
  return new Promise((resolve, reject) => {
    const report = stocktake.report;
    if (!report) return reject(new Error('No report on stocktake'));

    const doc = new PDFDocument({
      size: [A4_W, A4_H],
      layout: 'portrait',
      margin: MARGIN,
      autoFirstPage: false
    });
    doc.addPage({ size: [A4_W, A4_H], layout: 'portrait', margin: MARGIN });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = drawHeader(doc, stocktake, report);
    y = drawSummary(doc, report, y);

    const sortedItems = [...(report.countedItems || [])].sort((a, b) =>
      (a.itemName || '').localeCompare(b.itemName || '')
    ).map(r => ({ ...r, itemName: stripEmoji(r.itemName), locationName: stripEmoji(r.locationName) }));

    const itemCols = [
      { label: 'Item',         key: 'itemName',   w: 55 * MM, maxChars: 36 },
      { label: 'SKU',          key: 'sku',        w: 23 * MM, maxChars: 14 },
      { label: 'Loc',          key: 'locationName', w: 19 * MM, maxChars: 13 },
      { label: 'Cost',         key: 'cost',       w: 15 * MM, align: 'right', fmt: fmt },
      { label: 'Price',        key: 'price',      w: 15 * MM, align: 'right', fmt: fmt },
      { label: 'Exp',          key: 'expected',   w: 8 * MM,  align: 'center' },
      { label: 'Counted',      key: 'counted',    w: 10 * MM, align: 'center' },
      { label: 'Var',          key: 'variance',   w: 8 * MM,  align: 'center', fmt: fmtVar },
      { label: 'Counted $',    key: 'valueCounted', w: 15 * MM, align: 'right', fmt: fmt },
      { label: 'Var $',        key: 'valueVariance', w: 13 * MM, align: 'right', fmt: fmt }
    ];

    const itemTotals = {
      expected: sortedItems.reduce((s, r) => s + (r.expected || 0), 0),
      counted: sortedItems.reduce((s, r) => s + (r.counted || 0), 0),
      variance: sortedItems.reduce((s, r) => s + (r.variance || 0), 0),
      valueCounted: report.summary.totalCountedValue,
      valueVariance: report.summary.totalVarianceValue
    };

    y = drawTable(doc, y, `All Counted Items (${sortedItems.length})`, itemCols, sortedItems, itemTotals);

    const variances = [...(report.variances || [])].sort((a, b) =>
      (a.itemName || '').localeCompare(b.itemName || '')
    ).map(r => ({ ...r, itemName: stripEmoji(r.itemName), locationName: stripEmoji(r.locationName) }));
    if (variances.length > 0) {
      const varCols = [
        { label: 'Item',          key: 'itemName',    w: 50 * MM, maxChars: 34 },
        { label: 'Location',      key: 'locationName', w: 26 * MM, maxChars: 18 },
        { label: 'Exp',           key: 'expected',    w: 10 * MM, align: 'center' },
        { label: 'Cnt',           key: 'found_counted', w: 10 * MM, align: 'center' },
        { label: 'Var',           key: 'variance',    w: 10 * MM, align: 'center', fmt: fmtVar },
        { label: 'Cost Impact',   key: 'costImpact',  w: 22 * MM, align: 'right', fmt: fmt },
        { label: 'Reason',        key: 'reason',      w: 58 * MM, align: 'right', maxChars: 48 }
      ];
      const varRows = variances.map(v => ({
        ...v,
        found_counted: v.itemType === 'serialised' ? (v.found ?? 0) : (v.counted ?? 0)
      }));
      const varTotals = { costImpact: report.summary.totalCostImpact };
      y = drawTable(doc, y, `Variances (${variances.length})`, varCols, varRows, varTotals);
    }

    doc.end();
  });
}

module.exports = { generateReportPDF };
