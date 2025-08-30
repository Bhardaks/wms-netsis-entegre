const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Railway için in-memory database kullanımı
const DB_PATH = process.env.NODE_ENV === 'production' && process.env.RAILWAY_ENVIRONMENT 
  ? ':memory:' 
  : path.join(__dirname, 'wms.db');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

console.log(`🚂 Railway Migration - Using database: ${DB_PATH}`);

const db = new sqlite3.Database(DB_PATH);

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

(async () => {
  try {
    console.log('🚂 Starting Railway migration...');
    
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    await runSql(schema);

    // Essential tables and data for Railway
    await runSql(`
      INSERT OR IGNORE INTO users (username, password, role, created_at, is_active) VALUES
      ('admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin', datetime('now'), 1);
      
      INSERT OR IGNORE INTO locations (code, name) VALUES 
      ('A1-01-359', 'A Blok 1. Koridor 359 Raf'),
      ('SSH-01-01', 'SSH Servis Alanı');
    `);

    // Add required columns for existing functionality
    await ensureColumn(db, 'products', 'wix_product_id', 'wix_product_id TEXT');
    await ensureColumn(db, 'products', 'wix_variant_id', 'wix_variant_id TEXT');
    await ensureColumn(db, 'orders', 'fulfillment_status', 'fulfillment_status TEXT');
    await ensureColumn(db, 'orders', 'wix_order_id', 'wix_order_id TEXT');
    await ensureColumn(db, 'orders', 'netsis_delivery_note_id', 'netsis_delivery_note_id TEXT');
    await ensureColumn(db, 'orders', 'netsis_delivery_status', 'netsis_delivery_status TEXT DEFAULT \'pending\'');

    console.log('✅ Railway migration completed successfully');
    
    // Keep database connection open for Railway
    if (DB_PATH === ':memory:') {
      console.log('💾 Database kept in memory for Railway deployment');
      // Export database instance for server.js
      module.exports = db;
    } else {
      db.close();
    }
    
  } catch (e) {
    console.error('❌ Railway migration failed:', e.message);
    process.exit(1);
  }
})();