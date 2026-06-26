const HaloUpdater = require('./lib/halo-updater');
const axios = require('axios');
const fs = require('fs');

async function fixManufacturerSKUs() {
  console.log('🔧 Fixing Manufacturer SKUs and Supplier Assignments\n');

  try {
    const updater = new HaloUpdater();
    await updater.authenticate();

    // Step 1: Get all items to find ones with "NO_UPDATE"
    console.log('🔍 Step 1: Finding items with "NO_UPDATE" Manufacturer SKUs...');

    const allItems = [];
    let pageNo = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await axios({
        method: 'GET',
        url: `${updater.baseURL}/api/Item`,
        headers: {
          'Authorization': `Bearer ${updater.accessToken}`,
          'Accept': 'application/json'
        },
        params: {
          show_not_in_stock: true,
          pageinate: true,
          page_no: pageNo,
          page_size: 100
        }
      });

      if (response.data.items && response.data.items.length > 0) {
        allItems.push(...response.data.items);

        if (response.data.items.length < 100) {
          hasMore = false;
        } else {
          pageNo++;
        }
      } else {
        hasMore = false;
      }
    }

    console.log(`✅ Total items in system: ${allItems.length}`);

    // Step 2: Find items with "NO_UPDATE" and get the correct SKU from CSV
    console.log('\n📋 Step 2: Loading correct Manufacturer SKUs from CSV...');

    const csvPath = './products.csv';
    const csvData = fs.readFileSync(csvPath, 'utf8');
    const lines = csvData.split('\n');
    const header = lines[0].split(',');

    // Find column indices
    const nameIndex = header.indexOf('name');
    const upcIndex = header.indexOf('upc_code');
    const vendorIndex = header.indexOf('vendor');
    const leaderSystemsSkuIndex = header.indexOf('Leader Systems-SKU');
    const lhGroupSkuIndex = header.indexOf('L&H Group-SKU');

    console.log(`📊 CSV column indices: name=${nameIndex}, upc_code=${upcIndex}, vendor=${vendorIndex}`);
    console.log(`📊 SKU columns: Leader Systems=${leaderSystemsSkuIndex}, L&H Group=${lhGroupSkuIndex}`);

    const skuMap = new Map();

    for (let i = 1; i < lines.length; i++) { // Skip header
      const line = lines[i];
      if (!line.trim()) continue;

      const columns = line.split(',');
      if (columns.length > upcIndex) {
        const name = columns[nameIndex].trim();
        const upcCode = columns[upcIndex].trim();
        const vendor = columns[vendorIndex]?.trim();
        const leaderSystemsSku = columns[leaderSystemsSkuIndex]?.trim();
        const lhGroupSku = columns[lhGroupSkuIndex]?.trim();

        // Use UPC code if available and not N/A, otherwise use supplier-specific SKU
        let manufacturerSku = null;
        if (upcCode && upcCode !== 'N/A' && upcCode !== '') {
          manufacturerSku = upcCode;
        }

        if (manufacturerSku) {
          skuMap.set(name.toLowerCase(), manufacturerSku);
        }
      }
    }

    console.log(`✅ Loaded ${skuMap.size} Manufacturer SKUs from CSV`);

    // Step 3: Get Leader Systems supplier ID
    console.log('\n🏢 Step 3: Getting Leader Systems supplier ID...');
    const leaderSystemsId = await updater.findSupplierId('Leader Systems');

    if (!leaderSystemsId) {
      console.log('❌ Could not find Leader Systems supplier');
      return;
    }

    console.log(`✅ Leader Systems ID: ${leaderSystemsId}`);

    // Step 4: Process items that need fixing
    console.log('\n🔄 Step 4: Processing items that need Manufacturer SKU and/or supplier fixes...');

    const itemsToFix = [];

    for (const item of allItems) {
      const needsSkuFix = item.supplier_part_code === 'NO_UPDATE' || !item.supplier_part_code;
      const needsSupplierFix = item.supplier_name && item.supplier_name.toLowerCase().includes('l&h group');

      // Strip emoji prefixes from item name for matching
      const cleanName = item.name.replace(/^[^\w\s]*\s*/, '').toLowerCase().trim();
      const hasSkuInCsv = skuMap.has(cleanName);

      if (needsSkuFix || needsSupplierFix) {
        itemsToFix.push({
          id: item.id,
          name: item.name,
          cleanName: cleanName,
          currentUPC: item.supplier_part_code,
          needsSkuFix: needsSkuFix && hasSkuInCsv,
          needsSupplierFix: needsSupplierFix,
          correctSku: hasSkuInCsv ? skuMap.get(cleanName) : null,
          currentSupplier: item.supplier_name
        });
      }
    }

    console.log(`\n🎯 Found ${itemsToFix.length} items that need fixes`);

    if (itemsToFix.length === 0) {
      console.log('✅ No items need fixing!');
      return;
    }

    // Show sample of items to fix
    console.log('\n📋 Sample of items to fix:');
    itemsToFix.slice(0, 10).forEach((item, index) => {
      console.log(`   ${index + 1}. ${item.name}`);
      console.log(`      Current UPC: "${item.currentUPC}"`);
      if (item.needsSkuFix) {
        console.log(`      → Correct SKU: "${item.correctSku}"`);
      }
      if (item.needsSupplierFix) {
        console.log(`      Current Supplier: "${item.currentSupplier}" → Leader Systems`);
      }
    });

    if (itemsToFix.length > 10) {
      console.log(`   ... and ${itemsToFix.length - 10} more items`);
    }

    // Step 5: Execute fixes
    console.log(`\n🚀 Step 5: Executing fixes for items with Manufacturer SKUs in CSV...`);

    // Filter to only items that actually have Manufacturer SKUs to restore
    const itemsWithSkuFixes = itemsToFix.filter(item => item.needsSkuFix);
    const itemsWithSupplierFixes = itemsToFix.filter(item => item.needsSupplierFix && !item.needsSkuFix);

    console.log(`📊 Found ${itemsWithSkuFixes.length} items with Manufacturer SKUs to restore`);
    console.log(`📊 Found ${itemsWithSupplierFixes.length} items that need supplier updates only`);

    const totalUpdates = itemsWithSkuFixes.length + itemsWithSupplierFixes.length;
    const results = {
      total: totalUpdates,
      successful: 0,
      failed: 0,
      skuRestored: 0,
      suppliersUpdated: 0,
      errors: []
    };

    // First, fix items with Manufacturer SKUs
    console.log(`\n🔄 Part 1: Restoring Manufacturer SKUs...`);
    for (let i = 0; i < itemsWithSkuFixes.length; i++) {
      const item = itemsWithSkuFixes[i];
      const progress = ((i + 1) / itemsWithSkuFixes.length * 100).toFixed(1);

      console.log(`\n[${i + 1}/${itemsWithSkuFixes.length}] ${progress}% - ${item.name}`);
      console.log(`   UPC: ${item.currentUPC} → ${item.correctSku}`);
      if (item.needsSupplierFix) {
        console.log(`   Supplier: ${item.currentSupplier} → Leader Systems`);
      }

      try {
        const supplierId = item.needsSupplierFix ? leaderSystemsId : null;

        const result = await updater.updateItemUPCAlternative(
          item.id,
          item.correctSku,
          supplierId
        );

        if (result.success) {
          results.successful++;
          results.skuRestored++;
          if (item.needsSupplierFix) {
            results.suppliersUpdated++;
          }
          console.log(`   ✅ Fix successful`);
        } else {
          results.failed++;
          results.errors.push({
            item: item.name,
            error: result.error
          });
          console.log(`   ❌ Fix failed: ${result.error}`);
        }

        // Rate limiting
        if ((i + 1) % 10 === 0) {
          console.log('   ⏸️  Pausing briefly...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (error) {
        console.error(`   ❌ Error processing ${item.name}:`, error.message);
        results.failed++;
        results.errors.push({
          item: item.name,
          error: error.message
        });
      }
    }

    // Then, fix items with supplier changes only
    console.log(`\n🔄 Part 2: Updating suppliers to Leader Systems...`);
    for (let i = 0; i < itemsWithSupplierFixes.length; i++) {
      const item = itemsWithSupplierFixes[i];
      const progress = ((i + 1) / itemsWithSupplierFixes.length * 100).toFixed(1);

      console.log(`\n[${i + 1}/${itemsWithSupplierFixes.length}] ${progress}% - ${item.name}`);
      console.log(`   Supplier: ${item.currentSupplier} → Leader Systems`);

      try {
        const result = await updater.updateItemUPCAlternative(
          item.id,
          'NO_UPDATE', // Don't change the UPC
          leaderSystemsId
        );

        if (result.success) {
          results.successful++;
          results.suppliersUpdated++;
          console.log(`   ✅ Supplier updated`);
        } else {
          results.failed++;
          results.errors.push({
            item: item.name,
            error: result.error
          });
          console.log(`   ❌ Update failed: ${result.error}`);
        }

        // Rate limiting
        if ((i + 1) % 10 === 0) {
          console.log('   ⏸️  Pausing briefly...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (error) {
        console.error(`   ❌ Error processing ${item.name}:`, error.message);
        results.failed++;
        results.errors.push({
          item: item.name,
          error: error.message
        });
      }
    }

    // Final report
    console.log('\n📋 FINAL FIX REPORT:');
    console.log('='.repeat(50));
    console.log(`Total Fixes Attempted: ${results.total}`);
    console.log(`✅ Successful Fixes: ${results.successful}`);
    console.log(`❌ Failed Fixes: ${results.failed}`);
    console.log(`📊 Manufacturer SKUs Restored: ${results.skuRestored}`);
    console.log(`🏢 Suppliers Updated to Leader Systems: ${results.suppliersUpdated}`);
    console.log(`📈 Success Rate: ${((results.successful / results.total) * 100).toFixed(1)}%`);

    if (results.errors.length > 0) {
      console.log(`\n❌ Errors Encountered: ${results.errors.length}`);
      results.errors.slice(0, 10).forEach((error, index) => {
        console.log(`   ${index + 1}. ${error.item}: ${error.error}`);
      });
    }

    console.log('\n🎉 MANUFACTURER SKU AND SUPPLIER FIX COMPLETED!');
    console.log(`\n📊 Final Statistics:`);
    console.log(`✅ ${results.skuRestored} Manufacturer SKUs restored`);
    console.log(`🏢 ${results.suppliersUpdated} suppliers updated to Leader Systems`);
    console.log(`✅ Success rate: ${((results.successful / results.total) * 100).toFixed(1)}%`);

    return results;

  } catch (error) {
    console.error('❌ Fix process failed:', error.message);
    throw error;
  }
}

// Execute the fix
fixManufacturerSKUs()
  .then((results) => {
    console.log('\n🎉 PROCESS COMPLETED SUCCESSFULLY!');
    console.log(`\n📊 Summary:`);
    console.log(`✅ ${results.skuRestored} Manufacturer SKUs restored`);
    console.log(`🏢 ${results.suppliersUpdated} suppliers updated to Leader Systems`);
    console.log(`✅ Success rate: ${((results.successful / results.total) * 100).toFixed(1)}%`);
    process.exit(results.failed > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error('\n💥 Critical error during fix:', error);
    process.exit(1);
  });