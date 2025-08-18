-- Raf Yönetim Sistemi için yeni tablolar

-- Raflar tablosu
CREATE TABLE IF NOT EXISTS shelves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shelf_code TEXT UNIQUE NOT NULL,  -- Raf barkodu
  shelf_name TEXT,                  -- Raf adı (A1-01, B2-15 vs)
  zone TEXT,                        -- Bölge (A, B, C vs)
  aisle TEXT,                       -- Koridor (1, 2, 3 vs)
  level INTEGER,                    -- Seviye (1=alt, 2=orta, 3=üst)
  capacity INTEGER DEFAULT 100,     -- Maksimum kapasite
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Raf-Paket ilişkileri tablosu
CREATE TABLE IF NOT EXISTS shelf_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shelf_id INTEGER NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  package_id INTEGER NOT NULL REFERENCES product_packages(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,      -- Bu rafta kaç adet var
  assigned_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
  assigned_by TEXT,                         -- Kim yerleştirdi
  UNIQUE(shelf_id, package_id)
);

-- Raf hareketleri tablosu (audit trail)
CREATE TABLE IF NOT EXISTS shelf_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shelf_id INTEGER NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  package_id INTEGER NOT NULL REFERENCES product_packages(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL,              -- 'IN' (giriş), 'OUT' (çıkış), 'TRANSFER' (transfer)
  quantity_change INTEGER NOT NULL,        -- +5, -3, vs
  previous_quantity INTEGER NOT NULL,      -- Önceki miktar
  new_quantity INTEGER NOT NULL,           -- Yeni miktar
  barcode_scanned TEXT,                    -- Okutulan barkod
  notes TEXT,                              -- Notlar
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT                          -- İşlemi yapan kişi
);

-- Index'ler performans için
CREATE INDEX IF NOT EXISTS idx_shelves_code ON shelves(shelf_code);
CREATE INDEX IF NOT EXISTS idx_shelf_packages_shelf ON shelf_packages(shelf_id);
CREATE INDEX IF NOT EXISTS idx_shelf_packages_package ON shelf_packages(package_id);
CREATE INDEX IF NOT EXISTS idx_shelf_movements_shelf ON shelf_movements(shelf_id);
CREATE INDEX IF NOT EXISTS idx_shelf_movements_date ON shelf_movements(created_at);

-- Örnek raf verileri
INSERT OR IGNORE INTO shelves (shelf_code, shelf_name, zone, aisle, level) VALUES
('A1-01', 'A Bölgesi 1. Koridor Seviye 1', 'A', '1', 1),
('A1-02', 'A Bölgesi 1. Koridor Seviye 2', 'A', '1', 2),
('A1-03', 'A Bölgesi 1. Koridor Seviye 3', 'A', '1', 3),
('A2-01', 'A Bölgesi 2. Koridor Seviye 1', 'A', '2', 1),
('A2-02', 'A Bölgesi 2. Koridor Seviye 2', 'A', '2', 2),
('B1-01', 'B Bölgesi 1. Koridor Seviye 1', 'B', '1', 1),
('B1-02', 'B Bölgesi 1. Koridor Seviye 2', 'B', '1', 2),
('B2-01', 'B Bölgesi 2. Koridor Seviye 1', 'B', '2', 1),
('C1-01', 'C Bölgesi 1. Koridor Seviye 1', 'C', '1', 1),
('C1-02', 'C Bölgesi 1. Koridor Seviye 2', 'C', '1', 2);