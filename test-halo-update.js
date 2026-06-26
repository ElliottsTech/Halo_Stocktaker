const HaloUpdater = require('./lib/halo-updater');

async function testHaloUpdate() {
  console.log('🧪 Testing Halo Update Functionality...\n');

  try {
    const updater = new HaloUpdater();

    // Test beacon update
    console.log('Testing beacon item update...');
    const result = await updater.testBeaconUpdate();

    if (result.success) {
      console.log('✅ Beacon test PASSED!');
      console.log(`Expected UPC: 9320422519548`);
      console.log(`Actual UPC: ${result.updatedUPC}`);
      console.log(`Match: ${result.updatedUPC === '9320422519548' ? '✅ YES' : '❌ NO'}`);
    } else {
      console.log('❌ Beacon test FAILED!');
      console.log('Error:', result.error);
    }

    return result;

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  }
}

// Run the test
testHaloUpdate()
  .then(() => {
    console.log('\n✅ Halo update test completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });