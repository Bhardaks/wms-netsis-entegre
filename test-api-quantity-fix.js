// Test script using server API endpoint
const axios = require('axios');

async function testQuantityFixViaAPI() {
  console.log('🧪 WMS-Netsis Miktar Senkronizasyonu API Testi');
  console.log('=' .repeat(50));
  
  try {
    const serverUrl = 'http://localhost:5000';
    
    // Check if server is running
    console.log('🔄 Server bağlantısı kontrol ediliyor...');
    const healthCheck = await axios.get(`${serverUrl}/api/health`);
    console.log('✅ Server aktif:', healthCheck.data);
    
    // Prepare test order data with quantity 3 - use unique order number
    const timestamp = Date.now();
    const testOrderData = {
      order_number: `TEST-${timestamp}`, 
      customer_code: '00 0004',
      customer_name: 'Test Customer',
      order_date: new Date().toISOString(),
      items: [
        {
          id: 1,
          sku: 'CC-YT-S-BE-01',
          product_sku: 'CC-YT-S-BE-01', 
          product_name: 'CC Gardrop (P.Siyah)',
          quantity: 3, // ✅ WMS shows 3 units (this is the fix!)
          picked_qty: 3, // ✅ All 3 picked
          price: 404.96,
          unit_price: 404.96
        }
      ]
    };
    
    console.log('📦 Test order data (WMS has 3 units):');
    console.log(JSON.stringify(testOrderData, null, 2));
    
    // First, create a test order in the system
    console.log('\n📝 Creating test order...');
    try {
      const createOrderResult = await axios.post(`${serverUrl}/api/orders`, testOrderData);
      const orderId = createOrderResult.data.id;
      console.log(`✅ Test order created with ID: ${orderId}`);
      
      // Mark it as fulfilled so it can be converted to dispatch
      await axios.put(`${serverUrl}/api/orders/${orderId}/fulfill`);
      console.log('✅ Order marked as fulfilled');
      
      // Now test the dispatch note creation via the existing endpoint
      console.log('\n🔧 Testing delivery note creation via server API...');
      const result = await axios.post(`${serverUrl}/api/convert-to-dispatch/${orderId}`, {}, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 60 second timeout for Netsis API
      });
      
      console.log('\n📊 API Response:');
      console.log('Status:', result.status);
      console.log('Success:', result.data.success);
      console.log('Method:', result.data.method);
      console.log('Message:', result.data.message);
      
      if (result.data.success) {
        console.log('Delivery Note ID:', result.data.delivery_note_id);
        console.log('WMS Quantities Used:', result.data.wms_quantities_used);
        console.log('Lines Created:', result.data.lines_created);
        
        if (result.data.wms_quantities_used === true) {
          console.log('\n🎉 SORUN ÇÖZÜLDÜ!');
          console.log('✅ WMS miktarları (3 adet) Netsis\'e aktarıldı');
          console.log('🎯 Manual ItemSlips yaklaşımı başarılı oldu');
          console.log('📋 Artık TopluSiparisToIrsFat yerine manuel yaklaşım kullanılıyor');
        } else if (result.data.method === 'TopluSiparisToIrsFat') {
          console.log('\n⚠️ Fallback kullanıldı');
          console.log('🔄 Manuel yaklaşım çalışmadı, TopluSiparisToIrsFat kullanıldı');
          console.log('📋 Bu durumda miktarlar Netsis siparişinden alınır (eski problem)');
        }
      } else {
        console.log('\n❌ İrsaliye oluşturulamadı');
        console.log('Error:', result.data.message);
        console.log('Details:', result.data.error_details);
      }
      
    } catch (apiError) {
      console.log('\n❌ API çağrısı başarısız:');
      if (apiError.response) {
        console.log('HTTP Status:', apiError.response.status);
        console.log('Error Response:', JSON.stringify(apiError.response.data, null, 2));
      } else {
        console.log('Network Error:', apiError.message);
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('🧪 API Test tamamlandı');
    
  } catch (error) {
    console.error('❌ Test hatası:', error.message);
  }
}

// Run the test
testQuantityFixViaAPI().then(() => {
  console.log('\n✅ API Test script completed');
  process.exit(0);
}).catch(error => {
  console.error('❌ API Test script failed:', error);
  process.exit(1);
});