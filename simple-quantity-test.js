// Simple test using existing order 39 (000000000010386)
const axios = require('axios');

async function testExistingOrder() {
  console.log('🧪 WMS-Netsis Miktar Senkronizasyonu Test');
  console.log('🎯 Sipariş 000000000010386 (3 adet CC-YT-S-BE-01)');
  console.log('=' .repeat(50));
  
  try {
    const serverUrl = 'http://localhost:5000';
    const orderId = 39; // Order 000000000010386
    
    // Check order details first
    console.log(`🔍 Sipariş ${orderId} detayları kontrol ediliyor...`);
    const orderResponse = await axios.get(`${serverUrl}/api/orders/${orderId}`);
    const order = orderResponse.data;
    
    console.log('📋 Sipariş Bilgileri:');
    console.log(`- Sipariş No: ${order.order_number}`);
    console.log(`- Müşteri: ${order.customer_name} (${order.customer_code})`);
    console.log(`- Durum: ${order.status}`);
    console.log(`- Tamamlanma: ${order.fulfillment_status}`);
    console.log(`- Mevcut İrsaliye ID: ${order.netsis_delivery_note_id || 'YOK'}`);
    
    console.log('\n📦 Sipariş Kalemler:');
    order.items.forEach(item => {
      console.log(`- ${item.sku}: ${item.quantity} adet (${item.picked_qty} alındı) - Birim Fiyat: ${item.unit_price}`);
    });
    
    // Clear existing delivery note if exists
    if (order.netsis_delivery_note_id) {
      console.log('\n🗑️ Mevcut irsaliye ID\'si siliniyor...');
      await axios.put(`${serverUrl}/api/orders/${orderId}/clear-delivery`);
      console.log('✅ İrsaliye ID\'si temizlendi');
    }
    
    // Test the delivery note creation
    console.log('\n🔧 Yeni irsaliye oluşturma test ediliyor...');
    console.log('📋 WMS\'de 3 adet görünüyor, Netsis\'e de 3 adet aktarılacak mı?');
    
    try {
      const result = await axios.post(`${serverUrl}/api/convert-to-dispatch/${orderId}`, {}, {
        timeout: 60000 // 60 second timeout
      });
      
      console.log('\n📊 Sonuç:');
      console.log(`✅ Başarılı: ${result.data.success}`);
      console.log(`📄 İrsaliye ID: ${result.data.delivery_note_id || 'YOK'}`);
      console.log(`📋 Mesaj: ${result.data.message}`);
      
      if (result.data.netsis_response) {
        console.log(`🔧 Netsis Response: ${JSON.stringify(result.data.netsis_response).substring(0, 200)}`);
      }
      
      // Check if manual method was used
      console.log('\n🎯 ANALIZ:');
      if (result.data.message?.includes('manuel') || result.data.message?.includes('WMS miktarları')) {
        console.log('🎉 SORUN ÇÖZÜLDÜ!');
        console.log('✅ Manuel ItemSlips yaklaşımı kullanıldı');
        console.log('✅ WMS miktarları (3 adet) Netsis\'e aktarıldı');
      } else if (result.data.message?.includes('TopluSiparisToIrsFat') || result.data.message?.includes('Netsis siparişindeki')) {
        console.log('⚠️ SORUN DEVAM EDİYOR');
        console.log('❌ TopluSiparisToIrsFat kullanıldı (fallback)');
        console.log('❌ Miktarlar Netsis siparişinden alındı (eski problem)');
      } else {
        console.log('❓ Belirsiz durum - mesaj detayları kontrol edilmeli');
      }
      
    } catch (apiError) {
      console.log('\n❌ İrsaliye oluşturma başarısız:');
      if (apiError.response) {
        console.log(`HTTP Status: ${apiError.response.status}`);
        console.log(`Error: ${JSON.stringify(apiError.response.data, null, 2)}`);
      } else {
        console.log(`Network Error: ${apiError.message}`);
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('🧪 Test tamamlandı');
    
  } catch (error) {
    console.error('❌ Test hatası:', error.message);
  }
}

// Run the test
testExistingOrder().then(() => {
  console.log('\n✅ Test completed');
  process.exit(0);
}).catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});