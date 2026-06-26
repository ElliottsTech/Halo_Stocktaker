const ProductMatcher = require('./lib/product-matcher');
const HaloUpdater = require('./lib/halo-updater');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function executeBulkUpdates() {
  console.log('🚀 Executing Bulk Product Updates\n');

  try {
    // Initialize components
    const matcher = new ProductMatcher();
    const updater = new HaloUpdater();

    // Step 1: Prepare data
    console.log('📊 Step 1: Preparing update data...');
    const csvPath = path.join(__dirname, 'products.csv');
    matcher.parseCSV(csvPath);

    const stocktakePath = path.join(__dirname, 'data', 'stocktake-mqsz53tm3ir38sg3ctt.json');
    const stocktakeData = JSON.parse(fs.readFileSync(stocktakePath, 'utf8'));
    matcher.loadHaloItems(stocktakeData.haloData);

    matcher.matchProducts();
    const report = matcher.generateUpdateReport();

    console.log(`✅ Total updates prepared: ${report.upcUpdates.length + report.supplierUpdates.length}`);

    // Step 2: Build supplier map for efficient lookups
    console.log('\n🔍 Step 2: Building supplier lookup map...');
    const supplierMap = await updater.buildSupplierMap();
    console.log(`✅ Supplier map built with ${supplierMap.size} suppliers`);

    // Step 3: Prepare combined updates
    console.log('\n🔄 Step 3: Preparing combined updates...');
    const updatesNeeded = [];

    // Create a map to track which items have been updated
    const updatedItems = new Set();

    // Add UPC updates
    report.upcUpdates.forEach(update => {
      if (!updatedItems.has(update.haloId)) {
        updatesNeeded.push({
          haloId: update.haloId,
          haloName: update.haloName,
          upcCode: update.upcCode,
          currentUPC: update.currentUPC,
          vendor: report.beaconItem?.vendor || null,
          type: 'BOTH'
        });
        updatedItems.add(update.haloId);
      }
    });

    // Add supplier-only updates (for items that don't need UPC updates)
    report.supplierUpdates.forEach(update => {
      if (!updatedItems.has(update.haloId)) {
        updatesNeeded.push({
          haloId: update.haloId,
          haloName: update.haloName,
          upcCode: 'NO_UPDATE', // Don't overwrite existing UPC
          vendor: update.vendor,
          currentSupplier: update.currentSupplier,
          type: 'SUPPLIER_ONLY'
        });
        updatedItems.add(update.haloId);
      }
    });

    console.log(`✅ Combined updates prepared: ${updatesNeeded.length} unique items`);

    // Step 4: Execute updates
    console.log('\n🚀 Step 4: Executing bulk updates...');
    console.log(`This will update ${updatesNeeded.length} items with UPC codes and/or suppliers`);

    const results = {
      total: updatesNeeded.length,
      successful: 0,
      failed: 0,
      errors: [],
      upcUpdates: 0,
      supplierUpdates: 0
    };

    // Process updates in batches to avoid overwhelming the API
    const batchSize = 50;
    for (let i = 0; i < updatesNeeded.length; i++) {
      const update = updatesNeeded[i];
      const progress = ((i + 1) / updatesNeeded.length * 100).toFixed(1);

      console.log(`\n[${i + 1}/${updatesNeeded.length}] ${progress}% - ${update.haloName}`);
      console.log(`   UPC: ${update.currentUPC || 'None'} → ${update.upcCode || 'No change'}`);
      console.log(`   Supplier: ${update.currentSupplier || 'None'} → ${update.vendor || 'No change'}`);

      try {
        let supplierId = null;

        // Find supplier ID if vendor is specified
        if (update.vendor) {
          // Map L&H Group to Leader Systems
          const mappedVendor = update.vendor.toLowerCase().includes('l&h') ? 'Leader Systems' : update.vendor;
          const vendorLower = mappedVendor.toLowerCase();

          if (supplierMap.has(vendorLower)) {
            supplierId = supplierMap.get(vendorLower);
            console.log(`   ✅ Found supplier ID: ${supplierId} for "${update.vendor}" → Leader Systems`);
          } else {
            console.log(`   ⚠️  Supplier not found: "${update.vendor}"`);
            results.failed++;
            results.errors.push({
              item: update.haloName,
              type: 'Supplier Lookup',
              error: `Supplier "${update.vendor}" not found`
            });
            continue; // Skip this update
          }
        }

        // Execute the update
        const result = await updater.updateItemUPCAlternative(
          update.haloId,
          update.upcCode || 'NO_UPDATE',
          supplierId
        );

        if (result.success) {
          results.successful++;

          // Track what was updated
          if (update.upcCode && update.upcCode !== 'NO_UPDATE') {
            results.upcUpdates++;
          }
          if (supplierId) {
            results.supplierUpdates++;
          }

          console.log(`   ✅ Update successful`);

          // Small delay to avoid rate limiting
          if ((i + 1) % 10 === 0) {
            console.log('   ⏸️  Pausing briefly to avoid rate limiting...');
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

        } else {
          results.failed++;
          results.errors.push({
            item: update.haloName,
            type: 'Update Failed',
            error: result.error
          });
          console.log(`   ❌ Update failed: ${result.error}`);
        }

      } catch (error) {
        console.error(`   ❌ Error processing ${update.haloName}:`, error.message);
        results.failed++;
        results.errors.push({
          item: update.haloName,
          type: 'Processing Error',
          error: error.message
        });
      }
    }

    // Step 5: Final verification
    console.log('\n🔍 Step 5: Performing final verification...');
    console.log('Verifying a sample of updated items...');

    const sampleSize = Math.min(5, updatesNeeded.length);
    const sampleUpdates = updatesNeeded.slice(0, sampleSize);

    for (const update of sampleUpdates) {
      try {
        const verifyResponse = await axios({
          method: 'GET',
          url: `${updater.baseURL}/api/Item/${update.haloId}`,
          headers: {
            'Authorization': `Bearer ${updater.accessToken}`,
            'Accept': 'application/json'
          }
        });

        const verifiedItem = verifyResponse.data;
        const upcMatch = update.upcCode === verifiedItem.supplier_part_code;
        const supplierMatch = !update.vendor || verifiedItem.supplier_name === update.vendor;

        console.log(`   ${update.haloName}:`);
        console.log(`     UPC: ${upcMatch ? '✅' : '❌'} (Expected: ${update.upcCode}, Got: ${verifiedItem.supplier_part_code})`);
        console.log(`     Supplier: ${supplierMatch ? '✅' : '❌'} (Expected: ${update.vendor || 'N/A'}, Got: ${verifiedItem.supplier_name || 'None'})`);

      } catch (error) {
        console.log(`   ${update.haloName}: ❌ Verification failed (${error.message})`);
      }
    }

    // Step 6: Generate final report
    console.log('\n📋 FINAL UPDATE REPORT:');
    console.log('='.repeat(50));
    console.log(`Total Updates Attempted: ${results.total}`);
    console.log(`✅ Successful Updates: ${results.successful}`);
    console.log(`❌ Failed Updates: ${results.failed}`);
    console.log(`📊 UPC Codes Updated: ${results.upcUpdates}`);
    console.log(`🏢 Suppliers Updated: ${results.supplierUpdates}`);
    console.log(`📈 Success Rate: ${((results.successful / results.total) * 100).toFixed(1)}%`);

    if (results.errors.length > 0) {
      console.log(`\n❌ Errors Encountered: ${results.errors.length}`);
      results.errors.slice(0, 10).forEach((error, index) => {
        console.log(`   ${index + 1}. ${error.item} (${error.type}): ${error.error}`);
      });

      if (results.errors.length > 10) {
        console.log(`   ... and ${results.errors.length - 10} more errors`);
      }
    }

    // Save detailed report
    const reportData = {
      timestamp: new Date().toISOString(),
      summary: {
        total: results.total,
        successful: results.successful,
        failed: results.failed,
        upcUpdates: results.upcUpdates,
        supplierUpdates: results.supplierUpdates,
        successRate: ((results.successful / results.total) * 100).toFixed(1) + '%'
      },
      errors: results.errors,
      updatesProcessed: updatesNeeded.map(u => ({
        id: u.haloId,
        name: u.haloName,
        upcUpdate: u.upcCode && u.upcCode !== 'NO_UPDATE',
        supplierUpdate: !!u.vendor,
        upcFrom: u.currentUPC,
        upcTo: u.upcCode,
        supplierFrom: u.currentSupplier,
        supplierTo: u.vendor
      }))
    };

    const reportPath = path.join(__dirname, 'data', 'bulk-update-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);

    return reportData;

  } catch (error) {
    console.error('❌ Bulk update process failed:', error.message);
    throw error;
  }
}

// Execute the bulk updates
executeBulkUpdates()
  .then((result) => {
    console.log('\n🎉 BULK UPDATE PROCESS COMPLETED!');
    console.log(`\n📊 Final Statistics:`);
    console.log(`✅ ${result.summary.successful} successful updates`);
    console.log(`❌ ${result.summary.failed} failed updates`);
    console.log(`📈 ${result.summary.upcUpdates} UPC codes added`);
    console.log(`🏢 ${result.summary.supplierUpdates} suppliers set`);
    console.log(`✅ Success rate: ${result.summary.successRate}`);

    if (result.summary.failed > 0) {
      console.log(`\n⚠️  ${result.summary.failed} updates failed - check report for details`);
    }

    console.log('\n💡 Next steps:');
    console.log('• Review detailed report in data/bulk-update-report.json');
    console.log('• Verify sample items in your Halo system');
    console.log('• Address any failed updates if needed');

    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Critical error during bulk updates:', error);
    process.exit(1);
  });