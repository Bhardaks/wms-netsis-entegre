// Products Barcode - Barcode Generation and Management
(function() {
    'use strict';

    // Barcode templates
    const BARCODE_TEMPLATES = {
        simple: {
            name: 'Basit Etiket',
            width: '4cm',
            height: '2cm',
            showName: true,
            showPrice: false,
            showSku: true,
            fontSize: '8pt'
        },
        detailed: {
            name: 'Detaylı Etiket',
            width: '6cm',
            height: '3cm',
            showName: true,
            showPrice: true,
            showSku: true,
            showDescription: true,
            fontSize: '9pt'
        },
        price: {
            name: 'Fiyat Etiketi',
            width: '5cm',
            height: '4cm',
            showName: true,
            showPrice: true,
            showSku: false,
            showDescription: false,
            fontSize: '12pt',
            priceSize: '16pt'
        },
        package_15x10: {
            name: 'Paket Etiketi (15x10cm)',
            width: '15cm',
            height: '10cm',
            showName: true,
            showPrice: false,
            showSku: true,
            showBarcode: true,
            showDimensions: true,
            showContent: true,
            showLogo: true,
            fontSize: '10pt',
            headerSize: '12pt'
        },
        package_10x15: {
            name: 'Paket Etiketi (10x15cm)',
            width: '10cm',
            height: '15cm',
            showName: true,
            showPrice: false,
            showSku: true,
            showBarcode: true,
            showDimensions: true,
            showContent: true,
            showLogo: true,
            fontSize: '10pt',
            headerSize: '12pt'
        }
    };

    // Open barcode operations for specific product
    window.openBarcodeOperations = function(productId) {
        const product = window.products.find(p => p.id === productId);
        if (!product) {
            showMessage('Ürün bulunamadı', 'error');
            return;
        }

        const modal = document.getElementById('barcodeModal');
        const content = document.getElementById('barcodeModalContent');
        
        if (!modal || !content) return;

        // Update modal title to show product name
        const modalTitle = modal.querySelector('.modal-header h3');
        if (modalTitle) {
            modalTitle.textContent = `${product.name} - Barkod İşlemleri`;
        }

        modal.style.display = 'flex';
        renderBarcodeOperations(product);
    };

    // Open barcode modal (general)
    window.openBarcodeModal = function() {
        const modal = document.getElementById('barcodeModal');
        const content = document.getElementById('barcodeModalContent');
        
        if (!modal || !content) return;

        // Reset modal title
        const modalTitle = modal.querySelector('.modal-header h3');
        if (modalTitle) {
            modalTitle.textContent = 'Barkod İşlemleri';
        }

        modal.style.display = 'flex';
        renderBarcodeModal();
    };

    // Close barcode modal
    window.closeBarcodeModal = function() {
        const modal = document.getElementById('barcodeModal');
        if (modal) {
            modal.style.display = 'none';
        }
    };

    // Render barcode modal content
    function renderBarcodeModal() {
        const content = document.getElementById('barcodeModalContent');
        if (!content) return;

        const selectedCount = window.selectedProducts?.length || 0;

        const html = `
            <div class="barcode-modal-content">
                <!-- Selection Info -->
                <div class="selection-info">
                    <div class="info-card">
                        <h4>Barkod İşlemleri</h4>
                        <p>${selectedCount} ürün seçili</p>
                        ${selectedCount === 0 ? '<p class="warning">⚠️ Lütfen önce ürün seçiniz</p>' : ''}
                    </div>
                </div>

                <!-- Simple Operations -->
                <div class="simple-operations">
                    <button onclick="printBarcodes()" class="btn btn-primary btn-large" ${selectedCount === 0 ? 'disabled' : ''}>
                        🖨️ Basit Barkod Yazdır (${selectedCount} adet)
                    </button>
                    <p class="operation-hint">Seçili ürünler için basit barkod etiketleri yazdırır</p>
                </div>

                <!-- Actions -->
                <div class="actions-section">
                    <button onclick="closeBarcodeModal()" class="btn btn-outline">
                        ❌ Kapat
                    </button>
                </div>
            </div>
        `;

        content.innerHTML = html;
    }

    // Render barcode operations for specific product
    function renderBarcodeOperations(product) {
        const content = document.getElementById('barcodeModalContent');
        if (!content) return;

        // Start loading packages immediately
        loadProductPackagesAsync(product.id).then(packages => {
            // Paket verilerini kullanarak etiket alanlarını ayarlayalım
            packages.forEach(pkg => {
                // Etiket template'inde:
                // Ana ürün adı (üstte, büyük): pkg.product_name (Paket formundaki "Ürün Adı *" alanı)
                // Paket detay bilgisi (altta, küçük): pkg.package_name (Paket formundaki "Paket Adı *" alanı)
                
                // Bu veriler backend'den geliyor, sadece fallback değerleri ekleyelim
                if (!pkg.product_name) pkg.product_name = product.name; // fallback - ana ürün adından
                if (!pkg.package_name) pkg.package_name = 'Paket'; // fallback - varsayılan değer
                
                // Ana ürün bilgilerini de ekleyelim (ihtiyaç halinde)
                pkg.main_product_name = product.main_product_name;
                pkg.main_product_name_en = product.main_product_name_en;
                
                console.log(`📦 Package data for barcode: product_name="${pkg.product_name}", product_name_en="${pkg.product_name_en}", package_name="${pkg.package_name}", package_name_en="${pkg.package_name_en}"`);
            });
            renderBarcodeOperationsWithPackages(product, packages);
        }).catch(error => {
            console.error('Error loading packages:', error);
            renderBarcodeOperationsWithPackages(product, []);
        });

        // Render initial content with loading state
        const html = `
            <div class="barcode-operations-content">
                <!-- Product Info -->
                <div class="product-info-section">
                    <div class="product-info-card">
                        <div class="product-details">
                            <h4>${escapeHtml(product.name)}</h4>
                            <div class="product-meta">
                                <span class="product-sku">SKU: <strong>${escapeHtml(product.sku)}</strong></span>
                                ${product.main_barcode ? `<span class="product-barcode">Ana Barkod: <strong>${escapeHtml(product.main_barcode)}</strong></span>` : ''}
                            </div>
                            ${product.description ? `<p class="product-description">${escapeHtml(product.description)}</p>` : ''}
                        </div>
                    </div>
                </div>

                <!-- Loading State -->
                <div id="packagesLoadingSection">
                    <div class="loading-message">Alt paketler yükleniyor...</div>
                </div>

                <!-- Packages will be rendered here -->
                <div id="packagesSection" style="display: none;">
                </div>

                <!-- Package Label Operations -->
                <div class="operations-section">
                    <h5>📦 Paket Etiket İşlemleri</h5>
                    <div class="simple-operations">
                        <button onclick="printSelectedPackageLabels(${product.id})" class="btn btn-primary btn-large" id="printPackagesBtn" disabled>
                            🖨️ Seçili Paketleri Yazdır
                        </button>
                        <p class="operation-hint">Paketleri seçip yazdırmak için yukarıdan paket işaretleyin</p>
                    </div>
                </div>

                <!-- Actions -->
                <div class="actions-section">
                    <button onclick="closeBarcodeModal()" class="btn btn-outline">
                        ❌ Kapat
                    </button>
                </div>
            </div>
        `;

        content.innerHTML = html;
        
    }



    // Render barcode using JsBarcode
    function renderBarcode(container, text, options) {
        console.log('🔍 renderBarcode called with:', { text, options, hasJsBarcode: !!window.JsBarcode });
        
        if (!container || !text) {
            console.warn('❌ Missing container or text:', { container: !!container, text });
            return;
        }

        try {
            // Clean and validate barcode text
            const cleanText = String(text).replace(/[^A-Za-z0-9-]/g, '').toUpperCase();
            console.log('🧹 Cleaned text:', cleanText);
            
            if (!cleanText || cleanText.length < 3) {
                console.warn('❌ Invalid barcode text:', text);
                container.innerHTML = `<div class="barcode-fallback">Invalid Barcode: ${text}</div>`;
                return;
            }
            
            const canvas = document.createElement('canvas');
            container.innerHTML = '';
            container.appendChild(canvas);

            if (window.JsBarcode) {
                console.log('✅ JsBarcode available, generating...');
                
                // Simplified approach first
                canvas.width = 300;
                canvas.height = 100;
                canvas.style.width = '40mm';
                canvas.style.height = '15mm';
                
                window.JsBarcode(canvas, cleanText, {
                    format: 'CODE128',
                    width: 2,
                    height: 50,
                    displayValue: true,
                    fontSize: 12,
                    textMargin: 2,
                    margin: 5,
                    background: '#ffffff',
                    lineColor: '#000000'
                });
                
                console.log('✅ Barcode generated successfully');
            } else {
                console.warn('❌ JsBarcode not loaded');
                container.innerHTML = `<div class="barcode-fallback">JsBarcode not loaded</div>`;
            }
        } catch (error) {
            console.error('❌ Barcode render error:', error);
            container.innerHTML = `<div class="barcode-fallback">Error: ${error.message}</div>`;
        }
    }



    // Print simple barcodes for selected products
    window.printBarcodes = function() {
        if (!window.selectedProducts || window.selectedProducts.length === 0) {
            showMessage('Yazdırmak için ürün seçiniz', 'error');
            return;
        }

        try {
            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                throw new Error('Pop-up blocker tarafından engellendi');
            }

            const products = window.selectedProducts.map(id => window.products.find(p => p.id === id)).filter(p => p);
            
            const printHTML = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Basit Barkod Etiketleri</title>
                    <style>
                        @page { margin: 0.5cm; }
                        body { 
                            font-family: Arial, sans-serif; 
                            margin: 0; 
                            padding: 0;
                            background: white;
                        }
                        .barcode-label { 
                            border: 1px solid #ccc; 
                            margin: 2mm; 
                            padding: 2mm; 
                            display: inline-block; 
                            text-align: center;
                            page-break-inside: avoid;
                            width: 60mm;
                            height: 30mm;
                        }
                        .label-name { font-weight: bold; margin-bottom: 2px; font-size: 10pt; }
                        .label-sku { font-size: 8pt; color: #666; margin-top: 2px; }
                        .barcode-container { margin: 2px 0; }
                        .barcode-fallback { 
                            font-family: monospace; 
                            font-size: 8pt; 
                            border: 1px solid #ccc; 
                            padding: 2px; 
                        }
                    </style>
                    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
                </head>
                <body>
                    ${products.map(product => `
                        <div class="barcode-label">
                            <div class="label-name">${product.name.substring(0, 25)}</div>
                            <div class="barcode-container" data-barcode="${product.main_barcode || product.sku}">
                                <div class="barcode-fallback">||||| ||| ||</div>
                            </div>
                            <div class="label-sku">SKU: ${product.sku}</div>
                        </div>
                    `).join('')}
                    <script>
                        window.onload = function() {
                            setTimeout(() => {
                                document.querySelectorAll('.barcode-container').forEach(container => {
                                    const text = container.dataset.barcode;
                                    if (text && window.JsBarcode) {
                                        const canvas = document.createElement('canvas');
                                        container.innerHTML = '';
                                        container.appendChild(canvas);
                                        
                                        canvas.width = 200;
                                        canvas.height = 60;
                                        canvas.style.width = '30mm';
                                        canvas.style.height = '10mm';
                                        
                                        try {
                                            const cleanText = String(text).replace(/[^A-Za-z0-9-]/g, '').toUpperCase();
                                            JsBarcode(canvas, cleanText, {
                                                format: 'CODE128',
                                                width: 2,
                                                height: 40,
                                                displayValue: false,
                                                margin: 5,
                                                background: '#ffffff',
                                                lineColor: '#000000'
                                            });
                                        } catch(e) {
                                            container.innerHTML = '<div class="barcode-fallback">Barkod: ' + text + '</div>';
                                        }
                                    }
                                });
                                
                                setTimeout(() => {
                                    window.print();
                                }, 1000);
                            }, 500);
                        };
                    </script>
                </body>
                </html>
            `;
            
            printWindow.document.write(printHTML);
            printWindow.document.close();

            showMessage(`${products.length} ürün için basit barkod yazdırılıyor`, 'success');

        } catch (error) {
            console.error('❌ Print error:', error);
            showMessage('Yazdırma hatası: ' + error.message, 'error');
        }
    };

    // Load product packages asynchronously
    async function loadProductPackagesAsync(productId) {
        try {
            const response = await fetch(`/api/products/${productId}/packages`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const result = await response.json();
            return Array.isArray(result) ? result : (result.data || []);
        } catch (error) {
            console.error('❌ Load packages error:', error);
            return [];
        }
    }

    // Render barcode operations with packages data
    function renderBarcodeOperationsWithPackages(product, packages) {
        const loadingSection = document.getElementById('packagesLoadingSection');
        const packagesSection = document.getElementById('packagesSection');
        
        if (!loadingSection || !packagesSection) return;

        // Hide loading, show packages
        loadingSection.style.display = 'none';
        packagesSection.style.display = 'block';

        // Render packages section
        if (packages && packages.length > 0) {
            packagesSection.innerHTML = `
                <div class="packages-section">
                    <h5>Alt Paketler <span class="package-count">(${packages.length} adet)</span></h5>
                    <div class="packages-grid">
                        ${packages.map(pkg => `
                            <div class="package-card" data-package-id="${pkg.id}">
                                <div class="package-header">
                                    <input type="checkbox" class="package-checkbox" id="pkg_${pkg.id}" onchange="updatePackageSelection()">
                                    <label for="pkg_${pkg.id}" class="package-name">${escapeHtml(pkg.package_number || pkg.name)}</label>
                                </div>
                                <div class="package-details">
                                    ${pkg.barcode ? `<div class="package-barcode">📊 ${pkg.barcode}</div>` : ''}
                                    ${pkg.dimensions ? `<div class="package-dimensions">📏 ${pkg.dimensions}</div>` : ''}
                                    ${pkg.weight ? `<div class="package-weight">⚖️ ${pkg.weight}kg</div>` : ''}
                                    ${pkg.contents ? `<div class="package-contents">📦 ${escapeHtml(pkg.contents.substring(0, 50))}...</div>` : ''}
                                </div>
                                <div class="package-actions">
                                    <button onclick="previewPackageLabel('${pkg.id}')" class="btn btn-small btn-outline">👁️ Önizle</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="packages-footer">
                        <button onclick="selectAllPackages()" class="btn btn-small btn-secondary">Tümünü Seç</button>
                        <button onclick="deselectAllPackages()" class="btn btn-small btn-secondary">Seçimi Temizle</button>
                        <span class="selection-count" id="selectionCount">0 paket seçili</span>
                    </div>
                </div>
            `;
        } else {
            packagesSection.innerHTML = `
                <div class="packages-section">
                    <div class="empty-packages">
                        <div class="empty-icon">📦</div>
                        <p>Bu ürün için henüz paket tanımlanmamış</p>
                        <p class="empty-hint">Paket eklemek için ürün yönetimi bölümünü kullanın</p>
                    </div>
                </div>
            `;
        }

        // Store packages globally for use in other functions
        window.currentProductPackages = packages;
        updatePackageSelection();
    }

    // Update package selection count
    window.updatePackageSelection = function() {
        const checkboxes = document.querySelectorAll('.package-checkbox:checked');
        const count = checkboxes.length;
        const countElement = document.getElementById('selectionCount');
        const printBtn = document.getElementById('printPackagesBtn');
        
        if (countElement) {
            countElement.textContent = `${count} paket seçili`;
        }
        
        if (printBtn) {
            printBtn.disabled = count === 0;
            printBtn.textContent = count > 0 ? `Seçili Paketler (${count})` : 'Seçili Paketler';
        }
    };

    // Select all packages
    window.selectAllPackages = function() {
        const checkboxes = document.querySelectorAll('.package-checkbox');
        checkboxes.forEach(cb => cb.checked = true);
        updatePackageSelection();
    };

    // Deselect all packages
    window.deselectAllPackages = function() {
        const checkboxes = document.querySelectorAll('.package-checkbox');
        checkboxes.forEach(cb => cb.checked = false);
        updatePackageSelection();
    };

    // Print package labels
    window.printPackageLabels = function(productId) {
        const product = window.products.find(p => p.id === productId);
        if (!product) {
            showMessage('Ürün bulunamadı', 'error');
            return;
        }
        
        showMessage(`${product.name} için paket etiketleri yazdırılıyor...`, 'info');
        // TODO: Implement package labels printing logic
    };

    // Print selected package labels
    window.printSelectedPackageLabels = function(productId) {
        const selectedCheckboxes = document.querySelectorAll('.package-checkbox:checked');
        
        if (selectedCheckboxes.length === 0) {
            showMessage('Lütfen yazdırılacak paketleri seçin', 'warning');
            return;
        }

        const selectedPackageIds = Array.from(selectedCheckboxes).map(cb => {
            return cb.id.replace('pkg_', '');
        });

        const selectedPackages = window.currentProductPackages.filter(pkg => 
            selectedPackageIds.includes(pkg.id.toString())
        );

        if (selectedPackages.length === 0) {
            showMessage('Seçili paketler bulunamadı', 'error');
            return;
        }

        printCustomPackageLabels(selectedPackages);
    };

    // Preview package label
    window.previewPackageLabel = function(packageId) {
        const pkg = window.currentProductPackages?.find(p => p.id.toString() === packageId.toString());
        if (!pkg) {
            showMessage('Paket bulunamadı', 'error');
            return;
        }

        const previewWindow = window.open('', '_blank', 'width=800,height=600');
        const labelHTML = generateCustomPackageLabelHTML(pkg, BARCODE_TEMPLATES.package_15x10);
        
        previewWindow.document.write(`
            <html>
                <head>
                    <title>Paket Etiket Önizleme - ${pkg.package_number || pkg.name}</title>
                    <style>${getPackageLabelCSS()}</style>
                    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
                </head>
                <body>
                    <div class="preview-container">
                        <h2>Paket Etiket Önizleme</h2>
                        ${labelHTML}
                    </div>
                </body>
            </html>
        `);
        
        // Render barcodes from main window context (same approach as print but higher quality)
        previewWindow.onload = function() {
            console.log('🎯 Preview window loaded');
            
            setTimeout(() => {
                const barcodeContainers = previewWindow.document.querySelectorAll('.barcode-container[data-barcode]');
                console.log('🔍 Preview window - Found', barcodeContainers.length, 'barcode containers');
                
                barcodeContainers.forEach((container, index) => {
                    const barcodeText = container.getAttribute('data-barcode');
                    console.log('📊 Preview: Rendering barcode', index, ':', barcodeText);
                    
                    if (barcodeText && barcodeText.trim() !== '' && window.JsBarcode) {
                        try {
                            const cleanText = String(barcodeText).replace(/[^A-Za-z0-9-]/g, '').toUpperCase();
                            
                            // Create high-quality canvas in main window for preview
                            const tempCanvas = document.createElement('canvas');
                            tempCanvas.width = 500;  // Higher resolution for preview
                            tempCanvas.height = 150;
                            
                            window.JsBarcode(tempCanvas, cleanText, {
                                format: 'CODE128',
                                width: 4,    // Higher width for better quality
                                height: 80,  // Higher height
                                displayValue: true,
                                fontSize: 16,
                                textMargin: 4,
                                margin: 10,
                                background: '#ffffff',
                                lineColor: '#000000'
                            });
                            
                            // Clone to preview window with crisp rendering
                            const previewCanvas = previewWindow.document.createElement('canvas');
                            previewCanvas.width = tempCanvas.width;
                            previewCanvas.height = tempCanvas.height;
                            previewCanvas.style.width = '60mm';  // Larger display for preview
                            previewCanvas.style.height = '22mm';
                            previewCanvas.style.imageRendering = 'crisp-edges';
                            previewCanvas.style.imageRendering = 'pixelated';
                            previewCanvas.style.border = 'none';
                            
                            const ctx = previewCanvas.getContext('2d');
                            ctx.imageSmoothingEnabled = false; // Prevent blurring
                            ctx.drawImage(tempCanvas, 0, 0);
                            
                            container.innerHTML = '';
                            container.appendChild(previewCanvas);
                            
                            console.log('✅ Preview barcode rendered successfully:', cleanText);
                            
                        } catch (error) {
                            console.error('❌ Preview barcode render error:', error);
                            container.innerHTML = '<div style="font-family:monospace;font-size:10px;border:1px solid #ccc;padding:4px;text-align:center;">Barkod: ' + barcodeText + '</div>';
                        }
                    }
                });
            }, 500);
        };
    };

    // Preview barcode
    window.previewBarcode = function(productId) {
        const product = window.products.find(p => p.id === productId);
        if (!product) {
            showMessage('Ürün bulunamadı', 'error');
            return;
        }
        
        // Create preview window
        const previewWindow = window.open('', '_blank', 'width=600,height=400');
        previewWindow.document.write(`
            <html>
                <head>
                    <title>Barkod Önizleme - ${product.name}</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; }
                        .preview-card { border: 1px solid #ddd; padding: 15px; margin: 10px; display: inline-block; }
                        .barcode { font-family: 'Courier New', monospace; font-size: 14px; letter-spacing: 1px; }
                    </style>
                </head>
                <body>
                    <h2>Barkod Önizleme: ${product.name}</h2>
                    <div class="preview-card">
                        <div><strong>${product.name}</strong></div>
                        <div class="barcode">|||||  |||  ||  |||||</div>
                        <div>SKU: ${product.sku}</div>
                        ${product.main_barcode ? `<div>Barkod: ${product.main_barcode}</div>` : ''}
                        ${product.price ? `<div>Fiyat: ₺${product.price}</div>` : ''}
                    </div>
                </body>
            </html>
        `);
    };



    // Generate custom package label HTML with specified format
    function generateCustomPackageLabelHTML(pkg, template = null) {
        const currentDate = new Date().toLocaleDateString('tr-TR');
        const serialNo = `PKG-${Date.now().toString().slice(-6)}`;
        
        // Get template dimensions
        const templateInfo = template || BARCODE_TEMPLATES.package_15x10;
        
        return `
            <div class="custom-package-label" data-template="${template ? template.name : 'default'}">
                <!-- Header with Logo and Product Name -->
                <div class="label-header">
                    <div class="logo-section">
                        <img src="/assets/images/black-logo.png" alt="Logo" class="company-logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                        <div class="logo-placeholder" style="display:none;">LOGO</div>
                    </div>
                    <div class="product-name-section">
                        <div class="main-product-name">${formatBilingualText(pkg.product_name, pkg.product_name_en, 'ANA ÜRÜN ADI')}</div>
                        <div class="package-subtitle">${formatBilingualText(pkg.package_name, pkg.package_name_en, 'PAKET ADI')}</div>
                    </div>
                </div>
                
                <!-- Main Content Area -->
                <div class="label-body">
                    <!-- Left Section (Critical + Barcode) -->
                    <div class="left-section">
                        <div class="package-info-group">
                            <div class="info-label">PAKET NO / PACKAGE NO</div>
                            <div class="info-value">${escapeHtml(pkg.package_number || pkg.name || 'N/A')}</div>
                        </div>
                        
                        <div class="package-info-group">
                            <div class="info-label">RENK / COLOR</div>
                            <div class="info-value">${formatBilingualText(pkg.color, pkg.color_en, 'N/A')}</div>
                        </div>
                        
                        <div class="barcode-section">
                            <div class="barcode-container" data-barcode="${pkg.barcode || pkg.package_number || '530501354649'}">
                                <div class="barcode-placeholder">||||| ||| |||| |||||</div>
                            </div>
                            <div class="barcode-number">${pkg.barcode || pkg.package_number || '530501354649'}</div>
                        </div>
                    </div>
                    
                    <!-- Right Section (Dimensions) -->
                    <div class="right-section">
                        <div class="dimensions-group">
                            <div class="dimensions-title">PAKET ÖLÇÜLERİ / PACKAGE DIMENSIONS</div>
                            <div class="dimension-item">- Yükseklik / Height: ${pkg.height || pkg.dimensions_height || '..'} cm</div>
                            <div class="dimension-item">- Genişlik / Width: ${pkg.width || pkg.dimensions_width || '..'} cm</div>
                            <div class="dimension-item">- Uzunluk / Length: ${pkg.length || pkg.dimensions_length || '..'} cm</div>
                            <div class="dimension-summary">
                                <span>- M³: ${pkg.volume_m3 || pkg.volume || pkg.cubic_volume || pkg.m3 || '..'}</span>
                                <span class="weight-info">- KG: ${pkg.weight_kg || pkg.weight || pkg.total_weight || pkg.kg || '..'}</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Package Content Section -->
                <div class="content-section">
                    <div class="content-title">PAKET İÇERİĞİ / PACKAGE CONTENT</div>
                    <div class="content-list">
                        ${generatePackageContentList(pkg)}
                    </div>
                </div>
                
                <!-- Footer -->
                <div class="label-footer">
                    <span>${currentDate}</span>
                    <span>• Seri no: ${serialNo}</span>
                </div>
            </div>
        `;
    }

    // Generate package content list
    function generatePackageContentList(pkg) {
        const contentsTR = pkg.contents || pkg.package_content || '';
        const contentsEN = pkg.contents_en || pkg.package_content_en || '';
        
        if (!contentsTR && !contentsEN) {
            return `
                <div class="content-item">• ……………………………………………………………………………………</div>
                <div class="content-item">• ……………………………………………………………………………………</div>
                <div class="content-item">• ……………………………………………………………………………………</div>
                <div class="content-item">• ……………………………………………………………………………………</div>
                <div class="content-item">• ……………………………………………………………………………………</div>
                <div class="content-item">• ……………………………………………………………………………………</div>
            `;
        }
        
        const itemsTR = contentsTR ? contentsTR.split('\n').filter(item => item.trim()) : [];
        const itemsEN = contentsEN ? contentsEN.split('\n').filter(item => item.trim()) : [];
        const maxItems = Math.max(6, Math.max(itemsTR.length, itemsEN.length));
        let html = '';
        
        for (let i = 0; i < maxItems; i++) {
            const itemTR = itemsTR[i] || '';
            const itemEN = itemsEN[i] || '';
            
            if (itemTR && itemEN) {
                html += `<div class="content-item">• ${escapeHtml(itemTR)} / ${escapeHtml(itemEN)}</div>`;
            } else if (itemTR) {
                html += `<div class="content-item">• ${escapeHtml(itemTR)}</div>`;
            } else if (itemEN) {
                html += `<div class="content-item">• ${escapeHtml(itemEN)}</div>`;
            } else {
                html += `<div class="content-item">• ……………………………………………………………………………………</div>`;
            }
        }
        
        return html;
    }

    // Get package label CSS
    function getPackageLabelCSS() {
        return `
            .preview-container {
                padding: 20px;
                background: #f5f5f5;
            }
            
            .custom-package-label {
                width: 150mm;
                height: 100mm;
                background: white;
                border: none;  /* Dış kenarlık kaldırıldı */
                font-family: Arial, sans-serif;
                font-size: 9pt;
                line-height: 1.2;
                margin: 20px auto;
                display: flex;
                flex-direction: column;
            }
            
            /* 10x15cm template */
            .custom-package-label[data-template*="10x15"] {
                width: 100mm;
                height: 150mm;
            }
            
            .label-header {
                display: flex;
                border-bottom: 2px solid #000;
                height: 15mm;
            }
            
            .logo-section {
                width: 30mm;
                padding: 2mm;
                border-right: 1px solid #000;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .company-logo {
                max-width: 25mm;
                max-height: 10mm;
                object-fit: contain;
            }
            
            .logo-placeholder {
                font-size: 8pt;
                color: #666;
            }
            
            .product-name-section {
                flex: 1;
                padding: 2mm;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: flex-end;
                text-align: right;
            }
            
            .main-product-name {
                font-weight: bold;
                font-size: 11pt;
                margin-bottom: 1mm;
                color: #000;
                word-wrap: break-word;
                word-break: break-word;
                line-height: 1.1;
            }
            
            .package-subtitle {
                font-weight: normal;
                font-size: 9pt;
                margin-bottom: 1mm;
                color: #666;
                word-wrap: break-word;
                word-break: break-word;
                line-height: 1.1;
            }
            
            .label-body {
                display: flex;
                flex: 1;
                border-bottom: 2px solid #000;
            }
            
            .left-section {
                width: 50mm;
                border-right: 2px solid #000;
                padding: 2mm;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
            }
            
            .right-section {
                flex: 1;
                padding: 2mm;
            }
            
            .package-info-group {
                margin-bottom: 3mm;
            }
            
            .info-label {
                font-size: 7pt;
                font-weight: bold;
                margin-bottom: 1mm;
            }
            
            
            .info-value {
                font-size: 8pt;
                font-weight: bold;
            }
            
            .barcode-section {
                text-align: center;
                margin-top: auto;
            }
            
            .barcode-container {
                margin: 2mm 0;
                min-height: 18mm;
                max-width: 45mm;
                display: flex;
                align-items: center;
                justify-content: center;
                background: white;
                border: none;  /* Barcode kenarlığı kaldırıldı */
                padding: 1mm;
            }
            
            .barcode-placeholder {
                font-family: monospace;
                font-size: 8pt;
                letter-spacing: 1px;
                font-weight: bold;
                color: #999;
                text-align: center;
            }
            
            .barcode-number {
                font-size: 7pt;
                font-family: monospace;
                margin-top: 1mm;
            }
            
            .dimensions-group {
                height: 100%;
            }
            
            .dimensions-title {
                font-size: 7.5pt;
                font-weight: bold;
                margin-bottom: 2mm;
                line-height: 1.1;
                word-wrap: break-word;
            }
            
            .dimension-item {
                font-size: 7pt;
                margin-bottom: 1mm;
            }
            
            .dimension-summary {
                margin-top: 3mm;
                font-size: 7pt;
            }
            
            .weight-info {
                margin-left: 5mm;
            }
            
            .content-section {
                flex: 1;
                padding: 3mm;
                border-bottom: 2px solid #000;
                margin: 0 2mm;
            }
            
            .content-title {
                font-size: 8pt;
                font-weight: bold;
                margin-bottom: 2mm;
            }
            
            .content-list {
                display: flex;
                flex-direction: column;
                gap: 1mm;
                padding: 2mm;
                border: 1px solid #ccc;
                border-radius: 2mm;
            }
            
            .content-item {
                font-size: 6pt;
                line-height: 1.1;
            }
            
            .label-footer {
                padding: 1mm 2mm;
                font-size: 6pt;
                color: #666;
                display: flex;
                justify-content: space-between;
            }
            
            @media print {
                .preview-container {
                    padding: 0;
                    background: white;
                }
                .custom-package-label {
                    margin: 0;
                    page-break-inside: avoid;
                }
            }
        `;
    }

    // Print custom package labels with template selection
    function printCustomPackageLabels(packages) {
        if (!packages || packages.length === 0) {
            showMessage('Yazdırılacak paket bulunamadı', 'error');
            return;
        }

        // Show template selection modal
        showTemplateSizeSelection(packages);
    }

    // Show template size selection
    function showTemplateSizeSelection(packages) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content small">
                <div class="modal-header">
                    <h3>Etiket Boyutu Seçin</h3>
                </div>
                <div class="modal-body">
                    <p>${packages.length} paket için etiket boyutu seçiniz:</p>
                    <div class="template-size-options" style="display: flex; gap: 10px; justify-content: center; margin: 20px 0;">
                        <button onclick="printWithTemplate('package_15x10', this.dataset.packages)" class="btn btn-primary btn-large" data-packages='${JSON.stringify(packages)}'>
                            📄 15x10 cm (Yatay)
                        </button>
                        <button onclick="printWithTemplate('package_10x15', this.dataset.packages)" class="btn btn-secondary btn-large" data-packages='${JSON.stringify(packages)}'>
                            📄 10x15 cm (Dikey)
                        </button>
                    </div>
                </div>
                <div class="modal-footer">
                    <button onclick="this.closest('.modal').remove()" class="btn btn-outline">İptal</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    // Print with selected template
    window.printWithTemplate = function(templateKey, packagesData) {
        try {
            const packages = typeof packagesData === 'string' ? JSON.parse(packagesData) : packagesData;
            const template = BARCODE_TEMPLATES[templateKey];
            
            if (!template) {
                showMessage('Geçersiz şablon', 'error');
                return;
            }

            const printWindow = window.open('', '_blank', 'width=800,height=600');
            if (!printWindow) {
                throw new Error('Pop-up blocker tarafından engellendi');
            }

            const labelHTML = packages.map(pkg => generateCustomPackageLabelHTML(pkg, template)).join('');
            
            printWindow.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Paket Etiketleri - ${packages.length} adet (${template.name})</title>
                    <style>${getPackageLabelCSS()}</style>
                    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
                </head>
                <body>
                    <div class="preview-container">
                        ${labelHTML}
                    </div>
                </body>
                </html>
            `);
            
            printWindow.document.close();
            
            // Wait for content to load, render barcodes from main window, then print
            printWindow.onload = function() {
                console.log('🎯 Print window loaded');
                
                setTimeout(() => {
                    // Find barcode containers in print window
                    const barcodeContainers = printWindow.document.querySelectorAll('.barcode-container[data-barcode]');
                    console.log('🔍 Print window - Found', barcodeContainers.length, 'barcode containers');
                    
                    // Render barcodes from main window context where JsBarcode is available
                    let renderPromises = [];
                    
                    barcodeContainers.forEach((container, index) => {
                        const barcodeText = container.getAttribute('data-barcode');
                        console.log('📊 Rendering barcode', index, ':', barcodeText);
                        
                        if (barcodeText && barcodeText.trim() !== '' && window.JsBarcode) {
                            const renderPromise = new Promise((resolve) => {
                                try {
                                    const cleanText = String(barcodeText).replace(/[^A-Za-z0-9-]/g, '').toUpperCase();
                                    
                                    // Create high-quality canvas in main window for print
                                    const tempCanvas = document.createElement('canvas');
                                    tempCanvas.width = 400;  // Higher resolution
                                    tempCanvas.height = 120;
                                    
                                    window.JsBarcode(tempCanvas, cleanText, {
                                        format: 'CODE128',
                                        width: 3,    // Higher width for print quality
                                        height: 60,  // Higher height
                                        displayValue: true,
                                        fontSize: 14,
                                        textMargin: 3,
                                        margin: 8,
                                        background: '#ffffff',
                                        lineColor: '#000000'
                                    });
                                    
                                    // Clone the rendered canvas to print window with crisp rendering
                                    const printCanvas = printWindow.document.createElement('canvas');
                                    printCanvas.width = tempCanvas.width;
                                    printCanvas.height = tempCanvas.height;
                                    printCanvas.style.width = '40mm';
                                    printCanvas.style.height = '15mm';
                                    printCanvas.style.imageRendering = 'crisp-edges';
                                    printCanvas.style.border = 'none';
                                    
                                    const ctx = printCanvas.getContext('2d');
                                    ctx.imageSmoothingEnabled = false; // Prevent blurring for print
                                    ctx.drawImage(tempCanvas, 0, 0);
                                    
                                    // Replace container content with rendered canvas
                                    container.innerHTML = '';
                                    container.appendChild(printCanvas);
                                    
                                    console.log('✅ Barcode rendered successfully:', cleanText);
                                    resolve();
                                    
                                } catch (error) {
                                    console.error('❌ Barcode render error:', error);
                                    container.innerHTML = '<div style="font-family:monospace;font-size:8px;border:1px solid #ccc;padding:2px;">Barkod: ' + barcodeText + '</div>';
                                    resolve();
                                }
                            });
                            
                            renderPromises.push(renderPromise);
                        } else {
                            console.warn('❌ Invalid barcode text or JsBarcode not available:', barcodeText);
                            container.innerHTML = '<div style="font-family:monospace;font-size:8px;border:1px solid #ccc;padding:2px;">Barkod: ' + (barcodeText || 'N/A') + '</div>';
                        }
                    });
                    
                    // Wait for all barcodes to render, then print
                    Promise.all(renderPromises).then(() => {
                        console.log('🏁 All barcodes rendered, starting print');
                        setTimeout(() => {
                            printWindow.print();
                        }, 500);
                    });
                    
                }, 1000);
            };

            showMessage(`${packages.length} paket etiketi yazdırılıyor (${template.name})`, 'success');
            
            // Close both modals
            document.querySelectorAll('.modal').forEach(m => m.remove());
            closeBarcodeModal();

        } catch (error) {
            console.error('❌ Print error:', error);
            showMessage('Yazdırma hatası: ' + error.message, 'error');
        }
    };

    // Format bilingual text (Turkish / English)
    function formatBilingualText(textTR, textEN, fallback = '') {
        const tr = escapeHtml(textTR || '');
        const en = escapeHtml(textEN || '');
        
        if (tr && en) {
            return `${tr} / ${en}`;
        } else if (tr) {
            return tr;
        } else if (en) {
            return en;
        } else {
            return fallback;
        }
    }

    // Utility function to escape HTML
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Check if JsBarcode is available when module loads
    if (window.JsBarcode) {
        console.log('✅ JsBarcode is available when module loads');
    } else {
        console.warn('⚠️ JsBarcode not available when module loads, will check again later');
        // Try again after a short delay
        setTimeout(() => {
            if (window.JsBarcode) {
                console.log('✅ JsBarcode is now available');
            } else {
                console.error('❌ JsBarcode still not available after delay');
            }
        }, 1000);
    }
    
    console.log('✅ Products Barcode module loaded');
})();