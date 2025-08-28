const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('backend/db/wms.db');

// JSON'dan aldığımız örnek stok kodlarını kontrol edelim
const testCodes = ['LOV-UN-B-BE-03', 'ERZ-YM-K-BE-03', 'ROS-UN-L-BE-02', 'BOH-YT-D-BE-04', 'CC-YT-S-BE-01'];

console.log('Testing external stock codes matching:');

async function testCode(code) {
  return new Promise((resolve) => {
    db.get(`
      SELECT p.id, p.sku, p.name, p.netsis_code,
             pp.id as package_id, pp.package_name, pp.barcode
      FROM products p
      LEFT JOIN product_packages pp ON p.id = pp.product_id
      WHERE p.sku = ? OR p.netsis_code = ?
      ORDER BY pp.id ASC LIMIT 1
    `, [code, code], (err, row) => {
      if (err) {
        console.log(`  Error for ${code}:`, err);
      } else if (row) {
        console.log(`  ✅ ${code} -> Product ID: ${row.id}, Package: ${row.package_name || 'N/A'} (Barcode: ${row.barcode || 'N/A'})`);
      } else {
        console.log(`  ❌ ${code} -> No match found`);
      }
      resolve();
    });
  });
}

async function runTests() {
  for (const code of testCodes) {
    await testCode(code);
  }
  db.close();
}

runTests();