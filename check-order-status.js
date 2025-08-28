const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'backend', 'db', 'wms.db');
const orderNumber = '000000000010386';

const db = new sqlite3.Database(dbPath);

console.log(`🔍 Checking order status for: ${orderNumber}`);

db.serialize(() => {
    db.get("SELECT * FROM orders WHERE order_number = ?", [orderNumber], (err, order) => {
        if (err) {
            console.error('❌ Error checking order:', err);
            return;
        }
        
        if (!order) {
            console.log(`⚠️ Order ${orderNumber} not found in database`);
            db.close();
            return;
        }
        
        console.log(`📋 Order ${orderNumber}:`);
        console.log(`   Status: ${order.status}`);
        console.log(`   Customer: ${order.customer_name}`);
        console.log(`   Created: ${order.created_at}`);
        console.log(`   Updated: ${order.updated_at}`);
        
        db.all("SELECT * FROM order_items WHERE order_id = ?", [order.id], (err, items) => {
            if (err) {
                console.error('❌ Error checking order items:', err);
                return;
            }
            
            console.log(`📦 Order Items (${items.length}):`);
            items.forEach(item => {
                console.log(`   - ${item.sku}: ${item.quantity} ordered, ${item.picked_qty} picked`);
            });
            
            db.all("SELECT * FROM picks WHERE order_id = ?", [order.id], (err, picks) => {
                if (err) {
                    console.error('❌ Error checking picks:', err);
                    return;
                }
                
                console.log(`📋 Picks (${picks.length}):`);
                picks.forEach(pick => {
                    console.log(`   - Pick ID: ${pick.id}, Status: ${pick.status}, Created: ${pick.created_at}`);
                });
                
                db.close();
            });
        });
    });
});
