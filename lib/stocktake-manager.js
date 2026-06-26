const fs = require('fs').promises;
const path = require('path');
const HaloAPI = require('./halo-api');

class StocktakeManager {
  constructor() {
    this.haloAPI = new HaloAPI();
    this.dataDir = path.join(__dirname, '..', 'data');
  }

  /**
   * Create new stocktake session
   */
  async createStocktake(name, options = {}) {
    console.log(`Creating stocktake: ${name}`);

    // Extract current data from Halo
    const haloData = await this.haloAPI.extractStocktakeData();

    // Create stocktake session
    const stocktake = {
      id: this.generateId(),
      name: name,
      createdAt: new Date().toISOString(),
      status: 'in_progress', // in_progress, completed, cancelled
      options: {
        includeZeroStock: options.includeZeroStock || false,
        selectedLocations: options.selectedLocations || [],
        selectedCategories: options.selectedCategories || []
      },
      haloData: haloData,
      countedData: this.initializeCountedData(haloData),
      summary: this.generateSummary(haloData)
    };

    // Save to file
    await this.saveStocktake(stocktake);

    console.log(`✅ Stocktake created: ${stocktake.id}`);
    return stocktake;
  }

  /**
   * Initialize counted data structure
   */
  initializeCountedData(haloData) {
    const countedData = {
      items: [],
      completedAt: null,
      completedBy: null
    };

    for (const item of haloData.items) {
      const countedItem = {
        id: item.id,
        name: item.name,
        stockLocations: []
      };

      for (const location of item.stockLocations) {
        const countedLocation = {
          id: location.id,
          name: location.name,
          expectedQuantity: location.expectedQuantity,
          countedQuantity: null, // To be filled during stocktake
          serialNumbers: location.serialNumbers.map(serial => ({
            id: serial.id,
            serialNumber: serial.serialNumber,
            expected: true,
            found: false, // To be checked during stocktake
            notes: ''
          })),
          additionalSerials: [], // Serials found but not expected
          notes: ''
        };

        countedItem.stockLocations.push(countedLocation);
      }

      countedData.items.push(countedItem);
    }

    return countedData;
  }

  /**
   * Generate summary of stocktake
   */
  generateSummary(haloData) {
    let totalItems = 0;
    let totalSerialised = 0;
    let totalNonSerialised = 0;
    let totalLocations = 0;

    const locationCounts = new Map();
    const categoryCounts = new Map();

    for (const item of haloData.items) {
      totalItems++;

      if (item.isSerialised) {
        totalSerialised++;
      } else {
        totalNonSerialised++;
      }

      // Safety check for stockLocations
      if (item.stockLocations && Array.isArray(item.stockLocations)) {
        for (const location of item.stockLocations) {
          totalLocations++;

          const locName = location.stockBinName || location.name;
          locationCounts.set(locName, (locationCounts.get(locName) || 0) + 1);

          const catName = item.assetGroupName || 'Unknown';
          categoryCounts.set(catName, (categoryCounts.get(catName) || 0) + 1);
        }
      }
    }

    return {
      totalItems,
      totalSerialised,
      totalNonSerialised,
      totalLocations,
      locations: Object.fromEntries(locationCounts),
      categories: Object.fromEntries(categoryCounts)
    };
  }

  /**
   * Save stocktake to file
   */
  async saveStocktake(stocktake) {
    const filename = `stocktake-${stocktake.id}.json`;
    const filepath = path.join(this.dataDir, filename);

    await fs.writeFile(filepath, JSON.stringify(stocktake, null, 2));

    // Also update the index
    await this.updateIndex(stocktake);

    return filepath;
  }

  /**
   * Update stocktake index
   */
  async updateIndex(stocktake) {
    const indexPath = path.join(this.dataDir, 'index.json');

    let index = [];
    try {
      const data = await fs.readFile(indexPath, 'utf8');
      index = JSON.parse(data);
    } catch (error) {
      // Index doesn't exist yet, create new one
    }

    // Update or add entry
    const existingIndex = index.findIndex(s => s.id === stocktake.id);
    const entry = {
      id: stocktake.id,
      name: stocktake.name,
      createdAt: stocktake.createdAt,
      status: stocktake.status,
      summary: stocktake.summary
    };

    if (existingIndex >= 0) {
      index[existingIndex] = entry;
    } else {
      index.push(entry);
    }

    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  }

