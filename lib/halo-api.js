const axios = require('axios');
require('dotenv').config();

class HaloAPI {
  constructor() {
    this.baseURL = process.env.HALO_BASE_URL;
    this.tokenURL = process.env.HALO_TOKEN_URL;
    this.clientId = process.env.HALO_CLIENT_ID;
    this.clientSecret = process.env.HALO_CLIENT_SECRET;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Authenticate with Halo API and get access token
   */
  async authenticate() {
    try {
      const response = await axios.post(this.tokenURL,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          scope: 'all'
        }),
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      this.accessToken = response.data.access_token;
      // Set expiry to 1 minute before actual expiry for safety
      this.tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;

      console.log('✅ Authenticated with Halo API');
      return this.accessToken;
    } catch (error) {
      console.error('❌ Authentication failed:', error.message);
      throw new Error(`Halo API authentication failed: ${error.message}`);
    }
  }

  /**
   * Ensure we have a valid token
   */
  async ensureAuthenticated() {
    if (!this.accessToken || !this.tokenExpiry || Date.now() >= this.tokenExpiry) {
      await this.authenticate();
    }
    return this.accessToken;
  }

  /**
   * Make authenticated API call
   */
  async apiCall(method, endpoint, params = {}) {
    await this.ensureAuthenticated();

    try {
      const response = await axios({
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json'
        },
        params
      });

      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        // Token might be expired, try re-authenticating
        await this.authenticate();
        return this.apiCall(method, endpoint, params);
      }
      throw error;
    }
  }

  /**
   * Get all items with stock (including serialised items with 0 quantity)
   */
  async getItemsWithStock() {
    const allItems = [];
    let pageNo = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.apiCall('GET', '/api/Item', {
        show_not_in_stock: false,
        pageinate: true,
        page_no: pageNo,
        page_size: 100
      });

      if (response.items && response.items.length > 0) {
        // Include items that have stock OR serialised assets
        const itemsWithStockOrSerials = response.items.filter(item => {
          const hasStock = item.stocklocations && Array.isArray(item.stocklocations) &&
            item.stocklocations.some(loc => loc.item_quantity_in_stock > 0);
          const hasSerialisedAssets = item.stocklocations && Array.isArray(item.stocklocations) &&
            item.stocklocations.some(loc => loc.item_serialised_assets_in_stock > 0);
          return hasStock || hasSerialisedAssets;
        });

        allItems.push(...itemsWithStockOrSerials);

        // Check if there are more pages
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

  /**
   * Get all items with UPC codes (including zero stock items)
   */
  async getAllItemsWithUPC() {
    const allItems = [];
    let pageNo = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.apiCall('GET', '/api/Item', {
        show_not_in_stock: true, // Include items not in stock
        pageinate: true,
        page_no: pageNo,
        page_size: 100
      });

      if (response.items && response.items.length > 0) {
        // Filter to only include items with UPC codes
        const itemsWithUPC = response.items.filter(item => item.supplier_part_code && item.supplier_part_code.trim() !== '');
        allItems.push(...itemsWithUPC);

        // Check if there are more pages
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

  /**
   * Get detailed item information including stock locations
   */
  async getItemDetails(itemId) {
    return await this.apiCall('GET', `/api/Item/${itemId}`, {
      includedetails: true
    });
  }

  /**
   * Get assets for a specific item (serialised items)
   */
  async getAssetsForItem(itemId, siteId = null) {
    const params = {
      item_id: itemId,
      client_id: 12 // Elliotts Tech - internal stock
    };

    // Don't filter by status_id to get all assets (both in stock and deployed)
    if (siteId) {
      params.site_id = siteId;
    }

    console.log(`Fetching assets for item ${itemId}${siteId ? ` at site ${siteId}` : ''}`);
    const response = await this.apiCall('GET', '/api/Asset', params);
    console.log(`Found ${response.assets?.length || 0} assets for item ${itemId}`);
    return response;
  }

  /**
   * Get assets by item and location
   */
  async getAssetsByLocation(itemId, locationId) {
    return await this.getAssetsForItem(itemId, locationId);
  }

  /**
   * Get individual asset details (includes stockdetails.cost)
   */
  async getAssetDetails(assetId) {
    return await this.apiCall('GET', `/api/Asset/${assetId}`);
  }

  /**
   * Extract complete stocktake data
   */
  async extractStocktakeData() {
    console.log('📊 Extracting stocktake data from Halo...');

    // Get all items with stock
    const items = await this.getItemsWithStock();
    console.log(`Found ${items.length} items with stock`);

    // Get all items with UPC codes (including zero stock items)
    const itemsWithUPC = await this.getAllItemsWithUPC();
    console.log(`Found ${itemsWithUPC.length} items with UPC codes (including zero stock)`);

    // Create a set of item IDs that we already have from stock items
    const stockItemIds = new Set(items.map(item => item.id));

    // Add items with UPC but no stock
    const zeroStockItems = itemsWithUPC.filter(item => !stockItemIds.has(item.id));
    console.log(`Adding ${zeroStockItems.length} items with UPC but zero expected quantity`);

    const stocktakeData = {
      extractedAt: new Date().toISOString(),
      items: []
    };

    // Process items with stock
    for (const item of items) {
      console.log(`Processing item: ${item.name}`);

      // Get detailed information
      const itemDetails = await this.getItemDetails(item.id);

      // Check if any location has serialised assets
      const hasSerialisedAssets = itemDetails.stocklocations &&
        itemDetails.stocklocations.some(loc => loc.item_serialised_assets_in_stock > 0);

      const itemData = {
        id: item.id,
        name: item.name,
        description: item.description || '',
        assetGroupName: item.assetgroup_name || 'Unknown',
        isSerialised: hasSerialisedAssets,
        supplierPartCode: item.supplier_part_code || '',
        cost: item.costprice || 0,
        price: item.baseprice || 0,
        stockLocations: []
      };

      // Process each stock location
      if (itemDetails.stocklocations && itemDetails.stocklocations.length > 0) {
        for (const location of itemDetails.stocklocations) {
          // Include location if it has stock quantity OR serialised assets
          const hasStock = location.item_quantity_in_stock > 0;
          const hasSerialisedAssets = location.item_serialised_assets_in_stock > 0;

          if (hasStock || hasSerialisedAssets) {
            const locationData = {
              id: location.id,
              name: location.name,
              stockBinName: location.stockbin_name || location.name,
              expectedQuantity: location.item_quantity_in_stock,
              reservedQuantity: location.item_quantity_reserved,
              availableQuantity: location.item_quantity_available,
              serialisedAssets: location.item_serialised_assets_in_stock,
              serialNumbers: []
            };

            // Get serial numbers if this is a serialised item with serialised assets
            if (itemData.isSerialised && hasSerialisedAssets) {
              try {
                const assets = await this.getAssetsByLocation(item.id, location.id);

                if (assets.assets && assets.assets.length > 0) {
                  // Fetch per-asset cost from individual asset details (stockdetails.cost)
                  const serials = [];
                  for (const asset of assets.assets) {
                    let assetCost = 0;
                    try {
                      const detail = await this.getAssetDetails(asset.id);
                      assetCost = detail.stockdetails?.cost || 0;
                    } catch (e) {
                      // Cost unavailable, default to 0
                    }
                    serials.push({
                      id: asset.id,
                      serialNumber: asset.inventory_number || `Unknown-${asset.id}`,
                      status: asset.status_id === 0 ? 'in_stock' : 'deployed',
                      userName: asset.username || 'Unassigned',
                      cost: assetCost
                    });
                  }
                  locationData.serialNumbers = serials;
                }
              } catch (error) {
                console.warn(`Could not fetch assets for item ${item.id} at location ${location.id}:`, error.message);
              }
            }

            itemData.stockLocations.push(locationData);
          }
        }
      }

      stocktakeData.items.push(itemData);
    }

    // Process items with UPC but zero stock
    for (const item of zeroStockItems) {
      console.log(`Adding zero-stock item with UPC: ${item.name} (${item.supplier_part_code})`);

      const itemData = {
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

      stocktakeData.items.push(itemData);
    }

    console.log(`✅ Extracted data for ${stocktakeData.items.length} items (including ${zeroStockItems.length} zero-stock UPC items)`);
    return stocktakeData;
  }
}

module.exports = HaloAPI;