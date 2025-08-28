// Netsis Products Sync Handler
const { netsisAPI } = require('./netsis');
const { run } = require('../db/migrate');

async function syncNetsisProducts() {
  try {
    let total = 0, versionUsed = null;
    const seen = new Set();
    
    console.log('📦 Netsis ürün senkronizasyonu başlatılıyor...');
    
    for await (const { item: prod, version } of netsisAPI.iterateProducts()) {
      versionUsed = version;
      const productId = prod.id;
      const baseName = prod.name || 'Ürün';
      const mainSku = prod.sku;
      
      // Parse price and stock from Netsis format
      let price = prod.priceData?.price || 0;
      let inventoryQuantity = null;
      if (prod.stock?.available != null) {
        inventoryQuantity = parseInt(prod.stock.available, 10);
      }
      
      const variants = prod.variants || [];

      if (variants && variants.length) {
        for (const v of variants) {
          // Use Netsis SKU extraction for variants
          let vSku = netsisAPI.extractVariantSku(v, mainSku);
          
          // If still no SKU found, create a fallback
          if (!vSku) {
            vSku = `${productId}:${(v.id || 'var')}`;
          }
          
          if (seen.has(vSku)) continue;
          seen.add(vSku);
          
          const fullName = (baseName || 'Ürün') + (v.suffix || '');
          let vPrice = v.price || price;
          let vInventoryQuantity = v.stock?.available || inventoryQuantity;
          
          await run(`INSERT INTO products (sku, name, description, main_barcode, price, netsis_item_id, netsis_variant_id, inventory_quantity)
                     VALUES (?,?,?,?,?,?,?,?)
                     ON CONFLICT(sku) DO UPDATE SET
                       name=excluded.name,
                       price=excluded.price,
                       inventory_quantity=excluded.inventory_quantity,
                       updated_at=CURRENT_TIMESTAMP`,
                    [String(vSku), String(fullName), prod.description || null, null, vPrice, String(productId||''), String(v.id || ''), vInventoryQuantity]);
          total++;
        }
      } else {
        // Ana ürün (varyant yok)
        const sku = mainSku || `NETSIS-${productId}`;
        if (!seen.has(sku)) {
          seen.add(sku);
          await run(`INSERT INTO products (sku, name, description, main_barcode, price, netsis_item_id, netsis_variant_id, inventory_quantity)
                     VALUES (?,?,?,?,?,?,?,?)
                     ON CONFLICT(sku) DO UPDATE SET
                       name=excluded.name,
                       price=excluded.price,
                       inventory_quantity=excluded.inventory_quantity,
                       updated_at=CURRENT_TIMESTAMP`,
                    [String(sku), String(baseName || 'Ürün'), prod.description || null, null, price, String(productId||''), null, inventoryQuantity]);
          total++;
        }
      }
    }
    
    console.log(`✅ Netsis ürün senkronizasyonu tamamlandı: ${total} ürün`);
    return { ok: true, imported: total, versionUsed };
    
  } catch (error) {
    console.error('❌ Netsis ürün senkronizasyon hatası:', error.message);
    throw error;
  }
}

module.exports = {
  syncNetsisProducts
};