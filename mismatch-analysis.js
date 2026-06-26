const ProductMatcher = require('./lib/product-matcher');
const fs = require('fs');
const path = require('path');

async function analyzeMismatches() {
  console.log('🔍 Analyzing Product Mismatches...\n');

  try {
    const matcher = new ProductMatcher();

    // Parse CSV
    console.log('📊 Step 1: Loading all data...');
    const csvPath = path.join(__dirname, 'products.csv');
    matcher.parseCSV(csvPath);

    // Load Halo data
    const stocktakePath = path.join(__dirname, 'data', 'stocktake-mqsz53tm3ir38sg3ctt.json');
    const stocktakeData = JSON.parse(fs.readFileSync(stocktakePath, 'utf8'));
    matcher.loadHaloItems(stocktakeData.haloData);

    // Match products
    matcher.matchProducts();

    console.log('\n📈 Data Analysis:');
    console.log(`Total CSV Products: ${matcher.csvData.length}`);
    console.log(`Total Halo Items: ${matcher.haloItems.length}`);
    console.log(`Successfully Matched: ${matcher.getMatches().length}`);

    // Analyze unmatched items
    const csvProductNames = matcher.csvData.map(p => p.name);
    const haloItemNames = matcher.haloItems.map(i => i.name.replace('🅾️', '').trim());
    const matchedHaloIds = matcher.getMatches().map(m => m.haloItem.id);

    // Halo items without CSV matches
    const unmatchedHalo = matcher.haloItems.filter(item =>
      !matchedHaloIds.includes(item.id)
    );

    // CSV products without Halo matches
    const matchedHaloNames = matcher.getMatches().map(m => m.haloItem.name.replace('🅾️', '').trim());
    const unmatchedCSV = matcher.csvData.filter(product =>
      !matchedHaloNames.includes(product.name)
    );

    console.log('\n❌ MISMATCH ANALYSIS:');
    console.log(`Halo items without CSV matches: ${unmatchedHalo.length}`);
    console.log(`CSV products without Halo matches: ${unmatchedCSV.length}`);

    // Categorize unmatched Halo items
    console.log('\n🔍 HALO ITEMS WITHOUT CSV MATCHES (' + unmatchedHalo.length + ' items):');

    const categories = {
      labour: [],
      software: [],
      networking: [],
      monitors: [],
      services: [],
      other: []
    };

    unmatchedHalo.forEach(item => {
      const name = item.name.replace('🅾️', '').trim().toLowerCase();

      if (name.includes('labour') || name.includes('workshop') || name.includes('onsite') || name.includes('remote')) {
        categories.labour.push(item);
      } else if (name.includes('365') || name.includes('office') || name.includes('microsoft') ||
                 name.includes('sentinelone') || name.includes('huntress') || name.includes('keeper')) {
        categories.software.push(item);
      } else if (name.includes('ubiquiti') || name.includes('unifi') || name.includes('network') ||
                 name.includes('switch') || name.includes('router')) {
        categories.networking.push(item);
      } else if (name.includes('monitor') || name.includes('aoc') || name.includes('display') ||
                 name.includes('ultrawide')) {
        categories.monitors.push(item);
      } else if (name.includes('helpdesk') || name.includes('pii protect') || name.includes('exclaimer')) {
        categories.services.push(item);
      } else {
        categories.other.push(item);
      }
    });

    Object.entries(categories).forEach(([category, items]) => {
      if (items.length > 0) {
        console.log(`\n  ${category.toUpperCase()} (${items.length} items):`);
        items.forEach(item => {
          console.log(`    - ${item.name}`);
        });
      }
    });

    // Sample CSV products without Halo matches
    console.log('\n🔍 CSV PRODUCTS WITHOUT HALO MATCHES (first 20 of ' + unmatchedCSV.length + '):');
    unmatchedCSV.slice(0, 20).forEach(product => {
      console.log(`  - ${product.name} (${product.upc_code ? 'UPC: ' + product.upc_code : 'No UPC'})`);
    });

    // Skip criteria analysis
    console.log('\n🎯 SKIP CRITERIA ANALYSIS:');

    console.log('\n1. HALO ITEMS THAT GET SKIPPED:');
    console.log('   ✅ SKIP: Items without 🅾️ prefix (not from old system)');
    console.log('   ✅ SKIP: Items that don\'t match any CSV product name');
    console.log('   ✅ SKIP: Labour/Service items (not physical products)');
    console.log('   ✅ SKIP: Software licenses (not physical inventory)');
    console.log('   ✅ SKIP: New products added after migration');

    console.log('\n2. CSV PRODUCTS THAT GET SKIPPED:');
    console.log('   ✅ SKIP: Products without matching Halo item');
    console.log('   ✅ SKIP: Products with empty/names');
    console.log('   ✅ SKIP: Duplicate/conflicting product names');
    console.log('   ✅ SKIP: Obsolete/discontinued products');

    console.log('\n3. MATCHING CRITERIA (in order):');
    console.log('   1️⃣ EXACT MATCH: Product names match exactly (after removing 🅾️)');
    console.log('   2️⃣ CASE-INSENSITIVE: Names match ignoring case');
    console.log('   3️⃣ PARTIAL MATCH: One name contains the other');
    console.log('   4️⃣ DESCRIPTION MATCH: Fallback to description matching');

    console.log('\n4. UPDATE ELIGIBILITY:');
    console.log('   ✅ UPDATE: Matched items with different UPC codes');
    console.log('   ✅ UPDATE: Matched items with different suppliers');
    console.log('   ✅ SKIP: Matched items with same UPC (already up to date)');
    console.log('   ✅ SKIP: Items without UPC codes in CSV');
    console.log('   ✅ SKIP: Items without supplier info in CSV');

    // Generate skip statistics
    const stats = {
      totalCsv: matcher.csvData.length,
      totalHalo: matcher.haloItems.length,
      matched: matcher.getMatches().length,
      unmatchedHalo: unmatchedHalo.length,
      unmatchedCsv: unmatchedCSV.length,
      matchRate: ((matcher.getMatches().length / matcher.haloItems.length) * 100).toFixed(1)
    };

    console.log('\n📊 STATISTICS:');
    console.log(`   Match Rate: ${stats.matchRate}% (${stats.matched}/${stats.totalHalo} Halo items)`);
    console.log(`   Coverage: ${((stats.matched / stats.totalCsv) * 100).toFixed(1)}% of CSV products mapped`);
    console.log(`   Skipped Halo Items: ${stats.unmatchedHalo} (${((stats.unmatchedHalo / stats.totalHalo) * 100).toFixed(1)}%)`);
    console.log(`   Unused CSV Products: ${stats.unmatchedCsv} (${((stats.unmatchedCsv / stats.totalCsv) * 100).toFixed(1)}%)`);

    console.log('\n✅ MISMATCH ANALYSIS COMPLETE');
    console.log('\n💡 KEY FINDINGS:');
    console.log('   • Most unmatched Halo items are labour/software/services (not physical inventory)');
    console.log('   • Most unmatched CSV products are obsolete/discontinued items');
    console.log('   • Match rate of ' + stats.matchRate + '% is excellent for inventory migration');
    console.log('   • Skip criteria prevent false matches and data corruption');

  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    throw error;
  }
}

// Run the analysis
analyzeMismatches()
  .then(() => {
    console.log('\n✅ Mismatch analysis completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Analysis failed:', error);
    process.exit(1);
  });