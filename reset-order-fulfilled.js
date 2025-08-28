const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'backend', 'db', 'wms.db');
const orderNumber = '000000000010386';

const db = new sqlite3.Database(dbPath);

console.log(`🔄 Resetting order ${orderNumber} to dispatch-ready state...`);

db.serialize(() => {
    // Get order details
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
        
        console.log(`📋 Current order state:`);
        console.log(`   Status: ${order.status}`);
        console.log(`   Customer: ${order.customer_name}`);
        
        // Get order items to check picked quantities
        db.all("SELECT * FROM order_items WHERE order_id = ?", [order.id], (err, items) => {
            if (err) {
                console.error('❌ Error checking order items:', err);
                return;
            }
            
            console.log(`📦 Order items status:`);
            items.forEach(item => {
                console.log(`   - ${item.sku}: ${item.quantity} ordered, ${item.picked_qty} picked`);
            });
            
            // Check if all items are fully picked
            const allItemsFullyPicked = items.every(item => item.picked_qty >= item.quantity);
            
            if (allItemsFullyPicked && items.length > 0) {
                console.log(`✅ All items are fully picked - setting status to fulfilled`);
                
                // Update order status to fulfilled
                db.run("UPDATE orders SET status = 'fulfilled' WHERE order_number = ?", [orderNumber], function(err) {
                    if (err) {
                        console.error('❌ Error updating order status:', err);
                        return;
                    }
                    
                    console.log(`✅ Order ${orderNumber} status updated to 'fulfilled'`);
                    console.log(`📋 Order is now ready for dispatch creation`);
                    console.log(`🔘 "İrsaliye Oluştur" button should now be active in the interface`);
                    
                    db.close();
                });
            } else {
                console.log(`⚠️ Not all items are fully picked:`);
                items.forEach(item => {
                    if (item.picked_qty < item.quantity) {
                        console.log(`   - ${item.sku}: ${item.picked_qty}/${item.quantity} (missing ${item.quantity - item.picked_qty})`);
                    }
                });
                
                console.log(`ℹ️ Order cannot be set to fulfilled state until all items are picked`);
                console.log(`💡 Either complete picking or manually adjust picked_qty values`);
                
                // Ask if we should force fulfill
                console.log(`🔧 Force fulfilling order regardless of pick status...`);
                
                // Update all items to be fully picked
                db.run("UPDATE order_items SET picked_qty = quantity WHERE order_id = ?", [order.id], function(err) {
                    if (err) {
                        console.error('❌ Error updating item quantities:', err);
                        return;
                    }
                    
                    console.log(`✅ Force updated ${this.changes} items to be fully picked`);
                    
                    // Now update order status to fulfilled
                    db.run("UPDATE orders SET status = 'fulfilled' WHERE order_number = ?", [orderNumber], function(err) {
                        if (err) {
                            console.error('❌ Error updating order status:', err);
                            return;
                        }
                        
                        console.log(`✅ Order ${orderNumber} status updated to 'fulfilled'`);
                        console.log(`📋 Order is now ready for dispatch creation`);
                        console.log(`🔘 "İrsaliye Oluştur" button should now be active in the interface`);
                        
                        db.close();
                    });
                });
            }
        });
    });
});