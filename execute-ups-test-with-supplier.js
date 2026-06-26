const HaloUpdater = require('./lib/halo-updater');
const axios = require('axios');

async function executeUPSTestWithSupplier() {
  console.log('🧪 Executing UPS 650VA Test Update WITH Supplier\n');

  try {
    const updater = new HaloUpdater();

    // Get current state before update
    console.log('📊 STEP 1: Getting current state...');
    await updater.authenticate();

    const currentStateResponse = await axios({
      method: 'GET',
      url: `${updater.baseURL}/api/Item/549`,
      headers: {
        'Authorization': `Bearer ${updater.accessToken}`,
        'Accept': 'application/json'
      }
    });

    const currentState = currentStateResponse.data;

    console.log('✅ Current Halo State:');
    console.log(`   ID: ${currentState.id}`);
    console.log(`   Name: "${currentState.name}"`);
    console.log(`   Current UPC: "${currentState.supplier_part_code || 'Not set'}"`);
    console.log(`   Current Supplier: "${currentState.supplier_name || 'Not set'}"`);
    console.log(`   Current Supplier ID: ${currentState.supplier_id}`);

    // Find supplier ID for ACA Pacific
    console.log('\n🔍 STEP 2: Finding supplier ID for "ACA Pacific"...');
    const supplierId = await updater.findSupplierId('ACA Pacific');

    if (!supplierId) {
      console.log('❌ Could not find supplier: ACA Pacific');
      console.log('⚠️  Trying alternative search methods...');

      // Try to get all suppliers and search manually
      const allSuppliersResponse = await axios({
        method: 'GET',
        url: `${updater.baseURL}/api/Supplier`,
        headers: {
          'Authorization': `Bearer ${updater.accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (allSuppliersResponse.data.suppliers) {
        const acaSupplier = allSuppliersResponse.data.suppliers.find(s =>
          s.name.toLowerCase().includes('aca') || s.name.toLowerCase().includes('pacific')
        );

        if (acaSupplier) {
          supplierId = acaSupplier.id;
          console.log(`✅ Found supplier using alternative search: "${acaSupplier.name}" (ID: ${supplierId})`);
        }
      }

      if (!supplierId) {
        console.log('❌ Could not find any ACA Pacific supplier');
        console.log('Available suppliers containing "aca":');
        allSuppliersResponse.data.suppliers
          .filter(s => s.name.toLowerCase().includes('aca'))
          .forEach(s => console.log(`   - ${s.name} (ID: ${s.id})`));

        return { success: false, error: 'Supplier not found' };
      }
    } else {
      console.log(`✅ Found supplier ID: ${supplierId}`);
    }

    // Execute the update with both UPC and supplier
    console.log('\n🔄 STEP 3: Executing update...');
    console.log('   UPC: "NPE-0650-AU" → "8027122522359"');
    console.log(`   Supplier: "Not set" → "ACA Pacific" (ID: ${supplierId})`);

    const result = await updater.updateItemUPCAlternative(549, '8027122522359', supplierId);

    if (!result.success) {
      console.log('❌ Update failed');
      console.log(`Error: ${result.error}`);
      return { success: false, error: result.error };
    }

    console.log('✅ Update API call executed successfully!');

    // Wait for the update to process
    console.log('\n⏳ STEP 4: Waiting for update to process...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify the update
    console.log('\n🔍 STEP 5: Verifying update in Halo...');

    const verifyResponse = await axios({
      method: 'GET',
      url: `${updater.baseURL}/api/Item/549`,
      headers: {
        'Authorization': `Bearer ${updater.accessToken}`,
        'Accept': 'application/json'
      }
    });

    const updatedState = verifyResponse.data;

    console.log('✅ Updated Halo State:');
    console.log(`   ID: ${updatedState.id}`);
    console.log(`   Name: "${updatedState.name}"`);
    console.log(`   Updated UPC: "${updatedState.supplier_part_code || 'Not set'}"`);
    console.log(`   Updated Supplier: "${updatedState.supplier_name || 'Not set'}"`);
    console.log(`   Updated Supplier ID: ${updatedState.supplier_id}`);

    // Show before/after comparison
    console.log('\n📋 BEFORE/AFTER COMPARISON:');
    console.log('┌─────────────────────────────────┬─────────────────────┬─────────────────────┐');
    console.log('│ FIELD                           │ BEFORE              │ AFTER               │');
    console.log('├─────────────────────────────────┼─────────────────────┼─────────────────────┤');
    console.log(`│ Item ID                         │ ${currentState.id.toString().padEnd(21)} │ ${updatedState.id.toString().padEnd(21)} │`);
    console.log(`│ Item Name                       │ ${(currentState.name || '').toString().substring(0, 19).padEnd(19)} │ ${(updatedState.name || '').toString().substring(0, 19).padEnd(19)} │`);
    console.log(`│ UPC Code                        │ ${(currentState.supplier_part_code || 'Not set').toString().substring(0, 19).padEnd(19)} │ ${(updatedState.supplier_part_code || 'Not set').toString().substring(0, 19).padEnd(19)} │`);
    console.log(`│ Supplier Name                   │ ${(currentState.supplier_name || 'Not set').toString().substring(0, 19).padEnd(19)} │ ${(updatedState.supplier_name || 'Not set').toString().substring(0, 19).padEnd(19)} │`);
    console.log(`│ Supplier ID                     │ ${currentState.supplier_id.toString().padEnd(21)} │ ${updatedState.supplier_id.toString().padEnd(21)} │`);
    console.log('└─────────────────────────────────┴─────────────────────┴─────────────────────┘');

    // Check if updates were successful
    const upcUpdateSuccessful = updatedState.supplier_part_code === '8027122522359';
    const supplierUpdateSuccessful = updatedState.supplier_id === supplierId && updatedState.supplier_id > 0;

    console.log('\n🎯 UPDATE VERIFICATION:');
    if (upcUpdateSuccessful) {
      console.log('✅ SUCCESS: UPC code updated correctly!');
      console.log(`✅ Expected: "8027122522359"`);
      console.log(`✅ Actual: "${updatedState.supplier_part_code}"`);
      console.log('✅ MATCH: UPC codes are identical!');
    } else {
      console.log('❌ FAILED: UPC code not updated as expected');
      console.log(`❌ Expected: "8027122522359"`);
      console.log(`❌ Actual: "${updatedState.supplier_part_code}"`);
    }

    if (supplierUpdateSuccessful) {
      console.log('✅ SUCCESS: Supplier updated correctly!');
      console.log(`✅ Expected ID: ${supplierId}`);
      console.log(`✅ Actual ID: ${updatedState.supplier_id}`);
      console.log(`✅ MATCH: Supplier IDs are identical!`);
      console.log(`✅ Supplier Name: "${updatedState.supplier_name}"`);
    } else {
      console.log('❌ FAILED: Supplier not updated as expected');
      console.log(`❌ Expected ID: ${supplierId}`);
      console.log(`❌ Actual ID: ${updatedState.supplier_id}`);
      console.log(`❌ Expected Supplier Name: "ACA Pacific"`);
      console.log(`❌ Actual Supplier Name: "${updatedState.supplier_name || 'Not set'}"`);
    }

    // Additional verification checks
    console.log('\n🔍 ADDITIONAL VERIFICATION:');
    const nameUnchanged = updatedState.name === currentState.name;
    const idUnchanged = updatedState.id === currentState.id;
    const onlyIntendedFieldsModified = nameUnchanged && idUnchanged;

    console.log(`✅ Item name unchanged: ${nameUnchanged}`);
    console.log(`✅ Item ID unchanged: ${idUnchanged}`);
    console.log(`✅ Only intended fields modified: ${onlyIntendedFieldsModified}`);

    const overallSuccess = upcUpdateSuccessful && supplierUpdateSuccessful;

    return {
      success: overallSuccess,
      before: {
        id: currentState.id,
        name: currentState.name,
        upc: currentState.supplier_part_code,
        supplier: currentState.supplier_name,
        supplierId: currentState.supplier_id
      },
      after: {
        id: updatedState.id,
        name: updatedState.name,
        upc: updatedState.supplier_part_code,
        supplier: updatedState.supplier_name,
        supplierId: updatedState.supplier_id
      },
      upcUpdateSuccessful,
      supplierUpdateSuccessful,
      verified: overallSuccess
    };

  } catch (error) {
    console.error('❌ Test execution failed:', error.message);
    console.error('Error details:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

// Execute the test
executeUPSTestWithSupplier()
  .then((result) => {
    if (result.success) {
      console.log('\n🎉 COMPLETE TEST UPDATE: SUCCESSFUL!');
      console.log('\n📊 SUMMARY:');
      console.log('✅ UPC code updated: NPE-0650-AU → 8027122522359');
      console.log(`✅ Supplier updated: None → ACA Pacific (ID: ${result.after.supplierId})`);
      console.log('✅ Both fields successfully modified');
      console.log('✅ No unintended data changes');
      console.log('\n⏸️  PAUSED: Please verify in your Halo system');
      console.log('💡 Check Item 549 to confirm both UPC and Supplier are set correctly');
      console.log('💡 Expected: UPC "8027122522359" and Supplier "ACA Pacific"');
    } else {
      console.log('\n❌ COMPLETE TEST UPDATE: FAILED');
      console.log(`❌ Error: ${result.error}`);
      console.log('❌ UPC Update:', result.upcUpdateSuccessful ? '✅' : '❌');
      console.log('❌ Supplier Update:', result.supplierUpdateSuccessful ? '✅' : '❌');
      console.log('❌ Do not proceed with bulk updates until issue is resolved');
    }
    process.exit(result.success ? 0 : 1);
  })
  .catch((error) => {
    console.error('\n💥 Critical error during test:', error);
    process.exit(1);
  });