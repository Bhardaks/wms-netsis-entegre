// Netsis Stock Cards Sync Handler
const { netsisAPI } = require('./netsis');
const { run } = require('../db/migrate');

async function syncNetsisStockCards() {
  try {
    let total = 0, versionUsed = null;
    const seen = new Set();
    
    console.log('📦 Netsis stok kartları senkronizasyonu başlatılıyor...');
    
    for await (const { item: prod, version } of netsisAPI.iterateStockCards()) {
      versionUsed = version;
      const productId = prod.id;
      const baseName = prod.name || 'Stok Kartı';
      const mainSku = prod.sku;
      
      if (!mainSku || seen.has(mainSku)) {
        console.warn(`⚠️ SKU eksik veya duplicate: ${mainSku}`);
        continue;
      }
      
      seen.add(mainSku);
      
      // Parse price and stock from Netsis stock card format
      let price = prod.priceData?.price || 0;
      let inventoryQuantity = prod.stock?.available || 0;
      
      try {
        await run(`INSERT INTO products (sku, name, description, main_barcode, price, netsis_stockcard_id, netsis_warehouse, inventory_quantity, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
                   ON CONFLICT(sku) DO UPDATE SET
                     name=excluded.name,
                     description=excluded.description,
                     price=excluded.price,
                     inventory_quantity=excluded.inventory_quantity,
                     netsis_stockcard_id=excluded.netsis_stockcard_id,
                     netsis_warehouse=excluded.netsis_warehouse,
                     updated_at=CURRENT_TIMESTAMP`,
                  [
                    String(mainSku), 
                    String(baseName), 
                    prod.description || null, 
                    null, // main_barcode
                    price, 
                    String(productId || ''),
                    prod.stock?.location || null,
                    inventoryQuantity
                  ]);
        total++;
        
        if (total % 50 === 0) {
          console.log(`📦 ${total} stok kartı işlendi...`);
        }
        
      } catch (dbError) {
        console.error(`❌ Veritabanı hatası (SKU: ${mainSku}):`, dbError.message);
      }
    }
    
    console.log(`✅ Netsis stok kartları senkronizasyonu tamamlandı: ${total} stok kartı`);
    return { ok: true, imported: total, versionUsed, source: 'StockCards' };
    
  } catch (error) {
    console.error('❌ Netsis stok kartları senkronizasyon hatası:', error.message);
    throw error;
  }
}

// Tek warehouse için stok kartları çek
async function syncNetsisStockCardsByWarehouse(warehouseCode) {
  try {
    console.log(`📦 ${warehouseCode} deposu stok kartları senkronizasyonu başlatılıyor...`);
    
    // SQL query ile spesifik warehouse stok kartlarını çek
    const query = `SELECT * FROM LG_001_STCARD WHERE WHOUSECODE = '${warehouseCode}' AND ACTIVE = 1`;
    const result = await netsisAPI.executeQuery(query, 1000);
    
    if (!result?.data?.length) {
      return { ok: true, imported: 0, message: `${warehouseCode} deposunda stok kartı bulunamadı` };
    }
    
    let total = 0;
    const seen = new Set();
    
    for (const stock of result.data) {
      const sku = stock.CODE || stock.CARDCODE;
      
      if (!sku || seen.has(sku)) continue;
      seen.add(sku);
      
      try {
        await run(`INSERT INTO products (sku, name, description, price, netsis_stockcard_id, netsis_warehouse, inventory_quantity, updated_at)
                   VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
                   ON CONFLICT(sku) DO UPDATE SET
                     name=excluded.name,
                     price=excluded.price,
                     inventory_quantity=excluded.inventory_quantity,
                     netsis_stockcard_id=excluded.netsis_stockcard_id,
                     netsis_warehouse=excluded.netsis_warehouse,
                     updated_at=CURRENT_TIMESTAMP`,
                  [
                    String(sku),
                    String(stock.DEFINITION || 'Stok Kartı'),
                    stock.EXPLANATION || null,
                    parseFloat(stock.PRICE || 0),
                    String(stock.LOGICALREF || ''),
                    warehouseCode,
                    parseFloat(stock.ONHAND || 0) - parseFloat(stock.RESERVED || 0)
                  ]);
        total++;
      } catch (dbError) {
        console.error(`❌ Veritabanı hatası (SKU: ${sku}):`, dbError.message);
      }
    }
    
    console.log(`✅ ${warehouseCode} deposu senkronizasyonu tamamlandı: ${total} stok kartı`);
    return { ok: true, imported: total, warehouse: warehouseCode };
    
  } catch (error) {
    console.error(`❌ ${warehouseCode} deposu senkronizasyon hatası:`, error.message);
    throw error;
  }
}

module.exports = {
  syncNetsisStockCards,
  syncNetsisStockCardsByWarehouse
};