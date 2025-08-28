console.log('Script başlıyor...');
const $ = (s)=>document.querySelector(s);
console.log('$ fonksiyonu tanımlandı');
const API = {
  async listProducts(){ return fetch('/api/products').then(r=>r.json()) },
  async addProduct(p){ 
    const response = await fetch('/api/products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Ürün eklenirken hata oluştu');
    return result;
  },
  async listPackages(id){ return fetch('/api/products/'+id+'/packages').then(r=>r.json()) },
  async addPackage(id,p){ 
    const response = await fetch('/api/products/'+id+'/packages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Paket eklenirken hata oluştu');
    return result;
  },
  async updatePackage(id,p){ 
    const response = await fetch('/api/packages/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Paket güncellenirken hata oluştu');
    return result;
  },
  async delPackage(id){ return fetch('/api/packages/'+id,{method:'DELETE'}).then(r=>r.json()) },
  async updateProduct(id,p){ return fetch('/api/products/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}).then(r=>r.json()) },
  async deleteProduct(id){ return fetch('/api/products/'+id,{method:'DELETE'}).then(r=>r.json()) },
  async syncWix(){ return fetch('/api/sync/wix/products',{method:'POST'}).then(r=>r.json()) },
  async syncNetsis(){ return fetch('/api/sync/netsis/stockcards',{method:'POST'}).then(r=>r.json()) },
  async listLocations(){ return fetch('/api/locations').then(r=>r.json()) },
  async assignLocation(id, payload){ return fetch('/api/products/'+id+'/assign-location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(r=>r.json()) },
  
  // PK Package Management API
  async searchPkProducts(query, mainProductId = null) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (mainProductId) params.set('mainProductId', mainProductId);
    
    const response = await fetch(`/api/packages/search-pk-products?${params}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'PK ürün arama hatası');
    return result;
  },
  
  async autoMatchPkProducts(mainProductId = null) {
    const response = await fetch('/api/packages/auto-match', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ mainProductId })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Otomatik eşleştirme hatası');
    return result;
  },
  
  async addPackageFromPk(mainProductId, packageSku, packageName, quantity = 1) {
    const response = await fetch('/api/packages/add', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ mainProductId, packageSku, packageName, quantity })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'PK paket ekleme hatası');
    return result;
  }
};
console.log('API nesnesi tanımlandı');

let products=[], filteredProducts=[], currentPage = 1, itemsPerPage = 20;
console.log('Global değişkenler tanımlandı');

// Package editing state
let editingPackageId = null;
let currentProductId = null;
let currentEditingProduct = null;

// Renk için background color belirleme
function getColorBg(color) {
  if (!color) return '#f8f9fa';
  const c = color.toUpperCase();
  if (c.includes('BEYAZ') || c.includes('WHITE')) return '#f8f9fa';
  if (c.includes('SİYAH') || c.includes('BLACK')) return '#212529';
  if (c.includes('KAHVE') || c.includes('BROWN')) return '#8B4513';
  if (c.includes('GRİ') || c.includes('GRAY')) return '#6c757d';
  if (c.includes('ANTRASIT') || c.includes('ANTHRACITE')) return '#343a40';
  return '#17a2b8'; // default
}

// Renk için text color belirleme
function getColorText(color) {
  if (!color) return '#000';
  const c = color.toUpperCase();
  if (c.includes('BEYAZ') || c.includes('WHITE')) return '#000';
  return '#fff'; // dark backgrounds için white text
}

// Clear package form
function clearPackageForm() {
  // Turkish form
  $('#pkgNumber').value = '';
  $('#pkgNo').value = '';
  $('#pkgContent').value = '';
  $('#pkgColor').value = '';
  $('#pkgSku').value = '';
  $('#pkgBarcode').value = '';
  $('#pkgQty').value = 1;
  $('#pkgLength').value = '';
  $('#pkgWidth').value = '';
  $('#pkgHeight').value = '';
  $('#pkgWeight').value = '';
  $('#pkgVolume').value = '';
  
  // English form
  $('#pkgNumberEn').value = '';
  $('#pkgNoEn').value = '';
  $('#pkgContentEn').value = '';
  $('#pkgColorEn').value = '';
  $('#pkgSkuEn').value = '';
  $('#pkgBarcodeEn').value = '';
  $('#pkgQtyEn').value = 1;
  $('#pkgLengthEn').value = '';
  $('#pkgWidthEn').value = '';
  $('#pkgHeightEn').value = '';
  $('#pkgWeightEn').value = '';
  $('#pkgVolumeEn').value = '';
  
  editingPackageId = null;
  window.pendingPkPackage = null;
  const activeForm = getCurrentLanguage();
  $('#addPkgBtnText').textContent = activeForm === 'english' ? '📦 Add Package' : '📦 Paket Ekle';
  $('#cancelPkgBtn').style.display = 'none';
}

// Calculate volume automatically from dimensions
function calculateVolume() {
  const length = parseFloat($('#pkgLength').value) || 0;
  const width = parseFloat($('#pkgWidth').value) || 0;
  const height = parseFloat($('#pkgHeight').value) || 0;
  
  if (length > 0 && width > 0 && height > 0) {
    // Convert cm³ to m³ (divide by 1,000,000)
    const volumeM3 = (length * width * height) / 1000000;
    $('#pkgVolume').value = volumeM3.toFixed(3);
  } else {
    $('#pkgVolume').value = '';
  }
}

// Calculate volume for English form
function calculateVolumeEn() {
  const length = parseFloat($('#pkgLengthEn').value) || 0;
  const width = parseFloat($('#pkgWidthEn').value) || 0;
  const height = parseFloat($('#pkgHeightEn').value) || 0;
  
  if (length > 0 && width > 0 && height > 0) {
    // Convert cm³ to m³ (divide by 1,000,000)
    const volumeM3 = (length * width * height) / 1000000;
    $('#pkgVolumeEn').value = volumeM3.toFixed(3);
  } else {
    $('#pkgVolumeEn').value = '';
  }
}

// Cancel package editing
function cancelPackageEdit() {
  clearPackageForm();
}

// Generate barcode - only numbers
function generateBarcode() {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const barcode = `${timestamp}${random}`;
  const activeForm = getCurrentLanguage();
  if (activeForm === 'english') {
    $('#pkgBarcodeEn').value = barcode;
  } else {
    $('#pkgBarcode').value = barcode;
  }
}

// Open barcode selection modal
function openBarcodeSelectionModal() {
  // Reset modal state
  $('#manualBarcodeInput').style.display = 'none';
  $('#customBarcode').value = '';
  document.getElementById('barcodeSelectionModal').classList.add('show');
}

// Close barcode selection modal
function closeBarcodeSelectionModal() {
  document.getElementById('barcodeSelectionModal').classList.remove('show');
  $('#manualBarcodeInput').style.display = 'none';
  $('#customBarcode').value = '';
}

// Select barcode option
function selectBarcodeOption(option) {
  if (option === 'auto') {
    // Generate automatic barcode
    generateBarcode();
    closeBarcodeSelectionModal();
    proceedWithPackageAdd();
  } else if (option === 'manual') {
    // Show manual input
    $('#manualBarcodeInput').style.display = 'block';
    $('#customBarcode').focus();
  }
}

// Confirm manual barcode
function confirmManualBarcode() {
  const customBarcode = $('#customBarcode').value?.trim();
  if (!customBarcode) {
    alert('Lütfen barkod girin!');
    return;
  }
  
  // Set barcode for active form
  const activeForm = getCurrentLanguage();
  if (activeForm === 'english') {
    $('#pkgBarcodeEn').value = customBarcode;
  } else {
    $('#pkgBarcode').value = customBarcode;
  }
  
  closeBarcodeSelectionModal();
  proceedWithPackageAdd();
}

// Cancel manual barcode
function cancelManualBarcode() {
  $('#manualBarcodeInput').style.display = 'none';
  $('#customBarcode').value = '';
}

// Proceed with package add after barcode selection
async function proceedWithPackageAdd() {
  const activeForm = getCurrentLanguage();
  
  // Get form values based on active language
  let packageNumber, packageNo, barcode, packageContent, packageColor, packageSku, quantity, length, width, height, weight, volume;
  
  if (activeForm === 'english') {
    packageNumber = $('#pkgNumberEn').value?.trim();
    packageNo = $('#pkgNoEn').value?.trim();
    barcode = $('#pkgBarcodeEn').value?.trim();
    packageContent = $('#pkgContentEn').value?.trim();
    packageColor = $('#pkgColorEn').value?.trim();
    packageSku = $('#pkgSkuEn').value?.trim();
    quantity = parseInt($('#pkgQtyEn').value||1,10);
    length = parseFloat($('#pkgLengthEn').value) || null;
    width = parseFloat($('#pkgWidthEn').value) || null;
    height = parseFloat($('#pkgHeightEn').value) || null;
    weight = parseFloat($('#pkgWeightEn').value) || null;
    volume = parseFloat($('#pkgVolumeEn').value) || null;
  } else {
    packageNumber = $('#pkgNumber').value?.trim();
    packageNo = $('#pkgNo').value?.trim();
    barcode = $('#pkgBarcode').value?.trim();
    packageContent = $('#pkgContent').value?.trim();
    packageColor = $('#pkgColor').value?.trim();
    packageSku = $('#pkgSku').value?.trim();
    quantity = parseInt($('#pkgQty').value||1,10);
    length = parseFloat($('#pkgLength').value) || null;
    width = parseFloat($('#pkgWidth').value) || null;
    height = parseFloat($('#pkgHeight').value) || null;
    weight = parseFloat($('#pkgWeight').value) || null;
    volume = parseFloat($('#pkgVolume').value) || null;
  }
  
  if (!barcode) {
    alert(activeForm === 'english' ? 'Barcode is required!' : 'Barkod zorunludur!');
    openBarcodeSelectionModal();
    return;
  }
  
  const p = { 
    package_number: packageNumber || null,
    package_no: packageNo || null,
    package_content: packageContent || null,
    // Store current form data in appropriate language field
    package_name_tr: activeForm === 'turkish' ? packageNumber : ($('#pkgNumber').value?.trim() || null),
    package_name_en: activeForm === 'english' ? packageNumber : ($('#pkgNumberEn').value?.trim() || null),
    package_content_tr: activeForm === 'turkish' ? packageContent : ($('#pkgContent').value?.trim() || null),
    package_content_en: activeForm === 'english' ? packageContent : ($('#pkgContentEn').value?.trim() || null),
    color_tr: activeForm === 'turkish' ? packageColor : ($('#pkgColor').value?.trim() || null),
    color_en: activeForm === 'english' ? packageColor : ($('#pkgColorEn').value?.trim() || null),
    sku: packageSku || null,
    barcode: barcode, 
    quantity: quantity,
    length_cm: length,
    width_cm: width,
    height_cm: height,
    weight_kg: weight,
    volume_m3: volume
  };
  
  console.log('Package data being sent:', p);
  
  try {
    if (editingPackageId) {
      // Update existing package
      await API.updatePackage(editingPackageId, p);
    } else if (window.pendingPkPackage) {
      // Add PK package with all form data instead of using simplified API
      p.package_name = packageNumber; // Use packageNumber as package_name for compatibility
      await API.addPackage(currentProductId, p);
      // Clear pending PK package
      window.pendingPkPackage = null;
    } else {
      // Add new package
      await API.addPackage(currentProductId, p);
    }
  } catch (error) {
    alert(error.message || 'Bir hata oluştu');
    return;
  }
  
  await refresh();
  await refreshPackageList();
  clearPackageForm();
}

// Display PK search results
function displayPkSearchResults(packages) {
  const resultsContainer = $('#pkSearchResults');
  
  if (!packages || packages.length === 0) {
    resultsContainer.innerHTML = '<div style="padding: 15px; text-align: center; color: var(--muted);">PK ürün bulunamadı</div>';
    resultsContainer.style.display = 'block';
    return;
  }
  
  const resultsHtml = packages.map(pkg => `
    <div style="padding: 12px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
      <div style="flex: 1;">
        <div style="font-weight: 600; color: var(--primary);">${pkg.sku}</div>
        <div style="font-size: 0.9em; color: var(--muted); margin-top: 2px;">${pkg.name}</div>
        ${pkg.description ? `<div style="font-size: 0.85em; color: var(--muted); margin-top: 2px;">${pkg.description}</div>` : ''}
      </div>
      <button class="btn-sm" onclick="addPkPackage('${pkg.sku}', '${pkg.name.replace(/'/g, '\\\'')}')" 
              style="background: var(--success); color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer;">
        ➕ Ekle
      </button>
    </div>
  `).join('');
  
  resultsContainer.innerHTML = resultsHtml;
  resultsContainer.style.display = 'block';
}

// Get current active language
function getCurrentLanguage() {
  return document.getElementById('englishForm').style.display === 'none' ? 'turkish' : 'english';
}

// Switch language tab
function switchLanguageTab(language) {
  const turkishTab = $('#turkishTab');
  const englishTab = $('#englishTab');
  const turkishForm = $('#turkishForm');
  const englishForm = $('#englishForm');
  const packageListTurkish = $('#packageListTurkish');
  const packageListEnglish = $('#packageListEnglish');
  
  if (language === 'turkish') {
    turkishTab.classList.add('active');
    englishTab.classList.remove('active');
    turkishTab.style.background = 'var(--primary)';
    englishTab.style.background = 'var(--muted)';
    turkishForm.style.display = 'block';
    englishForm.style.display = 'none';
    packageListTurkish.style.display = 'block';
    packageListEnglish.style.display = 'none';
    $('#addPkgBtnText').textContent = editingPackageId ? '✏️ Paketi Güncelle' : '📦 Paket Ekle';
    $('#cancelBtnText').textContent = 'İptal';
  } else {
    englishTab.classList.add('active');
    turkishTab.classList.remove('active');
    englishTab.style.background = 'var(--primary)';
    turkishTab.style.background = 'var(--muted)';
    turkishForm.style.display = 'none';
    englishForm.style.display = 'block';
    packageListTurkish.style.display = 'none';
    packageListEnglish.style.display = 'block';
    $('#addPkgBtnText').textContent = editingPackageId ? '✏️ Update Package' : '📦 Add Package';
    $('#cancelBtnText').textContent = 'Cancel';
  }
  
  // Refresh package list to show in correct language
  refreshPackageList();
}

// Add PK package to main product
async function addPkPackage(packageSku, packageName) {
  if (!currentProductId) {
    alert('Ana ürün seçili değil');
    return;
  }
  
  // Store PK info and fill form with PK data
  window.pendingPkPackage = { packageSku, packageName };
  
  // Get main product name for default package name
  const mainProduct = products.find(p => p.id == currentProductId);
  const mainProductName = mainProduct ? mainProduct.name : '';
  
  const activeForm = getCurrentLanguage();
  
  // Fill common fields (shared)
  $('#pkgSku').value = packageSku;
  $('#pkgSkuEn').value = packageSku;
  $('#pkgBarcode').value = '';
  $('#pkgBarcodeEn').value = '';
  
  // Fill ONLY the active language-specific fields (DO NOT fill both)
  if (activeForm === 'english') {
    $('#pkgNumberEn').value = mainProductName;
    $('#pkgContentEn').value = '';
    $('#pkgColorEn').value = '';
    // DO NOT fill Turkish fields
  } else {
    $('#pkgNumber').value = mainProductName;
    $('#pkgContent').value = '';
    $('#pkgColor').value = '';
    // DO NOT fill English fields
  }
  
  // Clear search results
  $('#pkSearchResults').style.display = 'none';
  $('#pkSearchInput').value = '';
}

// Refresh package list
async function refreshPackageList() {
  if (!currentProductId) return;
  
  try {
    const list = await API.listPackages(currentProductId);
    const activeLanguage = getCurrentLanguage();
    
    // Turkish table
    const tbTurkish = $('#pkgList');
    tbTurkish.innerHTML = list.length ? list.map(pp=>`
      <tr>
        <td><strong>${pp.package_no || '-'}</strong></td>
        <td>
          <div><strong>Ad:</strong> ${pp.package_name_tr || pp.package_number || '-'}</div>
          <div><strong>İçerik:</strong> ${pp.package_content_tr || pp.package_content || '-'}</div>
          ${pp.color_tr ? `<div><strong>Renk:</strong> <span style="background: var(--hover); padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">${pp.color_tr}</span></div>` : ''}
        </td>
        <td><code style="background: var(--hover); padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">${pp.barcode}</code></td>
        <td style="text-align: center;"><span style="background: var(--accent); color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.85em;">${pp.quantity}</span></td>
        <td style="text-align: center;">${pp.weight_kg ? pp.weight_kg + ' kg' : '-'}</td>
        <td style="text-align: center;">${pp.volume_m3 ? pp.volume_m3 + ' m³' : '-'}</td>
        <td style="text-align: center;">
          <button data-pkedit="${pp.id}" style="background: var(--warning); color: white; border: none; border-radius: 4px; margin-right: 5px; padding: 6px 10px; font-size: 0.85em;">✏️ Düzenle</button>
          <button data-pkdel="${pp.id}" style="background: var(--danger); color: white; border: none; border-radius: 4px; padding: 6px 10px; font-size: 0.85em;">🗑️ Sil</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--muted);"><em>Henüz paket tanımlanmamış</em></td></tr>';
    
    // English table
    const tbEnglish = $('#pkgListEn');
    tbEnglish.innerHTML = list.length ? list.map(pp=>`
      <tr>
        <td><strong>${pp.package_no || '-'}</strong></td>
        <td>
          <div><strong>Name:</strong> ${pp.package_name_en || pp.package_number || '-'}</div>
          <div><strong>Content:</strong> ${pp.package_content_en || pp.package_content || '-'}</div>
          ${pp.color_en ? `<div><strong>Color:</strong> <span style="background: var(--hover); padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">${pp.color_en}</span></div>` : ''}
        </td>
        <td><code style="background: var(--hover); padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">${pp.barcode}</code></td>
        <td style="text-align: center;"><span style="background: var(--accent); color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.85em;">${pp.quantity}</span></td>
        <td style="text-align: center;">${pp.weight_kg ? pp.weight_kg + ' kg' : '-'}</td>
        <td style="text-align: center;">${pp.volume_m3 ? pp.volume_m3 + ' m³' : '-'}</td>
        <td style="text-align: center;">
          <button data-pkedit="${pp.id}" style="background: var(--warning); color: white; border: none; border-radius: 4px; margin-right: 5px; padding: 6px 10px; font-size: 0.85em;">✏️ Edit</button>
          <button data-pkdel="${pp.id}" style="background: var(--danger); color: white; border: none; border-radius: 4px; padding: 6px 10px; font-size: 0.85em;">🗑️ Delete</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--muted);"><em>No packages defined yet</em></td></tr>';
    
    // Also refresh main products list to show updated package count
    await refresh();
  } catch (error) {
    console.error('Package list refresh error:', error);
  }
}

// Edit product modal functions
function openEditModal(product) {
  currentEditingProduct = product;
  $('#editProdName').textContent = `${product.name} (${product.sku})`;
  $('#editSku').value = product.sku || '';
  $('#editName').value = product.name || '';
  $('#editPrice').value = product.price || '';
  $('#editBarcode').value = product.main_barcode || '';
  $('#editColor').value = product.color || '';
  $('#editDesc').value = product.description || '';
  
  document.getElementById('editProductModal').classList.add('show');
}

function closeEditModal() {
  currentEditingProduct = null;
  document.getElementById('editProductModal').classList.remove('show');
}

// New product modal functions
function openNewProductModal() {
  // Form temizle
  clearNewProductForm();
  document.getElementById('newProductModal').classList.add('show');
}

function closeNewProductModal() {
  clearNewProductForm();
  document.getElementById('newProductModal').classList.remove('show');
}

function clearNewProductForm() {
  $('#newSku').value = '';
  $('#newName').value = '';
  $('#newPrice').value = '';
  $('#newBarcode').value = '';
  $('#newColor').value = '';
  $('#newDesc').value = '';
  
  // Validation mesajlarını temizle
  document.querySelectorAll('#newProductModal .validation-error').forEach(el => el.remove());
  document.querySelectorAll('#newProductModal input, #newProductModal textarea').forEach(el => {
    el.style.borderColor = '';
  });
}

// SKU benzersizlik kontrolü
async function validateSKU(sku) {
  if (!sku) return { valid: false, message: 'SKU zorunludur' };
  
  // Format kontrolü (en az 3 karakter, harf-rakam-tire)
  if (!/^[A-Z0-9\-]{3,}$/i.test(sku)) {
    return { valid: false, message: 'SKU en az 3 karakter olmalı ve sadece harf, rakam, tire içermeli' };
  }
  
  // Benzersizlik kontrolü
  const existingProduct = products.find(p => p.sku.toLowerCase() === sku.toLowerCase());
  if (existingProduct) {
    return { valid: false, message: 'Bu SKU zaten kullanılıyor' };
  }
  
  return { valid: true };
}

// Form validation
function validateNewProductForm() {
  const sku = $('#newSku').value.trim().toUpperCase();
  const name = $('#newName').value.trim();
  const price = $('#newPrice').value;
  
  // Önceki hata mesajlarını temizle
  document.querySelectorAll('#newProductModal .validation-error').forEach(el => el.remove());
  document.querySelectorAll('#newProductModal input, #newProductModal textarea').forEach(el => {
    el.style.borderColor = '';
  });
  
  let hasErrors = false;
  
  // SKU kontrolü
  if (!sku) {
    showValidationError('newSku', 'SKU zorunludur');
    hasErrors = true;
  }
  
  // İsim kontrolü
  if (!name || name.length < 2) {
    showValidationError('newName', 'Ürün adı en az 2 karakter olmalı');
    hasErrors = true;
  }
  
  // Fiyat kontrolü (opsiyonel ama pozitif olmalı)
  if (price && (isNaN(price) || parseFloat(price) < 0)) {
    showValidationError('newPrice', 'Fiyat pozitif bir sayı olmalı');
    hasErrors = true;
  }
  
  return !hasErrors;
}

function showValidationError(inputId, message) {
  const input = document.getElementById(inputId);
  input.style.borderColor = 'var(--danger)';
  
  const error = document.createElement('div');
  error.className = 'validation-error';
  error.style.cssText = 'color: var(--danger); font-size: 0.8em; margin-top: 5px;';
  error.textContent = message;
  
  input.parentNode.appendChild(error);
}

async function saveNewProduct() {
  // Form validation
  if (!validateNewProductForm()) {
    return;
  }
  
  const sku = $('#newSku').value.trim().toUpperCase();
  const name = $('#newName').value.trim();
  
  // SKU benzersizlik kontrolü
  const skuValidation = await validateSKU(sku);
  if (!skuValidation.valid) {
    showValidationError('newSku', skuValidation.message);
    return;
  }
  
  const saveBtn = $('#saveNewProductBtn');
  const originalText = saveBtn.innerHTML;
  saveBtn.innerHTML = '⏳ Kaydediliyor...';
  saveBtn.disabled = true;
  
  try {
    const productData = {
      sku: sku,
      name: name,
      price: parseFloat($('#newPrice').value) || 0,
      main_barcode: $('#newBarcode').value.trim() || null,
      color: $('#newColor').value.trim() || null,
      description: $('#newDesc').value.trim() || null
    };
    
    const newProduct = await API.addProduct(productData);
    
    // Başarı mesajı
    alert(`✅ Ürün başarıyla eklendi!\n\nSKU: ${newProduct.sku}\nAd: ${newProduct.name}\n\nArtık paket ve konum ekleyebilirsiniz.`);
    
    await refresh();
    closeNewProductModal();
    
    // Yeni eklenen ürünü vurgula (opsiyonel)
    setTimeout(() => {
      const newRow = document.querySelector(`[data-edit="${newProduct.id}"]`)?.closest('tr');
      if (newRow) {
        newRow.style.background = 'var(--success)';
        newRow.style.color = 'white';
        setTimeout(() => {
          newRow.style.background = '';
          newRow.style.color = '';
        }, 2000);
      }
    }, 100);
    
  } catch (error) {
    alert('❌ Ürün ekleme hatası:\n' + error.message);
  } finally {
    saveBtn.innerHTML = originalText;
    saveBtn.disabled = false;
  }
}

// Global scope için window'a ekle
window.closeEditModal = closeEditModal;
window.openEditModal = openEditModal;
window.openNewProductModal = openNewProductModal;
window.closeNewProductModal = closeNewProductModal;
window.saveNewProduct = saveNewProduct;

async function saveProduct() {
  if (!currentEditingProduct) return;
  
  const sku = $('#editSku').value.trim();
  const name = $('#editName').value.trim();
  
  if (!sku || !name) {
    alert('SKU ve Ürün Adı zorunludur!');
    return;
  }
  
  const saveBtn = $('#saveProductBtn');
  const originalText = saveBtn.textContent;
  saveBtn.textContent = 'Kaydediliyor...';
  saveBtn.disabled = true;
  
  try {
    const updatedData = {
      sku: sku,
      name: name,
      price: parseFloat($('#editPrice').value) || 0,
      main_barcode: $('#editBarcode').value.trim() || null,
      color: $('#editColor').value || null,
      description: $('#editDesc').value.trim() || null
    };
    
    await API.updateProduct(currentEditingProduct.id, updatedData);
    await refresh();
    closeEditModal();
  } catch (error) {
    alert('Güncelleme hatası: ' + error.message);
  } finally {
    saveBtn.textContent = originalText;
    saveBtn.disabled = false;
  }
}

// saveProduct'ı da global scope'a ekle
window.saveProduct = saveProduct;

// PK package management functions
window.addPkPackage = addPkPackage;
window.refreshPackageList = refreshPackageList;
window.displayPkSearchResults = displayPkSearchResults;
// Barcode selection functions
window.generateBarcode = generateBarcode;
window.openBarcodeSelectionModal = openBarcodeSelectionModal;
window.closeBarcodeSelectionModal = closeBarcodeSelectionModal;
window.selectBarcodeOption = selectBarcodeOption;
window.confirmManualBarcode = confirmManualBarcode;
window.cancelManualBarcode = cancelManualBarcode;
// Volume calculation
window.calculateVolume = calculateVolume;
window.calculateVolumeEn = calculateVolumeEn;
// Language switching
window.switchLanguageTab = switchLanguageTab;
window.getCurrentLanguage = getCurrentLanguage;

// Load package data for editing
function loadPackageForEdit(pkg) {
  const activeForm = getCurrentLanguage();
  
  // Common fields (shared between languages)
  $('#pkgNo').value = pkg.package_no || '';
  $('#pkgNoEn').value = pkg.package_no || '';
  $('#pkgSku').value = pkg.sku || '';
  $('#pkgSkuEn').value = pkg.sku || '';
  $('#pkgBarcode').value = pkg.barcode || '';
  $('#pkgBarcodeEn').value = pkg.barcode || '';
  $('#pkgQty').value = pkg.quantity || 1;
  $('#pkgQtyEn').value = pkg.quantity || 1;
  $('#pkgLength').value = pkg.length_cm || '';
  $('#pkgLengthEn').value = pkg.length_cm || '';
  $('#pkgWidth').value = pkg.width_cm || '';
  $('#pkgWidthEn').value = pkg.width_cm || '';
  $('#pkgHeight').value = pkg.height_cm || '';
  $('#pkgHeightEn').value = pkg.height_cm || '';
  $('#pkgWeight').value = pkg.weight_kg || '';
  $('#pkgWeightEn').value = pkg.weight_kg || '';
  $('#pkgVolume').value = pkg.volume_m3 || '';
  $('#pkgVolumeEn').value = pkg.volume_m3 || '';
  
  // Language-specific fields
  $('#pkgNumber').value = pkg.package_name_tr || pkg.package_number || '';
  $('#pkgContent').value = pkg.package_content_tr || pkg.package_content || '';
  $('#pkgColor').value = pkg.color_tr || '';
  $('#pkgNumberEn').value = pkg.package_name_en || pkg.package_number || '';
  $('#pkgContentEn').value = pkg.package_content_en || pkg.package_content || '';
  $('#pkgColorEn').value = pkg.color_en || '';
  
  editingPackageId = pkg.id;
  $('#addPkgBtnText').textContent = activeForm === 'english' ? '✏️ Update Package' : '✏️ Paketi Güncelle';
  $('#cancelPkgBtn').style.display = 'inline-block';
}

// Filtreleme ve arama fonksiyonu
function filterProducts() {
  const searchTerm = $('#searchInput').value.toLowerCase();
  const statusFilter = $('#statusFilter').value;
  const sortBy = $('#sortBy').value;

  // Arama filtresi
  filteredProducts = products.filter(p => {
    const matchesSearch = !searchTerm || 
      p.sku.toLowerCase().includes(searchTerm) ||
      p.name.toLowerCase().includes(searchTerm) ||
      (p.main_barcode && p.main_barcode.toLowerCase().includes(searchTerm));
    
    // Durum filtresi
    let matchesStatus = true;
    if (statusFilter === 'no-packages') {
      matchesStatus = !p.packages || p.packages.length === 0;
    } else if (statusFilter === 'no-location') {
      matchesStatus = !p.location_codes || p.location_codes.length === 0;
    } else if (statusFilter === 'stocked') {
      matchesStatus = p.location_codes && p.location_codes.length > 0;
    } else if (statusFilter === 'out-of-stock') {
      matchesStatus = !p.location_codes || p.location_codes.length === 0;
    }
    
    return matchesSearch && matchesStatus;
  });

  // Sıralama
  filteredProducts.sort((a, b) => {
    switch(sortBy) {
      case 'sku': return a.sku.localeCompare(b.sku);
      case 'price': return (a.price || 0) - (b.price || 0);
      case 'created': return new Date(b.created_at) - new Date(a.created_at);
      default: return a.name.localeCompare(b.name);
    }
  });

  currentPage = 1;
  currentFilteredProducts = filteredProducts; // Global değişken güncelle
  renderProducts();
}

// Ürünleri render et
function renderProducts() {
  console.log('📋 Render başlatılıyor. Filtrelenmiş ürün sayısı:', filteredProducts.length);
  const startIdx = (currentPage - 1) * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const pageProducts = filteredProducts.slice(startIdx, endIdx);
  console.log('📄 Sayfada gösterilecek ürünler:', pageProducts.length);
  
  const tb = $('#prodTable tbody');
  tb.innerHTML = pageProducts.map(p => {
    // Wix stok miktarına göre durumu belirle
    const wixStock = p.inventory_quantity || 0;
    const stockInfo = wixStock > 0 ? `✅ Stok: ${wixStock}` : '❌ Stok Yok';
    const stockClass = wixStock > 0 ? 'in-stock' : 'out-of-stock';
    
    return `<tr>
      <td><input type="checkbox" class="product-select" value="${p.id}"></td>
      <td>
        <div class="product-image">📦</div>
      </td>
      <td>
        <code class="proper-sku">${p.sku}</code>
      </td>
      <td>
        <div class="product-name">${p.name}</div>
        ${p.description ? `<small>${p.description}</small>` : ''}
      </td>
      <td><strong>₺${(p.price||0).toFixed(2)}</strong></td>
      <td>
        <span class="stock-status ${stockClass}">
          ${stockInfo}
        </span>
      </td>
      <td>
        ${p.color ? `<span style="background: ${getColorBg(p.color)}; color: ${getColorText(p.color)}; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;">${p.color}</span>` : '<span class="no-color">-</span>'}
      </td>
      <td>
        <div class="locations">
          ${(p.location_codes||[]).map(loc => `<span class="location-tag">${loc}</span>`).join('') || '<span class="no-location">Konum Yok</span>'}
        </div>
      </td>
      <td>
        <span class="badge package-count">${(p.packages||[]).length} paket</span>
      </td>
      <td>
        <small>${new Date(p.updated_at || p.created_at).toLocaleDateString('tr-TR')}</small>
      </td>
      <td class="actions">
        <button class="btn-sm" data-pkg="${p.id}" title="Paketleri Yönet">📦</button>
        <button class="btn-sm" data-loc="${p.id}" title="Konum Ata">📍</button>
        <button class="btn-sm" data-edit="${p.id}" title="Düzenle">✏️</button>
        <button class="btn-sm btn-danger" data-del="${p.id}" title="Sil">🗑️</button>
      </td>
    </tr>`;
  }).join('');

  // Sayfa bilgisini güncelle
  $('#productCount').textContent = filteredProducts.length;
  
  // Pagination render et
  renderPagination();
}

// Pagination
function renderPagination() {
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const pagination = $('#pagination');
  
  if (totalPages <= 1) {
    pagination.innerHTML = '';
    return;
  }
  
  let paginationHtml = '';
  
  // Önceki sayfa
  if (currentPage > 1) {
    paginationHtml += `<button class="page-btn" onclick="changePage(${currentPage - 1})">&laquo; Önceki</button>`;
  }
  
  // Sayfa numaraları
  for (let i = 1; i <= totalPages; i++) {
    if (i === currentPage) {
      paginationHtml += `<button class="page-btn active">${i}</button>`;
    } else if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 2) {
      paginationHtml += `<button class="page-btn" onclick="changePage(${i})">${i}</button>`;
    } else if (i === currentPage - 3 || i === currentPage + 3) {
      paginationHtml += `<span class="page-dots">...</span>`;
    }
  }
  
  // Sonraki sayfa
  if (currentPage < totalPages) {
    paginationHtml += `<button class="page-btn" onclick="changePage(${currentPage + 1})">Sonraki &raquo;</button>`;
  }
  
  pagination.innerHTML = paginationHtml;
}

// Sayfa değiştirme (global scope'ta tanımlanmalı)
window.changePage = function(page) {
  currentPage = page;
  renderProducts();
}

// Ana refresh fonksiyonu
async function refresh(){
  try {
    console.log('🔄 Ürünler yükleniyor...');
    products = await API.listProducts();
    console.log('✅ Ürünler yüklendi:', products.length, 'ürün');
    filteredProducts = [...products];
    currentFilteredProducts = filteredProducts; // Global değişken güncelle
    renderProducts();
  } catch (error) {
    console.error('❌ Ürünler yüklenirken hata:', error);
    alert('Ürünler yüklenirken hata oluştu: ' + error.message);
  }
}


// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Yeni ürün ekleme butonu
  $('#addNewProduct').addEventListener('click', openNewProductModal);
  
  // Arama ve filtreler
  $('#searchInput').addEventListener('input', filterProducts);
  $('#statusFilter').addEventListener('change', filterProducts);
  $('#sortBy').addEventListener('change', filterProducts);
  
  // Filtreleri temizle
  $('#clearFilters').addEventListener('click', () => {
    $('#searchInput').value = '';
    $('#statusFilter').value = '';
    $('#sortBy').value = 'name';
    filterProducts();
  });
  
  // Tümünü seç/kaldır
  $('#selectAll').addEventListener('change', (e) => {
    const checkboxes = document.querySelectorAll('.product-select');
    checkboxes.forEach(cb => cb.checked = e.target.checked);
  });
  
  // CSV export
  $('#exportProducts').addEventListener('click', () => {
    const selected = getSelectedProducts();
    const dataToExport = selected.length > 0 ? selected : filteredProducts;
    exportToCSV(dataToExport);
  });
  
  // Package form cancel button
  $('#cancelPkgBtn').addEventListener('click', () => {
    clearPackageForm();
  });
  
  // PK Search functionality
  $('#searchPkBtn').addEventListener('click', async () => {
    const query = $('#pkSearchInput').value.trim();
    if (!query) {
      alert('Arama için PK kodu girin');
      return;
    }
    
    try {
      $('#searchPkBtn').textContent = '⏳ Aranıyor...';
      const result = await API.searchPkProducts(query, currentProductId);
      displayPkSearchResults(result.packages);
    } catch (error) {
      alert(`Arama hatası: ${error.message}`);
    } finally {
      $('#searchPkBtn').textContent = '🔍 Ara';
    }
  });
  
  // Auto-match PK products
  $('#autoMatchPkBtn').addEventListener('click', async () => {
    if (!currentProductId) {
      alert('Bir ana ürün seçili değil');
      return;
    }
    
    const confirmed = confirm('Bu ana ürüne ait tüm PK ürünleri otomatik olarak eşleştirilecek. Devam edilsin mi?');
    if (!confirmed) return;
    
    try {
      $('#autoMatchPkBtn').textContent = '⏳ Eşleştiriliyor...';
      const result = await API.autoMatchPkProducts(currentProductId);
      
      alert(`✅ ${result.matchCount} paket otomatik olarak eşleştirildi!`);
      
      // Refresh package list
      await refreshPackageList();
    } catch (error) {
      alert(`Otomatik eşleştirme hatası: ${error.message}`);
    } finally {
      $('#autoMatchPkBtn').textContent = '🤖 Otomatik Eşleştir';
    }
  });
  
  // PK search input - Enter key support
  $('#pkSearchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      $('#searchPkBtn').click();
    }
  });
  
  // Real-time SKU validation
  $('#newSku').addEventListener('input', async (e) => {
    const sku = e.target.value.trim().toUpperCase();
    e.target.value = sku; // Auto uppercase
    
    if (sku.length >= 3) {
      const validation = await validateSKU(sku);
      
      // Önceki mesajları temizle
      const existingError = e.target.parentNode.querySelector('.validation-error');
      if (existingError) existingError.remove();
      
      if (!validation.valid) {
        showValidationError('newSku', validation.message);
      } else {
        e.target.style.borderColor = 'var(--success)';
      }
    }
  });
  
  // Sync common fields between Turkish and English forms
  function syncCommonFields() {
    // Package No sync
    $('#pkgNo').addEventListener('input', (e) => {
      $('#pkgNoEn').value = e.target.value;
    });
    $('#pkgNoEn').addEventListener('input', (e) => {
      $('#pkgNo').value = e.target.value;
    });
    
    // SKU sync
    $('#pkgSku').addEventListener('input', (e) => {
      $('#pkgSkuEn').value = e.target.value;
    });
    $('#pkgSkuEn').addEventListener('input', (e) => {
      $('#pkgSku').value = e.target.value;
    });
    
    // Barcode sync
    $('#pkgBarcode').addEventListener('input', (e) => {
      $('#pkgBarcodeEn').value = e.target.value;
    });
    $('#pkgBarcodeEn').addEventListener('input', (e) => {
      $('#pkgBarcode').value = e.target.value;
    });
    
    // Quantity sync
    $('#pkgQty').addEventListener('input', (e) => {
      $('#pkgQtyEn').value = e.target.value;
    });
    $('#pkgQtyEn').addEventListener('input', (e) => {
      $('#pkgQty').value = e.target.value;
    });
    
    // Length sync
    $('#pkgLength').addEventListener('input', (e) => {
      $('#pkgLengthEn').value = e.target.value;
      calculateVolume();
      calculateVolumeEn();
    });
    $('#pkgLengthEn').addEventListener('input', (e) => {
      $('#pkgLength').value = e.target.value;
      calculateVolume();
      calculateVolumeEn();
    });
    
    // Width sync
    $('#pkgWidth').addEventListener('input', (e) => {
      $('#pkgWidthEn').value = e.target.value;
      calculateVolume();
      calculateVolumeEn();
    });
    $('#pkgWidthEn').addEventListener('input', (e) => {
      $('#pkgWidth').value = e.target.value;
      calculateVolume();
      calculateVolumeEn();
    });
    
    // Height sync
    $('#pkgHeight').addEventListener('input', (e) => {
      $('#pkgHeightEn').value = e.target.value;
      calculateVolume();
      calculateVolumeEn();
    });
    $('#pkgHeightEn').addEventListener('input', (e) => {
      $('#pkgHeight').value = e.target.value;
      calculateVolume();
      calculateVolumeEn();
    });
    
    // Weight sync
    $('#pkgWeight').addEventListener('input', (e) => {
      $('#pkgWeightEn').value = e.target.value;
    });
    $('#pkgWeightEn').addEventListener('input', (e) => {
      $('#pkgWeight').value = e.target.value;
    });
    
    // Volume sync (readonly, but sync anyway)
    $('#pkgVolume').addEventListener('input', (e) => {
      $('#pkgVolumeEn').value = e.target.value;
    });
    $('#pkgVolumeEn').addEventListener('input', (e) => {
      $('#pkgVolume').value = e.target.value;
    });
  }
  
  // Initialize common field sync
  syncCommonFields();
  
});


// CSV export fonksiyonu
function exportToCSV(products) {
  const headers = [
    'SKU', 
    'Ad', 
    'Fiyat', 
    'Stok', 
    'Konum', 
    'Paket Sayısı',
    'Paket Detayları',
    'Son Güncelleme'
  ];
  
  const csvContent = [
    headers.join(','),
    ...products.map(p => {
      // Paket detaylarını formatted string olarak hazırla
      const packageDetails = (p.packages || []).map(pkg => {
        const parts = [];
        if (pkg.package_name) parts.push(`Ad:${pkg.package_name}`);
        if (pkg.barcode) parts.push(`Barkod:${pkg.barcode}`);
        if (pkg.quantity) parts.push(`Adet:${pkg.quantity}`);
        if (pkg.package_number) parts.push(`No:${pkg.package_number}`);
        if (pkg.package_content) parts.push(`İçerik:${pkg.package_content}`);
        if (pkg.weight_kg) parts.push(`Ağırlık:${pkg.weight_kg}kg`);
        if (pkg.volume_m3) parts.push(`Hacim:${pkg.volume_m3}m³`);
        return parts.join('|');
      }).join('; ');
      
      return [
        p.sku,
        `"${p.name}"`,
        p.price || 0,
        p.inventory_quantity || 0,
        (p.location_codes || []).join(';'),
        (p.packages || []).length,
        `"${packageDetails}"`,
        p.updated_at || p.created_at
      ].join(',');
    })
  ].join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `urunler_detayli_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
}


document.body.addEventListener('click', async (e)=>{
  const pkgId = e.target.getAttribute('data-pkg');
  const delId = e.target.getAttribute('data-del');
  const editId = e.target.getAttribute('data-edit');
  
  if(e.target.id==='syncWix'){ 
    const btn = e.target;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">Senkronize Ediliyor...</span>';
    btn.disabled = true;
    
    try {
      const r = await API.syncWix(); 
      document.getElementById('syncOut').textContent = r.ok ? ('+'+r.imported+' ürün') : (r.error || 'Hata'); 
      await refresh();
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }
  
  if(e.target.id==='syncNetsis'){ 
    const btn = e.target;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">Netsis Senkronize Ediliyor...</span>';
    btn.disabled = true;
    
    try {
      const r = await API.syncNetsis(); 
      document.getElementById('syncOut').textContent = r.ok ? ('+'+r.imported+' stok kartı') : (r.error || 'Hata'); 
      await refresh();
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }
  if(pkgId){
    currentProductId = pkgId;
    const prod = products.find(x=>x.id==pkgId);
    $('#pkgProdName').textContent = `${prod.name} (${prod.sku})`;
    const list = await API.listPackages(pkgId);
    const tb = $('#pkgList');
    
    // Clear form first
    clearPackageForm();
    
    // Set product name as default package name ONLY for active language
    const currentLang = getCurrentLanguage();
    if (currentLang === 'english') {
      $('#pkgNumberEn').value = prod.name;
      $('#pkgContentEn').value = '';
      $('#pkgColorEn').value = '';
      // Do NOT fill Turkish fields
    } else {
      $('#pkgNumber').value = prod.name;
      $('#pkgContent').value = '';
      $('#pkgColor').value = '';
      // Do NOT fill English fields
    }
    
    tb.innerHTML = list.length ? list.map(pp=>`
      <tr>
        <td><strong>${pp.package_number || '-'}</strong></td>
        <td>${pp.package_content || pp.package_name || '-'}</td>
        <td><code style="background: var(--hover); padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">${pp.barcode}</code></td>
        <td style="text-align: center;"><span style="background: var(--accent); color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.85em;">${pp.quantity}</span></td>
        <td style="text-align: center;">${pp.weight_kg ? pp.weight_kg + ' kg' : '-'}</td>
        <td style="text-align: center;">${pp.volume_m3 ? pp.volume_m3 + ' m³' : '-'}</td>
        <td style="text-align: center;">
          <button data-pkedit="${pp.id}" style="background: var(--warning); color: white; border: none; border-radius: 4px; margin-right: 5px;">✏️ Düzenle</button>
          <button data-pkdel="${pp.id}" style="background: var(--danger); color: white; border: none; border-radius: 4px;">🗑️ Sil</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--muted);"><em>Henüz paket tanımlanmamış</em></td></tr>';
    $('#pkgModal').classList.add('show');
    
    $('#addPkgBtn').onclick = async ()=>{
      // No required fields check for package number anymore
      
      // Check if barcode is set for active form
      const activeForm = getCurrentLanguage();
      const barcode = activeForm === 'english' ? 
        $('#pkgBarcodeEn').value?.trim() : 
        $('#pkgBarcode').value?.trim();
      
      if (!barcode || barcode === 'Barkod seçimi yapılacak...' || barcode === 'Barcode selection will be made...') {
        // Open barcode selection modal
        openBarcodeSelectionModal();
        return;
      }
      
      // If barcode is set, proceed directly
      await proceedWithPackageAdd();
    };
  }
  if(delId){ await API.deleteProduct(delId); await refresh(); }
  const locId = e.target.getAttribute('data-loc');
  if(locId){
    const prodObj = products.find(x=>x.id==locId);
    document.getElementById('locProdName').textContent = `${prodObj.name} (${prodObj.sku})`;
    const list = await fetch('/api/products/'+locId+'/locations').then(r=>r.json());
    document.getElementById('locList').innerHTML = list.map(l=>`<tr><td>${l.code}</td><td>${l.on_hand}</td></tr>`).join('');
    document.getElementById('locModal').classList.add('show');
    document.getElementById('assignLocBtn').onclick = async ()=>{
      const code = document.getElementById('locCode').value.trim();
      const qty = parseInt(document.getElementById('locQty').value||'0',10);
      if(!code) return alert('Kod lazım');
      await API.assignLocation(locId, { code, on_hand: qty });
      const list2 = await fetch('/api/products/'+locId+'/locations').then(r=>r.json());
      document.getElementById('locList').innerHTML = list2.map(l=>`<tr><td>${l.code}</td><td>${l.on_hand}</td></tr>`).join('');
      document.getElementById('locCode').value=''; document.getElementById('locQty').value=0;
      await refresh();
    };
  }
  if(editId){
    const p = products.find(x=>x.id==editId);
    openEditModal(p);
  }
  const pkedit = e.target.getAttribute('data-pkedit');
  if(pkedit){
    // Find the package data and load for editing
    const list = await API.listPackages(currentProductId);
    const pkg = list.find(p => p.id == pkedit);
    if(pkg) {
      loadPackageForEdit(pkg);
    }
  }
  const pkdel = e.target.getAttribute('data-pkdel');
  if(pkdel){ await API.delPackage(pkdel); await refresh(); }
  
  // Barkod İşlemleri buton event listener
  if(e.target.id === 'bulkBarcodeActions') {
    updateBarcodeActionCounts();
    openBarcodeActionsModal();
  }
});

// Barkod İşlemleri Fonksiyonları
function openBarcodeActionsModal() {
  $('#barcodeActionsModal').style.display = 'block';
  
  // Ana üründen alt paket seçimi için gerekli alanları hazırla
  setupPackageSelection();
  
  updateBarcodePreview();
  updateTemplatePreview();
}

// Alt paket seçimi için setup fonksiyonu
async function setupPackageSelection() {
  const selectedProducts = getSelectedProducts();
  
  if (selectedProducts.length === 1) {
    const mainProduct = selectedProducts[0];
    await loadProductPackages(mainProduct.id);
  } else {
    // Çoklu seçim veya seçim yok ise paket seçim alanını gizle
    hidePackageSelection();
  }
}

// Ana ürünün alt paketlerini yükle
async function loadProductPackages(productId) {
  try {
    const response = await fetch(`/api/products/${productId}/packages`);
    const packages = await response.json();
    
    if (packages.length > 0) {
      showPackageSelection(packages);
    } else {
      hidePackageSelection();
    }
  } catch (error) {
    console.error('Alt paketler yüklenemedi:', error);
    hidePackageSelection();
  }
}

// Alt paket seçim arayüzünü göster
function showPackageSelection(packages) {
  const printTab = document.getElementById('printTab');
  let packageSelectionArea = document.getElementById('packageSelectionArea');
  
  if (!packageSelectionArea) {
    // Alt paket seçim alanını oluştur
    packageSelectionArea = document.createElement('div');
    packageSelectionArea.id = 'packageSelectionArea';
    packageSelectionArea.style.cssText = `
      background: var(--section);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1rem;
    `;
    
    // Print seçeneklerinden önce ekle
    const printOptionsDiv = printTab.querySelector('.print-options');
    printTab.insertBefore(packageSelectionArea, printOptionsDiv);
  }
  
  packageSelectionArea.innerHTML = `
    <h4 style="color: var(--accent); margin-bottom: 1rem; display: flex; align-items: center;">
      📦 Alt Paket Seçimi
      <span style="font-size: 0.8rem; color: var(--muted); margin-left: 1rem;">Bu ana ürüne ait ${packages.length} paket bulundu</span>
    </h4>
    
    <div style="margin-bottom: 1rem;">
      <label style="display: flex; align-items: center; margin-bottom: 0.5rem;">
        <input type="checkbox" id="selectAllPackages" onchange="toggleAllPackages()" style="margin-right: 0.5rem;">
        <span style="color: var(--accent);">Tüm Paketleri Seç</span>
      </label>
    </div>
    
    <div class="packages-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem; max-height: 200px; overflow-y: auto;">
      ${packages.map(pkg => `
        <label class="package-item" style="
          display: flex;
          align-items: center;
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.75rem;
          cursor: pointer;
          transition: all 0.2s ease;
        " onmouseover="this.style.background='var(--hover)'" onmouseout="this.style.background='var(--card)'">
          <input type="checkbox" class="package-checkbox" value="${pkg.id}" style="margin-right: 0.75rem;" data-package='${JSON.stringify(pkg)}'>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: var(--fg); margin-bottom: 0.25rem;">
              ${pkg.package_name || 'İsimsiz Paket'}
            </div>
            <div style="font-size: 0.9rem; color: var(--muted); margin-bottom: 0.25rem;">
              Barkod: <code style="background: var(--section); padding: 2px 4px; border-radius: 3px;">${pkg.barcode}</code>
            </div>
            <div style="font-size: 0.85rem; color: var(--muted);">
              Adet: ${pkg.quantity || 1} | SKU: ${pkg.sku || 'N/A'}
            </div>
          </div>
        </label>
      `).join('')}
    </div>
  `;
  
  packageSelectionArea.style.display = 'block';
}

// Alt paket seçim arayüzünü gizle
function hidePackageSelection() {
  const packageSelectionArea = document.getElementById('packageSelectionArea');
  if (packageSelectionArea) {
    packageSelectionArea.style.display = 'none';
  }
}

// Tüm paketleri seç/seçme
function toggleAllPackages() {
  const selectAll = document.getElementById('selectAllPackages').checked;
  const checkboxes = document.querySelectorAll('.package-checkbox');
  
  checkboxes.forEach(checkbox => {
    checkbox.checked = selectAll;
  });
}

// Seçili alt paketleri al
function getSelectedPackages() {
  const checkboxes = document.querySelectorAll('.package-checkbox:checked');
  return Array.from(checkboxes).map(cb => {
    return JSON.parse(cb.dataset.package);
  });
}

// Seçili paketlerden örnek verileri güncelle
function updateSampleDataFromSelectedPackages() {
  const selectedPackages = getSelectedPackages();
  
  if (selectedPackages.length > 0) {
    const firstPackage = selectedPackages[0];
    
    // Örnek veri alanlarını seçili paket verisiyle doldur
    if($('#samplePackageSKU')) $('#samplePackageSKU').value = firstPackage.sku || firstPackage.barcode;
    if($('#samplePackageName')) $('#samplePackageName').value = firstPackage.package_name || 'Paket';
    if($('#samplePackageBarcode')) $('#samplePackageBarcode').value = firstPackage.barcode;
    if($('#samplePackageQuantity')) $('#samplePackageQuantity').value = (firstPackage.quantity || 1) + ' adet';
    if($('#samplePackageContent')) $('#samplePackageContent').value = firstPackage.package_content || firstPackage.package_name || 'Paket içeriği';
    
    // Boyut bilgileri varsa kullan
    let dimensions = '';
    if (firstPackage.length_cm && firstPackage.width_cm && firstPackage.height_cm) {
      dimensions = `${firstPackage.length_cm}x${firstPackage.width_cm}x${firstPackage.height_cm}cm`;
    } else {
      dimensions = 'Boyut bilgisi yok';
    }
    if($('#samplePackageDimensions')) $('#samplePackageDimensions').value = dimensions;
    
    // Ağırlık bilgisi varsa kullan
    const weight = firstPackage.weight_kg ? firstPackage.weight_kg + 'kg' : 'Ağırlık bilgisi yok';
    if($('#samplePackageWeight')) $('#samplePackageWeight').value = weight;
    
    // Ana ürün bilgisini çek (bu bilgi ayrıca API'den alınabilir)
    loadMainProductInfo(firstPackage.product_id);
  }
}

// Ana ürün bilgisini yükle
async function loadMainProductInfo(productId) {
  try {
    const response = await fetch(`/api/products?id=${productId}`);
    const products = await response.json();
    
    if (products && products.length > 0) {
      const mainProduct = products[0];
      if($('#sampleMainProduct')) $('#sampleMainProduct').value = mainProduct.name || 'Ana Ürün';
    }
  } catch (error) {
    console.log('Ana ürün bilgisi yüklenemedi:', error);
  }
}

window.closeBarcodeActionsModal = function() {
  $('#barcodeActionsModal').style.display = 'none';
}

window.showBarcodeTab = function(tabName) {
  // Tab butonlarını güncelle
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`[onclick="showBarcodeTab('${tabName}')"]`).classList.add('active');
  
  // Tab içeriklerini güncelle
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  document.getElementById(tabName + 'Tab').classList.add('active');
  
  // Template editör tab'ına geçildiğinde örnek verileri güncelle
  if (tabName === 'template') {
    updateSampleDataFromSelectedPackages();
    if(window.updateTemplatePreview) {
      updateTemplatePreview();
    }
  }
}

function updateBarcodeActionCounts() {
  const selectedProducts = getSelectedProducts();
  const filteredProducts = getFilteredProducts();
  
  $('#selectedCount').textContent = selectedProducts.length;
  $('#filteredCount').textContent = filteredProducts.length;
  $('#totalCount').textContent = products.length;
}

function getSelectedProducts() {
  const checkboxes = document.querySelectorAll('#prodTable tbody input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => {
    const productId = cb.value;
    return products.find(p => p.id == productId);
  }).filter(p => p);
}

function getFilteredProducts() {
  // Mevcut filtreleme mantığını kullan
  return currentFilteredProducts || products;
}

function updateBarcodePreview() {
  const template = $('#templateSelect').value;
  const includePrices = $('#includePrices').checked;
  const includeStock = $('#includeStock').checked;
  const includeLocation = $('#includeLocation').checked;
  const copyCount = parseInt($('#copyCount').value) || 1;
  
  // Alt paket seçimi varsa paketleri kullan, yoksa ana ürünleri kullan
  const selectedPackages = getSelectedPackages();
  
  if (selectedPackages.length > 0) {
    // Alt paket seçimi varsa paket bazında yazdırma
    updatePackageBasedPreview(selectedPackages, template, { includePrices, includeStock, includeLocation, copyCount });
  } else {
    // Normal ana ürün yazdırma
    updateProductBasedPreview(template, { includePrices, includeStock, includeLocation, copyCount });
  }
}

// Alt paket bazında önizleme
function updatePackageBasedPreview(packages, template, options) {
  if(packages.length === 0) {
    $('#barcodePreview').innerHTML = '<div style="color: var(--muted);">Yazdırılacak paket seçin</div>';
    return;
  }
  
  const { copyCount } = options;
  const samplePackage = packages[0];
  
  // Alt paket için özel HTML oluştur
  const previewHtml = generatePackageBarcodeHTML(samplePackage, template, options);
  
  $('#barcodePreview').innerHTML = `
    <div style="text-align: center;">
      <div style="margin-bottom: 1rem; color: var(--accent); font-weight: 600;">
        📦 Alt Paket Etiketi Önizlemesi
      </div>
      <div style="margin-bottom: 1rem; color: var(--muted);">
        Toplam ${packages.length} paket x ${copyCount} kopya = ${packages.length * copyCount} etiket
      </div>
      <div style="border: 1px solid var(--border); padding: 1rem; background: var(--card); display: inline-block; border-radius: 6px;">
        ${previewHtml}
      </div>
      <div style="margin-top: 0.5rem; font-size: 0.9rem; color: var(--muted);">
        Örnek: ${samplePackage.package_name || 'İsimsiz Paket'} (${samplePackage.barcode})
      </div>
    </div>
  `;
}

// Ana ürün bazında önizleme (eski sistem)
function updateProductBasedPreview(template, options) {
  const printOption = document.querySelector('input[name="printOption"]:checked').value;
  let selectedProducts = [];
  
  switch(printOption) {
    case 'selected':
      selectedProducts = getSelectedProducts();
      break;
    case 'filtered':
      selectedProducts = getFilteredProducts();
      break;
    case 'all':
      selectedProducts = products;
      break;
  }
  
  if(selectedProducts.length === 0) {
    $('#barcodePreview').innerHTML = '<div style="color: var(--muted);">Yazdırılacak ürün bulunamadı</div>';
    return;
  }
  
  const { includePrices, includeStock, includeLocation, copyCount } = options;
  
  // İlk ürünle önizleme oluştur
  const sampleProduct = selectedProducts[0];
  const previewHtml = generateBarcodeHTML(sampleProduct, template, {
    includePrices,
    includeStock,
    includeLocation,
    copyCount
  });
  
  $('#barcodePreview').innerHTML = `
    <div style="text-align: center;">
      <div style="margin-bottom: 1rem; color: var(--muted);">
        Toplam ${selectedProducts.length} ürün x ${copyCount} kopya = ${selectedProducts.length * copyCount} etiket
      </div>
      <div style="border: 1px solid var(--border); padding: 1rem; background: var(--card); display: inline-block; border-radius: 6px;">
        ${previewHtml}
      </div>
      <div style="margin-top: 0.5rem; font-size: 0.9rem; color: var(--muted);">
        Örnek: ${sampleProduct.name} (${sampleProduct.sku})
      </div>
    </div>
  `;
}

function generateBarcodeHTML(product, template, options) {
  const { includePrices, includeStock, includeLocation, copyCount = 1 } = options;
  
  let html = '';
  for(let i = 0; i < copyCount; i++) {
    switch(template) {
      case 'compact':
        html += `
          <div style="border: 1px solid #000; padding: 0.25rem; margin: 0.25rem; width: 40mm; font-size: 8pt; text-align: center;">
            <div style="font-weight: bold;">${product.sku}</div>
            <div style="font-family: 'Courier New', monospace; font-size: 6pt;">|||||||||||||||</div>
            <div style="font-size: 6pt;">${product.name.substring(0, 20)}${product.name.length > 20 ? '...' : ''}</div>
            ${includePrices ? `<div style="font-size: 6pt;">₺${product.price || '0.00'}</div>` : ''}
          </div>
        `;
        break;
        
      case 'detailed':
        html += `
          <div style="border: 1px solid #000; padding: 0.5rem; margin: 0.25rem; width: 60mm; font-size: 10pt;">
            <div style="text-align: center; font-weight: bold; margin-bottom: 0.25rem;">${product.name}</div>
            <div style="text-align: center; font-family: 'Courier New', monospace; font-size: 8pt; margin: 0.25rem 0;">|||||||||||||||</div>
            <div style="display: flex; justify-content: space-between; font-size: 8pt;">
              <span>SKU: ${product.sku}</span>
              ${includePrices ? `<span>₺${product.price || '0.00'}</span>` : ''}
            </div>
            ${includeStock ? `<div style="font-size: 8pt;">Stok: ${product.stock || 0} adet</div>` : ''}
            ${includeLocation ? `<div style="font-size: 8pt;">Konum: ${product.location || 'Tanımlı değil'}</div>` : ''}
            <div style="font-size: 6pt; text-align: right; margin-top: 0.25rem;">${new Date().toLocaleDateString('tr-TR')}</div>
          </div>
        `;
        break;
        
      default: // 'default'
        html += `
          <div style="border: 1px solid #000; padding: 0.5rem; margin: 0.25rem; width: 50mm; font-size: 10pt; text-align: center;">
            <div style="font-weight: bold; margin-bottom: 0.25rem;">${product.sku}</div>
            <div style="font-family: 'Courier New', monospace; font-size: 8pt; margin: 0.5rem 0;">|||||||||||||||</div>
            <div style="font-size: 9pt;">${product.name.substring(0, 25)}${product.name.length > 25 ? '...' : ''}</div>
            ${includePrices ? `<div style="font-size: 8pt; margin-top: 0.25rem;">₺${product.price || '0.00'}</div>` : ''}
            ${includeLocation ? `<div style="font-size: 7pt; margin-top: 0.25rem;">${product.location || ''}</div>` : ''}
          </div>
        `;
        break;
    }
  }
  
  return html;
}

// Ana yazdırma fonksiyonu
window.printBarcodes = function() {
  const template = $('#templateSelect').value;
  const copyCount = parseInt($('#copyCount').value) || 1;
  const includePrices = $('#includePrices').checked;
  const includeStock = $('#includeStock').checked;
  const includeLocation = $('#includeLocation').checked;
  
  // Önce alt paket seçimi varsa paketleri kontrol et
  const selectedPackages = getSelectedPackages();
  
  console.log('🖨️ Yazdırma başlatılıyor...');
  console.log('Seçili paket sayısı:', selectedPackages.length);
  
  if (selectedPackages.length > 0) {
    // Alt paket bazlı yazdırma
    console.log('📦 Alt paket yazdırma modu');
    printPackageBarcodes(selectedPackages, template, { includePrices, includeStock, includeLocation, copyCount });
  } else {
    // Ana ürün yazdırma (eski sistem)
    console.log('📎 Ana ürün yazdırma modu');
    const printOption = document.querySelector('input[name="printOption"]:checked').value;
    let productsToPrint = [];
    
    switch(printOption) {
      case 'selected':
        productsToPrint = getSelectedProducts();
        break;
      case 'filtered':
        productsToPrint = getFilteredProducts();
        break;
      case 'all':
        productsToPrint = products;
        break;
    }
    
    if(productsToPrint.length === 0) {
      alert('Yazdırılacak ürün bulunamadı!');
      return;
    }
    
    // Ana ürün yazdırma işlemi
    let printHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Ana Ürün Barkod Etiketleri</title>
        <style>
          body { margin: 0; padding: 1rem; font-family: Arial, sans-serif; }
          .barcode-sheet { display: flex; flex-wrap: wrap; gap: 0.25rem; }
          @media print {
            body { margin: 0; padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom: 1rem; text-align: center;">
          <h2>Ana Ürün Barkod Yazdırma Önizleme</h2>
          <p>Toplam ${productsToPrint.length} ürün x ${copyCount} kopya = ${productsToPrint.length * copyCount} etiket</p>
          <button onclick="window.print()" style="padding: 0.5rem 1rem; font-size: 1rem; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">🖨️ Yazdır</button>
          <button onclick="window.close()" style="padding: 0.5rem 1rem; font-size: 1rem; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 0.5rem;">Kapat</button>
        </div>
        <div class="barcode-sheet">
          ${productsToPrint.map(product => 
            generateBarcodeHTML(product, template, { includePrices, includeStock, includeLocation, copyCount })
          ).join('')}
        </div>
      </body>
      </html>
    `;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(printHTML);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }
}

// Alt paket için özel barkod HTML oluşturma
function generatePackageBarcodeHTML(packageItem, template, options) {
  const { includePrices, includeStock, includeLocation, copyCount = 1 } = options;
  
  let html = '';
  for(let i = 0; i < copyCount; i++) {
    switch(template) {
      case 'compact':
        html += `
          <div style="border: 1px solid #000; padding: 0.25rem; margin: 0.25rem; width: 40mm; font-size: 8pt; text-align: center;">
            <div style="font-weight: bold;">${packageItem.barcode}</div>
            <div style="font-family: 'Courier New', monospace; font-size: 6pt;">|||||||||||||||</div>
            <div style="font-size: 6pt;">${(packageItem.package_name || 'İsimsiz Paket').substring(0, 20)}</div>
            <div style="font-size: 6pt;">Adet: ${packageItem.quantity || 1}</div>
          </div>
        `;
        break;
        
      case 'detailed':
        html += `
          <div style="border: 1px solid #000; padding: 0.5rem; margin: 0.25rem; width: 60mm; font-size: 10pt;">
            <div style="text-align: center; font-weight: bold; margin-bottom: 0.25rem;">${packageItem.package_name || 'İsimsiz Paket'}</div>
            <div style="text-align: center; font-family: 'Courier New', monospace; font-size: 8pt; margin: 0.25rem 0;">${packageItem.barcode}</div>
            <div style="display: flex; justify-content: space-between; font-size: 8pt;">
              <span>Adet: ${packageItem.quantity || 1}</span>
              ${packageItem.sku ? `<span>SKU: ${packageItem.sku}</span>` : ''}
            </div>
            ${packageItem.package_content ? `<div style="font-size: 8pt;">İçerik: ${packageItem.package_content}</div>` : ''}
            ${packageItem.weight_kg ? `<div style="font-size: 8pt;">Ağırlık: ${packageItem.weight_kg}kg</div>` : ''}
            <div style="font-size: 6pt; text-align: right; margin-top: 0.25rem;">${new Date().toLocaleDateString('tr-TR')}</div>
          </div>
        `;
        break;
        
      default: // 'default'
        html += `
          <div style="border: 1px solid #000; padding: 0.5rem; margin: 0.25rem; width: 50mm; font-size: 10pt; text-align: center;">
            <div style="font-weight: bold; margin-bottom: 0.25rem;">${packageItem.barcode}</div>
            <div style="font-family: 'Courier New', monospace; font-size: 8pt; margin: 0.5rem 0;">|||||||||||||||</div>
            <div style="font-size: 9pt;">${(packageItem.package_name || 'İsimsiz Paket').substring(0, 25)}</div>
            <div style="font-size: 8pt; margin-top: 0.25rem;">Adet: ${packageItem.quantity || 1}</div>
            ${packageItem.sku ? `<div style="font-size: 7pt; margin-top: 0.25rem;">${packageItem.sku}</div>` : ''}
          </div>
        `;
        break;
    }
  }
  
  return html;
}

// Alt paket barkodlarını yazdır
function printPackageBarcodes(packages, template, options) {
  if (packages.length === 0) {
    alert('Yazdırılacak paket seçin!');
    return;
  }
  
  console.log('📦 Alt paket yazdırma başlatılıyor:', packages.length, 'paket');
  
  const { copyCount } = options;
  
  let printHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Alt Paket Barkod Etiketleri</title>
      <style>
        body { margin: 0; padding: 1rem; font-family: Arial, sans-serif; }
        .barcode-sheet { display: flex; flex-wrap: wrap; gap: 0.25rem; }
        @media print {
          body { margin: 0; padding: 0; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="no-print" style="margin-bottom: 1rem; text-align: center;">
        <h2>📦 Alt Paket Barkod Yazdırma</h2>
        <p><strong>Seçili Paketler:</strong> ${packages.length} paket x ${copyCount} kopya = ${packages.length * copyCount} etiket</p>
        <div style="margin-bottom: 1rem; padding: 1rem; background: #f8f9fa; border-radius: 6px; text-align: left; max-width: 600px; margin-left: auto; margin-right: auto;">
          <h4 style="margin-top: 0; color: #0d6efd;">Yazdırılacak Paketler:</h4>
          <ul style="margin: 0; padding-left: 1.5rem;">
            ${packages.map((pkg, index) => `
              <li><strong>${index + 1}.</strong> ${pkg.package_name || 'İsimsiz Paket'} - <code>${pkg.barcode}</code></li>
            `).join('')}
          </ul>
        </div>
        <button onclick="window.print()" style="padding: 0.75rem 1.5rem; font-size: 1rem; background: #0d6efd; color: white; border: none; border-radius: 6px; cursor: pointer; margin-right: 0.5rem;">🖨️ Yazdır</button>
        <button onclick="window.close()" style="padding: 0.75rem 1.5rem; font-size: 1rem; background: #6c757d; color: white; border: none; border-radius: 6px; cursor: pointer;">Kapat</button>
      </div>
      <div class="barcode-sheet">
  `;
  
  // Her paketi sırayla ekle
  packages.forEach((pkg, index) => {
    console.log(`🏷️ Paket ${index + 1} işleniyor:`, pkg.package_name, pkg.barcode);
    for (let copyIndex = 0; copyIndex < copyCount; copyIndex++) {
      printHTML += generatePackageBarcodeHTML(pkg, template, {...options, copyCount: 1}); // Her kopya tek tek
    }
  });
  
  printHTML += `
      </div>
    </body>
    </html>
  `;
  
  const printWindow = window.open('', '_blank');
  printWindow.document.write(printHTML);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 500); // Kısa gecikme ekle
}

window.printBarcodes = function() {
  const template = $('#templateSelect').value;
  const copyCount = parseInt($('#copyCount').value) || 1;
  const includePrices = $('#includePrices').checked;
  const includeStock = $('#includeStock').checked;
  const includeLocation = $('#includeLocation').checked;
  
  // Önce alt paket seçimi varsa paketleri kontrol et
  const selectedPackages = getSelectedPackages();
  
  console.log('🖨️ Yazdırma başlatılıyor...');
  console.log('Seçili paket sayısı:', selectedPackages.length);
  
  if (selectedPackages.length > 0) {
    // Alt paket bazlı yazdırma
    console.log('📦 Alt paket yazdırma modu');
    printPackageBarcodes(selectedPackages, template, { includePrices, includeStock, includeLocation, copyCount });
  } else {
    // Ana ürün yazdırma (eski sistem)
    console.log('📎 Ana ürün yazdırma modu');
    const printOption = document.querySelector('input[name="printOption"]:checked').value;
    let productsToPrint = [];
    
    switch(printOption) {
      case 'selected':
        productsToPrint = getSelectedProducts();
        break;
      case 'filtered':
        productsToPrint = getFilteredProducts();
        break;
      case 'all':
        productsToPrint = products;
        break;
    }
  
  if(productsToPrint.length === 0) {
    alert('Yazdırılacak ürün bulunamadı!');
    return;
  }
  
  // Yazdırma penceresi oluştur
  const printWindow = window.open('', '_blank');
  const printHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Barkod Yazdırma</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 1rem; }
        .barcode-sheet { display: flex; flex-wrap: wrap; gap: 0.25rem; }
        @media print {
          body { margin: 0; padding: 0; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="no-print" style="margin-bottom: 1rem; text-align: center;">
        <h2>Barkod Yazdırma Önizleme</h2>
        <p>Toplam ${productsToPrint.length} ürün x ${copyCount} kopya = ${productsToPrint.length * copyCount} etiket</p>
        <button onclick="window.print()" style="padding: 0.5rem 1rem; font-size: 1rem; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">🖨️ Yazdır</button>
        <button onclick="window.close()" style="padding: 0.5rem 1rem; font-size: 1rem; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 0.5rem;">Kapat</button>
      </div>
      <div class="barcode-sheet">
        ${productsToPrint.map(product => 
          generateBarcodeHTML(product, template, { includePrices, includeStock, includeLocation, copyCount })
        ).join('')}
      </div>
    </body>
    </html>
  `;
  
  printWindow.document.write(printHTML);
  printWindow.document.close();
}

window.exportBarcodesPDF = function() {
  alert('PDF export özelliği geliştirilme aşamasında...\nŞimdilik yazdırma özelliğini kullanarak PDF\'e kaydetme yapabilirsiniz.');
}

// Global window fonksiyonlarını ekle
window.toggleAllPackages = toggleAllPackages;
window.getSelectedPackages = getSelectedPackages;
window.updateSampleDataFromSelectedPackages = updateSampleDataFromSelectedPackages;

// Template Editör Fonksiyonları
window.updateTemplatePreview = function() {
  // Alt paket seçimi varsa örnek verileri güncelle
  updateSampleDataFromSelectedPackages();
  
  const width = $('#templateWidth').value;
  const height = $('#templateHeight').value;
  const fontSize = $('#fontSize').value;
  const barcodeHeight = $('#barcodeHeight').value;
  
  const showSKU = $('#showSKU')?.checked || false;
  const showName = $('#showName')?.checked || false;
  const showBarcode = $('#showBarcode')?.checked || false;
  const showPrice = $('#showPrice')?.checked || false;
  const showStock = $('#showStock')?.checked || false;
  const showLocation = $('#showLocation')?.checked || false;
  const showDate = $('#showDate')?.checked || false;
  
  const layout = document.querySelector('input[name="layout"]:checked')?.value || 'vertical';
  
  // Örnek veriler
  const sampleSKU = $('#sampleSKU')?.value || 'SAMPLE-001';
  const sampleName = $('#sampleName')?.value || 'Örnek Ürün';
  const sampleBarcode = $('#sampleBarcode')?.value || '1234567890123';
  const samplePrice = $('#samplePrice')?.value || '₺99.99';
  const sampleStock = $('#sampleStock')?.value || '25 adet';
  const sampleLocation = $('#sampleLocation')?.value || 'A1-01-359';
  
  let previewHTML = '';
  
  if(layout === 'horizontal') {
    previewHTML = `
      <div style="
        width: ${width}mm; 
        height: ${height}mm; 
        border: 1px solid #000; 
        padding: 0.25rem; 
        font-size: ${fontSize}pt;
        display: flex;
        align-items: center;
        gap: 0.25rem;
      ">
        <div style="flex: 1;">
          ${showSKU ? `<div style="font-weight: bold;">${sampleSKU}</div>` : ''}
          ${showName ? `<div style="font-size: ${fontSize-1}pt;">${sampleName}</div>` : ''}
          ${showPrice ? `<div>${samplePrice}</div>` : ''}
          ${showStock ? `<div style="font-size: ${fontSize-1}pt;">${sampleStock}</div>` : ''}
          ${showLocation ? `<div style="font-size: ${fontSize-1}pt;">${sampleLocation}</div>` : ''}
          ${showDate ? `<div style="font-size: ${fontSize-2}pt;">${new Date().toLocaleDateString('tr-TR')}</div>` : ''}
        </div>
        ${showBarcode ? `<div style="text-align: center;">
          <div style="font-family: 'Courier New', monospace; height: ${barcodeHeight}mm; line-height: ${barcodeHeight}mm; font-size: 6pt;">|||||||||||||||</div>
          <div style="font-size: 6pt;">${sampleBarcode}</div>
        </div>` : ''}
      </div>
    `;
  } else if(layout === 'compact') {
    previewHTML = `
      <div style="
        width: ${width}mm; 
        height: ${height}mm; 
        border: 1px solid #000; 
        padding: 0.125rem; 
        font-size: ${fontSize-2}pt;
        text-align: center;
        display: flex;
        flex-direction: column;
        justify-content: center;
      ">
        ${showSKU ? `<div style="font-weight: bold;">${sampleSKU}</div>` : ''}
        ${showBarcode ? `<div style="font-family: 'Courier New', monospace; height: ${Math.min(barcodeHeight, height/3)}mm; line-height: ${Math.min(barcodeHeight, height/3)}mm;">|||||||||||||||</div>` : ''}
        ${showName ? `<div>${sampleName.substring(0, 15)}${sampleName.length > 15 ? '...' : ''}</div>` : ''}
        ${showPrice ? `<div>${samplePrice}</div>` : ''}
      </div>
    `;
  } else { // vertical
    previewHTML = `
      <div style="
        width: ${width}mm; 
        height: ${height}mm; 
        border: 1px solid #000; 
        padding: 0.25rem; 
        font-size: ${fontSize}pt;
        text-align: center;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 0.125rem;
      ">
        ${showSKU ? `<div style="font-weight: bold;">${sampleSKU}</div>` : ''}
        ${showName ? `<div style="font-size: ${fontSize-1}pt;">${sampleName.length > 20 ? sampleName.substring(0, 20) + '...' : sampleName}</div>` : ''}
        ${showBarcode ? `<div>
          <div style="font-family: 'Courier New', monospace; height: ${barcodeHeight}mm; line-height: ${barcodeHeight}mm; font-size: 6pt;">|||||||||||||||</div>
          <div style="font-size: 6pt;">${sampleBarcode}</div>
        </div>` : ''}
        ${showPrice ? `<div>${samplePrice}</div>` : ''}
        ${showStock ? `<div style="font-size: ${fontSize-1}pt;">${sampleStock}</div>` : ''}
        ${showLocation ? `<div style="font-size: ${fontSize-1}pt;">${sampleLocation}</div>` : ''}
        ${showDate ? `<div style="font-size: ${fontSize-2}pt;">${new Date().toLocaleDateString('tr-TR')}</div>` : ''}
      </div>
    `;
  }
  
  const previewContainer = $('#templatePreview');
  if(previewContainer) {
    previewContainer.innerHTML = previewHTML;
  }
}

window.saveTemplate = function() {
  const templateData = {
    width: $('#templateWidth')?.value || '50',
    height: $('#templateHeight')?.value || '30',
    droppedElements: droppedElements || [],
    sampleData: {
      packageSKU: $('#samplePackageSKU')?.value || 'PK-SAMPLE-001',
      packageName: $('#samplePackageName')?.value || 'Örnek Paket',
      packageBarcode: $('#samplePackageBarcode')?.value || '1234567890123',
      mainProduct: $('#sampleMainProduct')?.value || 'Örnek Ana Ürün',
      packageQuantity: $('#samplePackageQuantity')?.value || '5 adet',
      packageContent: $('#samplePackageContent')?.value || 'Standart paket',
      packageDimensions: $('#samplePackageDimensions')?.value || '50x30x20cm',
      packageWeight: $('#samplePackageWeight')?.value || '2.5kg',
      shelfLocation: $('#sampleShelfLocation')?.value || 'A1-01-359'
    }
  };
  
  const templateName = prompt('Template adı:', 'Özel Template ' + new Date().toLocaleDateString('tr-TR'));
  if(templateName) {
    localStorage.setItem('barcodeTemplate_' + templateName, JSON.stringify(templateData));
    alert('Template kaydedildi: ' + templateName);
    
    // Template select'e ekle
    const option = document.createElement('option');
    option.value = 'custom_' + templateName;
    option.textContent = templateName;
    $('#templateSelect').appendChild(option);
  }
}

window.loadTemplate = function() {
  const keys = Object.keys(localStorage).filter(key => key.startsWith('barcodeTemplate_'));
  if(keys.length === 0) {
    alert('Kayıtlı template bulunamadı!');
    return;
  }
  
  const templateNames = keys.map(key => key.replace('barcodeTemplate_', ''));
  const selectedTemplate = prompt('Yüklenecek template:\n' + templateNames.map((name, i) => `${i+1}. ${name}`).join('\n') + '\n\nTemplate numarasını girin:');
  
  const templateIndex = parseInt(selectedTemplate) - 1;
  if(templateIndex >= 0 && templateIndex < templateNames.length) {
    const templateName = templateNames[templateIndex];
    const templateData = JSON.parse(localStorage.getItem('barcodeTemplate_' + templateName));
    
    // Template boyutlarını doldur
    if($('#templateWidth')) $('#templateWidth').value = templateData.width || '50';
    if($('#templateHeight')) $('#templateHeight').value = templateData.height || '30';
    
    // Dropped elementleri yükle
    if(templateData.droppedElements) {
      // Önce mevcut elementleri temizle
      droppedElements = [];
      document.querySelectorAll('.dropped-element').forEach(el => el.remove());
      
      // Yeni elementleri yükle
      templateData.droppedElements.forEach(element => {
        droppedElements.push(element);
        createDroppedElement(element);
      });
    }
    
    // Sample verileri yükle
    if(templateData.sampleData) {
      const data = templateData.sampleData;
      if($('#samplePackageSKU')) $('#samplePackageSKU').value = data.packageSKU || '';
      if($('#samplePackageName')) $('#samplePackageName').value = data.packageName || '';
      if($('#samplePackageBarcode')) $('#samplePackageBarcode').value = data.packageBarcode || '';
      if($('#sampleMainProduct')) $('#sampleMainProduct').value = data.mainProduct || '';
      if($('#samplePackageQuantity')) $('#samplePackageQuantity').value = data.packageQuantity || '';
      if($('#samplePackageContent')) $('#samplePackageContent').value = data.packageContent || '';
      if($('#samplePackageDimensions')) $('#samplePackageDimensions').value = data.packageDimensions || '';
      if($('#samplePackageWeight')) $('#samplePackageWeight').value = data.packageWeight || '';
      if($('#sampleShelfLocation')) $('#sampleShelfLocation').value = data.shelfLocation || '';
    }
    
    // Önizlemeyi güncelle
    if(window.updateTemplatePreview) {
      updateTemplatePreview();
    }
    
    alert('Template yüklendi: ' + templateName);
  }
}

window.resetTemplate = function() {
  // Template boyutlarını sıfırla
  if($('#templateWidth')) $('#templateWidth').value = '50';
  if($('#templateHeight')) $('#templateHeight').value = '30';
  
  // Dropped elementleri temizle
  droppedElements = [];
  document.querySelectorAll('.dropped-element').forEach(el => el.remove());
  
  // Sample verileri sıfırla
  if($('#samplePackageSKU')) $('#samplePackageSKU').value = 'PK-SAMPLE-001';
  if($('#samplePackageName')) $('#samplePackageName').value = 'Örnek Paket';
  if($('#samplePackageBarcode')) $('#samplePackageBarcode').value = '1234567890123';
  if($('#sampleMainProduct')) $('#sampleMainProduct').value = 'Örnek Ana Ürün';
  if($('#samplePackageQuantity')) $('#samplePackageQuantity').value = '5 adet';
  if($('#samplePackageContent')) $('#samplePackageContent').value = 'Standart paket';
  if($('#samplePackageDimensions')) $('#samplePackageDimensions').value = '50x30x20cm';
  if($('#samplePackageWeight')) $('#samplePackageWeight').value = '2.5kg';
  if($('#sampleShelfLocation')) $('#sampleShelfLocation').value = 'A1-01-359';
  
  // Yüklenen resimleri temizle
  const imageContainer = document.getElementById('uploadedImages');
  if(imageContainer) imageContainer.innerHTML = '';
  const imageElement = document.querySelector('.image-element');
  if(imageElement) {
    imageElement.style.display = 'none';
    imageElement.removeAttribute('data-image-data');
    imageElement.textContent = '🖼️ Özel Resim';
  }
  
  // Önizlemeyi güncelle
  if(window.updateTemplatePreview) {
    updateTemplatePreview();
  }
  
  alert('Template sıfırlandı!');
}

// Modal dışına tıklandığında kapat
window.onclick = function(event) {
  const modal = $('#barcodeActionsModal');
  if (event.target === modal) {
    closeBarcodeActionsModal();
  }
}

// Form change event listeners
document.addEventListener('change', function(e) {
  if(e.target.matches('#templateSelect, #copyCount, #includePrices, #includeStock, #includeLocation, input[name="printOption"]')) {
    updateBarcodePreview();
  }
});

let currentFilteredProducts = null; // Global değişken
