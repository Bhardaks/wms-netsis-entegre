// Products UI - User Interface and Table Management
(function() {
    'use strict';

    // Render products table
    window.renderProductsTable = function() {
        const tbody = document.getElementById('productsTableBody');
        if (!tbody) return;

        if (!window.filteredProducts || window.filteredProducts.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center">
                        <div class="empty-state">
                            <p>Ürün bulunamadı</p>
                            <button onclick="refresh()" class="btn btn-primary">🔄 Yenile</button>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        const startIndex = (window.currentPage - 1) * window.itemsPerPage;
        const endIndex = startIndex + window.itemsPerPage;
        const pageProducts = window.filteredProducts.slice(startIndex, endIndex);

        tbody.innerHTML = pageProducts.map(product => createProductRow(product)).join('');
    };

    // Create a single product row
    function createProductRow(product) {
        const packagesBadge = getPackagesBadge(product.packages?.length || 0);

        return `
            <tr data-product-id="${product.id}">
                <td>
                    <input type="checkbox" class="product-checkbox" value="${product.id}">
                </td>
                <td>
                    <div class="product-info">
                        <div class="product-name">${escapeHtml(product.name || 'İsimsiz Ürün')}</div>
                        <div class="product-description">${escapeHtml(product.description || '')}</div>
                        ${product.main_barcode ? `<div class="product-barcode">🏷️ ${escapeHtml(product.main_barcode)}</div>` : ''}
                    </div>
                </td>
                <td>
                    <code class="sku-code">${escapeHtml(product.sku || '')}</code>
                </td>
                <td>
                    ${packagesBadge}
                </td>
                <td>
                    <div class="action-buttons">
                        <button onclick="editProduct(${product.id})" class="btn btn-sm btn-outline" title="Düzenle">
                            ✏️
                        </button>
                        <button onclick="viewPackages(${product.id})" class="btn btn-sm btn-secondary" title="Paketler">
                            📦
                        </button>
                        <button onclick="openBarcodeOperations(${product.id})" class="btn btn-sm btn-info" title="Barkod İşlemleri">
                            🏷️
                        </button>
                        <button onclick="deleteProduct(${product.id})" class="btn btn-sm btn-danger" title="Sil">
                            🗑️
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }


    // Get packages badge HTML
    function getPackagesBadge(count) {
        if (count > 0) {
            return `<span class="badge badge-info">📦 ${count} paket</span>`;
        } else {
            return `<span class="badge badge-light">Paket yok</span>`;
        }
    }

    // Render pagination
    window.renderPagination = function() {
        const container = document.getElementById('paginationContainer');
        if (!container) return;

        if (!window.filteredProducts || window.filteredProducts.length <= window.itemsPerPage) {
            container.innerHTML = '';
            return;
        }

        const totalPages = Math.ceil(window.filteredProducts.length / window.itemsPerPage);
        const currentPage = window.currentPage;

        let paginationHTML = '<div class="pagination">';

        // Previous button
        if (currentPage > 1) {
            paginationHTML += `<button onclick="changePage(${currentPage - 1})" class="btn btn-outline">‹ Önceki</button>`;
        }

        // Page numbers
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, currentPage + 2);

        if (startPage > 1) {
            paginationHTML += `<button onclick="changePage(1)" class="btn btn-outline">1</button>`;
            if (startPage > 2) {
                paginationHTML += '<span class="pagination-dots">...</span>';
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            const activeClass = i === currentPage ? 'btn-primary' : 'btn-outline';
            paginationHTML += `<button onclick="changePage(${i})" class="btn ${activeClass}">${i}</button>`;
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                paginationHTML += '<span class="pagination-dots">...</span>';
            }
            paginationHTML += `<button onclick="changePage(${totalPages})" class="btn btn-outline">${totalPages}</button>`;
        }

        // Next button
        if (currentPage < totalPages) {
            paginationHTML += `<button onclick="changePage(${currentPage + 1})" class="btn btn-outline">Sonraki ›</button>`;
        }

        paginationHTML += '</div>';

        // Add page info
        const startItem = (currentPage - 1) * window.itemsPerPage + 1;
        const endItem = Math.min(currentPage * window.itemsPerPage, window.filteredProducts.length);
        
        paginationHTML += `
            <div class="pagination-info">
                <span>${startItem}-${endItem} / ${window.filteredProducts.length} ürün gösteriliyor</span>
            </div>
        `;

        container.innerHTML = paginationHTML;
    };

    // Change page
    window.changePage = function(page) {
        const totalPages = Math.ceil(window.filteredProducts.length / window.itemsPerPage);
        
        if (page < 1 || page > totalPages) return;
        
        window.currentPage = page;
        renderProductsTable();
        renderPagination();

        // Scroll to top
        document.querySelector('.table-container')?.scrollIntoView({ behavior: 'smooth' });
    };

    // Modal functions
    window.openNewProductModal = function() {
        const modal = document.getElementById('newProductModal');
        if (modal) {
            clearNewProductForm();
            modal.style.display = 'flex';
            // Focus first input
            setTimeout(() => {
                document.getElementById('newSku')?.focus();
            }, 100);
        }
    };

    window.closeNewProductModal = function() {
        const modal = document.getElementById('newProductModal');
        if (modal) {
            modal.style.display = 'none';
            clearNewProductForm();
        }
    };

    window.openEditModal = function(product) {
        const modal = document.getElementById('editProductModal');
        if (modal && product) {
            loadProductToEditForm(product);
            modal.style.display = 'flex';
            // Focus first input
            setTimeout(() => {
                document.getElementById('editSku')?.focus();
            }, 100);
        }
    };

    window.closeEditModal = function() {
        const modal = document.getElementById('editProductModal');
        if (modal) {
            modal.style.display = 'none';
            clearEditProductForm();
        }
    };

    // Edit product - find and open edit modal
    window.editProduct = async function(productId) {
        try {
            const product = window.products.find(p => p.id === productId);
            if (!product) {
                showMessage('Ürün bulunamadı', 'error');
                return;
            }
            openEditModal(product);
        } catch (error) {
            console.error('❌ Edit product error:', error);
            showMessage('Ürün düzenleme hatası: ' + error.message, 'error');
        }
    };

    // Clear new product form
    function clearNewProductForm() {
        const form = document.getElementById('newProductForm');
        if (form) {
            form.reset();
        }
        // Clear validation errors
        document.querySelectorAll('#newProductModal .validation-error').forEach(el => el.remove());
    }

    // Clear edit product form
    function clearEditProductForm() {
        const form = document.getElementById('editProductForm');
        if (form) {
            form.reset();
        }
        // Clear validation errors
        document.querySelectorAll('#editProductModal .validation-error').forEach(el => el.remove());
    }

    // Load product data to edit form
    function loadProductToEditForm(product) {
        const elements = {
            editProductId: document.getElementById('editProductId'),
            editSku: document.getElementById('editSku'),
            editName: document.getElementById('editName'),
            editMainProductName: document.getElementById('editMainProductName'),
            editMainProductNameEn: document.getElementById('editMainProductNameEn'),
            editPrice: document.getElementById('editPrice'),
            editBarcode: document.getElementById('editBarcode'),
            editDescription: document.getElementById('editDescription')
        };

        if (elements.editProductId) elements.editProductId.value = product.id || '';
        if (elements.editSku) elements.editSku.value = product.sku || '';
        if (elements.editName) elements.editName.value = product.name || '';
        if (elements.editMainProductName) elements.editMainProductName.value = product.main_product_name || '';
        if (elements.editMainProductNameEn) elements.editMainProductNameEn.value = product.main_product_name_en || '';
        if (elements.editPrice) elements.editPrice.value = product.price || '';
        if (elements.editBarcode) elements.editBarcode.value = product.main_barcode || '';
        if (elements.editDescription) elements.editDescription.value = product.description || '';
    }

    // Toggle all products selection
    window.toggleAllProducts = function() {
        const selectAll = document.getElementById('selectAll');
        const checkboxes = document.querySelectorAll('.product-checkbox');
        
        if (selectAll && checkboxes.length > 0) {
            const isChecked = selectAll.checked;
            checkboxes.forEach(checkbox => {
                checkbox.checked = isChecked;
            });
            updateSelectedProducts();
        }
    };

    // Update selected products array
    function updateSelectedProducts() {
        const checkboxes = document.querySelectorAll('.product-checkbox:checked');
        window.selectedProducts = Array.from(checkboxes).map(cb => parseInt(cb.value));
    }

    // Utility function to escape HTML
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Setup product checkbox event listeners
    document.addEventListener('change', function(e) {
        if (e.target.classList.contains('product-checkbox')) {
            updateSelectedProducts();
        }
    });

    console.log('✅ Products UI module loaded');
})();