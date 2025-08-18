
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'wms.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new sqlite3.Database(DB_PATH);

function runSql(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

(async () => {
  // helper: check/create column
  async function ensureColumn(db, table, col, defSql) {
    const has = await new Promise((resolve,reject)=>{
      db.all(`PRAGMA table_info(${table})`, [], (err, rows)=>{
        if (err) reject(err);
        else resolve(rows.some(r=>r.name===col));
      });
    });
    if (!has) {
      await new Promise((resolve,reject)=>{
        db.run(`ALTER TABLE ${table} ADD COLUMN ${defSql}`, [], (err)=>{
          if (err) reject(err); else resolve();
        });
      });
      console.log(`➕ Added column ${table}.${col}`);
    }
  }

  try {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    await runSql(schema);
// post-schema upgrades for existing DBs
await runSql(`
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT
  );
  CREATE TABLE IF NOT EXISTS product_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    on_hand INTEGER NOT NULL DEFAULT 0,
    UNIQUE(product_id, location_id)
  );
`);

// add wix id columns if missing
await ensureColumn(db, 'products', 'wix_product_id', 'wix_product_id TEXT');
await ensureColumn(db, 'products', 'wix_variant_id', 'wix_variant_id TEXT');
await runSql(`CREATE INDEX IF NOT EXISTS idx_products_wix ON products (wix_product_id, wix_variant_id);`);

// add fulfillment_status column to orders if missing
await ensureColumn(db, 'orders', 'fulfillment_status', 'fulfillment_status TEXT');

// add wix_order_id column to orders if missing
await ensureColumn(db, 'orders', 'wix_order_id', 'wix_order_id TEXT');

// add weight and volume columns to product_packages if missing
await ensureColumn(db, 'product_packages', 'weight_kg', 'weight_kg REAL');
await ensureColumn(db, 'product_packages', 'volume_m3', 'volume_m3 REAL');

// add package number and content columns to product_packages if missing
await ensureColumn(db, 'product_packages', 'package_number', 'package_number TEXT');
await ensureColumn(db, 'product_packages', 'package_content', 'package_content TEXT');

// add inventory quantity column to products if missing
await ensureColumn(db, 'products', 'inventory_quantity', 'inventory_quantity INTEGER');

// add required_quantity column to service_requests if missing
await ensureColumn(db, 'service_requests', 'required_quantity', 'required_quantity INTEGER DEFAULT 1');

// add source_location column to package_openings if missing
await ensureColumn(db, 'package_openings', 'source_location', 'source_location TEXT');

// add opening_method column to package_openings if missing
await ensureColumn(db, 'package_openings', 'opening_method', 'opening_method TEXT DEFAULT \'partial\'');


// Add real shelf locations with actual codes
await runSql(`
  INSERT OR IGNORE INTO locations (code, name) VALUES 
  ('A1-01-359', 'A Blok 1. Koridor 359 Raf'),
  ('A1-01-219', 'A Blok 1. Koridor 219 Raf'), 
  ('B2-01-156', 'B Blok 2. Koridor 156 Raf');
`);

// Map real packages to realistic locations based on their characteristics
// Clear existing mappings first
await runSql(`DELETE FROM product_locations WHERE product_id = 5107;`);

// Map each specific package to different locations
await runSql(`
  INSERT OR IGNORE INTO product_locations (product_id, location_id, on_hand)
  SELECT 5107, l.id, 1 FROM locations l WHERE l.code = 'A1-01' -- Package 45 (barcode: 11)
  UNION ALL
  SELECT 5107, l.id, 1 FROM locations l WHERE l.code = 'A1-02' -- Package 43 (barcode: 15) 
  UNION ALL
  SELECT 5107, l.id, 1 FROM locations l WHERE l.code = 'B2-01'; -- Package 44 (barcode: 651)
`);

console.log('✅ Real location data added');

    console.log('✅ Schema applied to', DB_PATH);
    db.close();
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  }
})();
