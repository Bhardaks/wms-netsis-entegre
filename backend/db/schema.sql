
-- WMS schema (inspired by provided example): multi-package product support, orders, picking, scans, stock movements

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  main_barcode TEXT,
  price REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL,
  barcode TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, barcode)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT UNIQUE NOT NULL,
  customer_name TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open|picking|fulfilled|cancelled
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  picked_qty INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id, product_id)
);

CREATE TABLE IF NOT EXISTS picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active', -- active|completed
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pick_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pick_id INTEGER NOT NULL REFERENCES picks(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  package_id INTEGER REFERENCES product_packages(id) ON DELETE SET NULL,
  barcode TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- IN|OUT|ADJUST
  qty INTEGER NOT NULL,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


-- Locations and product_locations (bin-level inventory)
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT
);

CREATE TABLE IF NOT EXISTS product_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  on_hand INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_id, location_id)
);

-- SSH Service Tracking Tables

-- Service Requests - Ana servis talep tablosu
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
  package_number TEXT,
  package_name TEXT,
  package_barcode TEXT,
  issue_description TEXT NOT NULL,
  required_part TEXT,
  required_quantity INTEGER DEFAULT 1,
  priority TEXT NOT NULL DEFAULT 'normal', -- urgent|high|normal|low
  status TEXT NOT NULL DEFAULT 'pending', -- pending|sourcing|package_opening|ssh_storage|factory_order|completed|cancelled
  notes TEXT,
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_date DATETIME,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Package Openings - Paket açma işlemleri
CREATE TABLE IF NOT EXISTS package_openings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  package_id INTEGER NOT NULL REFERENCES product_packages(id),
  original_package_barcode TEXT NOT NULL,
  opened_quantity INTEGER NOT NULL,
  used_quantity INTEGER NOT NULL DEFAULT 0,
  ssh_quantity INTEGER NOT NULL DEFAULT 0,
  source_location TEXT, -- Paketin alındığı raf kodu
  opening_method TEXT DEFAULT 'partial', -- partial|complete
  opened_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  opened_by TEXT,
  notes TEXT
);

-- SSH Inventory - SSH alanında bulunan parçalar
CREATE TABLE IF NOT EXISTS ssh_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  part_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  location_code TEXT,
  source_package_barcode TEXT,
  source_opening_id INTEGER REFERENCES package_openings(id),
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_date DATETIME,
  is_available BOOLEAN DEFAULT 1
);

-- Service Movements - Servis hareket geçmişi
CREATE TABLE IF NOT EXISTS service_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL, -- status_change|part_sourced|package_opened|ssh_stored|factory_ordered|cost_added
  description TEXT NOT NULL,
  quantity INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  previous_status TEXT,
  new_status TEXT,
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT
);

-- Factory Orders - Fabrika sipariş takibi
CREATE TABLE IF NOT EXISTS factory_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  required_part TEXT NOT NULL,
  order_quantity INTEGER NOT NULL,
  order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  expected_date DATETIME,
  received_date DATETIME,
  received_quantity INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ordered', -- ordered|in_production|shipped|received|cancelled
  supplier TEXT,
  order_reference TEXT,
  cost REAL DEFAULT 0,
  notes TEXT
);

-- Inventory Count Tables - Depo Sayım Sistemi

-- Inventory Counts - Ana sayım tablosu
CREATE TABLE IF NOT EXISTS inventory_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- full|spot|shelf
  status TEXT NOT NULL DEFAULT 'active', -- active|completed|cancelled
  description TEXT,
  product_filter TEXT, -- Nokta sayım için ürün filtresi
  shelf_filter TEXT, -- Raf sayım için raf filtresi
  counted_items INTEGER DEFAULT 0,
  variance_items INTEGER DEFAULT 0,
  total_variance INTEGER DEFAULT 0,
  created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_date DATETIME,
  created_by TEXT,
  completed_by TEXT
);

-- Inventory Count Items - Sayım kalemleri
CREATE TABLE IF NOT EXISTS inventory_count_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  barcode TEXT,
  package_barcode TEXT,
  location_code TEXT,
  shelf_id INTEGER REFERENCES shelves(id),
  expected_quantity INTEGER NOT NULL DEFAULT 0,
  counted_quantity INTEGER DEFAULT 0,
  variance INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|counted|skipped
  notes TEXT,
  counted_date DATETIME,
  counted_by TEXT
);

-- Optional Wix identifiers on products (ignored if columns already exist)
-- These will be added via migrate.js if missing in an existing DB
