#!/usr/bin/env node
/**
 * Patch serial data in existing stocktake JSON files.
 *
 * Background: extraction previously stored asset inventory_number (e.g. "I-12345")
 * under `serialNumber`. Real serial lives in Halo's `key_field`. Current
 * lib/halo-api.js now stores both correctly (serialNumber=key_field,
 * assetTag=inventory_number) but already-saved stocktakes have stale data.
 *
 * This script:
 *   1. Backs up the data directory to data-backup-<timestamp>/
 *   2. For each stocktake, fetches asset key_field + inventory_number from Halo
 *      keyed by asset id (one API call per serialised item_id).
 *   3. Patches haloData.items[].stockLocations[].serialNumbers[] in place:
 *        - serialNumber = key_field (real serial)
 *        - assetTag     = inventory_number
 *      And countedData.items[].stockLocations[].serialNumbers[]:
 *        - preserves id/cost/found/notes/expected
 *        - assetTag     = old serialNumber (which was the inventory_number)
 *        - serialNumber = key_field
 *   4. Writes the JSON back.
 *
 * Counted state (found / additionalSerials / quantities) is NEVER touched —
 * only the labelling of the serial field is corrected. If a serial was
 * counted by scanning the asset tag, that match remains valid because
 * barcodeLookup keys by both serialNumber and assetTag.
 *
 * Usage: node patch-serials.js [stocktakeId]
 *   omit stocktakeId to patch all stocktake-*.json files in data/
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const HaloAPI = require('./lib/halo-api');

const DATA_DIR = path.join(__dirname, 'data');

function listStocktakes() {
  return fs.readdirSync(DATA_DIR)
    .filter(f => /^stocktake-.*\.json$/.test(f) && !f.startsWith('stocktake-progress'))
    .map(f => f.replace(/^stocktake-/, '').replace(/\.json$/, ''));
}

function backupDataDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = path.join(__dirname, `data-backup-${stamp}`);
  fs.mkdirSync(backup, { recursive: true });
  for (const f of fs.readdirSync(DATA_DIR)) {
    fs.copyFileSync(path.join(DATA_DIR, f), path.join(backup, f));
  }
  console.log(`Backed up data/ -> ${backup}`);
  return backup;
}

async function buildAssetMap(halo, stocktake) {
  // asset id -> { key_field, inventory_number }
  const map = new Map();
  const serialisedItems = (stocktake.haloData?.items || []).filter(i => i.isSerialised);

  for (const item of serialisedItems) {
    try {
      const resp = await halo.apiCall('GET', '/api/Asset', {
        item_id: item.id,
        client_id: 12
      });
      for (const a of (resp.assets || [])) {
        map.set(a.id, {
          key_field: a.key_field || '',
          inventory_number: a.inventory_number || ''
        });
      }
    } catch (e) {
      console.warn(`  item ${item.id}: asset fetch failed - ${e.message}`);
    }
  }
  return map;
}

function patchSerial(obj, assetMap, source) {
  if (!obj) return 0;
  let touched = 0;
  const keyField = assetMap.get(obj.id);
  if (!keyField) return 0;

  if (source === 'halo') {
    // haloData currently lacks assetTag entirely and serialNumber has inventory_number
    const newSerial = keyField.key_field || obj.serialNumber;
    const newTag = keyField.inventory_number || '';
    if (obj.serialNumber !== newSerial || obj.assetTag !== newTag) {
      obj.serialNumber = newSerial;
      obj.assetTag = newTag;
      touched = 1;
    }
  } else {
    // countedData: old serialNumber held inventory_number; preserve as assetTag
    const oldSerial = obj.serialNumber;
    const newSerial = keyField.key_field || oldSerial;
    const newTag = keyField.inventory_number || oldSerial || '';
    if (obj.serialNumber !== newSerial || obj.assetTag !== newTag) {
      obj.serialNumber = newSerial;
      obj.assetTag = newTag;
      touched = 1;
    }
  }
  return touched;
}

async function patchStocktake(halo, id) {
  const file = path.join(DATA_DIR, `stocktake-${id}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`  not found: ${file}`);
    return;
  }
  const stocktake = JSON.parse(fs.readFileSync(file, 'utf8'));

  const assetMap = await buildAssetMap(halo, stocktake);
  console.log(`  fetched ${assetMap.size} asset records from Halo`);

  let haloTouched = 0, countedTouched = 0;
  for (const item of (stocktake.haloData?.items || [])) {
    for (const loc of (item.stockLocations || [])) {
      for (const s of (loc.serialNumbers || [])) {
        haloTouched += patchSerial(s, assetMap, 'halo');
      }
    }
  }
  for (const item of (stocktake.countedData?.items || [])) {
    for (const loc of (item.stockLocations || [])) {
      for (const s of (loc.serialNumbers || [])) {
        countedTouched += patchSerial(s, assetMap, 'counted');
      }
    }
  }
  console.log(`  haloData serials updated:    ${haloTouched}`);
  console.log(`  countedData serials updated: ${countedTouched}`);

  fs.writeFileSync(file, JSON.stringify(stocktake, null, 2));
  console.log(`  saved ${file}`);
}

async function main() {
  const halo = new HaloAPI();
  await halo.authenticate();

  backupDataDir();

  const ids = process.argv[2] ? [process.argv[2]] : listStocktakes();
  if (!ids.length) {
    console.log('No stocktakes found.');
    return;
  }
  for (const id of ids) {
    console.log(`\nPatching stocktake ${id}:`);
    await patchStocktake(halo, id);
  }
  console.log('\nDone.');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
