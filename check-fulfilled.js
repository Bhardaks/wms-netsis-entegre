const axios = require('axios');

(async () => {
  try {
    const { data } = await axios.get('http://localhost:5000/api/orders');
    
    console.log('📦 FULFILLED Siparişler:');
    const fulfilled = data.filter(o => o.fulfillment_status === 'FULFILLED');
    fulfilled.forEach(o => {
      console.log(`  #${o.order_number}: status=${o.status}, fulfillment=${o.fulfillment_status}`);
    });
    console.log(`Toplam: ${fulfilled.length}`);
    
    console.log('\n🔶 PARTIALLY_FULFILLED Siparişler:');
    const partial = data.filter(o => o.fulfillment_status === 'PARTIALLY_FULFILLED');
    partial.forEach(o => {
      console.log(`  #${o.order_number}: status=${o.status}, fulfillment=${o.fulfillment_status}`);
    });
    console.log(`Toplam: ${partial.length}`);
    
    console.log('\n❌ NOT_FULFILLED Siparişler:');
    const notFulfilled = data.filter(o => o.fulfillment_status === 'NOT_FULFILLED');
    notFulfilled.forEach(o => {
      console.log(`  #${o.order_number}: status=${o.status}, fulfillment=${o.fulfillment_status}`);
    });
    console.log(`Toplam: ${notFulfilled.length}`);
    
    console.log('\n🔄 fulfilled Status Siparişler (Local):');
    const localFulfilled = data.filter(o => o.status === 'fulfilled');
    localFulfilled.forEach(o => {
      console.log(`  #${o.order_number}: status=${o.status}, fulfillment=${o.fulfillment_status || 'null'}`);
    });
    console.log(`Toplam: ${localFulfilled.length}`);
    
  } catch (error) {
    console.error('Hata:', error.message);
  }
})();