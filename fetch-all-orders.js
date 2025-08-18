require('dotenv').config();
const axios = require('axios');

const ECOM_ORDERS_SEARCH = 'https://www.wixapis.com/ecom/v1/orders/search';

function headers() {
  const key = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;
  return {
    Authorization: key,
    'wix-site-id': siteId,
    'Content-Type': 'application/json'
  };
}

(async () => {
  try {
    console.log('=== Tüm Siparişleri Çek (Filtre Yok) ===');
    
    // Önce tüm siparişleri çek - hiç filtre olmadan
    const body = {
      cursorPaging: { limit: 100 }  // Maksimum limit
    };
    
    const response = await axios.post(ECOM_ORDERS_SEARCH, body, { headers: headers() });
    const orders = response.data?.orders || [];
    
    console.log(`\n📊 Sonuçlar:`);
    console.log(`   Çekilen sipariş sayısı: ${orders.length}`);
    console.log(`   Metadata total: ${response.data?.metadata?.count || 'yok'}`);
    console.log(`   hasNext: ${response.data?.metadata?.hasNext || false}`);
    
    if (orders.length > 0) {
      // Tüm siparişleri tarihe göre sırala
      const sortedOrders = orders.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));
      
      console.log(`\n📅 Tarih aralığı:`);
      console.log(`   En yeni: ${sortedOrders[0].number} - ${new Date(sortedOrders[0].createdDate).toLocaleDateString('tr-TR')}`);
      console.log(`   En eski: ${sortedOrders[sortedOrders.length-1].number} - ${new Date(sortedOrders[sortedOrders.length-1].createdDate).toLocaleDateString('tr-TR')}`);
      
      // Sayısal siparişleri bul
      const numericOrders = orders
        .filter(o => /^\d+$/.test(o.number))
        .map(o => ({...o, num: parseInt(o.number, 10)}))
        .sort((a, b) => a.num - b.num);
      
      if (numericOrders.length > 0) {
        console.log(`\n📈 Sayısal aralık:`);
        console.log(`   En küçük: ${numericOrders[0].num}`);
        console.log(`   En büyük: ${numericOrders[numericOrders.length-1].num}`);
        
        // Hedef siparişleri kontrol et
        const targets = ['10113', '10274', '10281'];
        console.log('\n🎯 Hedef siparişler:');
        targets.forEach(target => {
          const found = orders.find(o => o.number === target);
          if (found) {
            console.log(`   ✅ ${target}: ${found.status} - ${new Date(found.createdDate).toLocaleDateString('tr-TR')}`);
          } else {
            console.log(`   ❌ ${target}: Bulunamadı`);
          }
        });
      }
      
      // İlk 10 ve son 10 sipariş numaralarını göster
      const allNumbers = sortedOrders.map(o => o.number);
      console.log(`\n📋 İlk 10 sipariş: ${allNumbers.slice(0, 10).join(', ')}`);
      console.log(`   Son 10 sipariş: ${allNumbers.slice(-10).join(', ')}`);
    }
    
  } catch (error) {
    console.error('❌ Fetch Hatası:', error.response?.data || error.message);
  }
})();