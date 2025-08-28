// Products Core - CRUD Operations and Data Management
(function() {
    'use strict';

    // API endpoints
    const API = {
        PRODUCTS: '/api/products',
        PRODUCT_PACKAGES: '/api/product-packages'
    };

    // Load all products from server
    window.loadProducts = async function() {
        try {
            console.log('🔄 Loading products...');
            const response = await fetch(API.PRODUCTS);
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Ürünler yüklenemedi');
            }
            
            window.products = Array.isArray(result) ? result : (result.data || []);
            window.filteredProducts = [...window.products];
            
            console.log(`✅ ${window.products.length} ürün yüklendi`);
            return window.products;
        } catch (error) {
            console.error('❌ Product loading error:', error);
            throw error;
        }
    };


    // Update existing product
    window.saveProduct = async function() {
        try {
            const productId = document.getElementById('editProductId').value;
            const formData = getEditProductFormData();
            
            if (!validateProductForm(formData)) {
                return;
            }

            const response = await fetch(`${API.PRODUCTS}/${productId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Ürün güncellenemedi');
            }

            showMessage('Ürün başarıyla güncellendi', 'success');
            closeEditModal();
            await loadProducts();
            filterProducts();
            updateStats();
        } catch (error) {
            console.error('❌ Update product error:', error);
            showMessage('Ürün güncellenirken hata oluştu: ' + error.message, 'error');
        }
    };

    // Delete product
    window.deleteProduct = async function(productId) {
        if (!confirm('Bu ürünü silmek istediğinizden emin misiniz?')) {
            return;
        }

        try {
            const response = await fetch(`${API.PRODUCTS}/${productId}`, {
                method: 'DELETE'
            });

            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Ürün silinemedi');
            }

            showMessage('Ürün başarıyla silindi', 'success');
            await loadProducts();
            filterProducts();
            updateStats();
        } catch (error) {
            console.error('❌ Delete product error:', error);
            showMessage('Ürün silinirken hata oluştu: ' + error.message, 'error');
        }
    };

    // Filter and search products
    window.filterProducts = function() {
        if (!window.products || !Array.isArray(window.products)) {
            console.warn('⚠️ Products not loaded yet');
            return;
        }

        const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
        const statusFilter = document.getElementById('statusFilter')?.value || '';
        const sortBy = document.getElementById('sortBy')?.value || 'name';

        console.log('🔍 Filtering products:', { searchTerm, statusFilter, sortBy });

        // Filter products
        let filtered = window.products.filter(product => {
            const matchesSearch = !searchTerm || 
                (product.name && product.name.toLowerCase().includes(searchTerm)) ||
                (product.sku && product.sku.toLowerCase().includes(searchTerm)) ||
                (product.main_barcode && product.main_barcode.toLowerCase().includes(searchTerm));

            const matchesStatus = !statusFilter || 
                (statusFilter === 'stocked' && (product.inventory_quantity || 0) > 0) ||
                (statusFilter === 'out-of-stock' && (product.inventory_quantity || 0) === 0) ||
                (statusFilter === 'no-packages' && (!product.packages || product.packages.length === 0)) ||
                (statusFilter === 'no-location' && (!product.location_codes || product.location_codes.length === 0));

            return matchesSearch && matchesStatus;
        });

        // Sort products
        filtered.sort((a, b) => {
            switch(sortBy) {
                case 'sku': return (a.sku || '').localeCompare(b.sku || '');
                case 'price': return (b.price || 0) - (a.price || 0);
                case 'created': return new Date(b.created_at || 0) - new Date(a.created_at || 0);
                default: return (a.name || '').localeCompare(b.name || '');
            }
        });

        window.filteredProducts = filtered;
        window.currentPage = 1; // Reset to first page
        renderProductsTable();
        renderPagination();

        console.log(`✅ Filtered ${filtered.length} products from ${window.products.length} total`);
    };

    // Get form data for new product
    function getNewProductFormData() {
        return {
            sku: document.getElementById('newSku')?.value?.trim() || '',
            name: document.getElementById('newName')?.value?.trim() || '',
            price: parseFloat(document.getElementById('newPrice')?.value) || 0,
            main_barcode: document.getElementById('newBarcode')?.value?.trim() || '',
            description: document.getElementById('newDescription')?.value?.trim() || ''
        };
    }

    // Get form data for edit product
    function getEditProductFormData() {
        return {
            sku: document.getElementById('editSku')?.value?.trim() || '',
            name: document.getElementById('editName')?.value?.trim() || '',
            main_product_name: document.getElementById('editMainProductName')?.value?.trim() || '',
            main_product_name_en: document.getElementById('editMainProductNameEn')?.value?.trim() || '',
            price: parseFloat(document.getElementById('editPrice')?.value) || 0,
            main_barcode: document.getElementById('editBarcode')?.value?.trim() || '',
            description: document.getElementById('editDescription')?.value?.trim() || ''
        };
    }

    // Validate product form data
    function validateProductForm(data) {
        // Clear previous validation errors
        document.querySelectorAll('.validation-error').forEach(el => el.remove());

        let hasErrors = false;

        // SKU validation
        if (!data.sku || data.sku.length < 2) {
            showValidationError('SKU en az 2 karakter olmalı', data.sku ? 'editSku' : 'newSku');
            hasErrors = true;
        }

        // Name validation
        if (!data.name || data.name.length < 2) {
            showValidationError('Ürün adı en az 2 karakter olmalı', data.name ? 'editName' : 'newName');
            hasErrors = true;
        }

        // Price validation
        if (data.price < 0) {
            showValidationError('Fiyat negatif olamaz', data.price ? 'editPrice' : 'newPrice');
            hasErrors = true;
        }

        return !hasErrors;
    }

    // Show validation error
    function showValidationError(message, inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;

        const error = document.createElement('div');
        error.className = 'validation-error';
        error.style.cssText = 'color: var(--danger, #dc3545); font-size: 0.8em; margin-top: 5px;';
        error.textContent = message;

        input.parentNode.appendChild(error);
        input.focus();
    }

    // Update statistics
    window.updateStats = function() {
        if (!window.products) return;

        const totalProducts = window.products.length;
        const stockedProducts = window.products.filter(p => (p.inventory_quantity || 0) > 0).length;
        const totalPackages = window.products.reduce((sum, p) => sum + (p.packages?.length || 0), 0);
        const totalValue = window.products.reduce((sum, p) => sum + ((p.price || 0) * (p.inventory_quantity || 0)), 0);

        // Update stat displays
        const elements = {
            totalProducts: document.getElementById('totalProducts'),
            stockedProducts: document.getElementById('stockedProducts'),
            totalPackages: document.getElementById('totalPackages'),
            totalValue: document.getElementById('totalValue')
        };

        if (elements.totalProducts) elements.totalProducts.textContent = totalProducts;
        if (elements.stockedProducts) elements.stockedProducts.textContent = stockedProducts;
        if (elements.totalPackages) elements.totalPackages.textContent = totalPackages;
        if (elements.totalValue) elements.totalValue.textContent = `₺${totalValue.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;

        // Show stats section
        const statsSection = document.getElementById('statsSection');
        if (statsSection) {
            statsSection.style.display = 'flex';
        }
    };

    console.log('✅ Products Core module loaded');
})();