const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

class DatabaseBackup {
    constructor(dbPath = './backend/db/wms.db') {
        this.dbPath = dbPath;
        this.backupDir = './backend/db/backups';
        
        // Backup klasörünü oluştur
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }

    // Veritabanını SQL export formatında yedekle
    async createBackup() {
        return new Promise((resolve, reject) => {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFilename = `wms_backup_${timestamp}.sql`;
            const backupPath = path.join(this.backupDir, backupFilename);
            
            const db = new sqlite3.Database(this.dbPath);
            let sqlContent = '';
            
            // Tabloları ve verilerini al
            db.serialize(() => {
                db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    let processed = 0;
                    const totalTables = tables.length;
                    
                    if (totalTables === 0) {
                        fs.writeFileSync(backupPath, '-- No tables found');
                        resolve(backupPath);
                        return;
                    }
                    
                    tables.forEach((table) => {
                        const tableName = table.name;
                        
                        // Tablo yapısını al
                        db.get(`SELECT sql FROM sqlite_master WHERE name='${tableName}'`, (err, schema) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            
                            sqlContent += `-- Table: ${tableName}\n`;
                            sqlContent += `${schema.sql};\n\n`;
                            
                            // Tablo verilerini al
                            db.all(`SELECT * FROM ${tableName}`, (err, rows) => {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                                
                                if (rows.length > 0) {
                                    // Kolon adlarını al
                                    const columns = Object.keys(rows[0]);
                                    sqlContent += `-- Data for ${tableName}\n`;
                                    
                                    rows.forEach(row => {
                                        const values = columns.map(col => {
                                            const value = row[col];
                                            if (value === null) return 'NULL';
                                            if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
                                            return value;
                                        });
                                        
                                        sqlContent += `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${values.join(', ')});\n`;
                                    });
                                    sqlContent += '\n';
                                }
                                
                                processed++;
                                if (processed === totalTables) {
                                    fs.writeFileSync(backupPath, sqlContent);
                                    db.close();
                                    resolve(backupPath);
                                }
                            });
                        });
                    });
                });
            });
        });
    }

    // Binary dosya kopyası yedekleme (daha hızlı)
    createBinaryBackup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFilename = `wms_backup_${timestamp}.db`;
        const backupPath = path.join(this.backupDir, backupFilename);
        
        if (fs.existsSync(this.dbPath)) {
            fs.copyFileSync(this.dbPath, backupPath);
            return backupPath;
        } else {
            throw new Error('Database file not found');
        }
    }

    // Otomatik yedekleme (uygulama başlangıcında çalışır)
    async autoBackup() {
        try {
            console.log('📦 Creating automatic database backup...');
            const backupPath = this.createBinaryBackup();
            console.log(`✅ Database backup created: ${backupPath}`);
            
            // Eski yedekleri temizle (30 günden eski)
            this.cleanOldBackups(30);
            
            return backupPath;
        } catch (error) {
            console.error('❌ Failed to create backup:', error.message);
            throw error;
        }
    }

    // Eski yedekleri temizle
    cleanOldBackups(daysToKeep = 30) {
        try {
            const files = fs.readdirSync(this.backupDir);
            const now = new Date();
            const cutoffTime = now.getTime() - (daysToKeep * 24 * 60 * 60 * 1000);
            
            let deletedCount = 0;
            files.forEach(file => {
                const filePath = path.join(this.backupDir, file);
                const stats = fs.statSync(filePath);
                
                if (stats.mtime.getTime() < cutoffTime) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            });
            
            if (deletedCount > 0) {
                console.log(`🧹 Cleaned up ${deletedCount} old backup files`);
            }
        } catch (error) {
            console.error('⚠️ Error cleaning old backups:', error.message);
        }
    }

    // Yedekleme listesi
    listBackups() {
        try {
            const files = fs.readdirSync(this.backupDir);
            return files
                .filter(file => file.includes('wms_backup_'))
                .map(file => {
                    const filePath = path.join(this.backupDir, file);
                    const stats = fs.statSync(filePath);
                    return {
                        filename: file,
                        path: filePath,
                        size: stats.size,
                        created: stats.mtime
                    };
                })
                .sort((a, b) => b.created - a.created);
        } catch (error) {
            console.error('Error listing backups:', error.message);
            return [];
        }
    }

    // Yedekten geri yükleme
    async restoreFromBackup(backupPath) {
        try {
            if (!fs.existsSync(backupPath)) {
                throw new Error('Backup file not found');
            }
            
            console.log(`🔄 Restoring database from: ${backupPath}`);
            
            // Mevcut DB'yi yedekle
            const emergencyBackup = this.createBinaryBackup();
            console.log(`💾 Emergency backup created: ${emergencyBackup}`);
            
            // Yedekten geri yükle
            fs.copyFileSync(backupPath, this.dbPath);
            console.log('✅ Database restored successfully');
            
            return true;
        } catch (error) {
            console.error('❌ Failed to restore backup:', error.message);
            throw error;
        }
    }
}

module.exports = DatabaseBackup;