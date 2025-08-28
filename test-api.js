const https = require('https');

const testData = {
  exportedAt: new Date().toISOString(),
  count: 1,
  orders: [
    {
      subeKodu: 1,
      ftirsip: 123,
      siparisNo: "TEST001",
      cariKodu: "TEST_CUSTOMER",
      siparisTarihi: "2025-08-25",
      toplamTutar: 100.50,
      kdvTutar: 18.00,
      kdvDahilMi: true,
      satirlar: [
        {
          stokKodu: "TEST_SKU",
          aciklama: "Test Ürün",
          miktar: 2,
          birim: "ADET",
          birimFiyat: 50.25,
          kdvOrani: 18,
          depoKodu: "ANA_DEPO",
          sira: 1
        }
      ]
    }
  ]
};

console.log('🧪 Test siparişi gönderiliyor...');

// Ngrok URL'e test POST isteği gönder
const postData = JSON.stringify(testData);

const options = {
  hostname: '16b51b0bf2f9.ngrok-free.app',
  port: 443,
  path: '/api/netsis/orders',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
    'ngrok-skip-browser-warning': 'true'
  }
};

const req = https.request(options, (res) => {
  console.log(`📊 Status Code: ${res.statusCode}`);
  console.log(`📋 Headers:`, res.headers);

  let body = '';
  res.on('data', (chunk) => {
    body += chunk;
  });

  res.on('end', () => {
    console.log('📄 Response Body:', body);
    
    if (res.statusCode === 200) {
      console.log('✅ Test başarılı! Şimdi veritabanını kontrol edin.');
    } else {
      console.log('❌ Test başarısız!');
    }
  });
});

req.on('error', (e) => {
  console.error('❌ İstek hatası:', e.message);
});

req.write(postData);
req.end();