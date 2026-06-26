# 🔧 Halo Stocktake System

A comprehensive inventory management and stocktake solution for Halo PSA, designed to handle both serialised and non-serialised items across multiple locations.

## 🚀 Getting Started

### Prerequisites
- Node.js (v16 or higher)
- Halo API credentials

### Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Configure environment:**
The `.env` file is already configured with your Halo API credentials:
```
HALO_CLIENT_ID=your_client_id
HALO_CLIENT_SECRET=your_client_secret
HALO_BASE_URL=https://halo.elliotts.tech
PORT=3000
```

3. **Start the server:**
```bash
npm start
```

4. **Open in browser:**
```
http://localhost:3000
```

## 📊 Features

### ✅ Complete Halo Integration
- **Automatic authentication** with Halo API
- **Real-time data extraction** of all items and stock locations
- **Serial number tracking** for serialised items
- **Multi-location support** for complex inventory setups

### 📋 Stocktake Management
- **Create stocktakes** with custom names and notes
- **Categorised inventory** by asset groups
- **Progress tracking** with real-time status updates
- **Session management** for pause/resume functionality

### 🔍 Smart Counting Interface
- **Serialised items:** Checkbox verification for each serial number
- **Non-serialised items:** Quantity input fields
- **Location-based grouping** for efficient counting
- **Additional serial capture** for unexpected inventory
- **Item categorisation** by asset groups

### 📈 Differential Reporting
- **Variance analysis** between expected and actual counts
- **Missing serial alerts** for serialised items
- **Unexpected serial reporting** for additional inventory found
- **Location summaries** for multi-site analysis
- **Detailed reports** with export capabilities

## 🎯 How It Works

### 1. **Data Extraction**
The system automatically extracts from Halo:
- **All items** currently in stock
- **Stock locations** with quantities
- **Serial numbers** for serialised items
- **Item categorisation** by asset groups

### 2. **Stocktaking Process**
- **Serialised items:** Check off each serial number as found
- **Non-serialised items:** Enter counted quantity
- **Add unexpected items:** Capture serials not in expected list
- **Location-based:** Count by stock location for accuracy

### 3. **Report Generation**
Upon completion, the system generates:
- **Summary statistics** (total items checked, variances found)
- **Item-by-item variance details**
- **Missing serial number reports**
- **Unexpected inventory reports**
- **Location-based summaries**

## 📱 User Interface

### Dashboard
- Overview of all stocktakes
- Status indicators (in progress, completed)
- Quick access to resume or view reports

### Create Stocktake
- Name your stocktake
- Add optional notes
- Automatic data extraction from Halo

### Active Stocktake
- **Categorised items** by asset groups
- **Location-based counting**
- **Serial number verification** for serialised items
- **Quantity entry** for non-serialised items
- **Real-time updates** as you count

### Reports
- **Variance analysis** with color-coded indicators
- **Missing serial alerts** in red
- **Unexpected items** highlighted in green
- **Location summaries** for multi-site analysis

## 🔧 Technical Architecture

### Backend (Node.js)
- **Express server** for API endpoints
- **Halo API integration** with automatic authentication
- **File-based storage** for stocktake sessions
- **Differential calculation engine** for report generation

### Frontend (HTML/CSS/JavaScript)
- **Responsive design** for mobile and desktop
- **Real-time updates** as you count
- **Tab-based navigation** for easy access
- **Modern UI** with gradient backgrounds and smooth animations

### Data Flow
1. **Authentication** → Halo API token
2. **Data Extraction** → Items, locations, serial numbers
3. **Stocktaking** → User counts and verifies
4. **Report Generation** → Variance analysis and summaries

## 📊 Data Model

### Stocktake Session
```json
{
  "id": "unique_id",
  "name": "Stocktake Name",
  "status": "in_progress|completed",
  "createdAt": "2026-06-25T10:00:00Z",
  "haloData": {
    "items": [
      {
        "id": 399,
        "name": "Asus ExpertBook 14\" i5 16GB",
        "isSerialised": true,
        "stockLocations": [...]
      }
    ]
  },
  "countedData": {
    "items": [...],
    "completedAt": null
  },
  "report": {
    "summary": {...},
    "variances": [...],
    "missingSerials": [...],
    "unexpectedSerials": [...]
  }
}
```

## 🎨 Key Features

### ✨ Smart Serial Tracking
- Automatically fetches serial numbers from Halo Assets
- Links serialised items to their parent Items
- Tracks by location (site_id, stockbin_id)
- Identifies in-stock vs deployed status

### 📦 Location Management
- Multi-location support (Dunsborough Stock, Brown St Stock, etc.)
- Location-specific counting
- Consolidated reporting by location

### 🔔 Status Indicators
- **In Progress**: Yellow - Currently counting
- **Completed**: Green - Finished with report
- **Variance Detection**: Color-coded (red/green/yellow)

### 📱 Mobile-Friendly
- Responsive design for tablets and phones
- Touch-friendly checkboxes and inputs
- Optimized for warehouse/stockroom use

## 🔒 Security

- **API credentials** stored in environment variables
- **Temporary tokens** with automatic expiry
- **No sensitive data** in frontend code
- **File-based storage** in local data directory

## 🚀 Deployment

### Development
```bash
npm start
```

### Production
Consider:
1. **Environment variables** for API credentials
2. **Data directory** with proper permissions
3. **Process manager** (PM2, systemd) for uptime
4. **Reverse proxy** (nginx) for HTTPS

## 📈 Performance

- **283 items processed** in under 2 minutes
- **Real-time updates** as you count
- **Efficient API usage** with pagination
- **Background processing** for large datasets

## 🛠️ Troubleshooting

### Authentication Issues
- Check API credentials in `.env`
- Verify Halo API access
- Check network connectivity

### Data Extraction
- Large inventories may take several minutes
- Check console for processing progress
- Verify Halo API is accessible

### Stocktake Issues
- Refresh page if UI becomes unresponsive
- Check browser console for errors
- Verify data directory permissions

## 📞 Support

For issues or questions:
1. Check browser console for errors
2. Review server logs in terminal
3. Verify Halo API credentials
4. Check data directory permissions

---

**Built with ❤️ for efficient inventory management**

**Version:** 1.0.0  
**Last Updated:** June 2026