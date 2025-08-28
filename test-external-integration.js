const fetch = require('node-fetch');

// External orders'tan örnek sipariş al ve entegre et
async function testExternalIntegration() {
  try {
    console.log('🔄 Fetching external orders...');
    
    // External API'den orders.json'ı al
    const response = await fetch('http://93.89.67.130:8080/orders.json');
    const data = await response.json();
    
    if (!data.orders || data.orders.length === 0) {
      console.log('❌ No orders found in external API');
      return;
    }
    
    // İlk siparişi test için al
    const externalOrder = data.orders[0];
    console.log(`📦 Testing with order: ${externalOrder.siparisNo}`);
    console.log(`👤 Customer: ${externalOrder.cariKodu}`);
    console.log(`📋 Items: ${externalOrder.satirlar.length} items`);
    
    // External siparişi WMS formatına çevir
    const wmsOrder = {
      id: externalOrder.siparisNo,
      order_number: externalOrder.siparisNo,
      customer_code: externalOrder.cariKodu,
      customer_name: externalOrder.cariKodu,
      order_date: externalOrder.siparisTarihi,
      total_amount: externalOrder.toplamTutar,
      kdv_amount: externalOrder.kdvTutar,
      kdv_included: externalOrder.kdvDahilMi,
      items: externalOrder.satirlar.map(item => ({
        id: `${externalOrder.siparisNo}-${item.sira}`,
        product_sku: item.stokKodu,
        stokKodu: item.stokKodu,
        product_name: item.stokKodu,
        quantity: item.miktar,
        unit_price: item.birimFiyat,
        line_number: item.sira,
        warehouse_code: item.depoKodu,
        description: item.aciklama,
        unit: item.birim,
        vat_rate: item.kdvOrani
      })),
      status: 'open',
      fulfillment_status: 'UNFULFILLED',
      created_date: new Date(externalOrder.siparisTarihi),
      created_at: externalOrder.siparisTarihi,
      source: 'external',
      category: 'ongoing'
    };
    
    console.log('\n🔄 Integrating with WMS API...');
    
    // WMS integration API'sine gönder
    const integrationResponse = await fetch('http://localhost:5000/api/external-orders/integrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        external_order: wmsOrder,
        source: 'external_api'
      })
    });
    
    const result = await integrationResponse.json();
    
    console.log('\n✅ Integration result:');
    console.log(`Order ID: ${result.order_id}`);
    console.log(`Pick ID: ${result.pick_id}`);
    console.log(`Matched items: ${result.matched_items ? result.matched_items.length : 0}`);
    console.log(`Unmatched items: ${result.unmatched_items ? result.unmatched_items.length : 0}`);
    console.log(`Fulfillment status: ${result.fulfillment_status}`);
    console.log(`Message: ${result.message}`);
    
    if (result.matched_items && result.matched_items.length > 0) {
      console.log('\n📦 Matched items:');
      result.matched_items.forEach(item => {
        console.log(`  - ${item.stokKodu}: ${item.product_name} (Package: ${item.package_name || 'N/A'})`);
      });
    }
    
    if (result.unmatched_items && result.unmatched_items.length > 0) {
      console.log('\n❌ Unmatched items:');
      result.unmatched_items.forEach(item => {
        console.log(`  - ${item.stokKodu}: ${item.description}`);
      });
    }
    
    if (result.pick_id) {
      console.log(`\n🔗 Pick URL: http://localhost:5000/pick.html?pick=${result.pick_id}`);
    }
    
  } catch (error) {
    console.error('❌ Test error:', error.message);
  }
}

testExternalIntegration();