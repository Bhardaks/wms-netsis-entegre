const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Railway için in-memory database kullanımı
const DB_PATH = process.env.NODE_ENV === 'production' && process.env.RAILWAY_ENVIRONMENT 
  ? ':memory:' 
  : path.join(__dirname, 'wms.db');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

console.log(`🚂 Railway Migration - Using database: ${DB_PATH}`);

console.log('🗄️ Connecting to database:', DB_PATH);
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ Database connection error:', err);
  } else {
    console.log('✅ Database connected successfully');
  }
});

function runSql(sql) {
  return new Promise((resolve, reject) => {
    console.log(`📝 Executing SQL (${sql.length} chars)...`);
    db.exec(sql, (err) => {
      if (err) {
        console.error('❌ SQL execution error:', err);
        reject(err);
      } else {
        console.log('✅ SQL executed successfully');
        resolve();
      }
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
    console.log('📁 Schema path:', SCHEMA_PATH);
    console.log('📄 Reading schema file...');
    
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    console.log(`📊 Schema file size: ${schema.length} characters`);
    console.log('📋 Schema preview:', schema.substring(0, 200) + '...');
    
    console.log('🗄️ Executing schema SQL...');
    await runSql(schema);
    console.log('✅ Schema SQL executed successfully');

    // Create users table since it's not in schema.sql
    await runSql(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'operator',
        full_name TEXT,
        email TEXT,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME
      );
    `);

    // Create role_permissions table
    await runSql(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        category TEXT NOT NULL,
        subcategory TEXT,
        permission TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(role, category, subcategory, permission)
      );
    `);

    // Create locations table
    await runSql(`
      CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT
      );
    `);

    // Create service_requests table
    await runSql(`
      CREATE TABLE IF NOT EXISTS service_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        service_type TEXT NOT NULL,
        required_part TEXT NOT NULL,
        required_quantity INTEGER DEFAULT 1,
        priority TEXT DEFAULT 'normal',
        status TEXT DEFAULT 'pending',
        package_id INTEGER,
        package_number TEXT,
        package_name TEXT,
        package_barcode TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create package_openings table
    await runSql(`
      CREATE TABLE IF NOT EXISTS package_openings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        package_id INTEGER NOT NULL,
        service_request_id INTEGER,
        opened_by TEXT NOT NULL,
        opening_method TEXT DEFAULT 'partial',
        source_location TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create ssh_inventory table
    await runSql(`
      CREATE TABLE IF NOT EXISTS ssh_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        part_name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        location TEXT DEFAULT 'SSH-01-01',
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        notes TEXT,
        UNIQUE(part_name, location)
      );
    `);

    // Essential data for Railway
    console.log('👤 Inserting essential data...');
    await runSql(`
      INSERT OR IGNORE INTO users (username, password_hash, role, created_at, active) VALUES
      ('admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin', datetime('now'), 1);
      
      INSERT OR IGNORE INTO locations (code, name) VALUES 
      ('A1-01-359', 'A Blok 1. Koridor 359 Raf'),
      ('SSH-01-01', 'SSH Servis Alanı');
    `);
    console.log('✅ Essential data inserted');

    // Verify tables were created
    console.log('🔍 Verifying created tables...');
    const tables = await new Promise((resolve, reject) => {
      db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    console.log('📋 Created tables:', tables.map(t => t.name).join(', '));
    
    const requiredTables = ['products', 'orders', 'users', 'locations'];
    const missingTables = requiredTables.filter(table => 
      !tables.some(t => t.name === table)
    );
    
    if (missingTables.length > 0) {
      console.error('❌ Missing required tables:', missingTables);
      throw new Error(`Missing tables: ${missingTables.join(', ')}`);
    }

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