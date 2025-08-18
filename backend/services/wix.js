
const axios = require('axios');

const V3_PRODUCTS_QUERY = 'https://www.wixapis.com/stores/v3/products/query';
const V1_PRODUCTS_QUERY = 'https://www.wixapis.com/stores/v1/products/query';
const ECOM_ORDERS_SEARCH = 'https://www.wixapis.com/ecom/v1/orders/search';
const STORES_V2_ORDERS_QUERY = 'https://www.wixapis.com/stores/v2/orders/query';
const ECOM_ORDERS_UPDATE = 'https://www.wixapis.com/ecom/v1/orders';
const ECOM_FULFILLMENTS_CREATE = 'https://www.wixapis.com/ecom/v1/fulfillments';
const STORES_FULFILLMENTS_CREATE = 'https://www.wixapis.com/stores/v2/fulfillments';
const ECOM_V2_FULFILLMENTS = 'https://www.wixapis.com/ecom/v2/fulfillments';
const STORES_V2_ORDERS_UPDATE = 'https://www.wixapis.com/stores/v2/orders';

function headers() {
  const key = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;
  if (!key || !siteId) throw new Error('WIX_API_KEY or WIX_SITE_ID missing');
  return {
    Authorization: key,          // API Key (site-level) – raw key
    'wix-site-id': siteId,
    'Content-Type': 'application/json'
  };
}

// Coerce any value to a readable string (avoid [object Object])
function s(val, fallback = '') {
  if (val == null) return fallback;
  if (typeof val === 'string') return val;
  // common nested shapes
  if (typeof val === 'object') {
    for (const k of ['original', 'translated', 'value', 'plainText']) {
      if (typeof val[k] === 'string') return val[k];
      if (val[k] && typeof val[k] === 'object') {
        for (const kk of ['original', 'translated', 'value', 'plainText']) {
          if (typeof val[k][kk] === 'string') return val[k][kk];
        }
      }
    }
  }
  try { return JSON.stringify(val); } catch { return String(val); }
}

// Build variant display suffix from choices object/array
function variantSuffix(variant) {
  const ch = variant?.choices || variant?.options || variant?.optionSelections;
  if (!ch) return '';
  if (Array.isArray(ch)) {
    return ' ' + ch.map(x => x && (x.value || x.name || x)).join('/');
  }
  if (typeof ch === 'object') {
    return ' ' + Object.values(ch).map(x => (x && (x.value || x.name || x))).join('/');
  }
  return '';
}

// -------- PRODUCTS (V3 with fallback to V1) --------
async function *iterateProducts() {
  // Try V3 cursor paging
  try {
    let cursor = null;
    do {
      const body = { query: { cursorPaging: { limit: 100, cursor } }, fields: ['id','name','sku','variants','manageVariants','priceData','stock'] };
      const { data } = await axios.post(V3_PRODUCTS_QUERY, body, { headers: headers() });
      const items = data?.products || data?.items || [];
      for (const it of items) yield { item: it, version: 'v3' };
      cursor = data?.nextCursor || null;
    } while (cursor);
    return;
  } catch (e) {
    // Fall back to V1
  }

  // V1: either nextCursor or offset paging
  let cursor = null;
  let offset = 0, total = null, limit = 100;
  for (;;) {
    const body = cursor
      ? { nextCursor: cursor, includeVariants: true }
      : { query: { paging: { limit, offset } }, includeVariants: true };
    const { data } = await axios.post(V1_PRODUCTS_QUERY, body, { headers: headers() });
    const items = data?.products || data?.items || [];
    for (const it of items) yield { item: it, version: 'v1' };

    // Prefer explicit nextCursor if present
    if (data?.nextCursor) { cursor = data.nextCursor; continue; }
    // else rely on paging info
    const p = data?.paging;
    if (p?.total != null) total = p.total;
    if (p?.limit != null) limit = p.limit;
    if (p?.offset != null) offset = p.offset + limit; else offset += limit;
    if (total != null && offset >= total) break;
    if (!items.length && !data?.nextCursor) break;
  }
}

