// API üzerinden siparişleri sıfırlama
const fetch = require('node-fetch').default || require('node-fetch');

const BASE_URL = 'http://localhost:5000';

async function resetOrders() {
  console.log('🔄 Siparişleri API üzerinden sıfırlama işlemi başlıyor...');
  
  try {
    // 1. Önce mevcut siparişleri kontrol et
    console.log('📋 Mevcut siparişler kontrol ediliyor...');
    const ordersResponse = await fetch(`${BASE_URL}/api/orders`);
    const orders = await ordersResponse.json();
    
    console.log(`📦 Toplam ${orders.length} sipariş bulundu`);
    
    // 2. Her sipariş için sıfırlama yap
    let resetCount = 0;
    for (const order of orders) {
      if (order.status === 'fulfilled' || order.netsis_delivery_note_id) {
        try {
          const resetResponse = await fetch(`${BASE_URL}/api/orders/${order.id}/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          
          if (resetResponse.ok) {
            resetCount++;
            console.log(`✅ Sipariş #${order.order_number} sıfırlandı`);
          } else {
            console.log(`❌ Sipariş #${order.order_number} sıfırlanamadı`);
          }
        } catch (error) {
          console.log(`❌ Sipariş #${order.order_number} sıfırlama hatası:`, error.message);
        }
      }
    }
    
    console.log(`\n✅ ${resetCount} sipariş başarıyla sıfırlandı!`);
    
  } catch (error) {
    console.error('❌ Genel sıfırlama hatası:', error.message);
  }
}

// Eğer reset endpoint yoksa, manual SQL kullan
async function manualReset() {
  console.log('🔄 Manual SQL ile sıfırlama başlıyor...');
  
  try {
    const resetResponse = await fetch(`${BASE_URL}/api/admin/reset-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (resetResponse.ok) {
      const result = await resetResponse.json();
      console.log('✅ Siparişler başarıyla sıfırlandı:', result);
    } else {
      console.log('❌ Reset endpoint bulunamadı, normal reset deneniyor...');
      await resetOrders();
    }
  } catch (error) {
    console.log('❌ Manual reset başarısız, normal reset deneniyor...');
    await resetOrders();
  }
}

manualReset();