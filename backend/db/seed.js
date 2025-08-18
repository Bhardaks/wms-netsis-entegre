
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'wms.db'));

function run(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

(async () => {
  try {
    // Basic sample data
    await run(`INSERT OR IGNORE INTO products (sku, name, description, main_barcode, price) VALUES
      ('BED-SET-001', 'Yatak Odası Takımı', '3 paketli set', '1111111111111', 1299.00),
      ('SOFA-3S-001', '3''lü Koltuk', 'Tek paket ürün', '2222222222222', 699.00)
    `);

    const bed = await get(`SELECT id FROM products WHERE sku='BED-SET-001'`);
    await run(`INSERT OR IGNORE INTO product_packages (product_id, package_name, barcode, quantity) VALUES
      (?, 'Paket A - Başlık', 'BED-A-0001', 1),
      (?, 'Paket B - Dolap', 'BED-B-0001', 1),
      (?, 'Paket C - Komodin', 'BED-C-0001', 1)
    `, [bed.id, bed.id, bed.id]);

    const sofa = await get(`SELECT id FROM products WHERE sku='SOFA-3S-001'`);
    await run(`INSERT OR IGNORE INTO product_packages (product_id, package_name, barcode, quantity) VALUES
      (?, 'Ana Paket', 'SOFA-PACK-0001', 1)
    `, [sofa.id]);

    // Create a demo order: 1 Bed set and 2 Sofas
    await run(`INSERT OR IGNORE INTO orders (order_number, customer_name, status) VALUES ('ORD-1001', 'Müşteri A', 'open')`);
    const ord = await get(`SELECT id FROM orders WHERE order_number='ORD-1001'`);
    await run(`INSERT OR IGNORE INTO order_items (order_id, product_id, sku, product_name, quantity) VALUES
      (?, ?, 'BED-SET-001', 'Yatak Odası Takımı', 1),
      (?, ?, 'SOFA-3S-001', '3''lü Koltuk', 2)
    `, [ord.id, bed.id, ord.id, sofa.id]);

    console.log('✅ Seed data inserted');
    db.close();
  } catch (e) {
    console.error('Seed failed:', e.message);
    process.exit(1);
  }
})();
