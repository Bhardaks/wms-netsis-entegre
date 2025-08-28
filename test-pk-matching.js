// Test PK package matching functionality
require('dotenv').config();
const { netsisAPI } = require('./backend/services/netsis');

// Test data
const testProducts = [
  { sku: 'ZAR-YT-S-RO', name: 'Zara Yatak Siyah Romanya' },
  { sku: 'PK-ZAR-RO-S-SF-3-3', name: 'PK Zara Romanya Siyah SF 3-3' },
  { sku: 'PK-ZAR-RO-S-KM1-1', name: 'PK Zara Romanya Siyah KM1 1' },
  { sku: 'BEL-YT-C-BE', name: 'Bella Yatak Cam Belçika' },
  { sku: 'PK-BEL-BE-C-KT1-1-A', name: 'PK Bella Belçika Cam KT1 1-A' },
  { sku: 'EFS-YT-B-RO', name: 'Efes Yatak Beyaz Romanya' },
  { sku: 'PK-EFS-RO-B-KB-2-1', name: 'PK Efes Romanya Beyaz KB 2-1' },
  { sku: 'ACE-YT-A-RO', name: 'Açelya Yatak Aytaşı Romanya' }
];

async function testPkMatching() {
  try {
    console.log('🧪 PK Paket Eşleştirme Testi');
    console.log('=' .repeat(50));
    
    // Test individual matching function
    console.log('\n1. Bireysel Eşleştirme Testleri:');
    const pkProducts = testProducts.filter(p => p.sku.startsWith('PK-'));
    
    for (const pkProduct of pkProducts) {
      const result = netsisAPI.matchPkProductWithMainProduct(pkProduct.sku);
      if (result) {
        console.log(`✅ ${pkProduct.sku} -> ${result.mainProductSku}`);
        console.log(`   Transformasyon: ${result.transformation}`);
        console.log(`   Marka: ${result.brand}, Bölge: ${result.region}, Renk: ${result.color}`);
      } else {
        console.log(`❌ ${pkProduct.sku} -> Eşleştirme başarısız`);
      }
    }
    
    // Test batch matching
    console.log('\n2. Toplu Eşleştirme Testi:');
    const matches = await netsisAPI.matchAllPkProducts(testProducts);
    
    console.log(`\n📊 Sonuçlar:`);
    console.log(`   Toplam PK ürün: ${pkProducts.length}`);
    console.log(`   Eşleştirme denemesi: ${matches.length}`);
    console.log(`   Başarılı eşleştirme: ${matches.filter(m => m.matched).length}`);
    
    console.log('\n📋 Detaylı Sonuçlar:');
    matches.forEach(match => {
      if (match.matched) {
        console.log(`✅ ${match.packageSku} -> ${match.mainProductSku} (${match.mainProduct.name})`);
      } else {
        console.log(`⚠️ ${match.packageSku} -> ${match.mainProductSku} (Ana ürün bulunamadı)`);
      }
    });
    
  } catch (error) {
    console.error('❌ Test hatası:', error);
  }
}

// Run test
testPkMatching().then(() => {
  console.log('\n🏁 Test tamamlandı');
}).catch(console.error);