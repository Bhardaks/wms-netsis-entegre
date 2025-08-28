const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'backend', 'db', 'wms.db');
const orderNumber = '000000000010386';
const netsisDeliveryNote = 'W10386';

const db = new sqlite3.Database(dbPath);

console.log(`🗑️ Clearing Netsis transfer records for order: ${orderNumber} (${netsisDeliveryNote})`);

db.serialize(() => {
    // First check current order status
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
        
        console.log(`📋 Current order status:`);
        console.log(`   Status: ${order.status}`);
        console.log(`   Netsis Delivery Note: ${order.netsis_delivery_note_id || 'None'}`);
        console.log(`   Created: ${order.created_at}`);
        console.log(`   Updated: ${order.updated_at}`);
        
        // Clear Netsis delivery note reference
        db.run("UPDATE orders SET netsis_delivery_note_id = NULL WHERE order_number = ?", [orderNumber], function(err) {
            if (err) {
                console.error('❌ Error clearing netsis_delivery_note_id:', err);
                return;
            }
            
            console.log(`✅ Cleared netsis_delivery_note_id from order ${orderNumber}`);
            
            // Check for any delivery notes table if exists
            db.all("SELECT name FROM sqlite_master WHERE type='table' AND (name='delivery_notes' OR name='netsis_sync_log' OR name LIKE '%netsis%' OR name LIKE '%dispatch%')", (err, tables) => {
                if (err) {
                    console.error('❌ Error checking tables:', err);
                    db.close();
                    return;
                }
                
                console.log(`📋 Found ${tables.length} potential Netsis-related tables:`);
                tables.forEach(table => {
                    console.log(`   - ${table.name}`);
                });
                
                if (tables.length === 0) {
                    console.log(`ℹ️ No additional Netsis tables found to clear`);
                    finishClearing();
                } else {
                    // Clear any found tables
                    let tablesProcessed = 0;
                    tables.forEach(table => {
                        const tableName = table.name;
                        
                        // First check if the table has relevant columns
                        db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
                            if (err) {
                                console.error(`❌ Error getting table info for ${tableName}:`, err);
                                tablesProcessed++;
                                if (tablesProcessed === tables.length) finishClearing();
                                return;
                            }
                            
                            const hasOrderNumber = columns.some(col => col.name.includes('order_number') || col.name.includes('order_id'));
                            const hasNetsis = columns.some(col => col.name.includes('netsis') || col.name.includes('delivery'));
                            
                            if (hasOrderNumber || hasNetsis) {
                                console.log(`🧹 Attempting to clear records from ${tableName}`);
                                // Try different column patterns
                                const queries = [
                                    `DELETE FROM ${tableName} WHERE order_number = ? OR order_number = ?`,
                                    `DELETE FROM ${tableName} WHERE netsis_reference = ? OR netsis_id = ?`,
                                    `DELETE FROM ${tableName} WHERE reference_number = ? OR delivery_note_id = ?`
                                ];
                                
                                let queryIndex = 0;
                                
                                function tryNextQuery() {
                                    if (queryIndex >= queries.length) {
                                        tablesProcessed++;
                                        if (tablesProcessed === tables.length) finishClearing();
                                        return;
                                    }
                                    
                                    const query = queries[queryIndex];
                                    db.run(query, [orderNumber, netsisDeliveryNote], function(err) {
                                        if (!err && this.changes > 0) {
                                            console.log(`✅ Deleted ${this.changes} records from ${tableName}`);
                                        } else if (err && !err.message.includes('no such column')) {
                                            console.error(`❌ Error clearing ${tableName}:`, err.message);
                                        }
                                        
                                        queryIndex++;
                                        tryNextQuery();
                                    });
                                }
                                
                                tryNextQuery();
                            } else {
                                tablesProcessed++;
                                if (tablesProcessed === tables.length) finishClearing();
                            }
                        });
                    });
                }
            });
        });
        
        function finishClearing() {
            console.log(`🔄 Order ${orderNumber} is now ready for new Netsis dispatch creation`);
            console.log(`📋 Order should show "İrsaliye Oluştur" button in the interface`);
            console.log(`✅ All Netsis transfer records cleared for ${netsisDeliveryNote}`);
            
            db.close();
        }
    });
});