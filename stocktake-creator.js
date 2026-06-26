const StocktakeManager = require('./lib/stocktake-manager');
const path = require('path');
const fs = require('fs').promises;

class StocktakeCreator {
  constructor() {
    this.manager = new StocktakeManager();
    this.progressFile = path.join(__dirname, 'data', 'stocktake-progress.json');
  }

  async startCreation(name, options = {}) {
    console.log(`🚀 Starting stocktake creation: ${name}`);

    const creationId = Date.now().toString(36);

    // Initialize progress tracking
    const progress = {
      creationId,
      name,
      status: 'initializing',
      step: 'Starting...',
      progress: 0,
      totalItems: 0,
      processedItems: 0,
      currentItem: null,
      startTime: new Date().toISOString(),
      error: null
    };

    await this.updateProgress(creationId, progress);

    // Start creation in background
    this.createStocktakeInBackground(name, options, creationId);

    return { creationId };
  }

  async createStocktakeInBackground(name, options, creationId) {
    try {
      await this.updateProgress(creationId, {
        status: 'authenticating',
        step: '🔐 Authenticating with Halo API...',
        progress: 5
      });

      // Step 1: Get all items with progress
      await this.updateProgress(creationId, {
        status: 'extracting',
        step: '📊 Fetching items from Halo...',
        progress: 10
      });

      const haloAPI = this.manager.haloAPI;
      const allItems = await this.getAllItemsWithProgress(haloAPI, creationId);

      await this.updateProgress(creationId, {
        status: 'processing',
        step: '📦 Processing inventory data...',
        progress: 70,
        totalItems: allItems.length,
        processedItems: 0
      });

      // Step 2: Get detailed item information including stock locations
      let processedCount = 0;
      const itemsWithDetails = [];

      for (const item of allItems) {
        await this.updateProgress(creationId, {
          currentItem: item.name,
          processedItems: ++processedCount,
          step: `📦 Fetching details: ${item.name}`
        });

        try {
          // Get detailed item information including stock locations
          const itemDetails = await haloAPI.getItemDetails(item.id);

          // Debug: Log first few items to see structure
          if (itemsWithDetails.length < 5) {
            console.log(`🔍 Item: ${item.name}`);
            console.log(`  - stocklocations:`, itemDetails.stocklocations ? 'YES (' + itemDetails.stocklocations.length + ')' : 'NO');
            if (itemDetails.stocklocations && itemDetails.stocklocations.length > 0) {
              console.log(`  - First location:`, JSON.stringify(itemDetails.stocklocations[0], null, 2));
            }
          }

          itemsWithDetails.push(itemDetails);
        } catch (error) {
          console.warn(`Warning getting details for item ${item.name}:`, error.message);
          // Skip items that fail to load details
        }

        const progressPercent = 70 + (processedCount / allItems.length * 20);
        await this.updateProgress(creationId, {
          progress: Math.min(90, progressPercent)
        });
      }

      console.log(`Retrieved detailed information for ${itemsWithDetails.length} items`);

      await this.updateProgress(creationId, {
        status: 'building',
        step: '📝 Categorizing items by stock status...',
        progress: 90
      });

      // Step 3: Categorize items based on detailed information
      const itemsWithStock = [];
      const itemsWithUPC = [];

      for (const itemDetails of itemsWithDetails) {
        try {
          // Check if item has any valid locations (excluding 9999 quantities)
          const hasValidStock = itemDetails.stocklocations && Array.isArray(itemDetails.stocklocations) && itemDetails.stocklocations.some(loc => loc.item_quantity_in_stock > 0 && loc.item_quantity_in_stock !== 9999);
          const hasLocations = itemDetails.stocklocations && Array.isArray(itemDetails.stocklocations) && itemDetails.stocklocations.some(loc => loc.item_quantity_in_stock !== 9999);
          const hasUPC = itemDetails.supplier_part_code && itemDetails.supplier_part_code.trim() !== '';

          // Include items if they have valid stock quantity OR valid stock locations (excluding 9999 quantities)
          if (hasValidStock || hasLocations) {
            itemsWithStock.push(itemDetails);
          } else if (hasUPC) {
            itemsWithUPC.push(itemDetails);
          }
        } catch (error) {
          console.warn(`Warning processing item ${itemDetails.name}:`, error.message);
        }
      }

      console.log(`Found ${itemsWithStock.length} items with stock and ${itemsWithUPC.length} items with UPC only`);

      await this.updateProgress(creationId, {
        status: 'building',
        step: '📝 Building stocktake structure...',
        progress: 95
      });

      // Step 4: Process items into proper stocktake format
      const processedItems = [];

      for (const item of itemsWithStock) {
        try {
          const processedItem = {
            id: item.id,
            name: item.name,
            description: item.description || '',
            assetGroupName: item.assetgroup_name || 'Unknown',
            isSerialised: false, // Will be determined based on actual assets found
            supplierPartCode: item.supplier_part_code || '',
            cost: item.price_cost || 0,
            price: item.price_retail || 0,
            stockLocations: []
          };

          // Process stock locations
          if (item.stocklocations && Array.isArray(item.stocklocations)) {
            for (const location of item.stocklocations) {
              // Include location if it has stock quantity OR any assets (serialised or not)
              const hasStock = location.item_quantity_in_stock > 0;
              const hasSerialisedAssets = location.item_serialised_assets_in_stock > 0;

              // Always try to get assets for all locations to check if there are any serial numbers
              try {
                console.log(`Checking assets for item ${item.id} at location ${location.id} (${item.name})`);
                const assets = await haloAPI.getAssetsByLocation(item.id, location.id);

                // Debug: Show first few asset responses
                if (processedItem.stockLocations.length < 3) {
                  console.log(`Assets response for ${item.name}:`, JSON.stringify(assets, null, 2));
                }

                const hasAssets = assets.assets && assets.assets.length > 0;

                // Only include location if it has stock quantity OR assets
                // Exclude locations with expected quantity of 9999 (special items)
                if ((hasStock || hasAssets) && location.item_quantity_in_stock !== 9999) {
                  const locationData = {
                    id: location.id,
                    name: location.name,
                    stockBinName: location.stockbin_name || location.name,
                    expectedQuantity: location.item_quantity_in_stock,
                    reservedQuantity: location.item_quantity_reserved,
                    availableQuantity: location.item_quantity_available,
                    serialisedAssets: hasAssets ? assets.assets.length : 0,
                    serialNumbers: []
                  };

                  // Process serial numbers if we have assets
                  if (hasAssets) {
                    console.log(`Found ${assets.assets.length} assets for ${item.name}`);

                    // Only mark as serialised and process serials if assets have actual serial numbers
                    const assetsWithSerials = assets.assets.filter(asset =>
                      asset.inventory_number && asset.inventory_number !== `Unknown-${asset.id}` &&
                      !asset.inventory_number.startsWith('Unknown-')
                    );

                    if (assetsWithSerials.length > 0) {
                      locationData.serialNumbers = assetsWithSerials.map(asset => ({
                        id: asset.id,
                        serialNumber: asset.inventory_number || asset.serial_number || `Unknown-${asset.id}`,
                        status: asset.status_id === 0 ? 'in_stock' : 'deployed',
                        userName: asset.username || 'Unassigned',
                        cost: asset.cost || asset.cost_price || asset.purchase_cost || asset.price_cost || 0
                      }));
                      console.log(`Processed ${locationData.serialNumbers.length} serial numbers:`, locationData.serialNumbers);

                      // Mark item as serialised only if we found actual serial numbers
                      processedItem.isSerialised = true;
                    } else {
                      console.log(`Item ${item.name} has assets but no valid serial numbers - treating as non-serialised`);
                    }
                  }

                  processedItem.stockLocations.push(locationData);
                }
              } catch (error) {
                console.warn(`Could not fetch assets for item ${item.id} at location ${location.id}:`, error.message);
                console.error('Full error:', error);

                // Still include location if it has stock even if asset fetch fails
                if (hasStock) {
                  const locationData = {
                    id: location.id,
                    name: location.name,
                    stockBinName: location.stockbin_name || location.name,
                    expectedQuantity: location.item_quantity_in_stock,
                    reservedQuantity: location.item_quantity_reserved,
                    availableQuantity: location.item_quantity_available,
                    serialisedAssets: 0,
                    serialNumbers: []
                  };
                  processedItem.stockLocations.push(locationData);
                }
              }
            }
          }

          processedItems.push(processedItem);
        } catch (error) {
          console.warn(`Warning processing item ${item.name}:`, error.message);
        }
      }

      // Add items with UPC but no stock
      for (const item of itemsWithUPC) {
        const processedItem = {
          id: item.id,
          name: item.name,
          description: item.description || '',
          assetGroupName: item.assetgroup_name || 'Unknown',
          isSerialised: false,
          supplierPartCode: item.supplier_part_code || '',
          stockLocations: [
            {
              id: 'zero-stock',
              name: 'General Stock',
              stockBinName: 'General',
              expectedQuantity: 0,
              reservedQuantity: 0,
              availableQuantity: 0,
              serialisedAssets: 0,
              serialNumbers: []
            }
          ]
        };

        processedItems.push(processedItem);
      }

      await this.updateProgress(creationId, {
        step: '📝 Building stocktake structure...'
      });

      // Step 4: Create the stocktake
      const stocktake = {
        id: this.manager.generateId(),
        name: name,
        createdAt: new Date().toISOString(),
        status: 'in_progress',
        options: {
          includeZeroStock: options.includeZeroStock || false,
          selectedLocations: options.selectedLocations || [],
          selectedCategories: options.selectedCategories || []
        },
        haloData: {
          extractedAt: new Date().toISOString(),
          items: processedItems
        },
        countedData: this.manager.initializeCountedData({
          items: processedItems
        }),
        summary: this.manager.generateSummary({
          items: processedItems
        })
      };

      await this.updateProgress(creationId, {
        status: 'saving',
        step: '💾 Saving stocktake data...',
        progress: 98
      });

      await this.manager.saveStocktake(stocktake);

      await this.updateProgress(creationId, {
        status: 'completed',
        step: '✅ Stocktake created successfully!',
        progress: 100,
        stocktakeId: stocktake.id
      });

      console.log(`✅ Stocktake creation completed: ${stocktake.id}`);

    } catch (error) {
      await this.updateProgress(creationId, {
        status: 'error',
        step: `❌ Error: ${error.message}`,
        error: error.message,
        progress: 0
      });
      console.error(`❌ Stocktake creation failed:`, error);
    }
  }