// -------- ORDERS --------
async function *iterateOrders() {
  // İlk olarak eCommerce API'yi dene
  try {
    yield* iterateOrdersEcommerce();
    return;
  } catch (error) {
    console.log('⚠️ eCommerce API başarısız, Stores API deneniyor:', error.message);
  }
  
  // Fallback: Stores API'yi dene  
  try {
    yield* iterateOrdersStores();
  } catch (error) {
    console.error('❌ Her iki API de başarısız:', error.message);
    throw error;
  }
}

// eCommerce API ile sipariş çekme
async function *iterateOrdersEcommerce() {
  let cursor = null;
  let pageCount = 0;
  let totalFetched = 0;
  let uniqueOrderIds = new Set();
  let uniqueCount = 0;
  
  do {
    pageCount++;
    
    // Farklı limitler dene - bazı API'lar küçük limitlerde daha iyi çalışır
    const limit = pageCount === 1 ? 50 : 25; // İlk sayfa daha büyük, sonraki sayfalar küçük
    
    const body = cursor 
      ? { 
          cursorPaging: { limit, cursor }
        }
      : { 
          cursorPaging: { limit }
        };
    
    const { data } = await axios.post(ECOM_ORDERS_SEARCH, body, { headers: headers() });
    const items = data?.orders || data?.items || [];
    
    totalFetched += items.length;
    
    const metadata = data?.metadata || {};
    if (pageCount === 1) {
      console.log(`📊 eCommerce API - Wix'te toplam ${metadata.total || 'bilinmeyen'} sipariş var`);
    }
    
    let newOrdersThisPage = 0;
    for (const order of items) {
      const orderId = order.id || order._id;
      if (orderId && !uniqueOrderIds.has(orderId)) {
        uniqueOrderIds.add(orderId);
        uniqueCount++;
        newOrdersThisPage++;
        yield order;
      }
    }
    
    console.log(`📄 eCommerce Sayfa ${pageCount}: ${items.length} alındı, ${newOrdersThisPage} yeni, ${uniqueCount} benzersiz`);
    
    cursor = metadata?.cursors?.next || null;
    const hasNext = metadata?.hasNext || false;
    
    if (!hasNext || !cursor || items.length === 0) {
      console.log('⚠️ eCommerce API pagination tamamlandı');
      break;
    }
    
    if (pageCount > 20) { // Makul bir limit
      console.log(`⚠️ eCommerce API - 20 sayfa limitine ulaşıldı`);
      break;
    }
    
    if (metadata.total && uniqueCount >= metadata.total) {
      console.log(`✅ eCommerce API - Beklenen ${metadata.total} sipariş sayısına ulaşıldı`);
      break;
    }
    
  } while (cursor);
  
  console.log(`✅ eCommerce API tamamlandı: ${pageCount} sayfa, ${uniqueCount} benzersiz sipariş`);
  
  // Eğer beklenen siparişlerin yarısından azını aldıysak, Stores API'yi de dene
  if (uniqueCount < 100) {
    console.log('⚠️ Az sipariş alındı, Stores API de deneniyor...');
    yield* iterateOrdersStores(uniqueOrderIds);
  }
}

// Stores API ile sipariş çekme (fallback)
async function *iterateOrdersStores(existingIds = new Set()) {
  let offset = 0;
  let pageCount = 0;
  let uniqueCount = existingIds.size;
  
  for (;;) {
    pageCount++;
    
    const body = {
      query: {
        paging: { limit: 100, offset }
      }
    };
    
    const { data } = await axios.post(STORES_V2_ORDERS_QUERY, body, { headers: headers() });
    const items = data?.orders || [];
    
    if (pageCount === 1) {
      console.log(`📊 Stores API - Toplam ${data?.paging?.total || 'bilinmeyen'} sipariş`);
    }
    
    let newOrdersThisPage = 0;
    for (const order of items) {
      const orderId = order.id || order._id;
      if (orderId && !existingIds.has(orderId)) {
        existingIds.add(orderId);
        uniqueCount++;
        newOrdersThisPage++;
        yield order;
      }
    }
    
    console.log(`📄 Stores Sayfa ${pageCount}: ${items.length} alındı, ${newOrdersThisPage} yeni, ${uniqueCount} benzersiz`);
    
    if (items.length === 0) break;
    
    offset += 100;
    
    if (pageCount > 10) {
      console.log(`⚠️ Stores API - 10 sayfa limitine ulaşıldı`);
      break;
    }
  }
  
  console.log(`✅ Stores API tamamlandı: ${pageCount} sayfa, ${uniqueCount} toplam benzersiz sipariş`);
}

