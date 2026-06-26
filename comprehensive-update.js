const ProductMatcher = require('./lib/product-matcher');
const HaloUpdater = require('./lib/halo-updater');
const fs = require('fs');
const path = require('path');

async function comprehensiveUpdate() {
  console.log('🚀 Comprehensive Product Update Process\n');

  try {
    // Initialize components
    const matcher = new ProductMatcher();
    const updater = new HaloUpdater();

    // Step 1: Parse CSV
    console.log('Step 1: Parsing CSV file...');
    const csvPath = path.join(__dirname, 'products.csv');
    matcher.parseCSV(csvPath);

    // Step 2: Load Halo data
    console.log('Step 2: Loading Halo items...');
    const stocktakePath = path.join(__dirname, 'data', 'stocktake-mqsz53tm3ir38sg3ctt.json');
    const stocktakeData = JSON.parse(fs.readFileSync(stocktakePath, 'utf8'));
    matcher.loadHaloItems(stocktakeData.haloData);

    // Step 3: Match products
    console.log('Step 3: Matching products...');
    matcher.matchProducts();

    // Step 4: Generate update report
    console.log('Step 4: Generating update report...');
    const report = matcher.generateUpdateReport();

    console.log('\n📊 Update Report Summary:');
    console.log(`Total Matches: ${report.totalMatches}`);
    console.log(`UPC Codes Needed: ${report.summary.upcCodesToAdd}`);
    console.log(`Supplier Updates Needed: ${report.summary.suppliersToUpdate}`);
    console.log(`Already Up to Date: ${report.summary.alreadyUpToDate}`);

    // Step 5: Check beacon status
    console.log('\n🎯 Beacon Item Status:');
    if (report.beaconItem) {
      console.log(`Item: ${report.beaconItem.haloName}`);
      console.log(`Expected UPC: ${report.beaconItem.upcCode}`);
      console.log(`Expected Vendor: ${report.beaconItem.vendor}`);
      console.log(`Current UPC: ${report.beaconItem.currentUPC || 'Not set'}`);
      console.log(`Current Supplier: ${report.beaconItem.currentSupplier || 'Not set'}`);

      if (report.beaconItem.currentUPC === report.beaconItem.upcCode &&
          report.beaconItem.currentSupplier === report.beaconItem.vendor) {
        console.log('✅ Beacon item is up to date!');
      } else {
        console.log('❌ Beacon item needs updates');
      }
    }

    // Step 6: Show items that need updates
    console.log('\n📋 Items Needing UPC Updates (first 10):');
    report.upcUpdates.slice(0, 10).forEach(update => {
      console.log(`- ${update.haloName} (${update.haloId})`);
      console.log(`  Current UPC: ${update.currentUPC || 'Not set'} → New: ${update.upcCode}`);
    });

    console.log('\n📋 Items Needing Supplier Updates (first 10):');
    report.supplierUpdates.slice(0, 10).forEach(update => {
      console.log(`- ${update.haloName} (${update.haloId})`);
      console.log(`  Current: ${update.currentSupplier || 'Not set'} → New: ${update.vendor}`);
    });

    // Step 7: Prepare updates
    console.log('\n🔄 Preparing updates...');
    const updatesNeeded = [];

    // UPC updates
    report.upcUpdates.forEach(update => {
      updatesNeeded.push({
        haloId: update.haloId,
        haloName: update.haloName,
        upcCode: update.upcCode,
        currentUPC: update.currentUPC,
        type: 'UPC'
      });
    });

    // Supplier updates
    report.supplierUpdates.forEach(update => {
      updatesNeeded.push({
        haloId: update.haloId,
        haloName: update.haloName,
        vendor: update.vendor,
        currentSupplier: update.currentSupplier,
        type: 'Supplier'
      });
    });

    console.log(`Total updates prepared: ${updatesNeeded.length}`);

    // Step 8: Save report to file
    const reportPath = path.join(__dirname, 'data', 'update-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      summary: report.summary,
      beaconItem: report.beaconItem,
      upcUpdates: report.upcUpdates,
      supplierUpdates: report.supplierUpdates,
      updatesNeeded: updatesNeeded
    }, null, 2));

    console.log(`\n📄 Report saved to: ${reportPath}`);

    // Step 9: Ask if user wants to proceed with updates
    console.log('\n⚠️  Updates prepared but not executed.');
    console.log('To execute updates, run: node execute-updates.js');

    return {
      success: true,
      report: report,
      updatesNeeded: updatesNeeded
    };

  } catch (error) {
    console.error('❌ Error during comprehensive update:', error.message);
    throw error;
  }
}

// Run the comprehensive update
comprehensiveUpdate()
  .then(() => {
    console.log('\n✅ Comprehensive update analysis completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Process failed:', error);
    process.exit(1);
  });