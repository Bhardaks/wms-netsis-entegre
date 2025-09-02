const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class DatabaseManager {
  constructor() {
    this.dbPath = path.join(__dirname, 'wms.db');
    this.backupDir = path.join(__dirname, 'backups');
    this.seedPath = path.join(__dirname, 'seed.js');
    
    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  // Auto backup before critical operations
  async createBackup(reason = 'manual') {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = `wms_backup_${timestamp}_${reason}.db`;
      const backupPath = path.join(this.backupDir, backupName);
      
      if (fs.existsSync(this.dbPath)) {
        fs.copyFileSync(this.dbPath, backupPath);
        console.log(`✅ Database backup created: ${backupName}`);
        
        // Clean old backups (keep last 10 of each type)
        await this.cleanOldBackups();
        
        return { success: true, backupPath, backupName };
      } else {
        console.log('⚠️ No database file found to backup');
        return { success: false, message: 'No database file found' };
      }
    } catch (error) {
      console.error('❌ Backup creation failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Restore from backup
  async restoreFromBackup(backupName) {
    try {
      const backupPath = path.join(this.backupDir, backupName);
      
      if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${backupName}`);
      }
      
      // Create safety backup before restore
      if (fs.existsSync(this.dbPath)) {
        await this.createBackup('pre-restore');
      }
      
      // Restore database
      fs.copyFileSync(backupPath, this.dbPath);
      console.log(`✅ Database restored from: ${backupName}`);
      
      return { success: true, message: `Database restored from ${backupName}` };
    } catch (error) {
      console.error('❌ Database restore failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // List available backups
  async listBackups() {
    try {
      const backups = fs.readdirSync(this.backupDir)
        .filter(file => file.endsWith('.db'))
        .map(file => {
          const stats = fs.statSync(path.join(this.backupDir, file));
          return {
            name: file,
            size: this.formatFileSize(stats.size),
            created: stats.mtime.toISOString(),
            age: this.getFileAge(stats.mtime)
          };
        })
        .sort((a, b) => new Date(b.created) - new Date(a.created));
      
      return { success: true, backups };
    } catch (error) {
      console.error('❌ Failed to list backups:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Clean old backups (keep last 10 of each type)
  async cleanOldBackups() {
    try {
      const backups = fs.readdirSync(this.backupDir)
        .filter(file => file.endsWith('.db'))
        .map(file => ({
          name: file,
          path: path.join(this.backupDir, file),
          stats: fs.statSync(path.join(this.backupDir, file))
        }))
        .sort((a, b) => b.stats.mtime - a.stats.mtime);
      
      // Group by type (manual, pre-restore, deployment, etc.)
      const groupedBackups = {};
      backups.forEach(backup => {
        const type = backup.name.includes('_manual') ? 'manual' :
                    backup.name.includes('_pre-restore') ? 'pre-restore' :
                    backup.name.includes('_deployment') ? 'deployment' : 'other';
        
        if (!groupedBackups[type]) groupedBackups[type] = [];
        groupedBackups[type].push(backup);
      });
      
      let deletedCount = 0;
      
      // Keep last 10 of each type
      Object.keys(groupedBackups).forEach(type => {
        const typeBackups = groupedBackups[type];
        if (typeBackups.length > 10) {
          const toDelete = typeBackups.slice(10);
          toDelete.forEach(backup => {
            fs.unlinkSync(backup.path);
            deletedCount++;
          });
        }
      });
      
      if (deletedCount > 0) {
        console.log(`🧹 Cleaned ${deletedCount} old backup files`);
      }
      
      return { success: true, deletedCount };
    } catch (error) {
      console.error('❌ Backup cleanup failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Initialize database with safety checks
  async initializeDatabase() {
    try {
      const dbExists = fs.existsSync(this.dbPath);
      
      if (!dbExists) {
        console.log('🆕 Database not found, initializing from seed...');
        
        // Check if we have a recent backup to restore instead
        const backupsList = await this.listBackups();
        if (backupsList.success && backupsList.backups.length > 0) {
          const latestBackup = backupsList.backups[0];
          console.log(`🔄 Found recent backup: ${latestBackup.name}, restoring...`);
          
          const restoreResult = await this.restoreFromBackup(latestBackup.name);
          if (restoreResult.success) {
            return { success: true, source: 'backup', backup: latestBackup.name };
          }
        }
        
        // No backup available, run seed
        if (fs.existsSync(this.seedPath)) {
          console.log('🌱 Running database seed...');
          require(this.seedPath);
          return { success: true, source: 'seed' };
        } else {
          throw new Error('No seed file found and no backups available');
        }
      } else {
        console.log('✅ Database file exists, checking integrity...');
        return await this.checkDatabaseIntegrity();
      }
    } catch (error) {
      console.error('❌ Database initialization failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Check database integrity
  async checkDatabaseIntegrity() {
    return new Promise((resolve) => {
      const db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
          console.error('❌ Database integrity check failed:', err.message);
          resolve({ success: false, error: err.message });
          return;
        }
        
        // Check critical tables
        const criticalTables = ['users', 'products', 'orders', 'packages', 'shelves'];
        let tablesOk = 0;
        
        const checkTable = (tableName) => {
          return new Promise((tableResolve) => {
            db.get(`SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name=?`, [tableName], (err, row) => {
              if (err || !row || row.count === 0) {
                console.log(`⚠️ Missing critical table: ${tableName}`);
                tableResolve(false);
              } else {
                tablesOk++;
                tableResolve(true);
              }
            });
          });
        };
        
        Promise.all(criticalTables.map(checkTable)).then((results) => {
          db.close();
          
          const allTablesOk = results.every(result => result === true);
          if (allTablesOk) {
            console.log(`✅ Database integrity check passed (${tablesOk}/${criticalTables.length} tables)`);
            resolve({ success: true, tablesChecked: criticalTables.length });
          } else {
            console.log(`❌ Database integrity issues found`);
            resolve({ success: false, error: 'Missing critical tables' });
          }
        });
      });
    });
  }

  // Deployment-safe database update
  async deploymentUpdate() {
    try {
      console.log('🚀 Starting deployment database update...');
      
      // Create deployment backup
      await this.createBackup('deployment');
      
      // Check if database needs initialization
      const initResult = await this.initializeDatabase();
      
      if (initResult.success) {
        console.log(`✅ Deployment database update completed (source: ${initResult.source})`);
        return { success: true, source: initResult.source };
      } else {
        throw new Error(initResult.error);
      }
    } catch (error) {
      console.error('❌ Deployment database update failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Export database for external backup
  async exportDatabase() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const exportName = `wms_export_${timestamp}.db`;
      const exportPath = path.join(__dirname, '..', '..', exportName);
      
      if (fs.existsSync(this.dbPath)) {
        fs.copyFileSync(this.dbPath, exportPath);
        console.log(`✅ Database exported to: ${exportName}`);
        return { success: true, exportPath, exportName };
      } else {
        throw new Error('Database file not found');
      }
    } catch (error) {
      console.error('❌ Database export failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Utility functions
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getFileAge(date) {
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) return `${days} days ago`;
    if (hours > 0) return `${hours} hours ago`;
    return 'Recently';
  }
}

module.exports = DatabaseManager;