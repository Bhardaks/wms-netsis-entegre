const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'backend', 'db', 'wms.db');
const db = new Database(dbPath);

// Siparişlerin durumunu kontrol et
const orders = db.prepare(`
  SELECT 
    o.order_number,
    o.status,
    o.fulfillment_status,
    COUNT(oi.id) as total_items,
    SUM(CASE WHEN oi.picked_qty >= oi.quantity THEN 1 ELSE 0 END) as completed_items,
    SUM(oi.picked_qty) as total_picked,
    SUM(oi.quantity) as total_quantity
  FROM orders o
  LEFT JOIN order_items oi ON oi.order_id = o.id
  GROUP BY o.id
  ORDER BY o.order_number DESC
  LIMIT 10
`).all();

console.log('📊 Son 10 Siparişin Durumu:');
console.log('---------------------------------------');

orders.forEach(o => {
  const isCompleted = o.completed_items === o.total_items && o.total_items > 0;
  const statusIndicator = isCompleted ? '✅' : (o.total_picked > 0 ? '🔶' : '⏸️');
  
  console.log(`${statusIndicator} #${o.order_number}: ${o.status} (${o.fulfillment_status || 'no fulfillment'})`);
  console.log(`   Items: ${o.completed_items}/${o.total_items} | Picked: ${o.total_picked}/${o.total_quantity}`);
  
  if (isCompleted && o.status !== 'fulfilled') {
    console.log(`   ⚠️  SORUN: Tüm itemler toplandı ama status hala '${o.status}'`);
  }
  console.log('');
});

// Pick durumunu da kontrol et
const activePicks = db.prepare(`
  SELECT 
    p.id,
    o.order_number,
    p.status as pick_status,
    COUNT(oi.id) as total_items,
    SUM(CASE WHEN oi.picked_qty >= oi.quantity THEN 1 ELSE 0 END) as completed_items
  FROM picks p
  JOIN orders o ON p.order_id = o.id
  LEFT JOIN order_items oi ON oi.order_id = o.id
  WHERE p.status != 'completed'
  GROUP BY p.id
  ORDER BY p.created_at DESC
`).all();

if (activePicks.length > 0) {
  console.log('🔄 Aktif Pick İşlemleri:');
  console.log('---------------------------------------');
  
  activePicks.forEach(p => {
    const isCompleted = p.completed_items === p.total_items && p.total_items > 0;
    console.log(`Pick #${p.id} - Order #${p.order_number}: ${p.pick_status}`);
    console.log(`   Items: ${p.completed_items}/${p.total_items} ${isCompleted ? '✅' : '🔶'}`);
    
    if (isCompleted && p.pick_status !== 'completed') {
      console.log(`   ⚠️  SORUN: Pick tamamlandı ama status hala '${p.pick_status}'`);
    }
    console.log('');
  });
}

db.close();