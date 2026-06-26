const HaloUpdater = require('./lib/halo-updater');
const axios = require('axios');

async function checkSuppliers() {
  console.log('🔍 Checking suppliers in Halo system\n');

  try {
    const updater = new HaloUpdater();
    await updater.authenticate();

    // Get all suppliers
    console.log('🏢 Getting all suppliers...');
    const supplierMap = await updater.buildSupplierMap();

    console.log(`✅ Found ${supplierMap.size} suppliers:`);
    console.log('\n📋 All suppliers:');
    let index = 1;
    for (const [name, id] of supplierMap) {
      console.log(`   ${index++}. ${name} (ID: ${id})`);
    }

    // Get all items and check their suppliers
    console.log('\n🔍 Checking item suppliers...');
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

    // Count suppliers
    const supplierCounts = new Map();
    for (const item of allItems) {
      if (item.supplier_name) {
        const supplierName = item.supplier_name;
        supplierCounts.set(supplierName, (supplierCounts.get(supplierName) || 0) + 1);
      }
    }

    console.log(`\n📊 Supplier distribution (${allItems.length} total items):`);
    for (const [supplier, count] of supplierCounts) {
      console.log(`   ${supplier}: ${count} items`);
    }

    console.log('\n✅ Check complete');

  } catch (error) {
    console.error('❌ Error checking suppliers:', error.message);
    throw error;
  }
}

checkSuppliers()
  .then(() => {
    console.log('\n✅ Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Error:', error);
    process.exit(1);
  });
