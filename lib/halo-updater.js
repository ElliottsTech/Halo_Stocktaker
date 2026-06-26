const axios = require('axios');
require('dotenv').config();

class HaloUpdater {
  constructor() {
    this.baseURL = process.env.HALO_BASE_URL;
    this.tokenURL = process.env.HALO_TOKEN_URL;
    this.clientId = process.env.HALO_CLIENT_ID;
    this.clientSecret = process.env.HALO_CLIENT_SECRET;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Authenticate with Halo API
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
      this.tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;

      console.log('✅ Authenticated with Halo API for updates');
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
   * Update item with UPC code
   */
  async updateItemUPC(itemId, upcCode) {
    await this.ensureAuthenticated();

    try {
      // Get current item data
      const getItemResponse = await axios({
        method: 'GET',
        url: `${this.baseURL}/api/Item/${itemId}`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json'
        }
      });

      const currentItem = getItemResponse.data;

      // Prepare update payload - only include the field we want to update
      const updateData = [{
        "op": "replace",
        "path": "/supplier_part_code",
        "value": upcCode
      }];

      // Make PATCH request to update the item
      const updateResponse = await axios({
        method: 'PATCH',
        url: `${this.baseURL}/api/Item/${itemId}`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json-patch+json'
        },
        data: updateData
      });

      console.log(`✅ Updated UPC for item ${itemId}: ${upcCode}`);
      return { success: true, itemId, upcCode };

    } catch (error) {
      console.error(`❌ Failed to update UPC for item ${itemId}:`, error.message);
      console.log(`Trying alternative method...`);

      // Try alternative method using POST with full item data
      return await this.updateItemUPCAlternative(itemId, upcCode);
    }
  }

  /**
   * Alternative method to update UPC using POST with item data
   */
  async updateItemUPCAlternative(itemId, upcCode, supplierId = null) {
    try {
      // First get current item data
      const getItemResponse = await axios({
        method: 'GET',
        url: `${this.baseURL}/api/Item/${itemId}`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json'
        }
      });

      const currentItem = getItemResponse.data;

      // Prepare update data - only include fields we want to update
      const updateData = [{
        id: itemId
      }];

      // Only include UPC code if it's not NO_UPDATE
      if (upcCode && upcCode !== 'NO_UPDATE') {
        updateData[0].supplier_part_code = upcCode;
      }

      // Add supplier_id if provided
      if (supplierId !== null) {
        updateData[0].supplier_id = supplierId;
      }

      const response = await axios({
        method: 'POST',
        url: `${this.baseURL}/api/Item`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        data: updateData
      });

      console.log(`✅ Updated item ${itemId}: UPC=${upcCode}${supplierId ? ', SupplierID=' + supplierId : ''}`);
      return { success: true, itemId, upcCode, supplierId };

    } catch (error) {
      console.error(`❌ Alternative update failed for item ${itemId}:`, error.message);
      return { success: false, itemId, upcCode, supplierId, error: error.message };
    }
  }

  /**
   * Find supplier ID by name
   */
  async findSupplierId(supplierName) {
    await this.ensureAuthenticated();

    try {
      const suppliersResponse = await axios({
        method: 'GET',
        url: `${this.baseURL}/api/Supplier`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json'
        },
        params: {
          search: supplierName
        }
      });

      if (suppliersResponse.data.suppliers && suppliersResponse.data.suppliers.length > 0) {
        // Try to find exact match
        const exactMatch = suppliersResponse.data.suppliers.find(s =>
          s.name.toLowerCase() === supplierName.toLowerCase()
        );
        return exactMatch ? exactMatch.id : suppliersResponse.data.suppliers[0].id;
      }

      return null;
    } catch (error) {
      console.error(`❌ Failed to find supplier: ${supplierName}`, error.message);
      return null;
    }
  }

  /**
   * Get all suppliers to build a lookup map
   */
  async buildSupplierMap() {
    await this.ensureAuthenticated();

    try {
      const supplierMap = new Map();
      let pageNo = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await axios({
          method: 'GET',
          url: `${this.baseURL}/api/Supplier`,
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Accept': 'application/json'
          },
          params: {
            pageinate: true,
            page_no: pageNo,
            page_size: 100
          }
        });

        if (response.data.suppliers && response.data.suppliers.length > 0) {
          response.data.suppliers.forEach(supplier => {
            supplierMap.set(supplier.name.toLowerCase(), supplier.id);
          });

          if (response.data.suppliers.length < 100) {
            hasMore = false;
          } else {
            pageNo++;
          }
        } else {
          hasMore = false;
        }
      }

      console.log(`✅ Built supplier map with ${supplierMap.size} suppliers`);
      return supplierMap;

    } catch (error) {
      console.error('❌ Failed to build supplier map:', error.message);
      return new Map();
    }
  }

  /**
   * Update item supplier
   */
  async updateItemSupplier(itemId, vendorName) {
    await this.ensureAuthenticated();

    try {
      // First, we need to find the supplier ID from the supplier name
      const suppliersResponse = await axios({
        method: 'GET',
        url: `${this.baseURL}/api/Supplier`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json'
        },
        params: {
          search: vendorName
        }
      });

      let supplierId = null;

      if (suppliersResponse.data.suppliers && suppliersResponse.data.suppliers.length > 0) {
        // Try to find exact match
        const exactMatch = suppliersResponse.data.suppliers.find(s =>
          s.name.toLowerCase() === vendorName.toLowerCase()
        );
        supplierId = exactMatch ? exactMatch.id : suppliersResponse.data.suppliers[0].id;
      }

      if (!supplierId) {
        console.warn(`⚠️ Could not find supplier: ${vendorName} for item ${itemId}`);
        return { success: false, itemId, vendorName, error: 'Supplier not found' };
      }

      // Get current item data
      const getItemResponse = await axios({
        method: 'GET',
        url: `${this.baseURL}/api/Item/${itemId}`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json'
        }
      });

      const currentItem = getItemResponse.data;

      // Prepare update data
      const updateData = [{
        id: itemId,
        supplier_id: supplierId
      }];

      // Make POST request to update the item
      const response = await axios({
        method: 'POST',
        url: `${this.baseURL}/api/Item`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        data: updateData
      });

      console.log(`✅ Updated supplier for item ${itemId}: ${vendorName} (ID: ${supplierId})`);
      return { success: true, itemId, vendorName, supplierId };

    } catch (error) {
      console.error(`❌ Failed to update supplier for item ${itemId}:`, error.message);
      return { success: false, itemId, vendorName, error: error.message };
    }
  }

  /**
   * Batch update items
   */
  async batchUpdateItems(updates) {
    console.log(`🔄 Starting batch update of ${updates.length} items...`);

    const results = {
      total: updates.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    for (let i = 0; i < updates.length; i++) {
      const update = updates[i];
      console.log(`Processing ${i + 1}/${updates.length}: ${update.haloName}`);

      try {
        // Update UPC if needed
        if (update.upcCode && update.upcCode !== update.currentUPC) {
          const upcResult = await this.updateItemUPC(update.haloId, update.upcCode);
          if (upcResult.success) {
            results.successful++;
          } else {
            results.failed++;
            results.errors.push({
              item: update.haloName,
              type: 'UPC',
              error: upcResult.error
            });
          }
        }

        // Update supplier if needed
        if (update.vendor && update.vendor !== update.currentSupplier) {
          const supplierResult = await this.updateItemSupplier(update.haloId, update.vendor);
          if (supplierResult.success) {
            results.successful++;
          } else {
            results.failed++;
            results.errors.push({
              item: update.haloName,
              type: 'Supplier',
              error: supplierResult.error
            });
          }
        }

        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`❌ Error processing ${update.haloName}:`, error.message);
        results.failed++;
        results.errors.push({
          item: update.haloName,
          type: 'General',
          error: error.message
        });
      }
    }

    console.log(`✅ Batch update completed: ${results.successful} successful, ${results.failed} failed`);
    return results;
  }

  /**
   * Test with beacon item
   */
  async testBeaconUpdate() {
    console.log('🧪 Testing beacon item update...');

    try {
      // Update item 414 with UPC 9320422519548
      const result = await this.updateItemUPC(414, '9320422519548');

      if (result.success) {
        console.log('✅ Beacon item update successful!');

        // Verify the update
        const verifyResponse = await axios({
          method: 'GET',
          url: `${this.baseURL}/api/Item/414`,
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Accept': 'application/json'
          }
        });

        const updatedItem = verifyResponse.data;
        console.log(`Verified UPC in Halo: ${updatedItem.supplier_part_code}`);

        return {
          success: true,
          updatedUPC: updatedItem.supplier_part_code,
          expectedUPC: '9320422519548'
        };
      } else {
        console.error('❌ Beacon item update failed');
        return { success: false, error: result.error };
      }

    } catch (error) {
      console.error('❌ Beacon test failed:', error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = HaloUpdater;