// Extract SKU from various places in line item (for orders)
function extractSku(lineItem) {
  return lineItem?.physicalProperties?.sku || lineItem?.sku || null;
}

// Extract variant SKU from different possible locations (for products)
function extractVariantSku(variant, productSku = null) {
  // Check multiple possible locations for variant SKU
  const possibleSkus = [
    variant?.sku,                           // Direct SKU
    variant?.variant?.sku,                  // Nested variant SKU (Wix v1 format)
    variant?.physicalProperties?.sku,       // Physical properties
    variant?.productSku,                    // Product-level SKU
    variant?.variantSku,                    // Variant-specific SKU
    variant?.properties?.sku,               // Properties SKU
    productSku                              // fallback to main product SKU
  ];
  
  // Return first non-empty SKU found
  for (const sku of possibleSkus) {
    if (sku && typeof sku === 'string' && sku.trim()) {
      return sku.trim();
    }
  }
  
  return null;
}

function extractCatalogIds(lineItem) {
  const cr = lineItem?.catalogReference || {};
  const productId = cr.catalogItemId || lineItem?.productId || null;
  let variantId = null;
  // common shapes
  if (cr.options) {
    if (typeof cr.options === 'string') variantId = cr.options;
    else if (typeof cr.options === 'object') {
      variantId = cr.options.variantId || cr.options.variant?.id || null;
    }
  }
  // legacy
  if (!variantId && lineItem.variantId) variantId = lineItem.variantId;
  return { productId, variantId };
}

// -------- ORDER FULFILLMENT --------
async function updateOrderFulfillment(orderId, fulfillmentStatus) {
  console.log(`📦 Wix entegrasyon süreci başlatıldı: ${orderId} -> ${fulfillmentStatus}`);
  
  // Önce siparişin mevcut durumunu kontrol et
  try {
    const currentOrder = await getOrderById(orderId);
    const currentStatus = currentOrder.order?.fulfillmentStatus;
    
    console.log(`📋 Mevcut Wix durumu: ${currentStatus} -> Hedef: ${fulfillmentStatus}`);
    
    if (currentStatus === fulfillmentStatus) {
      console.log(`ℹ️ Sipariş zaten ${fulfillmentStatus} durumunda, güncelleme gerekmiyor`);
      return { message: 'Already in target status', skipped: true };
    }
    
    // Yetki var, gerçek güncelleme yapalım
    console.log(`🔄 API yetkisi mevcut, Wix güncellemesi deneniyor...`);
    return await attemptRealWixUpdate(orderId, fulfillmentStatus, currentStatus);
    
  } catch (checkError) {
    console.warn(`⚠️ Sipariş durumu kontrol edilemedi: ${checkError.message}`);
    return await attemptRealWixUpdate(orderId, fulfillmentStatus, null);
  }
}

