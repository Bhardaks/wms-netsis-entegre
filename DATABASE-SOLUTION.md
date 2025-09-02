# 🗄️ Database Persistence Solution

## ❌ Problem
GitHub'a her code update ettiğinizde SQLite database sıfırlanıyor ve tüm veriler kayboluyor.

## ✅ Solution
Kapsamlı database yönetim sistemi eklendi. Artık:
- Database veriler korunuyor
- Otomatik backup sistemi çalışıyor
- Deployment güvenli hale geldi

## 🔧 How It Works

### 1. Database Manager (`backend/db/database-manager.js`)
**Özellikler:**
- ✅ Otomatik backup oluşturma
- ✅ Backup'tan restore etme  
- ✅ Database integrity kontrolü
- ✅ Eski backup'ları temizleme
- ✅ Database export/import

### 2. Deployment Setup (`deployment-db-setup.js`)
**Her deployment'ta:**
1. Mevcut database durumunu kontrol eder
2. Database yoksa en son backup'tan restore eder
3. Hiç backup yoksa seed'den initialize eder
4. Database integrity kontrolü yapar
5. Yeni deployment backup'ı oluşturur

### 3. Package.json Scripts
Yeni komutlar eklendi:

```bash
# Manual backup oluştur
npm run db:backup

# Backup'ları listele
npm run db:list

# Backup'tan restore et
npm run db:restore backup_name.db

# Database'i export et
npm run db:export

# Database setup çalıştır
npm run db:setup
```

## 🚀 Deployment Strategy

### Before (Problem)
```bash
git push origin main
# 💥 Database sıfırlanır, veriler kaybolur
```

### After (Solution)  
```bash
git push origin main
# ✅ Deployment-db-setup.js çalışır
# ✅ Database korunur veya backup'tan restore edilir
# ✅ Veriler güvende
```

## 📋 Usage Instructions

### Development'ta Backup Alma
```bash
npm run db:backup
# Output: ✅ Database backup created: wms_backup_2025-01-02T10-30-00-000Z_manual.db
```

### Production'da Backup Listesi
```bash
npm run db:list
# wms_backup_2025-01-02T10-30-00-000Z_manual.db - 2 hours ago
# wms_backup_2025-01-02T08-15-22-123Z_deployment.db - 4 hours ago
```

### Critical Backup Restore
```bash
npm run db:restore wms_backup_2025-01-02T10-30-00-000Z_manual.db
# ✅ Database restored from: wms_backup_2025-01-02T10-30-00-000Z_manual.db
```

### Database Export (External Backup)
```bash
npm run db:export
# ✅ Database exported to: wms_export_2025-01-02T12-45-33-456Z.db
```

## 🔐 Security & Best Practices

### .gitignore Updates
Database files are properly excluded:
```gitignore
# Database files - kept out of version control
backend/db/wms.db
backend/db/wms.db-shm  
backend/db/wms.db-wal

# Database backups - handled separately
backend/db/backups/

# Database exports
wms_export_*.db
```

### Backup Retention Policy
- **Manual backups**: Keep last 10
- **Deployment backups**: Keep last 10
- **Pre-restore backups**: Keep last 10
- Auto cleanup runs during backup creation

### Production Safety
- Database integrity check before deployment
- Automatic backup before any destructive operation
- Restore from most recent backup if database missing
- Fallback to seed data if no backups available

## 🎯 Key Benefits

1. **Zero Data Loss**: Database veriler korunur
2. **Automated Recovery**: Otomatik restore sistem
3. **Manual Control**: Manual backup/restore komutları
4. **Production Ready**: Railway/production uyumlu
5. **Integrity Checks**: Database bütünlük kontrolü
6. **Clean Backups**: Eski backup'lar otomatik temizlenir

## 🚨 Important Notes

1. **First Deploy**: İlk deployment'tan sonra database setup tamamlanacak
2. **Manual Backups**: Kritik değişikliklerden önce manuel backup alın
3. **Regular Exports**: Periyodik olarak database export edin
4. **Monitor Logs**: Deployment loglarını kontrol edin

## 🔄 Rollback Strategy

Eğer yeni deployment'ta sorun olursa:

```bash
# 1. Son çalışan backup'ı bul
npm run db:list

# 2. O backup'tan restore et
npm run db:restore wms_backup_2025-01-02T08-00-00-000Z_deployment.db

# 3. Serveri restart et
npm start
```

## ✅ Testing

Test deployment setup:
```bash
# Local test
npm run db:setup

# Production test
NODE_ENV=production npm run db:setup
```

---

**🎉 Problem Solved!** Artık GitHub'a her push ettiğinizde database verileri korunacak.