  async getAllItemsWithProgress(haloAPI, creationId) {
    const allItems = [];
    let pageNo = 1;
    let hasMore = true;
    let totalCount = 0;

    while (hasMore) {
      await this.updateProgress(creationId, {
        step: `📊 Fetching items page ${pageNo}...`
      });

      const response = await haloAPI.apiCall('GET', '/api/Item', {
        show_not_in_stock: true,
        pageinate: true,
        page_no: pageNo,
        page_size: 100
      });

      if (response.items && response.items.length > 0) {
        allItems.push(...response.items);
        totalCount += response.items.length;

        await this.updateProgress(creationId, {
          step: `📊 Fetched ${totalCount} items...`
        });

        const progressPercent = 10 + (pageNo * 15);
        await this.updateProgress(creationId, {
          progress: Math.min(70, progressPercent)
        });

        if (response.items.length < 100) {
          hasMore = false;
        } else {
          pageNo++;
        }
      } else {
        hasMore = false;
      }
    }

    return allItems;
  }

  async updateProgress(creationId, updates) {
    try {
      let allProgress = {};

      try {
        const data = await fs.readFile(this.progressFile, 'utf8');
        allProgress = JSON.parse(data);
      } catch (e) {
        // File doesn't exist yet, create empty object
        allProgress = {};
      }

      // Get existing progress or create new
      if (!allProgress[creationId]) {
        allProgress[creationId] = {};
      }

      // Update with new data
      Object.assign(allProgress[creationId], updates);
      allProgress[creationId].lastUpdate = new Date().toISOString();

      // Ensure directory exists
      await fs.mkdir(path.dirname(this.progressFile), { recursive: true });

      await fs.writeFile(this.progressFile, JSON.stringify(allProgress, null, 2));
    } catch (error) {
      console.error('Failed to update progress:', error);
    }
  }

  async getProgress(creationId) {
    try {
      const data = await fs.readFile(this.progressFile, 'utf8');
      const allProgress = JSON.parse(data);
      return allProgress[creationId] || null;
    } catch (e) {
      return null;
    }
  }
}

module.exports = StocktakeCreator;