// Gerçek Wix güncelleme denemesi
async function attemptRealWixUpdate(orderId, fulfillmentStatus, currentStatus) {
  const approaches = [
    // Method 1: Create fulfillment (for FULFILLED status)
    () => tryCreateFulfillment(orderId, fulfillmentStatus),
    // Method 2: Cancel fulfillment (for NOT_FULFILLED status)
    () => tryCancelFulfillment(orderId, fulfillmentStatus),
    // Method 3: Legacy order update attempt
    () => tryLegacyOrderUpdate(orderId, fulfillmentStatus)
  ];
  
  let lastError = null;
  
  for (let i = 0; i < approaches.length; i++) {
    try {
      console.log(`🔄 Wix güncelleme denemesi ${i + 1}/${approaches.length}...`);
      const result = await approaches[i]();
      console.log(`✅ Başarılı! Wix siparişi güncellendi: ${orderId} -> ${fulfillmentStatus}`);
      
      await logWixSyncAttempt(orderId, fulfillmentStatus, 'SUCCESS');
      return { 
        success: true, 
        result,
        message: `Wix siparişi başarıyla güncellendi: ${fulfillmentStatus}`,
        method: i + 1,
        previousStatus: currentStatus
      };
    } catch (error) {
      console.warn(`⚠️ Yöntem ${i + 1} başarısız: ${error.response?.status} - ${error.message}`);
      lastError = error;
      
      // Detaylı hata logu
      if (error.response) {
        console.log(`📄 HTTP ${error.response.status}: ${error.response.statusText}`);
        console.log(`📄 URL: ${error.config?.url}`);
        console.log(`📄 Method: ${error.config?.method?.toUpperCase()}`);
        console.log(`📄 Data:`, error.config?.data);
        if (error.response.data) {
          console.log(`📄 Response:`, error.response.data);
        }
      }
      
      // Kısa bekleme
      if (i < approaches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
  
  console.error(`❌ Tüm yöntemler başarısız oldu: ${lastError?.message}`);
  await logWixSyncAttempt(orderId, fulfillmentStatus, 'FAILED');
  
  return { 
    success: false, 
    reason: 'UPDATE_FAILED',
    message: `Wix güncellemesi başarısız: ${lastError?.response?.status || lastError?.message}`,
    orderId,
    targetStatus: fulfillmentStatus,
    error: lastError?.message
  };
}

// Method 1: Create fulfillment (for FULFILLED)
async function tryCreateFulfillment(orderId, fulfillmentStatus) {
  if (fulfillmentStatus !== 'FULFILLED') {
    throw new Error('Create fulfillment only supports FULFILLED status');
  }

  // Önce order'ın line item'larını al
  const order = await getOrderById(orderId);
  const lineItems = order.order?.lineItems || [];
  
  if (lineItems.length === 0) {
    throw new Error('No line items found in order');
  }

  // Her line item için fulfillment oluştur
  const fulfillmentLineItems = lineItems.map(item => ({
    id: item.id,
    quantity: item.quantity
  }));

  // Multiple fulfillment API attempts
  const fulfillmentApproaches = [
    // v1 ecommerce format
    () => axios.post(ECOM_FULFILLMENTS_CREATE, {
      fulfillment: {
        orderId: orderId,
        lineItems: fulfillmentLineItems,
        trackingInfo: {
          trackingNumber: `WMS-${Date.now()}`,
          shippingProvider: 'Warehouse Management System'
        }
      }
    }, { headers: headers() }),
    
    // v2 ecommerce format
    () => axios.post(ECOM_V2_FULFILLMENTS, {
      orderId: orderId,
      lineItems: fulfillmentLineItems,
      trackingInfo: {
        trackingNumber: `WMS-${Date.now()}`,
        shippingProvider: 'Warehouse Management System'  
      }
    }, { headers: headers() }),
    
    // stores format
    () => axios.post(STORES_FULFILLMENTS_CREATE, {
      orderId: orderId,
      lineItems: fulfillmentLineItems
    }, { headers: headers() })
  ];

  for (let i = 0; i < fulfillmentApproaches.length; i++) {
    try {
      console.log(`🔄 Fulfillment API denemesi ${i + 1}/${fulfillmentApproaches.length}...`);
      const response = await fulfillmentApproaches[i]();
      console.log(`✅ Fulfillment başarılı (API ${i + 1}):`, response.status);
      return response.data;
    } catch (apiError) {
      console.warn(`⚠️ Fulfillment API ${i + 1} başarısız: ${apiError.response?.status} - ${apiError.message}`);
      if (i === fulfillmentApproaches.length - 1) {
        throw apiError; // Son deneme de başarısızsa hatayı fırlat
      }
    }
  }
}

// Method 2: Cancel fulfillments (for NOT_FULFILLED)
async function tryCancelFulfillment(orderId, fulfillmentStatus) {
  if (fulfillmentStatus !== 'NOT_FULFILLED') {
    throw new Error('Cancel fulfillment only supports NOT_FULFILLED status');  
  }
  
  // Bu method şimdilik implement edilmedi
  throw new Error('Cancel fulfillment not yet implemented');
}

// Method 3: Legacy order update (fallback)
async function tryLegacyOrderUpdate(orderId, fulfillmentStatus) {
  // Son deneme - belki bazı field'lar güncellenebilirdir
  const response = await axios.patch(`${ECOM_ORDERS_UPDATE}/${orderId}`, {
    order: {
      // fulfillmentStatus yerine başka field'ları deneyebiliriz
      archived: false
    },
    fieldMask: {
      paths: ['archived']
    }
  }, { 
    headers: headers() 
  });
  throw new Error('Legacy update cannot change fulfillment status');
}

// Log sync attempts for monitoring
async function logWixSyncAttempt(orderId, status, result) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    order_id: orderId,
    target_status: status,
    result: result,
    source: 'WMS_AUTO_SYNC'
  };
  
  // Bu log'lar daha sonra Wix entegrasyonu için kullanılabilir
  console.log(`📊 Wix Sync Log:`, JSON.stringify(logEntry));
  
  // İlerisi için: Bu logları veritabanına da kaydedebiliriz
  // await run('INSERT INTO wix_sync_log (order_id, target_status, result, timestamp) VALUES (?, ?, ?, ?)', 
  //   [orderId, status, result, logEntry.timestamp]);
}

// Method 1: eCommerce PUT
async function tryEcomPut(orderId, fulfillmentStatus) {
  const updateData = { order: { fulfillmentStatus } };
  const response = await axios.put(`${ECOM_ORDERS_UPDATE}/${orderId}`, updateData, { 
    headers: headers() 
  });
  return response.data;
}

// Method 2: eCommerce PATCH
async function tryEcomPatch(orderId, fulfillmentStatus) {
  const updateData = { fulfillmentStatus };
  const response = await axios.patch(`${ECOM_ORDERS_UPDATE}/${orderId}`, updateData, { 
    headers: headers() 
  });
  return response.data;
}

// Method 3: Stores API PUT
async function tryStoresPut(orderId, fulfillmentStatus) {
  const updateData = { 
    order: { 
      id: orderId,
      fulfillmentStatus 
    } 
  };
  const response = await axios.put(`${STORES_V2_ORDERS_UPDATE}/${orderId}`, updateData, { 
    headers: headers() 
  });
  return response.data;
}

// Method 4: Create fulfillment (for FULFILLED status only)
async function tryFulfillmentCreate(orderId, fulfillmentStatus) {
  if (fulfillmentStatus !== 'FULFILLED') {
    throw new Error('Fulfillment creation only works for FULFILLED status');
  }
  
  const fulfillmentData = {
    fulfillment: {
      orderId: orderId,
      lineItems: [], // Auto-fulfill all items
      trackingInfo: {
        trackingNumber: 'WMS-AUTO',
        shippingProvider: 'WMS System'
      }
    }
  };
  
  const response = await axios.post(ECOM_FULFILLMENTS_CREATE, fulfillmentData, { 
    headers: headers() 
  });
  return response.data;
}

// Wix'ten tek bir siparişi ID ile al 
async function getOrderById(orderId) {
  try {
    const response = await axios.get(`${ECOM_ORDERS_UPDATE}/${orderId}`, { 
      headers: headers() 
    });
    return response.data;
  } catch (error) {
    console.error(`❌ Sipariş getirme hatası (${orderId}):`, error.response?.status, error.response?.data);
    throw error;
  }
}

module.exports = { 
  iterateProducts, 
  iterateOrders, 
  updateOrderFulfillment,
  getOrderById,
  s, 
  variantSuffix, 
  extractSku, 
  extractVariantSku, 
  extractCatalogIds 
};
