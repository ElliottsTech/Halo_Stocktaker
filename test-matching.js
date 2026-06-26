const ProductMatcher = require('./lib/product-matcher');
const fs = require('fs');
const path = require('path');

async function testProductMatching() {
  console.log('🧪 Testing Product Matching...\n');

  try {
    // Initialize matcher
    const matcher = new ProductMatcher();

    // Parse CSV
    const csvPath = path.join(__dirname, 'products.csv');
    matcher.parseCSV(csvPath);

    // Load Halo data from our existing stocktake
    const stocktakePath = path.join(__dirname, 'data', 'stocktake-mqsz53tm3ir38sg3ctt.json');
    const stocktakeData = JSON.parse(fs.readFileSync(stocktakePath, 'utf8'));

    // Load Halo items
    matcher.loadHaloItems(stocktakeData.haloData);

    // Match products
    matcher.matchProducts();

    // Generate report
    const report = matcher.generateUpdateReport();

    console.log('\n📊 Matching Results:');
    console.log(`Total Matches: ${report.totalMatches}`);
    console.log(`UPC Codes to Add: ${report.summary.upcCodesToAdd}`);
    console.log(`Suppliers to Update: ${report.summary.suppliersToUpdate}`);
    console.log(`Already Up to Date: ${report.summary.alreadyUpToDate}`);

    // Show beacon item status
    if (report.beaconItem) {
      console.log('\n🎯 Beacon Item (SKU 9320422519548):');
      console.log(`Item: ${report.beaconItem.haloName}`);
      console.log(`UPC: ${report.beaconItem.upcCode}`);
      console.log(`Vendor: ${report.beaconItem.vendor}`);
      console.log(`Current UPC in Halo: ${report.beaconItem.currentUPC}`);
      console.log(`Confirmed: ${report.beaconItem.confirmed ? '✅ YES' : '❌ NO'}`);
    }

    // Show some sample matches
    console.log('\n📋 Sample Matches:');
    const matches = matcher.getMatches().slice(0, 5);
    matches.forEach(match => {
      console.log(`- ${match.haloItem.name} → UPC: ${match.upcCode || 'N/A'}, Vendor: ${match.vendor || 'N/A'}`);
    });

    // Show statistics
    const stats = matcher.getStatistics();
    console.log('\n📈 Statistics:');
    console.log(`With UPC Codes: ${stats.withUPC}`);
    console.log(`With Vendors: ${stats.withVendor}`);
    console.log(`Match Types:`, stats.matchTypes);

    return report;

  } catch (error) {
    console.error('❌ Error during product matching:', error.message);
    throw error;
  }
}

// Run the test
testProductMatching()
  .then(() => {
    console.log('\n✅ Product matching test completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });