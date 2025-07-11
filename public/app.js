document.addEventListener('DOMContentLoaded', () => {
    

    const loginContainer = document.getElementById('login-container');
    const mainContent = document.getElementById('main-content');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const logoutButton = document.getElementById('logout-button');
    const catalogTableBody = document.getElementById('catalog-table-body');
    const searchInput = document.getElementById('search-input');
    const noProductsMessage = document.getElementById('no-products-message');
    const tableContainer = document.querySelector('.table-responsive');
    const categoryFilter = document.getElementById('category-filter');
    const tableHeaders = document.querySelectorAll('th.sortable');
    const paginationControls = document.getElementById('pagination-controls');
    const themeToggle = document.getElementById('theme-toggle');

    // Add/Edit Product Modal Elements
    const addProductModalEl = document.getElementById('addProductModal');
    const addProductModal = new bootstrap.Modal(addProductModalEl);
    const addProductForm = document.getElementById('add-product-form');
    const addProductModalTitle = addProductModalEl.querySelector('.modal-title');

    // Details/Calculator Modal Elements
    const detailsModal = new bootstrap.Modal(document.getElementById('detailsModal'));
    const detailsModalTitle = document.getElementById('detailsModalTitle');
    const detailsModalBody = document.getElementById('detailsModalBody');
    const exchangeRateDisplay = document.getElementById('exchange-rate-display');

    let products = [];
    let usdToArsRate = 1;
    let currentlyEditingId = null;
    let currentPage = 1;
    const itemsPerPage = 10; // You can change this value
    let currentSort = { column: null, direction: 'asc' }; // State for sorting

    // --- API Fetching ---
    async function fetchExchangeRate() {
        try {
            const response = await fetch('/api/exchange-rate'); // Changed to local endpoint
            if (!response.ok) {
                // The server already logged the detailed error, so we just show a user-friendly message.
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            if (data.rates && data.rates.ARS) {
                usdToArsRate = data.rates.ARS;
                exchangeRateDisplay.innerHTML = `<strong>Tasa de cambio actual:</strong> 1 USD = ${usdToArsRate.toFixed(2)} ARS`;
            } else {
                throw new Error('Invalid data structure from server');
            }
        } catch (error) {
            console.error('Error fetching exchange rate:', error);
            exchangeRateDisplay.innerHTML = 'No se pudo cargar la tasa de cambio.';
            exchangeRateDisplay.classList.remove('alert-info');
            exchangeRateDisplay.classList.add('alert-warning');
        }
    }

    // Check for saved login state
    if (sessionStorage.getItem('loggedIn') === 'true') {
        showMainContent();
    }

    // --- LOGIN/LOGOUT --- //
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch('/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            if (response.ok) {
                sessionStorage.setItem('loggedIn', 'true');
                showMainContent();
            } else {
                loginError.classList.remove('d-none');
            }
        } catch (error) {
            console.error('Login error:', error);
            loginError.textContent = 'An error occurred during login. Please try again.';
            loginError.classList.remove('d-none');
        }
    });

    logoutButton.addEventListener('click', () => {
        sessionStorage.removeItem('loggedIn');
        loginContainer.classList.remove('d-none');
        mainContent.classList.add('d-none');
    });

    async function showMainContent() {
        loginContainer.classList.add('d-none');
        mainContent.classList.remove('d-none');
        await fetchExchangeRate();
        loadProducts();
    }

    // --- MANEJO DE DATOS --- //
    async function loadProducts() {
        try {
            const response = await fetch('/products');
            products = await response.json();
            applyFiltersAndSort(); // Initial render with filters and sort
        } catch (error) {
            console.error('Error loading products:', error);
            // Optionally, display an error message to the user
        }
    }

    

    function applyFiltersAndSort() {
        let tempProducts = [...products];

        // Apply search filter
        const searchTerm = searchInput.value.toLowerCase();
        if (searchTerm) {
            tempProducts = tempProducts.filter(p => p.Producto.toLowerCase().includes(searchTerm));
        }

        // Apply category filter
        const selectedCategory = categoryFilter.value;
        if (selectedCategory !== 'Todas las categorías') {
            tempProducts = tempProducts.filter(p => p.CATEGORIA === selectedCategory);
        }

        // Apply sorting
        if (currentSort.column) {
            tempProducts.sort((a, b) => {
                const aValue = a[currentSort.column];
                const bValue = b[currentSort.column];
                
                let comparison = 0;
                if (aValue > bValue) comparison = 1;
                if (aValue < bValue) comparison = -1;
                
                // Handle numeric sorting for price columns
                if (currentSort.column.includes('Precio')) {
                    return currentSort.direction === 'asc' ? parseFloat(aValue) - parseFloat(bValue) : parseFloat(bValue) - parseFloat(aValue);
                }

                return currentSort.direction === 'asc' ? comparison : -comparison;
            });
        }

        filteredAndSortedProducts = tempProducts;
        currentPage = 1; // Reset to first page on filter/sort change
        renderTable();
    }

    function renderTable() {
        const totalPages = Math.ceil(filteredAndSortedProducts.length / itemsPerPage);
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const productsToRender = filteredAndSortedProducts.slice(startIndex, endIndex);

        if (productsToRender.length === 0 && products.length > 0) { // No results for current filter/search
            tableContainer.classList.add('d-none');
            noProductsMessage.classList.remove('d-none');
            noProductsMessage.innerHTML = `<h3>No se encontraron productos que coincidan con su búsqueda o filtro.</h3>`;
            paginationControls.innerHTML = ''; // Clear pagination if no results
        } else if (products.length === 0) { // No products in total
            tableContainer.classList.add('d-none');
            noProductsMessage.classList.remove('d-none');
            noProductsMessage.innerHTML = `<h3>No hay productos en el catálogo.</h3><p>¡Haz clic en 'Agregar Producto' para comenzar!</p>`;
            paginationControls.innerHTML = ''; // Clear pagination if no products
        } else {
            tableContainer.classList.remove('d-none');
            noProductsMessage.classList.add('d-none');
            catalogTableBody.innerHTML = '';
            productsToRender.forEach(product => {
                const priceArs = (parseFloat(product['Precio al CONTADO']) * usdToArsRate).toFixed(2);
                const row = document.createElement('tr');
                const imageUrl = product.Imagenes && product.Imagenes.length > 0 ? product.Imagenes[0] : '/images/placeholder.png';
                
                let statusHtml = '';
                if (!product.en_venta) {
                    row.classList.add('product-sold');
                    statusHtml = '<span class="badge bg-danger">Vendido (Al contado)</span>';
                } else if (product.plan_pago_elegido) {
                    row.classList.add('product-in-plan');
                    const startDate = new Date(product.fecha_inicio_pago + 'T00:00:00');
                    const nextDueDate = new Date(startDate);
                    nextDueDate.setMonth(startDate.getMonth() + (product.cuotas_pagadas || 0) + 1);
                    statusHtml = `<span class="badge bg-warning text-dark">${product.plan_pago_elegido} - Próx. Venc: ${nextDueDate.toLocaleDateString('es-AR')}</span>`;
                }

                const actionsHtml = `
                    <button class="btn btn-sm btn-info manage-sale" data-id="${product.id}" title="Gestionar Venta">
                        <i class="fas fa-dolly"></i> Gestionar
                    </button>
                    <div class="form-check form-switch mt-2">
                        <input class="form-check-input toggle-en-venta" type="checkbox" role="switch" id="toggle-${product.id}" data-id="${product.id}" ${product.en_venta ? 'checked' : ''}>
                        <label class="form-check-label" for="toggle-${product.id}">En Venta</label>
                    </div>
                `;

                row.innerHTML = `
                    <td><img src="${imageUrl}" alt="${product.Producto}" class="img-thumbnail" style="width: 50px; height: 50px; object-fit: cover;"></td>
                    <td class="product-name">${product.Producto || ''} ${statusHtml}</td>
                    <td>${product.CATEGORIA || ''}</td>
                    <td>${product['Precio al CONTADO'] || ''}</td>
                    <td>${priceArs}</td>
                    <td>
                        ${actionsHtml}
                        <button class="btn btn-sm btn-success view-plan" data-id="${product.id}" title="Plan de Pagos"><i class="fas fa-credit-card"></i></button>
                        <button class="btn btn-sm btn-warning edit-product" data-id="${product.id}" title="Editar"><i class="fas fa-pencil-alt"></i></button>
                        <button class="btn btn-sm btn-danger delete-product" data-id="${product.id}" title="Eliminar"><i class="fas fa-trash"></i></button>
                    </td>
                `;
                catalogTableBody.appendChild(row);
            });
            renderPaginationControls(totalPages);
        }
    }

    function renderPaginationControls(totalPages) {
        paginationControls.innerHTML = '';
        if (totalPages <= 1) return; // No pagination needed for 1 or less pages

        const createPageItem = (page, text, isActive = false, isDisabled = false) => {
            const li = document.createElement('li');
            li.className = `page-item ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`;
            const a = document.createElement('a');
            a.className = 'page-link';
            a.href = '#';
            a.textContent = text;
            a.dataset.page = page;
            li.appendChild(a);
            return li;
        };

        // Previous button
        paginationControls.appendChild(createPageItem(currentPage - 1, 'Anterior', false, currentPage === 1));

        // Page numbers
        for (let i = 1; i <= totalPages; i++) {
            paginationControls.appendChild(createPageItem(i, i, i === currentPage));
        }

        // Next button
        paginationControls.appendChild(createPageItem(currentPage + 1, 'Siguiente', false, currentPage === totalPages));

        // Add event listener for pagination clicks
        paginationControls.querySelectorAll('.page-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = parseInt(e.target.dataset.page);
                if (!isNaN(page) && page > 0 && page <= totalPages && page !== currentPage) {
                    currentPage = page;
                    renderTable();
                }
            });
        });
    }

    // --- PRICE CALCULATION LOGIC ---
    const priceContadoInput = document.getElementById('productPriceContado');
    const priceArsInput = document.getElementById('productPriceArs');
    const pricePyInput = document.getElementById('productPricePY');

    function updatePrices(source) {
        const contadoUSD = parseFloat(priceContadoInput.value);
        const ars = parseFloat(priceArsInput.value);
        const py = parseFloat(pricePyInput.value);

        if (source === 'contado') {
            if (!isNaN(contadoUSD)) {
                priceArsInput.value = (contadoUSD * usdToArsRate).toFixed(2);
                pricePyInput.value = (contadoUSD / 2).toFixed(2);
            } else {
                priceArsInput.value = '';
                pricePyInput.value = '';
            }
        } else if (source === 'ars') {
            if (!isNaN(ars) && usdToArsRate > 0) {
                const calculatedUsd = ars / usdToArsRate;
                priceContadoInput.value = calculatedUsd.toFixed(2);
                pricePyInput.value = (calculatedUsd / 2).toFixed(2);
            } else {
                priceContadoInput.value = '';
                pricePyInput.value = '';
            }
        } else if (source === 'py') {
            if (!isNaN(py)) {
                const calculatedUsd = py * 2;
                priceContadoInput.value = calculatedUsd.toFixed(2);
                priceArsInput.value = (calculatedUsd * usdToArsRate).toFixed(2);
            } else {
                priceContadoInput.value = '';
                priceArsInput.value = '';
            }
        }
    }

    function attachPriceEventListeners() {
        priceContadoInput.addEventListener('input', () => updatePrices('contado'));
        priceArsInput.addEventListener('input', () => updatePrices('ars'));
        pricePyInput.addEventListener('input', () => updatePrices('py'));
    }

    function removePriceEventListeners() {
        priceContadoInput.removeEventListener('input', () => updatePrices('contado'));
        priceArsInput.removeEventListener('input', () => updatePrices('ars'));
        pricePyInput.removeEventListener('input', () => updatePrices('py'));
    }


    // --- CRUD & EVENT LISTENERS --- //
    searchInput.addEventListener('input', applyFiltersAndSort);
    categoryFilter.addEventListener('change', applyFiltersAndSort);

    tableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.sort;
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'asc';
            }
            applyFiltersAndSort();
        });
    });

    addProductModalEl.addEventListener('hidden.bs.modal', () => {
        addProductForm.reset();
        currentlyEditingId = null;
        addProductModalTitle.textContent = 'Agregar Nuevo Producto';
        removePriceEventListeners(); // Remove listeners when modal is closed
    });

    addProductModalEl.addEventListener('shown.bs.modal', () => {
        attachPriceEventListeners(); // Add listeners when modal is shown
    });

    

    addProductForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const productImageInput = document.getElementById('productImages');
        const files = productImageInput.files;

        // Gather data from form fields
        const productData = {
            Producto: document.getElementById('productName').value,
            CATEGORIA: document.getElementById('productCategory').value,
            "Precio al CONTADO": parseFloat(document.getElementById('productPriceContado').value) || 0,
            "Precio PY": parseFloat(document.getElementById('productPricePY').value) || 0,
            // en_venta will be handled by the server on creation
        };

        const saveProduct = async (imagesArray) => {
            const method = currentlyEditingId ? 'PUT' : 'POST';
            const url = currentlyEditingId ? `/products/${currentlyEditingId}` : '/products';

            const productDataToSend = {
                ...productData,
                Imagenes: imagesArray,
            };

            if (!currentlyEditingId) {
                productDataToSend.id = `prod-${new Date().getTime()}`;
            }

            try {
                const response = await fetch(url, {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(productDataToSend)
                });

                if (response.ok) {
                    loadProducts(); // Reload products from server
                    addProductModal.hide();
                } else {
                    const errorData = await response.json();
                    console.error('Error saving product:', errorData.error);
                    alert('Error al guardar el producto: ' + errorData.error);
                }
            } catch (error) {
                console.error('Network error saving product:', error);
                alert('Error de red al guardar el producto.');
            }
        };

        if (files && files.length > 0) {
            const loadedImages = [];
            Array.from(files).forEach(file => {
                const reader = new FileReader();
                reader.onload = (event) => {
                    loadedImages.push(event.target.result);
                    if (loadedImages.length === files.length) {
                        saveProduct(loadedImages);
                    }
                };
                reader.readAsDataURL(file);
            });
        } else {
            // If editing, pass the existing images, otherwise, an empty array.
            let existingImages = [];
            if (currentlyEditingId) {
                const product = products.find(p => p.id === currentlyEditingId);
                if (product) {
                    existingImages = product.Imagenes;
                }
            }
            saveProduct(currentlyEditingId ? existingImages : []);
        }
    });

    catalogTableBody.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        const productId = button.dataset.id;
        
        if (button.classList.contains('view-details')) {
            const product = products.find(p => p.id === productId);
            showDetails(product);
        } else if (button.classList.contains('view-plan')) {
            const product = products.find(p => p.id === productId);
            showPaymentPlan(product);
        } else if (button.classList.contains('edit-product')) {
            handleEdit(productId);
        } else if (button.classList.contains('delete-product')) {
            handleDelete(productId);
        } else if (button.classList.contains('manage-sale')) {
            openManageSaleModal(productId);
        }
    });

    catalogTableBody.addEventListener('change', async (e) => {
        if (e.target.classList.contains('toggle-en-venta')) {
            const productId = e.target.dataset.id;
            const en_venta = e.target.checked;

            try {
                const response = await fetch(`/products/${productId}/status`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ en_venta })
                });

                if (response.ok) {
                    loadProducts(); // Recargar para reflejar el cambio visual
                } else {
                    const errorData = await response.json();
                    console.error('Error updating product status:', errorData.error);
                    alert('Error al actualizar el estado del producto: ' + errorData.error);
                    e.target.checked = !en_venta; // Revertir el switch si hay error
                }
            } catch (error) {
                console.error('Network error updating product status:', error);
                alert('Error de red al actualizar el estado del producto.');
                e.target.checked = !en_venta; // Revertir el switch si hay error
            }
        }
    });

    function handleEdit(productId) {
        const product = products.find(p => p.id === productId);
        if (!product) return;

        currentlyEditingId = productId;
        addProductModalTitle.textContent = 'Editar Producto';

        const priceContado = parseFloat(product['Precio al CONTADO']);
        const pricePy = parseFloat(product['Precio PY']);
        
        document.getElementById('productName').value = product.Producto;
        document.getElementById('productCategory').value = product.CATEGORIA;
        document.getElementById('productPricePY').value = pricePy.toFixed(2);
        document.getElementById('productPriceContado').value = priceContado.toFixed(2);
        
        // Calculate and set ARS price
        if (!isNaN(priceContado)) {
            document.getElementById('productPriceArs').value = (priceContado * usdToArsRate).toFixed(2);
        } else {
            document.getElementById('productPriceArs').value = '';
        }

        // Clear the file input for security reasons
        document.getElementById('productImages').value = '';

        addProductModal.show();
    }

    async function handleDelete(productId) {
        if (confirm('¿Estás seguro de que quieres eliminar este producto?')) {
            try {
                const response = await fetch(`/products/${productId}`, {
                    method: 'DELETE',
                });

                if (response.ok) {
                    loadProducts(); // Reload products from server
                } else {
                    const errorData = await response.json();
                    console.error('Error deleting product:', errorData.error);
                    alert('Error al eliminar el producto: ' + errorData.error);
                }
            } catch (error) {
                console.error('Network error deleting product:', error);
                alert('Error de red al eliminar el producto.');
            }
        }
    }

    // --- MODAL CONTENT FUNCTIONS ---
    function showDetails(product) {
        detailsModalTitle.textContent = `Detalles de: ${product.Producto}`;
        const priceArs = (parseFloat(product['Precio al CONTADO']) * usdToArsRate).toFixed(2);

        let imagesHtml = '';
        if (product.Imagenes && product.Imagenes.length > 0) {
            const totalImages = product.Imagenes.length;
            imagesHtml = `
                <div id="productCarousel" class="carousel slide" data-bs-ride="carousel">
                    <div class="carousel-inner">
            `;
            product.Imagenes.forEach((imgSrc, index) => {
                imagesHtml += `
                        <div class="carousel-item ${index === 0 ? 'active' : ''}">
                            ${totalImages > 1 ? `<div class="image-counter">${index + 1} / ${totalImages}</div>` : ''}
                            <img src="${imgSrc}" class="d-block w-100" alt="${product.Producto} - Imagen ${index + 1}">
                        </div>
                `;
            });
            imagesHtml += `
                    </div>
                    ${totalImages > 1 ? `
                    <button class="carousel-control-prev" type="button" data-bs-target="#productCarousel" data-bs-slide="prev">
                        <span class="carousel-control-prev-icon" aria-hidden="true"></span>
                        <span class="visually-hidden">Previous</span>
                    </button>
                    <button class="carousel-control-next" type="button" data-bs-target="#productCarousel" data-bs-slide="next">
                        <span class="carousel-control-next-icon" aria-hidden="true"></span>
                        <span class="visually-hidden">Next</span>
                    </button>
                    ` : ''}
                </div>
                <hr>
            `;
        } else {
            imagesHtml = `<img src="https://via.placeholder.com/150" alt="${product.Producto}" class="img-fluid rounded mb-3"><hr>`;
        }

        detailsModalBody.innerHTML = `
            <div class="row">
                <div class="col-12 mb-3">
                    ${imagesHtml}
                </div>
                <div class="col-12">
                    <p><strong>Categoría:</strong> ${product.CATEGORIA}</p>
                    <p><strong>Precio PY:</strong> ${product['Precio PY']} USD</p>
                    <p><strong>Precio Contado:</strong> ${product['Precio al CONTADO']} USD / ${priceArs} ARS</p>
                </div>
            </div>
        `;
        detailsModal.show();
    }

    function showPaymentPlan(product) {
        detailsModalTitle.textContent = `Planes de Pago: ${product.Producto}`;
        detailsModalBody.innerHTML = getPaymentPlanHtml(product);
        detailsModal.show();
    }

    function getPaymentPlanHtml(product) {
        const priceContado = parseFloat(product['Precio al CONTADO']);
        if (isNaN(priceContado)) return '<p class="text-danger">El precio del producto no es válido.</p>';

        const plans = [
            { months: 3, interest: 0.50, name: 'Plan 3 Cuotas' },
            { months: 6, interest: 1.00, name: 'Plan 6 Cuotas' },
            { months: 9, interest: 1.50, name: 'Plan 9 Cuotas' },
            { months: 12, interest: 2.00, name: 'Plan Exclusivo' }
        ];

        let tableHtml = `
            <h5>Planes de Financiación</h5>
            <p>Precio Contado: <strong>${priceContado.toFixed(2)} USD / ${(priceContado * usdToArsRate).toFixed(2)} ARS</strong></p>
            <table class="table table-bordered table-sm">
                <thead class="table-light">
                    <tr>
                        <th>Plan</th>
                        <th>Interés</th>
                        <th>Valor Cuota (USD/ARS)</th>
                        <th>Precio Final (USD/ARS)</th>
                    </tr>
                </thead>
                <tbody>`;

        for (const plan of plans) {
            const finalPrice = priceContado * (1 + plan.interest);
            const installmentValue = finalPrice / plan.months;
            const finalPriceArs = finalPrice * usdToArsRate;
            const installmentValueArs = installmentValue * usdToArsRate;

            tableHtml += `
                <tr>
                    <td><strong>${plan.name}</strong></td>
                    <td>${(plan.interest * 100).toFixed(0)}%</td>
                    <td>${installmentValue.toFixed(2)} / ${installmentValueArs.toFixed(2)}</td>
                    <td>${finalPrice.toFixed(2)} / ${finalPriceArs.toFixed(2)}</td>
                </tr>`;
        }

        tableHtml += `
                </tbody>
            </table>
            <small class="text-muted">Los precios en ARS son aproximados y se basan en la tasa de cambio actual.</small>
        `;

        return tableHtml;
    }

    // (Removed duplicate manageSaleModal and openManageSaleModal block)

    const manageSaleModalEl = document.getElementById('manageSaleModal');
    const manageSaleModal = new bootstrap.Modal(manageSaleModalEl);
    const manageSaleModalBody = document.getElementById('manageSaleModalBody');
    const manageSaleModalTitle = document.getElementById('manageSaleModalTitle');
    let currentManagingSaleId = null;

    function openManageSaleModal(productId) {
        currentManagingSaleId = productId;
        const product = products.find(p => p.id === productId);
        if (!product) return;

        manageSaleModalTitle.textContent = `Gestionar Venta: ${product.Producto}`;

        const plans = [
            { months: 3, interest: 0.50, name: 'Plan 3 Cuotas' },
            { months: 6, interest: 1.00, name: 'Plan 6 Cuotas' },
            { months: 9, interest: 1.50, name: 'Plan 9 Cuotas' },
            { months: 12, interest: 2.00, name: 'Plan Exclusivo' }
        ];

        let planOptionsHtml = '<option value="">Contado</option>';
        plans.forEach(plan => {
            planOptionsHtml += `<option value="${plan.name}" ${product.plan_pago_elegido === plan.name ? 'selected' : ''}>${plan.name}</option>`;
        });

        const startDateValue = product.fecha_inicio_pago
            ? product.fecha_inicio_pago.substring(0, 10)
            : new Date().toISOString().split('T')[0];

        manageSaleModalBody.innerHTML = `
            <div class="mb-3">
                <label for="sale-start-date" class="form-label">Fecha de Inicio de Pago</label>
                <input type="date" class="form-control" id="sale-start-date" value="${startDateValue}">
            </div>
            <div class="mb-3">
                <label for="sale-plan-select" class="form-label">Plan de Pago Elegido</label>
                <select class="form-select" id="sale-plan-select">
                    ${planOptionsHtml}
                </select>
            </div>
            <div id="installments-tracker"></div>
        `;

        const planSelect = document.getElementById('sale-plan-select');
        const trackerDiv = document.getElementById('installments-tracker');
        const startDateInput = document.getElementById('sale-start-date');

        function renderInstallmentTracker(currentPlanSelect, currentTrackerDiv, currentStartDateInput) {
            const selectedPlanName = currentPlanSelect.value;
            const selectedPlan = plans.find(p => p.name === selectedPlanName);
            
            if (!selectedPlan) { // Contado
                currentTrackerDiv.innerHTML = '';
                return;
            }

            let trackerHtml = `<h5>Seguimiento de Cuotas (${selectedPlan.months} cuotas)</h5>`;
            const startDate = new Date(currentStartDateInput.value + 'T00:00:00'); // Ensure date is parsed correctly

            for (let i = 1; i <= selectedPlan.months; i++) {
                const isPaid = i <= (product.cuotas_pagadas || 0);
                const dueDate = new Date(startDate);
                dueDate.setMonth(startDate.getMonth() + i);
                const formattedDueDate = dueDate.toLocaleDateString('es-AR');

                trackerHtml += `
                    <div class="form-check">
                        <input class="form-check-input installment-checkbox" type="checkbox" value="${i}" id="inst-${i}" ${isPaid ? 'checked' : ''}>
                        <label class="form-check-label" for="inst-${i}">
                            Cuota ${i} (Vence: ${formattedDueDate})
                        </label>
                    </div>
                `;
            }
            currentTrackerDiv.innerHTML = trackerHtml;
        }

        planSelect.addEventListener('change', () => renderInstallmentTracker(planSelect, trackerDiv, startDateInput));
        startDateInput.addEventListener('change', () => renderInstallmentTracker(planSelect, trackerDiv, startDateInput));
        renderInstallmentTracker(planSelect, trackerDiv, startDateInput); // Initial render
        manageSaleModal.show();
    }

    document.getElementById('save-sale-changes').addEventListener('click', async () => {
        if (!currentManagingSaleId) return;

        const plan_pago_elegido = document.getElementById('sale-plan-select').value;
        const esVentaContado = plan_pago_elegido === "";

        let response;
        try {
            if (esVentaContado) {
                // Marcar como vendido
                response = await fetch(`/products/${currentManagingSaleId}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ en_venta: false })
                });
            } else {
                // Actualizar datos de la venta a plazos
                const paidInstallmentsCheckboxes = document.querySelectorAll('.installment-checkbox:checked');
                const cuotas_pagadas = paidInstallmentsCheckboxes.length;
                
                const product = products.find(p => p.id === currentManagingSaleId);
                const plans = [
                    { months: 3, interest: 0.50, name: 'Plan 3 Cuotas' },
                    { months: 6, interest: 1.00, name: 'Plan 6 Cuotas' },
                    { months: 9, interest: 1.50, name: 'Plan 9 Cuotas' },
                    { months: 12, interest: 2.00, name: 'Plan Exclusivo' }
                ];
                const selectedPlan = plans.find(p => p.name === plan_pago_elegido);
                const priceContado = parseFloat(product['Precio al CONTADO']);
                const finalPrice = priceContado * (1 + selectedPlan.interest);
                const installmentValue = finalPrice / selectedPlan.months;
                const valor_cuota_ars = installmentValue * usdToArsRate;

                const saleData = {
                    plan_pago_elegido,
                    cuotas_pagadas,
                    fecha_inicio_pago: document.getElementById('sale-start-date').value,
                    valor_cuota_ars
                };

                response = await fetch(`/products/${currentManagingSaleId}/sale`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(saleData)
                });
            }

            if (response.ok) {
                manageSaleModal.hide();

                // Mostrar alerta de éxito solo para planes a plazos
                if (!esVentaContado) {
                    const product = products.find(p => p.id === currentManagingSaleId);
                    const plans = [
                        { months: 3, interest: 0.50, name: 'Plan 3 Cuotas' },
                        { months: 6, interest: 1.00, name: 'Plan 6 Cuotas' },
                        { months: 9, interest: 1.50, name: 'Plan 9 Cuotas' },
                        { months: 12, interest: 2.00, name: 'Plan Exclusivo' }
                    ];
                    const selectedPlan = plans.find(p => p.name === plan_pago_elegido);
                    const priceContado = parseFloat(product['Precio al CONTADO']);

                    if (product && selectedPlan && !isNaN(priceContado)) {
                        const finalPrice = priceContado * (1 + selectedPlan.interest);
                        const installmentValue = finalPrice / selectedPlan.months;
                        const installmentValueArs = installmentValue * usdToArsRate;

                        alert(
`¡Plan de pago guardado con éxito!\n\nProducto: ${product.Producto}\nPlan: ${selectedPlan.name}\n---------------------------------\nValor de cada cuota:\n${installmentValueArs.toFixed(2)} ARS\n${installmentValue.toFixed(2)} USD`
                        );
                    }
                }
                
                loadProducts(); // Recargar productos después de la alerta
            } else {
                const errorData = await response.json();
                alert('Error al guardar los cambios: ' + errorData.error);
            }
        } catch (error) {
            console.error('Error de red al guardar los cambios:', error);
            alert('Error de red al guardar los cambios.');
        }
    });

    // --- THEME TOGGLE ---
    const currentTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-bs-theme', currentTheme);
    updateThemeIcon(currentTheme);

    function updateThemeIcon(theme) {
        const icon = theme === 'dark' ? 'fa-sun' : 'fa-moon';
        themeToggle.querySelector('i').className = `fas ${icon}`;
    }

    themeToggle.addEventListener('click', () => {
        let newTheme = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-bs-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
    });

    // --- CLOCK ---
    function updateClock() {
        const clockContainer = document.getElementById('clock-container');
        if (clockContainer) {
            const now = new Date();
            const options = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
            const timeString = now.toLocaleTimeString('es-AR', options);
            clockContainer.textContent = timeString;
        }
    }

    setInterval(updateClock, 1000);
    updateClock(); // Initial call
});