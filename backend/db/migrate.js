const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Allow external database connection (for Railway)
let DB_PATH = path.join(__dirname, 'wms.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Check if running on Railway
const isRailway = process.env.RAILWAY_ENVIRONMENT === 'production';
if (isRailway) {
  DB_PATH = ':memory:'; // Use in-memory database for Railway
  console.log('🚂 Railway: Using in-memory database for migration');
}

async function runMigration(externalDb = null) {
  console.log('🔧 Migration started with external DB:', !!externalDb);
  
  try {
    // Use external database if provided, otherwise create new one
    const db = externalDb || new sqlite3.Database(DB_PATH);
    console.log('🔧 Using database connection');
    
    function runSql(sql) {
      return new Promise((resolve, reject) => {
        db.exec(sql, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    
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

    // Read and apply schema
    console.log('📂 Reading schema file...');
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    await runSql(schema);
    console.log('✅ Schema applied successfully');

    // Add missing columns via ensureColumn
    await ensureColumn(db, 'products', 'color', 'color TEXT');
    await ensureColumn(db, 'products', 'main_product_name', 'main_product_name TEXT');
    await ensureColumn(db, 'products', 'main_product_name_en', 'main_product_name_en TEXT');
    await ensureColumn(db, 'products', 'wix_product_id', 'wix_product_id TEXT');
    await ensureColumn(db, 'products', 'wix_variant_id', 'wix_variant_id TEXT');
    await ensureColumn(db, 'orders', 'color', 'color TEXT');
    await ensureColumn(db, 'orders', 'external_id', 'external_id TEXT');
    await ensureColumn(db, 'orders', 'external_source', 'external_source TEXT');
    await ensureColumn(db, 'orders', 'netsis_delivery_note', 'netsis_delivery_note TEXT');
    await ensureColumn(db, 'orders', 'netsis_integration_status', 'netsis_integration_status TEXT');
    await ensureColumn(db, 'orders', 'netsis_error', 'netsis_error TEXT');
    await ensureColumn(db, 'order_items', 'unit_price', 'unit_price REAL DEFAULT 0');
    await ensureColumn(db, 'order_items', 'line_number', 'line_number INTEGER');
    await ensureColumn(db, 'order_items', 'warehouse_code', 'warehouse_code TEXT');
    await ensureColumn(db, 'order_items', 'description', 'description TEXT');
    await ensureColumn(db, 'order_items', 'unit_type', 'unit_type TEXT');
    await ensureColumn(db, 'order_items', 'vat_rate', 'vat_rate REAL');
    await ensureColumn(db, 'shelves', 'current_usage', 'current_usage INTEGER DEFAULT 0');
    await ensureColumn(db, 'shelf_packages', 'last_updated', 'last_updated DATETIME DEFAULT CURRENT_TIMESTAMP');
    await ensureColumn(db, 'shelf_packages', 'assigned_by', 'assigned_by TEXT');
    await ensureColumn(db, 'product_packages', 'package_content', 'package_content TEXT');

    // Insert essential locations
    await runSql(`
      INSERT OR IGNORE INTO locations (code, name) VALUES 
      ('A1-01-359', 'A Blok 1. Koridor 359 Raf'),
      ('SSH-01-01', 'SSH Servis Alanı'),
      ('A1-01-219', 'A Blok 1. Koridor 219 Raf'), 
      ('B2-01-156', 'B Blok 2. Koridor 156 Raf')
    `);

    // Map real packages to realistic locations
    await runSql(`DELETE FROM product_locations WHERE product_id = 5107`);
    await runSql(`
      INSERT OR IGNORE INTO product_locations (product_id, location_id, on_hand)
      SELECT 5107, l.id, 1 FROM locations l WHERE l.code = 'A1-01'
      UNION ALL
      SELECT 5107, l.id, 1 FROM locations l WHERE l.code = 'A1-02' 
      UNION ALL
      SELECT 5107, l.id, 1 FROM locations l WHERE l.code = 'B2-01'
    `);

    console.log('✅ Migration completed successfully');
    if (!externalDb) {
      db.close();
    }
    return true;
    
  } catch (e) {
    console.error('❌ Migration failed:', e.message);
    throw e;
  }
}

// Export the migration function
module.exports = runMigration;

// If run directly (not imported), execute migration
if (require.main === module) {
  runMigration().then(() => {
    console.log('✅ Migration completed successfully');
    process.exit(0);
  }).catch((e) => {
    console.error('❌ Migration failed:', e.message);
    process.exit(1);
  });
}