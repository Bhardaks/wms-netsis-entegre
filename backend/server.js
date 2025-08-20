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

// Database Backup System
const DatabaseBackup = require('./db/backup');
const dbBackup = new DatabaseBackup();

// DB
const DB_PATH = path.join(__dirname, 'db', 'wms.db');
const db = new sqlite3.Database(DB_PATH);

// Create automatic backup on startup
dbBackup.autoBackup().catch(err => {
  console.warn('⚠️ Could not create startup backup:', err.message);
});

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());

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

// ---- Wix Sync ----
const wix = require('./services/wix');

// Pull products from Wix into local DB (variants become rows by SKU)
// Pull products from Wix into local DB (variants become rows by SKU) – robust V1/V3, proper names
app.post('/api/sync/wix/products', async (req, res) => {
  try {
    let total = 0, versionUsed = null;
    const seen = new Set();
    for await (const { item: prod, version } of wix.iterateProducts()) {
      versionUsed = version;
      const productId = prod.id || prod._id || prod.productId || prod.product?.id;
      const baseName = wix.s(prod.name || prod.product?.name || 'Ürün');
      const mainSku = prod.sku || prod.product?.sku || null;
      // Parse price properly
      let price = 0;
      if (prod.price?.amount) price = parseFloat(prod.price.amount);
      else if (prod.priceData?.price?.amount) price = parseFloat(prod.priceData.price.amount);
      else if (typeof prod.price === 'number') price = prod.price;
      
      // Parse inventory/stock data
      let inventoryQuantity = null;
      if (prod.stock?.quantity != null) {
        inventoryQuantity = parseInt(prod.stock.quantity, 10);
      } else if (prod.inventory?.quantity != null) {
        inventoryQuantity = parseInt(prod.inventory.quantity, 10);
      }
      
      const variants = prod.variants || prod.product?.variants || [];

      if (variants && variants.length) {
        for (const v of variants) {
          // Use enhanced SKU extraction for variants
          let vSku = wix.extractVariantSku(v, mainSku);
          
          // If still no SKU found, create a fallback UUID-based SKU
          if (!vSku) {
            vSku = `${productId}:${(v.id || v.variantId || 'var')}`;
          }
          
          if (seen.has(vSku)) continue;
          seen.add(vSku);
          const fullName = (baseName || 'Ürün') + wix.variantSuffix(v);
          // Parse variant price properly
          let vPrice = 0;
          if (v.price?.amount) vPrice = parseFloat(v.price.amount);
          else if (typeof v.price === 'number') vPrice = v.price;
          else vPrice = price;
          
          // Parse variant inventory
          let vInventoryQuantity = null;
          if (v.stock?.quantity != null) {
            vInventoryQuantity = parseInt(v.stock.quantity, 10);
          } else if (v.inventory?.quantity != null) {
            vInventoryQuantity = parseInt(v.inventory.quantity, 10);
          } else {
            vInventoryQuantity = inventoryQuantity; // fallback to main product inventory
          }
          
          await run(`INSERT INTO products (sku, name, description, main_barcode, price, wix_product_id, wix_variant_id, inventory_quantity)
                     VALUES (?,?,?,?,?,?,?,?)
                     ON CONFLICT(sku) DO UPDATE SET
                       name=excluded.name,
                       price=excluded.price,
                       inventory_quantity=excluded.inventory_quantity,
                       updated_at=CURRENT_TIMESTAMP`,
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
                       updated_at=CURRENT_TIMESTAMP`,
                    [String(sku), String(baseName || 'Ürün'), null, null, price, String(productId||''), null, inventoryQuantity]);
          total++;
        }
      }
    }
    res.json({ ok: true, imported: total, versionUsed });
  } catch (e) {
    console.error('Wix sync products error:', {
      message: e.message,
      response: e.response?.data,
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
      for await (const { item: prod, version } of wix.iterateProducts()) {
        versionUsed = version;
        const productId = prod.id || prod._id || prod.productId || prod.product?.id;
        const baseName = wix.s(prod.name || prod.product?.name || 'Ürün');
        const mainSku = prod.sku || prod.product?.sku || null;
        let price = 0;
        if (prod.price?.amount) price = parseFloat(prod.price.amount);
        else if (prod.priceData?.price?.amount) price = parseFloat(prod.priceData.price.amount);
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
  const rows = await all('SELECT * FROM products ORDER BY id DESC');
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
  const { sku, name, description, main_barcode, price, color } = req.body;
  try {
    await run(`UPDATE products SET sku=?, name=?, description=?, main_barcode=?, price=?, color=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [sku, name, description || null, main_barcode || null, price || 0, color || null, id]);
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

app.post('/api/products/:id/packages', async (req, res) => {
  const { id } = req.params;
  const { package_number, package_content, package_name, barcode, quantity, weight_kg, volume_m3 } = req.body;
  
  // Zorunlu alan kontrolü: package_number ve barcode
  if (!package_number || !package_number.trim()) {
    return res.status(400).json({ error: 'Paket numarası zorunludur' });
  }
  if (!barcode || !barcode.trim()) {
    return res.status(400).json({ error: 'Barkod zorunludur' });
  }
  
  try {
    await run(`INSERT INTO product_packages (product_id, package_number, package_content, package_name, barcode, quantity, weight_kg, volume_m3) VALUES (?,?,?,?,?,?,?,?)`,
      [id, package_number.trim(), package_content || package_name || null, package_name || package_content || null, barcode.trim(), quantity || 1, weight_kg || null, volume_m3 || null]);
    const row = await get('SELECT * FROM product_packages WHERE product_id=? AND barcode=?', [id, barcode.trim()]);
    res.status(201).json(row);
  } catch (e) {
    if (e.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: 'Bu barkod zaten kullanılıyor' });
    } else {
      res.status(400).json({ error: e.message });
    }
  }
});

app.put('/api/packages/:pkgId', async (req, res) => {
  const { pkgId } = req.params;
  const { package_number, package_content, barcode, quantity, weight_kg, volume_m3 } = req.body;
  
  // Zorunlu alan kontrolü: package_number ve barcode
  if (!package_number || !package_number.trim()) {
    return res.status(400).json({ error: 'Paket numarası zorunludur' });
  }
  if (!barcode || !barcode.trim()) {
    return res.status(400).json({ error: 'Barkod zorunludur' });
  }
  
  try {
    await run(`UPDATE product_packages SET 
                 package_number=?, package_content=?, barcode=?, quantity=?, weight_kg=?, volume_m3=?, updated_at=CURRENT_TIMESTAMP 
               WHERE id=?`,
              [package_number.trim(), package_content || null, barcode.trim(), parseInt(quantity) || 1, 
               weight_kg ? parseFloat(weight_kg) : null, volume_m3 ? parseFloat(volume_m3) : null, pkgId]);
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

// Test Netsis connection
app.get('/api/netsis/test', async (req, res) => {
  try {
    const result = await netsisAPI.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Netsis test failed', 
      error: error.message 
    });
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

// Sync products from Netsis to local DB
app.post('/api/netsis/sync/products', async (req, res) => {
  try {
    console.log('🔄 Netsis ürün senkronizasyonu başlatılıyor...');
    
    const products = await netsisAPI.getProducts(1000, 0);
    let syncCount = 0;
    
    if (products && products.data && Array.isArray(products.data)) {
      for (const product of products.data) {
        try {
          // Netsis'ten gelen ürün verilerini WMS formatına çevir
          const sku = product.Code || product.ItemCode;
          const name = product.Description || product.Name;
          const barcode = product.Barcode;
          
          if (sku && name) {
            await run(`
              INSERT INTO products (sku, name, barcode, netsis_id, created_at) 
              VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(sku) DO UPDATE SET
                name=excluded.name,
                barcode=excluded.barcode,
                netsis_id=excluded.netsis_id,
                updated_at=CURRENT_TIMESTAMP
            `, [sku, name, barcode || null, product.Id]);
            
            syncCount++;
          }
        } catch (error) {
          console.warn(`⚠️ Ürün senkronizasyon hatası (${product.Code}):`, error.message);
        }
      }
    }
    
    console.log(`✅ ${syncCount} ürün Netsis'ten senkronize edildi`);
    res.json({ 
      success: true, 
      message: `${syncCount} ürün başarıyla senkronize edildi`,
      syncedCount: syncCount
    });
    
  } catch (error) {
    console.error('❌ Netsis product sync error:', error);
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
  res.json(rows);
});

app.post('/api/orders', async (req, res) => {
  const { order_number, customer_name, items } = req.body;
  if (!order_number || !items || !items.length) {
    return res.status(400).json({ error: 'order_number and items are required' });
  }
  try {
    await run(`INSERT INTO orders (order_number, customer_name, status) VALUES (?,?, 'open')`,
      [order_number, customer_name || null]);
    const order = await get('SELECT * FROM orders WHERE order_number=?', [order_number]);
    for (const it of items) {
      const prod = await get('SELECT * FROM products WHERE id=?', [it.product_id]);
      if (!prod) throw new Error('Invalid product_id ' + it.product_id);
      await run(`INSERT INTO order_items (order_id, product_id, sku, product_name, quantity) VALUES (?,?,?,?,?)`,
        [order.id, prod.id, prod.sku, prod.name, parseInt(it.quantity || 1,10)]);
    }
    res.status(201).json(order);
  } catch (e) {
    res.status(400).json({ error: e.message });
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
  const pick = await get('SELECT * FROM picks WHERE id=?', [id]);
  if (!pick) return res.status(404).json({ error: 'Pick not found' });
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
  res.json({ pick, order, items, scans });
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

  // Check if order completed
  const remainingRow = await get(`SELECT COUNT(*) as remaining FROM order_items WHERE order_id=? AND picked_qty < quantity`, [pick.order_id]);
  const allPicked = remainingRow.remaining === 0;
  if (allPicked) {
    await run('UPDATE orders SET status="fulfilled", fulfillment_status="FULFILLED" WHERE id=?', [pick.order_id]);
    await run('UPDATE picks SET status="completed" WHERE id=?', [id]);
    
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
             COUNT(sp.id) as package_count,
             COALESCE(SUM(sp.quantity), 0) as total_quantity,
             GROUP_CONCAT(DISTINCT p.name) as product_names
      FROM shelves s
      LEFT JOIN shelf_packages sp ON s.id = sp.shelf_id AND sp.quantity > 0
      LEFT JOIN products p ON sp.product_id = p.id
      WHERE s.shelf_code NOT LIKE 'SSH-%'
      GROUP BY s.id
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
      JOIN products p ON sp.product_id = p.id
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
    
    if (!shelf_code || !package_barcode) {
      return res.status(400).json({ error: 'Raf kodu ve paket barkodu gerekli' });
    }
    
    // SSH raflarını engelle
    if (shelf_code.startsWith('SSH-')) {
      return res.status(400).json({ error: 'SSH rafları normal raf işlemlerinde kullanılamaz', shelf_code });
    }
    
    // Rafı bul
    const shelf = await get(`SELECT * FROM shelves WHERE shelf_code = ? AND shelf_code NOT LIKE 'SSH-%'`, [shelf_code]);
    if (!shelf) {
      return res.status(404).json({ error: 'Raf bulunamadı', shelf_code });
    }
    
    // Paketi bul
    const package = await get(`
      SELECT pp.*, p.name as product_name 
      FROM product_packages pp 
      JOIN products p ON pp.product_id = p.id 
      WHERE pp.barcode = ?
    `, [package_barcode]);
    
    if (!package) {
      return res.status(404).json({ error: 'Paket bulunamadı', package_barcode });
    }
    
    // Mevcut raf ataması var mı kontrol et
    const existing = await get(`
      SELECT * FROM shelf_packages WHERE shelf_id = ? AND package_id = ?
    `, [shelf.id, package.id]);
    
    let previousQty = 0;
    let newQty = quantity;
    
    if (existing) {
      // Mevcut atama varsa quantity güncelle
      previousQty = existing.quantity;
      newQty = previousQty + quantity;
      
      await run(`
        UPDATE shelf_packages 
        SET quantity = ?, last_updated = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [newQty, existing.id]);
    } else {
      // Yeni atama oluştur
      await run(`
        INSERT INTO shelf_packages (shelf_id, package_id, product_id, quantity, assigned_by)
        VALUES (?, ?, ?, ?, ?)
      `, [shelf.id, package.id, package.product_id, quantity, assigned_by]);
    }
    
    // Hareket kaydı oluştur
    await run(`
      INSERT INTO shelf_movements 
      (shelf_id, package_id, product_id, movement_type, quantity_change, previous_quantity, new_quantity, barcode_scanned, created_by)
      VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?)
    `, [shelf.id, package.id, package.product_id, quantity, previousQty, newQty, package_barcode, assigned_by]);
    
    res.json({ 
      success: true, 
      message: `${package.product_name} (${package.package_name}) ${shelf.shelf_name} rafına eklendi`,
      shelf: shelf.shelf_name,
      package: package.package_name,
      product: package.product_name,
      previous_quantity: previousQty,
      new_quantity: newQty,
      added_quantity: quantity
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
      JOIN products p ON sp.product_id = p.id
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
    
    // Hareket kaydı oluştur
    await run(`
      INSERT INTO shelf_movements 
      (shelf_id, package_id, product_id, movement_type, quantity_change, previous_quantity, new_quantity, barcode_scanned, created_by)
      VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?)
    `, [assignment.shelf_id, assignment.package_id, assignment.product_id, -quantity, previousQty, newQty, package_barcode, removed_by]);
    
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
    const assignments = await all(`
      SELECT sp.*, s.shelf_code, s.shelf_name, s.zone, s.aisle, s.level,
             pp.package_name, pp.package_number, pp.package_content, pp.barcode, pp.quantity as package_size,
             p.name as product_name, p.sku,
             DATE(sp.assigned_date) as assigned_date_formatted
      FROM shelf_packages sp
      JOIN shelves s ON sp.shelf_id = s.id
      JOIN product_packages pp ON sp.package_id = pp.id
      JOIN products p ON sp.product_id = p.id
      WHERE sp.quantity > 0
      ORDER BY s.zone, s.aisle, s.level, sp.assigned_date DESC
    `);
    
    res.json({ assignments });
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


// Network erişimi için tüm interface'lerde dinle
app.listen(PORT, '0.0.0.0', async () => {
  // Initialize database and users
  await initDatabase();
  
  // Test Netsis connection on startup
  console.log('🔄 Netsis bağlantısı test ediliyor...');
  const connectionTest = await netsisAPI.testConnection();
  
  if (connectionTest.success) {
    console.log('✅ Netsis entegrasyonu aktif');
  } else {
    console.log('⚠️ Netsis bağlantısı başarısız, uygulama yerel modda çalışacak');
    console.log('   Hata:', connectionTest.message);
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
      // Full count - all products (including zero stock)
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
    
    res.json(counts);
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
    
    res.json(items);
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
    
    if (!barcode) {
      return res.status(400).json({ error: 'Barcode required' });
    }
    
    // Check if count exists and is manual type
    const count = await get('SELECT * FROM inventory_counts WHERE id = ? AND type = "manual"', [id]);
    if (!count) {
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
    
    if (!productLocations || productLocations.length === 0) {
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
    // Toplam ürün sayısı
    const totalProducts = await get(`
      SELECT COUNT(DISTINCT p.id) as count 
      FROM products p
      JOIN shelf_packages sp ON p.id = sp.product_id
    `);
    
    // Düşük stok (<=5)
    const lowStock = await get(`
      SELECT COUNT(DISTINCT sp.product_id) as count 
      FROM shelf_packages sp
      WHERE sp.quantity > 0 AND sp.quantity <= 5
    `);
    
    // Stokta yok (=0)
    const outOfStock = await get(`
      SELECT COUNT(DISTINCT p.id) as count 
      FROM products p
      LEFT JOIN shelf_packages sp ON p.id = sp.product_id
      WHERE sp.quantity IS NULL OR sp.quantity = 0
    `);
    
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
          orderBy = 'main_product_quantity DESC';
          break;
        case 'stock_asc':
          orderBy = 'main_product_quantity ASC';
          break;
        case 'location':
          orderBy = 'p.sku ASC'; // Default to SKU for location sort
          break;
      }
    }
    
    // Ana sorgu - SSH-01-01 hariç paket bazında minimum hesapla
    let query = `
      SELECT 
        p.id as product_id,
        p.sku,
        p.name as product_name,
        (
          SELECT MIN(package_total)
          FROM (
            SELECT SUM(COALESCE(sp2.quantity, 0)) as package_total
            FROM product_packages pp2
            LEFT JOIN shelf_packages sp2 ON pp2.id = sp2.package_id
            LEFT JOIN shelves s2 ON sp2.shelf_id = s2.id
            WHERE pp2.product_id = p.id AND (s2.shelf_code != 'SSH-01-01' OR s2.shelf_code IS NULL)
            GROUP BY pp2.id
          )
        ) as main_product_quantity,
        COUNT(DISTINCT pp.id) as package_count,
        COUNT(DISTINCT CASE WHEN sp.quantity > 0 AND s.shelf_code != 'SSH-01-01' THEN s.id END) as location_count
      FROM products p
      LEFT JOIN shelf_packages sp ON p.id = sp.product_id
      LEFT JOIN product_packages pp ON sp.package_id = pp.id
      LEFT JOIN shelves s ON sp.shelf_id = s.id
      GROUP BY p.id, p.sku, p.name
      ORDER BY ${orderBy}
    `;
    
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
    // Boş raflar
    const emptyShelfSuggestions = await all(`
      SELECT s.*, 'empty_shelf' as suggestion_type, 'Boş raf - kullanıma hazır' as suggestion
      FROM shelves s
      LEFT JOIN shelf_packages sp ON s.id = sp.shelf_id AND sp.quantity > 0
      WHERE sp.id IS NULL AND s.shelf_code NOT LIKE 'SSH-%'
      ORDER BY s.zone, s.aisle, s.level
      LIMIT 10
    `);
    
    // Aşırı dolu raflar
    const overcrowdedShelves = await all(`
      SELECT s.*, COALESCE(SUM(sp.quantity), 0) as total_quantity,
             'overcrowded' as suggestion_type,
             'Çok dolu - yeni rafa dağıtılmalı' as suggestion
      FROM shelves s
      JOIN shelf_packages sp ON s.id = sp.shelf_id AND sp.quantity > 0
      WHERE s.shelf_code NOT LIKE 'SSH-%'
      GROUP BY s.id
      HAVING total_quantity > s.capacity * 0.8
      ORDER BY total_quantity DESC
      LIMIT 10
    `);
    
    // Karışık ürün rafları
    const mixedProductShelves = await all(`
      SELECT s.*, COUNT(DISTINCT sp.product_id) as product_count,
             'mixed_products' as suggestion_type,
             'Çoklu ürün - tek ürün politikası uygulanabilir' as suggestion
      FROM shelves s
      JOIN shelf_packages sp ON s.id = sp.shelf_id AND sp.quantity > 0
      WHERE s.shelf_code NOT LIKE 'SSH-%'
      GROUP BY s.id
      HAVING product_count > 1
      ORDER BY product_count DESC
      LIMIT 10
    `);
    
    res.json({
      empty_shelves: emptyShelfSuggestions,
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
    // Dengesiz dağılım - aynı ürün farklı zonelarda
    const unbalancedProducts = await all(`
      SELECT p.name, p.sku,
             s.zone as zone_distribution,
             COUNT(DISTINCT s.zone) as zone_count,
             'unbalanced_distribution' as suggestion_type,
             'Aynı ürün farklı zonelarda - konsolidasyon önerilir' as recommendation
      FROM products p
      JOIN shelf_packages sp ON p.id = sp.product_id AND sp.quantity > 0
      JOIN shelves s ON sp.shelf_id = s.id
      WHERE s.shelf_code NOT LIKE 'SSH-%'
      GROUP BY p.id
      HAVING zone_count > 1
      ORDER BY zone_count DESC
      LIMIT 10
    `);
    
    // Kritik seviye stoklar
    const criticalStock = await all(`
      SELECT p.name, p.sku, s.shelf_code, sp.quantity,
             'critical_stock' as alert_type,
             'Kritik seviye - yenileme gerekebilir' as recommendation
      FROM shelf_packages sp
      JOIN product_packages pp ON sp.package_id = pp.id
      JOIN products p ON pp.product_id = p.id
      JOIN shelves s ON sp.shelf_id = s.id
      WHERE sp.quantity > 0 AND sp.quantity <= 3 AND s.shelf_code NOT LIKE 'SSH-%'
      ORDER BY sp.quantity ASC
      LIMIT 15
    `);
    
    res.json({
      unbalanced_products: unbalancedProducts,
      critical_stock: criticalStock
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

// Static files middleware - API route'lardan sonra
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback: serve index.html
app.get('*', (req, res) => {
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
  
  console.log(`🚀 WMS server started successfully!`);
  console.log(`📱 Local access: http://localhost:${PORT}`);
  console.log(`🌐 Network access: http://${localIP}:${PORT}`);
  console.log(`📋 Test with mobile devices using: http://${localIP}:${PORT}`);
  console.log(`🦓 Zebra terminals can connect to: http://${localIP}:${PORT}`);
});
