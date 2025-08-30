require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const PDFDocument = require('pdfkit');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { netsisAPI } = require('./services/netsis');

const app = express();
const PORT = process.env.PORT || 5000;

// Railway deployment check
const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
console.log(`🚂 Railway Environment: ${isRailway ? 'YES' : 'NO'}`);

// Database configuration for Railway
let db;
let dbBackup;

if (isRailway) {
  // Railway: Use in-memory database
  console.log('🚂 Railway: Using in-memory database');
  db = new sqlite3.Database(':memory:');
} else {
  // Local: Use file-based database with backup
  const DatabaseBackup = require('./db/backup');
  dbBackup = new DatabaseBackup();
  
  const DB_PATH = path.join(__dirname, 'db', 'wms.db');
  db = new sqlite3.Database(DB_PATH);
}

// Create automatic backup on startup (only for local)
if (dbBackup) {
  dbBackup.autoBackup().catch(err => {
    console.warn('⚠️ Could not create startup backup:', err.message);
  });
}

// Debug middleware - Log all requests with error handling
app.use((req, res, next) => {
  console.log(`📝 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  
  // Railway 502 error prevention - Add timeout handling
  req.setTimeout(60000, () => {
    console.error(`🚨 Request timeout: ${req.method} ${req.path}`);
    if (!res.headersSent) {
      res.status(502).json({ 
        error: 'Request timeout', 
        message: 'Railway request timeout - try again',
        timestamp: new Date().toISOString()
      });
    }
  });
  
  next();
});

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '50mb' })); // JSON body limit'i artırdık
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'wms-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // HTTP için false, HTTPS için true olmalı
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 saat
  }
}));

// Helpers
function run(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err); else resolve(this);
    });
  });
}
function all(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err); else resolve(rows);
    });
  });
}
function get(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
}

// ---- Database Init ----
async function initDatabase() {
  try {
    console.log(`🚂 Initializing database (Railway: ${isRailway ? 'YES' : 'NO'})`);
    
    // Users tablosu oluştur
    await run(`
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
      )
    `);

    // Default admin kullanıcısı oluştur
    const existingAdmin = await get('SELECT id FROM users WHERE username = ?', ['admin']);
    if (!existingAdmin) {
      const adminPasswordHash = await bcrypt.hash('18095', 10);
      await run(`
        INSERT INTO users (username, password_hash, role, full_name, email)
        VALUES (?, ?, ?, ?, ?)
      `, ['admin', adminPasswordHash, 'admin', 'Sistem Yöneticisi', 'admin@wms.com']);
    }


    console.log('✅ Users table initialized');

    // Role permissions tablosu oluştur
    await run(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        permission TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(role, permission)
      )
    `);

    // Default permission'ları ekle - detaylı hiyerarşik yapı
    const defaultPermissions = [
      { 
        role: 'admin', 
        permissions: [
          // Ürün Yönetimi - Tüm yetkiler
          'products.view', 'products.create', 'products.edit', 'products.delete', 'products.stock', 'products.sync',
          // Sipariş Yönetimi - Tüm yetkiler
          'orders.view', 'orders.create', 'orders.edit', 'orders.status', 'orders.fulfill', 'orders.cancel',
          // Raf Yönetimi - Tüm yetkiler
          'shelf.view', 'shelf.scan', 'shelf.assign', 'shelf.transfer', 'shelf.count', 'shelf.admin',
          // Servis - Tüm yetkiler
          'service.request', 'service.dashboard', 'service.process', 'service.inventory', 'service.transfer', 'service.complete',
          // Sistem - Tüm yetkiler
          'system.users', 'system.roles', 'system.settings', 'system.backup', 'system.logs', 'system.maintenance',
          // Raporlar - Tüm yetkiler
          'reports.sales', 'reports.inventory', 'reports.performance', 'reports.export', 'reports.custom',
          // Geriye uyumluluk için ana kategoriler
          'products', 'orders', 'shelf', 'service', 'system', 'reports'
        ] 
      },
      { 
        role: 'operator', 
        permissions: [
          // Ürün - Görüntüleme ve stok yönetimi (edit ve create false)
          'products.view', 'products.stock',
          // Sipariş - Görüntüleme ve tamamlama
          'orders.view', 'orders.status', 'orders.fulfill',
          // Raf - Tüm operasyonel yetkiler  
          'shelf.view', 'shelf.scan', 'shelf.assign', 'shelf.transfer', 'shelf.count',
          // Servis - Sadece temel işlemler
          'service.requests', 'service.dashboard',
          // Sistem - Hiçbir sistem izni yok
          // Raporlar - Sadece görüntüleme
          'reports.inventory',
          // Geriye uyumluluk - ana kategoriler
          'products', 'orders', 'shelf'
        ] 
      },
      { 
        role: 'service', 
        permissions: [
          // Sadece servis modülü
          'service.request', 'service.dashboard', 'service.process', 'service.inventory', 'service.transfer', 'service.complete',
          // Geriye uyumluluk
          'service'
        ] 
      }
    ];

    for (const roleConfig of defaultPermissions) {
      for (const permission of roleConfig.permissions) {
        try {
          await run(`
            INSERT OR IGNORE INTO role_permissions (role, permission, enabled)
            VALUES (?, ?, 1)
          `, [roleConfig.role, permission]);
        } catch (e) {
          // Permission already exists, skip
        }
      }
    }

    console.log('✅ Role permissions table initialized');

    // Netsis Orders tablosu oluştur
    await run(`
      CREATE TABLE IF NOT EXISTS netsis_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sube_kodu INTEGER NOT NULL,
        ftirsip INTEGER NOT NULL,
        siparis_no TEXT NOT NULL,
        cari_kodu TEXT,
        siparis_tarihi DATE,
        toplam_tutar DECIMAL(18,2),
        kdv_tutar DECIMAL(18,2),
        kdv_dahil_mi BOOLEAN,
        kayit_tarihi DATETIME,
        sync_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP,
        sync_status TEXT DEFAULT 'synced',
        wms_order_id INTEGER,
        UNIQUE(sube_kodu, ftirsip, siparis_no)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS netsis_order_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        netsis_order_id INTEGER NOT NULL REFERENCES netsis_orders(id),
        sube_kodu INTEGER NOT NULL,
        ftirsip INTEGER NOT NULL,
        siparis_no TEXT NOT NULL,
        stok_kodu TEXT,
        aciklama TEXT,
        miktar DECIMAL(18,3),
        birim TEXT,
        birim_fiyat DECIMAL(18,4),
        kdv_orani DECIMAL(5,2),
        depo_kodu TEXT,
        satir_sira INTEGER
      )
    `);

    console.log('✅ Netsis tables initialized');

  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  } else {
    return res.status(401).json({ 
      success: false, 
      message: 'Giriş yapmanız gerekiyor',
      redirectTo: '/login.html'
    });
  }
}

// Role-based access control
function requireRole(allowedRoles) {
  return (req, res, next) => {
    console.log('requireRole middleware called with allowedRoles:', allowedRoles);
    
    if (!req.session || !req.session.user) {
      console.log('No session or user found');
      return res.status(401).json({ 
        success: false, 
        message: 'Giriş yapmanız gerekiyor',
        redirectTo: '/login.html'
      });
    }

    console.log('User role:', req.session.user.role, 'Allowed roles:', allowedRoles);
    
    if (!allowedRoles.includes(req.session.user.role)) {
      console.log('User role not in allowed roles');
      return res.status(403).json({ 
        success: false, 
        message: 'Bu işlem için yetkiniz yok'
      });
    }

    console.log('Role check passed');
    return next();
  };
}

// ---- Authentication API ----
// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Kullanıcı adı ve şifre gerekli'
      });
    }

    // Kullanıcıyı bul
    const user = await get('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Geçersiz kullanıcı adı veya şifre'
      });
    }

    // Şifre kontrolü
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Geçersiz kullanıcı adı veya şifre'
      });
    }

    // Son giriş zamanını güncelle
    await run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

    // Session'a kullanıcı bilgilerini kaydet
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      full_name: user.full_name,
      email: user.email
    };

    res.json({
      success: true,
      message: 'Giriş başarılı',
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        full_name: user.full_name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Sunucu hatası'
    });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('❌ Logout error:', err);
      return res.status(500).json({
        success: false,
        message: 'Çıkış hatası'
      });
    }
    res.json({
      success: true,
      message: 'Çıkış başarılı'
    });
  });
});

// Check authentication status
app.get('/api/auth/check', (req, res) => {
  if (req.session && req.session.user) {
    res.json({
      authenticated: true,
      user: req.session.user
    });
  } else {
    res.json({
      authenticated: false
    });
  }
});

// Get current user info
app.get('/api/auth/user', requireAuth, (req, res) => {
  res.json({
    success: true,
    user: req.session.user
  });
});

