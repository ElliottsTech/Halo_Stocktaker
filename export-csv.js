#!/usr/bin/env node
// Export a stocktake session to CSV.
// Usage: node export-csv.js [stocktakeId]
//   default stocktakeId = first entry in data/index.json
// Outputs:
//   export/<id>-detail.csv    — one row per item+location (+ serial breakdown)
//   export/<id>-variances.csv — variance rows from the differential report

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const OUT_DIR = path.join(__dirname, 'export');

function escapeCsv(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? String(v) : String(v);
  if (/[",\n\r]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function row(values) {
  return values.map(escapeCsv).join(',');
}

function pickStocktakeId() {
  const argv = process.argv[2];
  if (argv) return argv;
  const idx = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  const entries = Array.isArray(idx) ? idx : (idx.stocktakes || idx.items || []);
  if (!entries.length) throw new Error('No stocktakes in index.json');
  const first = entries[0];
  return typeof first === 'string' ? first : (first.id || first.stocktakeId);
}

function serialSummary(serials, additionalSerials) {
  const expected = (serials || []).map(s => s.serialNumber || `id:${s.id}`);
  const found = (serials || []).filter(s => s.found).map(s => s.serialNumber || `id:${s.id}`);
  const missing = (serials || []).filter(s => !s.found).map(s => s.serialNumber || `id:${s.id}`);
  const extra = (additionalSerials || []).map(s => typeof s === 'string' ? s : (s.serialNumber || `id:${s.id}`));
  return { expected, found, missing, extra };
}

function buildDetailCsv(d) {
  const haloById = new Map();
  for (const it of (d.haloData?.items || [])) haloById.set(it.id, it);

  const headers = [
    'itemId', 'itemName', 'description', 'assetGroup', 'supplierPartCode',
    'isSerialised', 'cost', 'price',
    'locationId', 'locationName', 'stockBinName',
    'expectedQuantity', 'reservedQuantity', 'availableQuantity', 'serialisedAssets',
    'countedQuantity', 'varianceQty', 'varianceReason', 'lastCountedAt', 'locationNotes',
    'serialsExpected', 'serialsFound', 'serialsMissing', 'additionalSerials',
    'serialDetails'
  ];
  const lines = [row(headers)];

  for (const cItem of (d.countedData?.items || [])) {
    const hItem = haloById.get(cItem.id) || {};
    for (const cLoc of (cItem.stockLocations || [])) {
      const hLocMatch = (hItem.stockLocations || []).find(l => l.id === cLoc.id) || {};
      const { expected, found, missing, extra } = serialSummary(cLoc.serialNumbers, cLoc.additionalSerials);

      const expQty = cLoc.expectedQuantity ?? hLocMatch.expectedQuantity ?? '';
      const counted = cLoc.countedQuantity;
      const variance = (counted === null || counted === undefined || expQty === '') ? '' : (counted - expQty);

      const serialDetail = (cLoc.serialNumbers || []).map(s => {
        const parts = [s.serialNumber || `id:${s.id}`];
        if (s.cost !== undefined) parts.push(`cost=${s.cost}`);
        parts.push(s.found ? 'FOUND' : 'MISSING');
        if (s.userName && s.userName !== 'Unassigned') parts.push(`user=${s.userName}`);
        return parts.join('|');
      }).concat((cLoc.additionalSerials || []).map(s => {
        const sn = typeof s === 'string' ? s : (s.serialNumber || `id:${s.id}`);
        return `${sn}|ADDITIONAL`;
      }));

      lines.push(row([
        cItem.id,
        cItem.name,
        hItem.description || '',
        hItem.assetGroupName || '',
        hItem.supplierPartCode || '',
        hItem.isSerialised ? 'yes' : 'no',
        cItem.cost,
        cItem.price,
        cLoc.id,
        cLoc.name,
        hLocMatch.stockBinName || '',
        expQty,
        hLocMatch.reservedQuantity ?? '',
        hLocMatch.availableQuantity ?? '',
        hLocMatch.serialisedAssets ?? '',
        counted === null || counted === undefined ? '' : counted,
        variance,
        cLoc.varianceReason || '',
        cLoc.lastCountedAt || '',
        cLoc.notes || '',
        expected.join('; '),
        found.join('; '),
        missing.join('; '),
        extra.join('; '),
        serialDetail.join('; ')
      ]));
    }
  }

  return lines.join('\n');
}

function buildVariancesCsv(d) {
  const headers = [
    'itemType', 'itemName', 'locationName', 'expected', 'counted', 'found',
    'variance', 'costImpact', 'reason'
  ];
  const lines = [row(headers)];
  for (const v of (d.report?.variances || [])) {
    lines.push(row([
      v.itemType, v.itemName, v.locationName,
      v.expected, v.counted, v.found,
      v.variance, v.costImpact, v.reason || ''
    ]));
  }
  return lines.join('\n');
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const id = pickStocktakeId();
  const file = path.join(DATA_DIR, `stocktake-${id}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Stocktake file not found: ${file}`);
  }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));

  const detailPath = path.join(OUT_DIR, `${id}-detail.csv`);
  const variancePath = path.join(OUT_DIR, `${id}-variances.csv`);
  fs.writeFileSync(detailPath, buildDetailCsv(d));
  fs.writeFileSync(variancePath, buildVariancesCsv(d));

  console.log(`Stocktake: ${d.name} (${id})`);
  console.log(`Status:    ${d.status}`);
  console.log(`Created:   ${d.createdAt}`);
  console.log(`Detail:    ${detailPath}`);
  console.log(`Variances: ${variancePath}`);
}

main();
