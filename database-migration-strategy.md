# Database Migration Strategy - WMS System

## Problem
- Her deployment'ta sistem sıfırlanıyor
- SQLite in-memory database restart'ta veri kaybı
- Schema uyumsuzlukları

## Çözüm Önerileri

### 1. PostgreSQL Migration (ÖNERİLEN)
```bash
# Railway Dashboard'da PostgreSQL service ekle
# Connection string al: postgresql://user:pass@host:port/db
```

### 2. SQLite Persistent Storage Fix
```javascript
// Railway'de de file-based SQLite kullan
if (isRailway) {
  const DB_PATH = process.env.DATABASE_PATH || '/app/data/wms.db';
  db = new sqlite3.Database(DB_PATH);
} else {
  // local kod
}
```

### 3. Database Version Control
```sql
CREATE TABLE IF NOT EXISTS schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  description TEXT
);
```

### 4. Graceful Migration System
- Startup'da version check
- Auto-migration sadece gerektiğinde
- Backup before migration
- Rollback capability

## Implementation Steps
1. PostgreSQL setup
2. Migration scripts
3. Environment variables
4. Testing strategy

## Benefits
- Zero downtime deployments
- Data persistence
- Version control
- Production stability