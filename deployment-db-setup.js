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
    const seedPath = path.join(__dirname, 'backend', 'db', 'seed.js');
    
    if (fs.existsSync(seedPath)) {
      console.log('🌱 Running database seed...');
      
      // Execute seed script
      try {
        require(seedPath);
        console.log('✅ Database seeding completed');
        
        // Create initial backup after seeding
        await this.dbManager.createBackup('initial-seed');
      } catch (error) {
        throw new Error(`Seeding failed: ${error.message}`);
      }
    } else {
      throw new Error('Seed file not found and no backups available');
    }
  }

  async verifyDatabaseState() {
    console.log('🔍 Verifying final database state...');
    
    const dbPath = path.join(__dirname, 'backend', 'db', 'wms.db');
    if (!fs.existsSync(dbPath)) {
      throw new Error('Database file missing after setup');
    }
    
    const integrityResult = await this.dbManager.checkDatabaseIntegrity();
    if (!integrityResult.success) {
      throw new Error(`Database integrity check failed: ${integrityResult.error}`);
    }
    
    // Check for critical data
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(dbPath);
    
    return new Promise((resolve, reject) => {
      db.get("SELECT COUNT(*) as count FROM users WHERE username = 'admin'", (err, row) => {
        if (err) {
          reject(new Error(`Admin user check failed: ${err.message}`));
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