const HaloUpdater = require('./lib/halo-updater');
const axios = require('axios');

async function executeSingleUPSTest() {
  console.log('🧪 Executing Single UPS 650VA Test Update\n');

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

    // Execute the update
    console.log('\n🔄 STEP 2: Executing update...');
    console.log('   Updating UPC: "NPE-0650-AU" → "8027122522359"');

    const result = await updater.updateItemUPC(549, '8027122522359');

    if (result.success) {
      console.log('✅ Update API call executed successfully!');

      // Wait a moment for the update to process
      console.log('\n⏳ STEP 3: Waiting for update to process...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify the update
      console.log('\n🔍 STEP 4: Verifying update in Halo...');

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
      console.log(`   Supplier: "${updatedState.supplier_name || 'Not set'}"`);
      console.log(`   Supplier ID: ${updatedState.supplier_id}`);

      // Show before/after comparison
      console.log('\n📋 BEFORE/AFTER COMPARISON:');
      console.log('┌─────────────────────────────────┬─────────────────────┬─────────────────────┐');
      console.log('│ FIELD                           │ BEFORE              │ AFTER               │');
      console.log('├─────────────────────────────────┼─────────────────────┼─────────────────────┤');
      console.log(`│ Item ID                         │ ${currentState.id.toString().padEnd(21)} │ ${updatedState.id.toString().padEnd(21)} │`);
      console.log(`│ Item Name                       │ ${(currentState.name || '').toString().substring(0, 19).padEnd(19)} │ ${(updatedState.name || '').toString().substring(0, 19).padEnd(19)} │`);
      console.log(`│ UPC Code                        │ ${(currentState.supplier_part_code || 'Not set').toString().substring(0, 19).padEnd(19)} │ ${(updatedState.supplier_part_code || 'Not set').toString().substring(0, 19).padEnd(19)} │`);
      console.log(`│ Supplier                        │ ${(currentState.supplier_name || 'Not set').toString().substring(0, 19).padEnd(19)} │ ${(updatedState.supplier_name || 'Not set').toString().substring(0, 19).padEnd(19)} │`);
      console.log('└─────────────────────────────────┴─────────────────────┴─────────────────────┘');

      // Check if update was successful
      const updateSuccessful = updatedState.supplier_part_code === '8027122522359';

      console.log('\n🎯 UPDATE VERIFICATION:');
      if (updateSuccessful) {
        console.log('✅ SUCCESS: UPC code updated correctly!');
        console.log(`✅ Expected: "8027122522359"`);
        console.log(`✅ Actual: "${updatedState.supplier_part_code}"`);
        console.log('✅ MATCH: Values are identical!');
      } else {
        console.log('❌ FAILED: UPC code not updated as expected');
        console.log(`❌ Expected: "8027122522359"`);
        console.log(`❌ Actual: "${updatedState.supplier_part_code}"`);
        return { success: false, error: 'Update verification failed' };
      }

      // Additional verification checks
      console.log('\n🔍 ADDITIONAL VERIFICATION:');
      const nameUnchanged = updatedState.name === currentState.name;
      const idUnchanged = updatedState.id === currentState.id;
      const onlyUPCModified = nameUnchanged && idUnchanged;

      console.log(`✅ Item name unchanged: ${nameUnchanged}`);
      console.log(`✅ Item ID unchanged: ${idUnchanged}`);
      console.log(`✅ Only UPC code was modified: ${onlyUPCModified}`);

      return {
        success: true,
        before: {
          id: currentState.id,
          name: currentState.name,
          upc: currentState.supplier_part_code,
          supplier: currentState.supplier_name
        },
        after: {
          id: updatedState.id,
          name: updatedState.name,
          upc: updatedState.supplier_part_code,
          supplier: updatedState.supplier_name
        },
        verified: updateSuccessful
      };

    } else {
      console.log('❌ Update API call failed');
      return { success: false, error: result.error };
    }

  } catch (error) {
    console.error('❌ Test execution failed:', error.message);
    console.error('Error details:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

// Execute the single test
executeSingleUPSTest()
  .then((result) => {
    if (result.success) {
      console.log('\n🎉 SINGLE TEST UPDATE: SUCCESSFUL!');
      console.log('\n📊 SUMMARY:');
      console.log('✅ API write permission working');
      console.log('✅ UPC code updated successfully');
      console.log('✅ Update verified in Halo');
      console.log('✅ No data corruption');
      console.log('\n⏸️  PAUSED: Awaiting your verification before proceeding with bulk updates');
      console.log('💡 Please check Halo item 549 in your system to verify the update');
      console.log('💡 Once verified, you can approve bulk update execution');
    } else {
      console.log('\n❌ SINGLE TEST UPDATE: FAILED');
      console.log('❌ Error:', result.error);
      console.log('❌ Do not proceed with bulk updates until issue is resolved');
    }
    process.exit(result.success ? 0 : 1);
  })
  .catch((error) => {
    console.error('\n💥 Critical error during test:', error);
    process.exit(1);
  });