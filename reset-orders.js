const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'backend', 'db', 'wms.db');
const db = new Database(dbPath);

console.log('🔄 Siparişleri sıfırlama işlemi başlıyor...');

try {
  // Transaction başlat
  const resetTransaction = db.transaction(() => {
    // 1. İrsaliye bilgilerini temizle
    const clearDispatchResult = db.prepare(`
      UPDATE orders SET 
        netsis_delivery_note_id = NULL,
        netsis_delivery_status = NULL,
        netsis_delivery_data = NULL,
        netsis_delivery_error = NULL
    `).run();
    
    console.log(`📋 İrsaliye kayıtları temizlendi: ${clearDispatchResult.changes} sipariş`);
    
    // 2. Fulfilled siparişleri open durumuna getir
    const resetStatusResult = db.prepare(`
      UPDATE orders SET 
        status = 'open',
        fulfillment_status = NULL
      WHERE status = 'fulfilled' OR fulfillment_status = 'FULFILLED'
    `).run();
    
    console.log(`📦 Tamamlanmış siparişler açık duruma getirildi: ${resetStatusResult.changes} sipariş`);
    
    // 3. Pick kayıtlarını temizle (opsiyonel - pick tablosu varsa)
    try {
      const clearPicksResult = db.prepare('DELETE FROM picks WHERE status = "completed"').run();
      console.log(`🔧 Tamamlanmış pick kayıtları temizlendi: ${clearPicksResult.changes} pick`);
    } catch (error) {
      console.log('ℹ️  Pick tablosu bulunamadı, atlándı.');
    }
    
    // 4. Pick scan kayıtlarını temizle (opsiyonel)
    try {
      const clearScansResult = db.prepare('DELETE FROM pick_scans').run();
      console.log(`📱 Pick scan kayıtları temizlendi: ${clearScansResult.changes} scan`);
    } catch (error) {
      console.log('ℹ️  Pick scan tablosu bulunamadı, atlándı.');
    }
  });
  
  // Transaction çalıştır
  resetTransaction();
  
  // Sonuçları kontrol et
  const orderStats = db.prepare(`
    SELECT 
      COUNT(*) as total_orders,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_orders,
      SUM(CASE WHEN status = 'fulfilled' THEN 1 ELSE 0 END) as fulfilled_orders,
      SUM(CASE WHEN netsis_delivery_note_id IS NOT NULL THEN 1 ELSE 0 END) as with_dispatch
    FROM orders
  `).get();
  
  console.log('\n📊 İşlem sonrası durum:');
  console.log(`   📦 Toplam sipariş: ${orderStats.total_orders}`);
  console.log(`   🟢 Açık sipariş: ${orderStats.open_orders}`);
  console.log(`   ✅ Tamamlanmış: ${orderStats.fulfilled_orders}`);
  console.log(`   📋 İrsaliyeli: ${orderStats.with_dispatch}`);
  
  console.log('\n✅ Siparişler başarıyla sıfırlandı! Artık baştan test edebilirsiniz.');
  
} catch (error) {
  console.error('❌ Sıfırlama hatası:', error);
} finally {
  db.close();
}