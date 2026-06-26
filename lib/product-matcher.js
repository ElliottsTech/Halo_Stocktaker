const fs = require('fs');
const path = require('path');

class ProductMatcher {
  constructor() {
    this.csvData = null;
    this.haloItems = null;
    this.matches = [];
  }

  /**
   * Parse CSV file
   */
  parseCSV(filePath) {
    console.log('📊 Parsing CSV file...');

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      throw new Error('CSV file is empty');
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const products = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length === headers.length) {
        const product = {};
        headers.forEach((header, index) => {
          product[header] = values[index] ? values[index].trim() : '';
        });
        products.push(product);
      }
    }

    console.log(`✅ Parsed ${products.length} products from CSV`);
    this.csvData = products;
    return products;
  }

  /**
   * Parse CSV line handling quoted values
   */
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current);
    return result;
  }

  /**
   * Load Halo items
   */
  loadHaloItems(haloData) {
    console.log('🔍 Loading Halo items...');

    if (!haloData || !haloData.items) {
      throw new Error('Invalid Halo data format');
    }

    this.haloItems = haloData.items;
    console.log(`✅ Loaded ${haloData.items.length} Halo items`);
    return haloData.items;
  }

  /**
   * Match Halo items to CSV products
   */
  matchProducts() {
    console.log('🔗 Matching Halo items to CSV products...');

    if (!this.haloItems || !this.csvData) {
      throw new Error('Halo items and CSV data must be loaded first');
    }

    const matches = [];
    let matchedCount = 0;

    this.haloItems.forEach(haloItem => {
      // Remove the 🅾️ emoji prefix for matching
      const haloName = haloItem.name.replace('🅾️', '').trim();

      // Try to find matching CSV product
      const csvProduct = this.findMatchingCSVProduct(haloName, haloItem);

      if (csvProduct) {
        matchedCount++;

        matches.push({
          haloItem: haloItem,
          csvProduct: csvProduct,
          upcCode: csvProduct.upc_code || null,
          vendor: csvProduct.vendor || null,
          matchType: this.getMatchType(haloName, csvProduct)
        });
      } else {
        // Log unmatched items for review
        if (haloItem.name.startsWith('🅾️')) {
          console.log(`⚠️ No match found for: ${haloItem.name}`);
        }
      }
    });

    console.log(`✅ Matched ${matchedCount} out of ${this.haloItems.length} Halo items`);
    this.matches = matches;
    return matches;
  }

  /**
   * Find matching CSV product
   */
  findMatchingCSVProduct(haloName, haloItem) {
    // Exact match (without emoji)
    let match = this.csvData.find(csv => csv.name === haloName);
    if (match) return match;

    // Case-insensitive match
    match = this.csvData.find(csv =>
      csv.name.toLowerCase() === haloName.toLowerCase()
    );
    if (match) return match;

    // Partial match (contains)
    match = this.csvData.find(csv =>
      csv.name.toLowerCase().includes(haloName.toLowerCase()) ||
      haloName.toLowerCase().includes(csv.name.toLowerCase())
    );
    if (match) return match;

    // Match by description if available
    if (haloItem.description) {
      match = this.csvData.find(csv =>
        csv.description && csv.description.toLowerCase() === haloItem.description.toLowerCase()
      );
      if (match) return match;
    }

    return null;
  }

  /**
   * Get match type for logging
   */
  getMatchType(haloName, csvProduct) {
    if (csvProduct.name === haloName) return 'exact';
    if (csvProduct.name.toLowerCase() === haloName.toLowerCase()) return 'case-insensitive';
    return 'partial';
  }

  /**
   * Generate update report
   */
  generateUpdateReport() {
    console.log('📋 Generating update report...');

    const report = {
      totalMatches: this.matches.length,
      upcUpdates: [],
      supplierUpdates: [],
      beaconItem: null,
      summary: {
        upcCodesToAdd: 0,
        suppliersToUpdate: 0,
        alreadyUpToDate: 0
      }
    };

    this.matches.forEach(match => {
      const needsUpdate = {
        haloId: match.haloItem.id,
        haloName: match.haloItem.name,
        upcCode: match.upcCode,
        vendor: match.vendor,
        currentSupplier: match.haloItem.supplier_name,
        currentUPC: match.haloItem.supplier_part_code
      };

      // Check if this is our beacon item
      if (match.haloItem.id === 414 || match.upcCode === '9320422519548') {
        report.beaconItem = {
          ...needsUpdate,
          confirmed: match.upcCode === '9320422519548' && match.vendor === 'Leader Systems'
        };
      }

      // Check for UPC updates
      if (match.upcCode && match.upcCode !== match.haloItem.supplier_part_code) {
        report.upcUpdates.push(needsUpdate);
        report.summary.upcCodesToAdd++;
      } else if (match.upcCode === match.haloItem.supplier_part_code) {
        report.summary.alreadyUpToDate++;
      }

      // Check for supplier updates
      if (match.vendor && match.vendor !== match.haloItem.supplier_name) {
        const supplierUpdate = { ...needsUpdate, needsSupplierUpdate: true };
        report.supplierUpdates.push(supplierUpdate);
        report.summary.suppliersToUpdate++;
      }
    });

    console.log('✅ Update report generated');
    return report;
  }

  /**
   * Get all matches
   */
  getMatches() {
    return this.matches;
  }

  /**
   * Get statistics
   */
  getStatistics() {
    if (!this.matches.length) {
      return null;
    }

    const stats = {
      totalMatches: this.matches.length,
      withUPC: this.matches.filter(m => m.upcCode).length,
      withVendor: this.matches.filter(m => m.vendor).length,
      matchTypes: {}
    };

    this.matches.forEach(match => {
      stats.matchTypes[match.matchType] = (stats.matchTypes[match.matchType] || 0) + 1;
    });

    return stats;
  }
}

module.exports = ProductMatcher;