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
    console.log('=== Wix API Response Tam Analiz ===');
    
    const body = { 
      cursorPaging: { limit: 100 },
      filter: { 
        createdDate: { $gte: '2023-01-01T00:00:00.000Z' },
        status: { $ne: 'INITIALIZED' }
      },
      sort: [{ fieldName: 'createdDate', order: 'DESC' }]
    };
    
    const { data } = await axios.post(ECOM_ORDERS_SEARCH, body, { headers: headers() });
    
    console.log('📋 Response structure:');
    console.log('   Keys:', Object.keys(data));
    console.log('   Orders count:', data.orders?.length || 0);
    
    if (data.metadata) {
      console.log('\n📊 Metadata:');
      console.log(JSON.stringify(data.metadata, null, 2));
    }
    
    if (data.nextCursor) {
      console.log('\n🔗 Next cursor:', data.nextCursor.substring(0, 50) + '...');
    } else {
      console.log('\n❌ Next cursor: yok');
    }
    
    // İlk birkaç siparişin tarihlerini detaylı gör
    console.log('\n📅 İlk 5 siparişin detaylı tarihleri:');
    data.orders?.slice(0, 5).forEach((o, i) => {
      console.log(`   ${i+1}. ${o.number}: ${o.createdDate} (${new Date(o.createdDate).toLocaleString('tr-TR')})`);
    });
    
    // En son siparişin tarihi
    if (data.orders && data.orders.length > 0) {
      const lastOrder = data.orders[data.orders.length - 1];
      console.log(`\n📆 En eski sipariş: ${lastOrder.number} - ${new Date(lastOrder.createdDate).toLocaleString('tr-TR')}`);
    }
    
  } catch (error) {
    console.error('❌ Hata:', error.response?.data || error.message);
  }
})();