const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'backend', 'db', 'wms.db');
const db = new sqlite3.Database(DB_PATH);

const demoOrders = [
  {
    order_number: 'NETSIS-001',
    customer_name: 'Netsis Demo Müşteri A',
    status: 'open',
    fulfillment_status: 'NOT_FULFILLED',
    customer_phone: '0532 123 4567',
    delivery_address: 'Istanbul, Turkey',
    notes: 'Netsis entegrasyonu test siparişi'
  },
  {
    order_number: 'NETSIS-002', 
    customer_name: 'Demo Mobilya Ltd.Şti.',
    status: 'approved',
    fulfillment_status: 'NOT_FULFILLED',
    customer_phone: '0533 987 6543',
    delivery_address: 'Ankara, Turkey',
    notes: 'ERP entegrasyon demo'
  },
  {
    order_number: 'NETSIS-003',
    customer_name: 'Test Furniture Co.',
    status: 'open',
    fulfillment_status: 'PARTIALLY_FULFILLED',
    customer_phone: '0534 555 1234',
    delivery_address: 'Izmir, Turkey', 
    notes: 'Kısmi karşılama testi'
  }
];

console.log('📦 Demo siparişler ekleniyor...');

demoOrders.forEach(order => {
  db.run(`
    INSERT INTO orders (
      order_number, customer_name, status, fulfillment_status,
      customer_phone, delivery_address, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    order.order_number, order.customer_name, order.status, order.fulfillment_status,
    order.customer_phone, order.delivery_address, order.notes
  ], function(err) {
    if (err) {
      console.error('❌ Error:', err.message);
    } else {
      console.log(`✅ Order ${order.order_number} added successfully`);
    }
  });
});

setTimeout(() => {
  db.all('SELECT COUNT(*) as count FROM orders', (err, rows) => {
    if (err) {
      console.error('❌ Count error:', err);
    } else {
      console.log(`📊 Total orders: ${rows[0].count}`);
    }
    db.close();
  });
}, 1000);