const HaloUpdater = require('./lib/halo-updater');
const axios = require('axios');

async function fixSupplierAssignments() {
  console.log('🔧 Fixing Supplier Assignments: L&H Group → Leader Systems\n');

  try {
    const updater = new HaloUpdater();
    await updater.authenticate();

    // Step 1: Find supplier IDs
    console.log('🔍 Step 1: Finding supplier IDs...');
    const leaderSystemsId = await updater.findSupplierId('Leader Systems');

    if (!leaderSystemsId) {
      console.log('❌ Could not find Leader Systems supplier');
      return;
    }

    console.log(`✅ Leader Systems ID: ${leaderSystemsId}`);

    // Step 2: Get all items to find ones with L&H Group
    console.log('\n🔍 Step 2: Finding items with L&H Group supplier...');

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

    // Step 3: Find items with L&H Group as supplier
    const itemsToUpdate = [];

    for (const item of allItems) {
      if (item.supplier_name && item.supplier_name.toLowerCase().includes('l&h group')) {
        itemsToUpdate.push({
          id: item.id,
          name: item.name,
          currentSupplier: item.supplier_name,
          currentSupplierId: item.supplier_id
        });
      }
    }

    console.log(`\n🎯 Step 3: Found ${itemsToUpdate.length} items with L&H Group supplier`);

    if (itemsToUpdate.length === 0) {
      console.log('✅ No items found with L&H Group supplier - nothing to update!');
      return;
    }

    // Show first 10 items as sample
    console.log('\n📋 Sample of items to update:');
    itemsToUpdate.slice(0, 10).forEach((item, index) => {
      console.log(`   ${index + 1}. ${item.name} (ID: ${item.id})`);
      console.log(`      Current: ${item.currentSupplier} (${item.currentSupplierId})`);
      console.log(`      New: Leader Systems (${leaderSystemsId})`);
    });

    if (itemsToUpdate.length > 10) {
      console.log(`   ... and ${itemsToUpdate.length - 10} more items`);
    }

    // Step 4: Update all items
    console.log(`\n🚀 Step 4: Updating ${itemsToUpdate.length} items...`);

    const results = {
      total: itemsToUpdate.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    for (let i = 0; i < itemsToUpdate.length; i++) {
      const item = itemsToUpdate[i];
      const progress = ((i + 1) / itemsToUpdate.length * 100).toFixed(1);

      console.log(`\n[${i + 1}/${itemsToUpdate.length}] ${progress}% - ${item.name}`);
      console.log(`   Supplier: L&H Group → Leader Systems`);

      try {
        // Update supplier using the alternative method
        const result = await updater.updateItemUPCAlternative(
          item.id,
          'NO_UPDATE', // Don't change UPC
          leaderSystemsId // New supplier ID
        );

        if (result.success) {
          results.successful++;
          console.log(`   ✅ Update successful`);
        } else {
          results.failed++;
          results.errors.push({
            item: item.name,
            error: result.error
          });
          console.log(`   ❌ Update failed: ${result.error}`);
        }

        // Small delay to avoid rate limiting
        if ((i + 1) % 10 === 0) {
          console.log('   ⏸️  Pausing briefly to avoid rate limiting...');
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

    // Step 5: Verification
    console.log('\n🔍 Step 5: Performing verification...');

    // Check a sample of updated items
    const sampleSize = Math.min(5, itemsToUpdate.length);
    const sampleItems = itemsToUpdate.slice(0, sampleSize);

    for (const item of sampleItems) {
      try {
        const verifyResponse = await axios({
          method: 'GET',
          url: `${updater.baseURL}/api/Item/${item.id}`,
          headers: {
            'Authorization': `Bearer ${updater.accessToken}`,
            'Accept': 'application/json'
          }
        });

        const verifiedItem = verifyResponse.data;
        const supplierCorrect = verifiedItem.supplier_name === 'Leader Systems' ||
                               verifiedItem.supplier_name.toLowerCase().includes('leader systems');

        console.log(`   ${item.name}:`);
        console.log(`     Supplier: ${supplierCorrect ? '✅' : '❌'} (Expected: Leader Systems, Got: ${verifiedItem.supplier_name || 'None'})`);

      } catch (error) {
        console.log(`   ${item.name}: ❌ Verification failed (${error.message})`);
      }
    }

    // Final report
    console.log('\n📋 FINAL UPDATE REPORT:');
    console.log('='.repeat(50));
    console.log(`Total Updates Attempted: ${results.total}`);
    console.log(`✅ Successful Updates: ${results.successful}`);
    console.log(`❌ Failed Updates: ${results.failed}`);
    console.log(`📈 Success Rate: ${((results.successful / results.total) * 100).toFixed(1)}%`);

    if (results.errors.length > 0) {
      console.log(`\n❌ Errors Encountered: ${results.errors.length}`);
      results.errors.slice(0, 10).forEach((error, index) => {
        console.log(`   ${index + 1}. ${error.item}: ${error.error}`);
      });

      if (results.errors.length > 10) {
        console.log(`   ... and ${results.errors.length - 10} more errors`);
      }
    }

    console.log('\n🎉 SUPPLIER ASSIGNMENT FIX COMPLETED!');
    console.log(`✅ ${results.successful} items updated from L&H Group to Leader Systems`);

    if (results.failed > 0) {
      console.log(`⚠️  ${results.failed} items failed to update - check errors above`);
    }

    return results;

  } catch (error) {
    console.error('❌ Supplier assignment fix failed:', error.message);
    throw error;
  }
}

// Execute the fix
fixSupplierAssignments()
  .then((results) => {
    console.log('\n🎉 PROCESS COMPLETED SUCCESSFULLY!');
    console.log(`\n📊 Final Statistics:`);
    console.log(`✅ ${results.successful} successful updates`);
    console.log(`❌ ${results.failed} failed updates`);
    console.log(`✅ Success rate: ${((results.successful / results.total) * 100).toFixed(1)}%`);
    process.exit(results.failed > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error('\n💥 Critical error during supplier fix:', error);
    process.exit(1);
  });