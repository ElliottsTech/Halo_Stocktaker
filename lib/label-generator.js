const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');

const MM = 2.83465;
const LABEL_W_MM = 89;
const LABEL_H_MM = 28;
const PAGE_W = LABEL_W_MM * MM;
const PAGE_H = LABEL_H_MM * MM;
const MARGIN = 3 * MM;
const MARGIN_LEFT = 8 * MM;

function formatPrice(value) {
  const n = Number(value);
  if (!isFinite(n) || n === null) return '';
  return '$' + n.toFixed(2);
}

function stripLeadingEmoji(text) {
  if (!text) return '';
  return text.replace(/^[\s\p{Extended_Pictographic}‍️︎]+/u, '').trim();
}

function truncate(text, doc, size, maxWidth) {
  if (!text) return '';
  doc.fontSize(size);
  if (doc.widthOfString(text) <= maxWidth) return text;
  let cut = text.length;
  while (cut > 1 && doc.widthOfString(text.slice(0, cut) + '…') > maxWidth) {
    cut--;
  }
  return text.slice(0, cut) + '…';
}

function pickBcid(label) {
  const v = String(label.barcode_value || '');
  if (/^\d{12}$/.test(v)) return 'upca';
  if (/^\d{13}$/.test(v)) return 'ean13';
  return 'code128';
}

async function renderBarcode(label) {
  const opts = {
    bcid: pickBcid(label),
    text: String(label.barcode_value),
    scale: 6,
    height: 10,
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0
  };
  return await bwipjs.toBuffer(opts);
}

async function generateLabelsPDF(labels) {
  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      layout: 'portrait',
      autoFirstPage: false
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const regularFont = 'Helvetica';
    const boldFont = 'Helvetica-Bold';
    const monoFont = 'Courier';

    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      doc.addPage({ size: [PAGE_W, PAGE_H], layout: 'portrait', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN_LEFT, right: MARGIN } });

      const contentW = PAGE_W - MARGIN_LEFT - MARGIN;

      const nameSize = 9;
      const priceSize = 11;
      const descSize = 6.5;
      const hriSize = 7;

      doc.font(boldFont);

      const priceStr = (label.price !== null && label.price !== undefined && label.price !== '')
        ? formatPrice(Number(label.price) * 1.1)
        : '';
      doc.fontSize(priceSize);
      const priceW = priceStr ? doc.widthOfString(priceStr) : 0;
      const nameMaxW = contentW - (priceW ? priceW + 4 * MM : 0);
      doc.fontSize(nameSize);
      const nameStr = truncate(stripLeadingEmoji(label.name || ''), doc, nameSize, nameMaxW);
      doc.text(nameStr, MARGIN_LEFT, MARGIN, { lineBreak: false });

      if (priceStr) {
        doc.fontSize(priceSize).text(priceStr, PAGE_W - MARGIN - priceW, MARGIN, { lineBreak: false });
      }

      doc.font(regularFont);
      let descY = MARGIN + nameSize + 1;
      if (label.description) {
        doc.fontSize(descSize);
        const descStr = truncate(label.description, doc, descSize, contentW);
        doc.text(descStr, MARGIN_LEFT, descY, { lineBreak: false });
        descY += descSize + 1;
      }

      const metaSize = 6;
      const metaParts = [];
      if (label.sku) metaParts.push('SKU: ' + label.sku);
      if (label.item_id) metaParts.push('ID: ' + label.item_id);
      if (metaParts.length > 0) {
        const metaStr = metaParts.join('   ');
        doc.font(monoFont).fontSize(metaSize);
        const metaStrFit = truncate(metaStr, doc, metaSize, contentW);
        doc.text(metaStrFit, MARGIN_LEFT, descY, { lineBreak: false });
      }

      if (label.barcode_value) {
        try {
          const png = await renderBarcode(label);
          const metaH = metaParts.length > 0 ? metaSize + 2 : 0;
          const barcodeMaxH = PAGE_H - MARGIN - (MARGIN + nameSize + descSize + 4 + metaH) - (hriSize + 2);
          const barcodeMaxW = contentW * 0.80;

          const natW = png.readUInt32BE(16);
          const natH = png.readUInt32BE(20);
          const aspect = natW / natH;
          let imgW = barcodeMaxW;
          let imgH = imgW / aspect;
          if (imgH > barcodeMaxH) {
            imgH = barcodeMaxH;
            imgW = imgH * aspect;
          }
          const imgX = (PAGE_W - imgW) / 2;
          const imgY = PAGE_H - MARGIN - (hriSize + 2) - imgH;
          doc.image(png, imgX, imgY, { width: imgW, height: imgH });

          doc.font(monoFont).fontSize(hriSize);
          const hriStr = label.barcode_value;
          const hriW = doc.widthOfString(hriStr);
          doc.text(
            hriStr,
            (PAGE_W - hriW) / 2,
            PAGE_H - MARGIN - hriSize,
            { lineBreak: false }
          );
        } catch (err) {
          doc.font(regularFont).fontSize(8).fillColor('red');
          doc.text(`barcode error: ${err.message}`, MARGIN_LEFT, PAGE_H / 2);
          doc.fillColor('black');
        }
      }
    }

    doc.end();
  });
}

module.exports = { generateLabelsPDF, formatPrice };
