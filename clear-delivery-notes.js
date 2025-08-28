// Clear delivery note IDs from completed orders
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'backend', 'db', 'wms.db');

console.log('🗑️ Clearing delivery note IDs from completed orders...');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Database connection error:', err.message);
    return;
  }
  console.log('✅ Connected to database');
});

// Clear delivery note IDs
db.run(`
  UPDATE orders 
  SET 
    netsis_delivery_note_id = NULL,
    netsis_delivery_status = 'pending_manual_dispatch',
    netsis_delivery_error = NULL,
    netsis_delivery_data = NULL
  WHERE fulfillment_status = 'FULFILLED'
`, function(err) {
  if (err) {
    console.error('❌ Update error:', err.message);
  } else {
    console.log(`✅ Cleared delivery note IDs from ${this.changes} completed orders`);
  }
  
  // Get updated orders
  db.all(`
    SELECT id, order_number, customer_name, netsis_delivery_note_id 
    FROM orders 
    WHERE fulfillment_status = 'FULFILLED' 
    ORDER BY order_number
  `, (err, orders) => {
    if (err) {
      console.error('❌ Select error:', err.message);
    } else {
      console.log(`📋 Updated orders (${orders.length}):`);
      orders.forEach(order => {
        console.log(`  - ${order.order_number} (${order.customer_name}): ${order.netsis_delivery_note_id || 'NULL'}`);
      });
    }
    
    db.close((err) => {
      if (err) {
        console.error('❌ Database close error:', err.message);
      } else {
        console.log('✅ Database connection closed');
      }
    });
  });
});