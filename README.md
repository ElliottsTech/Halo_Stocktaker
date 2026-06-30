# Halo Stocktake System

Inventory management + stocktake + label generation for Halo PSA. Handles serialised and non-serialised items across multiple locations.

## Getting Started

### Prerequisites
- Node.js v16+
- Halo API credentials with scopes: `read:items`, `read:assets`, `read:suppliers`, `read:pos`

### Installation

```bash
npm install
```

Configure `.env`:
```
HALO_CLIENT_ID=...
HALO_CLIENT_SECRET=...
HALO_BASE_URL=https://halo.example.com
HALO_TOKEN_URL=https://halo.example.com/auth/token
PORT=3000

# IP allowlist (DNS-resolved; leave empty to disable in dev)
ALLOWLIST_HOST=ourips.elliotts.tech
PROXY_IP=172.16.55.10
```

Run:
```bash
npm start
```

Open `http://localhost:3000`.

## Features

### Stocktake
- Create sessions with live Halo data extraction
- Count by location (Stock site / Stock bin)
- Serialised items: per-asset verification by serial/inventory_number
- Non-serialised items: quantity entry
- Capture additional/unexpected serials during counting
- Refresh individual items from Halo (syncs serials + stock locations, prunes gone serials, adds new expected ones, downgrades items when all serials are `Unknown-*` placeholders)
- Edit mode: add/remove items, lock counted column when idle
- IP allowlist (DNS-resolved, X-Forwarded-For aware behind HAProxy)

### Reports
- Dense client-side report: all counted items with cost / price / expected / counted / variance / counted$ / variance$ / reason
- Variance table with reasons + cost impact totals
- Negative values colour-coded red
- Server-generated A4 PDF (pdfkit), accountant-ready
- PDFs cached to `data/reports/`, regenerable on demand, deletable from UI

### Label Generator (Dymo 99010, 28mm × 89mm)
Three modes:
1. **Purchase Order** — enter PO ref (e.g. `P50128-1`), generates one label per received unit
2. **Product Lookup** — typeahead across all Halo items, select to pull in-stock instances
3. **Asset / Serial** — search by asset tag or serial number, single label

Per label:
- Item name (emoji stripped) + sell price (ex-GST × 1.1 for inc-GST)
- Description, SKU (`qbosku`), Halo Product ID
- Barcode: serialised items use `inventory_number` → `key_field` → UPC fallback; non-serialised items use UPC/EAN → SKU → item ID
- Auto symbology: 12-digit → UPC-A, 13-digit → EAN-13, else Code128

## API Endpoints

### Stocktake
- `GET  /api/stocktakes` — list all
- `GET  /api/stocktake/:id` — full session (lazy report upgrade)
- `POST /api/start-stocktake-creation` — async creation with progress polling
- `GET  /api/stocktake-progress/:creationId`
- `POST /api/create-stocktake` — sync creation
- `POST /api/update-quantity`
- `POST /api/update-serial`
- `POST /api/add-serial`
- `POST /api/update-variance-reason`
- `POST /api/reopen-stocktake`
- `POST /api/refresh-halo` — re-pull selected items, reconcile countedData
- `POST /api/stocktake/:id/add-item` — add Halo item to active stocktake
- `POST /api/stocktake/:id/remove-item`
- `POST /api/complete-stocktake`
- `DELETE /api/stocktake/:id`

### Reports
- `GET  /api/stocktake/:id/report-pdf` — generate + cache A4 PDF
- `GET  /api/reports` — list cached PDFs
- `GET  /api/reports/:filename` — serve cached PDF
- `DELETE /api/reports/:filename` — remove cached PDF

### Labels
- `GET  /api/po/search?q=` — PO search
- `GET  /api/po/:id` — PO with pre-expanded labels
- `GET  /api/products` — list all items for typeahead
- `GET  /api/products/:id/instances` — in-stock instances + pre-expanded labels
- `GET  /api/asset-lookup?q=` — asset/serial lookup
- `POST /api/labels/generate` — generate Dymo 99010 PDF

## Architecture

### Backend
- `server.js` — Express server + routes + IP allowlist
- `lib/halo-api.js` — Halo OAuth2 client (token auto-refresh), PO/item/asset extraction, label-shape mapping
- `lib/stocktake-manager.js` — session persistence, counting, reconciliation, differential report
- `lib/label-generator.js` — pdfkit + bwip-js, Dymo 99010 layout
- `lib/report-generator.js` — pdfkit A4 report with dense tables

### Frontend
- `public/index.html` — single-page app, vanilla JS, tabs: Dashboard / New / Active / Reports / Labels

### Storage
- File-based JSON in `data/`
- `data/index.json` — stocktake index
- `data/stocktake-*.json` — sessions
- `data/reports/` — cached PDFs

## Technical Notes

- Halo's `supplier_part_code` field often contains garbage; real UPC lives in `qbosku` — `pickUPC()` validates both
- Halo assets may have no `inventory_number`; barcode helper falls back to `key_field` (real serial) → UPC → `A<id>`
- PO line `price`/`baseprice` is purchase cost; sell price must be fetched from item details (`item.baseprice`)
- Refresh logic syncs stockLocations to countedData so updates don't 404 after stock moves
- `Unknown-*` placeholder serials (assets with no key_field/inventory_number) trigger downgrade to non-serialised when all serials are placeholders

## Deployment

Production (this repo runs under systemd):
```ini
[Service]
WorkingDirectory=/root/halo_stocktake
ExecStart=/usr/bin/node server.js
EnvironmentFile=/root/halo_stocktake/.env
Restart=on-failure
```

Reverse proxy: HAProxy → Express. The allowlist middleware trusts `X-Forwarded-For` only when the TCP source is `PROXY_IP`.

## License

Internal — Elliotts Tech.
