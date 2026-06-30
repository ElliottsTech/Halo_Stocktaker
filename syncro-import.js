#!/usr/bin/env node
/**
 * One-off import: Syncro product-serial IDs -> Halo Asset inventory_number.
 *
 * Modes:
 *   node syncro-import.js --dry-run    Resolve all Syncro IDs, build plan, write data/syncro-import-dryrun.json (default)
 *   node syncro-import.js --test-one   Apply first non-skip/flag record from dry run
 *   node syncro-import.js --apply      Apply all non-skip/flag records from dry run
 *
 * Halo key is read-only until --test-one/--apply. Dry run only does GETs.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { SyncroAPI } = require('./lib/syncro-api');

const HALO_BASE = process.env.HALO_BASE_URL;
const HALO_TOKEN_URL = process.env.HALO_TOKEN_URL;
const DATA_DIR = path.join(__dirname, 'data');
const DRYRUN_PATH = path.join(DATA_DIR, 'syncro-import-dryrun.json');
const RESULTS_PATH = path.join(DATA_DIR, 'syncro-import-results.json');
const PRODUCTS_CSV = path.join(__dirname, 'products.csv');

const EMOJI_LEADING_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s‍️]+/u;

// ---------- Halo auth ----------

let accessToken = null;
let tokenExpiry = 0;

async function haloAuth() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;
  const resp = await axios.post(HALO_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.HALO_CLIENT_ID,
      client_secret: process.env.HALO_CLIENT_SECRET,
      scope: 'all'
    }),
    { headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  accessToken = resp.data.access_token;
  tokenExpiry = Date.now() + (resp.data.expires_in - 60) * 1000;
  return accessToken;
}

async function haloGetAsset(assetId) {
  const tok = await haloAuth();
  const resp = await axios.get(`${HALO_BASE}/api/Asset/${assetId}`, {
    headers: { 'Authorization': `Bearer ${tok}`, 'Accept': 'application/json' }
  });
  return resp.data;
}

async function haloPostAsset(payload) {
  const tok = await haloAuth();
  const resp = await axios.post(`${HALO_BASE}/api/Asset`,
    Array.isArray(payload) ? payload : [payload],
    { headers: { 'Authorization': `Bearer ${tok}`, 'Accept': 'application/json', 'Content-Type': 'application/json' } }
  );
  return resp.data;
}

// ---------- products.csv ----------

function loadProducts() {
  const text = fs.readFileSync(PRODUCTS_CSV, 'utf8');
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  const nameIdx = headers.indexOf('name');
  const idIdx = headers.indexOf('id');
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCsvLine(lines[i]);
    const name = (cols[nameIdx] || '').trim().toLowerCase();
    const id = cols[idIdx];
    if (name && id) map.set(name, id);
  }
  return map;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function stripEmoji(name) {
  if (!name) return '';
  let stripped = name.replace(EMOJI_LEADING_RE, '').trim();
  return stripped.toLowerCase();
}

// ---------- stocktake cache ----------

function latestStocktakePath() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => /^stocktake-.+\.json$/.test(f) && !f.includes('progress'))
    .map(f => ({ f, mtime: fs.statSync(path.join(DATA_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) throw new Error('No stocktake cache found in data/');
  return path.join(DATA_DIR, files[0].f);
}

function collectSerialisedAssets(cache) {
  const out = [];
  for (const item of (cache.haloData?.items || [])) {
    if (!item.isSerialised) continue;
    const itemName = item.name;
    const itemId = item.id;
    for (const loc of (item.stockLocations || [])) {
      for (const sn of (loc.serialNumbers || [])) {
        out.push({
          haloItemId: itemId,
          haloItemName: itemName,
          haloAssetId: sn.id,
          cachedSerial: sn.serialNumber,
          location: loc.stockBinName || loc.name
        });
      }
    }
  }
  return out;
}

// ---------- decision logic ----------

function decideAction(currentTag, currentSerial, syncroFormattedId) {
  const tag = (currentTag || '').trim();
  const serial = (currentSerial || '').trim();

  if (!tag && !serial) {
    return { action: 'skip', reason: 'both_blank', newTag: null, newSerial: null, flag: true };
  }
  if (!tag && serial) {
    return { action: 'set_tag', reason: 'tag_missing_serial_present', newTag: syncroFormattedId, newSerial: null, flag: false };
  }
  if (tag && !serial) {
    return { action: 'copy_tag_to_serial_then_replace', reason: 'serial_missing_tag_present', newTag: syncroFormattedId, newSerial: tag, flag: false };
  }
  // both present
  if (tag === serial) {
    return { action: 'replace_tag', reason: 'tag_equals_serial', newTag: syncroFormattedId, newSerial: null, flag: false };
  }
  return { action: 'flag_review', reason: 'tag_and_serial_differ', newTag: syncroFormattedId, newSerial: null, flag: true };
}

// ---------- dry run ----------

async function dryRun() {
  const cachePath = latestStocktakePath();
  console.log(`Loading cache: ${cachePath}`);
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const assets = collectSerialisedAssets(cache);
  console.log(`Serialised assets in cache: ${assets.length}`);

  const products = loadProducts();
  console.log(`products.csv loaded: ${products.size} entries`);

  const syncro = new SyncroAPI();
  const plan = [];

  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    const progress = `[${i + 1}/${assets.length}]`;
    const stripped = stripEmoji(a.haloItemName);
    const productId = products.get(stripped);

    if (!productId) {
      console.log(`${progress} asset=${a.haloAssetId} NO_PRODUCT_MATCH name=${JSON.stringify(a.haloItemName)}`);
      plan.push({
        assetId: a.haloAssetId,
        itemId: a.haloItemId,
        itemName: a.haloItemName,
        strippedName: stripped,
        currentTag: null,
        currentSerial: null,
        syncroProductId: null,
        syncroSerialId: null,
        syncroFormattedId: null,
        action: 'skip',
        reason: 'no_product_match',
        flag: true
      });
      continue;
    }

    let fresh;
    try {
      fresh = await haloGetAsset(a.haloAssetId);
    } catch (err) {
      console.log(`${progress} asset=${a.haloAssetId} HALO_FETCH_FAILED ${err.message}`);
      plan.push({
        assetId: a.haloAssetId,
        itemId: a.haloItemId,
        itemName: a.haloItemName,
        strippedName: stripped,
        currentTag: null,
        currentSerial: null,
        syncroProductId: productId,
        syncroSerialId: null,
        syncroFormattedId: null,
        action: 'skip',
        reason: `halo_fetch_failed: ${err.message}`,
        flag: true
      });
      continue;
    }

    const currentTag = fresh.inventory_number || '';
    const currentSerial = fresh.key_field || '';

    const { id: syncroId, status: syncroStatus } = await syncro.findSerialId(productId, currentSerial);
    if (!syncroId) {
      console.log(`${progress} asset=${a.haloAssetId} SYNCRO_NOT_FOUND name=${JSON.stringify(a.haloItemName)} serial=${currentSerial}`);
      plan.push({
        assetId: a.haloAssetId,
        itemId: a.haloItemId,
        itemName: a.haloItemName,
        strippedName: stripped,
        currentTag,
        currentSerial,
        syncroProductId: productId,
        syncroSerialId: null,
        syncroFormattedId: null,
        action: 'skip',
        reason: 'syncro_serial_not_found',
        flag: true
      });
      continue;
    }

    const syncroFormattedId = `I-${syncroId}`;
    const decision = decideAction(currentTag, currentSerial, syncroFormattedId);
    console.log(`${progress} asset=${a.haloAssetId} action=${decision.action} name=${JSON.stringify(a.haloItemName)} tag=${currentTag} serial=${currentSerial} -> ${syncroFormattedId}`);

    plan.push({
      assetId: a.haloAssetId,
      itemId: a.haloItemId,
      itemName: a.haloItemName,
      strippedName: stripped,
      currentTag,
      currentSerial,
      syncroProductId: productId,
      syncroSerialId: syncroId,
      syncroSerialStatus: syncroStatus,
      syncroFormattedId,
      action: decision.action,
      reason: decision.reason,
      newTag: decision.newTag,
      newSerial: decision.newSerial,
      flag: decision.flag
    });

    await new Promise(r => setTimeout(r, 50));
  }

  fs.writeFileSync(DRYRUN_PATH, JSON.stringify(plan, null, 2));
  console.log(`\nDry run written: ${DRYRUN_PATH} (${plan.length} records)`);

  printSummary(plan);
}

function printSummary(plan) {
  const counts = {};
  for (const r of plan) counts[r.action] = (counts[r.action] || 0) + 1;

  console.log('\n=== SUMMARY ===');
  console.log('Total assets:', plan.length);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);

  const flagged = plan.filter(r => r.flag);
  if (flagged.length) {
    console.log(`\n=== FLAGGED FOR REVIEW (${flagged.length}) ===`);
    for (const r of flagged.slice(0, 50)) {
      console.log(`  asset=${r.assetId} action=${r.action} reason=${r.reason}`);
      console.log(`    name=${JSON.stringify(r.itemName)} tag=${JSON.stringify(r.currentTag)} serial=${JSON.stringify(r.currentSerial)} syncroProductId=${r.syncroProductId}`);
    }
    if (flagged.length > 50) console.log(`  ... and ${flagged.length - 50} more (see ${DRYRUN_PATH})`);
  }
}

// ---------- test-one / apply ----------

async function loadPlan() {
  if (!fs.existsSync(DRYRUN_PATH)) throw new Error(`No dry run file at ${DRYRUN_PATH}. Run --dry-run first.`);
  return JSON.parse(fs.readFileSync(DRYRUN_PATH, 'utf8'));
}

function buildHaloPayload(r) {
  const payload = { id: r.assetId, inventory_number: r.newTag };
  if (r.action === 'copy_tag_to_serial_then_replace') {
    payload.key_field = r.newSerial;
  }
  return payload;
}

async function applyOne(r) {
  const before = await haloGetAsset(r.assetId);
  const payload = buildHaloPayload(r);
  console.log('  Payload:', JSON.stringify(payload));
  await haloPostAsset(payload);
  const after = await haloGetAsset(r.assetId);
  return {
    assetId: r.assetId,
    action: r.action,
    before: { inventory_number: before.inventory_number, key_field: before.key_field },
    after: { inventory_number: after.inventory_number, key_field: after.key_field },
    success: true
  };
}

async function testOne() {
  const plan = await loadPlan();
  const candidates = plan.filter(r => !r.flag && r.action !== 'skip');
  if (!candidates.length) throw new Error('No applicable records in dry run.');
  const r = candidates[0];
  console.log(`Test-one on asset ${r.assetId}:`);
  console.log(`  name=${JSON.stringify(r.itemName)} action=${r.action}`);
  console.log(`  before tag=${JSON.stringify(r.currentTag)} serial=${JSON.stringify(r.currentSerial)}`);
  console.log(`  target tag=${JSON.stringify(r.newTag)} serial=${JSON.stringify(r.newSerial)}`);
  try {
    const result = await applyOne(r);
    fs.writeFileSync(RESULTS_PATH, JSON.stringify([result], null, 2));
    console.log('  Result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('  FAILED:', err.response ? JSON.stringify(err.response.data) : err.message);
    process.exit(1);
  }
}

async function applyAll() {
  const plan = await loadPlan();
  const candidates = plan.filter(r => !r.flag && r.action !== 'skip');
  console.log(`Applying ${candidates.length} of ${plan.length} records...`);
  const results = [];
  for (let i = 0; i < candidates.length; i++) {
    const r = candidates[i];
    process.stdout.write(`[${i + 1}/${candidates.length}] asset=${r.assetId} ${r.action}... `);
    try {
      const result = await applyOne(r);
      results.push(result);
      console.log('OK');
    } catch (err) {
      const msg = err.response ? JSON.stringify(err.response.data).slice(0, 200) : err.message;
      console.log(`FAIL ${msg}`);
      results.push({ assetId: r.assetId, action: r.action, success: false, error: msg });
    }
    await new Promise(res => setTimeout(res, 100));
  }
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  const ok = results.filter(r => r.success).length;
  console.log(`\nDone. ${ok}/${results.length} succeeded. Results: ${RESULTS_PATH}`);
}

// ---------- entry ----------

const mode = process.argv[2] || '--dry-run';
(async () => {
  try {
    if (mode === '--dry-run' || mode === 'dry-run') await dryRun();
    else if (mode === '--test-one' || mode === 'test-one') await testOne();
    else if (mode === '--apply' || mode === 'apply') await applyAll();
    else { console.error(`Unknown mode: ${mode}`); process.exit(2); }
  } catch (err) {
    console.error('FATAL:', err.message);
    process.exit(1);
  }
})();
