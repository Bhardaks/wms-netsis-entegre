// Products Packages - Package Management Module
(function() {
    'use strict';

    // API endpoints
    const API = {
        PACKAGES: '/api/packages',
        PRODUCT_PACKAGES: '/api/product-packages',
        PK_SEARCH: '/api/packages/search-pk-products'
    };

    // View packages for a product
    window.viewPackages = async function(productId) {
        try {
            const product = window.products.find(p => p.id === productId);
            if (!product) {
                showMessage('Ürün bulunamadı', 'error');
                return;
            }

            await openPackageModal(product);
        } catch (error) {
            console.error('❌ View packages error:', error);
            showMessage('Paketler yüklenirken hata oluştu: ' + error.message, 'error');
        }
    };

    // Global variables for current context
    let currentProduct = null;
    let currentPackages = [];

    // Open package management modal
    async function openPackageModal(product) {
        const modal = document.getElementById('packageModal');
        const title = document.getElementById('packageModalTitle');
        const content = document.getElementById('packageModalContent');
        
        if (!modal || !content) return;

        // Store current product
        currentProduct = product;

        // Set title
        if (title) {
            title.textContent = `${product.name} - Paket Yönetimi`;
        }

        // Show modal
        modal.style.display = 'flex';
        
        // Show loading
        content.innerHTML = '<div class="loading-message">Paketler yükleniyor...</div>';

        try {
            // Load packages and store them
            currentPackages = await loadProductPackages(product.id);
            renderPackageModal(product, currentPackages);
        } catch (error) {
            content.innerHTML = `
                <div class="error-state">
                    <p>Paketler yüklenirken hata oluştu:</p>
                    <p class="error-message">${error.message}</p>
                    <button onclick="closePackageModal()" class="btn btn-secondary">Kapat</button>
                </div>
            `;
        }
    }

    // Close package modal
    window.closePackageModal = function() {
        const modal = document.getElementById('packageModal');
        if (modal) {
            modal.style.display = 'none';
        }
    };

    // Load packages for a product
    async function loadProductPackages(productId) {
        try {
            const response = await fetch(`/api/products/${productId}/packages`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            return Array.isArray(result) ? result : (result.data || []);
        } catch (error) {
            console.error('❌ Load packages error:', error);
            throw error;
        }
    }

    // Render package modal content
    function renderPackageModal(product, packages) {
        const content = document.getElementById('packageModalContent');
        if (!content) return;

        const html = `
            <div class="package-modal-wrapper">
                <!-- Header Section -->
                <div class="modal-header-section">
                    <div class="product-info-card">
                        <div class="product-details">
                            <h3 class="product-title">${escapeHtml(product.name)}</h3>
                            <div class="product-meta">
                                <span class="product-sku">SKU: <strong>${escapeHtml(product.sku)}</strong></span>
                                ${product.main_barcode ? `<span class="product-barcode">Barkod: <strong>${escapeHtml(product.main_barcode)}</strong></span>` : ''}
                            </div>
                        </div>
                        <div class="package-stats">
                            <div class="stat-item">
                                <span class="stat-number">${packages.length}</span>
                                <span class="stat-label">Paket</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Action Buttons -->
                <div class="action-section">
                    <button onclick="openAddPackageForm(${product.id})" class="btn btn-primary btn-large">
                        <i class="icon">📦</i>
                        <span>Yeni Paket Ekle</span>
                    </button>
                    <button onclick="searchPkProducts()" class="btn btn-secondary btn-large">
                        <i class="icon">🔍</i>
                        <span>PK Ürün Ara</span>
                    </button>
                </div>

                <!-- Dynamic Content Area -->
                <div class="content-area">
                    <!-- Add Package Form (Initially Hidden) -->
                    <div id="addPackageForm" class="content-panel add-package-panel" style="display: none;">
                        ${renderAddPackageForm(product.id)}
                    </div>

                    <!-- PK Search Results (Initially Hidden) -->
                    <div id="pkSearchResults" class="content-panel pk-search-panel" style="display: none;">
                        <!-- PK search results will be loaded here -->
                    </div>

                    <!-- Existing Packages -->
                    <div id="packagesPanel" class="content-panel packages-panel active">
                        <div class="panel-header">
                            <h4>Mevcut Paketler</h4>
                            <span class="package-count">${packages.length} paket</span>
                        </div>
                        <div class="panel-content">
                            ${packages.length > 0 ? renderPackagesList(packages) : renderNoPackages()}
                        </div>
                    </div>
                </div>
            </div>
        `;

        content.innerHTML = html;
    }

    // Render add package form
    function renderAddPackageForm(productId) {
        return `
            <div class="add-package-container">
                <div class="panel-header">
                    <h4>Yeni Paket Oluştur</h4>
                    <button type="button" onclick="closeAddPackageForm()" class="btn-close">✕</button>
                </div>
                
                <form id="packageForm" data-product-id="${productId}" class="package-form">
                    <!-- Basic Information Section -->
                    <div class="form-section">
                        <h5 class="section-title">Temel Bilgiler</h5>
                        <div class="form-grid">
                            <div class="form-group">
                                <label for="pkgNumber" class="form-label">Paket Numarası *</label>
                                <input type="text" id="pkgNumber" class="form-input" placeholder="PK-CC-BE-S-GR5-1" required>
                                <small class="form-hint">Benzersiz paket tanımlama numarası</small>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Language Information Section -->
                    <div class="form-section">
                        <h5 class="section-title">Dil Bilgileri</h5>
                        <div class="language-tabs">
                            <div class="tab-headers">
                                <button type="button" class="tab-header active" data-tab="turkish" onclick="switchLanguageTab('turkish')">
                                    🇹🇷 Türkçe
                                </button>
                                <button type="button" class="tab-header" data-tab="english" onclick="switchLanguageTab('english')">
                                    🇬🇧 English
                                </button>
                            </div>
                            
                            <!-- Turkish Tab -->
                            <div id="turkish-tab" class="tab-content active">
                                <div class="form-grid">
                                    <div class="form-group">
                                        <label for="pkgProductName" class="form-label">Ürün Adı *</label>
                                        <input type="text" id="pkgProductName" class="form-input" required placeholder="Örnek: CC Gardrop">
                                    </div>
                                    <div class="form-group">
                                        <label for="pkgName" class="form-label">Paket Adı *</label>
                                        <input type="text" id="pkgName" class="form-input" required placeholder="Örnek: Paket 1">
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label for="pkgColor" class="form-label">Ürün Rengi</label>
                                    <input type="text" id="pkgColor" class="form-input" placeholder="Beyaz, Siyah, Gri...">
                                </div>
                                <div class="form-group">
                                    <label for="pkgContents" class="form-label">Paket İçeriği</label>
                                    <textarea id="pkgContents" class="form-input" rows="3" placeholder="Bu pakette bulunan parçalar..."></textarea>
                                </div>
                            </div>
                            
                            <!-- English Tab -->
                            <div id="english-tab" class="tab-content">
                                <div class="form-grid">
                                    <div class="form-group">
                                        <label for="pkgProductNameEn" class="form-label">Product Name</label>
                                        <input type="text" id="pkgProductNameEn" class="form-input" placeholder="Example: CC Wardrobe">
                                    </div>
                                    <div class="form-group">
                                        <label for="pkgNameEn" class="form-label">Package Name</label>
                                        <input type="text" id="pkgNameEn" class="form-input" placeholder="Example: Package 1">
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label for="pkgColorEn" class="form-label">Product Color</label>
                                    <input type="text" id="pkgColorEn" class="form-input" placeholder="White, Black, Gray...">
                                </div>
                                <div class="form-group">
                                    <label for="pkgContentsEn" class="form-label">Package Contents</label>
                                    <textarea id="pkgContentsEn" class="form-input" rows="3" placeholder="Parts included in this package..."></textarea>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Barcode & Quantity Section -->
                    <div class="form-section">
                        <h5 class="section-title">Barkod ve Miktar</h5>
                        <div class="form-grid">
                            <div class="form-group barcode-group">
                                <label for="pkgBarcode" class="form-label">Barkod *</label>
                                <div class="barcode-input-group">
                                    <div class="barcode-options">
                                        <label class="radio-option">
                                            <input type="radio" name="barcodeType" value="manual" checked onchange="toggleBarcodeInput()">
                                            <span>Manuel Giriş</span>
                                        </label>
                                        <label class="radio-option">
                                            <input type="radio" name="barcodeType" value="auto" onchange="toggleBarcodeInput()">
                                            <span>Otomatik Oluştur (Code128)</span>
                                        </label>
                                    </div>
                                    <div class="barcode-input-wrapper">
                                        <input type="text" id="pkgBarcode" class="form-input" required placeholder="Barkod numarasını girin">
                                        <button type="button" id="generateBarcodeBtn" class="btn btn-secondary btn-sm" style="display: none;" onclick="generateBarcode()">🎲 Oluştur</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Physical Properties Section -->
                    <div class="form-section">
                        <h5 class="section-title">Fiziksel Özellikler</h5>
                        <div class="form-grid grid-cols-4">
                            <div class="form-group">
                                <label for="pkgLength" class="form-label">Uzunluk (cm)</label>
                                <input type="number" id="pkgLength" class="form-input" min="0" step="0.1" onchange="calculateVolume()">
                            </div>
                            <div class="form-group">
                                <label for="pkgWidth" class="form-label">Genişlik (cm)</label>
                                <input type="number" id="pkgWidth" class="form-input" min="0" step="0.1" onchange="calculateVolume()">
                            </div>
                            <div class="form-group">
                                <label for="pkgHeight" class="form-label">Yükseklik (cm)</label>
                                <input type="number" id="pkgHeight" class="form-input" min="0" step="0.1" onchange="calculateVolume()">
                            </div>
                        </div>
                        <div class="form-grid grid-cols-2">
                            <div class="form-group">
                                <label for="pkgWeight" class="form-label">Ağırlık (kg)</label>
                                <input type="number" id="pkgWeight" class="form-input" min="0" step="0.01">
                            </div>
                            <div class="form-group">
                                <label for="pkgVolume" class="form-label">Hacim (m³)</label>
                                <input type="number" id="pkgVolume" class="form-input" readonly step="0.001">
                                <small class="form-hint">Otomatik hesaplanır</small>
                            </div>
                        </div>
                    </div>

                    <!-- Form Actions -->
                    <div class="form-actions">
                        <button type="button" onclick="closeAddPackageForm()" class="btn btn-secondary btn-large">
                            <i class="icon">✕</i>
                            <span>İptal</span>
                        </button>
                        <button type="button" onclick="savePackage()" class="btn btn-primary btn-large">
                            <i class="icon">💾</i>
                            <span>Paketi Kaydet</span>
                        </button>
                    </div>
                </form>
            </div>
        `;
    }

    // Render packages list
    function renderPackagesList(packages) {
        return `
            <div class="packages-list">
                ${packages.map(pkg => renderPackageCard(pkg)).join('')}
            </div>
        `;
    }

    // Render single package card
    function renderPackageCard(pkg) {
        const dimensions = getDimensionsText(pkg);
        const weight = pkg.weight_kg ? `${pkg.weight_kg} kg` : '';
        const volume = pkg.volume_m3 ? `${pkg.volume_m3} m³` : '';

        return `
            <div class="package-card" data-package-id="${pkg.id}">
                <div class="package-header">
                    <div class="package-title">
                        <h6>${escapeHtml(pkg.package_name || 'İsimsiz Paket')}</h6>
                        <code class="package-number">${escapeHtml(pkg.package_number || '')}</code>
                        ${pkg.barcode ? `<code class="package-barcode">🏷️ ${escapeHtml(pkg.barcode)}</code>` : ''}
                    </div>
                    <div class="package-actions">
                        <button onclick="editPackage(${pkg.id})" class="btn btn-sm btn-outline" title="Düzenle">✏️</button>
                        <button onclick="deletePackage(${pkg.id})" class="btn btn-sm btn-danger" title="Sil">🗑️</button>
                    </div>
                </div>
                
                <div class="package-details">
                    <div class="package-info">
                        <span class="info-label">Adet:</span>
                        <span class="info-value">${pkg.quantity || 1}</span>
                    </div>
                    ${weight ? `
                        <div class="package-info">
                            <span class="info-label">Ağırlık:</span>
                            <span class="info-value">${weight}</span>
                        </div>
                    ` : ''}
                    ${dimensions ? `
                        <div class="package-info">
                            <span class="info-label">Boyutlar:</span>
                            <span class="info-value">${dimensions}</span>
                        </div>
                    ` : ''}
                    ${volume ? `
                        <div class="package-info">
                            <span class="info-label">Hacim:</span>
                            <span class="info-value">${volume}</span>
                        </div>
                    ` : ''}
                    ${pkg.contents ? `
                        <div class="package-info contents">
                            <span class="info-label">İçerik:</span>
                            <span class="info-value">${escapeHtml(pkg.contents)}</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    // Render no packages state
    function renderNoPackages() {
        return `
            <div class="empty-state">
                <p>Bu ürün için henüz paket tanımlanmamış.</p>
                <button onclick="openAddPackageForm()" class="btn btn-primary">İlk Paketi Ekle</button>
            </div>
        `;
    }

    // Open add package form
    window.openAddPackageForm = function(productId) {
        console.log('🔄 Opening add package form for product:', productId);
        
        // Hide all panels
        document.querySelectorAll('.content-panel').forEach(panel => {
            console.log('Hiding panel:', panel.id);
            panel.classList.remove('active');
            panel.style.display = 'none';
        });
        
        // Show add package form
        const form = document.getElementById('addPackageForm');
        if (form) {
            console.log('✅ Found form, making it active');
            form.classList.add('active');
            form.style.display = 'block';
            clearPackageForm();
            // Focus first input
            setTimeout(() => {
                document.getElementById('pkgNumber')?.focus();
            }, 100);
        } else {
            console.error('❌ Add package form not found');
        }
    };

    // Close add package form
    window.closeAddPackageForm = function() {
        // Hide add package form
        const form = document.getElementById('addPackageForm');
        if (form) {
            form.classList.remove('active');
            form.style.display = 'none';
        }
        
        // Show packages panel
        const packagesPanel = document.getElementById('packagesPanel');
        if (packagesPanel) {
            packagesPanel.classList.add('active');
            packagesPanel.style.display = 'block';
        }
        
        clearPackageForm();
        resetFormToAddMode();
    };

    // Reset form to add mode (not edit mode)
    function resetFormToAddMode() {
        const form = document.getElementById('packageForm');
        if (form) {
            form.removeAttribute('data-package-id');
        }
        
        // Reset save button
        const saveBtn = document.querySelector('[onclick="updatePackage()"], [onclick="savePackage()"]');
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="icon">💾</i><span>Paketi Kaydet</span>';
            saveBtn.setAttribute('onclick', 'savePackage()');
        }
    }

    // Save package
    window.savePackage = async function() {
        try {
            const formData = getPackageFormData();
            
            if (!validatePackageForm(formData)) {
                return;
            }

            const response = await fetch(`/api/products/${formData.product_id}/packages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Paket kaydedilemedi');
            }

            showMessage('Paket başarıyla eklendi', 'success');
            closeAddPackageForm();
            
            // Reload packages and update current packages list
            if (currentProduct) {
                currentPackages = await loadProductPackages(currentProduct.id);
                renderPackageModal(currentProduct, currentPackages);
            }
            
        } catch (error) {
            console.error('❌ Save package error:', error);
            showMessage('Paket kaydedilirken hata oluştu: ' + error.message, 'error');
        }
    };

    // Delete package
    window.deletePackage = async function(packageId) {
        if (!confirm('Bu paketi silmek istediğinizden emin misiniz?')) {
            return;
        }

        try {
            const response = await fetch(`${API.PACKAGES}/${packageId}`, {
                method: 'DELETE'
            });

            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Paket silinemedi');
            }

            showMessage('Paket başarıyla silindi', 'success');
            
            // Find product and reload packages
            const packageCard = document.querySelector(`[data-package-id="${packageId}"]`);
            if (packageCard) {
                packageCard.remove();
            }
            
        } catch (error) {
            console.error('❌ Delete package error:', error);
            showMessage('Paket silinirken hata oluştu: ' + error.message, 'error');
        }
    };

    // Edit package
    window.editPackage = async function(packageId) {
        try {
            console.log('🔧 Edit package:', packageId);
            
            // Get package data from current packages list
            const packageData = currentPackages.find(pkg => pkg.id == packageId);
            
            if (!packageData) {
                throw new Error('Paket verisi bulunamadı');
            }
            
            console.log('📦 Full package data:', packageData);
            
            // Open add package form first
            openAddPackageForm(currentProduct.id);
            
            // Wait for form to be ready and populate with existing data
            setTimeout(() => {
                populateEditForm(packageData);
            }, 200);
            
        } catch (error) {
            console.error('❌ Edit package error:', error);
            showMessage('Paket düzenlenirken hata oluştu: ' + error.message, 'error');
        }
    };

    // Populate form with existing package data for editing
    function populateEditForm(packageData) {
        // Store package ID for update
        const form = document.getElementById('packageForm');
        if (form) {
            form.setAttribute('data-package-id', packageData.id);
        }
        
        // Fill form fields
        document.getElementById('pkgNumber').value = packageData.package_number || '';
        document.getElementById('pkgProductName').value = packageData.product_name || '';
        document.getElementById('pkgProductNameEn').value = packageData.product_name_en || '';
        document.getElementById('pkgName').value = packageData.package_name || '';
        document.getElementById('pkgNameEn').value = packageData.package_name_en || '';
        document.getElementById('pkgColor').value = packageData.color || '';
        document.getElementById('pkgColorEn').value = packageData.color_en || '';
        document.getElementById('pkgBarcode').value = packageData.barcode || '';
        document.getElementById('pkgContents').value = packageData.contents || '';
        document.getElementById('pkgContentsEn').value = packageData.contents_en || '';
        
        // Physical properties
        document.getElementById('pkgWeight').value = packageData.weight_kg || '';
        document.getElementById('pkgLength').value = packageData.length_cm || packageData.length || '';
        document.getElementById('pkgWidth').value = packageData.width_cm || packageData.width || '';
        document.getElementById('pkgHeight').value = packageData.height_cm || packageData.height || '';
        document.getElementById('pkgVolume').value = packageData.volume_m3 || '';
        
        // Update save button to show "Update" instead of "Save"
        const saveBtn = document.querySelector('[onclick="savePackage()"]');
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="icon">💾</i><span>Paketi Güncelle</span>';
            saveBtn.setAttribute('onclick', 'updatePackage()');
        }
        
        console.log('✅ Form populated with existing data');
        showMessage('Paket düzenleme modu aktif', 'info');
    }

    // Update existing package
    window.updatePackage = async function() {
        try {
            const form = document.getElementById('packageForm');
            const packageId = form?.getAttribute('data-package-id');
            
            if (!packageId) {
                throw new Error('Paket ID bulunamadı');
            }
            
            const formData = getPackageFormData();
            
            if (!validatePackageForm(formData)) {
                return;
            }

            const response = await fetch(`${API.PACKAGES}/${packageId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Paket güncellenemedi');
            }

            showMessage('Paket başarıyla güncellendi', 'success');
            closeAddPackageForm();
            
            // Reload packages and update current packages list
            if (currentProduct) {
                currentPackages = await loadProductPackages(currentProduct.id);
                renderPackageModal(currentProduct, currentPackages);
            }
            
        } catch (error) {
            console.error('❌ Update package error:', error);
            showMessage('Paket güncellenirken hata oluştu: ' + error.message, 'error');
        }
    };

    // Calculate volume automatically
    window.calculateVolume = function() {
        const length = parseFloat(document.getElementById('pkgLength')?.value) || 0;
        const width = parseFloat(document.getElementById('pkgWidth')?.value) || 0;
        const height = parseFloat(document.getElementById('pkgHeight')?.value) || 0;
        
        // Calculate m³ (cm³ to m³ conversion: divide by 1,000,000)
        const volume = (length * width * height) / 1000000;
        const volumeField = document.getElementById('pkgVolume');
        
        if (volumeField) {
            volumeField.value = volume > 0 ? volume.toFixed(6) : '';
        }
    };

    // Search PK products
    window.searchPkProducts = async function() {
        // Hide all panels
        document.querySelectorAll('.content-panel').forEach(panel => {
            panel.classList.remove('active');
            panel.style.display = 'none';
        });
        
        // Show PK search results panel
        const resultsDiv = document.getElementById('pkSearchResults');
        if (!resultsDiv) return;

        resultsDiv.classList.add('active');
        resultsDiv.style.display = 'block';
        resultsDiv.innerHTML = `
            <div class="pk-search-section">
                <h5>PK Ürün Arama</h5>
                <div class="search-form">
                    <input type="text" id="pkSearchInput" placeholder="Ürün adı veya SKU ile ara..." class="form-input">
                    <button onclick="performPkSearch()" class="btn btn-primary">Ara</button>
                </div>
                <div id="pkSearchResultsList" class="search-results">
                    <!-- Results will appear here -->
                </div>
            </div>
        `;

        // Focus search input
        setTimeout(() => {
            document.getElementById('pkSearchInput')?.focus();
        }, 100);
    };

    // Perform PK search
    window.performPkSearch = async function() {
        const query = document.getElementById('pkSearchInput')?.value?.trim();
        if (!query) return;

        const resultsList = document.getElementById('pkSearchResultsList');
        if (!resultsList) return;

        try {
            resultsList.innerHTML = '<div class="loading-message">Aranıyor...</div>';

            console.log('🔍 PK Search Request:', `${API.PK_SEARCH}?q=${encodeURIComponent(query)}`);
            console.log('🔍 API.PK_SEARCH value:', API.PK_SEARCH);

            const response = await fetch(`${API.PK_SEARCH}?q=${encodeURIComponent(query)}`, {
                method: 'GET',
                credentials: 'include', // Include cookies for authentication
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const result = await response.json();

            console.log('🔍 PK Search Response:', {
                status: response.status,
                ok: response.ok,
                result: result
            });

            // Handle authentication errors
            if (response.status === 401 || response.status === 403) {
                resultsList.innerHTML = '<div class="error-state">🔒 Oturum süresi dolmuş. Sayfayı yenileyin.</div>';
                return;
            }

            if (!response.ok) {
                throw new Error(result.error || result.message || 'Arama başarısız');
            }

            if (!result.success) {
                throw new Error(result.error || result.message || 'Arama başarısız');
            }

            if (!result.packages || result.packages.length === 0) {
                console.log('⚠️ No packages found or empty result');
                resultsList.innerHTML = '<div class="empty-state">Sonuç bulunamadı</div>';
                return;
            }

            console.log('✅ Found packages:', result.packages.length);
            renderPkSearchResults(result.packages);

        } catch (error) {
            console.error('❌ PK search error:', error);
            if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                resultsList.innerHTML = `<div class="error-state">🌐 Bağlantı hatası. Sunucu çalışmıyor olabilir.</div>`;
            } else {
                resultsList.innerHTML = `<div class="error-state">Arama hatası: ${error.message}</div>`;
            }
        }
    };

    // Render PK search results
    function renderPkSearchResults(results) {
        const resultsList = document.getElementById('pkSearchResultsList');
        if (!resultsList) return;

        const html = results.map(item => `
            <div class="search-result-item">
                <div class="result-info">
                    <div class="result-name">${escapeHtml(item.name || 'İsimsiz')}</div>
                    <div class="result-sku">SKU: <code>${escapeHtml(item.sku || '')}</code></div>
                </div>
                <button onclick="addPkPackage('${item.sku}', '${escapeHtml(item.name)}')" class="btn btn-sm btn-primary">
                    + Paketi Ekle
                </button>
            </div>
        `).join('');

        resultsList.innerHTML = html;
    }

    // Add PK package
    window.addPkPackage = async function(packageSku, packageName) {
        try {
            // Get current modal context to find product ID
            const modalContent = document.getElementById('packageModalContent');
            const productId = modalContent?.closest('[data-product-id]')?.dataset?.productId || 
                             modalContent?.querySelector('[data-product-id]')?.dataset?.productId;
            
            if (!productId) {
                // Try to extract from package form if it exists
                const existingForm = document.getElementById('packageForm');
                const formProductId = existingForm?.dataset?.productId;
                if (formProductId) {
                    // Show add package form first
                    openAddPackageForm(formProductId);
                    
                    // Then fill with PK data
                    setTimeout(() => {
                        const nameField = document.getElementById('pkgName');
                        const numberField = document.getElementById('pkgNumber');
                        
                        if (numberField) numberField.value = packageSku;
                        if (nameField) nameField.value = packageName;
                        
                        showMessage('PK ürün bilgileri forma aktarıldı', 'success');
                    }, 100);
                    
                    return;
                }
                throw new Error('Ürün ID bulunamadı');
            }

            // Show add package form first
            openAddPackageForm(productId);
            
            // Then fill form with PK data
            setTimeout(() => {
                const nameField = document.getElementById('pkgName');
                const numberField = document.getElementById('pkgNumber');
                
                if (numberField) numberField.value = packageSku;
                if (nameField) nameField.value = packageName;
                
                showMessage('PK ürün bilgileri forma aktarıldı', 'success');
            }, 100);

        } catch (error) {
            console.error('❌ Add PK package error:', error);
            showMessage('PK paket ekleme hatası: ' + error.message, 'error');
        }
    };

    // Helper functions
    function getPackageFormData() {
        const form = document.getElementById('packageForm');
        const productId = form?.dataset?.productId;
        
        return {
            product_id: parseInt(productId),
            package_number: document.getElementById('pkgNumber')?.value?.trim() || '',
            product_name: document.getElementById('pkgProductName')?.value?.trim() || '',
            product_name_en: document.getElementById('pkgProductNameEn')?.value?.trim() || '',
            package_name: document.getElementById('pkgName')?.value?.trim() || '',
            package_name_en: document.getElementById('pkgNameEn')?.value?.trim() || '',
            color: document.getElementById('pkgColor')?.value?.trim() || '',
            color_en: document.getElementById('pkgColorEn')?.value?.trim() || '',
            barcode: document.getElementById('pkgBarcode')?.value?.trim() || '',
            weight_kg: parseFloat(document.getElementById('pkgWeight')?.value) || null,
            length_cm: parseFloat(document.getElementById('pkgLength')?.value) || null,
            width_cm: parseFloat(document.getElementById('pkgWidth')?.value) || null,
            height_cm: parseFloat(document.getElementById('pkgHeight')?.value) || null,
            volume_m3: parseFloat(document.getElementById('pkgVolume')?.value) || null,
            contents: document.getElementById('pkgContents')?.value?.trim() || '',
            contents_en: document.getElementById('pkgContentsEn')?.value?.trim() || ''
        };
    }

    function validatePackageForm(data) {
        if (!data.package_number) {
            showMessage('Paket numarası zorunludur', 'error');
            return false;
        }
        if (!data.product_name) {
            showMessage('Ürün adı (Türkçe) zorunludur', 'error');
            return false;
        }
        if (!data.package_name) {
            showMessage('Paket adı zorunludur', 'error');
            return false;
        }
        if (!data.barcode) {
            showMessage('Barkod zorunludur', 'error');
            return false;
        }
        if (!data.product_id) {
            showMessage('Ürün ID bulunamadı', 'error');
            return false;
        }
        return true;
    }

    function clearPackageForm() {
        const form = document.getElementById('packageForm');
        if (form) {
            form.reset();
            
            // Reset barcode input mode
            const manualRadio = document.querySelector('input[name="barcodeType"][value="manual"]');
            if (manualRadio) {
                manualRadio.checked = true;
                toggleBarcodeInput();
            }
            
            // Reset to Turkish tab
            switchLanguageTab('turkish');
        }
    }

    function getDimensionsText(pkg) {
        const dims = [];
        if (pkg.length) dims.push(`${pkg.length}cm`);
        if (pkg.width) dims.push(`${pkg.width}cm`);
        if (pkg.height) dims.push(`${pkg.height}cm`);
        return dims.length > 0 ? dims.join(' × ') : '';
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Toggle barcode input mode
    window.toggleBarcodeInput = function() {
        const barcodeType = document.querySelector('input[name="barcodeType"]:checked')?.value;
        const barcodeInput = document.getElementById('pkgBarcode');
        const generateBtn = document.getElementById('generateBarcodeBtn');
        
        if (barcodeType === 'auto') {
            barcodeInput.placeholder = 'Otomatik oluşturulacak';
            barcodeInput.readOnly = true;
            barcodeInput.value = '';
            generateBtn.style.display = 'inline-block';
        } else {
            barcodeInput.placeholder = 'Barkod numarasını girin';
            barcodeInput.readOnly = false;
            generateBtn.style.display = 'none';
        }
    };

    // Generate Code128 barcode
    window.generateBarcode = function() {
        const packageNumber = document.getElementById('pkgNumber')?.value?.trim();
        if (!packageNumber) {
            showMessage('Önce paket numarasını girin', 'error');
            return;
        }
        
        // Generate Code128 compatible barcode
        // Format: Package number + timestamp for uniqueness
        const timestamp = Date.now().toString().slice(-6); // Last 6 digits
        const barcode = packageNumber.replace(/[^A-Z0-9-]/g, '') + timestamp;
        
        document.getElementById('pkgBarcode').value = barcode;
        showMessage('Barkod otomatik oluşturuldu: ' + barcode, 'success');
    };

    // Switch language tabs
    window.switchLanguageTab = function(tabName) {
        // Remove active class from all tabs and headers
        document.querySelectorAll('.tab-header').forEach(header => {
            header.classList.remove('active');
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        
        // Add active class to selected tab and header
        const selectedHeader = document.querySelector(`[data-tab="${tabName}"]`);
        const selectedTab = document.getElementById(`${tabName}-tab`);
        
        if (selectedHeader) selectedHeader.classList.add('active');
        if (selectedTab) selectedTab.classList.add('active');
    };

    console.log('✅ Products Packages module loaded');
})();