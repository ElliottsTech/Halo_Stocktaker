const HaloUpdater = require('./lib/halo-updater');
const axios = require('axios');
const fs = require('fs');

async function findRemainingNoUpdate() {
  console.log('🔍 Finding remaining items with "NO_UPDATE" in Halo\n');

  try {
    const updater = new HaloUpdater();
    await updater.authenticate();

    // Step 1: Get all items from Halo
    console.log('📋 Step 1: Getting all items from Halo...');
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

    // Step 2: Find items with "NO_UPDATE" or empty UPC
    console.log('\n🔍 Step 2: Finding items with "NO_UPDATE" or empty UPC...');
    const itemsWithNoUpdate = [];

    for (const item of allItems) {
      if (item.supplier_part_code === 'NO_UPDATE' || !item.supplier_part_code || item.supplier_part_code === 'undefined' || item.supplier_part_code === '') {
        itemsWithNoUpdate.push({
          id: item.id,
          name: item.name,
          currentUPC: item.supplier_part_code,
          supplier_name: item.supplier_name
        });
      }
    }

    console.log(`🎯 Found ${itemsWithNoUpdate.length} items with "NO_UPDATE" or empty UPC`);

    if (itemsWithNoUpdate.length === 0) {
      console.log('✅ No items with "NO_UPDATE" found!');
      return;
    }

    console.log('\n📋 Items with "NO_UPDATE":');
    itemsWithNoUpdate.forEach((item, index) => {
      console.log(`   ${index + 1}. ID: ${item.id} | ${item.name} | UPC: "${item.currentUPC}" | Supplier: ${item.supplier_name || 'None'}`);
    });

    // Step 3: Load CSV and try to find matches
    console.log('\n📋 Step 3: Loading CSV to find SKU matches...');
    const csvPath = './products.csv';
    const csvData = fs.readFileSync(csvPath, 'utf8');
    const lines = csvData.split('\n');
    const header = lines[0].split(',');

    const nameIndex = header.indexOf('name');
    const upcIndex = header.indexOf('upc_code');
    const vendorIndex = header.indexOf('vendor');

    console.log(`📊 CSV column indices: name=${nameIndex}, upc_code=${upcIndex}, vendor=${vendorIndex}`);

    const skuMap = new Map();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      const columns = line.split(',');
      if (columns.length > upcIndex) {
        const name = columns[nameIndex].trim();
        const upcCode = columns[upcIndex].trim();
        const vendor = columns[vendorIndex]?.trim();

        if (upcCode && upcCode !== 'N/A' && upcCode !== '' && upcCode !== 'false' && upcCode !== 'undefined') {
          skuMap.set(name.toLowerCase(), upcCode);
        }
      }
    }

    console.log(`✅ Loaded ${skuMap.size} valid SKUs from CSV`);

    // Step 4: Try to match items with CSV
    console.log('\n🔄 Step 4: Matching Halo items with CSV...');
    const matchedItems = [];

    for (const item of itemsWithNoUpdate) {
      // Try different matching strategies
      let matched = false;

      // Strategy 1: Exact name match (case insensitive)
      const cleanName = item.name.replace(/^[^\w\s]*\s*/, '').toLowerCase().trim();
      if (skuMap.has(cleanName)) {
        matchedItems.push({
          ...item,
          cleanName: cleanName,
          correctSku: skuMap.get(cleanName),
          matchMethod: 'exact'
        });
        matched = true;
      }

      // Strategy 2: Partial name match (if not already matched)
      if (!matched) {
        for (const [csvName, sku] of skuMap) {
          if (cleanName.includes(csvName) || csvName.includes(cleanName)) {
            matchedItems.push({
              ...item,
              cleanName: cleanName,
              csvName: csvName,
              correctSku: sku,
              matchMethod: 'partial'
            });
            matched = true;
            break;
          }
        }
      }
    }

    console.log(`🎯 Found ${matchedItems.length} matches in CSV`);

    if (matchedItems.length === 0) {
      console.log('⚠️  No matching SKUs found in CSV');
      return;
    }

    console.log('\n📋 Matched items to update:');
    matchedItems.forEach((item, index) => {
      console.log(`   ${index + 1}. ${item.name}`);
      console.log(`      Current UPC: "${item.currentUPC}"`);
      console.log(`      Match method: ${item.matchMethod}`);
      if (item.csvName) {
        console.log(`      Matched with: "${item.csvName}"`);
      }
      console.log(`      → Correct SKU: "${item.correctSku}"`);
    });

    // Step 5: Update the items
    console.log(`\n🚀 Step 5: Updating ${matchedItems.length} items...`);

    const results = {
      total: matchedItems.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    for (let i = 0; i < matchedItems.length; i++) {
      const item = matchedItems[i];
      const progress = ((i + 1) / matchedItems.length * 100).toFixed(1);

      console.log(`\n[${i + 1}/${matchedItems.length}] ${progress}% - ${item.name}`);
      console.log(`   UPC: ${item.currentUPC} → ${item.correctSku}`);

      try {
        const result = await updater.updateItemUPCAlternative(
          item.id,
          item.correctSku,
          null // No supplier change
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
    console.log('\n📋 FINAL UPDATE REPORT:');
    console.log('='.repeat(50));
    console.log(`Total Updates Attempted: ${results.total}`);
    console.log(`✅ Successful Updates: ${results.successful}`);
    console.log(`❌ Failed Updates: ${results.failed}`);
    console.log(`📈 Success Rate: ${((results.successful / results.total) * 100).toFixed(1)}%`);

    if (results.errors.length > 0) {
      console.log(`\n❌ Errors Encountered: ${results.errors.length}`);
      results.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error.item}: ${error.error}`);
      });
    }

    console.log('\n🎉 UPDATE PROCESS COMPLETED!');

    return results;

  } catch (error) {
    console.error('❌ Process failed:', error.message);
    throw error;
  }
}

// Execute
findRemainingNoUpdate()
  .then((results) => {
    if (results) {
      console.log(`\n📊 Final Statistics:`);
      console.log(`✅ ${results.successful} items updated`);
      console.log(`❌ ${results.failed} items failed`);
      console.log(`✅ Success rate: ${((results.successful / results.total) * 100).toFixed(1)}%`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Critical error:', error);
    process.exit(1);
  });
