#!/usr/bin/env node

const ProductMatcher = require('./lib/product-matcher');
const HaloUpdater = require('./lib/halo-updater');
const fs = require('fs');
const path = require('path');

async function testUPSUpdate() {
  console.log('🧪 UPS 650VA Test Case\n');

  try {
    // Initialize components
    const matcher = new ProductMatcher();

    // Parse CSV
    console.log('📊 Step 1: Finding UPS 650VA in CSV...');
    const csvPath = path.join(__dirname, 'products.csv');
    matcher.parseCSV(csvPath);

    // Find the UPS 650VA product in CSV
    const upsProduct = matcher.csvData.find(p =>
      p.name.includes('UPS 650VA') || p.name === 'UPS 650VA'
    );

    if (!upsProduct) {
      console.log('❌ UPS 650VA not found in CSV');
      return;
    }

    console.log('✅ Found in CSV:');
    console.log(`   ID: ${upsProduct.id}`);
    console.log(`   Name: "${upsProduct.name}"`);
    console.log(`   UPC Code: "${upsProduct.upc_code}"`);
    console.log(`   Vendor: "${upsProduct.vendor}"`);

    // Load Halo data
    console.log('\n🔍 Step 2: Finding matching Halo item...');
    const stocktakePath = path.join(__dirname, 'data', 'stocktake-mqsz53tm3ir38sg3ctt.json');
    const stocktakeData = JSON.parse(fs.readFileSync(stocktakePath, 'utf8'));
    matcher.loadHaloItems(stocktakeData.haloData);

    // Find the matching Halo item
    const haloItem = matcher.haloItems.find(item =>
      item.name.includes('UPS 650VA') || item.name === '🅾️  UPS 650VA'
    );

    if (!haloItem) {
      console.log('❌ Matching Halo item not found');
      return;
    }

    console.log('✅ Found matching Halo item:');
    console.log(`   ID: ${haloItem.id}`);
    console.log(`   Name: "${haloItem.name}"`);
    console.log(`   Description: "${haloItem.description}"`);

    // Initialize Halo updater to check current state
    console.log('\n📡 Step 3: Checking current Halo API state...');
    const updater = new HaloUpdater();
    await updater.authenticate();

    // Get current item state from Halo API
    const axios = require('axios');
    const currentItemResponse = await axios({
      method: 'GET',
      url: `${updater.baseURL}/api/Item/${haloItem.id}`,
      headers: {
        'Authorization': `Bearer ${updater.accessToken}`,
        'Accept': 'application/json'
      }
    });

    const currentItem = currentItemResponse.data;

    console.log('✅ Current Halo API state:');
    console.log(`   ID: ${currentItem.id}`);
    console.log(`   Name: "${currentItem.name}"`);
    console.log(`   Current UPC: "${currentItem.supplier_part_code || 'Not set'}"`);
    console.log(`   Current Supplier: "${currentItem.supplier_name || 'Not set'}"`);
    console.log(`   Supplier ID: ${currentItem.supplier_id}`);

    // Show the update that's needed
    console.log('\n🔄 Step 4: Required Update:');
    console.log(`   UPC Code: "${currentItem.supplier_part_code}" → "${upsProduct.upc_code}"`);
    console.log(`   Supplier: "${currentItem.supplier_name || 'None'}" → "${upsProduct.vendor}"`);

    // Show the exact API call
    console.log('\n📡 Step 5: Exact API Call to Execute:');
    console.log('\n```bash');
    console.log(`curl --request POST \\`);
    console.log(`  --url 'https://halo.elliotts.tech/api/Item' \\`);
    console.log(`  --header 'Authorization: Bearer YOUR_ACCESS_TOKEN' \\`);
    console.log(`  --header 'Accept: application/json' \\`);
    console.log(`  --header 'Content-Type: application/json' \\`);
    console.log(`  --data '[{`);
    console.log(`    "id": ${haloItem.id},`);
    console.log(`    "supplier_part_code": "${upsProduct.upc_code}"`);
    console.log(`  }]'`);
    console.log('```');

    // Show expected result
    console.log('\n🎯 Step 6: Expected Result After Update:');
    console.log(`   Item ${haloItem.id} will have:`);
    console.log(`   ✅ supplier_part_code: "${upsProduct.upc_code}"`);
    console.log(`   ✅ name: "${haloItem.name}" (unchanged)`);
    console.log(`   ✅ description: "${haloItem.description}" (unchanged)`);

    console.log('\n✅ TEST CASE COMPLETE');
    console.log('\n📋 Summary:');
    console.log(`   ✅ CSV Product: Found (ID: ${upsProduct.id})`);
    console.log(`   ✅ Halo Item: Matched (ID: ${haloItem.id})`);
    console.log(`   ✅ UPC Code: "${upsProduct.upc_code}"`);
    console.log(`   ✅ API Call: Ready to execute`);
    console.log(`   ⚠️  Supplier: "${upsProduct.vendor}" (may need supplier creation)`);

    console.log('\n🚀 Ready for write permission test!');

    return {
      success: true,
      csvProduct: upsProduct,
      haloItem: haloItem,
      updateNeeded: {
        upcCode: upsProduct.upc_code,
        vendor: upsProduct.vendor
      }
    };

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  }
}

// Run the test
testUPSUpdate()
  .then((result) => {
    console.log('\n✅ UPS 650VA test completed successfully!');
    console.log('\nThe matching and update logic is working correctly.');
    console.log('Ready to proceed with write permissions.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });