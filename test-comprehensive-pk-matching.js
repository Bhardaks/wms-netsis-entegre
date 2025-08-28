// Comprehensive test PK package matching with all database products
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { netsisAPI } = require('./backend/services/netsis');

async function comprehensiveTest() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path.join(__dirname, 'backend', 'db', 'wms.db'));
    
    // Get some real PK products (increase the sample size)
    db.all(`
      SELECT sku, name FROM products 
      WHERE sku LIKE 'PK-%' 
      ORDER BY sku
      LIMIT 50
    `, async (err, pkProducts) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Get ALL YT products (all potential main products)
      db.all(`
        SELECT sku, name FROM products 
        WHERE sku LIKE '%-YT-%'
        ORDER BY sku
      `, async (err2, ytProducts) => {
        if (err2) {
          reject(err2);
          return;
        }
        
        db.close();
        
        try {
          console.log('🧪 Comprehensive Database PK Matching Test');
          console.log('=' .repeat(60));
          console.log(`📦 Test PK products: ${pkProducts.length}`);
          console.log(`🏷️ Available YT products: ${ytProducts.length}`);
          
          // Show first few PK products we're testing
          console.log(`\n📋 Sample PK Products to test:`);
          pkProducts.slice(0, 5).forEach(pk => {
            console.log(`   ${pk.sku} -> ${pk.name}`);
          });
          
          // Combine all products for matching
          const allProducts = [...pkProducts, ...ytProducts];
          
          // Run matching - but let's do it manually with more detail
          console.log(`\n🔍 Running detailed matching analysis...`);
          
          let successful = 0;
          let failed = 0;
          
          for (let i = 0; i < Math.min(pkProducts.length, 10); i++) {
            const pk = pkProducts[i];
            const matchResult = netsisAPI.matchPkProductWithMainProduct(pk.sku);
            
            if (matchResult) {
              console.log(`\n${i + 1}. Testing: ${pk.sku}`);
              console.log(`   PK Product: ${pk.name}`);
              console.log(`   Trying SKUs: [${matchResult.possibleMainSkus.join(', ')}]`);
              
              let found = false;
              for (const possibleSku of matchResult.possibleMainSkus) {
                const mainProduct = ytProducts.find(yt => yt.sku === possibleSku);
                if (mainProduct) {
                  console.log(`   ✅ MATCH: ${possibleSku} -> ${mainProduct.name}`);
                  successful++;
                  found = true;
                  break;
                }
              }
              
              if (!found) {
                console.log(`   ❌ NO MATCH FOUND`);
                failed++;
              }
            }
          }
          
          console.log(`\n📊 Detailed Results:`);
          console.log(`   Successful matches: ${successful}`);
          console.log(`   Failed matches: ${failed}`);
          console.log(`   Success rate: ${((successful / (successful + failed)) * 100).toFixed(1)}%`);
          
          resolve({ successful, failed });
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}

// Run comprehensive test
comprehensiveTest().then((results) => {
  console.log('\n🏁 Comprehensive test completed');
  console.log(`Final success rate: ${((results.successful / (results.successful + results.failed)) * 100).toFixed(1)}%`);
}).catch(console.error);