// Test script for WMS-Netsis quantity synchronization fix
const { netsisAPI } = require('./backend/services/netsis.js');

async function testQuantityFix() {
  console.log('🧪 WMS-Netsis Miktar Senkronizasyonu Testi');
  console.log('=' .repeat(50));
  
  try {
    // Test connection first
    console.log('🔄 Netsis bağlantısı test ediliyor...');
    const connectionTest = await netsisAPI.testConnection();
    
    if (!connectionTest.success) {
      throw new Error(`Netsis connection failed: ${connectionTest.message}`);
    }
    
    console.log('✅ Netsis bağlantısı başarılı');
    
    // Prepare test order data with quantity 3 (same as the original issue)
    const testOrderData = {
      order_number: '000000000010386', // Same order number from the issue
      customer_code: '00 0004',
      order_date: new Date().toISOString(),
      items: [
        {
          sku: 'CC-YT-S-BE-01',
          product_sku: 'CC-YT-S-BE-01', 
          quantity: 3, // ✅ WMS shows 3 units
          picked_qty: 3, // ✅ All 3 picked
          price: 404.96,
          unit_price: 404.96
        }
      ]
    };
    
    console.log('📦 Test order data:');
    console.log(JSON.stringify(testOrderData, null, 2));
    
    // Test the new manual ItemSlips approach
    console.log('\n🔧 Testing manual ItemSlips delivery note creation...');
    const result = await netsisAPI.convertOrderToDeliveryNote(testOrderData);
    
    console.log('\n📊 Result:');
    console.log('Success:', result.success);
    console.log('Method:', result.method);
    console.log('Message:', result.message);
    
    if (result.success) {
      console.log('Delivery Note ID:', result.delivery_note_id);
      console.log('WMS Quantities Used:', result.wms_quantities_used);
      console.log('Lines Created:', result.lines_created);
      
      if (result.wms_quantities_used === true) {
        console.log('\n✅ SORUN ÇÖZÜLDÜ! WMS miktarları (3 adet) Netsis\'e aktarıldı');
        console.log('🎯 Manual ItemSlips yaklaşımı başarılı oldu');
      } else {
        console.log('\n⚠️ TopluSiparisToIrsFat kullanıldı - miktarlar Netsis siparişinden alındı');
        console.log('🔄 Manuel yaklaşım çalışmadı, fallback kullanıldı');
      }
    } else {
      console.log('\n❌ İrsaliye oluşturulamadı');
      console.log('Error details:', result.error_details || result.message);
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('🧪 Test tamamlandı');
    
  } catch (error) {
    console.error('❌ Test hatası:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the test
testQuantityFix().then(() => {
  console.log('\n✅ Test script completed');
  process.exit(0);
}).catch(error => {
  console.error('❌ Test script failed:', error);
  process.exit(1);
});