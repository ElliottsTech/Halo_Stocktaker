# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Halo Stocktake System - a comprehensive inventory management solution for Halo PSA that handles both serialised and non-serialised items across multiple locations.

## Development Commands

### Start the development server
```bash
npm start
# Server runs on http://localhost:3000
```

### Install dependencies
```bash
npm install
```

### Run in development mode
```bash
npm run dev
```

## Architecture

### Backend (Node.js/Express)
- **`server.js`** - Main Express server with API endpoints
- **`lib/halo-api.js`** - Halo API integration with authentication and data extraction
- **`lib/stocktake-manager.js`** - Stocktake business logic and session management

### Frontend
- **`public/index.html`** - Single-page application with embedded CSS and JavaScript

### Data Storage
- **`data/`** - Stocktake sessions stored as JSON files
- **`data/index.json`** - Index of all stocktakes

## Key Technical Concepts

### Halo API Integration
- Uses OAuth2 client credentials flow
- Token auto-refresh on expiry (401 responses)
- Handles pagination for large datasets
- Extracts both Items and Assets (for serialised items)

### Serialised vs Non-Serialised Items
- **Serialised items**: Tracked as individual Assets with serial numbers
- **Non-serialised items**: Tracked by quantity only
- System automatically distinguishes via `item_serialised_assets_in_stock` field

### Stock Status Detection
- **In-stock assets**: `status_id: 0`, empty `username`, site_name contains "Stock"
- **Deployed assets**: `status_id: 1`, assigned `username`
- **Internal stock**: `client_id: 12` (Elliotts Tech)

### Data Flow
1. **Create Stocktake** → Authenticate with Halo → Extract all items/locations/serials
2. **Counting Phase** → User verifies serials or enters quantities → Real-time updates
3. **Complete** → Generate differential report → Calculate variances

## API Endpoints

### GET `/api/stocktakes`
List all stocktakes (index data only)

### GET `/api/stocktake/:id`
Get full stocktake session data

### POST `/api/create-stocktake`
Create new stocktake and extract Halo data
- Body: `{ name, notes }`
- Returns: Full stocktake object

### POST `/api/update-quantity`
Update counted quantity for non-serialised item
- Body: `{ stocktakeId, itemId, locationId, countedQuantity }`

### POST `/api/update-serial`
Update serial number verification status
- Body: `{ stocktakeId, itemId, locationId, serialId, found }`

### POST `/api/add-serial`
Add additional serial number found during counting
- Body: `{ stocktakeId, itemId, locationId, serialNumber }`

### POST `/api/complete-stocktake`
Complete stocktake and generate differential report
- Body: `{ stocktakeId }`
- Returns: Stocktake with generated report

## Common Development Tasks

### Adding new Halo API fields
1. Update `lib/halo-api.js` extraction logic
2. Update data models in `lib/stocktake-manager.js`
3. Update UI in `public/index.html` to display new fields

### Modifying report generation
Edit `generateDifferentialReport()` method in `lib/stocktake-manager.js`

### Adding new UI features
1. Update HTML structure in `public/index.html`
2. Add corresponding API endpoints in `server.js`
3. Implement business logic in `lib/stocktake-manager.js`

## Important Constraints

### Halo API Rate Limiting
- Implement proper delays between API calls
- Use pagination to avoid timeouts
- Handle 401 responses with token refresh

### Large Dataset Handling
- 283+ items with multiple locations each
- Serialised items require additional API calls
- Consider progress indicators for long operations

### Data Consistency
- Always save stocktake state after modifications
- Validate data structure before saving
- Handle concurrent access scenarios

## Environment Variables

Required in `.env`:
```
HALO_CLIENT_ID=your_client_id
HALO_CLIENT_SECRET=your_client_secret
HALO_BASE_URL=https://halo.elliotts.tech
HALO_TOKEN_URL=https://halo.elliotts.tech/auth/token
PORT=3000
```

## File Structure

```
├── server.js                    # Express server
├── package.json                 # Dependencies
├── .env                         # Environment variables
├── lib/
│   ├── halo-api.js            # Halo API integration
│   └── stocktake-manager.js   # Business logic
├── public/
│   └── index.html             # Frontend application
├── data/                       # Stocktake sessions (generated)
│   ├── index.json             # Stocktake index
│   └── stocktake-*.json       # Individual sessions
└── README.md                   # User documentation
```

## Troubleshooting

### Authentication fails
- Verify `HALO_CLIENT_ID` and `HALO_CLIENT_SECRET` in `.env`
- Check Halo API is accessible
- Ensure token URL is correct

### Data extraction timeouts
- Halo API can be slow with large datasets
- Check server logs for processing progress
- Consider reducing page_size in API calls

### Stocktake creation fails
- Check data directory permissions
- Verify sufficient disk space
- Review server error logs

### UI not updating
- Check browser console for JavaScript errors
- Verify API endpoints are responding
- Check network connectivity to localhost:3000

## Testing the System

1. **Start server**: `npm start`
2. **Open browser**: `http://localhost:3000`
3. **Create stocktake**: Enter name and submit
4. **Wait for extraction**: Monitor server logs
5. **Count items**: Use checkbox for serials, input for quantities
6. **Complete stocktake**: Generate differential report
7. **View reports**: Check variances and missing items

## Performance Notes

- Initial extraction takes 2-3 minutes for 283 items
- Each serialised item requires additional API call
- File-based storage is fast but not suitable for high concurrency
- Consider database for production use with multiple users