  /**
   * Load stocktake by ID
   */
  async loadStocktake(id) {
    const filename = `stocktake-${id}.json`;
    const filepath = path.join(this.dataDir, filename);

    const data = await fs.readFile(filepath, 'utf8');
    return JSON.parse(data);
  }

  /**
   * Update index file
   */
  async updateIndexFile(index) {
    const indexPath = path.join(this.dataDir, 'index.json');
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  }

  /**
   * List all stocktakes
   */
  async listStocktakes() {
    const indexPath = path.join(this.dataDir, 'index.json');

    try {
      const data = await fs.readFile(indexPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  /**
   * Update counted quantity for non-serialised item
   */
  async updateCountedQuantity(stocktakeId, itemId, locationId, countedQuantity) {
    const stocktake = await this.loadStocktake(stocktakeId);

    const item = stocktake.countedData.items.find(i => i.id === itemId);
    if (item) {
      const location = item.stockLocations.find(l => l.id === locationId);
      if (location) {
        location.countedQuantity = parseInt(countedQuantity);
        await this.saveStocktake(stocktake);
        return true;
      }
    }

    return false;
  }

  /**
   * Update serial number verification
   */
  async updateSerialNumber(stocktakeId, itemId, locationId, serialId, found) {
    const stocktake = await this.loadStocktake(stocktakeId);

    const item = stocktake.countedData.items.find(i => i.id === itemId);
    if (item) {
      const location = item.stockLocations.find(l => l.id === locationId);
      if (location) {
        const serial = location.serialNumbers.find(s => s.id === serialId);
        if (serial) {
          serial.found = found;
          await this.saveStocktake(stocktake);
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Add additional serial number found during stocktake
   */
  async addAdditionalSerial(stocktakeId, itemId, locationId, serialNumber) {
    const stocktake = await this.loadStocktake(stocktakeId);

    const item = stocktake.countedData.items.find(i => i.id === itemId);
    if (item) {
      const location = item.stockLocations.find(l => l.id === locationId);
      if (location) {
        location.additionalSerials.push({
          id: this.generateId(),
          serialNumber: serialNumber,
          notes: ''
        });
        await this.saveStocktake(stocktake);
        return true;
      }
    }

    return false;
  }

  /**
   * Complete stocktake and generate report
   */
  async completeStocktake(stocktakeId, completedBy = 'System') {
    const stocktake = await this.loadStocktake(stocktakeId);

    stocktake.status = 'completed';
    stocktake.countedData.completedAt = new Date().toISOString();
    stocktake.countedData.completedBy = completedBy;
    stocktake.report = this.generateDifferentialReport(stocktake);

    await this.saveStocktake(stocktake);

    console.log(`✅ Stocktake completed: ${stocktakeId}`);
    return stocktake;
  }

  /**
   * Delete stocktake
   */
  async deleteStocktake(stocktakeId) {
    try {
      // Remove from index
      const index = await this.listStocktakes();
      const updatedIndex = index.filter(s => s.id !== stocktakeId);
      await this.updateIndexFile(updatedIndex);

      // Try to delete individual stocktake file if it exists
      const filePath = path.join(this.dataDir, `stocktake-${stocktakeId}.json`);
      try {
        await fs.unlink(filePath);
      } catch (fileError) {
        // File doesn't exist, which is fine - just continue with index deletion
        console.log(`Individual file for ${stocktakeId} doesn't exist, removing from index only`);
      }

      console.log(`🗑️ Stocktake deleted: ${stocktakeId}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to delete stocktake ${stocktakeId}:`, error.message);
      throw error;
    }
  }

  /**
   * Generate differential report
   */
  generateDifferentialReport(stocktake) {
    const report = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalItemsChecked: 0,
        itemsWithVariance: 0,
        totalVariance: 0,
        serialisedVariance: 0,
        nonSerialisedVariance: 0,
        unexpectedItems: 0
      },
      variances: [],
      missingSerials: [],
      unexpectedSerials: [],
      unexpectedItems: [], // Items scanned but not expected (0 expected quantity)
      locationSummaries: []
    };

    const locationVarianceMap = new Map();

    // Compare counted vs expected
    for (const countedItem of stocktake.countedData.items) {
      const haloItem = stocktake.haloData.items.find(i => i.id === countedItem.id);

      if (haloItem) {
        for (const countedLocation of countedItem.stockLocations) {
          const haloLocation = haloItem.stockLocations.find(l => l.id === countedLocation.id);

          // Handle items that were counted but have no corresponding expected data (scanned unexpected items)
          if (!haloLocation && (countedLocation.countedQuantity > 0 || countedLocation.serialNumbers?.some(s => s.found))) {
            report.summary.unexpectedItems++;
            report.summary.itemsWithVariance++;

            const counted = countedLocation.countedQuantity || 0;
            const foundSerials = countedLocation.serialNumbers?.filter(s => s.found).length || 0;

            report.unexpectedItems.push({
              itemName: haloItem.name,
              upc: haloItem.supplierPartCode || 'N/A',
              locationName: countedLocation.name,
              countedQuantity: counted,
              foundSerials: foundSerials,
              itemType: haloItem.isSerialised ? 'serialised' : 'non_serialised'
            });

            // Add to variance summary
            const variance = haloItem.isSerialised ? foundSerials : counted;
            report.summary.totalVariance += variance;

            if (haloItem.isSerialised) {
              report.summary.serialisedVariance += Math.abs(variance);
            } else {
              report.summary.nonSerialisedVariance += Math.abs(variance);
            }

            continue;
          }

          if (haloLocation) {
            report.summary.totalItemsChecked++;

            // Initialize location summary
            if (!locationVarianceMap.has(countedLocation.name)) {
              locationVarianceMap.set(countedLocation.name, {
                locationName: countedLocation.name,
                itemVariance: 0,
                missingSerials: 0,
                unexpectedSerials: 0
              });
            }

            const locationSummary = locationVarianceMap.get(countedLocation.name);

            if (haloItem.isSerialised) {
              // Handle serialised items
              const expectedSerials = haloLocation.serialNumbers.length;
              const foundSerials = countedLocation.serialNumbers.filter(s => s.found).length;
              const variance = foundSerials - expectedSerials;

              if (variance !== 0) {
                report.summary.serialisedVariance += Math.abs(variance);
                report.summary.itemsWithVariance++;

                report.variances.push({
                  itemType: 'serialised',
                  itemName: haloItem.name,
                  locationName: countedLocation.name,
                  expected: expectedSerials,
                  found: foundSerials,
                  variance: variance
                });

                locationSummary.itemVariance += Math.abs(variance);
              }

              // Track missing serials
              const missingSerials = countedLocation.serialNumbers.filter(s => !s.found);
              if (missingSerials.length > 0) {
                report.missingSerials.push({
                  itemName: haloItem.name,
                  locationName: countedLocation.name,
                  serialNumbers: missingSerials.map(s => s.serialNumber)
                });

                locationSummary.missingSerials += missingSerials.length;
              }

              // Track unexpected serials
              if (countedLocation.additionalSerials.length > 0) {
                report.unexpectedSerials.push({
                  itemName: haloItem.name,
                  locationName: countedLocation.name,
                  serialNumbers: countedLocation.additionalSerials.map(s => s.serialNumber)
                });

                locationSummary.unexpectedSerials += countedLocation.additionalSerials.length;
              }

              // Use variance from serialised calculation
              report.summary.totalVariance += Math.abs(variance);

            } else {
              // Handle non-serialised items
              const expected = haloLocation.expectedQuantity;
              const counted = countedLocation.countedQuantity || 0;
              const variance = counted - expected;

              if (variance !== 0) {
                report.summary.nonSerialisedVariance += Math.abs(variance);
                report.summary.itemsWithVariance++;

                report.variances.push({
                  itemType: 'non_serialised',
                  itemName: haloItem.name,
                  locationName: countedLocation.name,
                  expected: expected,
                  counted: counted,
                  variance: variance
                });

                locationSummary.itemVariance += Math.abs(variance);
              }

              // Use variance from non-serialised calculation
              report.summary.totalVariance += Math.abs(variance);
            }
          }
        }
      }
    }

    // Convert location map to array
    report.locationSummaries = Array.from(locationVarianceMap.values());

    return report;
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Initialize data directory
   */
  async initialize() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      console.log('✅ Data directory initialized');
    } catch (error) {
      console.error('❌ Failed to initialize data directory:', error.message);
      throw error;
    }
  }
}

module.exports = StocktakeManager;