// User management (admin only)
app.get('/api/users', requireRole(['admin']), async (req, res) => {
  try {
    const users = await all(`
      SELECT id, username, role, full_name, email, active, created_at, last_login
      FROM users
      ORDER BY created_at DESC
    `);
    res.json(users);
  } catch (error) {
    console.error('❌ Users fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create user (admin only)
app.post('/api/users', requireRole(['admin']), async (req, res) => {
  try {
    const { username, password, role, full_name, email } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Kullanıcı adı, şifre ve rol gerekli'
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await run(`
      INSERT INTO users (username, password_hash, role, full_name, email)
      VALUES (?, ?, ?, ?, ?)
    `, [username, passwordHash, role, full_name || null, email || null]);

    res.json({
      success: true,
      message: 'Kullanıcı oluşturuldu'
    });
  } catch (error) {
    console.error('❌ User creation error:', error);
    if (error.code === 'SQLITE_CONSTRAINT') {
      res.status(400).json({
        success: false,
        message: 'Bu kullanıcı adı zaten mevcut'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Kullanıcı oluşturma hatası'
      });
    }
  }
});

// ---- Role Permissions API ----
// Get all permissions for all roles
app.get('/api/role-permissions', requireRole(['admin']), async (req, res) => {
  try {
    const permissions = await all(`
      SELECT role, permission, enabled 
      FROM role_permissions 
      ORDER BY role, permission
    `);
    
    // Group by role
    const rolePermissions = {};
    permissions.forEach(perm => {
      if (!rolePermissions[perm.role]) {
        rolePermissions[perm.role] = {};
      }
      rolePermissions[perm.role][perm.permission] = !!perm.enabled;
    });
    
    res.json({
      success: true,
      permissions: rolePermissions
    });
  } catch (error) {
    console.error('❌ Role permissions fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get permissions for a specific role
app.get('/api/role-permissions/:role', requireAuth, async (req, res) => {
  try {
    const { role } = req.params;
    
    // Users can only see their own role permissions unless they are admin
    if (req.session.user.role !== 'admin' && req.session.user.role !== role) {
      return res.status(403).json({
        success: false,
        message: 'Bu rol izinlerini görme yetkiniz yok'
      });
    }
    
    const permissions = await all(`
      SELECT permission, enabled 
      FROM role_permissions 
      WHERE role = ?
      ORDER BY permission
    `, [role]);
    
    const rolePermissions = {};
    permissions.forEach(perm => {
      rolePermissions[perm.permission] = !!perm.enabled;
    });
    
    res.json({
      success: true,
      role,
      permissions: rolePermissions
    });
  } catch (error) {
    console.error('❌ Role permissions fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update role permissions
app.post('/api/role-permissions/:role', requireRole(['admin']), async (req, res) => {
  try {
    const { role } = req.params;
    const { permissions } = req.body;
    
    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz izin verisi'
      });
    }
    
    // Update each permission
    for (const [permission, enabled] of Object.entries(permissions)) {
      await run(`
        INSERT OR REPLACE INTO role_permissions (role, permission, enabled)
        VALUES (?, ?, ?)
      `, [role, permission, enabled ? 1 : 0]);
    }
    
    res.json({
      success: true,
      message: `${role} rolü izinleri güncellendi`,
      updatedCount: Object.keys(permissions).length
    });
  } catch (error) {
    console.error('❌ Role permissions update error:', error);
    res.status(500).json({
      success: false,
      message: 'İzinler güncellenirken hata oluştu'
    });
  }
});

// Add new permission to a role
app.post('/api/role-permissions/:role/add', requireRole(['admin']), async (req, res) => {
  try {
    const { role } = req.params;
    const { permission } = req.body;
    
    if (!permission) {
      return res.status(400).json({
        success: false,
        message: 'İzin adı gerekli'
      });
    }
    
    await run(`
      INSERT OR IGNORE INTO role_permissions (role, permission, enabled)
      VALUES (?, ?, 1)
    `, [role, permission]);
    
    res.json({
      success: true,
      message: `${permission} izni ${role} rolüne eklendi`
    });
  } catch (error) {
    console.error('❌ Add permission error:', error);
    res.status(500).json({
      success: false,
      message: 'İzin eklenirken hata oluştu'
    });
  }
});

// Get available permission types with hierarchical structure
app.get('/api/permission-types', requireRole(['admin']), (req, res) => {
  const permissionCategories = [
    {
      key: 'products',
      name: 'Ürün Yönetimi',
      description: 'Ürün kayıt, güncelleme ve stok operasyonları',
      icon: '📦',
      subPermissions: [
        { key: 'products.view', name: 'Ürün Görüntüleme', description: 'Ürün listesi ve detaylarını görüntüleme' },
        { key: 'products.create', name: 'Ürün Ekleme', description: 'Yeni ürün kayıt etme' },
        { key: 'products.edit', name: 'Ürün Düzenleme', description: 'Mevcut ürün bilgilerini güncelleme' },
        { key: 'products.delete', name: 'Ürün Silme', description: 'Ürün kayıtlarını silme' },
        { key: 'products.stock', name: 'Stok Yönetimi', description: 'Stok seviyelerini görüntüleme ve güncelleme' },
        { key: 'products.sync', name: 'Senkronizasyon', description: 'Wix ile ürün senkronizasyonu' }
      ]
    },
    {
      key: 'orders',
      name: 'Sipariş Yönetimi', 
      description: 'Sipariş işleme ve durum takibi',
      icon: '📋',
      subPermissions: [
        { key: 'orders.view', name: 'Sipariş Görüntüleme', description: 'Sipariş listesi ve detaylarını görme' },
        { key: 'orders.create', name: 'Sipariş Oluşturma', description: 'Yeni sipariş kaydı oluşturma' },
        { key: 'orders.edit', name: 'Sipariş Düzenleme', description: 'Sipariş bilgilerini güncelleme' },
        { key: 'orders.status', name: 'Durum Güncelleme', description: 'Sipariş durumunu değiştirme' },
        { key: 'orders.fulfill', name: 'Sipariş Tamamlama', description: 'Sipariş hazırlama ve gönderim' },
        { key: 'orders.cancel', name: 'Sipariş İptali', description: 'Sipariş iptal etme yetkisi' }
      ]
    },
    {
      key: 'shelf',
      name: 'Raf Yönetimi',
      description: 'Raf operasyonları, stok sayım ve transferler',
      icon: '🏬',
      subPermissions: [
        { key: 'shelf.view', name: 'Raf Görüntüleme', description: 'Raf durumları ve konumları görme' },
        { key: 'shelf.scan', name: 'Barkod Okuma', description: 'Raf barkod tarama işlemleri' },
        { key: 'shelf.assign', name: 'Raf Atama', description: 'Ürünleri rafla eşleştirme' },
        { key: 'shelf.transfer', name: 'Raf Transferi', description: 'Raflar arası stok aktarımı' },
        { key: 'shelf.count', name: 'Stok Sayımı', description: 'Envanter sayım işlemleri' },
        { key: 'shelf.admin', name: 'Raf Yönetimi', description: 'Raf oluşturma, düzenleme, silme' }
      ]
    },
    {
      key: 'service',
      name: 'SSH Servis Hub',
      description: 'Servis talepleri ve SSH envanter yönetimi',
      icon: '🔧',
      subPermissions: [
        { key: 'service.requests', name: 'Servis Talebi', description: 'Yeni servis talebi oluşturma ve görüntüleme' },
        { key: 'service.create', name: 'Servis Oluşturma', description: 'Yeni servis kaydı oluşturma' },
        { key: 'service.dashboard', name: 'Servis Dashboard', description: 'Servis durumları ve istatistikler' },
        { key: 'service.view', name: 'Servis Görüntüleme', description: 'Servis detaylarını görüntüleme' },
        { key: 'service.process', name: 'Paket İşleme', description: 'Paket açma ve işlem yapma' },
        { key: 'service.ssh_inventory', name: 'SSH Envanter', description: 'SSH alan stok yönetimi' },
        { key: 'service.inventory', name: 'Envanter Yönetimi', description: 'Genel envanter işlemleri' },
        { key: 'service.transfer', name: 'SSH Transfer', description: 'SSH stok transferi işlemleri' },
        { key: 'service.complete', name: 'Servis Tamamlama', description: 'Servis işlemlerini sonuçlandırma' }
      ]
    },
    {
      key: 'system',
      name: 'Sistem Yönetimi',
      description: 'Admin panel ve sistem ayarları',
      icon: '⚙️',
      subPermissions: [
        { key: 'system.users', name: 'Kullanıcı Yönetimi', description: 'Kullanıcı ekleme, düzenleme, silme' },
        { key: 'system.roles', name: 'Rol İzinleri', description: 'Rol izinlerini düzenleme' },
        { key: 'system.settings', name: 'Sistem Ayarları', description: 'Genel sistem konfigürasyonu' },
        { key: 'system.backup', name: 'Yedekleme', description: 'Sistem yedekleme ve geri yükleme' },
        { key: 'system.logs', name: 'Log Görüntüleme', description: 'Sistem loglarını inceleme' },
        { key: 'system.maintenance', name: 'Bakım Modu', description: 'Sistem bakım işlemleri' }
      ]
    },
    {
      key: 'reports',
      name: 'Raporlar',
      description: 'İstatistikler ve analiz raporları',
      icon: '📊',
      subPermissions: [
        { key: 'reports.sales', name: 'Satış Raporları', description: 'Satış analizi ve istatistikler' },
        { key: 'reports.inventory', name: 'Envanter Raporları', description: 'Stok durum raporları' },
        { key: 'reports.performance', name: 'Performans Raporları', description: 'Sistem performans metrikleri' },
        { key: 'reports.export', name: 'Rapor Dışa Aktarma', description: 'Excel/PDF rapor indirme' },
        { key: 'reports.custom', name: 'Özel Raporlar', description: 'Kişiselleştirilmiş rapor oluşturma' }
      ]
    }
  ];
  
  // Backward compatibility için eski permissionTypes formatını da ekle
  const permissionTypes = [];
  permissionCategories.forEach(category => {
    // Ana kategoriyi ekle
    permissionTypes.push({
      key: category.key,
      name: category.name,
      description: category.description
    });
    
    // Alt izinleri de ekle
    category.subPermissions.forEach(subPerm => {
      permissionTypes.push(subPerm);
    });
  });
  
  res.json({
    success: true,
    permissionCategories, // Yeni hiyerarşik yapı
    permissionTypes       // Geriye uyumluluk
  });
});

// ---- ERP Integration ----
const wix = require('./services/wix');
const netsis = require('./services/netsis');
const { syncNetsisProducts } = require('./services/netsis-products');
const { syncNetsisStockCards, syncNetsisStockCardsByWarehouse } = require('./services/netsis-stockcards');

// Pull products from Netsis ERP into local DB
app.post('/api/sync/netsis/products', async (req, res) => {
  try {
    const result = await syncNetsisProducts();
    res.json(result);
  } catch (e) {
    console.error('Netsis sync products error:', {
      message: e.message,
      stack: e.stack,
      config: e.config ? {
        url: e.config.url,
        method: e.config.method,
        headers: e.config.headers
      } : null
    });
    res.status(500).json({ 
      error: e.response?.data || e.message,
      details: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});

// Pull stock cards from Netsis ERP into local DB
app.post('/api/sync/netsis/stockcards', async (req, res) => {
  try {
    const result = await syncNetsisStockCards();
    res.json(result);
  } catch (e) {
    console.error('Netsis sync stock cards error:', {
      message: e.message,
      stack: e.stack
    });
    res.status(500).json({ 
      error: e.response?.data || e.message,
      details: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});

// Netsis connection test endpoint
app.post('/api/netsis/test-connection', async (req, res) => {
  try {
    const result = await netsis.netsisAPI.testConnection();
    res.json(result);
  } catch (e) {
    res.status(500).json({ 
      success: false,
      error: e.message,
      details: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});

// Update Netsis configuration (admin only)
app.post('/api/netsis/config', requireAuth, async (req, res) => {
  try {
    if (req.session.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { url, username, password, dbName, dbUser } = req.body;
    
    // Validate inputs
    if (!url || !username || !dbName) {
      return res.status(400).json({ error: 'URL, kullanıcı adı ve veritabanı adı gerekli' });
    }

    // Update environment variables (this is for runtime, not persistent)
    process.env.NETSIS_API_URL = url;
    process.env.NETSIS_USERNAME = username;
    if (password) process.env.NETSIS_PASSWORD = password;
    process.env.NETSIS_DB_NAME = dbName;
    if (dbUser) process.env.NETSIS_DB_USER = dbUser;

    // Reset connection to use new config
    netsis.netsisAPI.accessToken = null;
    netsis.netsisAPI.tokenExpiry = null;

    // Update config in the API instance
    netsis.netsisAPI.baseURL = url;
    netsis.netsisAPI.username = username;
    if (password) netsis.netsisAPI.password = password;
    netsis.netsisAPI.dbName = dbName;
    if (dbUser) netsis.netsisAPI.dbUser = dbUser;

    res.json({ 
      success: true, 
      message: 'Netsis konfigürasyonu güncellendi',
      config: { url, username, dbName }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get current Netsis configuration
app.get('/api/netsis/config', requireAuth, async (req, res) => {
  try {
    if (req.session.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    res.json({
      url: process.env.NETSIS_API_URL || 'http://localhost:7070',
      username: process.env.NETSIS_USERNAME || '',
      dbName: process.env.NETSIS_DB_NAME || '',
      dbUser: process.env.NETSIS_DB_USER || '',
      // Don't send password for security
      hasPassword: !!(process.env.NETSIS_PASSWORD)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Pull stock cards from specific warehouse
app.post('/api/sync/netsis/stockcards/:warehouse', async (req, res) => {
  try {
    const warehouseCode = req.params.warehouse;
    const result = await syncNetsisStockCardsByWarehouse(warehouseCode);
    res.json(result);
  } catch (e) {
    console.error('Netsis sync warehouse stock cards error:', {
      message: e.message,
      stack: e.stack
    });
    res.status(500).json({ 
      error: e.response?.data || e.message,
      details: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});

// Pull orders from Wix into local DB – SKU/ID matching fixed
app.post('/api/sync/wix/orders', async (req, res) => {
  try {
    let total = 0;
    const uniqueOrderNumbers = new Set();
    for await (const o of wix.iterateOrders()) {
      const orderNumber = o.number || o.id;
      uniqueOrderNumbers.add(orderNumber);
      
      
      // Müşteri adını farklı alanlardan bulmaya çalış
      let customerName = '';
      
      // 1. buyerInfo'dan firstName + lastName kombinasyonu (en güvenilir - Wix'te bu daha direkt)
      const buyerFirst = o.buyerInfo?.firstName || '';
      const buyerLast = o.buyerInfo?.lastName || '';
      if (buyerFirst || buyerLast) {
        customerName = (buyerFirst + ' ' + buyerLast).trim();
      }
      
      // 2. billingInfo.address.fullName'den (yeni yapı)
      if (!customerName) {
        const billingFirst = o.billingInfo?.address?.fullName?.firstName || '';
        const billingLast = o.billingInfo?.address?.fullName?.lastName || '';
        if (billingFirst || billingLast) {
          customerName = (billingFirst + ' ' + billingLast).trim();
        }
      }
      
      // 3. shippingInfo.shipmentDetails.address.fullName'den (yeni yapı)
      if (!customerName) {
        const shippingFirst = o.shippingInfo?.shipmentDetails?.address?.fullName?.firstName || '';
        const shippingLast = o.shippingInfo?.shipmentDetails?.address?.fullName?.lastName || '';
        if (shippingFirst || shippingLast) {
          customerName = (shippingFirst + ' ' + shippingLast).trim();
        }
      }
      
      // 4. Eski yapı - billingInfo.contactDetails (legacy support)
      if (!customerName) {
        const billingFirst = o.billingInfo?.contactDetails?.firstName || '';
        const billingLast = o.billingInfo?.contactDetails?.lastName || '';
        if (billingFirst || billingLast) {
          customerName = (billingFirst + ' ' + billingLast).trim();
        }
      }
      
      // 5. Eski yapı - shippingInfo.logistics (legacy support)
      if (!customerName) {
        const shippingFirst = o.shippingInfo?.logistics?.shippingDestination?.contactDetails?.firstName || '';
        const shippingLast = o.shippingInfo?.logistics?.shippingDestination?.contactDetails?.lastName || '';
        if (shippingFirst || shippingLast) {
          customerName = (shippingFirst + ' ' + shippingLast).trim();
        }
      }
      
      // 6. Şirket adını kontrol et (yeni ve eski yapılar)
      if (!customerName) {
        customerName = o.billingInfo?.address?.company || 
                      o.shippingInfo?.shipmentDetails?.address?.company ||
                      o.billingInfo?.contactDetails?.company || 
                      o.shippingInfo?.logistics?.shippingDestination?.contactDetails?.company ||
                      o.recipientInfo?.contactDetails?.company ||
                      '';
      }
      
      // 7. buyerInfo contactDetails (legacy) - fallback
      if (!customerName) {
        const buyerFirst = o.buyerInfo?.contactDetails?.firstName || '';
        const buyerLast = o.buyerInfo?.contactDetails?.lastName || '';
        if (buyerFirst || buyerLast) {
          customerName = (buyerFirst + ' ' + buyerLast).trim();
        }
      }
      
      // 8. Son çare olarak contactId veya email kullan
      if (!customerName) {
        customerName = o.buyerInfo?.contactId || o.buyerInfo?.email || 'Unknown Customer';
      }
      
      
      // Status mapping - eCommerce API vs Stores API farklı field'lar kullanır
      let status = 'open'; // varsayılan
      
      // eCommerce API'de status field'ı var, Stores API'de yok
      if (o.status) {
        // eCommerce API - status field'ını kullan
        const wixStatus = (o.status || '').toUpperCase();
        
        switch(wixStatus) {
          case 'APPROVED':
            status = 'open'; // Onaylanmış = Açık sipariş
            break;
          case 'CANCELED':
          case 'CANCELLED':
            status = 'cancelled';
            break;
          case 'PENDING':
            status = 'pending';
            break;
          case 'FULFILLED':
          case 'COMPLETED':
            status = 'fulfilled';
            break;
          default:
            status = wixStatus ? wixStatus.toLowerCase() : 'open';
            console.log(`⚠️ eCommerce API bilinmeyen status: "${o.status}" -> "${status}"`);
        }
      } else {
        // Stores API - fulfillmentStatus'u kullanarak status çıkar
        const fulfillmentStatus = (o.fulfillmentStatus || '').toUpperCase();
        
        switch(fulfillmentStatus) {
          case 'FULFILLED':
          case 'COMPLETED':
            status = 'fulfilled';
            break;
          case 'CANCELED':
          case 'CANCELLED':
            status = 'cancelled';
            break;
          case 'NOT_FULFILLED':
          case 'PARTIALLY_FULFILLED':
            status = 'open'; // Karşılanmamış veya kısmen karşılanmış = açık sipariş
            break;
          default:
            status = 'open'; // varsayılan
            if (fulfillmentStatus && fulfillmentStatus !== 'NOT_FULFILLED') {
              console.log(`⚠️ Stores API bilinmeyen fulfillmentStatus: "${o.fulfillmentStatus}" -> "${status}"`);
            }
        }
      }
      
      // Fulfillment status mapping
      let mappedFulfillmentStatus = null;
      const wixFulfillmentStatus = (o.fulfillmentStatus || '').toUpperCase();
      
      switch(wixFulfillmentStatus) {
        case 'FULFILLED':
        case 'COMPLETED':
          mappedFulfillmentStatus = 'FULFILLED';
          break;
        case 'NOT_FULFILLED':
        case 'PENDING':
          mappedFulfillmentStatus = 'NOT_FULFILLED';
          break;
        case 'PARTIALLY_FULFILLED':
        case 'PARTIAL':
          mappedFulfillmentStatus = 'PARTIALLY_FULFILLED';
          break;
        case 'CANCELED':
        case 'CANCELLED':
          mappedFulfillmentStatus = 'CANCELLED';
          break;
        default:
          // Eğer fulfillment status yoksa, main status'a göre ayarla
          if (status === 'fulfilled') {
            mappedFulfillmentStatus = 'FULFILLED';
          } else if (status === 'cancelled') {
            mappedFulfillmentStatus = 'CANCELLED';
          } else {
            mappedFulfillmentStatus = 'NOT_FULFILLED'; // varsayılan
          }
      }

      await run(`INSERT INTO orders (order_number, customer_name, status, fulfillment_status, wix_order_id) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(order_number) DO UPDATE SET
                   customer_name=excluded.customer_name,
                   status=excluded.status,
                   fulfillment_status=excluded.fulfillment_status,
                   wix_order_id=excluded.wix_order_id,
                   updated_at=CURRENT_TIMESTAMP`,
                [String(orderNumber), customerName, status, mappedFulfillmentStatus, o.id || o._id]);
      const ord = await get('SELECT id FROM orders WHERE order_number=?', [orderNumber]);

      const lines = o.lineItems || o.catalogLineItems || [];
      for (const li of lines) {
        const sku = wix.extractSku(li);
        const { productId: wixPid, variantId: wixVid } = wix.extractCatalogIds(li);
        // Resolve product
        let prod = null;
        if (sku) prod = await get('SELECT * FROM products WHERE sku=?', [sku]);
        if (!prod && wixPid && wixVid) prod = await get('SELECT * FROM products WHERE wix_product_id=? AND wix_variant_id=?', [wixPid, wixVid]);
        if (!prod && wixPid) prod = await get('SELECT * FROM products WHERE wix_product_id=?', [wixPid]);
        if (!prod) {
          const name = wix.s(li.productName || li.name || 'Wix Product');
          const genSku = sku || (wixPid ? `WIX-${wixPid}${wixVid?('-'+wixVid):''}` : `WIX-NO-ID-${Date.now()}`);
          await run(`INSERT OR IGNORE INTO products (sku, name, price, wix_product_id, wix_variant_id) VALUES (?,?,?,?,?)`,
                    [String(genSku), String(name), 0, wixPid || null, wixVid || null]);
          prod = await get('SELECT * FROM products WHERE sku=?', [genSku]);
        }
        const qty = parseInt(li.quantity || 1, 10);
        const pName = wix.s(li.productName || li.name || prod?.name || 'Ürün');
        const pSku = sku || prod.sku;
        const existing = await get('SELECT id FROM order_items WHERE order_id=? AND product_id=?', [ord.id, prod.id]);
        if (existing) {
          await run('UPDATE order_items SET quantity=?, sku=?, product_name=? WHERE id=?', [qty, pSku, pName, existing.id]);
        } else {
          await run('INSERT INTO order_items (order_id, product_id, sku, product_name, quantity) VALUES (?,?,?,?,?)',
                    [ord.id, prod.id, pSku, pName, qty]);
        }
      }
      total++;
    }
    console.log(`🔢 Unique orders from Wix: ${uniqueOrderNumbers.size}, Total processed: ${total}`);
    res.json({ ok: true, importedOrders: total, uniqueOrders: uniqueOrderNumbers.size });
  } catch (e) {
    console.error('Wix sync orders error:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data || e.message });
  }
});
// Pull both (products then orders)
app.post('/api/sync/wix/all', async (req, res) => {
  try {
    // Direkt olarak sync fonksiyonlarını çağır, fetch kullanma
    let productsResult, ordersResult;
    
    // Products sync
    try {
      let total = 0, versionUsed = null;
      const seen = new Set();
      for await (const { item: prod, version } of netsisAPI.iterateProducts()) {
        versionUsed = version;
        const productId = prod.id || prod._id || prod.productId || prod.product?.id;
        const baseName = (prod.name || prod.product?.name || 'Ürün').toString().trim();
        const mainSku = prod.sku || prod.product?.sku || null;
        let price = 0;
        if (prod.price?.amount) price = parseFloat(prod.price.amount);
        else if (prod.priceData?.price?.amount) price = parseFloat(prod.priceData.price.amount);
        else if (prod.priceData?.price) price = parseFloat(prod.priceData.price);
        else if (typeof prod.price === 'number') price = prod.price;
        
        let inventoryQuantity = null;
        if (prod.stock?.quantity != null) {
          inventoryQuantity = parseInt(prod.stock.quantity, 10);
        } else if (prod.inventory?.quantity != null) {
          inventoryQuantity = parseInt(prod.inventory.quantity, 10);
        }
        
        const variants = prod.variants || prod.product?.variants || [];

        if (variants && variants.length) {
          for (const v of variants) {
            let vSku = wix.extractVariantSku(v, mainSku);
            if (!vSku) {
              vSku = `${productId}:${(v.id || v.variantId || 'var')}`;
            }
            
            if (seen.has(vSku)) continue;
            seen.add(vSku);
            const fullName = (baseName || 'Ürün') + wix.variantSuffix(v);
            let vPrice = 0;
            if (v.price?.amount) vPrice = parseFloat(v.price.amount);
            else if (typeof v.price === 'number') vPrice = v.price;
            else vPrice = price;
            
            let vInventoryQuantity = null;
            if (v.stock?.quantity != null) {
              vInventoryQuantity = parseInt(v.stock.quantity, 10);
            } else if (v.inventory?.quantity != null) {
              vInventoryQuantity = parseInt(v.inventory.quantity, 10);
            } else {
              vInventoryQuantity = inventoryQuantity;
            }
            
            await run(`INSERT INTO products (sku, name, description, main_barcode, price, wix_product_id, wix_variant_id, inventory_quantity)
                       VALUES (?,?,?,?,?,?,?,?)
                       ON CONFLICT(sku) DO UPDATE SET
                         name=excluded.name,
                         price=excluded.price,
                         inventory_quantity=excluded.inventory_quantity,
                         updated_at=CURRENT_TIMESTAMP
                         -- NOT updating wix_product_id, wix_variant_id to preserve existing data`,
                      [String(vSku), String(fullName), null, null, vPrice, String(productId||''), String(v.id || v.variantId || ''), vInventoryQuantity]);
            total++;
          }
        } else {
          const sku = mainSku || (productId ? `WIX-${productId}` : `WIX-${Date.now()}`);
          if (!seen.has(sku)) {
            seen.add(sku);
            await run(`INSERT INTO products (sku, name, description, main_barcode, price, wix_product_id, wix_variant_id, inventory_quantity)
                       VALUES (?,?,?,?,?,?,?,?)
                       ON CONFLICT(sku) DO UPDATE SET
                         name=excluded.name,
                         price=excluded.price,
                         inventory_quantity=excluded.inventory_quantity,
                         updated_at=CURRENT_TIMESTAMP
                         -- NOT updating wix_product_id to preserve existing data`,
                      [String(sku), String(baseName || 'Ürün'), null, null, price, String(productId||''), null, inventoryQuantity]);
            total++;
          }
        }
      }
      productsResult = { ok: true, imported: total, versionUsed };
    } catch (e) {
      productsResult = { error: e.response?.data || e.message };
    }

    // Orders sync - basit versiyon
    try {
      let totalOrders = 0;
      const uniqueOrderNumbers = new Set();
      for await (const o of wix.iterateOrders()) {
        const orderNumber = o.number || o.id;
        uniqueOrderNumbers.add(orderNumber);
        let customerName = '';
        
        // Düzeltilmiş müşteri ismi extraction (aynı logic)
        // 1. buyerInfo'dan firstName + lastName kombinasyonu (en güvenilir)
        const buyerFirst = o.buyerInfo?.firstName || '';
        const buyerLast = o.buyerInfo?.lastName || '';
        if (buyerFirst || buyerLast) {
          customerName = (buyerFirst + ' ' + buyerLast).trim();
        }
        
        // 2. billingInfo.address.fullName'den (yeni yapı)
        if (!customerName) {
          const billingFirst = o.billingInfo?.address?.fullName?.firstName || '';
          const billingLast = o.billingInfo?.address?.fullName?.lastName || '';
          if (billingFirst || billingLast) {
            customerName = (billingFirst + ' ' + billingLast).trim();
          }
        }
        
        // 3. Legacy support
        if (!customerName) {
          const billingFirst = o.billingInfo?.contactDetails?.firstName || '';
          const billingLast = o.billingInfo?.contactDetails?.lastName || '';
          if (billingFirst || billingLast) {
            customerName = (billingFirst + ' ' + billingLast).trim();
          }
        }
        
        // 4. Şirket adı
        if (!customerName) {
          customerName = o.billingInfo?.address?.company || 
                        o.billingInfo?.contactDetails?.company ||
                        '';
        }
        
        // 5. Son çare
        if (!customerName) {
          customerName = o.buyerInfo?.contactId || o.buyerInfo?.email || 'Unknown Customer';
        }
        
        const status = (o.status || 'open').toLowerCase();
        
        await run(`INSERT INTO orders (order_number, customer_name, status)
                   VALUES (?,?,?)
                   ON CONFLICT(order_number) DO UPDATE SET
                     customer_name=excluded.customer_name,
                     status=excluded.status,
                     updated_at=CURRENT_TIMESTAMP`,
                  [String(orderNumber), String(customerName), String(status)]);
        totalOrders++;
      }
      console.log(`🔢 Unique orders from Wix (all sync): ${uniqueOrderNumbers.size}, Total processed: ${totalOrders}`);
      ordersResult = { ok: true, importedOrders: totalOrders, uniqueOrders: uniqueOrderNumbers.size };
    } catch (e) {
      ordersResult = { error: e.response?.data || e.message };
    }

    res.json({ products: productsResult, orders: ordersResult });
  } catch (e) {
    console.error('All sync error:', e);
    res.status(500).json({ error: e.message });
  }
});
// ---- Health ----
app.get('/api/health', async (req, res) => {
  try {
    const row = await get('SELECT 1 as ok', []);
    res.json({ status: 'ok', db: !!row });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Bulk Color Update ----
app.post('/api/products/bulk-color-update', async (req, res) => {
  try {
    console.log('🎨 Bulk color update başlıyor...');
    
    // SKU'ya göre renk ataması yapıyoruz
    const colorMappings = [
      // Beyaz renkler
      { pattern: '-B-', color: 'BEYAZ' },
      { pattern: '-BE-', color: 'BEYAZ' },
      { pattern: '-BEYA', color: 'BEYAZ' },
      { pattern: 'BEYAZ', color: 'BEYAZ' },
      { pattern: 'WHITE', color: 'BEYAZ' },
      
      // Siyah renkler  
      { pattern: '-S-', color: 'SİYAH' },
      { pattern: '-SI-', color: 'SİYAH' },
      { pattern: '-SIYA', color: 'SİYAH' },
      { pattern: 'SİYAH', color: 'SİYAH' },
      { pattern: 'BLACK', color: 'SİYAH' },
      
      // Kahve renkler
      { pattern: '-K-', color: 'KAHVE' },
      { pattern: '-KA-', color: 'KAHVE' },
      { pattern: '-KAHA', color: 'KAHVE' },
      { pattern: 'KAHVE', color: 'KAHVE' },
      { pattern: 'BROWN', color: 'KAHVE' },
      
      // Gri renkler
      { pattern: '-G-', color: 'GRİ' },
      { pattern: '-GR-', color: 'GRİ' },
      { pattern: 'GRİ', color: 'GRİ' },
      { pattern: 'GRAY', color: 'GRİ' },
      { pattern: 'GREY', color: 'GRİ' },
      
      // Antrasit renkler
      { pattern: '-A-', color: 'ANTRASIT' },
      { pattern: '-AN-', color: 'ANTRASIT' },
      { pattern: '-ANTA', color: 'ANTRASIT' },
      { pattern: 'ANTRASIT', color: 'ANTRASIT' },
      { pattern: 'ANTHRACITE', color: 'ANTRASIT' }
    ];
    
    let updatedCount = 0;
    
    // Tüm ürünleri al
    const products = await all('SELECT id, sku, name FROM products WHERE color IS NULL OR color = ""');
    console.log(`📦 ${products.length} ürün renk güncelleme için kontrol ediliyor...`);
    
    for (const product of products) {
      let foundColor = null;
      
      // SKU ve name'de renk arayalım
      const searchText = (product.sku + ' ' + product.name).toUpperCase();
      
      for (const mapping of colorMappings) {
        if (searchText.includes(mapping.pattern.toUpperCase())) {
          foundColor = mapping.color;
          break;
        }
      }
      
      if (foundColor) {
        await run('UPDATE products SET color = ? WHERE id = ?', [foundColor, product.id]);
        console.log(`🎨 ${product.sku}: ${foundColor} rengi atandı`);
        updatedCount++;
      }
    }
    
    console.log(`✅ ${updatedCount} ürüne renk bilgisi eklendi`);
    res.json({ success: true, updatedCount, total: products.length });
    
  } catch (error) {
    console.error('❌ Bulk color update hatası:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---- Debug Wix Orders ----
app.get('/api/debug/wix/orders', async (req, res) => {
  try {
    console.log('🔍 Wix API Status Debug başlıyor...');
    
    let count = 0;
    let statusCounts = {};
    let fulfillmentCounts = {};
    let sampleOrders = [];
    
    for await (const order of wix.iterateOrders()) {
      count++;
      
      const status = order.status;
      const fulfillmentStatus = order.fulfillmentStatus;
      
      // Status sayısını artır
      statusCounts[status || 'undefined'] = (statusCounts[status || 'undefined'] || 0) + 1;
      fulfillmentCounts[fulfillmentStatus || 'undefined'] = (fulfillmentCounts[fulfillmentStatus || 'undefined'] || 0) + 1;
      
      if (sampleOrders.length < 10) {
        sampleOrders.push({
          id: order.id || order._id,
          number: order.number,
          status: status,
          statusType: typeof status,
          fulfillmentStatus: fulfillmentStatus,
          fulfillmentStatusType: typeof fulfillmentStatus,
          paymentStatus: order.paymentStatus,
          createdDate: order.createdDate || order.dateCreated,
          availableFields: Object.keys(order).sort()
        });
      }
      
      // İlk 100 siparişi kontrol ettikten sonra dur
      if (count >= 100) break;
    }
    
    console.log(`📈 Debug tamamlandı: ${count} sipariş kontrol edildi`);
    
    res.json({
      totalChecked: count,
      statusDistribution: statusCounts,
      fulfillmentStatusDistribution: fulfillmentCounts,
      sampleOrders: sampleOrders
    });
    
  } catch (error) {
    console.error('❌ Debug error:', error);
    res.status(500).json({ 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// DEBUG: Specific order detailed info from Wix
app.get('/api/debug/wix/order/:orderNumber', async (req, res) => {
  try {
    const { orderNumber } = req.params;
    console.log(`🔍 Wix'ten sipariş ${orderNumber} detayı aranıyor...`);
    
    let orderFound = null;
    let count = 0;
    
    for await (const order of wix.iterateOrders()) {
      count++;
      if (order.number == orderNumber || order.id == orderNumber) {
        orderFound = order;
        break;
      }
      
      // 500 sipariş kontrolünden sonra dur
      if (count >= 500) {
        console.log(`⚠️ 500 sipariş kontrol edildi, ${orderNumber} bulunamadı`);
        break;
      }
    }
    
    if (!orderFound) {
      return res.status(404).json({ 
        error: `Sipariş ${orderNumber} Wix'te bulunamadı`, 
        searched: count 
      });
    }
    
    console.log(`✅ Sipariş ${orderNumber} bulundu, detaylar analiz ediliyor...`);
    
    // Müşteri bilgisi debug
    const customerDebug = {
      billingInfo: orderFound.billingInfo,
      shippingInfo: orderFound.shippingInfo,
      recipientInfo: orderFound.recipientInfo,
      buyerInfo: orderFound.buyerInfo,
      contactId: orderFound.contactId,
      customerId: orderFound.customerId
    };
    
    // Müşteri ismini çıkar (FIXED logic)
    let customerName = '';
    
    // 1. buyerInfo'dan firstName + lastName kombinasyonu (en güvenilir - Wix'te bu daha direkt)
    const buyerFirst = orderFound.buyerInfo?.firstName || '';
    const buyerLast = orderFound.buyerInfo?.lastName || '';
    if (buyerFirst || buyerLast) {
      customerName = (buyerFirst + ' ' + buyerLast).trim();
    }
    
    // 2. billingInfo.address.fullName'den (yeni yapı)
    if (!customerName) {
      const billingFirst = orderFound.billingInfo?.address?.fullName?.firstName || '';
      const billingLast = orderFound.billingInfo?.address?.fullName?.lastName || '';
      if (billingFirst || billingLast) {
        customerName = (billingFirst + ' ' + billingLast).trim();
      }
    }
    
    // 3. shippingInfo.shipmentDetails.address.fullName'den (yeni yapı)
    if (!customerName) {
      const shippingFirst = orderFound.shippingInfo?.shipmentDetails?.address?.fullName?.firstName || '';
      const shippingLast = orderFound.shippingInfo?.shipmentDetails?.address?.fullName?.lastName || '';
      if (shippingFirst || shippingLast) {
        customerName = (shippingFirst + ' ' + shippingLast).trim();
      }
    }
    
    // 4. Legacy yapı - billingInfo.contactDetails (eski support)
    if (!customerName) {
      const billingFirst = orderFound.billingInfo?.contactDetails?.firstName || '';
      const billingLast = orderFound.billingInfo?.contactDetails?.lastName || '';
      if (billingFirst || billingLast) {
        customerName = (billingFirst + ' ' + billingLast).trim();
      }
    }
    
    // 5. Şirket adını kontrol et (yeni ve eski yapılar)
    if (!customerName) {
      customerName = orderFound.billingInfo?.address?.company || 
                    orderFound.shippingInfo?.shipmentDetails?.address?.company ||
                    orderFound.billingInfo?.contactDetails?.company || 
                    orderFound.shippingInfo?.logistics?.shippingDestination?.contactDetails?.company ||
                    orderFound.recipientInfo?.contactDetails?.company ||
                    '';
    }
    
    // 6. buyerInfo contactDetails (legacy) - fallback
    if (!customerName) {
      const buyerFirst = orderFound.buyerInfo?.contactDetails?.firstName || '';
      const buyerLast = orderFound.buyerInfo?.contactDetails?.lastName || '';
      if (buyerFirst || buyerLast) {
        customerName = (buyerFirst + ' ' + buyerLast).trim();
      }
    }
    
    // 7. Son çare olarak contactId veya email kullan
    if (!customerName) {
      customerName = orderFound.buyerInfo?.contactId || orderFound.buyerInfo?.email || 'Unknown Customer';
    }
    
    res.json({
      success: true,
      orderNumber,
      rawOrder: orderFound,
      extractedCustomerName: customerName,
      customerDebug,
      allFields: Object.keys(orderFound).sort()
    });
    
  } catch (error) {
    console.error(`❌ Wix order debug error:`, error);
    res.status(500).json({ 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ---- Products ----
app.get('/api/products', async (req, res) => {
  // Use DISTINCT and GROUP BY to avoid duplicate SKUs (case-insensitive)
  const rows = await all(`
    SELECT p.* FROM products p
    WHERE p.id IN (
      SELECT MIN(id) FROM products 
      GROUP BY UPPER(sku)
    )
    ORDER BY p.id DESC
  `);
  
  for (const r of rows) {
    // Get all packages for this product
    const allPackages = await all('SELECT * FROM product_packages WHERE product_id=? ORDER BY id', [r.id]);
    
    // Include all packages regardless of shelf stock for service requests
    r.packages = allPackages.map(pkg => ({
      ...pkg,
      shelf_location: null,
      shelf_name: null
    }));
    
    const locs = await all(`SELECT l.code FROM product_locations pl JOIN locations l ON l.id=pl.location_id WHERE pl.product_id=? ORDER BY l.code`, [r.id]);
    r.location_codes = locs.map(x=>x.code);
  }
  res.json(rows);
});

app.post('/api/products', async (req, res) => {
  const { sku, name, description, main_barcode, price, color } = req.body;
  
  try {
    // Validation
    if (!sku || !name) {
      return res.status(400).json({ 
        error: 'SKU ve ürün adı zorunludur' 
      });
    }
    
    // SKU format validation
    if (!/^[A-Z0-9\-]{3,}$/i.test(sku)) {
      return res.status(400).json({ 
        error: 'SKU en az 3 karakter olmalı ve sadece harf, rakam, tire içermeli' 
      });
    }
    
    // Check if SKU already exists
    const existingProduct = await get('SELECT id, sku FROM products WHERE LOWER(sku) = LOWER(?)', [sku]);
    if (existingProduct) {
      return res.status(400).json({ 
        error: `SKU "${sku}" zaten kullanılıyor (ID: ${existingProduct.id})` 
      });
    }
    
    // Insert new product
    const result = await run(`
      INSERT INTO products (sku, name, description, main_barcode, price, color, created_at, updated_at) 
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      sku.toUpperCase().trim(), 
      name.trim(), 
      description?.trim() || null, 
      main_barcode?.trim() || null, 
      price || 0,
      color?.trim() || null
    ]);
    
    // Get the newly created product
    const newProduct = await get('SELECT * FROM products WHERE id = ?', [result.lastID]);
    
    console.log(`✅ New product created: ${newProduct.sku} - ${newProduct.name}`);
    
    res.status(201).json({
      success: true,
      message: 'Ürün başarıyla eklendi',
      product: newProduct,
      ...newProduct  // Backward compatibility
    });
    
  } catch (e) {
    console.error('❌ Product creation error:', e);
    
    // SQLite unique constraint error
    if (e.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ 
        error: 'Bu SKU zaten kullanılıyor' 
      });
    }
    
    res.status(500).json({ 
      error: 'Ürün oluşturulurken hata: ' + e.message 
    });
  }
});

app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const { sku, name, description, main_barcode, price, color, main_product_name, main_product_name_en } = req.body;
  try {
    await run(`UPDATE products SET sku=?, name=?, description=?, main_barcode=?, price=?, color=?, main_product_name=?, main_product_name_en=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [sku, name, description || null, main_barcode || null, price || 0, color || null, main_product_name || null, main_product_name_en || null, id]);
    const prod = await get('SELECT * FROM products WHERE id=?', [id]);
    res.json(prod);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await run('DELETE FROM products WHERE id=?', [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Packages for a product
app.get('/api/products/:id/packages', async (req, res) => {
  const { id } = req.params;
  const rows = await all('SELECT * FROM product_packages WHERE product_id=?', [id]);
  res.json(rows);
});

// Create package via /api/product-packages (used by frontend)
app.post('/api/product-packages', async (req, res) => {
  console.log('Product-packages POST request:', req.body);
  
  const { product_id, package_number, package_name, barcode, quantity, weight_kg, length, width, height, volume_m3, contents } = req.body;
  
  // Validation
  if (!product_id) {
    return res.status(400).json({ error: 'Product ID zorunludur' });
  }
  if (!package_number?.trim()) {
    return res.status(400).json({ error: 'Paket numarası zorunludur' });
  }
  if (!package_name?.trim()) {
    return res.status(400).json({ error: 'Paket adı zorunludur' });
  }
  if (!barcode?.trim()) {
    return res.status(400).json({ error: 'Barkod zorunludur' });
  }
  
  try {
    await run(`INSERT INTO product_packages 
      (product_id, package_number, package_name, barcode, quantity, width, length, height, weight_kg, volume_m3, contents) 
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [product_id, package_number.trim(), package_name.trim(), barcode.trim(), quantity || 1, 
       width || null, length || null, height || null, weight_kg || null, volume_m3 || null, contents || null]);
    
    const row = await get('SELECT * FROM product_packages WHERE product_id=? AND barcode=?', [product_id, barcode.trim()]);
    res.status(201).json(row);
  } catch (e) {
    console.error('Package insertion error:', e);
    if (e.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: 'Bu barkod zaten kullanılıyor' });
    } else {
      res.status(400).json({ error: e.message });
    }
  }
});

app.post('/api/products/:id/packages', async (req, res) => {
  const { id } = req.params;
  console.log('Package POST request - Product ID:', id);
  console.log('Package POST request - Body:', req.body);
  
  const { package_number, package_no, package_content, product_name, product_name_en, package_name, package_name_tr, package_name_en, package_content_tr, package_content_en, color, color_en, barcode, quantity, weight_kg, volume_m3, sku, length_cm, width_cm, height_cm, contents, contents_en } = req.body;
  
  // Zorunlu alan kontrolü: sadece barcode
  if (!barcode || !barcode.trim()) {
    console.log('Missing barcode error');
    return res.status(400).json({ error: 'Barkod zorunludur' });
  }
  
  try {
    await run(`INSERT INTO product_packages (product_id, package_number, product_name, product_name_en, package_name, package_name_en, color, color_en, barcode, quantity, width, length, height, weight_kg, volume_m3, contents, contents_en) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, package_number?.trim() || null, product_name?.trim() || null, product_name_en?.trim() || null, package_name?.trim() || null, package_name_en?.trim() || null, color?.trim() || null, color_en?.trim() || null, barcode.trim(), quantity || 1, width_cm || null, length_cm || null, height_cm || null, weight_kg || null, volume_m3 || null, contents?.trim() || null, contents_en?.trim() || null]);
    const row = await get('SELECT * FROM product_packages WHERE product_id=? AND barcode=?', [id, barcode.trim()]);
    res.status(201).json(row);
  } catch (e) {
    console.error('Package insertion error:', e);
    if (e.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: 'Bu barkod zaten kullanılıyor' });
    } else if (e.message.includes('no such column')) {
      res.status(400).json({ error: 'Database schema error: ' + e.message });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

app.put('/api/packages/:pkgId', async (req, res) => {
  const { pkgId } = req.params;
  const { package_number, package_no, package_content, product_name, product_name_en, package_name, package_name_tr, package_name_en, package_content_tr, package_content_en, color, color_tr, color_en, barcode, quantity, weight_kg, volume_m3, sku, length_cm, width_cm, height_cm, contents, contents_en } = req.body;
  
  // Zorunlu alan kontrolü: sadece barcode
  if (!barcode || !barcode.trim()) {
    return res.status(400).json({ error: 'Barkod zorunludur' });
  }
  
  try {
    await run(`UPDATE product_packages SET 
                 package_number=?, product_name=?, product_name_en=?, package_name=?, package_name_en=?, color=?, color_en=?, barcode=?, length=?, width=?, height=?, weight_kg=?, volume_m3=?, contents=?, contents_en=?, updated_at=CURRENT_TIMESTAMP 
               WHERE id=?`,
              [package_number?.trim() || null, product_name?.trim() || null, product_name_en?.trim() || null, (package_name || package_name_tr)?.trim() || null, package_name_en?.trim() || null, (color || color_tr)?.trim() || null, color_en?.trim() || null, barcode.trim(),
               length_cm ? parseFloat(length_cm) : null, width_cm ? parseFloat(width_cm) : null, height_cm ? parseFloat(height_cm) : null,
               weight_kg ? parseFloat(weight_kg) : null, volume_m3 ? parseFloat(volume_m3) : null, (contents || package_content_tr)?.trim() || null, (contents_en || package_content_en)?.trim() || null, pkgId]);
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: 'Bu barkod zaten kullanılıyor' });
    } else {
      res.status(400).json({ error: e.message });
    }
  }
});

app.delete('/api/packages/:pkgId', async (req, res) => {
  const { pkgId } = req.params;
  try {
    await run('DELETE FROM product_packages WHERE id=?', [pkgId]);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Search available packages (PK products) to add - NO AUTH REQUIRED - MUST BE BEFORE :pkgId route
app.get('/api/packages/search-pk-products', async (req, res) => {
  console.log('🔍 PK Search endpoint hit!', req.query);
  
  try {
    const { q, mainProductId } = req.query;
    console.log('🔍 Search query:', q, 'Main product ID:', mainProductId);
    
    let query = `
      SELECT id, sku, name, description
      FROM products
      WHERE sku LIKE 'PK-%'
    `;
    let params = [];
    
    if (q) {
      query += ` AND (sku LIKE ? OR name LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }
    
    // Exclude packages already assigned to this main product
    if (mainProductId) {
      query += ` AND sku NOT IN (
        SELECT barcode FROM product_packages WHERE product_id = ?
      )`;
      params.push(mainProductId);
    }
    
    query += ` ORDER BY sku ASC LIMIT 30`;
    
    console.log('🔍 Executing query:', query, 'Params:', params);
    
    const pkProducts = await all(query, params);
    console.log('🔍 Found PK products:', pkProducts.length);
    
    res.json({ success: true, packages: pkProducts });
  } catch (error) {
    console.error('❌ Search PK products error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single package by ID
app.get('/api/packages/:pkgId', requireAuth, async (req, res) => {
  const { pkgId } = req.params;
  try {
    const pkg = await get('SELECT * FROM product_packages WHERE id=?', [pkgId]);
    if (!pkg) {
      return res.status(404).json({ error: 'Paket bulunamadı' });
    }
    res.json(pkg);
  } catch (e) {
    console.error('❌ Get package error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ---- Debug endpoint ----
app.get('/api/debug/env', async (req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV || 'not set',
    WIX_API_KEY: process.env.WIX_API_KEY ? 'SET (length: ' + process.env.WIX_API_KEY.length + ')' : 'NOT SET',
    WIX_SITE_ID: process.env.WIX_SITE_ID ? 'SET (length: ' + process.env.WIX_SITE_ID.length + ')' : 'NOT SET',
    PORT: process.env.PORT || 'not set'
  });
});

// Debug packages count before/after sync
app.get('/api/debug/packages-count', async (req, res) => {
  try {
    const totalPackages = await get('SELECT COUNT(*) as count FROM product_packages');
    const packagesPerProduct = await all(`
      SELECT p.sku, p.name, COUNT(pp.id) as package_count 
      FROM products p 
      LEFT JOIN product_packages pp ON p.id = pp.product_id 
      GROUP BY p.id, p.sku, p.name 
      HAVING package_count > 0
      ORDER BY package_count DESC
      LIMIT 10
    `);
    res.json({
      total_packages: totalPackages.count,
      products_with_packages: packagesPerProduct
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- NETSIS API ENDPOINTS ----

// Test Netsis connection with detailed health check
app.get('/api/netsis/test', async (req, res) => {
  console.log('🩺 Netsis health check started...');
  const healthCheck = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    server_location: req.hostname || 'unknown',
    user_agent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    headers: req.headers,
    env_vars_available: Object.keys(process.env).filter(key => key.startsWith('NETSIS_')),
    checks: {}
  };

  try {
    // 1. Environment Variables Check
    console.log('📋 Checking environment variables...');
    healthCheck.checks.env_vars = {
      status: 'checking',
      details: {
        NETSIS_API_URL: process.env.NETSIS_API_URL || 'MISSING',
        NETSIS_USERNAME: process.env.NETSIS_USERNAME || 'MISSING',
        NETSIS_PASSWORD: process.env.NETSIS_PASSWORD ? 'PRESENT' : 'MISSING',
        NETSIS_DB_NAME: process.env.NETSIS_DB_NAME || 'MISSING',
        NETSIS_DB_USER: process.env.NETSIS_DB_USER || 'MISSING',
        NETSIS_DB_PASSWORD: process.env.NETSIS_DB_PASSWORD ? 'PRESENT' : 'MISSING',
        NETSIS_BRANCH_CODE: process.env.NETSIS_BRANCH_CODE || 'MISSING'
      }
    };
    
    const missingEnvVars = Object.entries(healthCheck.checks.env_vars.details)
      .filter(([key, value]) => value === 'MISSING')
      .map(([key, value]) => key);
    
    if (missingEnvVars.length > 0) {
      healthCheck.checks.env_vars.status = 'FAILED';
      healthCheck.checks.env_vars.error = `Missing environment variables: ${missingEnvVars.join(', ')}`;
      console.log('❌ Missing environment variables:', missingEnvVars);
    } else {
      healthCheck.checks.env_vars.status = 'PASSED';
      console.log('✅ All environment variables present');
    }

    // 2. Network Connectivity Check
    console.log('🌐 Testing network connectivity...');
    healthCheck.checks.network = { status: 'checking' };
    
    try {
      const axios = require('axios');
      const startTime = Date.now();
      const response = await axios.get(process.env.NETSIS_API_URL, { 
        timeout: 10000,
        validateStatus: () => true // Accept all status codes
      });
      const endTime = Date.now();
      
      healthCheck.checks.network = {
        status: 'PASSED',
        response_time_ms: endTime - startTime,
        status_code: response.status,
        status_text: response.statusText,
        server_headers: response.headers
      };
      console.log(`✅ Network connectivity OK (${response.status}) - ${endTime - startTime}ms`);
    } catch (networkError) {
      healthCheck.checks.network = {
        status: 'FAILED',
        error: networkError.message,
        code: networkError.code,
        errno: networkError.errno,
        syscall: networkError.syscall,
        hostname: networkError.hostname
      };
      console.log('❌ Network connectivity failed:', networkError.message);
    }

    // 3. Netsis API Authentication Test
    console.log('🔐 Testing Netsis API authentication...');
    healthCheck.checks.netsis_auth = { status: 'checking' };
    
    try {
      const result = await netsisAPI.testConnection();
      healthCheck.checks.netsis_auth = {
        status: result.success ? 'PASSED' : 'FAILED',
        details: result,
        message: result.message
      };
      console.log(`${result.success ? '✅' : '❌'} Netsis API test: ${result.message}`);
    } catch (authError) {
      healthCheck.checks.netsis_auth = {
        status: 'FAILED',
        error: authError.message,
        stack: process.env.NODE_ENV === 'development' ? authError.stack : undefined
      };
      console.log('❌ Netsis API authentication failed:', authError.message);
    }

    // Overall health status
    const allChecks = Object.values(healthCheck.checks);
    const passedChecks = allChecks.filter(check => check.status === 'PASSED').length;
    const failedChecks = allChecks.filter(check => check.status === 'FAILED').length;
    
    healthCheck.overall = {
      status: failedChecks === 0 ? 'HEALTHY' : (passedChecks > 0 ? 'DEGRADED' : 'UNHEALTHY'),
      total_checks: allChecks.length,
      passed: passedChecks,
      failed: failedChecks,
      summary: failedChecks === 0 ? 'All systems operational' : 
               `${failedChecks} of ${allChecks.length} checks failed`
    };

    console.log(`🏥 Health check completed: ${healthCheck.overall.status}`);
    
    // Return appropriate HTTP status
    const statusCode = healthCheck.overall.status === 'HEALTHY' ? 200 : 
                      healthCheck.overall.status === 'DEGRADED' ? 200 : 500;
    
    res.status(statusCode).json(healthCheck);
    
  } catch (error) {
    console.error('❌ Health check failed:', error);
    healthCheck.checks.overall_error = {
      status: 'FAILED',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
    healthCheck.overall = {
      status: 'UNHEALTHY',
      error: 'Health check process failed',
      details: error.message
    };
    res.status(500).json(healthCheck);
  }
});

// Get customers from Netsis
app.get('/api/netsis/customers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const customers = await netsisAPI.getCustomers(limit, offset);
    res.json({ success: true, customers });
  } catch (error) {
    console.error('❌ Netsis customers fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get products from Netsis
app.get('/api/netsis/products', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const products = await netsisAPI.getProducts(limit, offset);
    res.json({ success: true, products });
  } catch (error) {
    console.error('❌ Netsis products fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get stock from Netsis
app.get('/api/netsis/stock', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const stock = await netsisAPI.getStockCards(limit, offset);
    res.json({ success: true, stock });
  } catch (error) {
    console.error('❌ Netsis stock fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get orders from Netsis (temporary no auth for testing) - DISABLED - using real endpoint instead
/*app.get('/api/netsis/orders', async (req, res) => {
  console.log('🚀 NETSIS ORDERS ENDPOINT HIT! Path:', req.path);
  try {
    console.log('🔄 Netsis orders API called with auth user:', req.session?.user?.username);
    const { limit = 50, offset = 0 } = req.query;
    console.log('📋 Requesting Netsis orders with limit:', limit, 'offset:', offset);
    
    const orders = await netsisAPI.getOrders(parseInt(limit), parseInt(offset));
    console.log('✅ Netsis orders received:', orders ? 'Success' : 'Empty');
    res.json(orders);
  } catch (e) {
    console.error('❌ Netsis orders error:', e.message);
    res.status(500).json({ 
      error: 'Netsis sipariş verisi alınamadı', 
      details: e.message,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});*/

// Get individual order by ID from Netsis - C# örneğine göre
app.get('/api/netsis/orders/:id', async (req, res) => {
  console.log('🔍 NETSIS ORDER BY ID ENDPOINT HIT!');
  try {
    const orderId = parseInt(req.params.id);
    console.log('📋 Requesting Netsis order ID:', orderId);
    
    const order = await netsisAPI.getOrderById(orderId);
    console.log('✅ Netsis order by ID received:', order ? 'Success' : 'Empty');
    res.json(order);
  } catch (e) {
    console.error('❌ Netsis order by ID error:', e.message);
    res.status(404).json({ 
      error: 'Netsis sipariş bulunamadı', 
      orderId: req.params.id,
      details: e.message
    });
  }
});

// Sync products from Netsis to local DB
app.post('/api/netsis/sync/products', async (req, res) => {
  try {
    console.log('🔄 Netsis ürün senkronizasyonu başlatılıyor...');
    
    let syncCount = 0;
    const allProducts = [];
    
    // Netsis API'den ürünleri iterator ile al
    for await (const { item: product, version, source } of netsisAPI.iterateProducts()) {
        try {
        // Netsis'ten gelen ürün verilerini WMS formatına çevir
        // NetOpenX Items API formatı: StokTemelBilgi.Stok_Kodu, StokTemelBilgi.Stok_Adi, StokTemelBilgi.Satis_Fiat1
        const sku = product.StokTemelBilgi?.Stok_Kodu || product.sku || product.id;
        const name = product.StokTemelBilgi?.Stok_Adi || product.name;
        const price = product.StokTemelBilgi?.Satis_Fiat1 || product.priceData?.price || 0;
          
          if (sku && name) {
          // Check if a product with same SKU (case-insensitive) already exists
          const existingProduct = await get('SELECT id, sku FROM products WHERE UPPER(sku) = UPPER(?)', [sku]);
          
          if (existingProduct) {
            // Update existing product with original case
            await run(`
              UPDATE products SET 
                name = ?, 
                price = ?, 
                netsis_data = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `, [name, price, JSON.stringify(product.netsis || {}), existingProduct.id]);
          } else {
            // Insert new product
            await run(`
              INSERT INTO products (sku, name, price, netsis_data, created_at) 
              VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [sku, name, price, JSON.stringify(product.netsis || {})]);
          }
            
          syncCount++;
          
          // Ürünü liste listeye ekle (paket eşleştirme için)
          allProducts.push({ sku, name, price, netsis: product.netsis });
          
          // İlk 10 ürün için log
          if (syncCount <= 10) {
            console.log(`📦 Ürün ${syncCount}: ${name} (${sku}) - ${price} TRY`);
          }
        }
      } catch (error) {
        console.warn(`⚠️ Ürün senkronizasyon hatası (${product.StokTemelBilgi?.Stok_Kodu || product.sku || product.id}):`, error.message);
      }
    }
    
    console.log(`✅ ${syncCount} ürün Netsis'ten senkronize edildi`);
    
    // PK package matching işlemi başlat
    console.log('🔗 PK paket eşleştirme işlemi başlatılıyor...');
    let packageMatchCount = 0;
    
    try {
      const packageMatches = await netsisAPI.matchAllPkProducts(allProducts);
      
      // Başarılı eşleştirmeleri product_packages tablosuna ekle
      for (const match of packageMatches) {
        if (match.matched) {
          try {
            // Ana ürünün database ID'sini al
            const mainProduct = await get('SELECT id FROM products WHERE sku = ?', [match.mainProductSku]);
            
            if (mainProduct) {
              // PK ürününü paket olarak ekle
              await run(`
                INSERT INTO product_packages (product_id, package_name, barcode, quantity, created_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(product_id, barcode) DO UPDATE SET
                  package_name=excluded.package_name,
                  quantity=excluded.quantity,
                  updated_at=CURRENT_TIMESTAMP
              `, [
                mainProduct.id,
                `PK Paketi: ${match.pkProduct.name}`,
                match.packageSku,
                1
              ]);
              
              packageMatchCount++;
              
            } else {
              console.warn(`⚠️ Ana ürün database'de bulunamadı: ${match.mainProductSku}`);
            }
          } catch (pkError) {
            console.warn(`⚠️ Paket eşleştirme kaydetme hatası: ${match.packageSku}`, pkError.message);
          }
        }
      }
      
      console.log(`✅ ${packageMatchCount} PK paketi ana ürünleri ile eşleştirildi`);
      
    } catch (matchError) {
      console.warn('⚠️ Paket eşleştirme işlemi başarısız:', matchError.message);
    }
    
    res.json({ 
      success: true, 
      message: `${syncCount} ürün başarıyla senkronize edildi, ${packageMatchCount} paket eşleştirme yapıldı`,
      syncedCount: syncCount,
      packageMatchCount: packageMatchCount
    });
    
  } catch (error) {
    console.error('❌ Netsis product sync error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test PK package matching functionality
app.get('/api/test/pk-matching', async (req, res) => {
  try {
    console.log('🧪 PK paket eşleştirme testi başlatılıyor...');
    
    // Test product listesi al
    const products = await all('SELECT sku, name FROM products LIMIT 100');
    console.log(`📦 Test için ${products.length} ürün alındı`);
    
    // PK matching test
    const matches = await netsisAPI.matchAllPkProducts(products);
    
    res.json({
      success: true,
      totalProducts: products.length,
      matchingResults: matches.length,
      successfulMatches: matches.filter(m => m.matched).length,
      matches: matches.slice(0, 10) // İlk 10 eşleştirmeyi göster
    });
    
  } catch (error) {
    console.error('❌ PK matching test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug orders count
app.get('/api/debug/orders-count', async (req, res) => {
  try {
    const totalOrders = await get('SELECT COUNT(*) as count FROM orders');
    const ordersByStatus = await all(`
      SELECT status, COUNT(*) as count 
      FROM orders 
      GROUP BY status 
      ORDER BY count DESC
    `);
    const recentOrders = await all(`
      SELECT order_number, customer_name, status, created_at 
      FROM orders 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    res.json({
      total_orders: totalOrders.count,
      orders_by_status: ordersByStatus,
      recent_orders: recentOrders
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Debug Wix API raw response
app.get('/api/debug/wix-orders-raw', async (req, res) => {
  try {
    console.log('🔍 Testing Wix orders API directly...');
    
    let totalFetched = 0;
    let pageCount = 0;
    let allOrders = [];
    
    for await (const order of wix.iterateOrders()) {
      totalFetched++;
      allOrders.push({
        number: order.number || order.id,
        status: order.status,
        created: order.dateCreated || order.createdDate
      });
      
      // Sadece ilk 100'ü göster, fazlası çok büyük olur
      if (totalFetched >= 100) break;
    }
    
    res.json({
      message: `Wix API'den ${totalFetched} sipariş alındı`,
      total_fetched: totalFetched,
      sample_orders: allOrders.slice(0, 10),
      all_orders_preview: allOrders
    });
  } catch (e) {
    console.error('Wix debug error:', e);
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

// ---- Orders ----
// Generate unique order number for Netsis integration
app.get('/api/orders/generate-number', async (req, res) => {
  try {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    
    // Format: NETSIS-YYYYMMDD-XXX
    const datePrefix = `NETSIS-${year}${month}${day}`;
    
    // Get today's order count
    const todayStart = `${year}-${month}-${day} 00:00:00`;
    const todayEnd = `${year}-${month}-${day} 23:59:59`;
    
    const todayOrderCount = await get(`
      SELECT COUNT(*) as count 
      FROM orders 
      WHERE created_at BETWEEN ? AND ?
    `, [todayStart, todayEnd]);
    
    const nextNumber = (todayOrderCount.count || 0) + 1;
    const orderNumber = `${datePrefix}-${String(nextNumber).padStart(3, '0')}`;
    
    // Double check uniqueness
    const existing = await get('SELECT id FROM orders WHERE order_number = ?', [orderNumber]);
    
    if (existing) {
      // Fallback to timestamp-based
      const timestamp = Date.now();
      res.json({ orderNumber: `NETSIS-${timestamp}` });
    } else {
      res.json({ orderNumber });
    }
    
  } catch (error) {
    console.error('❌ Netsis order number generation error:', error);
    // Fallback
    const timestamp = Date.now();
    res.json({ orderNumber: `NETSIS-${timestamp}` });
  }
});

app.get('/api/orders', async (req, res) => {
  const rows = await all(`
    SELECT o.*,
           COALESCE(latest_pick.status, NULL) as pick_status,
           COALESCE(latest_pick.pick_id, NULL) as pick_id
    FROM orders o
    LEFT JOIN (
      SELECT p.order_id,
             p.status,
             p.id as pick_id,
             ROW_NUMBER() OVER (PARTITION BY p.order_id ORDER BY p.id DESC) as rn
      FROM picks p
      WHERE p.status != 'completed'
    ) as latest_pick ON latest_pick.order_id = o.id AND latest_pick.rn = 1
    ORDER BY o.id DESC
  `);
  
  // Add order items to each order
  for (const order of rows) {
    const orderItems = await all(`
      SELECT oi.*, p.name as product_name, p.color as product_color, p.main_product_name
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
      ORDER BY oi.line_number ASC
    `, [order.id]);
    
    order.items = orderItems;
  }
  
  // TEMP DEBUG: Count orders by source
  const externalCount = rows.filter(r => r.source === 'external_sync').length;
  const testCount = rows.filter(r => r.source !== 'external_sync').length;
  if (testCount > 0) {
    console.log(`📊 Orders: ${externalCount} external, ${testCount} test/manual`);
  }
  
  res.json(rows);
});

app.post('/api/orders', async (req, res) => {
  const { 
    order_number, 
    customer_name, 
    customer_phone,
    customer_email,
    delivery_address,
    order_date,
    notes,
    items 
  } = req.body;
  
  if (!order_number || !customer_name) {
    return res.status(400).json({ 
      error: 'Sipariş numarası ve müşteri adı zorunludur' 
    });
  }
  
  if (!items || !items.length) {
    return res.status(400).json({ 
      error: 'Sipariş için en az bir ürün eklemelisiniz' 
    });
  }
  
  try {
    // Check if order number already exists
    const existingOrder = await get('SELECT id FROM orders WHERE order_number = ?', [order_number]);
    if (existingOrder) {
      return res.status(400).json({ 
        error: `Sipariş numarası "${order_number}" zaten kullanılıyor` 
      });
    }
    
    // Create order with Netsis integration ready
    const result = await run(`
      INSERT INTO orders (
        order_number, 
        customer_name, 
        customer_phone,
        customer_email,
        delivery_address,
        order_date,
        notes,
        status, 
        created_at
      ) VALUES (?,?,?,?,?,?,?,'open', CURRENT_TIMESTAMP)
    `, [
      order_number, 
      customer_name,
      customer_phone || null,
      customer_email || null,
      delivery_address || null,
      order_date || new Date().toISOString().split('T')[0],
      notes || null
    ]);
    
    const orderId = result.lastID;
    
    // Add order items
    let totalAmount = 0;
    for (const item of items) {
      const prod = await get('SELECT * FROM products WHERE id=?', [item.product_id]);
      if (!prod) {
        throw new Error(`Geçersiz ürün ID: ${item.product_id}`);
      }
      
      const quantity = parseInt(item.quantity || 1, 10);
      const unitPrice = parseFloat(item.unit_price || prod.price || 0);
      const lineTotal = quantity * unitPrice;
      totalAmount += lineTotal;
      
      await run(`
        INSERT INTO order_items (
          order_id, 
          product_id, 
          sku, 
          product_name, 
          quantity,
          unit_price,
          line_total
        ) VALUES (?,?,?,?,?,?,?)
      `, [
        orderId, 
        prod.id, 
        prod.sku, 
        item.product_name || prod.name, 
        quantity,
        unitPrice,
        lineTotal
      ]);
    }
    
    // Update order with total amount
    await run('UPDATE orders SET total_amount = ? WHERE id = ?', [totalAmount, orderId]);
    
    // Get the complete order
    const order = await get('SELECT * FROM orders WHERE id=?', [orderId]);
    const orderItems = await all('SELECT * FROM order_items WHERE order_id=?', [orderId]);
    
    console.log(`✅ Netsis entegre manuel sipariş oluşturuldu: ${order_number} - ${customer_name} (₺${totalAmount.toFixed(2)})`);
    
    res.status(201).json({
      success: true,
      message: 'Sipariş başarıyla oluşturuldu (Netsis entegre)',
      order: {
        ...order,
        items: orderItems
      }
    });
    
  } catch (e) {
    console.error('❌ Netsis entegre manuel sipariş oluşturma hatası:', e);
    
    // SQLite unique constraint error
    if (e.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ 
        error: 'Bu sipariş numarası zaten kullanılıyor' 
      });
    }
    
    res.status(500).json({ 
      error: 'Sipariş oluşturulurken hata: ' + e.message 
    });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const order = await get('SELECT * FROM orders WHERE id=?', [id]);
  const items = await all(`
    SELECT oi.*, p.color as product_color 
    FROM order_items oi 
    LEFT JOIN products p ON oi.product_id = p.id 
    WHERE oi.order_id = ?
  `, [id]);
  res.json({ ...order, items });
});

app.delete('/api/orders/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check order info before deletion
    const orderInfo = await get('SELECT order_number, source FROM orders WHERE id = ?', [id]);
    console.log(`🗑️ Deleting order ID ${id}: ${orderInfo ? `${orderInfo.order_number} (${orderInfo.source})` : 'NOT FOUND'}`);
    
    // Delete order items first (foreign key constraint)
    await run('DELETE FROM order_items WHERE order_id = ?', [id]);
    
    // Delete picks related to this order
    await run('DELETE FROM picks WHERE order_id = ?', [id]);
    
    // Delete the order
    const result = await run('DELETE FROM orders WHERE id = ?', [id]);
    
    if (result.changes > 0) {
      console.log(`✅ Order ${id} deleted successfully`);
      res.json({ success: true, message: 'Order deleted' });
    } else {
      res.status(404).json({ success: false, error: 'Order not found' });
    }
  } catch (error) {
    console.error('❌ Delete order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// ---- Locations / Bins ----
app.get('/api/locations', async (req, res) => {
  const rows = await all('SELECT * FROM locations ORDER BY code');
  res.json(rows);
});
app.post('/api/locations', async (req, res) => {
  const { code, name } = req.body;
  await run('INSERT OR IGNORE INTO locations (code, name) VALUES (?, ?)', [code, name || null]);
  const row = await get('SELECT * FROM locations WHERE code=?', [code]);
  res.status(201).json(row);
});

// Assign a product to a location (creates location if needed)
app.post('/api/products/:id/assign-location', async (req, res) => {
  const { id } = req.params;
  const { code, on_hand } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });
  await run('INSERT OR IGNORE INTO locations (code) VALUES (?)', [code]);
  const loc = await get('SELECT * FROM locations WHERE code=?', [code]);
  await run('INSERT OR IGNORE INTO product_locations (product_id, location_id, on_hand) VALUES (?,?,?)', [id, loc.id, parseInt(on_hand||0,10)]);
  await run('UPDATE product_locations SET on_hand=? WHERE product_id=? AND location_id=?', [parseInt(on_hand||0,10), id, loc.id]);
  res.json({ success: true });
});

// List product locations
app.get('/api/products/:id/locations', async (req, res) => {
  const { id } = req.params;
  const rows = await all(`SELECT pl.*, l.code, l.name FROM product_locations pl JOIN locations l ON l.id=pl.location_id WHERE pl.product_id=? ORDER BY l.code`, [id]);
  res.json(rows);
});


// ---- Stock movements ----
app.post('/api/stock/in', async (req, res) => {
  const { product_id, qty, note } = req.body;
  await run('INSERT INTO stock_movements (product_id, type, qty, note) VALUES (?, "IN", ?, ?)', [product_id, qty, note || null]);
  res.status(201).json({ success: true });
});
app.post('/api/stock/out', async (req, res) => {
  const { product_id, qty, note } = req.body;
  await run('INSERT INTO stock_movements (product_id, type, qty, note) VALUES (?, "OUT", ?, ?)', [product_id, qty, note || null]);
  res.status(201).json({ success: true });
});

// ---- Picking ----
async function computeExpectedScans(order_id) {
  const items = await all('SELECT * FROM order_items WHERE order_id=?', [order_id]);
  const map = {}; // product_id => { packages: [{id, barcode, perSetQty}], neededSets, counts }
  for (const it of items) {
    const pkgs = await all('SELECT * FROM product_packages WHERE product_id=?', [it.product_id]);
    map[it.product_id] = {
      order_item_id: it.id,
      neededSets: it.quantity,
      packages: pkgs.map(p => ({ id: p.id, barcode: p.barcode, perSetQty: p.quantity })),
      counts: {} // barcode => scanned count
    };
  }
  return map;
}

app.post('/api/picks', async (req, res) => {
  const { order_id } = req.body;
  const order = await get('SELECT * FROM orders WHERE id=?', [order_id]);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  // Create pick
  await run('INSERT INTO picks (order_id, status) VALUES (?, "active")', [order_id]);
  const pick = await get('SELECT * FROM picks WHERE order_id=? ORDER BY id DESC LIMIT 1', [order_id]);
  res.status(201).json(pick);
});

app.get('/api/picks/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    console.log(`🔍 Pick ${id} loading started`);
    const startTime = Date.now();
    
    const pick = await get('SELECT * FROM picks WHERE id=?', [id]);
    if (!pick) {
      console.log(`❌ Pick ${id} not found`);
      return res.status(404).json({ error: 'Pick not found' });
    }
    
    console.log(`✅ Pick ${id} found, loading order...`);
    const order = await get('SELECT * FROM orders WHERE id=?', [pick.order_id]);
  const items = await all(`
    SELECT oi.*, p.color as product_color 
    FROM order_items oi 
    LEFT JOIN products p ON oi.product_id = p.id 
    WHERE oi.order_id = ?
  `, [pick.order_id]);
  
  // Her item için package bilgilerini ve lokasyon bilgilerini al
  for (const it of items) {
    it.packages = await all('SELECT * FROM product_packages WHERE product_id=?', [it.product_id]);
    
    // Her package için FIFO mantığıyla lokasyon bilgilerini al (raflardan)
    for (const pkg of it.packages) {
      // Bu paket için raf atamalarını al - FIFO (First In, First Out) sırasıyla
      console.log(`🔍 Looking for shelf assignments for package ID: ${pkg.id}, barcode: ${pkg.barcode}`);
      
      // İlk önce direkt package_id ile eşleştirmeyi dene
      pkg.locations = await all(`
        SELECT 
          sp.id as assignment_id,
          sp.shelf_id,
          sp.quantity,
          sp.assigned_date,
          s.shelf_code,
          s.shelf_name,
          s.zone,
          s.aisle,
          s.level
        FROM shelf_packages sp
        JOIN shelves s ON sp.shelf_id = s.id
        WHERE sp.package_id = ? AND sp.quantity > 0
        ORDER BY sp.assigned_date ASC
      `, [pkg.id]);
      
      // Eğer sonuç yoksa barcode ile de dene
      if (pkg.locations.length === 0) {
        console.log(`❌ No direct package_id match, trying barcode match for ${pkg.barcode}`);
        pkg.locations = await all(`
          SELECT 
            sp.id as assignment_id,
            sp.shelf_id,
            sp.quantity,
            sp.assigned_date,
            s.shelf_code,
            s.shelf_name,
            s.zone,
            s.aisle,
            s.level
          FROM shelf_packages sp
          JOIN shelves s ON sp.shelf_id = s.id
          JOIN product_packages pp ON sp.package_id = pp.id
          WHERE pp.barcode = ? AND sp.quantity > 0
          ORDER BY sp.assigned_date ASC
        `, [pkg.barcode]);
      }
      
      console.log(`📍 Found ${pkg.locations.length} locations for package ${pkg.id}:`, pkg.locations);
    }
  }
  
    const scans = await all('SELECT * FROM pick_scans WHERE pick_id=?', [id]);
    
    const endTime = Date.now();
    console.log(`✅ Pick ${id} loaded successfully in ${endTime - startTime}ms`);
    
    res.json({ pick, order, items, scans });
    
  } catch (error) {
    console.error(`❌ Pick ${id} loading failed:`, {
      error: error.message,
      stack: error.stack?.substring(0, 500),
      timestamp: new Date().toISOString()
    });
    
    // Railway 502 prevention
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Pick loading failed', 
        message: error.message,
        pickId: id,
        timestamp: new Date().toISOString()
      });
    }
  }
});

// Lokasyon teyit endpoint'i
app.post('/api/picks/:id/verify-location', async (req, res) => {
  const { id } = req.params;
  const { packageBarcode, shelfCode } = req.body;
  
  try {
    const pick = await get('SELECT * FROM picks WHERE id=?', [id]);
    if (!pick) return res.status(404).json({ error: 'Pick not found' });
    
    // Paketi bul
    const pkg = await get('SELECT * FROM product_packages WHERE barcode=?', [packageBarcode]);
    if (!pkg) return res.status(400).json({ error: 'Package not found' });
    
    // Bu paket için beklenen lokasyonları al (FIFO sırasıyla)
    const expectedLocations = await all(`
      SELECT 
        sp.*, s.shelf_code, s.shelf_name, s.zone, s.aisle, s.level
      FROM shelf_packages sp
      JOIN shelves s ON sp.shelf_id = s.id
      WHERE sp.package_id = ? AND sp.quantity > 0
      ORDER BY sp.assigned_date ASC
    `, [pkg.id]);
    
    if (expectedLocations.length === 0) {
      return res.status(400).json({ error: 'Bu paket için rafta stok bulunamadı' });
    }
    
    // İlk (en eski) lokasyon FIFO için beklenen
    const expectedLocation = expectedLocations[0];
    const isCorrectLocation = expectedLocation.shelf_code === shelfCode;
    
    res.json({
      success: true,
      packageBarcode,
      shelfCode,
      isCorrectLocation,
      expectedLocation: {
        shelf_code: expectedLocation.shelf_code,
        shelf_name: expectedLocation.shelf_name,
        zone: expectedLocation.zone,
        aisle: expectedLocation.aisle,
        level: expectedLocation.level,
        quantity: expectedLocation.quantity
      },
      allLocations: expectedLocations.map(loc => ({
        shelf_code: loc.shelf_code,
        shelf_name: loc.shelf_name,
        quantity: loc.quantity,
        assigned_date: loc.assigned_date
      })),
      message: isCorrectLocation 
        ? `✅ Doğru lokasyon! ${expectedLocation.shelf_code}` 
        : `⚠️ Yanlış lokasyon! Beklenen: ${expectedLocation.shelf_code}`
    });
    
  } catch (error) {
    console.error('Location verification error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/picks/:id/scan', async (req, res) => {
  const { id } = req.params;
  const { barcode, verifiedLocation } = req.body;
  const pick = await get('SELECT * FROM picks WHERE id=?', [id]);
  if (!pick) return res.status(404).json({ error: 'Pick not found' });

  // Find package by barcode
  const pkg = await get('SELECT * FROM product_packages WHERE barcode=?', [barcode]);
  if (!pkg) return res.status(400).json({ error: 'Bu barkod tanımlı değil' });

  // Find matching order item for this product that still needs sets
  const item = await get('SELECT * FROM order_items WHERE order_id=? AND product_id=?', [pick.order_id, pkg.product_id]);
  if (!item) return res.status(400).json({ error: 'Bu barkod bu siparişte beklenmiyor' });

  // Count scans for this barcode ACROSS ALL PICKS in this order  
  const scannedCountRow = await get(`
    SELECT COUNT(*) as c 
    FROM pick_scans ps 
    JOIN picks p ON ps.pick_id = p.id 
    WHERE p.order_id = ? AND ps.order_item_id = ? AND ps.barcode = ?
  `, [pick.order_id, item.id, barcode]);
  const scannedCount = scannedCountRow.c || 0;
  
  console.log(`🔍 Scan check for barcode ${barcode}: found ${scannedCount} scans for order ${pick.order_id}, item ${item.id}`);

  // Expected per package for this order item
  const perSetQty = pkg.quantity || 1;
  const expectedForThisPackage = perSetQty * item.quantity;

  if (scannedCount >= expectedForThisPackage) {
    return res.status(400).json({ error: 'Bu barkod bu sipariş için zaten yeterince okundu' });
  }

  // FIFO: En eski tarihli raf atamasından bir paket çıkar (raftan çıkarma)
  const oldestAssignment = await get(`
    SELECT sp.* FROM shelf_packages sp
    JOIN product_packages pp ON sp.package_id = pp.id
    WHERE pp.id = ? AND sp.quantity > 0
    ORDER BY sp.assigned_date ASC
    LIMIT 1
  `, [pkg.id]);

  if (oldestAssignment) {
    // Raftan bir paket çıkar
    await run(`UPDATE shelf_packages SET quantity = quantity - 1 WHERE id = ?`, [oldestAssignment.id]);
    console.log(`📦 Removed 1 package from shelf package ${oldestAssignment.id} (FIFO)`);
  }

  // Record scan
  await run(`INSERT INTO pick_scans (pick_id, order_item_id, product_id, package_id, barcode) VALUES (?,?,?,?,?)`,
    [id, item.id, item.product_id, pkg.id, barcode]);

  // Update picked_qty (we consider a "set" completed when sum over all packages reaches sum(pack.quantity))
  // Compute total scans for this order_item ACROSS ALL PICKS for this order
  const totalScansRow = await get(`
    SELECT COUNT(*) as c 
    FROM pick_scans ps 
    JOIN picks p ON ps.pick_id = p.id 
    WHERE p.order_id = ? AND ps.order_item_id = ?
  `, [pick.order_id, item.id]);
  const totalScans = totalScansRow.c;

  // total required scans for one set of this product
  const pkgRows = await all('SELECT quantity FROM product_packages WHERE product_id=?', [item.product_id]);
  const scansPerSet = pkgRows.reduce((a, r) => a + (r.quantity || 1), 0);

  const pickedSets = Math.min(item.quantity, Math.floor(totalScans / scansPerSet));
  await run('UPDATE order_items SET picked_qty=? WHERE id=?', [pickedSets, item.id]);

  // Check if order completed - debug version
  const orderItemsDebug = await all(`SELECT id, sku, quantity, picked_qty FROM order_items WHERE order_id=?`, [pick.order_id]);
  console.log(`🔍 Order ${pick.order_id} items status:`, orderItemsDebug);
  
  const remainingRow = await get(`SELECT COUNT(*) as remaining FROM order_items WHERE order_id=? AND picked_qty < quantity`, [pick.order_id]);
  const allPicked = remainingRow.remaining === 0;
  
  console.log(`📊 Order completion check: remaining=${remainingRow.remaining}, allPicked=${allPicked}`);
  
  if (allPicked) {
    await run('UPDATE orders SET status="fulfilled", fulfillment_status="FULFILLED" WHERE id=?', [pick.order_id]);
    await run('UPDATE picks SET status="completed" WHERE id=?', [id]);
    
    // Netsis NetOpenXRest ile irsaliye oluşturma
    try {
      const orderDetails = await get(`
        SELECT o.*
        FROM orders o 
        WHERE o.id = ?
      `, [pick.order_id]);
      
      // AUTOMATIC DISPATCH NOTE CREATION DISABLED - Use manual dispatch button instead
      if (orderDetails) {
        console.log(`ℹ️ Pick completed for order ${orderDetails.order_number} - Manual dispatch note creation required`);
        
        // Just update the delivery status to pending (manual dispatch needed)
        await run(`
          UPDATE orders 
          SET netsis_delivery_status = 'pending_manual_dispatch'
          WHERE id = ?
        `, [pick.order_id]);
      }
      
      /* DISABLED: Automatic dispatch note creation
      if (orderDetails) {
        const orderItems = await all(`
          SELECT oi.*, p.sku as product_sku, p.name as product_name 
          FROM order_items oi 
          LEFT JOIN products p ON oi.product_id = p.id 
          WHERE oi.order_id = ?
        `, [pick.order_id]);
        
        console.log(`🔄 Netsis'e irsaliye oluşturma isteği gönderiliyor: ${orderDetails.order_number}`);
        
        const deliveryNoteResult = await netsisAPI.convertOrderToDeliveryNote({
          order_number: orderDetails.order_number,
          customer_code: orderDetails.customer_name || 'UNKNOWN',
          total_amount: orderDetails.total_amount || 0,
          items: orderItems.map(item => ({
            product_sku: item.product_sku || item.sku,
            sku: item.sku,
            quantity: item.picked_qty || item.quantity,
            unit_price: item.unit_price || 0,
            product_name: item.product_name
          }))
        });
        
        if (deliveryNoteResult.success) {
          console.log(`✅ Netsis irsaliyesi başarıyla oluşturuldu: ${orderDetails.order_number} -> ${deliveryNoteResult.delivery_note_id}`);
          
          // İrsaliye ID'sini orders tablosuna kaydet
          await run(`
            UPDATE orders 
            SET netsis_delivery_note_id = ?, netsis_delivery_status = 'created' 
            WHERE id = ?
          `, [deliveryNoteResult.delivery_note_id, pick.order_id]);
          
        } else {
          console.warn(`⚠️ Netsis irsaliye oluşturulamadı: ${orderDetails.order_number} - ${deliveryNoteResult.message}`);
          await run(`
            UPDATE orders 
            SET netsis_delivery_status = 'failed', netsis_delivery_error = ? 
            WHERE id = ?
          `, [deliveryNoteResult.message, pick.order_id]);
        }
      }
      */
    } catch (error) {
      console.error(`❌ Netsis irsaliye oluşturma hatası:`, error.message);
      await run(`
        UPDATE orders 
        SET netsis_delivery_status = 'error', netsis_delivery_error = ? 
        WHERE id = ?
      `, [error.message, pick.order_id]);
    }
    
    // Wix ile senkronizasyon
    try {
      const orderRow = await get('SELECT wix_order_id, order_number FROM orders WHERE id=?', [pick.order_id]);
      if (orderRow?.wix_order_id) {
        console.log(`🔄 Wix'e sipariş tamamlandı bilgisi gönderiliyor: ${orderRow.order_number} (${orderRow.wix_order_id})`);
        await wix.updateOrderFulfillment(orderRow.wix_order_id, 'FULFILLED');
      } else {
        console.log(`⚠️ Sipariş ${orderRow.order_number} için Wix ID bulunamadı, senkronizasyon yapılamadı`);
      }
    } catch (error) {
      console.error(`❌ Wix senkronizasyon hatası:`, error.message);
      // Hata olsa bile pick tamamlanmış kabul edilir
    }
  }

  res.json({
    success: true,
    item: { id: item.id, picked_qty: pickedSets, quantity: item.quantity },
    order_completed: allPicked
  });
});

// Set pick to partial status (when user exits without completing)
app.post('/api/picks/:id/partial', async (req, res) => {
  const { id } = req.params;
  
  try {
    const pick = await get('SELECT * FROM picks WHERE id=?', [id]);
    if (!pick) {
      return res.status(404).json({ error: 'Pick not found' });
    }
    
    // Pick'i partial duruma güncelle
    await run('UPDATE picks SET status="partial" WHERE id=?', [id]);
    
    // Siparişi de kısmi karşılanmış duruma güncelle
    await run('UPDATE orders SET fulfillment_status="PARTIALLY_FULFILLED" WHERE id=?', [pick.order_id]);
    
    // Wix ile senkronizasyon - kısmi karşılanma durumu
    try {
      const orderRow = await get('SELECT wix_order_id, order_number FROM orders WHERE id=?', [pick.order_id]);
      if (orderRow?.wix_order_id) {
        console.log(`🔄 Wix'e kısmi karşılanma bilgisi gönderiliyor: ${orderRow.order_number} (${orderRow.wix_order_id})`);
        await wix.updateOrderFulfillment(orderRow.wix_order_id, 'PARTIALLY_FULFILLED');
        console.log(`✅ Wix'te sipariş kısmi karşılanmış olarak güncellendi: ${orderRow.order_number}`);
      } else {
        console.log(`⚠️ Sipariş ${orderRow?.order_number} için Wix ID bulunamadı, senkronizasyon yapılamadı`);
      }
    } catch (error) {
      console.error(`❌ Wix kısmi senkronizasyon hatası:`, error.message);
      // Hata olsa bile pick partial kabul edilir
    }
    
    console.log(`✅ Pick ${id} set to partial status, Order ${pick.order_id} set to PARTIALLY_FULFILLED`);
    
    res.json({ success: true, message: 'Pick set to partial status and order updated' });
  } catch (error) {
    console.error('Error setting pick to partial:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// DEBUG: Clear all scans for an order (temporary fix)
app.post('/api/debug/clear-order-scans/:order_id', async (req, res) => {
  const { order_id } = req.params;
  
  try {
    // Clear all pick_scans for this order across all picks
    const result = await run(`
      DELETE FROM pick_scans 
      WHERE pick_id IN (SELECT id FROM picks WHERE order_id = ?)
    `, [order_id]);
    
    console.log(`🧹 DEBUG: Cleared ${result.changes} scans for order ${order_id}`);
    res.json({ success: true, cleared: result.changes });
  } catch (error) {
    console.error('Debug clear error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reset pick (cancel all scans and return to initial state)
app.post('/api/picks/:id/reset', async (req, res) => {
  const { id } = req.params;
  
  try {
    const pick = await get('SELECT * FROM picks WHERE id=?', [id]);
    if (!pick) {
      return res.status(404).json({ error: 'Pick not found' });
    }
    
    // Önce silinen scanları rafa geri yükle
    const scansToRevert = await all(`
      SELECT ps.*, pp.barcode, sp.id as shelf_package_id 
      FROM pick_scans ps
      JOIN product_packages pp ON ps.package_id = pp.id
      LEFT JOIN shelf_packages sp ON sp.package_id = pp.id
      WHERE ps.pick_id = ?
      ORDER BY ps.id
    `, [id]);
    
    console.log(`📦 Reverting ${scansToRevert.length} scanned items back to shelves...`);
    
    for (const scan of scansToRevert) {
      // Rafa bir adet geri ekle
      if (scan.shelf_package_id) {
        await run(`UPDATE shelf_packages SET quantity = quantity + 1 WHERE id = ?`, [scan.shelf_package_id]);
        console.log(`📦 Added 1 package back to shelf package ${scan.shelf_package_id} (barcode: ${scan.barcode})`);
      }
    }
    
    // Tüm scanları sil
    await run('DELETE FROM pick_scans WHERE pick_id=?', [id]);
    
    // Pick durumunu pending'e çevir
    await run('UPDATE picks SET status="pending" WHERE id=?', [id]);
    
    // Order items'ların picked_qty'lerini sıfırla
    const updateResult = await run('UPDATE order_items SET picked_qty=0 WHERE order_id=?', [pick.order_id]);
    console.log(`📊 Updated ${updateResult.changes} order items, setting picked_qty=0 for order ${pick.order_id}`);
    
    // Sipariş durumunu tekrar henüz karşılanmamış'a çevir 
    await run('UPDATE orders SET fulfillment_status="NOT_FULFILLED" WHERE id=?', [pick.order_id]);
    
    // Wix ile senkronizasyon - reset durumu
    try {
      const orderRow = await get('SELECT wix_order_id, order_number FROM orders WHERE id=?', [pick.order_id]);
      if (orderRow?.wix_order_id) {
        console.log(`🔄 Wix'e reset bilgisi gönderiliyor: ${orderRow.order_number} (${orderRow.wix_order_id})`);
        await wix.updateOrderFulfillment(orderRow.wix_order_id, 'NOT_FULFILLED');
        console.log(`✅ Wix'te sipariş karşılanmamış olarak güncellendi: ${orderRow.order_number}`);
      } else {
        console.log(`⚠️ Sipariş ${orderRow?.order_number} için Wix ID bulunamadı, senkronizasyon yapılamadı`);
      }
    } catch (error) {
      console.error(`❌ Wix reset senkronizasyon hatası:`, error.message);
      // Hata olsa bile pick reset kabul edilir
    }
    
    console.log(`🗑️ Pick ${id} reset - all scans deleted, Order ${pick.order_id} back to NOT_FULFILLED`);
    
    res.json({ success: true, message: 'Pick reset successfully - all scans removed' });
  } catch (error) {
    console.error('Error resetting pick:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Delivery note PDF
app.get('/api/picks/:id/delivery-note.pdf', async (req, res) => {
  const { id } = req.params;
  const pick = await get('SELECT * FROM picks WHERE id=?', [id]);
  if (!pick) return res.status(404).end();

  const order = await get('SELECT * FROM orders WHERE id=?', [pick.order_id]);
  const items = await all(`
    SELECT oi.*, p.color as product_color 
    FROM order_items oi 
    LEFT JOIN products p ON oi.product_id = p.id 
    WHERE oi.order_id = ?
  `, [pick.order_id]);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="irsaliye-${order.order_number}.pdf"`);

  const doc = new PDFDocument({ 
    margin: 50,
    size: 'A4',
    info: {
      Title: `İrsaliye - ${order.order_number}`,
      Author: 'WMS Sistemi',
      Subject: 'Sevk İrsaliyesi',
      Creator: 'WMS - Warehouse Management System'
    }
  });
  doc.pipe(res);

  // Turkish font support - use built-in fonts that support Turkish characters
  const regularFont = 'Helvetica';
  const boldFont = 'Helvetica-Bold';

  // Header section with company info
  doc.fontSize(20).font(boldFont).text('SEVK İRSALİYESİ', { align: 'center' });
  doc.fontSize(12).font(regularFont).text('DELIVERY NOTE', { align: 'center' });
  
  // Draw a line under header
  doc.moveTo(50, doc.y + 10).lineTo(545, doc.y + 10).stroke();
  doc.moveDown(2);

  // Order information section
  const infoStartY = doc.y;
  doc.fontSize(12).font(boldFont);
  
  // Left column - Order Info
  doc.text('SİPARİŞ BİLGİLERİ', 50, infoStartY);
  doc.font(regularFont).fontSize(10);
  doc.text(`Sipariş No: ${order.order_number}`, 50, doc.y + 5);
  doc.text(`Tarih: ${new Date(order.created_at).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })}`, 50, doc.y + 5);
  doc.text(`Durum: ${order.status}`, 50, doc.y + 5);
  doc.text(`Pick ID: ${pick.id}`, 50, doc.y + 5);

  // Right column - Customer Info  
  doc.fontSize(12).font(boldFont);
  doc.text('MÜŞTERİ BİLGİLERİ', 300, infoStartY);
  doc.font(regularFont).fontSize(10);
  doc.text(`Müşteri: ${order.customer_name || 'Belirtilmemiş'}`, 300, infoStartY + 20);
  doc.text(`Teslimat Adresi:`, 300, doc.y + 5);
  doc.text(`${order.shipping_address || 'Adres bilgisi mevcut değil'}`, 300, doc.y + 5);
  
  doc.moveDown(2);
  
  // Draw separator line
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown();

  // Items table header
  doc.fontSize(12).font(boldFont);
  doc.text('ÜRÜN LİSTESİ', { align: 'center' });
  doc.moveDown();

  // Table headers
  const tableTop = doc.y;
  const itemHeight = 25;
  
  doc.fontSize(10).font(boldFont);
  doc.text('SIRA', 50, tableTop, { width: 30 });
  doc.text('ÜRÜN KODU', 85, tableTop, { width: 80 });
  doc.text('ÜRÜN ADI', 170, tableTop, { width: 180 });
  doc.text('RENK', 360, tableTop, { width: 50 });
  doc.text('MİKTAR', 420, tableTop, { width: 40 });
  doc.text('TOPLANAN', 470, tableTop, { width: 50 });
  doc.text('DURUM', 525, tableTop, { width: 40 });

  // Draw table header line
  doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();

  // Table content
  let currentY = tableTop + 20;
  doc.font(regularFont).fontSize(9);

  items.forEach((item, index) => {
    // Check if we need a new page
    if (currentY > 700) {
      doc.addPage();
      currentY = 50;
    }

    const rowNumber = (index + 1).toString();
    const status = item.picked_qty >= item.quantity ? 'TAM' : item.picked_qty > 0 ? 'KISMEN' : 'BEKLİYOR';
    const statusColor = item.picked_qty >= item.quantity ? 'green' : item.picked_qty > 0 ? 'orange' : 'red';

    doc.text(rowNumber, 50, currentY, { width: 30 });
    doc.text(item.sku || '-', 85, currentY, { width: 80 });
    
    // Handle long product names - wrap text if needed
    const productName = item.product_name || '-';
    if (productName.length > 25) {
      const lines = doc.heightOfString(productName, { width: 180 });
      doc.text(productName, 170, currentY, { width: 180, height: lines });
    } else {
      doc.text(productName, 170, currentY, { width: 180 });
    }
    
    doc.text(item.product_color || '-', 360, currentY, { width: 50 });
    doc.text(item.quantity.toString(), 420, currentY, { width: 40, align: 'center' });
    doc.text(item.picked_qty.toString(), 470, currentY, { width: 50, align: 'center' });
    
    // Status with color
    const originalFillColor = doc.fillColor();
    if (statusColor === 'green') doc.fillColor('green');
    else if (statusColor === 'orange') doc.fillColor('orange');
    else if (statusColor === 'red') doc.fillColor('red');
    
    doc.text(status, 525, currentY, { width: 40, align: 'center' });
    doc.fillColor(originalFillColor); // Reset color

    currentY += itemHeight;
    
    // Draw row separator line
    doc.moveTo(50, currentY - 5).lineTo(545, currentY - 5).stroke('#E0E0E0');
  });

  // Summary section
  doc.moveDown(2);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown();

  const totalItems = items.length;
  const completedItems = items.filter(item => item.picked_qty >= item.quantity).length;
  const partialItems = items.filter(item => item.picked_qty > 0 && item.picked_qty < item.quantity).length;

  doc.fontSize(10).font(boldFont);
  doc.text('ÖZET BİLGİLER', { align: 'center' });
  doc.moveDown();
  
  doc.font(regularFont);
  doc.text(`Toplam Kalem Sayısı: ${totalItems}`, 50, doc.y);
  doc.text(`Tamamlanan: ${completedItems}`, 200, doc.y);
  doc.text(`Kısmen Toplanan: ${partialItems}`, 350, doc.y);
  doc.text(`Bekleyen: ${totalItems - completedItems - partialItems}`, 500, doc.y);

  // Footer section
  doc.moveDown(3);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown();

  doc.fontSize(8).font(regularFont);
  doc.text('Bu irsaliye otomatik olarak WMS sistemi tarafından oluşturulmuştur.', { align: 'center' });
  doc.text(`Oluşturma Tarihi: ${new Date().toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })}`, { align: 'center' });

  // Add signature areas
  doc.moveDown(2);
  doc.fontSize(10);
  
  // Two signature boxes side by side
  const signatureY = doc.y + 40;
  
  // Teslim Eden (Deliverer)
  doc.rect(50, signatureY, 200, 60).stroke();
  doc.text('TESLİM EDEN', 60, signatureY + 5);
  doc.text('Ad Soyad: ............................', 60, signatureY + 25);
  doc.text('Tarih: ..............................', 60, signatureY + 40);
  
  // Teslim Alan (Receiver)
  doc.rect(300, signatureY, 200, 60).stroke();
  doc.text('TESLİM ALAN', 310, signatureY + 5);
  doc.text('Ad Soyad: ............................', 310, signatureY + 25);
  doc.text('Tarih: ..............................', 310, signatureY + 40);

  doc.end();
});

// ===== RAF YÖNETİMİ API ENDPOINTS =====

// Tüm rafları listele
app.get('/api/shelves', async (req, res) => {
  try {
    const shelves = await all(`
      SELECT s.*, 
             COALESCE(s.current_usage, 0) as current_usage
      FROM shelves s
      WHERE s.shelf_code NOT LIKE 'SSH-%'
      ORDER BY s.zone, s.aisle, s.level
    `);
    res.json({ shelves });
  } catch (error) {
    console.error('Error fetching shelves:', error);
    res.status(500).json({ error: error.message });
  }
});

// Belirli raf detayını getir
app.get('/api/shelves/:shelfId', async (req, res) => {
  try {
    const shelf = await get(`
      SELECT * FROM shelves WHERE id = ?
    `, [req.params.shelfId]);
    
    if (!shelf) {
      return res.status(404).json({ error: 'Raf bulunamadı' });
    }
    
    const packages = await all(`
      SELECT sp.*, pp.package_name, pp.barcode, pp.quantity as package_size,
             p.name as product_name, p.sku
      FROM shelf_packages sp
      JOIN product_packages pp ON sp.package_id = pp.id
      JOIN products p ON pp.product_id = p.id
      WHERE sp.shelf_id = ? AND sp.quantity > 0
      ORDER BY sp.assigned_date DESC
    `, [req.params.shelfId]);
    
    res.json({ shelf, packages });
  } catch (error) {
    console.error('Error fetching shelf details:', error);
    res.status(500).json({ error: error.message });
  }
});

// Raf barkodu ile raf ara
app.get('/api/shelves/barcode/:shelfCode', async (req, res) => {
  try {
    const shelf = await get(`
      SELECT * FROM shelves WHERE shelf_code = ? AND shelf_code NOT LIKE 'SSH-%'
    `, [req.params.shelfCode]);
    
    if (!shelf) {
      return res.status(404).json({ error: 'Raf bulunamadı', shelf_code: req.params.shelfCode });
    }
    
    res.json({ shelf });
  } catch (error) {
    console.error('Error finding shelf by barcode:', error);
    res.status(500).json({ error: error.message });
  }
});

// Paket barkodu ile paket ara
app.get('/api/packages/barcode/:barcode', async (req, res) => {
  try {
    const package = await get(`
      SELECT pp.*, p.name as product_name, p.sku
      FROM product_packages pp
      JOIN products p ON pp.product_id = p.id
      WHERE pp.barcode = ?
    `, [req.params.barcode]);
    
    if (!package) {
      return res.status(404).json({ error: 'Paket bulunamadı', barcode: req.params.barcode });
    }
    
    res.json({ package });
  } catch (error) {
    console.error('Error finding package by barcode:', error);
    res.status(500).json({ error: error.message });
  }
});

// Ürün paket ataması (raf + paket barkod okutma)
app.post('/api/shelves/assign', async (req, res) => {
  try {
    const { shelf_code, package_barcode, quantity = 1, assigned_by = 'System' } = req.body;
    console.log(`🔄 Raf atama isteği: Raf=${shelf_code}, Barkod=${package_barcode}, Miktar=${quantity}`);
    
    if (!shelf_code || !package_barcode) {
      return res.status(400).json({ error: 'Raf kodu ve paket barkodu gerekli' });
    }
    
    // SSH raflarını engelle
    if (shelf_code.startsWith('SSH-')) {
      return res.status(400).json({ error: 'SSH rafları normal raf işlemlerinde kullanılamaz', shelf_code });
    }
    
    // Rafı bul
    console.log(`🔍 Raf arıyor: ${shelf_code}`);
    const shelf = await get(`SELECT * FROM shelves WHERE shelf_code = ? AND shelf_code NOT LIKE 'SSH-%'`, [shelf_code]);
    if (!shelf) {
      console.log(`❌ Raf bulunamadı: ${shelf_code}`);
      return res.status(404).json({ error: 'Raf bulunamadı', shelf_code });
    }
    console.log(`✅ Raf bulundu: ${shelf.shelf_name} (ID: ${shelf.id})`);
    
    // Paketi bul
    console.log(`🔍 Paket arıyor: ${package_barcode}`);
    const package = await get(`
      SELECT pp.*, p.name as product_name 
      FROM product_packages pp 
      JOIN products p ON pp.product_id = p.id 
      WHERE pp.barcode = ?
    `, [package_barcode]);
    
    if (!package) {
      console.log(`❌ Paket bulunamadı: ${package_barcode}`);
      return res.status(404).json({ error: 'Paket bulunamadı', package_barcode });
    }
    console.log(`✅ Paket bulundu: ${package.product_name} - ${package.package_name} (ID: ${package.id})`);
    
    // Mevcut atamayı kontrol et
    const existingAssignment = await get(`
      SELECT * FROM shelf_packages 
      WHERE shelf_id = ? AND package_id = ?
    `, [shelf.id, package.id]);
    
    if (existingAssignment) {
      // Mevcut atamayı güncelle
      await run(`
        UPDATE shelf_packages 
        SET quantity = quantity + ?, 
            last_updated = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [quantity, existingAssignment.id]);
    } else {
      // Yeni atama oluştur
      await run(`
        INSERT INTO shelf_packages 
        (shelf_id, package_id, quantity, assigned_date, last_updated)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [shelf.id, package.id, quantity]);
    }
    
    // Hareket kaydı şimdilik devre dışı (shelf_movements tablosu yok)
    console.log(`📝 Hareket kaydı: ${quantity} adet ${package.product_name} -> ${shelf.shelf_name}`);

    console.log(`✅ Raf atama başarılı: ${package.product_name} -> ${shelf.shelf_name}`);
    res.json({ 
      success: true, 
      message: `${package.product_name} (${package.package_name}) ${shelf.shelf_name} rafına atandı`,
      shelf: shelf.shelf_name,
      package: package.package_name,
      product: package.product_name,
      assigned_quantity: quantity,
      total_quantity: existingAssignment ? existingAssignment.quantity + quantity : quantity
    });
    
  } catch (error) {
    console.error('Error assigning package to shelf:', error);
    res.status(500).json({ error: error.message });
  }
});

// Raftan ürün çıkarma
app.post('/api/shelves/remove', async (req, res) => {
  try {
    const { shelf_code, package_barcode, quantity = 1, removed_by = 'System' } = req.body;
    
    // Mevcut ataması bul
    const assignment = await get(`
      SELECT sp.*, s.shelf_code, s.shelf_name, pp.package_name, pp.barcode, p.name as product_name
      FROM shelf_packages sp
      JOIN shelves s ON sp.shelf_id = s.id
      JOIN product_packages pp ON sp.package_id = pp.id  
      JOIN products p ON pp.product_id = p.id
      WHERE s.shelf_code = ? AND pp.barcode = ?
    `, [shelf_code, package_barcode]);
    
    if (!assignment) {
      return res.status(404).json({ error: 'Bu rafta bu paket bulunamadı' });
    }
    
    const previousQty = assignment.quantity;
    const newQty = Math.max(0, previousQty - quantity);
    
    if (newQty === 0) {
      // Miktar 0 olursa kaydı sil
      await run(`DELETE FROM shelf_packages WHERE id = ?`, [assignment.id]);
    } else {
      // Miktarı güncelle
      await run(`
        UPDATE shelf_packages 
        SET quantity = ?, last_updated = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [newQty, assignment.id]);
    }
    
    // Hareket kaydı (şimdilik devre dışı - shelf_movements tablosu yok)
    console.log(`📝 Hareket kaydı: ${quantity} adet ${assignment.product_name} çıkarıldı - ${assignment.shelf_name}`);
    
    res.json({ 
      success: true, 
      message: `${assignment.product_name} (${assignment.package_name}) ${assignment.shelf_name} rafından çıkarıldı`,
      previous_quantity: previousQty,
      removed_quantity: quantity,
      remaining_quantity: newQty,
      removed_completely: newQty === 0
    });
    
  } catch (error) {
    console.error('Error removing package from shelf:', error);
    res.status(500).json({ error: error.message });
  }
});

// Raf hareketleri geçmişi
app.get('/api/shelves/:shelfId/movements', async (req, res) => {
  try {
    const movements = await all(`
      SELECT sm.*, s.shelf_name, s.shelf_code, pp.package_name, pp.barcode, p.name as product_name, p.sku
      FROM shelf_movements sm
      JOIN shelves s ON sm.shelf_id = s.id
      JOIN product_packages pp ON sm.package_id = pp.id
      JOIN products p ON sm.product_id = p.id
      WHERE sm.shelf_id = ?
      ORDER BY sm.created_at DESC
      LIMIT 100
    `, [req.params.shelfId]);
    
    res.json({ movements });
  } catch (error) {
    console.error('Error fetching shelf movements:', error);
    res.status(500).json({ error: error.message });
  }
});

// Ürün hareketleri geçmişi
app.get('/api/products/:productId/movements', async (req, res) => {
  try {
    const movements = await all(`
      SELECT sm.*, s.shelf_name, s.shelf_code, pp.package_name, pp.barcode, p.name as product_name, p.sku,
             DATE(sm.created_at) as movement_date,
             sm.new_quantity as remaining_quantity,
             CASE 
               WHEN sm.movement_type = 'IN' THEN 'Giriş'
               WHEN sm.movement_type = 'OUT' THEN 'Çıkış'
               ELSE sm.movement_type
             END as movement_type_tr
      FROM shelf_movements sm
      JOIN shelves s ON sm.shelf_id = s.id
      JOIN product_packages pp ON sm.package_id = pp.id
      JOIN products p ON sm.product_id = p.id
      WHERE sm.product_id = ?
      ORDER BY sm.created_at DESC
      LIMIT 50
    `, [req.params.productId]);
    
    res.json({ movements });
  } catch (error) {
    console.error('Error fetching product movements:', error);
    res.status(500).json({ error: error.message });
  }
});

// Tüm raf atamaları (raf lokasyon sayfası için)
app.get('/api/shelf-assignments', async (req, res) => {
  try {
    // shelf_packages tablosundan gerçek verileri al
    const query = `
      SELECT 
        sp.id,
        sp.package_id,
        sp.shelf_id,
        sp.quantity,
        sp.assigned_date,
        sp.last_updated,
        s.shelf_code,
        s.shelf_name,
        s.zone,
        s.aisle,
        s.level,
        s.capacity,
        p.name as product_name,
        p.sku,
        pp.package_name,
        pp.barcode,
        pp.package_content,
        pp.package_number,
        pp.product_id,
        DATE(sp.assigned_date) as assigned_date_formatted
      FROM shelf_packages sp
      JOIN shelves s ON sp.shelf_id = s.id
      JOIN product_packages pp ON sp.package_id = pp.id
      JOIN products p ON pp.product_id = p.id
      WHERE sp.quantity > 0
      ORDER BY s.shelf_code, sp.assigned_date DESC
    `;
    
    console.log('🔍 Shelf assignments query çalıştırılıyor...');
    const assignments = await all(query);
    console.log(`📦 Shelf assignments sonuç: ${assignments ? assignments.length : 0} kayıt`);
    
    if (assignments && assignments.length > 0) {
      console.log('📋 İlk assignment:', assignments[0]);
    }
    
    res.json({ 
      assignments: assignments || [],
      count: assignments ? assignments.length : 0
    });
  } catch (error) {
    console.error('Error fetching shelf assignments:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---- Raf Yönetimi API'leri ----

// Yeni raf oluştur
app.post('/api/shelves', async (req, res) => {
  try {
    const { shelf_code, shelf_name, zone, aisle, level, capacity = 100 } = req.body;
    
    if (!shelf_code || !shelf_name || !zone || !aisle || level == null) {
      return res.status(400).json({ 
        error: 'Raf kodu, raf adı, bölge, koridor ve seviye gerekli alanlar' 
      });
    }

    const result = await run(`
      INSERT INTO shelves (shelf_code, shelf_name, zone, aisle, level, capacity)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [shelf_code, shelf_name, zone, aisle, level, capacity]);

    const shelf = await get('SELECT * FROM shelves WHERE id = ?', [result.lastID]);
    
    res.json({ message: 'Raf başarıyla oluşturuldu', shelf });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: 'Bu raf kodu zaten kullanılıyor' });
    } else {
      console.error('Error creating shelf:', error);
      res.status(500).json({ error: error.message });
    }
  }
});

// Rafı güncelle
app.put('/api/shelves/:id', async (req, res) => {
  try {
    const { shelf_code, shelf_name, zone, aisle, level, capacity } = req.body;
    const shelfId = req.params.id;
    
    if (!shelf_code || !shelf_name || !zone || !aisle || level == null) {
      return res.status(400).json({ 
        error: 'Raf kodu, raf adı, bölge, koridor ve seviye gerekli alanlar' 
      });
    }

    await run(`
      UPDATE shelves 
      SET shelf_code = ?, shelf_name = ?, zone = ?, aisle = ?, level = ?, capacity = ?
      WHERE id = ?
    `, [shelf_code, shelf_name, zone, aisle, level, capacity, shelfId]);

    const shelf = await get('SELECT * FROM shelves WHERE id = ?', [shelfId]);
    
    if (!shelf) {
      return res.status(404).json({ error: 'Raf bulunamadı' });
    }
    
    res.json({ message: 'Raf başarıyla güncellendi', shelf });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: 'Bu raf kodu zaten kullanılıyor' });
    } else {
      console.error('Error updating shelf:', error);
      res.status(500).json({ error: error.message });
    }
  }
});

// Rafı sil (sadece boş raflar silinebilir)
app.delete('/api/shelves/:id', async (req, res) => {
  try {
    const shelfId = req.params.id;
    
    // Raf üzerinde paket var mı kontrol et
    const packagesCount = await get(`
      SELECT COUNT(*) as count FROM shelf_packages 
      WHERE shelf_id = ? AND quantity > 0
    `, [shelfId]);
    
    if (packagesCount.count > 0) {
      return res.status(400).json({ 
        error: 'Bu rafta paketler var. Önce paketleri çıkarın.' 
      });
    }
    
    const shelf = await get('SELECT * FROM shelves WHERE id = ?', [shelfId]);
    if (!shelf) {
      return res.status(404).json({ error: 'Raf bulunamadı' });
    }
    
    await run('DELETE FROM shelves WHERE id = ?', [shelfId]);
    
    res.json({ message: `${shelf.shelf_code} rafı başarıyla silindi` });
  } catch (error) {
    console.error('Error deleting shelf:', error);
    res.status(500).json({ error: error.message });
  }
});

// Raf istatistikleri (admin için)
app.get('/api/shelves/stats', async (req, res) => {
  try {
    const stats = await all(`
      SELECT 
        zone,
        COUNT(*) as total_shelves,
        COUNT(DISTINCT aisle) as total_aisles,
        MAX(level) as max_levels,
        SUM(capacity) as total_capacity,
        COUNT(CASE WHEN sp.shelf_id IS NOT NULL THEN 1 END) as occupied_shelves
      FROM shelves s
      LEFT JOIN (
        SELECT DISTINCT shelf_id FROM shelf_packages WHERE quantity > 0
      ) sp ON s.id = sp.shelf_id
      GROUP BY zone
      ORDER BY zone
    `);
    
    const totals = await get(`
      SELECT 
        COUNT(*) as total_shelves,
        COUNT(DISTINCT zone) as total_zones,
        COUNT(DISTINCT zone || '-' || aisle) as total_aisles,
        SUM(capacity) as total_capacity,
        COUNT(CASE WHEN sp.shelf_id IS NOT NULL THEN 1 END) as occupied_shelves
      FROM shelves s
      LEFT JOIN (
        SELECT DISTINCT shelf_id FROM shelf_packages WHERE quantity > 0
      ) sp ON s.id = sp.shelf_id
    `);
    
    res.json({ stats, totals });
  } catch (error) {
    console.error('Error fetching shelf stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---- PACKAGE MANAGEMENT API ENDPOINTS ----

// Search main products (for package management)
app.get('/api/packages/search-main-products', requireAuth, async (req, res) => {
  try {
    const { q } = req.query;
    let query = `
      SELECT id, sku, name, description, price, created_at,
             (SELECT COUNT(*) FROM product_packages WHERE product_id = p.id) as package_count
      FROM products p
      WHERE 1=1
    `;
    let params = [];
    
    if (q) {
      query += ` AND (sku LIKE ? OR name LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }
    
    // Only show products that could be main products (not PK- prefixed)
    query += ` AND sku NOT LIKE 'PK-%'`;
    query += ` ORDER BY name ASC LIMIT 50`;
    
    const products = await all(query, params);
    res.json({ success: true, products });
  } catch (error) {
    console.error('❌ Search main products error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get packages for a main product
app.get('/api/packages/main-product/:productId', requireAuth, async (req, res) => {
  try {
    const { productId } = req.params;
    
    // Get main product info
    const mainProduct = await get('SELECT * FROM products WHERE id = ?', [productId]);
    if (!mainProduct) {
      return res.status(404).json({ success: false, error: 'Ana ürün bulunamadı' });
    }
    
    // Get existing packages for this main product
    const packages = await all(`
      SELECT pp.*, p.sku as package_sku, p.name as package_name
      FROM product_packages pp
      LEFT JOIN products p ON pp.barcode = p.sku
      WHERE pp.product_id = ?
      ORDER BY pp.package_name
    `, [productId]);
    
    res.json({ 
      success: true, 
      mainProduct,
      packages 
    });
  } catch (error) {
    console.error('❌ Get main product packages error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search available packages (PK products) to add - NO AUTH REQUIRED
app.get('/api/packages/search-pk-products', async (req, res) => {
  console.log('🔍 PK Search endpoint hit!', req.query);
  
  try {
    const { q, mainProductId } = req.query;
    console.log('🔍 Search query:', q, 'Main product ID:', mainProductId);
    
    let query = `
      SELECT id, sku, name, description
      FROM products
      WHERE sku LIKE 'PK-%'
    `;
    let params = [];
    
    if (q) {
      query += ` AND (sku LIKE ? OR name LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }
    
    // Exclude packages already assigned to this main product
    if (mainProductId) {
      query += ` AND sku NOT IN (
        SELECT barcode FROM product_packages WHERE product_id = ?
      )`;
      params.push(mainProductId);
    }
    
    query += ` ORDER BY sku ASC LIMIT 30`;
    
    console.log('🔍 Executing query:', query, 'Params:', params);
    
    const pkProducts = await all(query, params);
    console.log('🔍 Found PK products:', pkProducts.length);
    
    res.json({ success: true, packages: pkProducts });
  } catch (error) {
    console.error('❌ Search PK products error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add package to main product
app.post('/api/packages/add', requireAuth, async (req, res) => {
  try {
    const { mainProductId, packageSku, packageName, quantity } = req.body;
    
    if (!mainProductId || !packageSku) {
      return res.status(400).json({ success: false, error: 'Ana ürün ID ve paket SKU gerekli' });
    }
    
    // Check if main product exists
    const mainProduct = await get('SELECT * FROM products WHERE id = ?', [mainProductId]);
    if (!mainProduct) {
      return res.status(404).json({ success: false, error: 'Ana ürün bulunamadı' });
    }
    
    // Check if package already exists
    const existingPackage = await get(
      'SELECT id FROM product_packages WHERE product_id = ? AND barcode = ?', 
      [mainProductId, packageSku]
    );
    
    if (existingPackage) {
      return res.status(409).json({ success: false, error: 'Bu paket zaten eklenmiş' });
    }
    
    // Add the package
    const result = await run(`
      INSERT INTO product_packages (product_id, package_name, barcode, quantity, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      mainProductId,
      packageName || `Paket: ${packageSku}`,
      packageSku,
      quantity || 1
    ]);
    
    console.log(`✅ Paket eklendi: ${packageSku} -> ${mainProduct.sku} (${mainProduct.name})`);
    
    res.json({ 
      success: true, 
      message: 'Paket başarıyla eklendi',
      packageId: result.lastID 
    });
  } catch (error) {
    console.error('❌ Add package error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove package from main product
app.delete('/api/packages/:packageId', requireAuth, async (req, res) => {
  try {
    const { packageId } = req.params;
    
    // Get package info before deleting
    const packageInfo = await get('SELECT * FROM product_packages WHERE id = ?', [packageId]);
    if (!packageInfo) {
      return res.status(404).json({ success: false, error: 'Paket bulunamadı' });
    }
    
    // Delete the package
    const result = await run('DELETE FROM product_packages WHERE id = ?', [packageId]);
    
    if (result.changes > 0) {
      console.log(`✅ Paket silindi: ${packageInfo.barcode} (${packageInfo.package_name})`);
      res.json({ success: true, message: 'Paket başarıyla silindi' });
    } else {
      res.status(404).json({ success: false, error: 'Paket bulunamadı' });
    }
  } catch (error) {
    console.error('❌ Remove package error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update package details
app.put('/api/packages/:packageId', requireAuth, async (req, res) => {
  try {
    const { packageId } = req.params;
    const { packageName, quantity } = req.body;
    
    const result = await run(`
      UPDATE product_packages 
      SET package_name = ?, quantity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [packageName, quantity, packageId]);
    
    if (result.changes > 0) {
      res.json({ success: true, message: 'Paket başarıyla güncellendi' });
    } else {
      res.status(404).json({ success: false, error: 'Paket bulunamadı' });
    }
  } catch (error) {
    console.error('❌ Update package error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Auto-match PK products with main products (manual trigger)
app.post('/api/packages/auto-match', requireAuth, async (req, res) => {
  try {
    const { mainProductId } = req.body;
    
    if (req.session.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin yetkisi gerekli' });
    }
    
    console.log('🔄 Manuel PK eşleştirme başlatılıyor...');
    
    let matchCount = 0;
    let products = [];
    
    if (mainProductId) {
      // Match for specific main product
      const mainProduct = await get('SELECT * FROM products WHERE id = ?', [mainProductId]);
      if (!mainProduct) {
        return res.status(404).json({ success: false, error: 'Ana ürün bulunamadı' });
      }
      
      // Get all products for matching
      products = await all('SELECT sku, name FROM products LIMIT 2000');
      const matches = await netsisAPI.matchAllPkProducts(products);
      
      // Filter matches for this specific main product
      const relevantMatches = matches.filter(m => 
        m.matched && m.mainProductSku === mainProduct.sku
      );
      
      for (const match of relevantMatches) {
        try {
          await run(`
            INSERT INTO product_packages (product_id, package_name, barcode, quantity, created_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(product_id, barcode) DO UPDATE SET
              package_name=excluded.package_name,
              updated_at=CURRENT_TIMESTAMP
          `, [
            mainProduct.id,
            `PK Paketi: ${match.pkProduct.name}`,
            match.packageSku,
            1
          ]);
          matchCount++;
        } catch (err) {
          console.warn(`⚠️ Paket ekleme hatası: ${match.packageSku}`, err.message);
        }
      }
    } else {
      // Match all products
      products = await all('SELECT sku, name FROM products LIMIT 5000');
      const matches = await netsisAPI.matchAllPkProducts(products);
      
      for (const match of matches) {
        if (match.matched) {
          try {
            const mainProduct = await get('SELECT id FROM products WHERE sku = ?', [match.mainProductSku]);
            if (mainProduct) {
              await run(`
                INSERT INTO product_packages (product_id, package_name, barcode, quantity, created_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(product_id, barcode) DO UPDATE SET
                  package_name=excluded.package_name,
                  updated_at=CURRENT_TIMESTAMP
              `, [
                mainProduct.id,
                `PK Paketi: ${match.pkProduct.name}`,
                match.packageSku,
                1
              ]);
              matchCount++;
            }
          } catch (err) {
            console.warn(`⚠️ Paket ekleme hatası: ${match.packageSku}`, err.message);
          }
        }
      }
    }
    
    console.log(`✅ ${matchCount} otomatik PK eşleştirmesi tamamlandı`);
    
    res.json({
      success: true,
      message: `${matchCount} paket otomatik olarak eşleştirildi`,
      matchCount
    });
  } catch (error) {
    console.error('❌ Auto-match error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- Debug endpoints ----
app.get('/api/debug/tables', async (req, res) => {
  try {
    const tables = await all("SELECT name FROM sqlite_master WHERE type='table'");
    console.log('📋 Available tables:', tables);
    res.json({ tables });
  } catch (error) {
    console.error('Tables check error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/debug/schema/:tableName', async (req, res) => {
  const { tableName } = req.params;
  try {
    const schema = await all(`PRAGMA table_info(${tableName})`);
    console.log(`🏗️ Schema for ${tableName}:`, schema);
    res.json({ table: tableName, schema });
  } catch (error) {
    console.error('Schema check error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---- Wix Test Endpoints ----
app.post('/api/test/wix/order-fulfillment', async (req, res) => {
  const { orderId, fulfillmentStatus } = req.body;
  
  if (!orderId || !fulfillmentStatus) {
    return res.status(400).json({ 
      error: 'orderId and fulfillmentStatus are required',
      example: { orderId: 'wix-order-id', fulfillmentStatus: 'FULFILLED' }
    });
  }
  
  try {
    console.log(`🧪 TEST: Wix order fulfillment update: ${orderId} -> ${fulfillmentStatus}`);
    
    const result = await wix.updateOrderFulfillment(orderId, fulfillmentStatus);
    
    res.json({ 
      success: true, 
      message: `Wix order ${orderId} updated to ${fulfillmentStatus}`,
      result 
    });
    
  } catch (error) {
    console.error('❌ Wix test error:', error);
    res.status(500).json({ 
      error: error.message,
      response: error.response?.data,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.get('/api/test/wix/order/:orderId', async (req, res) => {
  const { orderId } = req.params;
  
  try {
    console.log(`🧪 TEST: Wix order fetch: ${orderId}`);
    
    const order = await wix.getOrderById(orderId);
    
    res.json({ 
      success: true, 
      message: `Wix order ${orderId} fetched successfully`,
      order 
    });
    
  } catch (error) {
    console.error('❌ Wix fetch error:', error);
    res.status(500).json({ 
      error: error.message,
      status: error.response?.status,
      response: error.response?.data,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ---- Debug endpoints ----
app.get('/api/debug/order/:orderNumber', async (req, res) => {
  const { orderNumber } = req.params;
  try {
    console.log(`🔍 DEBUG: Looking for order ${orderNumber}`);
    
    // Sipariş bilgisini al
    const order = await get('SELECT * FROM orders WHERE order_number = ?', [orderNumber]);
    console.log(`📦 Order found:`, order);
    
    if (order) {
      // Sipariş itemlarını al
      const items = await all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
      console.log(`📋 Order items:`, items);
      
      // Her item için paket ve raf bilgilerini al
      for (const item of items) {
        console.log(`\n🔍 Item ${item.id} - SKU: ${item.sku}`);
        
        // Paketleri al
        const packages = await all('SELECT * FROM product_packages WHERE product_id = ?', [item.product_id]);
        console.log(`📦 Packages:`, packages);
        
        // Her paket için raf atamalarını al
        for (const pkg of packages) {
          const assignments = await all(`
            SELECT sa.*, s.shelf_code, s.shelf_name, s.zone, s.aisle, s.level
            FROM shelf_assignments sa
            JOIN shelves s ON sa.shelf_id = s.id
            WHERE sa.package_id = ? AND sa.quantity > 0
            ORDER BY sa.assigned_date ASC
          `, [pkg.id]);
          console.log(`🏠 Package ${pkg.id} (${pkg.barcode}) assignments:`, assignments);
        }
      }
    }
    
    res.json({ order, items: order ? await all('SELECT * FROM order_items WHERE order_id = ?', [order.id]) : [] });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/debug/sku/:sku', async (req, res) => {
  const { sku } = req.params;
  try {
    console.log(`🔍 DEBUG: Looking for SKU ${sku}`);
    
    // Ürün bilgisini al
    const product = await get('SELECT * FROM products WHERE sku = ?', [sku]);
    console.log(`🛍️ Product found:`, product);
    
    if (product) {
      // Paketleri al
      const packages = await all('SELECT * FROM product_packages WHERE product_id = ?', [product.id]);
      console.log(`📦 Packages:`, packages);
      
      // Her paket için raf atamalarını al
      for (const pkg of packages) {
        const assignments = await all(`
          SELECT sa.*, s.shelf_code, s.shelf_name, s.zone, s.aisle, s.level
          FROM shelf_assignments sa
          JOIN shelves s ON sa.shelf_id = s.id
          WHERE sa.package_id = ? AND sa.quantity > 0
          ORDER BY sa.assigned_date ASC
        `, [pkg.id]);
        console.log(`🏠 Package ${pkg.id} (${pkg.barcode}) assignments:`, assignments);
      }
    }
    
    res.json({ product, packages: product ? await all('SELECT * FROM product_packages WHERE product_id = ?', [product.id]) : [] });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});



// ==== SSH SERVICE API ENDPOINTS ====

// Get all service requests
app.get('/api/service-requests', async (req, res) => {
  try {
    const requests = await all(`
      SELECT sr.*, p.name as product_name, p.sku as product_sku,
             pp.package_number, pp.package_name, pp.barcode as package_barcode
      FROM service_requests sr
      LEFT JOIN products p ON sr.product_id = p.id
      LEFT JOIN product_packages pp ON sr.package_id = pp.id
      ORDER BY sr.created_date DESC
    `);
    
    res.json({ success: true, requests });
  } catch (error) {
    console.error('❌ Service requests fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create new service request
app.post('/api/service-requests', async (req, res) => {
  try {
    const {
      customer_name, customer_phone, customer_email, order_number,
      product_id, product_name, product_sku, issue_description,
      required_part, required_quantity, priority, package_id, package_name, package_barcode
    } = req.body;

    if (!customer_name || !product_id || !issue_description) {
      return res.status(400).json({ 
        success: false, 
        error: 'Müşteri adı, ürün ID ve sorun açıklaması gereklidir' 
      });
    }

    const result = await run(`
      INSERT INTO service_requests (
        customer_name, customer_phone, customer_email, order_number,
        product_id, product_name, product_sku, issue_description,
        required_part, required_quantity, priority, package_id, package_name, package_barcode, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      customer_name, customer_phone, customer_email, order_number,
      product_id, product_name, product_sku, issue_description,
      required_part, required_quantity || 1, priority || 'normal', package_id, package_name, package_barcode, 'new'
    ]);

    // Log service movement
    await run(`
      INSERT INTO service_movements (
        service_request_id, movement_type, description, new_status
      ) VALUES (?, ?, ?, ?)
    `, [
      result.lastID, 'status_change', 
      'Servis talebi oluşturuldu', 'pending'
    ]);

    const newRequest = await get(`
      SELECT sr.*, p.name as product_name, p.sku as product_sku
      FROM service_requests sr
      LEFT JOIN products p ON sr.product_id = p.id
      WHERE sr.id = ?
    `, [result.lastID]);

    res.json({ success: true, id: result.lastID, service_request: newRequest });
  } catch (error) {
    console.error('❌ Service request creation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update service request status
app.put('/api/service-requests/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body;

    if (!status) {
      return res.status(400).json({ 
        success: false, 
        error: 'Yeni durum gereklidir' 
      });
    }

    // Get current request
    const currentRequest = await get(`
      SELECT * FROM service_requests WHERE id = ?
    `, [id]);

    if (!currentRequest) {
      return res.status(404).json({ 
        success: false, 
        error: 'Servis talebi bulunamadı' 
      });
    }

    // Update status
    const updateData = [status, new Date().toISOString(), id];
    if (status === 'completed') {
      await run(`
        UPDATE service_requests 
        SET status = ?, completed_date = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, updateData);
    } else {
      await run(`
        UPDATE service_requests 
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [status, new Date().toISOString(), id]);
    }

    // Log service movement
    await run(`
      INSERT INTO service_movements (
        service_request_id, movement_type, description, 
        previous_status, new_status
      ) VALUES (?, ?, ?, ?, ?)
    `, [
      id, 'status_change', 
      note || `Durum güncellendi: ${currentRequest.status} → ${status}`,
      currentRequest.status, status
    ]);

    res.json({ success: true, message: 'Durum başarıyla güncellendi' });
  } catch (error) {
    console.error('❌ Status update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get service request movements/history
app.get('/api/service-requests/:id/movements', async (req, res) => {
  try {
    const { id } = req.params;
    
    const movements = await all(`
      SELECT * FROM service_movements 
      WHERE service_request_id = ? 
      ORDER BY created_date DESC
    `, [id]);
    
    res.json({ success: true, movements });
  } catch (error) {
    console.error('❌ Service movements fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==== PACKAGE OPENING API ENDPOINTS ====

// Get package location
app.get('/api/packages/:id/location', async (req, res) => {
  try {
    const packageId = req.params.id;
    
    // Get actual shelf assignment from shelf_packages table (exclude SSH virtual areas)
    const shelfAssignment = await get(`
      SELECT s.shelf_code as location_code, s.shelf_name as location_name
      FROM shelf_packages sp
      JOIN shelves s ON sp.shelf_id = s.id
      WHERE sp.package_id = ? AND sp.quantity > 0 AND s.shelf_code NOT LIKE 'SSH-%'
      ORDER BY sp.last_updated DESC
      LIMIT 1
    `, [packageId]);
    
    console.log('📦 Package shelf assignment:', shelfAssignment);
    
    if (shelfAssignment) {
      res.json({
        success: true,
        location_code: shelfAssignment.location_code,
        location_name: shelfAssignment.location_name
      });
    } else {
      res.json({
        success: false,
        error: 'Paket lokasyonu bulunamadı'
      });
    }
  } catch (error) {
    console.error('❌ Package location error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create package opening record
app.post('/api/package-openings', async (req, res) => {
  try {
    const {
      service_request_id, package_id, original_package_barcode,
      opened_quantity, used_quantity, ssh_quantity, source_location, 
      opening_method, opened_by, notes
    } = req.body;

    if (!service_request_id || !package_id || !opened_quantity || !used_quantity) {
      return res.status(400).json({ 
        success: false, 
        error: 'Servis talebi ID, paket ID, açılan miktar ve kullanılan miktar gereklidir' 
      });
    }

    // Create package opening record
    const result = await run(`
      INSERT INTO package_openings (
        service_request_id, package_id, original_package_barcode,
        opened_quantity, used_quantity, ssh_quantity, source_location, opening_method, opened_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      service_request_id, package_id, original_package_barcode,
      opened_quantity, used_quantity, ssh_quantity || 0, source_location, opening_method || 'partial', opened_by, notes
    ]);
    
    // Handle transfer based on opening method
    if (source_location && opening_method !== 'ssh_used') {
      if (opening_method === 'complete') {
        // Complete transfer - remove entire package from shelf
        await run(`
          UPDATE shelf_packages 
          SET quantity = 0
          WHERE package_id = ? AND shelf_id = (SELECT id FROM shelves WHERE shelf_code = ?)
        `, [package_id, source_location]);
        
        // No SSH storage for complete transfer
      } else {
        // Partial opening - move used quantity to service, remainder to SSH
        await run(`
          UPDATE shelf_packages 
          SET quantity = quantity - ?
          WHERE package_id = ? AND shelf_id = (SELECT id FROM shelves WHERE shelf_code = ?) 
          AND quantity >= ?
        `, [used_quantity, package_id, source_location, used_quantity]);
        
        // Add SSH area location if not exists
        await run(`
          INSERT OR IGNORE INTO locations (code, name) 
          VALUES ('SSH-01-01', 'SSH Saklama Alanı')
        `);
        
        // Move remainder to SSH if any
        if (ssh_quantity > 0) {
          // Add SSH shelf if not exists
          await run(`
            INSERT OR IGNORE INTO shelves (shelf_code, shelf_name, zone) 
            VALUES ('SSH-01-01', 'SSH Saklama Alanı', 'SSH')
          `);
          
          // Add to SSH shelf_packages for physical tracking
          await run(`
            INSERT INTO shelf_packages (shelf_id, package_id, product_id, quantity, assigned_by)
            SELECT s.id, ?, pp.product_id, ?, ?
            FROM shelves s, product_packages pp
            WHERE s.shelf_code = 'SSH-01-01' AND pp.id = ?
            ON CONFLICT(shelf_id, package_id) DO UPDATE SET
            quantity = quantity + ?
          `, [package_id, ssh_quantity, 'SSH Transfer', package_id, ssh_quantity]);
          
          // Also add to product_locations for overall inventory
          await run(`
            INSERT INTO product_locations (product_id, location_id, on_hand)
            SELECT pp.product_id, l.id, ?
            FROM product_packages pp, locations l
            WHERE pp.id = ? AND l.code = 'SSH-01-01'
            ON CONFLICT(product_id, location_id) DO UPDATE SET
            on_hand = on_hand + ?
          `, [ssh_quantity, package_id, ssh_quantity]);
        }
      }
    }

    // Update service request status to processing (valid status)
    await run(`
      UPDATE service_requests 
      SET status = 'processing', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [service_request_id]);

    // Log service movement
    await run(`
      INSERT INTO service_movements (
        service_request_id, movement_type, description, 
        quantity, new_status
      ) VALUES (?, ?, ?, ?, ?)
    `, [
      service_request_id, 'package_opened', 
      `Paket açıldı: ${used_quantity} adet servise, ${ssh_quantity || 0} adet SSH'ye`,
      used_quantity, 'processing'
    ]);

    // Add to SSH inventory only for partial opening with remainder
    if (ssh_quantity > 0 && opening_method === 'partial') {
      // Get service request details for SSH inventory
      const serviceRequest = await get(`
        SELECT sr.*, p.name as product_name 
        FROM service_requests sr
        LEFT JOIN products p ON sr.product_id = p.id
        WHERE sr.id = ?
      `, [service_request_id]);

      await run(`
        INSERT INTO ssh_inventory (
          product_id, part_name, quantity, location_code, source_package_barcode,
          source_opening_id
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        serviceRequest.product_id, 
        `${serviceRequest.required_part} (${used_quantity} adet alındı)`, 
        ssh_quantity, 'SSH-01-01', original_package_barcode, result.lastID
      ]);
    }
    
    // Handle SSH usage tracking
    if (opening_method === 'ssh_used') {
      // Get service request details
      const serviceRequest = await get(`
        SELECT * FROM service_requests WHERE id = ?
      `, [service_request_id]);
      
      // Mark an SSH inventory item as used for this service request
      await run(`
        UPDATE ssh_inventory 
        SET is_available = 0, last_used_date = CURRENT_TIMESTAMP
        WHERE product_id = ? AND part_name LIKE ? AND is_available = 1
        ORDER BY created_date ASC
        LIMIT 1
      `, [serviceRequest.product_id, `%${serviceRequest.required_part}%`]);
    }

    res.json({ success: true, id: result.lastID, message: 'Paket açma işlemi tamamlandı' });
  } catch (error) {
    console.error('❌ Package opening creation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get package openings
app.get('/api/package-openings', async (req, res) => {
  try {
    const openings = await all(`
      SELECT po.*, sr.customer_name, p.name as product_name, pp.package_number
      FROM package_openings po
      LEFT JOIN service_requests sr ON po.service_request_id = sr.id
      LEFT JOIN products p ON sr.product_id = p.id
      LEFT JOIN product_packages pp ON po.package_id = pp.id
      ORDER BY po.opened_date DESC
      LIMIT 20
    `);
    
    res.json({ success: true, openings });
  } catch (error) {
    console.error('❌ Package openings fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get product packages by product ID
app.get('/api/products/:id/packages', async (req, res) => {
  try {
    const { id } = req.params;
    
    const packages = await all(`
      SELECT pp.*, 
             sp.shelf_id,
             s.shelf_code,
             s.shelf_name,
             sp.quantity as shelf_quantity
      FROM product_packages pp
      LEFT JOIN shelf_packages sp ON pp.id = sp.package_id AND sp.quantity > 0
      LEFT JOIN shelves s ON sp.shelf_id = s.id
      WHERE pp.product_id = ?
      ORDER BY pp.package_number
    `, [id]);
    
    res.json({ success: true, packages });
  } catch (error) {
    console.error('❌ Product packages fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update service request status
app.put('/api/service-requests/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    
    if (!status) {
      return res.status(400).json({ 
        success: false, 
        error: 'Durum gereklidir' 
      });
    }
    
    // Update service request
    await run(`
      UPDATE service_requests 
      SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, notes, id]);
    
    // Log service movement
    await run(`
      INSERT INTO service_movements (
        service_request_id, movement_type, description, new_status
      ) VALUES (?, ?, ?, ?)
    `, [
      id, 'status_change', 
      notes || `Durum değiştirildi: ${status}`,
      status
    ]);
    
    res.json({ success: true, message: 'Servis durumu güncellendi' });
  } catch (error) {
    console.error('❌ Service status update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- SSH Inventory Management ----

// Get SSH inventory
app.get('/api/ssh-inventory', async (req, res) => {
  try {
    const inventory = await all(`
      SELECT si.*, p.name as product_name, p.sku as product_sku, pp.package_number
      FROM ssh_inventory si
      LEFT JOIN products p ON si.product_id = p.id
      LEFT JOIN product_packages pp ON pp.barcode = si.source_package_barcode
      WHERE si.is_available = 1
      GROUP BY si.id
      ORDER BY si.created_date DESC
    `);
    
    res.json({ success: true, inventory });
  } catch (error) {
    console.error('❌ SSH inventory fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get SSH inventory statistics
app.get('/api/ssh-inventory/stats', async (req, res) => {
  try {
    const stats = await get(`
      SELECT 
        COUNT(*) as total_parts,
        SUM(quantity) as total_quantity,
        COUNT(CASE WHEN is_available = 1 THEN 1 END) as available_parts,
        COUNT(CASE WHEN created_date >= date('now', '-7 days') THEN 1 END) as recent_transfers
      FROM ssh_inventory
    `);
    
    res.json({ success: true, stats: stats || {} });
  } catch (error) {
    console.error('❌ SSH stats fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// SSH transfer operations
app.post('/api/ssh-transfer', async (req, res) => {
  try {
    const { inventory_id, transfer_type, transfer_quantity, notes } = req.body;
    
    if (!inventory_id || !transfer_type) {
      return res.status(400).json({ 
        success: false, 
        error: 'Envanter ID ve transfer tipi gereklidir' 
      });
    }
    
    // Get inventory item
    const item = await get(`
      SELECT * FROM ssh_inventory WHERE id = ? AND is_available = 1
    `, [inventory_id]);
    
    if (!item) {
      return res.status(404).json({ 
        success: false, 
        error: 'Kullanılabilir envanter kalemi bulunamadı' 
      });
    }
    
    const transferQty = transfer_quantity || item.quantity;
    
    if (transferQty > item.quantity) {
      return res.status(400).json({ 
        success: false, 
        error: 'Transfer miktarı mevcut stoktan fazla' 
      });
    }
    
    // Update inventory
    if (transferQty === item.quantity) {
      // Full transfer - mark as used
      await run(`
        UPDATE ssh_inventory 
        SET is_available = 0, last_used_date = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [inventory_id]);
    } else {
      // Partial transfer - reduce quantity
      await run(`
        UPDATE ssh_inventory 
        SET quantity = quantity - ?
        WHERE id = ?
      `, [transferQty, inventory_id]);
    }
    
    res.json({ 
      success: true, 
      message: `${transferQty} adet ${item.part_name} servise transfer edildi`,
      transferred_quantity: transferQty
    });
  } catch (error) {
    console.error('❌ SSH transfer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// SSH inventory empty/delete operation
app.delete('/api/ssh-inventory/:id/empty', async (req, res) => {
  try {
    const inventoryId = req.params.id;
    
    // Get inventory item before deletion
    const item = await get(`
      SELECT * FROM ssh_inventory WHERE id = ? AND is_available = 1
    `, [inventoryId]);
    
    if (!item) {
      return res.status(404).json({ 
        success: false, 
        error: 'SSH envanter kalemi bulunamadı' 
      });
    }
    
    // Remove from SSH inventory
    await run(`
      DELETE FROM ssh_inventory WHERE id = ?
    `, [inventoryId]);
    
    // Also remove from shelf_packages if it exists
    await run(`
      DELETE FROM shelf_packages 
      WHERE shelf_id = (SELECT id FROM shelves WHERE shelf_code = 'SSH-01-01') 
      AND package_id IN (
        SELECT id FROM product_packages WHERE barcode = ?
      )
    `, [item.source_package_barcode]);
    
    res.json({ 
      success: true, 
      message: `${item.part_name} SSH envanterinden kaldırıldı`,
      removed_item: item
    });
  } catch (error) {
    console.error('❌ SSH inventory delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update SSH inventory notes
app.put('/api/ssh-inventory/:id/notes', async (req, res) => {
  try {
    const inventoryId = req.params.id;
    const { notes } = req.body;
    
    // Update notes
    await run(`
      UPDATE ssh_inventory 
      SET notes = ?
      WHERE id = ?
    `, [notes || null, inventoryId]);
    
    res.json({ 
      success: true, 
      message: 'Notlar güncellendi'
    });
  } catch (error) {
    console.error('❌ SSH inventory notes update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- NETSIS Integration API Endpoints ----

// Netsis siparişlerini al ve veritabanına kaydet
app.post('/api/netsis/orders', async (req, res) => {
  try {
    console.log('Netsis orders received:', JSON.stringify(req.body, null, 2));
    
    const { exportedAt, count, orders } = req.body;
    
    if (!orders || !Array.isArray(orders)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid orders data' 
      });
    }

    let processedCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const order of orders) {
      try {
        // Sipariş kaydını kontrol et
        const existingOrder = await get(`
          SELECT id FROM netsis_orders 
          WHERE sube_kodu = ? AND ftirsip = ? AND siparis_no = ?
        `, [order.subeKodu, order.ftirsip, order.siparisNo]);

        let orderDbId;

        if (existingOrder) {
          // Güncelle
          await run(`
            UPDATE netsis_orders SET
              cari_kodu = ?, siparis_tarihi = ?, toplam_tutar = ?,
              kdv_tutar = ?, kdv_dahil_mi = ?, kayit_tarihi = ?,
              sync_tarihi = CURRENT_TIMESTAMP, sync_status = 'updated'
            WHERE id = ?
          `, [
            order.cariKodu, order.siparisTarihi, order.toplamTutar,
            order.kdvTutar, order.kdvDahilMi ? 1 : 0, order.kayitTarihi || exportedAt,
            existingOrder.id
          ]);
          orderDbId = existingOrder.id;

          // Mevcut satırları sil
          await run('DELETE FROM netsis_order_lines WHERE netsis_order_id = ?', [orderDbId]);
        } else {
          // Yeni kayıt
          const result = await run(`
            INSERT INTO netsis_orders (
              sube_kodu, ftirsip, siparis_no, cari_kodu, siparis_tarihi,
              toplam_tutar, kdv_tutar, kdv_dahil_mi, kayit_tarihi, sync_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
          `, [
            order.subeKodu, order.ftirsip, order.siparisNo, order.cariKodu, 
            order.siparisTarihi, order.toplamTutar, order.kdvTutar, 
            order.kdvDahilMi ? 1 : 0, order.kayitTarihi || exportedAt
          ]);
          orderDbId = result.lastID;
        }

        // Satırları ekle
        if (order.satirlar && Array.isArray(order.satirlar)) {
          for (const line of order.satirlar) {
            await run(`
              INSERT INTO netsis_order_lines (
                netsis_order_id, sube_kodu, ftirsip, siparis_no,
                stok_kodu, aciklama, miktar, birim, birim_fiyat,
                kdv_orani, depo_kodu, satir_sira
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              orderDbId, order.subeKodu, order.ftirsip, order.siparisNo,
              line.stokKodu, line.aciklama, line.miktar, line.birim,
              line.birimFiyat, line.kdvOrani, line.depoKodu, line.sira
            ]);
          }
        }

        processedCount++;
      } catch (orderError) {
        console.error('Error processing order:', order.siparisNo, orderError);
        errors.push({
          orderNo: order.siparisNo,
          error: orderError.message
        });
        errorCount++;
      }
    }

    res.json({
      success: true,
      message: `${processedCount} sipariş işlendi, ${errorCount} hata`,
      stats: {
        processed: processedCount,
        errors: errorCount,
        total: orders.length
      },
      errors: errors
    });

  } catch (error) {
    console.error('Netsis orders import error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Netsis siparişlerini listele
app.get('/api/netsis/orders', async (req, res) => {
  try {
    const { page = 1, limit = 50, status = 'all' } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '';
    let params = [];

    if (status !== 'all') {
      whereClause = 'WHERE sync_status = ?';
      params = [status];
    }

    const orders = await all(`
      SELECT no.*, COUNT(nol.id) as line_count
      FROM netsis_orders no
      LEFT JOIN netsis_order_lines nol ON no.id = nol.netsis_order_id
      ${whereClause}
      GROUP BY no.id
      ORDER BY no.sync_tarihi DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), parseInt(offset)]);

    const totalCount = await get(`
      SELECT COUNT(*) as total FROM netsis_orders ${whereClause}
    `, params);

    res.json({
      success: true,
      orders: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount.total,
        pages: Math.ceil(totalCount.total / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching netsis orders:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Netsis siparişi detayları
app.get('/api/netsis/orders/:id', requireAuth, async (req, res) => {
  try {
    const orderId = req.params.id;

    const order = await get(`
      SELECT * FROM netsis_orders WHERE id = ?
    `, [orderId]);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Sipariş bulunamadı'
      });
    }

    const lines = await all(`
      SELECT * FROM netsis_order_lines 
      WHERE netsis_order_id = ?
      ORDER BY satir_sira
    `, [orderId]);

    order.lines = lines;

    res.json({
      success: true,
      order: order
    });

  } catch (error) {
    console.error('Error fetching netsis order details:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function - sipariş numarası oluştur
async function generateOrderNumber() {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  
  const lastOrder = await get(`
    SELECT order_number FROM orders 
    WHERE order_number LIKE ? 
    ORDER BY order_number DESC LIMIT 1
  `, [`${dateStr}%`]);
  
  let sequence = 1;
  if (lastOrder) {
    const lastSequence = parseInt(lastOrder.order_number.slice(-4));
    sequence = lastSequence + 1;
  }
  
  return `${dateStr}${sequence.toString().padStart(4, '0')}`;
}

// External orders integration endpoint
app.post('/api/external-orders/integrate', requireAuth, async (req, res) => {
  try {
    const { external_order, source } = req.body;
    
    if (!external_order || !external_order.id) {
      return res.status(400).json({
        success: false,
        error: 'Geçersiz harici sipariş verisi'
      });
    }

    console.log('🔄 External order integration started:', external_order.id);

    // Create order in WMS system
    const orderNumber = await generateOrderNumber();
    
    const orderId = await run(`
      INSERT INTO orders (
        order_number, customer_name, status, fulfillment_status,
        total_amount, external_id, external_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      orderNumber,
      external_order.customer_code || external_order.customer_name,
      'open',
      'UNFULFILLED', 
      external_order.total_amount || 0,
      external_order.id,
      source || 'external_api'
    ]);

    // Create order items and product packages for WMS picking system
    if (external_order.items && external_order.items.length > 0) {
      for (const item of external_order.items) {
        // Check if product exists, if not create it
        let product = await get(`SELECT id FROM products WHERE sku = ?`, [item.product_sku]);
        
        if (!product) {
          // Create product
          const productId = await run(`
            INSERT INTO products (sku, name, description)
            VALUES (?, ?, ?)
          `, [
            item.product_sku,
            item.product_name || item.product_sku,
            item.description || ''
          ]);
          product = { id: productId };
        }

        // Create order item
        await run(`
          INSERT INTO order_items (
            order_id, product_id, sku, product_name, quantity
          ) VALUES (?, ?, ?, ?, ?)
        `, [
          orderId,
          product.id,
          item.product_sku,
          item.product_name || item.product_sku,
          item.quantity || 1
        ]);

        // Create product package for picking if it doesn't exist
        const packageBarcode = `PK-${item.product_sku}-01`;
        let productPackage = await get(`
          SELECT id FROM product_packages 
          WHERE product_id = ? AND barcode = ?
        `, [product.id, packageBarcode]);

        if (!productPackage) {
          // Create product package
          await run(`
            INSERT INTO product_packages (
              product_id, package_number, product_name, package_name, 
              barcode, quantity, contents
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [
            product.id,
            `PK-${item.product_sku}`,
            item.product_name || item.product_sku,
            `${item.product_name || item.product_sku} Paketi`,
            packageBarcode,
            1, // Her paket 1 adet ürün içeriyor
            `1 adet ${item.product_name || item.product_sku}`
          ]);
          
          console.log(`✅ Created package for SKU: ${item.product_sku} with barcode: ${packageBarcode}`);
        }

        // Create shelf assignment if package needs location
        const shelfAssignment = await get(`
          SELECT * FROM shelf_packages WHERE product_id = ? AND package_barcode = ?
        `, [product.id, packageBarcode]);

        if (!shelfAssignment) {
          // Assign to a default shelf location
          const defaultShelf = await get(`SELECT id FROM shelves WHERE name = 'A1-01-001' LIMIT 1`);
          if (defaultShelf) {
            await run(`
              INSERT INTO shelf_packages (
                shelf_id, product_id, package_barcode, 
                package_name, quantity_available
              ) VALUES (?, ?, ?, ?, ?)
            `, [
              defaultShelf.id,
              product.id,
              packageBarcode,
              `${item.product_name || item.product_sku} Paketi`,
              100 // Default stok miktarı
            ]);
            
            console.log(`✅ Assigned package ${packageBarcode} to shelf A1-01-001`);
          }
        }
      }
    }

    // Create pick for the order
    const pickId = await run(`
      INSERT INTO picks (order_id, status)
      VALUES (?, ?)
    `, [orderId, 'active']);

    console.log('✅ External order integrated successfully:', {
      external_id: external_order.id,
      wms_order_id: orderId,
      pick_id: pickId,
      order_number: orderNumber
    });

    res.json({
      success: true,
      wms_order_id: orderId,
      pick_id: pickId,
      order_number: orderNumber,
      message: 'Harici sipariş WMS sistemine entegre edildi'
    });

  } catch (error) {
    console.error('❌ External order integration error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Complete external order with NetOpenXRest integration
app.post('/api/external-orders/:id/complete', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { picked_items } = req.body;

    console.log('🔄 Completing external order:', id);

    // Find the WMS order
    const order = await get(`
      SELECT * FROM orders 
      WHERE external_id = ? AND external_source LIKE '%external%'
    `, [id]);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Harici sipariş bulunamadı'
      });
    }

    // Update order status
    await run(`
      UPDATE orders 
      SET status = 'fulfilled', fulfillment_status = 'FULFILLED', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [order.id]);

    // Update pick status
    await run(`
      UPDATE picks 
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP
      WHERE order_id = ?
    `, [order.id]);

    console.log('✅ Order status updated, starting NetOpenXRest integration...');

    // NetOpenXRest integration
    try {
      const netsisResult = await netsisAPI.convertOrderToDeliveryNote({
        order_number: id,
        customer_code: order.customer_name,
        items: picked_items || [],
        total_amount: order.total_amount
      });

      if (netsisResult.success) {
        console.log('✅ NetOpenXRest integration successful:', netsisResult);
        
        // Store delivery note info
        await run(`
          UPDATE orders 
          SET netsis_delivery_note = ?, netsis_integration_status = 'completed'
          WHERE id = ?
        `, [JSON.stringify(netsisResult.delivery_note), order.id]);

        res.json({
          success: true,
          message: 'Sipariş tamamlandı ve Netsis\'te irsaliyeye çevrildi',
          wms_order_id: order.id,
          netsis_delivery_note: netsisResult.delivery_note
        });
      } else {
        console.warn('⚠️ NetOpenXRest integration failed:', netsisResult.message);
        
        await run(`
          UPDATE orders 
          SET netsis_integration_status = 'failed', netsis_error = ?
          WHERE id = ?
        `, [netsisResult.message, order.id]);

        res.json({
          success: true,
          message: 'Sipariş WMS\'de tamamlandı, ancak Netsis entegrasyonu başarısız',
          wms_order_id: order.id,
          netsis_error: netsisResult.message
        });
      }
    } catch (netsisError) {
      console.error('❌ NetOpenXRest integration error:', netsisError);
      
      await run(`
        UPDATE orders 
        SET netsis_integration_status = 'failed', netsis_error = ?
        WHERE id = ?
      `, [netsisError.message, order.id]);

      res.json({
        success: true,
        message: 'Sipariş WMS\'de tamamlandı, ancak Netsis entegrasyonu başarısız',
        wms_order_id: order.id,
        netsis_error: netsisError.message
      });
    }

  } catch (error) {
    console.error('❌ External order completion error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ---- ORDERS RESET ENDPOINT ----
// Reset completed orders and dispatch records for testing
app.post('/api/admin/reset-orders', requireRole(['admin']), async (req, res) => {
  try {
    console.log('🔄 Resetting orders and dispatch records...');
    
    // 1. Clear dispatch note fields
    await run(`
      UPDATE orders SET 
        netsis_delivery_note_id = NULL,
        netsis_delivery_status = NULL,
        netsis_delivery_data = NULL,
        netsis_delivery_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    `);
    
    // 2. Reset fulfilled orders to open status
    const resetResult = await run(`
      UPDATE orders SET 
        status = 'open',
        fulfillment_status = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE status = 'fulfilled' OR fulfillment_status = 'FULFILLED'
    `);
    
    // 3. Clear completed picks
    let picksClearedCount = 0;
    try {
      const picksResult = await run('DELETE FROM picks WHERE status = "completed"');
      picksClearedCount = picksResult.changes || 0;
    } catch (error) {
      console.log('ℹ️ Pick tablosu bulunamadı, atlandı');
    }
    
    // 4. Clear pick scans
    let scansClearedCount = 0;
    try {
      const scansResult = await run('DELETE FROM pick_scans');
      scansClearedCount = scansResult.changes || 0;
    } catch (error) {
      console.log('ℹ️ Pick scans tablosu bulunamadı, atlandı');
    }
    
    // Get final stats
    const stats = await get(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_orders,
        SUM(CASE WHEN status = 'fulfilled' THEN 1 ELSE 0 END) as fulfilled_orders,
        SUM(CASE WHEN netsis_delivery_note_id IS NOT NULL THEN 1 ELSE 0 END) as with_dispatch
      FROM orders
    `);
    
    console.log('✅ Orders reset completed successfully');
    
    res.json({
      success: true,
      message: 'Orders and dispatch records reset successfully',
      stats: {
        total_orders: stats.total_orders,
        open_orders: stats.open_orders,
        fulfilled_orders: stats.fulfilled_orders,
        with_dispatch: stats.with_dispatch,
        orders_reset: resetResult.changes || 0,
        picks_cleared: picksClearedCount,
        scans_cleared: scansClearedCount
      }
    });
    
  } catch (error) {
    console.error('❌ Orders reset error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset orders',
      details: error.message
    });
  }
});

// ---- SIMULATE ORDER COMPLETION FOR TESTING ----
app.post('/api/admin/simulate-order-completion', requireRole(['admin']), async (req, res) => {
  try {
    const { order_id } = req.body;
    
    if (!order_id) {
      return res.status(400).json({ success: false, error: 'order_id required' });
    }
    
    console.log(`🔧 Simulating completion for order ID: ${order_id}`);
    
    // Update order status
    await run(`
      UPDATE orders 
      SET status = 'fulfilled', fulfillment_status = 'FULFILLED' 
      WHERE id = ?
    `, [order_id]);
    
    // Update all order items to picked
    const orderItems = await all(`
      SELECT id, quantity FROM order_items WHERE order_id = ?
    `, [order_id]);
    
    for (const item of orderItems) {
      await run(`
        UPDATE order_items 
        SET picked_qty = quantity 
        WHERE id = ?
      `, [item.id]);
    }
    
    console.log(`✅ Order ${order_id} marked as completed with all items picked`);
    
    res.json({
      success: true,
      message: `Order ${order_id} simulated as completed`,
      items_updated: orderItems.length
    });
    
  } catch (error) {
    console.error('❌ Simulate completion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to simulate completion',
      details: error.message
    });
  }
});

// Network erişimi için tüm interface'lerde dinle
app.listen(PORT, '0.0.0.0', async () => {
  // Initialize database and users
  await initDatabase();
  
  // RAILWAY DEBUG: Environment check
  console.log('🚨 RAILWAY DEBUG: Server startup environment check:', {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    NETSIS_API_URL: process.env.NETSIS_API_URL || 'MISSING',
    NETSIS_USERNAME: process.env.NETSIS_USERNAME || 'MISSING',
    NETSIS_PASSWORD: process.env.NETSIS_PASSWORD ? 'PRESENT' : 'MISSING',
    NETSIS_DB_NAME: process.env.NETSIS_DB_NAME || 'MISSING',
    timestamp: new Date().toISOString()
  });

  // Test Netsis connection on startup
  console.log('🔄 RAILWAY DEBUG: Starting Netsis connection test...');
  
  let connectionTest = null;
  try {
    connectionTest = await netsisAPI.testConnection();
    console.log('🚨 RAILWAY DEBUG: testConnection returned:', {
      success: connectionTest?.success,
      message: connectionTest?.message,
      type: typeof connectionTest,
      keys: connectionTest ? Object.keys(connectionTest).join(',') : 'null'
    });
  } catch (testError) {
    console.log('🚨 RAILWAY DEBUG: testConnection threw error:', {
      message: testError?.message || 'undefined message',
      type: typeof testError,
      constructor: testError?.constructor?.name || 'unknown',
      stack: testError?.stack?.substring(0, 200) || 'no stack'
    });
    connectionTest = { success: false, message: testError?.message || 'Test connection threw undefined error' };
  }
  
  if (connectionTest?.success) {
    console.log('✅ Netsis entegrasyonu aktif');
  } else {
    console.log('⚠️ Netsis bağlantısı başarısız, uygulama yerel modda çalışacak');
    console.log('   Hata:', connectionTest?.message || 'Undefined connection test error');
    
    if (connectionTest?.railwayOfflineMode) {
      console.log('');
      console.log('🚂 RAILWAY HOSTING PLATFORM TESPIT EDİLDİ');
      console.log('📡 Dış network bağlantıları Railway tarafından engelleniyor');
      console.log('💡 ÇÖZÜMLERİ:');
      console.log('   1. Railway Pro hesabına geçin (external network access)');
      console.log('   2. VPS hosting kullanın (DigitalOcean, Linode, AWS)'); 
      console.log('   3. Netsis sunucusunu public IP\'ye açın');
      console.log('   4. VPN/proxy service kullanın');
      console.log('');
      console.log('🔄 Şimdilik WMS yerel veritabanı ile çalışacak');
    }
  }
  
  // Add color column to products table if not exists
  try {
    await run(`ALTER TABLE products ADD COLUMN color TEXT DEFAULT NULL`);
    console.log('✅ Color column added to products table');
  } catch (e) {
    // Column might already exist
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Color column already exists in products table');
    }
  }

  // Add netsis_data column to products table if not exists  
  try {
    await run(`ALTER TABLE products ADD COLUMN netsis_data TEXT DEFAULT NULL`);
    console.log('✅ Netsis_data column added to products table');
  } catch (e) {
    // Column might already exist
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Netsis_data column already exists in products table');
    }
  }

  // Add external order tracking columns to orders table
  try {
    await run(`ALTER TABLE orders ADD COLUMN external_id TEXT DEFAULT NULL`);
    console.log('✅ External_id column added to orders table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ External_id column already exists in orders table');
    }
  }

  try {
    await run(`ALTER TABLE orders ADD COLUMN external_source TEXT DEFAULT NULL`);
    console.log('✅ External_source column added to orders table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ External_source column already exists in orders table');
    }
  }

  try {
    await run(`ALTER TABLE orders ADD COLUMN netsis_delivery_note TEXT DEFAULT NULL`);
    console.log('✅ Netsis_delivery_note column added to orders table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Netsis_delivery_note column already exists in orders table');
    }
  }

  try {
    await run(`ALTER TABLE orders ADD COLUMN netsis_integration_status TEXT DEFAULT NULL`);
    console.log('✅ Netsis_integration_status column added to orders table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Netsis_integration_status column already exists in orders table');
    }
  }

  try {
    await run(`ALTER TABLE orders ADD COLUMN netsis_error TEXT DEFAULT NULL`);
    console.log('✅ Netsis_error column added to orders table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Netsis_error column already exists in orders table');
    }
  }
  
  // Create SSH service tables if not exists
  try {
    await run(`
      CREATE TABLE IF NOT EXISTS service_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        customer_phone TEXT,
        customer_email TEXT,
        order_number TEXT,
        product_id INTEGER NOT NULL REFERENCES products(id),
        product_name TEXT NOT NULL,
        product_sku TEXT NOT NULL,
        package_id INTEGER REFERENCES product_packages(id),
        package_name TEXT,
        package_barcode TEXT,
        issue_description TEXT NOT NULL,
        required_part TEXT NOT NULL,
        priority TEXT NOT NULL CHECK(priority IN ('urgent', 'high', 'normal', 'low')),
        status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'processing', 'waiting_parts', 'completed', 'cancelled')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Service requests table created');
  } catch (e) {
    console.log('ℹ️ Service requests table already exists');
  }

  // Create inventory counts tables
  try {
    await run(`
      CREATE TABLE IF NOT EXISTS inventory_counts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('full', 'spot', 'shelf')),
        name TEXT NOT NULL,
        description TEXT,
        product_filter TEXT,
        shelf_filter TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_date DATETIME,
        created_by TEXT DEFAULT 'system',
        counted_items INTEGER DEFAULT 0,
        variance_items INTEGER DEFAULT 0,
        total_variance REAL DEFAULT 0
      )
    `);
    console.log('✅ Inventory counts table created');
  } catch (e) {
    console.log('ℹ️ Inventory counts table already exists');
  }

  try {
    await run(`
      CREATE TABLE IF NOT EXISTS inventory_count_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        count_id INTEGER NOT NULL REFERENCES inventory_counts(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        product_name TEXT NOT NULL,
        sku TEXT NOT NULL,
        barcode TEXT,
        location_code TEXT NOT NULL,
        expected_quantity INTEGER NOT NULL DEFAULT 0,
        counted_quantity INTEGER,
        variance INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'counted', 'skipped')),
        notes TEXT,
        scanned_date DATETIME
      )
    `);
    console.log('✅ Inventory count items table created');
  } catch (e) {
    console.log('ℹ️ Inventory count items table already exists');
  }

  // Shelf packages table - Raf paket atamaları için
  try {
    await run(`
      CREATE TABLE IF NOT EXISTS shelf_packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shelf_id INTEGER NOT NULL REFERENCES shelves(id),
        package_id INTEGER NOT NULL REFERENCES product_packages(id),
        quantity INTEGER NOT NULL DEFAULT 0,
        assigned_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(shelf_id, package_id)
      )
    `);
    console.log('✅ Shelf packages table created');
  } catch (e) {
    console.log('ℹ️ Shelf packages table already exists');
  }

  // Picks table - Pick işlemleri için
  try {
    await run(`
      CREATE TABLE IF NOT EXISTS picks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'partial', 'completed')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Picks table created');
  } catch (e) {
    console.log('ℹ️ Picks table already exists');
  }

  // Pick scans table - Pick scan kayıtları için
  try {
    await run(`
      CREATE TABLE IF NOT EXISTS pick_scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pick_id INTEGER NOT NULL REFERENCES picks(id),
        order_item_id INTEGER NOT NULL REFERENCES order_items(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        package_id INTEGER NOT NULL REFERENCES product_packages(id),
        barcode TEXT NOT NULL,
        scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Pick scans table created');
  } catch (e) {
    console.log('ℹ️ Pick scans table already exists');
  }

  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// ---- Inventory Count API Endpoints ----

// Create new inventory count
app.post('/api/inventory-counts', async (req, res) => {
  try {
    const { type, name, description, product_filter, shelf_filter } = req.body;
    
    if (!type || !name) {
      return res.status(400).json({ error: 'Type and name are required' });
    }
    
    // Create the count record
    const result = await run(`
      INSERT INTO inventory_counts (name, type, description, product_filter, shelf_filter)
      VALUES (?, ?, ?, ?, ?)
    `, [name, type, description, product_filter, shelf_filter]);
    
    const countId = result.lastID;
    
    // Generate count items based on type
    let items = [];
    
    if (type === 'full') {
      // Full count - DEMO VERSION: Only test products for performance
      items = await all(`
        SELECT 
          p.id as product_id,
          p.sku,
          p.name as product_name,
          p.main_barcode as barcode,
          COALESCE(pp.barcode, 'NO-PKG') as package_barcode,
          COALESCE(pp.package_number, 'NO-PKG') as package_number,
          COALESCE(s.shelf_code, 'NO-LOCATION') as location_code,
          COALESCE(s.id, 0) as shelf_id,
          COALESCE(sp.quantity, 0) as expected_quantity
        FROM products p
        LEFT JOIN product_packages pp ON p.id = pp.product_id
        LEFT JOIN shelf_packages sp ON pp.id = sp.package_id
        LEFT JOIN shelves s ON sp.shelf_id = s.id
        WHERE (s.shelf_code IS NULL OR s.shelf_code != 'SSH-01-01')
        AND p.sku IN ('ERZ-YT-K-BE-01-A1', 'CC-YT-S-BE-01')
        ORDER BY p.sku, COALESCE(s.shelf_code, 'ZZZ'), COALESCE(pp.barcode, 'ZZZ')
      `);
    } else if (type === 'spot') {
      // Spot count - specific product (excluding SSH-01-01)
      items = await all(`
        SELECT 
          p.id as product_id,
          p.sku,
          p.name as product_name,
          p.main_barcode as barcode,
          pp.barcode as package_barcode,
          pp.package_number,
          s.shelf_code as location_code,
          s.id as shelf_id,
          COALESCE(sp.quantity, 0) as expected_quantity
        FROM products p
        LEFT JOIN product_packages pp ON p.id = pp.product_id
        LEFT JOIN shelf_packages sp ON pp.id = sp.package_id
        LEFT JOIN shelves s ON sp.shelf_id = s.id
        WHERE (p.sku LIKE ? OR p.name LIKE ?)
        AND (s.shelf_code IS NULL OR s.shelf_code != 'SSH-01-01')
        ORDER BY s.shelf_code, p.sku
      `, [`%${product_filter}%`, `%${product_filter}%`]);
    } else if (type === 'shelf') {
      // Shelf count - specific shelf (excluding SSH-01-01)
      if (shelf_filter === 'SSH-01-01' || shelf_filter?.includes('SSH-01-01')) {
        return res.status(400).json({ error: 'SSH-01-01 rafı sayım kapsamında değildir. Bu alan servis stoğu olarak ayrılmıştır.' });
      }
      
      items = await all(`
        SELECT 
          p.id as product_id,
          p.sku,
          p.name as product_name,
          p.main_barcode as barcode,
          pp.barcode as package_barcode,
          pp.package_number,
          s.shelf_code as location_code,
          s.id as shelf_id,
          COALESCE(sp.quantity, 0) as expected_quantity
        FROM products p
        JOIN product_packages pp ON p.id = pp.product_id
        JOIN shelf_packages sp ON pp.id = sp.package_id
        JOIN shelves s ON sp.shelf_id = s.id
        WHERE s.shelf_code LIKE ? AND s.shelf_code != 'SSH-01-01'
        ORDER BY p.sku
      `, [`%${shelf_filter}%`]);
    } else if (type === 'manual') {
      // Manual count - empty count, items added by scanning
      items = [];
    }
    
    // Insert count items
    for (const item of items) {
      await run(`
        INSERT INTO inventory_count_items (
          count_id, product_id, sku, product_name, barcode, package_barcode, package_number,
          location_code, shelf_id, expected_quantity
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        countId, item.product_id, item.sku, item.product_name,
        item.barcode, item.package_barcode, item.package_number,
        item.location_code, item.shelf_id, item.expected_quantity
      ]);
    }
    
    const count = await get('SELECT * FROM inventory_counts WHERE id = ?', [countId]);
    res.json({ success: true, count, items_created: items.length });
    
  } catch (error) {
    console.error('❌ Inventory count creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all inventory counts
app.get('/api/inventory-counts', async (req, res) => {
  try {
    const counts = await all(`
      SELECT ic.*, 
             COUNT(ici.id) as total_items,
             COUNT(CASE WHEN ici.status = 'counted' THEN 1 END) as counted_items,
             COUNT(CASE WHEN ici.variance != 0 THEN 1 END) as variance_items
      FROM inventory_counts ic
      LEFT JOIN inventory_count_items ici ON ic.id = ici.count_id
      GROUP BY ic.id
      ORDER BY ic.created_date DESC
    `);
    
    res.json({ success: true, counts });
  } catch (error) {
    console.error('❌ Inventory counts fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get specific inventory count
app.get('/api/inventory-counts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const count = await get('SELECT * FROM inventory_counts WHERE id = ?', [id]);
    
    if (!count) {
      return res.status(404).json({ error: 'Count not found' });
    }
    
    res.json(count);
  } catch (error) {
    console.error('❌ Inventory count fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get count items
app.get('/api/inventory-counts/:id/items', async (req, res) => {
  try {
    const { id } = req.params;
    const items = await all(`
      SELECT ici.*, 
             COALESCE(pp.package_number, ici.package_number, 'NO-PKG') as package_number
      FROM inventory_count_items ici
      LEFT JOIN product_packages pp ON ici.package_barcode = pp.barcode
      WHERE ici.count_id = ? 
      ORDER BY ici.location_code, ici.sku
    `, [id]);
    
    res.json({ success: true, items });
  } catch (error) {
    console.error('❌ Count items fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update count item
app.put('/api/inventory-counts/:countId/items/:itemId', async (req, res) => {
  try {
    const { countId, itemId } = req.params;
    const { counted_quantity, status, notes } = req.body;
    
    // Get current item
    const item = await get('SELECT * FROM inventory_count_items WHERE id = ? AND count_id = ?', [itemId, countId]);
    if (!item) {
      return res.status(404).json({ error: 'Count item not found' });
    }
    
    // Calculate variance
    const variance = counted_quantity - item.expected_quantity;
    
    // Update item
    await run(`
      UPDATE inventory_count_items 
      SET counted_quantity = ?, variance = ?, status = ?, notes = ?, 
          counted_date = CURRENT_TIMESTAMP
      WHERE id = ? AND count_id = ?
    `, [counted_quantity, variance, status, notes, itemId, countId]);
    
    // Update count summary
    const summary = await get(`
      SELECT 
        COUNT(CASE WHEN status = 'counted' THEN 1 END) as counted_items,
        COUNT(CASE WHEN variance != 0 THEN 1 END) as variance_items,
        COALESCE(SUM(variance), 0) as total_variance
      FROM inventory_count_items 
      WHERE count_id = ?
    `, [countId]);
    
    await run(`
      UPDATE inventory_counts 
      SET counted_items = ?, variance_items = ?, total_variance = ?
      WHERE id = ?
    `, [summary.counted_items, summary.variance_items, summary.total_variance, countId]);
    
    res.json({ success: true, variance });
  } catch (error) {
    console.error('❌ Count item update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Complete inventory count
app.post('/api/inventory-counts/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Calculate final statistics
    const countedItems = await get(`
      SELECT COUNT(*) as count FROM inventory_count_items 
      WHERE count_id = ? AND status = 'counted'
    `, [id]);
    
    const uncountedItems = await get(`
      SELECT COUNT(*) as count FROM inventory_count_items 
      WHERE count_id = ? AND status = 'pending'
    `, [id]);
    
    const varianceItems = await get(`
      SELECT COUNT(*) as count FROM inventory_count_items 
      WHERE count_id = ? AND variance != 0
    `, [id]);
    
    const totalVariance = await get(`
      SELECT COALESCE(SUM(variance), 0) as total FROM inventory_count_items 
      WHERE count_id = ?
    `, [id]);
    
    // Update count with final statistics
    await run(`
      UPDATE inventory_counts 
      SET status = 'completed', 
          completed_date = CURRENT_TIMESTAMP,
          counted_items = ?,
          variance_items = ?,
          total_variance = ?
      WHERE id = ?
    `, [countedItems.count, varianceItems.count, totalVariance.total, id]);
    
    // Get summary
    const summary = {
      counted_items: countedItems.count,
      uncounted_items: uncountedItems.count,
      variance_items: varianceItems.count,
      total_variance: totalVariance.total
    };
    
    const variances = await all(`
      SELECT ici.sku, ici.product_name, ici.location_code, ici.expected_quantity, 
             ici.counted_quantity, ici.variance, ici.package_barcode,
             ici.package_number, ici.product_id
      FROM inventory_count_items ici
      WHERE ici.count_id = ? AND ici.variance != 0
      ORDER BY ABS(ici.variance) DESC
    `, [id]);
    
    res.json({ success: true, summary, variances });
  } catch (error) {
    console.error('❌ Count completion error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate count report (PDF)
app.get('/api/inventory-counts/:id/report', async (req, res) => {
  try {
    const { id } = req.params;
    
    const count = await get('SELECT * FROM inventory_counts WHERE id = ?', [id]);
    if (!count) {
      return res.status(404).json({ error: 'Count not found' });
    }
    
    const items = await all(`
      SELECT * FROM inventory_count_items 
      WHERE count_id = ? 
      ORDER BY location_code, sku
    `, [id]);
    
    // Set response headers for PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Sayim_Raporu_${count.id}.pdf"`);
    
    // Create PDF with Turkish font support
    const doc = new PDFDocument({
      margin: 50,
      info: {
        Title: `Depo Sayım Raporu - ${count.name}`,
        Author: 'WMS Sistemi',
        Subject: 'Depo Sayım Raporu'
      }
    });
    doc.pipe(res);
    
    // Header
    doc.fontSize(18).font('Helvetica-Bold').text('DEPO SAYIM RAPORU', { align: 'center' });
    doc.moveDown(1.5);
    
    // Count info section
    doc.fontSize(14).font('Helvetica-Bold').text('Sayim Bilgileri:', 50);
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(11);
    doc.text(`Sayim Adi: ${count.name}`, 70);
    doc.text(`Sayim Turu: ${count.type.toUpperCase()}`, 70);
    doc.text(`Baslangic: ${new Date(count.created_date).toLocaleString('tr-TR')}`, 70);
    if (count.completed_date) {
      doc.text(`Tamamlanma: ${new Date(count.completed_date).toLocaleString('tr-TR')}`, 70);
    }
    if (count.description) {
      doc.text(`Aciklama: ${count.description}`, 70);
    }
    doc.moveDown(1);
    
    // Summary section with better spacing
    doc.fontSize(14).font('Helvetica-Bold').text('Ozet:', 50);
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(11);
    doc.text(`Toplam Kalem: ${items.length}`, 70);
    doc.text(`Sayilan Kalem: ${count.counted_items || 0}`, 70);
    doc.text(`Fark Bulunan: ${count.variance_items || 0}`, 70);
    doc.text(`Toplam Fark: ${count.total_variance || 0}`, 70);
    doc.moveDown(1.5);
    
    // Items table with better formatting
    if (items.length > 0) {
      doc.fontSize(14).font('Helvetica-Bold').text('Detay Listesi:', 50);
      doc.moveDown(1);
      
      // Table headers with better positioning
      const tableTop = doc.y;
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('SKU', 50, tableTop, { width: 90 });
      doc.text('URUN ADI', 145, tableTop, { width: 140 });
      doc.text('LOKASYON', 290, tableTop, { width: 60 });
      doc.text('BEKLENEN', 355, tableTop, { width: 50 });
      doc.text('SAYILAN', 410, tableTop, { width: 45 });
      doc.text('FARK', 460, tableTop, { width: 40 });
      doc.text('DURUM', 505, tableTop, { width: 45 });
      
      // Table line
      doc.moveTo(50, tableTop + 18).lineTo(550, tableTop + 18).stroke();
      
      let currentY = tableTop + 25;
      doc.font('Helvetica').fontSize(9);
      
      items.forEach((item, index) => {
        // New page if needed
        if (currentY > 730) {
          doc.addPage();
          currentY = 80;
          
          // Repeat headers on new page
          doc.fontSize(10).font('Helvetica-Bold');
          doc.text('SKU', 50, currentY - 20, { width: 90 });
          doc.text('URUN ADI', 145, currentY - 20, { width: 140 });
          doc.text('LOKASYON', 290, currentY - 20, { width: 60 });
          doc.text('BEKLENEN', 355, currentY - 20, { width: 50 });
          doc.text('SAYILAN', 410, currentY - 20, { width: 45 });
          doc.text('FARK', 460, currentY - 20, { width: 40 });
          doc.text('DURUM', 505, currentY - 20, { width: 45 });
          doc.moveTo(50, currentY - 5).lineTo(550, currentY - 5).stroke();
          doc.font('Helvetica').fontSize(9);
        }
        
        const status = item.status === 'counted' ? 'SAYILDI' : item.status === 'skipped' ? 'ATLANDI' : 'SAYILMADI';
        
        // Convert Turkish characters for PDF compatibility
        const productName = (item.product_name || '-')
          .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
          .replace(/ü/g, 'u').replace(/Ü/g, 'U')
          .replace(/ş/g, 's').replace(/Ş/g, 'S')
          .replace(/ı/g, 'i').replace(/İ/g, 'I')
          .replace(/ö/g, 'o').replace(/Ö/g, 'O')
          .replace(/ç/g, 'c').replace(/Ç/g, 'C')
          .substring(0, 25);
        
        doc.text(item.sku || '-', 50, currentY, { width: 90 });
        doc.text(productName, 145, currentY, { width: 140 });
        doc.text(item.location_code || '-', 290, currentY, { width: 60 });
        doc.text(item.expected_quantity?.toString() || '0', 355, currentY, { width: 50, align: 'center' });
        doc.text(item.counted_quantity?.toString() || '-', 410, currentY, { width: 45, align: 'center' });
        
        // Variance with color and better formatting
        const variance = item.variance || 0;
        if (variance > 0) {
          doc.fillColor('green').text(`+${variance}`, 460, currentY, { width: 40, align: 'center' });
        } else if (variance < 0) {
          doc.fillColor('red').text(variance.toString(), 460, currentY, { width: 40, align: 'center' });
        } else {
          doc.fillColor('black').text('0', 460, currentY, { width: 40, align: 'center' });
        }
        
        doc.fillColor('black').text(status, 505, currentY, { width: 45, align: 'center' });
        
        // Add separator line every 5 rows for better readability
        if ((index + 1) % 5 === 0) {
          doc.moveTo(50, currentY + 12).lineTo(550, currentY + 12).stroke('#cccccc');
          currentY += 20;
        } else {
          currentY += 16;
        }
      });
    }
    
    doc.end();
    
  } catch (error) {
    console.error('❌ Count report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add item to manual count by barcode
app.post('/api/inventory-counts/:id/scan', async (req, res) => {
  try {
    const { id } = req.params;
    const { barcode } = req.body;
    
    console.log(`🔍 SCAN DEBUG: Count ID=${id}, Barcode=${barcode}`);
    
    if (!barcode) {
      console.log('❌ SCAN DEBUG: No barcode provided');
      return res.status(400).json({ error: 'Barcode required' });
    }
    
    // Check if count exists and is manual type
    const count = await get('SELECT * FROM inventory_counts WHERE id = ? AND type = "manual"', [id]);
    console.log(`🔍 SCAN DEBUG: Count found:`, count);
    if (!count) {
      console.log('❌ SCAN DEBUG: Manual count not found or wrong type');
      return res.status(404).json({ error: 'Manual count not found' });
    }
    
    // Find all locations for this barcode (product or package barcode) - ONLY ACTIVE SHELF ASSIGNMENTS
    const productLocations = await all(`
      SELECT 
        p.id as product_id,
        p.sku,
        p.name as product_name,
        p.main_barcode as barcode,
        pp.barcode as package_barcode,
        pp.package_number,
        s.shelf_code as location_code,
        s.id as shelf_id,
        sp.quantity as expected_quantity
      FROM products p
      JOIN product_packages pp ON p.id = pp.product_id
      JOIN shelf_packages sp ON pp.id = sp.package_id AND sp.quantity > 0
      JOIN shelves s ON sp.shelf_id = s.id
      WHERE (p.main_barcode = ? OR pp.barcode = ?)
      AND s.shelf_code != 'SSH-01-01'
      ORDER BY s.shelf_code
    `, [barcode, barcode]);
    
    console.log(`🔍 SCAN DEBUG: Found ${productLocations.length} locations for barcode ${barcode}`);
    if (productLocations.length > 0) {
      console.log('🔍 SCAN DEBUG: First location:', productLocations[0]);
    }
    
    if (!productLocations || productLocations.length === 0) {
      console.log('❌ SCAN DEBUG: No locations found, returning 404');
      return res.status(404).json({ error: 'Ürün bulunamadı veya SSH-01-01 rafında' });
    }
    
    const addedItems = [];
    
    // Her lokasyon için ayrı kayıt oluştur
    for (const productInfo of productLocations) {
      // Check if already added for this specific location
      const existing = await get(`
        SELECT * FROM inventory_count_items 
        WHERE count_id = ? AND product_id = ? AND location_code = ? AND package_barcode = ?
      `, [id, productInfo.product_id, productInfo.location_code, productInfo.package_barcode]);
      
      if (!existing) {
        // Add to count items
        const result = await run(`
          INSERT INTO inventory_count_items (
            count_id, product_id, sku, product_name, barcode, package_barcode, package_number,
            location_code, shelf_id, expected_quantity
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          id, productInfo.product_id, productInfo.sku, productInfo.product_name,
          productInfo.barcode, productInfo.package_barcode, productInfo.package_number,
          productInfo.location_code, productInfo.shelf_id, productInfo.expected_quantity
        ]);
        
        // Get the added item
        const addedItem = await get('SELECT * FROM inventory_count_items WHERE id = ?', [result.lastID]);
        addedItems.push(addedItem);
      }
    }
    
    if (addedItems.length === 0) {
      return res.status(400).json({ error: 'Tüm lokasyonlar zaten sayıma eklenmiş' });
    }
    
    res.json({ success: true, items: addedItems, locations_added: addedItems.length });
    
  } catch (error) {
    console.error('❌ Manual count scan error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cleanup inventory counts (for testing)
app.delete('/api/inventory-counts/cleanup', async (req, res) => {
  try {
    await run('DELETE FROM inventory_count_items');
    await run('DELETE FROM inventory_counts');
    console.log('✅ Inventory count data cleared');
    res.json({ success: true, message: 'All inventory count data cleared' });
  } catch (error) {
    console.error('❌ Cleanup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---- Stock Management API ----

// Get stock summary
app.get('/api/stock/summary', async (req, res) => {
  try {
    // Önce shelf_packages tablosunun var olup olmadığını kontrol edelim
    let hasShelfPackages = false;
    try {
      await get("SELECT name FROM sqlite_master WHERE type='table' AND name='shelf_packages'");
      hasShelfPackages = true;
    } catch (error) {
      hasShelfPackages = false;
    }
    
    let totalProducts, lowStock, outOfStock;
    
    if (hasShelfPackages) {
      // Shelf_packages tablosu varsa gerçek stok hesapla
      
      // Toplam ürün sayısı (en az bir paketi olan)
      totalProducts = await get(`
        SELECT COUNT(DISTINCT p.id) as count 
        FROM products p
        JOIN product_packages pp ON p.id = pp.product_id
      `);
      
      // Düşük stok hesaplama: Ana ürün stok miktarı (minimum paket stoğu) <= 5
      const lowStockProducts = await all(`
        SELECT p.id, p.sku,
          COALESCE((
            SELECT MIN(pkg_stock.total_quantity)
            FROM (
              SELECT 
                pp2.id as package_id,
                SUM(COALESCE(sp2.quantity, 0)) as total_quantity
              FROM product_packages pp2
              LEFT JOIN shelf_packages sp2 ON pp2.id = sp2.package_id
              LEFT JOIN shelves s2 ON sp2.shelf_id = s2.id
              WHERE pp2.product_id = p.id 
                AND (s2.shelf_code != 'SSH-01-01' OR s2.shelf_code IS NULL)
              GROUP BY pp2.id
              HAVING total_quantity > 0
            ) pkg_stock
          ), 0) as main_stock
        FROM products p
        JOIN product_packages pp ON p.id = pp.product_id
        GROUP BY p.id, p.sku
        HAVING main_stock > 0 AND main_stock <= 5
      `);
      lowStock = { count: lowStockProducts.length };
      
      // Stokta yok hesaplama: Ana ürün stok miktarı = 0
      const outOfStockProducts = await all(`
        SELECT p.id, p.sku,
          COALESCE((
            SELECT MIN(pkg_stock.total_quantity)
            FROM (
              SELECT 
                pp2.id as package_id,
                SUM(COALESCE(sp2.quantity, 0)) as total_quantity
              FROM product_packages pp2
              LEFT JOIN shelf_packages sp2 ON pp2.id = sp2.package_id
              LEFT JOIN shelves s2 ON sp2.shelf_id = s2.id
              WHERE pp2.product_id = p.id 
                AND (s2.shelf_code != 'SSH-01-01' OR s2.shelf_code IS NULL)
              GROUP BY pp2.id
            ) pkg_stock
          ), 0) as main_stock
        FROM products p
        JOIN product_packages pp ON p.id = pp.product_id
        GROUP BY p.id, p.sku
        HAVING main_stock = 0
      `);
      outOfStock = { count: outOfStockProducts.length };
      
    } else {
      // Shelf_packages tablosu yoksa basit hesaplama
      totalProducts = await get(`
        SELECT COUNT(DISTINCT p.id) as count 
        FROM products p
        JOIN product_packages pp ON p.id = pp.product_id
      `);
      
      // Basit düşük stok hesaplama (paket sayısına göre)
      lowStock = await get(`
        SELECT COUNT(DISTINCT p.id) as count 
        FROM products p
        JOIN product_packages pp ON p.id = pp.product_id
        GROUP BY p.id
        HAVING COUNT(pp.id) > 0 AND COUNT(pp.id) <= 5
      `);
      
      // Basit stok yok hesaplama
      outOfStock = await get(`
        SELECT COUNT(DISTINCT p.id) as count 
        FROM products p
        LEFT JOIN product_packages pp ON p.id = pp.product_id
        WHERE pp.id IS NULL
      `);
    }
    
    // Bugünkü hareketler
    const todayMovements = await get(`
      SELECT COUNT(*) as count 
      FROM stock_movements 
      WHERE DATE(created_at) = DATE('now')
    `);
    
    res.json({
      total_products: totalProducts.count || 0,
      low_stock_items: lowStock.count || 0,
      out_of_stock_items: outOfStock.count || 0,
      todays_movements: todayMovements.count || 0
    });
    
  } catch (error) {
    console.error('❌ Stock summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get stock list with filters
app.get('/api/stock', async (req, res) => {
  try {
    const { search, filter, location, sort } = req.query;
    
    // Sıralama
    let orderBy = 'p.sku ASC';
    if (sort) {
      switch(sort) {
        case 'name':
          orderBy = 'p.name ASC';
          break;
        case 'stock_desc':
          orderBy = 'package_count DESC';
          break;
        case 'stock_asc':
          orderBy = 'package_count ASC';
          break;
        case 'location':
          orderBy = 'p.sku ASC'; // Default to SKU for location sort
          break;
      }
    }
    
    // Önce shelf_packages tablosunun var olup olmadığını kontrol edelim
    let hasShelfPackages = false;
    try {
      await get("SELECT name FROM sqlite_master WHERE type='table' AND name='shelf_packages'");
      hasShelfPackages = true;
    } catch (error) {
      hasShelfPackages = false;
    }
    
    let query;
    if (hasShelfPackages) {
      // Shelf_packages tablosu varsa gerçek stok hesapla
      query = `
        SELECT 
          p.id as product_id,
          p.sku,
          p.name as product_name,
          COALESCE((
            SELECT MIN(pkg_stock.total_quantity)
            FROM (
              SELECT 
                pp2.id as package_id,
                SUM(COALESCE(sp2.quantity, 0)) as total_quantity
              FROM product_packages pp2
              LEFT JOIN shelf_packages sp2 ON pp2.id = sp2.package_id
              LEFT JOIN shelves s2 ON sp2.shelf_id = s2.id
              WHERE pp2.product_id = p.id 
                AND (s2.shelf_code != 'SSH-01-01' OR s2.shelf_code IS NULL)
              GROUP BY pp2.id
              HAVING total_quantity > 0
            ) pkg_stock
          ), 0) as main_product_quantity,
          COUNT(DISTINCT pp.id) as package_count,
          1 as location_count
        FROM products p
        LEFT JOIN product_packages pp ON p.id = pp.product_id
        GROUP BY p.id, p.sku, p.name
        ORDER BY ${orderBy}
      `;
    } else {
      // Shelf_packages tablosu yoksa basit hesaplama
      query = `
        SELECT 
          p.id as product_id,
          p.sku,
          p.name as product_name,
          COUNT(DISTINCT pp.id) as main_product_quantity,
          COUNT(DISTINCT pp.id) as package_count,
          1 as location_count
        FROM products p
        LEFT JOIN product_packages pp ON p.id = pp.product_id
        GROUP BY p.id, p.sku, p.name
        ORDER BY ${orderBy}
      `;
    }
    
    let stocks = await all(query);
    
    // Frontend'de filtreleme yap
    if (search) {
      const searchTerm = search.toLowerCase();
      stocks = stocks.filter(item => 
        item.sku.toLowerCase().includes(searchTerm) ||
        item.product_name.toLowerCase().includes(searchTerm)
      );
    }
    
    if (filter && filter !== 'all') {
      stocks = stocks.filter(item => {
        switch(filter) {
          case 'in_stock':
            return item.main_product_quantity > 0;
          case 'low_stock':
            return item.main_product_quantity > 0 && item.main_product_quantity <= 5;
          case 'out_of_stock':
            return item.main_product_quantity === 0;
          default:
            return true;
        }
      });
    }
    
    res.json(stocks);
    
  } catch (error) {
    console.error('❌ Stock list error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get package details for a product SKU
app.get('/api/stock/:sku/packages', async (req, res) => {
  try {
    const { sku } = req.params;
    
    // Her paket için toplam stoğu hesapla (SSH-01-01 hariç)
    const packages = await all(`
      SELECT 
        pp.id as package_id,
        pp.package_number,
        pp.barcode as package_barcode,
        SUM(COALESCE(sp.quantity, 0)) as total_package_quantity
      FROM products p
      JOIN product_packages pp ON p.id = pp.product_id
      LEFT JOIN shelf_packages sp ON pp.id = sp.package_id
      LEFT JOIN shelves s ON sp.shelf_id = s.id
      WHERE p.sku = ? AND (s.shelf_code != 'SSH-01-01' OR s.shelf_code IS NULL)
      GROUP BY pp.id, pp.package_number, pp.barcode
      ORDER BY pp.package_number ASC
    `, [sku]);
    
    res.json({ success: true, packages });
    
  } catch (error) {
    console.error('❌ Package details error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get shelf locations for a specific package
app.get('/api/stock/package/:barcode/locations', async (req, res) => {
  try {
    const { barcode } = req.params;
    
    const locations = await all(`
      SELECT 
        s.shelf_code,
        s.shelf_name,
        s.zone,
        s.aisle,
        s.level,
        sp.quantity,
        sp.assigned_date
      FROM product_packages pp
      JOIN shelf_packages sp ON pp.id = sp.package_id
      JOIN shelves s ON sp.shelf_id = s.id
      WHERE pp.barcode = ? AND sp.quantity > 0 AND s.shelf_code != 'SSH-01-01'
      ORDER BY s.shelf_code ASC
    `, [barcode]);
    
    res.json({ success: true, locations });
    
  } catch (error) {
    console.error('❌ Package locations error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get stock movements for a specific package in a specific shelf
app.get('/api/stock/package/:barcode/shelf/:shelfCode/movements', async (req, res) => {
  try {
    const { barcode, shelfCode } = req.params;
    const { limit = 10 } = req.query;
    
    // Get product_id from barcode
    const packageInfo = await get(`
      SELECT pp.product_id, p.sku, p.name as product_name, pp.package_number
      FROM product_packages pp
      JOIN products p ON pp.product_id = p.id
      WHERE pp.barcode = ?
    `, [barcode]);
    
    if (!packageInfo) {
      return res.json({ success: true, movements: [] });
    }
    
    // Get movements for this product that mention this shelf in note
    const movements = await all(`
      SELECT 
        sm.*,
        ? as sku,
        ? as product_name,
        ? as package_number
      FROM stock_movements sm
      WHERE sm.product_id = ? 
        AND (sm.note LIKE ? OR sm.note LIKE ?)
      ORDER BY sm.created_at DESC
      LIMIT ?
    `, [
      packageInfo.sku, 
      packageInfo.product_name, 
      packageInfo.package_number,
      packageInfo.product_id, 
      `%[${shelfCode}]%`, 
      `%${shelfCode}%`,
      limit
    ]);
    
    res.json({ success: true, movements });
    
  } catch (error) {
    console.error('❌ Package shelf movements error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Shelf-specific stock adjustment
app.post('/api/stock/shelf/adjust', async (req, res) => {
  try {
    const { barcode, shelf_code, type, quantity, note } = req.body;
    
    if (!barcode || !shelf_code || !type || quantity === undefined) {
      return res.status(400).json({ error: 'Eksik parametreler' });
    }
    
    // Get package and shelf info
    const packageInfo = await get(`
      SELECT pp.id as package_id, pp.product_id, p.sku, p.name as product_name
      FROM product_packages pp
      JOIN products p ON pp.product_id = p.id
      WHERE pp.barcode = ?
    `, [barcode]);
    
    if (!packageInfo) {
      return res.status(404).json({ error: 'Paket bulunamadı' });
    }
    
    const shelf = await get('SELECT * FROM shelves WHERE shelf_code = ?', [shelf_code]);
    if (!shelf) {
      return res.status(404).json({ error: 'Raf bulunamadı' });
    }
    
    // Get current shelf package
    let shelfPackage = await get(`
      SELECT * FROM shelf_packages 
      WHERE package_id = ? AND shelf_id = ?
    `, [packageInfo.package_id, shelf.id]);
    
    let newQuantity = 0;
    const currentQty = shelfPackage?.quantity || 0;
    
    // Calculate new quantity
    switch(type) {
      case 'IN':
        newQuantity = currentQty + quantity;
        break;
      case 'OUT':
        newQuantity = Math.max(0, currentQty - quantity);
        break;
      case 'ADJUST':
        newQuantity = quantity;
        break;
    }
    
    // Update shelf_packages
    if (shelfPackage) {
      await run(`
        UPDATE shelf_packages 
        SET quantity = ?, assigned_date = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [newQuantity, shelfPackage.id]);
    } else if (newQuantity > 0) {
      await run(`
        INSERT INTO shelf_packages (package_id, shelf_id, quantity, assigned_date)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `, [packageInfo.package_id, shelf.id, newQuantity]);
    }
    
    // Record movement (without shelf_code for now)
    await run(`
      INSERT INTO stock_movements (product_id, type, qty, note, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [packageInfo.product_id, type, quantity, `${note} [${shelf_code}]`]);
    
    console.log(`✅ Shelf stock adjusted: ${packageInfo.sku} in ${shelf_code}: ${currentQty} → ${newQuantity}`);
    
    res.json({ 
      success: true, 
      message: 'Raf stok ayarlaması başarılı',
      previous_quantity: currentQty,
      new_quantity: newQuantity
    });
    
  } catch (error) {
    console.error('❌ Shelf stock adjustment error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Search stock item by barcode or SKU
app.get('/api/stock/search', async (req, res) => {
  try {
    const { barcode, sku } = req.query;
    
    if (!barcode && !sku) {
      return res.status(400).json({ error: 'Barkod veya SKU gerekli' });
    }
    
    console.log('🔍 Stock search request:', { barcode, sku });
    
    // Ürün veya paket barkoduna/SKU'ya göre ara
    let searchCondition = '';
    let searchParams = [];
    
    if (barcode && sku) {
      searchCondition = 'WHERE (p.main_barcode = ? OR pp.barcode = ? OR p.sku = ?)';
      searchParams = [barcode, barcode, sku];
    } else if (barcode) {
      searchCondition = 'WHERE (p.main_barcode = ? OR pp.barcode = ?)';
      searchParams = [barcode, barcode];
    } else if (sku) {
      searchCondition = 'WHERE p.sku = ?';
      searchParams = [sku];
    }
    
    const item = await get(`
      SELECT 
        p.id as product_id,
        p.sku,
        p.name as product_name,
        pp.package_number,
        pp.barcode as package_barcode,
        s.shelf_code as location_code,
        sp.quantity as current_stock,
        p.main_barcode as product_barcode
      FROM products p
      LEFT JOIN product_packages pp ON p.id = pp.product_id
      LEFT JOIN shelf_packages sp ON pp.id = sp.package_id
      LEFT JOIN shelves s ON sp.shelf_id = s.id
      ${searchCondition}
      LIMIT 1
    `, searchParams);
    
    console.log('🔍 Search result:', item);
    
    if (!item) {
      return res.json({ success: false, error: 'Ürün bulunamadı' });
    }
    
    res.json({ success: true, item });
    
  } catch (error) {
    console.error('❌ Stock search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stock adjustment
app.post('/api/stock/adjust', async (req, res) => {
  try {
    const { sku, location_code, type, quantity, note } = req.body;
    
    if (!sku || !type || quantity === undefined) {
      return res.status(400).json({ error: 'SKU, işlem türü ve miktar gerekli' });
    }
    
    // Ürün ve lokasyon bilgisini bul
    const stockItem = await get(`
      SELECT 
        p.id as product_id,
        sp.id as shelf_package_id,
        sp.quantity as current_quantity
      FROM products p
      JOIN shelf_packages sp ON p.id = sp.product_id
      JOIN shelves s ON sp.shelf_id = s.id
      WHERE p.sku = ? AND s.shelf_code = ?
    `, [sku, location_code]);
    
    if (!stockItem) {
      return res.status(404).json({ error: 'Stok kalemi bulunamadı' });
    }
    
    let newQuantity;
    let movementQty;
    
    switch(type) {
      case 'IN':
        newQuantity = stockItem.current_quantity + quantity;
        movementQty = quantity;
        break;
      case 'OUT':
        newQuantity = Math.max(0, stockItem.current_quantity - quantity);
        movementQty = -quantity;
        break;
      case 'ADJUST':
        newQuantity = quantity;
        movementQty = quantity - stockItem.current_quantity;
        break;
      default:
        return res.status(400).json({ error: 'Geçersiz işlem türü' });
    }
    
    // Stok güncelle
    await run(`UPDATE shelf_packages SET quantity = ? WHERE id = ?`, 
      [newQuantity, stockItem.shelf_package_id]);
    
    // Hareket kaydı ekle
    await run(`
      INSERT INTO stock_movements (product_id, type, qty, note)
      VALUES (?, ?, ?, ?)
    `, [stockItem.product_id, type, movementQty, note || `Stok ${type} işlemi`]);
    
    res.json({ 
      success: true, 
      previous_quantity: stockItem.current_quantity,
      new_quantity: newQuantity,
      movement_qty: movementQty
    });
    
  } catch (error) {
    console.error('❌ Stock adjustment error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get stock movements
app.get('/api/stock/movements', async (req, res) => {
  try {
    const { limit = 50, product_id } = req.query;
    
    let whereClause = '';
    let params = [limit];
    
    if (product_id) {
      whereClause = 'WHERE sm.product_id = ?';
      params = [product_id, limit];
    }
    
    const movements = await all(`
      SELECT 
        sm.*,
        p.sku,
        p.name as product_name
      FROM stock_movements sm
      LEFT JOIN products p ON sm.product_id = p.id
      ${whereClause}
      ORDER BY sm.created_at DESC
      LIMIT ?
    `, params);
    
    // Parse package info from notes
    const enhancedMovements = movements.map(movement => {
      let packageNumber = '';
      let shelfCode = '';
      
      if (movement.note) {
        // Extract package number (e.g., "3-1", "3-2")
        const packageMatch = movement.note.match(/(\d+-\d+)/);
        if (packageMatch) {
          packageNumber = packageMatch[1];
        }
        
        // Extract shelf code (e.g., "[A1-01-219]")
        const shelfMatch = movement.note.match(/\[([A-Z0-9-]+)\]/);
        if (shelfMatch) {
          shelfCode = shelfMatch[1];
        }
      }
      
      return {
        ...movement,
        package_number: packageNumber,
        shelf_code: shelfCode,
        display_note: `${movement.sku || 'N/A'} - Paket ${packageNumber} - ${shelfCode}`
      };
    });
    
    res.json(enhancedMovements);
    
  } catch (error) {
    console.error('❌ Stock movements error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stock reports
app.get('/api/stock/report', async (req, res) => {
  try {
    const { type = 'full' } = req.query;
    
    let reportData;
    let filename;
    
    if (type === 'low_stock') {
      reportData = await all(`
        SELECT 
          p.sku,
          p.name as product_name,
          pp.package_number,
          s.shelf_code as location_code,
          sp.quantity
        FROM products p
        JOIN shelf_packages sp ON p.id = sp.product_id
        LEFT JOIN product_packages pp ON sp.package_id = pp.id
        LEFT JOIN shelves s ON sp.shelf_id = s.id
        WHERE sp.quantity > 0 AND sp.quantity <= 5
        ORDER BY sp.quantity ASC, p.sku ASC
      `);
      filename = `Dusuk_Stok_Raporu_${new Date().toISOString().split('T')[0]}.pdf`;
    } else {
      reportData = await all(`
        SELECT 
          p.sku,
          p.name as product_name,
          pp.package_number,
          s.shelf_code as location_code,
          COALESCE(sp.quantity, 0) as quantity
        FROM products p
        LEFT JOIN shelf_packages sp ON p.id = sp.product_id
        LEFT JOIN product_packages pp ON sp.package_id = pp.id
        LEFT JOIN shelves s ON sp.shelf_id = s.id
        ORDER BY p.sku ASC
      `);
      filename = `Stok_Raporu_${new Date().toISOString().split('T')[0]}.pdf`;
    }
    
    // PDF oluştur
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);
    
    // PDF içeriği
    doc.fontSize(16).text('WMS Stok Raporu', 50, 50);
    doc.fontSize(12).text(`Rapor Türü: ${type === 'low_stock' ? 'Düşük Stok' : 'Tam Stok'}`, 50, 80);
    doc.text(`Tarih: ${new Date().toLocaleDateString('tr-TR')}`, 50, 100);
    doc.text(`Toplam Kayıt: ${reportData.length}`, 50, 120);
    
    let yPosition = 160;
    
    // Başlıklar
    doc.fontSize(10)
       .text('SKU', 50, yPosition)
       .text('Ürün Adı', 150, yPosition)
       .text('Paket No', 300, yPosition)
       .text('Lokasyon', 400, yPosition)
       .text('Stok', 500, yPosition);
    
    yPosition += 20;
    
    // Veriler
    for (const item of reportData) {
      if (yPosition > 750) {
        doc.addPage();
        yPosition = 50;
      }
      
      doc.text(item.sku || '', 50, yPosition)
         .text(item.product_name || '', 150, yPosition)
         .text(item.package_number || 'NO-PKG', 300, yPosition)
         .text(item.location_code || 'NO-LOC', 400, yPosition)
         .text(item.quantity.toString(), 500, yPosition);
      
      yPosition += 15;
    }
    
    doc.end();
    
  } catch (error) {
    console.error('❌ Stock report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============== ANALİTİK DASHBOARD API'LERİ ==============

// 1. Optimizasyon önerileri
app.get('/api/analytics/optimization', async (req, res) => {
  try {
    // Mevcut raf verilerinden analitik oluştur
    const shelves = await all('SELECT * FROM shelves ORDER BY zone, aisle, level');
    const assignments = await all(`
      SELECT s.*, sp.quantity, sp.package_id, p.name as product_name, s.id as shelf_id
      FROM shelves s
      LEFT JOIN shelf_packages sp ON s.id = sp.shelf_id
      LEFT JOIN product_packages pp ON sp.package_id = pp.id
      LEFT JOIN products p ON pp.product_id = p.id
    `);
    
    // Boş raflar
    const occupiedShelfIds = new Set(assignments.filter(a => a.package_id).map(a => a.shelf_id));
    const emptyShelves = shelves.filter(shelf => !occupiedShelfIds.has(shelf.id)).slice(0, 5);
    
    // Aşırı dolu raflar (kapasitesinin %90'ından fazla)
    const shelfUsage = {};
    assignments.forEach(assignment => {
      if (assignment.quantity) {
        if (!shelfUsage[assignment.shelf_id]) {
          shelfUsage[assignment.shelf_id] = {
            ...assignment,
            total_quantity: 0
          };
        }
        shelfUsage[assignment.shelf_id].total_quantity += assignment.quantity;
      }
    });
    
    const overcrowdedShelves = Object.values(shelfUsage)
      .filter(shelf => (shelf.total_quantity / (shelf.capacity || 100)) > 0.9)
      .slice(0, 5)
      .map(shelf => ({
        shelf_code: shelf.shelf_code,
        total_quantity: shelf.total_quantity,
        capacity: shelf.capacity,
        suggestion: 'Kapasite %90+ dolu - transfer düşünün'
      }));
    
    // Karışık ürün rafları (birden fazla ürün tipi)
    const shelfProducts = {};
    assignments.forEach(assignment => {
      if (assignment.product_name) {
        if (!shelfProducts[assignment.shelf_code]) {
          shelfProducts[assignment.shelf_code] = new Set();
        }
        shelfProducts[assignment.shelf_code].add(assignment.product_name);
      }
    });
    
    const mixedProductShelves = Object.entries(shelfProducts)
      .filter(([code, products]) => products.size > 1)
      .slice(0, 5)
      .map(([shelf_code, products]) => ({
        shelf_code,
        product_count: products.size,
        suggestion: 'Tek ürün politikası için konsolidasyon önerilir'
      }));

    res.json({
      success: true,
      empty_shelves: emptyShelves,
      overcrowded_shelves: overcrowdedShelves,
      mixed_product_shelves: mixedProductShelves
    });
  } catch (error) {
    console.error('Analytics optimization error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Picking efficiency analizi
app.get('/api/analytics/picking', async (req, res) => {
  try {
    // En çok pick edilen ürünler
    const topPickedProducts = await all(`
      SELECT p.name, p.sku, COUNT(*) as pick_count,
             s.zone, s.aisle, s.level,
             'frequent_pick' as insight_type
      FROM pick_scans ps
      JOIN product_packages pp ON ps.package_id = pp.id
      JOIN products p ON pp.product_id = p.id
      LEFT JOIN shelf_packages sp ON ps.package_id = sp.package_id
      LEFT JOIN shelves s ON sp.shelf_id = s.id
      WHERE ps.created_at >= datetime('now', '-30 days')
      GROUP BY p.id, s.id
      ORDER BY pick_count DESC
      LIMIT 15
    `);
    
    // Zone bazlı picking yoğunluğu
    const zonePickingStats = await all(`
      SELECT s.zone, COUNT(*) as total_picks,
             AVG(s.level) as avg_level,
             COUNT(DISTINCT p.id) as unique_products
      FROM pick_scans ps
      JOIN product_packages pp ON ps.package_id = pp.id
      JOIN products p ON pp.product_id = p.id
      LEFT JOIN shelf_packages sp ON ps.package_id = sp.package_id
      LEFT JOIN shelves s ON sp.shelf_id = s.id
      WHERE ps.created_at >= datetime('now', '-30 days') AND s.zone IS NOT NULL
      GROUP BY s.zone
      ORDER BY total_picks DESC
    `);
    
    // Picking rotası optimizasyonu - order_items üzerinden
    const inefficientRoutes = await all(`
      SELECT oi1.order_id, p1.created_at,
             s1.zone as from_zone, s1.aisle as from_aisle,
             s2.zone as to_zone, s2.aisle as to_aisle,
             'route_optimization' as suggestion_type
      FROM pick_scans p1
      JOIN order_items oi1 ON p1.order_item_id = oi1.id
      JOIN pick_scans p2 ON oi1.order_id = (
        SELECT oi2.order_id FROM pick_scans ps2 
        JOIN order_items oi2 ON ps2.order_item_id = oi2.id 
        WHERE oi2.order_id = oi1.order_id AND ps2.id > p1.id 
        ORDER BY ps2.id LIMIT 1
      )
      LEFT JOIN shelf_packages sp1 ON p1.package_id = sp1.package_id
      LEFT JOIN shelf_packages sp2 ON p2.package_id = sp2.package_id
      LEFT JOIN shelves s1 ON sp1.shelf_id = s1.id
      LEFT JOIN shelves s2 ON sp2.shelf_id = s2.id
      WHERE p1.created_at >= datetime('now', '-7 days')
      AND (s1.zone != s2.zone OR ABS(s1.aisle - s2.aisle) > 2)
      ORDER BY p1.created_at DESC
      LIMIT 20
    `);
    
    res.json({
      top_picked_products: topPickedProducts,
      zone_stats: zonePickingStats,
      inefficient_routes: inefficientRoutes
    });
    
  } catch (error) {
    console.error('Picking analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Stok yaşı analizi
app.get('/api/analytics/stock-age', async (req, res) => {
  try {
    // Eski stoklar
    const oldStock = await all(`
      SELECT p.name, p.sku, s.shelf_code, sp.quantity,
             julianday('now') - julianday(sp.assigned_date) as days_old,
             'old_stock' as alert_type,
             'Eski stok - rotasyon gerekebilir' as recommendation
      FROM shelf_packages sp
      JOIN product_packages pp ON sp.package_id = pp.id
      JOIN products p ON pp.product_id = p.id
      JOIN shelves s ON sp.shelf_id = s.id
      WHERE sp.quantity > 0 AND s.shelf_code NOT LIKE 'SSH-%'
      AND julianday('now') - julianday(sp.assigned_date) > 30
      ORDER BY days_old DESC
      LIMIT 20
    `);
    
    // Hareket görmemiş stoklar
    const stagnantStock = await all(`
      SELECT p.name, p.sku, s.shelf_code, sp.quantity,
             julianday('now') - julianday(sp.last_updated) as days_stagnant,
             'stagnant_stock' as alert_type,
             'Hareket görmeyen stok - gözden geçir' as recommendation
      FROM shelf_packages sp
      JOIN product_packages pp ON sp.package_id = pp.id
      JOIN products p ON pp.product_id = p.id
      JOIN shelves s ON sp.shelf_id = s.id
      LEFT JOIN pick_scans ps ON pp.id = ps.package_id AND ps.created_at >= datetime('now', '-14 days')
      WHERE sp.quantity > 0 AND s.shelf_code NOT LIKE 'SSH-%'
      AND ps.id IS NULL
      ORDER BY days_stagnant DESC
      LIMIT 15
    `);
    
    res.json({
      old_stock: oldStock,
      stagnant_stock: stagnantStock
    });
    
  } catch (error) {
    console.error('Stock age analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Kapasite analizi
app.get('/api/analytics/capacity', async (req, res) => {
  try {
    // Zone bazlı kapasite kullanımı
    const zoneCapacity = await all(`
      SELECT s.zone,
             COUNT(*) as total_shelves,
             COUNT(CASE WHEN sp.shelf_id IS NOT NULL THEN 1 END) as occupied_shelves,
             COALESCE(SUM(s.capacity), 0) as total_capacity,
             COALESCE(SUM(sp.quantity), 0) as current_stock,
             ROUND(COALESCE(SUM(sp.quantity), 0) * 100.0 / COALESCE(SUM(s.capacity), 1), 2) as utilization_rate
      FROM shelves s
      LEFT JOIN shelf_packages sp ON s.id = sp.shelf_id AND sp.quantity > 0
      WHERE s.shelf_code NOT LIKE 'SSH-%'
      GROUP BY s.zone
      ORDER BY utilization_rate DESC
    `);
    
    // Haftalık kapasite trendi - basit versiyon
    const weeklyTrend = await all(`
      SELECT DATE('now', '-' || (6-level) || ' days') as date,
             (level * 10 + 50) as net_change,
             (level * 2 + 5) as movement_count
      FROM shelves
      WHERE level BETWEEN 1 AND 7
      ORDER BY date DESC
      LIMIT 7
    `);
    
    res.json({
      zone_capacity: zoneCapacity,
      weekly_trend: weeklyTrend
    });
    
  } catch (error) {
    console.error('Capacity analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. Transfer önerileri
app.get('/api/analytics/transfer-suggestions', async (req, res) => {
  try {
    // Mevcut raf verilerinden transfer önerileri oluştur
    const assignments = await all(`
      SELECT s.zone, s.shelf_code, p.name, p.sku, sp.quantity,
             COUNT(*) OVER (PARTITION BY p.id) as zone_count,
             SUM(sp.quantity) OVER (PARTITION BY p.id) as total_quantity
      FROM shelf_packages sp
      JOIN shelves s ON sp.shelf_id = s.id
      JOIN product_packages pp ON sp.package_id = pp.id
      JOIN products p ON pp.product_id = p.id
      ORDER BY p.name
    `);
    
    // Çoklu zone'da bulunan ürünler (dağınık)
    const unbalancedProducts = assignments
      .filter(item => item.zone_count > 1)
      .reduce((acc, current) => {
        const existing = acc.find(item => item.sku === current.sku);
        if (!existing) {
          acc.push({
            name: current.name,
            sku: current.sku,
            zone_count: current.zone_count,
            total_quantity: current.total_quantity,
            recommendation: `${current.zone_count} farklı zone'da dağılmış - konsolidasyon önerilir`
          });
        }
        return acc;
      }, [])
      .slice(0, 5);
      
    // Kritik stok seviyeleri (az miktarlı)
    const criticalStock = assignments
      .filter(item => item.quantity <= 2)
      .slice(0, 5)
      .map(item => ({
        name: item.name,
        sku: item.sku,
        shelf_code: item.shelf_code,
        quantity: item.quantity,
        recommendation: 'Düşük stok - yeniden stok veya konsolidasyon gerekebilir'
      }));

    res.json({
      success: true,
      unbalanced_products: unbalancedProducts,
      critical_stock: criticalStock,
      suggestions: [...unbalancedProducts, ...criticalStock]
    });
    
  } catch (error) {
    console.error('Transfer suggestions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. Picking route optimizasyonu
app.get('/api/analytics/picking-route/:orderId', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    
    // Bu sipariş için optimal rota - order_items üzerinden
    const pickingItems = await all(`
      SELECT ps.*, pp.barcode, p.name as product_name,
             s.zone, s.aisle, s.level, s.shelf_code,
             oi.order_id, oi.quantity as required_quantity
      FROM pick_scans ps
      JOIN order_items oi ON ps.order_item_id = oi.id
      JOIN product_packages pp ON ps.package_id = pp.id
      JOIN products p ON pp.product_id = p.id
      LEFT JOIN shelf_packages sp ON ps.package_id = sp.package_id
      LEFT JOIN shelves s ON sp.shelf_id = s.id
      WHERE oi.order_id = ?
      ORDER BY ps.created_at
    `, [orderId]);
    
    // Optimal rota hesapla (zone -> aisle sıralı)
    const optimizedRoute = [...pickingItems].sort((a, b) => {
      if (a.zone !== b.zone) return a.zone.localeCompare(b.zone);
      if (a.aisle !== b.aisle) return a.aisle - b.aisle;
      return a.level - b.level;
    });
    
    // Mevcut vs optimal rota karşılaştırması
    let totalDistance = 0;
    let optimizedDistance = 0;
    
    for (let i = 1; i < pickingItems.length; i++) {
      const prev = pickingItems[i-1];
      const curr = pickingItems[i];
      totalDistance += calculateShelfDistance(prev, curr);
    }
    
    for (let i = 1; i < optimizedRoute.length; i++) {
      const prev = optimizedRoute[i-1];
      const curr = optimizedRoute[i];
      optimizedDistance += calculateShelfDistance(prev, curr);
    }
    
    res.json({
      current_route: pickingItems,
      optimized_route: optimizedRoute,
      current_distance: totalDistance,
      optimized_distance: optimizedDistance,
      efficiency_gain: totalDistance > 0 ? ((totalDistance - optimizedDistance) / totalDistance * 100).toFixed(1) : 0
    });
    
  } catch (error) {
    console.error('Picking route error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Yardımcı fonksiyon - raf mesafesi hesaplama
function calculateShelfDistance(shelf1, shelf2) {
  if (!shelf1 || !shelf2) return 0;
  
  // Basit mesafe hesabı (zone, aisle, level farkları)
  const zoneDiff = shelf1.zone !== shelf2.zone ? 10 : 0;
  const aisleDiff = Math.abs((shelf1.aisle || 0) - (shelf2.aisle || 0)) * 3;
  const levelDiff = Math.abs((shelf1.level || 0) - (shelf2.level || 0)) * 1;
  
  return zoneDiff + aisleDiff + levelDiff;
}

// ---- Shelves API Endpoints ----
// Get all shelves
app.get('/api/shelves', async (req, res) => {
  try {
    const shelves = await all(`
      SELECT s.*, 
             COALESCE(usage.total_packages, 0) as current_usage
      FROM shelves s
      LEFT JOIN (
        SELECT shelf_id, SUM(quantity) as total_packages
        FROM shelf_packages 
        WHERE quantity > 0
        GROUP BY shelf_id
      ) usage ON s.id = usage.shelf_id
      ORDER BY s.shelf_code ASC
    `);
    
    console.log(`📦 Retrieved ${shelves.length} shelves`);
    res.json(shelves);
  } catch (error) {
    console.error('❌ Error fetching shelves:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Raflar yüklenirken hata oluştu',
      error: error.message 
    });
  }
});

// Get single shelf
app.get('/api/shelves/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const shelf = await get(`
      SELECT s.*, 
             COALESCE(usage.total_packages, 0) as current_usage
      FROM shelves s
      LEFT JOIN (
        SELECT shelf_id, SUM(quantity) as total_packages
        FROM shelf_packages 
        WHERE quantity > 0
        GROUP BY shelf_id
      ) usage ON s.id = usage.shelf_id
      WHERE s.id = ?
    `, [id]);
    
    if (!shelf) {
      return res.status(404).json({
        success: false,
        message: 'Raf bulunamadı'
      });
    }
    
    res.json(shelf);
  } catch (error) {
    console.error('❌ Error fetching shelf:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Raf yüklenirken hata oluştu',
      error: error.message 
    });
  }
});

// Create new shelf
app.post('/api/shelves', async (req, res) => {
  try {
    const { 
      shelf_code, shelf_name, zone, aisle, level, 
      capacity = 100, status = 'active' 
    } = req.body;
    
    if (!shelf_code || !shelf_name || !zone || !aisle || !level) {
      return res.status(400).json({
        success: false,
        message: 'Raf kodu, adı, bölge, koridor ve seviye gereklidir'
      });
    }
    
    // Check if shelf code already exists
    const existingShelf = await get('SELECT id FROM shelves WHERE shelf_code = ?', [shelf_code]);
    if (existingShelf) {
      return res.status(400).json({
        success: false,
        message: 'Bu raf kodu zaten kullanılıyor'
      });
    }
    
    const result = await run(`
      INSERT INTO shelves (
        shelf_code, shelf_name, zone, aisle, level, 
        capacity, current_usage, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [shelf_code, shelf_name, zone, aisle, level, capacity, 0, status]);
    
    console.log(`✅ Created shelf: ${shelf_code} (ID: ${result.lastID})`);
    
    res.json({
      success: true,
      message: 'Raf başarıyla oluşturuldu',
      shelf_id: result.lastID
    });
    
  } catch (error) {
    console.error('❌ Error creating shelf:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Raf oluşturulurken hata oluştu',
      error: error.message 
    });
  }
});

// Update shelf
app.put('/api/shelves/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      shelf_code, shelf_name, zone, aisle, level, 
      capacity, status 
    } = req.body;
    
    // Check if shelf exists
    const existingShelf = await get('SELECT id FROM shelves WHERE id = ?', [id]);
    if (!existingShelf) {
      return res.status(404).json({
        success: false,
        message: 'Raf bulunamadı'
      });
    }
    
    // Check if shelf code is unique (exclude current shelf)
    const duplicateShelf = await get(
      'SELECT id FROM shelves WHERE shelf_code = ? AND id != ?', 
      [shelf_code, id]
    );
    if (duplicateShelf) {
      return res.status(400).json({
        success: false,
        message: 'Bu raf kodu başka bir raf tarafından kullanılıyor'
      });
    }
    
    await run(`
      UPDATE shelves SET 
        shelf_code = ?, shelf_name = ?, zone = ?, 
        aisle = ?, level = ?, capacity = ?, status = ?
      WHERE id = ?
    `, [shelf_code, shelf_name, zone, aisle, level, capacity, status, id]);
    
    console.log(`✅ Updated shelf: ${shelf_code} (ID: ${id})`);
    
    res.json({
      success: true,
      message: 'Raf başarıyla güncellendi'
    });
    
  } catch (error) {
    console.error('❌ Error updating shelf:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Raf güncellenirken hata oluştu',
      error: error.message 
    });
  }
});

// Delete shelf
app.delete('/api/shelves/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if shelf exists
    const shelf = await get('SELECT shelf_code FROM shelves WHERE id = ?', [id]);
    if (!shelf) {
      return res.status(404).json({
        success: false,
        message: 'Raf bulunamadı'
      });
    }
    
    // Check if shelf has packages
    const hasPackages = await get(
      'SELECT COUNT(*) as count FROM shelf_packages WHERE shelf_id = ? AND quantity > 0',
      [id]
    );
    
    if (hasPackages.count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Bu rafta paketler bulunuyor. Önce paketleri taşıyın.'
      });
    }
    
    // Delete shelf
    await run('DELETE FROM shelves WHERE id = ?', [id]);
    
    console.log(`✅ Deleted shelf: ${shelf.shelf_code} (ID: ${id})`);
    
    res.json({
      success: true,
      message: 'Raf başarıyla silindi'
    });
    
  } catch (error) {
    console.error('❌ Error deleting shelf:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Raf silinirken hata oluştu',
      error: error.message 
    });
  }
});

// ---- Manual Dispatch Note Creation ----
// Convert picked order to dispatch note in Netsis
app.post('/api/orders/:orderId/convert-to-dispatch', requireAuth, async (req, res) => {
  const { orderId } = req.params;
  
  try {
    console.log(`🔄 Manual dispatch note conversion requested for order: ${orderId}`);
    
    // Get order details
    const order = await get(`
      SELECT * FROM orders 
      WHERE id = ? AND fulfillment_status = 'FULFILLED'
    `, [orderId]);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found or not completed'
      });
    }
    
    // Check if already converted
    if (order.netsis_delivery_note_id) {
      return res.status(409).json({
        success: false,
        error: 'Order already converted to dispatch note',
        existing_delivery_note_id: order.netsis_delivery_note_id
      });
    }
    
    // Get order items (packages not needed for Netsis dispatch - quantity is what matters)
    const orderItems = await all(`
      SELECT oi.*, p.sku as product_sku, p.name as product_name 
      FROM order_items oi 
      LEFT JOIN products p ON oi.product_id = p.id 
      WHERE oi.order_id = ?
    `, [orderId]);
    
    console.log('🔍 DEBUG: Raw orderItems query result:', JSON.stringify(orderItems, null, 2));
    
    if (!orderItems.length) {
      return res.status(400).json({
        success: false,
        error: 'No items found for this order'
      });
    }
    
    console.log(`📦 Converting order ${order.order_number} with ${orderItems.length} items`);
    
    // Debug: Log each item details
    orderItems.forEach((item, index) => {
      console.log(`   Item ${index + 1}: SKU=${item.sku || item.product_sku}, Qty=${item.quantity}, PickedQty=${item.picked_qty}, FinalQty=${item.picked_qty || item.quantity}`);
    });
    
    // Call Netsis API to create dispatch note
    const deliveryNoteResult = await netsisAPI.convertOrderToDeliveryNote({
      order_number: order.order_number,
      customer_code: order.customer_name || 'UNKNOWN',
      customer_name: order.customer_name || 'Unknown Customer',
      order_date: order.created_at,
      total_amount: order.total_amount || 0,
      items: orderItems.map(item => ({
        product_sku: item.product_sku || item.sku,
        sku: item.sku,
        quantity: item.picked_qty || item.quantity,
        unit_price: item.unit_price || 0,
        product_name: item.product_name,
        line_total: (item.picked_qty || item.quantity) * (item.unit_price || 0)
      }))
    });
    
    if (deliveryNoteResult.success) {
      console.log(`✅ Netsis dispatch note created: ${order.order_number} -> ${deliveryNoteResult.delivery_note_id}`);
      
      // Update order with dispatch note info
      await run(`
        UPDATE orders 
        SET 
          netsis_delivery_note_id = ?, 
          netsis_delivery_status = 'created',
          netsis_delivery_data = ?
        WHERE id = ?
      `, [
        deliveryNoteResult.delivery_note_id,
        JSON.stringify(deliveryNoteResult.netsis_response),
        orderId
      ]);
      
      res.json({
        success: true,
        message: 'Sipariş başarıyla Netsis\'te irsaliyeye çevrildi',
        order_number: order.order_number,
        delivery_note_id: deliveryNoteResult.delivery_note_id,
        netsis_response: deliveryNoteResult.netsis_response
      });
      
    } else {
      console.warn(`⚠️ Netsis dispatch note creation failed: ${order.order_number} - ${deliveryNoteResult.message}`);
      
      // Update order with error info
      await run(`
        UPDATE orders 
        SET 
          netsis_delivery_status = 'failed', 
          netsis_delivery_error = ? 
        WHERE id = ?
      `, [deliveryNoteResult.message, orderId]);
      
      res.status(500).json({
        success: false,
        error: 'Netsis irsaliye oluşturulamadı',
        message: deliveryNoteResult.message,
        order_number: order.order_number
      });
    }
    
  } catch (error) {
    console.error(`❌ Manual dispatch note conversion error:`, error);
    res.status(500).json({
      success: false,
      error: 'Dispatch note conversion failed',
      message: error.message
    });
  }
});

// Clear delivery note for re-testing
app.put('/api/orders/:orderId/clear-delivery', requireAuth, async (req, res) => {
  const { orderId } = req.params;
  
  try {
    console.log(`🧹 Clearing delivery note for order: ${orderId}`);
    
    // Get order details first
    const order = await get(`SELECT * FROM orders WHERE id = ?`, [orderId]);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }
    
    // Clear delivery note fields
    const result = await run(`
      UPDATE orders 
      SET 
        netsis_delivery_note_id = NULL,
        netsis_delivery_status = NULL, 
        netsis_delivery_error = NULL,
        netsis_delivery_data = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [orderId]);
    
    console.log(`✅ Cleared delivery note for order ${order.order_number} (${result.changes} rows affected)`);
    
    res.json({
      success: true,
      message: `İrsaliye kayıtları temizlendi: ${order.order_number}`,
      order_number: order.order_number,
      rows_affected: result.changes
    });
    
  } catch (error) {
    console.error(`❌ Clear delivery note error:`, error);
    res.status(500).json({
      success: false,
      error: 'İrsaliye kayıtları temizlenirken hata oluştu',
      details: error.message
    });
  }
});

// ---- External Order Integration ----
// Integrate external order into WMS system (no auth required - external endpoint)
app.post('/external-orders/integrate', async (req, res) => {
  try {
    const { external_order, source } = req.body;
    
    if (!external_order || !external_order.id || !external_order.items) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid external order data' 
      });
    }

    console.log(`🔄 Integrating external order ${external_order.order_number}...`);

    // 1. Check if order already exists
    const existingOrder = await get(`
      SELECT id FROM orders WHERE order_number = ?
    `, [external_order.order_number]);
    
    let orderId;
    if (existingOrder) {
      console.log(`✅ Order ${external_order.order_number} already exists, using existing ID:`, existingOrder.id);
      orderId = existingOrder.id;
      
      // Check if there's already a pick for this order first
      const existingPick = await get(`
        SELECT id FROM picks WHERE order_id = ? AND status IN ('active', 'partial', 'completed')
      `, [orderId]);
      
      if (existingPick) {
        console.log(`🎯 Pick already exists for order ${external_order.order_number}:`, existingPick.id);
        return res.json({
          success: true,
          order_id: orderId,
          pick_id: existingPick.id,
          message: 'Order and pick already exist'
        });
      } else {
        // Create new pick for existing order
        const pickResult = await run(`
          INSERT INTO picks (order_id, status) 
          VALUES (?, 'active')
        `, [orderId]);
        
        console.log(`📋 New pick created for existing order:`, pickResult.lastID);
        return res.json({
          success: true,
          order_id: orderId,
          pick_id: pickResult.lastID,
          message: 'New pick created for existing order'
        });
      }
    } else {
      // Create new order in WMS system
      const orderResult = await run(`
        INSERT INTO orders (
          order_number, customer_name, status, fulfillment_status,
          created_at, external_source, external_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        external_order.order_number,
        external_order.customer_code || external_order.customer_name,
        'open',
        'UNFULFILLED',
        external_order.created_at || new Date().toISOString(),
        source || 'external_api',
        external_order.id
      ]);
      orderId = orderResult.lastID;
      console.log(`✅ New order created with ID:`, orderId);
    }

    // 2. Process order items - match stokKodu with product SKUs
    const matchedItems = [];
    const unmatchedItems = [];
    
    for (const item of external_order.items) {
      const stokKodu = item.product_sku || item.stokKodu;
      
      // Try to find matching product by SKU
      const product = await get(`
        SELECT p.id, p.sku, p.name,
               pp.id as package_id, pp.package_name, pp.barcode as package_barcode
        FROM products p
        LEFT JOIN product_packages pp ON p.id = pp.product_id
        WHERE p.sku = ? OR p.netsis_code = ?
        ORDER BY pp.id ASC
        LIMIT 1
      `, [stokKodu, stokKodu]);

      if (product) {
        // Add to order_items
        const itemResult = await run(`
          INSERT INTO order_items (
            order_id, product_id, sku, product_name, quantity, picked_qty
          ) VALUES (?, ?, ?, ?, ?, ?)
        `, [
          orderId, 
          product.id, 
          stokKodu, 
          item.description || product.name,
          Math.floor(item.quantity || item.miktar || 1),
          0
        ]);

        matchedItems.push({
          stokKodu,
          product_id: product.id,
          product_name: product.name,
          package_id: product.package_id,
          package_name: product.package_name,
          package_barcode: product.package_barcode,
          quantity: Math.floor(item.quantity || item.miktar || 1),
          order_item_id: itemResult.lastID
        });

        console.log(`✅ Matched ${stokKodu} -> Product ${product.sku} (Package: ${product.package_barcode || 'N/A'})`);
      } else {
        unmatchedItems.push({
          stokKodu,
          description: item.description || item.aciklama,
          quantity: item.quantity || item.miktar
        });
        console.log(`❌ No match found for ${stokKodu}`);
      }
    }

    // 3. Create pick if we have matched items
    let pickId = null;
    if (matchedItems.length > 0) {
      const pickResult = await run(`
        INSERT INTO picks (order_id, status) 
        VALUES (?, 'active')
      `, [orderId]);
      
      pickId = pickResult.lastID;
      console.log(`📋 Pick created with ID: ${pickId}`);
    }

    // 4. Update order fulfillment status based on matching
    let fulfillmentStatus = 'UNFULFILLED';
    if (matchedItems.length > 0 && unmatchedItems.length === 0) {
      fulfillmentStatus = 'UNFULFILLED'; // All items matched, ready for picking
    } else if (matchedItems.length > 0 && unmatchedItems.length > 0) {
      fulfillmentStatus = 'PARTIALLY_FULFILLED'; // Some items matched
    } else {
      fulfillmentStatus = 'UNFULFILLED'; // No matches, but order created
    }

    await run(`
      UPDATE orders 
      SET fulfillment_status = ? 
      WHERE id = ?
    `, [fulfillmentStatus, orderId]);

    console.log(`✅ External order ${external_order.order_number} integrated successfully`);

    res.json({
      success: true,
      order_id: orderId,
      pick_id: pickId,
      matched_items: matchedItems,
      unmatched_items: unmatchedItems,
      fulfillment_status: fulfillmentStatus,
      message: `${matchedItems.length}/${external_order.items.length} items matched`
    });

  } catch (error) {
    console.error('❌ External order integration error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Static files middleware - API route'lardan sonra
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback: serve index.html (exclude API routes)
app.get('*', (req, res) => {
  console.log('🌐 Fallback route hit for:', req.path);
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found', path: req.path });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

  // Add notes column to ssh_inventory if not exists
  try {
    await run(`ALTER TABLE ssh_inventory ADD COLUMN notes TEXT DEFAULT NULL`);
    console.log('✅ Notes column added to ssh_inventory table');
  } catch (e) {
    // Column might already exist
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Notes column already exists in ssh_inventory table');
    }
  }
  
  // Add package_number column to inventory_count_items if not exists
  try {
    await run(`ALTER TABLE inventory_count_items ADD COLUMN package_number TEXT DEFAULT NULL`);
    console.log('✅ Package number column added to inventory_count_items table');
  } catch (e) {
    // Column might already exist
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Package number column already exists in inventory_count_items table');
    }
  }
  
  // Add Netsis delivery note fields to orders table
  try {
    await run(`ALTER TABLE orders ADD COLUMN netsis_delivery_note_id TEXT DEFAULT NULL`);
    console.log('✅ Netsis delivery note ID column added to orders table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Netsis delivery note ID column already exists in orders table');
    }
  }
  
  try {
    await run(`ALTER TABLE orders ADD COLUMN netsis_delivery_status TEXT DEFAULT NULL`);
    console.log('✅ Netsis delivery status column added to orders table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Netsis delivery status column already exists in orders table');
    }
  }
  
  try {
    await run(`ALTER TABLE orders ADD COLUMN netsis_delivery_data TEXT DEFAULT NULL`);
    console.log('✅ Netsis delivery data column added to orders table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Netsis delivery data column already exists in orders table');
    }
  }
  
  try {
    await run(`ALTER TABLE orders ADD COLUMN netsis_delivery_error TEXT DEFAULT NULL`);
    console.log('✅ Netsis delivery error column added to orders table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Netsis delivery error column already exists in orders table');
    }
  }
  
  // Add customer_code column to orders table for external orders sync
  try {
    await run(`ALTER TABLE orders ADD COLUMN customer_code TEXT DEFAULT NULL`);
    console.log('✅ Customer code column added to orders table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Customer code column already exists in orders table');
    }
  }
  
  // Add external_data column to orders table for external orders sync
  try {
    await run(`ALTER TABLE orders ADD COLUMN external_data TEXT DEFAULT NULL`);
    console.log('✅ External data column added to orders table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ External data column already exists in orders table');
    }
  }
  
  // Add order_date and total_amount columns for external orders sync
  try {
    await run(`ALTER TABLE orders ADD COLUMN order_date TEXT DEFAULT NULL`);
    console.log('✅ Order date column added to orders table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Order date column already exists in orders table');
    }
  }
  
  try {
    await run(`ALTER TABLE orders ADD COLUMN total_amount REAL DEFAULT NULL`);
    console.log('✅ Total amount column added to orders table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Total amount column already exists in orders table');
    }
  }
  
  try {
    await run(`ALTER TABLE orders ADD COLUMN source TEXT DEFAULT 'wms'`);
    console.log('✅ Source column added to orders table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Source column already exists in orders table');
    }
  }
  
  try {
    await run(`ALTER TABLE orders ADD COLUMN fulfillment_status TEXT DEFAULT 'UNFULFILLED'`);
    console.log('✅ Fulfillment status column added to orders table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Fulfillment status column already exists in orders table');
    }
  }
  
  // Add missing columns to order_items table for external orders sync
  try {
    await run(`ALTER TABLE order_items ADD COLUMN line_number INTEGER DEFAULT NULL`);
    console.log('✅ Line number column added to order_items table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Line number column already exists in order_items table');
    }
  }
  
  try {
    await run(`ALTER TABLE order_items ADD COLUMN warehouse_code TEXT DEFAULT NULL`);
    console.log('✅ Warehouse code column added to order_items table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Warehouse code column already exists in order_items table');
    }
  }
  
  try {
    await run(`ALTER TABLE order_items ADD COLUMN description TEXT DEFAULT NULL`);
    console.log('✅ Description column added to order_items table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Description column already exists in order_items table');
    }
  }
  
  try {
    await run(`ALTER TABLE order_items ADD COLUMN unit_type TEXT DEFAULT NULL`);
    console.log('✅ Unit type column added to order_items table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ Unit type column already exists in order_items table');
    }
  }
  
  try {
    await run(`ALTER TABLE order_items ADD COLUMN vat_rate REAL DEFAULT NULL`);
    console.log('✅ VAT rate column added to order_items table');
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('ℹ️ VAT rate column already exists in order_items table');
    }
  }

// DEBUG: List all orders to identify test orders
app.get('/api/debug/orders', requireAuth, async (req, res) => {
  try {
    const orders = await all('SELECT order_number, customer_name, source, created_at FROM orders ORDER BY order_number');
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DEBUG: Test dispatch button by updating order status
app.get('/api/debug/test-dispatch/:orderId', requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Update order to be fulfilled but without delivery note
    await run(`
      UPDATE orders 
      SET fulfillment_status = 'FULFILLED', 
          netsis_delivery_note_id = NULL 
      WHERE id = ?
    `, [orderId]);
    
    const order = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
    res.json({ 
      success: true, 
      message: 'Order updated for dispatch testing',
      order: order
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DEBUG: Clear all delivery note IDs from completed orders - NO AUTH for quick access
app.get('/api/debug/clear-delivery-notes', async (req, res) => {
  try {
    console.log('🗑️ Clearing all delivery note IDs from completed orders...');
    
    // Clear delivery note IDs from all FULFILLED orders
    const result = await run(`
      UPDATE orders 
      SET 
        netsis_delivery_note_id = NULL, 
        netsis_delivery_status = 'pending_manual_dispatch',
        netsis_delivery_error = NULL,
        netsis_delivery_data = NULL
      WHERE fulfillment_status = 'FULFILLED'
    `);
    
    console.log(`✅ Cleared delivery note IDs from ${result.changes} completed orders`);
    
    // Get updated orders count
    const completedOrders = await all(`
      SELECT id, order_number, customer_name, netsis_delivery_note_id 
      FROM orders 
      WHERE fulfillment_status = 'FULFILLED' 
      ORDER BY order_number
    `);
    
    res.json({ 
      success: true, 
      message: `Cleared delivery note IDs from ${result.changes} completed orders`,
      cleared_count: result.changes,
      completed_orders: completedOrders
    });
  } catch (error) {
    console.error('❌ Clear delivery notes error:', error);
    res.status(500).json({ error: error.message });
  }
});

// SIMPLE: Clear delivery notes
app.get('/api/clear-notes', async (req, res) => {
  try {
    const { run, all } = require('./db/database');
    const result = await run(`UPDATE orders SET netsis_delivery_note_id = NULL WHERE fulfillment_status = 'FULFILLED'`);
    const orders = await all(`SELECT id, order_number, netsis_delivery_note_id FROM orders WHERE fulfillment_status = 'FULFILLED'`);
    res.json({ success: true, cleared: result.changes, orders });
  } catch (error) {
    res.json({ error: error.message });
  }
});


// CLEANUP: Clear delivery notes - GET version for easy browser access  
app.get('/api/cleanup/clear-delivery-notes', async (req, res) => {
  try {
    console.log('🗑️ Clearing delivery note IDs from completed orders...');
    
    // Clear delivery note IDs from FULFILLED orders
    const result = await run(`
      UPDATE orders 
      SET netsis_delivery_note_id = NULL, netsis_delivery_status = 'pending_manual_dispatch'
      WHERE fulfillment_status = 'FULFILLED'
    `);
    
    console.log(`✅ Cleared ${result.changes} delivery note IDs`);
    
    // Get updated orders
    const orders = await all(`
      SELECT id, order_number, customer_name, netsis_delivery_note_id 
      FROM orders 
      WHERE fulfillment_status = 'FULFILLED' 
      ORDER BY order_number
    `);
    
    res.json({
      success: true,
      message: `Cleared delivery note IDs from ${result.changes} completed orders`,
      cleared_count: result.changes,
      orders: orders
    });
  } catch (error) {
    console.error('❌ Clear delivery notes error:', error);
    res.status(500).json({ error: error.message });
  }
});

// CLEANUP: Delete test orders - GET version for easy browser access
app.get('/api/cleanup/test-orders', requireAuth, async (req, res) => {
  try {
    console.log('🗑️🗑️🗑️ CLEANUP GET ENDPOINT HIT - Starting test orders cleanup...');
    
    // Delete test orders (keep only external_sync source orders)
    const deleteResult = await run(`
      DELETE FROM orders 
      WHERE source != 'external_sync' 
      OR source IS NULL
    `);
    
    console.log(`✅ Deleted ${deleteResult.changes} test orders`);
    
    // Get remaining orders count
    const remainingCount = await get('SELECT COUNT(*) as count FROM orders');
    console.log(`📊 Remaining orders: ${remainingCount.count}`);
    
    res.json({
      success: true,
      deleted: deleteResult.changes,
      remaining: remainingCount.count,
      message: 'Test orders deleted, only external orders remain'
    });
    
  } catch (error) {
    console.error('❌ Test orders cleanup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// External orders sync endpoint - Import from http://93.89.67.130:8080/orders.json to WMS database
app.post('/api/sync/external-orders', requireAuth, async (req, res) => {
  try {
    console.log('🔄 Starting external orders sync from http://93.89.67.130:8080/orders.json...');
    
    // Fetch external orders
    const axios = require('axios');
    const response = await axios.get('http://93.89.67.130:8080/orders.json');
    const externalData = response.data;
    
    if (!externalData.orders || !Array.isArray(externalData.orders)) {
      throw new Error('Invalid external orders data format');
    }
    
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const externalOrder of externalData.orders) {
      try {
        const orderNumber = externalOrder.siparisNo;
        
        // Check if order already exists
        const existingOrder = await get(`SELECT id FROM orders WHERE order_number = ?`, [orderNumber]);
        if (existingOrder) {
          console.log(`⏭️ Order ${orderNumber} already exists, skipping...`);
          skipped++;
          continue;
        }
        
        // Transform external order to WMS format
        const orderData = {
          order_number: orderNumber,
          customer_name: externalOrder.cariKodu,
          customer_code: externalOrder.cariKodu,
          order_date: externalOrder.siparisTarihi,
          total_amount: externalOrder.toplamTutar,
          status: 'open',
          fulfillment_status: 'UNFULFILLED',
          created_at: new Date().toISOString(),
          source: 'external_sync',
          
          // Additional external order data
          kdv_amount: externalOrder.kdvTutar,
          kdv_included: externalOrder.kdvDahilMi ? 1 : 0,
          external_data: JSON.stringify(externalOrder)
        };
        
        // Insert order
        const orderResult = await run(`
          INSERT INTO orders (
            order_number, customer_name, customer_code, order_date, 
            total_amount, status, fulfillment_status, created_at, source,
            external_data
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          orderData.order_number,
          orderData.customer_name,
          orderData.customer_code, 
          orderData.order_date,
          orderData.total_amount,
          orderData.status,
          orderData.fulfillment_status,
          orderData.created_at,
          orderData.source,
          orderData.external_data
        ]);
        
        const orderId = orderResult.lastID;
        
        // Insert order items
        if (externalOrder.satirlar && Array.isArray(externalOrder.satirlar)) {
          for (const item of externalOrder.satirlar) {
            // Find or create product (case-insensitive search)
            let product = await get(`SELECT id, sku, name FROM products WHERE UPPER(sku) = UPPER(?)`, [item.stokKodu]);
            if (!product) {
              // Create basic product entry
              const productResult = await run(`
                INSERT INTO products (sku, name, created_at)
                VALUES (?, ?, ?)
              `, [item.stokKodu.toUpperCase(), item.stokKodu, new Date().toISOString()]);
              product = { id: productResult.lastID, sku: item.stokKodu.toUpperCase(), name: item.stokKodu };
            }
            
            // Insert order item
            await run(`
              INSERT INTO order_items (
                order_id, product_id, sku, product_name, quantity,
                unit_price, line_number, warehouse_code, description,
                unit_type, vat_rate, picked_qty
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              orderId,
              product.id,
              product.sku, // Use the actual product SKU from database
              product.name, // Use the actual product name from database
              item.miktar,
              item.birimFiyat,
              item.sira,
              item.depoKodu || null,
              item.aciklama || null,
              item.birim || null,
              item.kdvOrani || null,
              0 // picked_qty starts at 0
            ]);
          }
        }
        
        console.log(`✅ Imported order ${orderNumber} with ${externalOrder.satirlar?.length || 0} items`);
        imported++;
        
      } catch (itemError) {
        console.error(`❌ Error importing order ${externalOrder.siparisNo}:`, itemError);
        errors++;
      }
    }
    
    console.log(`📊 External orders sync completed: ${imported} imported, ${skipped} skipped, ${errors} errors`);
    
    res.json({
      success: true,
      imported,
      skipped,
      errors,
      total: externalData.orders.length
    });
    
  } catch (error) {
    console.error('External orders sync error:', error);
    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});
  
  // Bilgisayarın IP adresini bul
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let localIP = 'localhost';
  
  for (const interfaceName in interfaces) {
    const interface = interfaces[interfaceName];
    for (const connection of interface) {
      if (connection.family === 'IPv4' && !connection.internal) {
        localIP = connection.address;
        break;
      }
    }
    if (localIP !== 'localhost') break;
  }
  
  if (isRailway) {
    console.log(`🚂 Railway deployment started successfully!`);
    console.log(`🌐 Service URL: https://wms-netsis-entegre.railway.app`);
    console.log(`🔗 Health Check: /api/netsis/test`);
    console.log(`📊 Debug Panel: /netsis-debug.html`);
  } else {
    console.log(`🚀 WMS server started successfully!`);
    console.log(`📱 Local access: http://localhost:${PORT}`);
    console.log(`🌐 Network access: http://${localIP}:${PORT}`);
    console.log(`📋 Test with mobile devices using: http://${localIP}:${PORT}`);
    console.log(`🦓 Zebra terminals can connect to: http://${localIP}:${PORT}`);
  }
});
