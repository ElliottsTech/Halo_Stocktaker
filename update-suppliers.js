const HaloUpdater = require('./lib/halo-updater');
const axios = require('axios');

async function updateSuppliers() {
  console.log('🏢 Updating suppliers from L&H Group to Leader Systems\n');

  try {
    const updater = new HaloUpdater();
    await updater.authenticate();

    // Step 1: Get Leader Systems supplier ID
    console.log('🏢 Step 1: Getting Leader Systems supplier ID...');
    const leaderSystemsId = await updater.findSupplierId('Leader Systems');

    if (!leaderSystemsId) {
      console.log('❌ Could not find Leader Systems supplier');
      return;
    }

    console.log(`✅ Leader Systems ID: ${leaderSystemsId}`);

    // Step 2: Get all items to find ones with L&H Group
    console.log('\n🔍 Step 2: Finding items with L&H Group as supplier...');

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

    // Step 3: Find items with L&H Group supplier
    console.log('\n🔄 Step 3: Processing items with L&H Group supplier...');

    const itemsToUpdate = [];

    for (const item of allItems) {
      if (item.supplier_name && item.supplier_name.toLowerCase().includes('l&h group')) {
        itemsToUpdate.push({
          id: item.id,
          name: item.name,
          currentSupplier: item.supplier_name
        });
      }
    }

    console.log(`🎯 Found ${itemsToUpdate.length} items with L&H Group supplier`);

    if (itemsToUpdate.length === 0) {
      console.log('✅ No items need supplier updates!');
      return;
    }

    // Show sample
    console.log('\n📋 Sample of items to update:');
    itemsToUpdate.slice(0, 5).forEach((item, index) => {
      console.log(`   ${index + 1}. ${item.name} - ${item.currentSupplier} → Leader Systems`);
    });

    if (itemsToUpdate.length > 5) {
      console.log(`   ... and ${itemsToUpdate.length - 5} more items`);
    }

    // Step 4: Execute updates
    console.log(`\n🚀 Step 4: Updating ${itemsToUpdate.length} items to Leader Systems...`);

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
      console.log(`   ${item.currentSupplier} → Leader Systems`);

      try {
        const result = await updater.updateItemUPCAlternative(
          item.id,
          'NO_UPDATE', // Don't change the UPC
          leaderSystemsId
        );

        if (result.success) {
          results.successful++;
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
    console.log('\n📋 FINAL SUPPLIER UPDATE REPORT:');
    console.log('='.repeat(50));
    console.log(`Total Updates Attempted: ${results.total}`);
    console.log(`✅ Successful Updates: ${results.successful}`);
    console.log(`❌ Failed Updates: ${results.failed}`);
    console.log(`📈 Success Rate: ${((results.successful / results.total) * 100).toFixed(1)}%`);

    if (results.errors.length > 0) {
      console.log(`\n❌ Errors Encountered: ${results.errors.length}`);
      results.errors.slice(0, 5).forEach((error, index) => {
        console.log(`   ${index + 1}. ${error.item}: ${error.error}`);
      });

      if (results.errors.length > 5) {
        console.log(`   ... and ${results.errors.length - 5} more errors`);
      }
    }

    console.log('\n🎉 SUPPLIER UPDATE COMPLETED!');
    console.log(`\n📊 Final Statistics:`);
    console.log(`🏢 ${results.successful} suppliers updated to Leader Systems`);
    console.log(`✅ Success rate: ${((results.successful / results.total) * 100).toFixed(1)}%`);

    return results;

  } catch (error) {
    console.error('❌ Supplier update failed:', error.message);
    throw error;
  }
}

// Execute the supplier update
updateSuppliers()
  .then((results) => {
    console.log('\n🎉 PROCESS COMPLETED SUCCESSFULLY!');
    console.log(`\n📊 Summary:`);
    console.log(`🏢 ${results.successful} suppliers updated to Leader Systems`);
    console.log(`✅ Success rate: ${((results.successful / results.total) * 100).toFixed(1)}%`);
    process.exit(results.failed > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error('\n💥 Critical error during supplier update:', error);
    process.exit(1);
  });
