/**
 * Deployment Database Setup Script
 * 
 * Bu script deployment sırasında çalıştırılır ve database'in güvenli bir şekilde 
 * korunmasını sağlar. GitHub'a her push edildiğinde database sıfırlanması problemini çözer.
 */

const DatabaseManager = require('./backend/db/database-manager');
const path = require('path');
const fs = require('fs');

class DeploymentSetup {
  constructor() {
    this.dbManager = new DatabaseManager();
    this.isProduction = process.env.NODE_ENV === 'production';
    this.isRailway = process.env.RAILWAY_ENVIRONMENT === 'true';
  }

  async run() {
    console.log('🚀 Starting deployment database setup...');
    console.log(`Environment: ${this.isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    console.log(`Platform: ${this.isRailway ? 'RAILWAY' : 'LOCAL'}`);
    
    try {
      // Step 1: Check current database status
      await this.checkDatabaseStatus();
      
      // Step 2: Handle deployment-specific logic
      if (this.isProduction || this.isRailway) {
        await this.handleProductionDeployment();
      } else {
        await this.handleDevelopmentSetup();
      }
      
      // Step 3: Verify final database state
      await this.verifyDatabaseState();
      
      console.log('✅ Deployment database setup completed successfully');
      
    } catch (error) {
      console.error('❌ Deployment setup failed:', error.message);
      console.error('Stack:', error.stack);
      process.exit(1);
    }
  }

  async checkDatabaseStatus() {
    console.log('🔍 Checking database status...');
    
    const dbPath = path.join(__dirname, 'backend', 'db', 'wms.db');
    const dbExists = fs.existsSync(dbPath);
    
    console.log(`Database file exists: ${dbExists ? '✅' : '❌'}`);
    
    if (dbExists) {
      const stats = fs.statSync(dbPath);
      console.log(`Database size: ${this.dbManager.formatFileSize(stats.size)}`);
      console.log(`Last modified: ${stats.mtime.toISOString()}`);
      
      // Check integrity
      const integrityResult = await this.dbManager.checkDatabaseIntegrity();
      console.log(`Database integrity: ${integrityResult.success ? '✅' : '❌'}`);
      
      if (!integrityResult.success) {
        console.log('⚠️ Database integrity issues detected');
      }
    }
    
    // List available backups
    const backupsResult = await this.dbManager.listBackups();
    if (backupsResult.success) {
      console.log(`Available backups: ${backupsResult.backups.length}`);
      if (backupsResult.backups.length > 0) {
        const latest = backupsResult.backups[0];
        console.log(`Latest backup: ${latest.name} (${latest.age})`);
      }
    }
  }

  async handleProductionDeployment() {
    console.log('🏭 Handling production deployment...');
    
    const dbPath = path.join(__dirname, 'backend', 'db', 'wms.db');
    const dbExists = fs.existsSync(dbPath);
    
    if (!dbExists) {
      console.log('🔄 No database found in production, checking for restoration options...');
      
      // Option 1: Restore from most recent backup
      const backupsResult = await this.dbManager.listBackups();
      if (backupsResult.success && backupsResult.backups.length > 0) {
        const latestBackup = backupsResult.backups[0];
        console.log(`📦 Restoring from backup: ${latestBackup.name}`);
        
        const restoreResult = await this.dbManager.restoreFromBackup(latestBackup.name);
        if (restoreResult.success) {
          console.log('✅ Database restored from backup successfully');
          return;
        } else {
          console.log('⚠️ Backup restoration failed, falling back to seed');
        }
      }
      
      // Option 2: Initialize from seed
      console.log('🌱 No backups available, initializing from seed...');
      await this.initializeFromSeed();
      
    } else {
      console.log('✅ Database exists, creating deployment backup...');
      await this.dbManager.createBackup('deployment');
    }
  }

  async handleDevelopmentSetup() {
    console.log('🛠️ Handling development setup...');
    
    const result = await this.dbManager.initializeDatabase();
    if (result.success) {
      console.log(`✅ Development database ready (source: ${result.source})`);
    } else {
      throw new Error(`Development setup failed: ${result.error}`);
    }
  }

  async initializeFromSeed() {
    console.log('🌱 Initializing database from scratch...');
    
    try {
      // Step 1: Run database migration to create tables
      console.log('📋 Step 1: Creating database tables...');
      await this.runDatabaseMigration();
      
      // Step 2: Run seed script to populate data
      console.log('🌱 Step 2: Seeding initial data...');
      const seedPath = path.join(__dirname, 'backend', 'db', 'seed.js');
      
      if (fs.existsSync(seedPath)) {
        // Clear the require cache to ensure fresh execution
        delete require.cache[require.resolve(seedPath)];
        require(seedPath);
        console.log('✅ Database seeding completed');
        
        // Create initial backup after seeding
        await this.dbManager.createBackup('initial-seed');
      } else {
        console.log('⚠️ Seed file not found, database has tables but no data');
      }
      
    } catch (error) {
      throw new Error(`Database initialization failed: ${error.message}`);
    }
  }

  async runDatabaseMigration() {
    try {
      const migratePath = path.join(__dirname, 'backend', 'db', 'migrate.js');
      
      if (fs.existsSync(migratePath)) {
        console.log('🔧 Running database migration...');
        
        // Clear require cache for migration
        delete require.cache[require.resolve(migratePath)];
        
        // Import and run migration
        const { runMigration } = require(migratePath);
        await runMigration();
        
        console.log('✅ Database migration completed');
      } else {
        // Fallback: Create tables manually
        console.log('⚠️ Migration file not found, creating tables manually...');
        await this.createTablesManually();
      }
    } catch (error) {
      console.error('❌ Migration failed, attempting manual table creation...');
      await this.createTablesManually();
    }
  }

  async createTablesManually() {
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = path.join(__dirname, 'backend', 'db', 'wms.db');
    
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dbPath);
      
      // Essential tables creation
      const createTables = `
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'operator',
          full_name TEXT,
          email TEXT,
          active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_login DATETIME
        );

        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sku TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          main_barcode TEXT,
          price DECIMAL(10,2),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_number TEXT UNIQUE NOT NULL,
          customer_name TEXT,
          status TEXT DEFAULT 'open',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS packages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          package_number TEXT UNIQUE NOT NULL,
          barcode TEXT UNIQUE,
          shelf_location TEXT,
          status TEXT DEFAULT 'available',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS shelves (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          location TEXT UNIQUE NOT NULL,
          section TEXT,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        INSERT OR IGNORE INTO users (username, password, role, full_name) 
        VALUES ('admin', '$2b$10$8rLKlcz8C8GZpPh8K9KVSO.zP2LhJc8nVs9fVSjKJ8vY0kG9qGgPK', 'admin', 'System Admin');
      `;
      
      db.exec(createTables, (err) => {
        db.close();
        
        if (err) {
          console.error('❌ Manual table creation failed:', err.message);
          reject(err);
        } else {
          console.log('✅ Essential tables created manually');
          resolve();
        }
      });
    });
  }

  async verifyDatabaseState() {
    console.log('🔍 Verifying final database state...');
    
    const dbPath = path.join(__dirname, 'backend', 'db', 'wms.db');
    if (!fs.existsSync(dbPath)) {
      throw new Error('Database file missing after setup');
    }
    
    const integrityResult = await this.dbManager.checkDatabaseIntegrity();
    if (!integrityResult.success) {
      console.log('⚠️ Database integrity check failed, attempting emergency table creation...');
      
      try {
        // Emergency fallback: Create tables manually and seed
        await this.emergencyDatabaseSetup();
        
        // Retry integrity check
        const retryIntegrityResult = await this.dbManager.checkDatabaseIntegrity();
        if (!retryIntegrityResult.success) {
          throw new Error(`Emergency database setup failed: ${retryIntegrityResult.error}`);
        }
        
        console.log('✅ Emergency database setup succeeded');
      } catch (emergencyError) {
        throw new Error(`Database integrity check failed and emergency setup failed: ${emergencyError.message}`);
      }
    }
    
    // Check for critical data
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(dbPath);
    
    return new Promise((resolve, reject) => {
      db.get("SELECT COUNT(*) as count FROM users WHERE username = 'admin'", (err, row) => {
        if (err) {
          console.error('❌ Admin user check failed:', err.message);
          // Don't fail deployment if admin check fails, just warn
          console.log('⚠️ Admin user check failed but continuing deployment');
          db.close();
          resolve();
          return;
        }
        
        if (row.count === 0) {
          console.log('⚠️ Admin user not found, this may be a fresh installation');
        } else {
          console.log('✅ Admin user verified');
        }
        
        db.close();
        resolve();
      });
    });
  }

  async emergencyDatabaseSetup() {
    console.log('🚨 Running emergency database setup...');
    
    try {
      // Force create tables manually
      await this.createTablesManually();
      
      // Create emergency backup
      await this.dbManager.createBackup('emergency-setup');
      
      console.log('✅ Emergency database setup completed');
    } catch (error) {
      console.error('❌ Emergency database setup failed:', error.message);
      throw error;
    }
  }
}

// Run deployment setup if this script is executed directly
if (require.main === module) {
  const deploymentSetup = new DeploymentSetup();
  deploymentSetup.run()
    .then(() => {
      console.log('🎉 Deployment setup completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Deployment setup failed:', error.message);
      process.exit(1);
    });
}

module.exports = DeploymentSetup;