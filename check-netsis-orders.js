const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'backend', 'db', 'wms.db');
const db = new sqlite3.Database(DB_PATH);

console.log('🔍 Netsis siparişleri kontrol ediliyor...');

// Promise wrapper for db operations
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function checkOrders() {
  try {
    // Netsis siparişlerini say
    const orderCount = await all('SELECT COUNT(*) as count FROM netsis_orders');
    console.log(`📊 Toplam Netsis sipariş sayısı: ${orderCount[0]?.count || 0}`);
    
    if (orderCount[0]?.count > 0) {
      // Son 5 siparişi göster
      const recentOrders = await all(`
        SELECT siparis_no, cari_kodu, siparis_tarihi, toplam_tutar, sync_status, sync_tarihi
        FROM netsis_orders 
        ORDER BY sync_tarihi DESC 
        LIMIT 5
      `);
      
      console.log('\n📋 Son 5 Netsis siparişi:');
      recentOrders.forEach((order, index) => {
        console.log(`${index + 1}. Sipariş: ${order.siparis_no}`);
        console.log(`   Müşteri: ${order.cari_kodu}`);
        console.log(`   Tarih: ${order.siparis_tarihi}`);
        console.log(`   Tutar: ${order.toplam_tutar}`);
        console.log(`   Durum: ${order.sync_status}`);
        console.log(`   Sync: ${order.sync_tarihi}`);
        console.log('');
      });
      
      // Satır sayısını da kontrol et
      const lineCount = await all('SELECT COUNT(*) as count FROM netsis_order_lines');
      console.log(`📝 Toplam sipariş satırı sayısı: ${lineCount[0]?.count || 0}`);
    } else {
      console.log('❌ Henüz hiç Netsis siparişi alınmamış.');
      console.log('💡 C# uygulamanızın aşağıdaki ayarları kontrol edin:');
      console.log('   - ApiBase: "http://192.168.0.79:5000" (veya localhost:5000)');
      console.log('   - OrdersImportPath: "/api/netsis/orders"');
      console.log('   - DoPostOrders: true');
    }
  } catch (error) {
    console.error('❌ Hata:', error.message);
  } finally {
    db.close();
  }
}

checkOrders();