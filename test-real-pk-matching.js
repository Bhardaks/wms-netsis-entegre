// Test PK package matching with real database products
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { netsisAPI } = require('./backend/services/netsis');

async function testWithRealData() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path.join(__dirname, 'backend', 'db', 'wms.db'));
    
    // Get some real PK products and potential main products
    db.all(`
      SELECT sku, name FROM products 
      WHERE sku LIKE 'PK-%' 
      LIMIT 20
    `, async (err, pkProducts) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Get all YT products (potential main products)
      db.all(`
        SELECT sku, name FROM products 
        WHERE sku LIKE '%-YT-%'
        LIMIT 200
      `, async (err2, ytProducts) => {
        if (err2) {
          reject(err2);
          return;
        }
        
        db.close();
        
        try {
          console.log('🧪 Real Database PK Matching Test');
          console.log('=' .repeat(50));
          console.log(`📦 Test PK products: ${pkProducts.length}`);
          console.log(`🏷️ Available YT products: ${ytProducts.length}`);
          
          // Combine all products for matching
          const allProducts = [...pkProducts, ...ytProducts];
          
          // Run matching
          const matches = await netsisAPI.matchAllPkProducts(allProducts);
          
          console.log(`\n📊 Final Results:`);
          console.log(`   Total PK products tested: ${pkProducts.length}`);
          console.log(`   Successful matches: ${matches.filter(m => m.matched).length}`);
          console.log(`   Failed matches: ${matches.filter(m => !m.matched).length}`);
          console.log(`   Success rate: ${((matches.filter(m => m.matched).length / matches.length) * 100).toFixed(1)}%`);
          
          console.log(`\n✅ Successful Matches:`);
          matches.filter(m => m.matched).forEach(match => {
            console.log(`   ${match.packageSku} -> ${match.mainProductSku}`);
            console.log(`      PK: ${match.pkProduct.name}`);
            console.log(`      Main: ${match.mainProduct.name}`);
          });
          
          console.log(`\n⚠️ Failed Matches:`);
          matches.filter(m => !m.matched).slice(0, 5).forEach(match => {
            const triedSkus = match.possibleMainSkus || [match.mainProductSku];
            console.log(`   ${match.packageSku} -> [${triedSkus.join(', ')}]`);
            console.log(`      PK: ${match.pkProduct.name}`);
          });
          
          resolve(matches);
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}

// Run test
testWithRealData().then((matches) => {
  console.log('\n🏁 Real database test completed');
}).catch(console.error);