const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'backend', 'db', 'wms.db');
const orderNumber = '000000000010386';

const db = new sqlite3.Database(dbPath);

console.log(`🗑️ Clearing dispatch records for order: ${orderNumber}`);

db.serialize(() => {
    // First check existing records
    // First check if order exists
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
        
        console.log(`📋 Order ${orderNumber} found with status: ${order.status}`);
        
        // Check for pick_scans (which would be equivalent to dispatch records)
        db.all("SELECT ps.*, oi.sku, oi.product_name FROM pick_scans ps JOIN order_items oi ON ps.order_item_id = oi.id WHERE oi.order_id = ?", [order.id], (err, scans) => {
            if (err) {
                console.error('❌ Error checking pick scans:', err);
                return;
            }
            
            console.log(`📋 Found ${scans.length} pick scan records for order ${orderNumber}`);
            if (scans.length > 0) {
                scans.forEach(scan => {
                    console.log(`   - Scan ID: ${scan.id}, Product: ${scan.sku}, Barcode: ${scan.barcode}`);
                });
            }
            
            // Delete pick scans
            db.run("DELETE FROM pick_scans WHERE pick_id IN (SELECT p.id FROM picks p JOIN orders o ON p.order_id = o.id WHERE o.order_number = ?)", [orderNumber], function(err) {
                if (err) {
                    console.error('❌ Error deleting pick scans:', err);
                    return;
                }
                
                console.log(`✅ Deleted ${this.changes} pick scan records for order ${orderNumber}`);
                
                // Delete picks
                db.run("DELETE FROM picks WHERE order_id = ?", [order.id], function(err) {
                    if (err) {
                        console.error('❌ Error deleting picks:', err);
                        return;
                    }
                    
                    console.log(`✅ Deleted ${this.changes} pick records for order ${orderNumber}`);
                    
                    // Reset order items picked quantities
                    db.run("UPDATE order_items SET picked_qty = 0 WHERE order_id = ?", [order.id], function(err) {
                        if (err) {
                            console.error('❌ Error resetting order items:', err);
                            return;
                        }
                        
                        console.log(`✅ Reset picked quantities for ${this.changes} order items`);
                        
                        // Reset order status to open
                        db.run("UPDATE orders SET status = 'open' WHERE order_number = ?", [orderNumber], function(err) {
                            if (err) {
                                console.error('❌ Error updating order status:', err);
                                return;
                            }
                            
                            console.log(`✅ Order ${orderNumber} status reset to 'open'`);
                            console.log(`🔄 Order ${orderNumber} is now ready for fresh processing`);
                            
                            db.close();
                        });
                    });
                });
            });
        });
    });
});