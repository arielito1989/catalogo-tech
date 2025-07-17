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
    const statusFilter = document.getElementById('status-filter');
    const tableHeaders = document.querySelectorAll('th.sortable');
    const paginationControls = document.getElementById('pagination-controls');
    const themeToggle = document.getElementById('theme-toggle');

    // Toast Elements
    const toastLiveExample = document.getElementById('liveToast');
    const toastBootstrap = bootstrap.Toast.getOrCreateInstance(toastLiveExample);
    const toastBody = toastLiveExample.querySelector('.toast-body');
    const toastHeader = toastLiveExample.querySelector('.toast-header');

    const loadingOverlay = document.getElementById('loading-overlay');

    // --- Utility Functions ---
    function showLoader() {
        loadingOverlay.classList.add('show');
    }

    function hideLoader() {
        loadingOverlay.classList.remove('show');
    }

    function showToast(message, type = 'success') {
        toastHeader.querySelector('strong').textContent = type === 'success' ? 'Éxito' : 'Error';
        toastBody.textContent = message;

        // Reset classes
        toastLiveExample.className = 'toast'; 
        toastHeader.className = 'toast-header';

        const bgClass = type === 'success' ? 'text-bg-success' : 'text-bg-danger';
        toastLiveExample.classList.add(bgClass);
        
        toastBootstrap.show();
    }

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
    function updateFilterCounts() {
        const categoryCounts = {};
        const statusCounts = { disponible: 0, en_plan: 0, vendido: 0 };

        products.forEach(p => {
            // Count categories
            categoryCounts[p.CATEGORIA] = (categoryCounts[p.CATEGORIA] || 0) + 1;

            // Count statuses
            if (!p.en_venta) {
                statusCounts.vendido++;
            } else if (p.plan_pago_elegido) {
                statusCounts.en_plan++;
            } else {
                statusCounts.disponible++;
            }
        });

        // Update category filter dynamically
        const selectedCategory = categoryFilter.value;
        categoryFilter.innerHTML = '<option value="Todas las categorías">Todas las categorías</option>'; // Reset
        Object.keys(categoryCounts).sort().forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = `${cat} (${categoryCounts[cat]})`;
            categoryFilter.appendChild(option);
        });
        categoryFilter.value = selectedCategory; // Restore selection

        // Update status filter counts
        statusFilter.querySelector('option[value="disponible"]').textContent = `Disponible (${statusCounts.disponible})`;
        statusFilter.querySelector('option[value="en_plan"]').textContent = `En Plan de Pago (${statusCounts.en_plan})`;
        statusFilter.querySelector('option[value="vendido"]').textContent = `Vendido (${statusCounts.vendido})`;
    }

    async function loadProducts(productIdToPrioritize = null) {
        showLoader();
        try {
            const response = await fetch('/products');
            if (!response.ok) throw new Error('Failed to fetch products');
            products = await response.json();

            updateFilterCounts(); // Update counts after fetching
            applyFiltersAndSort(productIdToPrioritize); // Pass the ID to prioritize
        } catch (error) {
            console.error('Error loading products:', error);
            showToast('No se pudieron cargar los productos.', 'danger');
        } finally {
            hideLoader();
        }
    }

    

    function applyFiltersAndSort(productIdToPrioritize = null) {
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

        // Apply status filter
        const selectedStatus = statusFilter.value;
        if (selectedStatus !== 'Todos') {
            tempProducts = tempProducts.filter(p => {
                const isSold = !p.en_venta;
                const isInPlan = p.en_venta && p.plan_pago_elegido;
                const isAvailable = p.en_venta && !p.plan_pago_elegido;

                if (selectedStatus === 'disponible') return isAvailable;
                if (selectedStatus === 'en_plan') return isInPlan;
                if (selectedStatus === 'vendido') return isSold;
                return false;
            });
        }

        // Prioritize the product if no specific sort column is selected by the user
        if (productIdToPrioritize && !currentSort.column) {
            const index = tempProducts.findIndex(p => p.id === productIdToPrioritize);
            if (index > -1) {
                const [prioritizedProduct] = tempProducts.splice(index, 1);
                tempProducts.unshift(prioritizedProduct);
            }
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
        } else if (!productIdToPrioritize) { // Only apply default sort if no product is being prioritized
            // Default sort: newest products first (by ID, which is timestamp-based)
            tempProducts.sort((a, b) => {
                const idA = parseInt(a.id.replace('prod-', ''));
                const idB = parseInt(b.id.replace('prod-', ''));
                return idB - idA; // Descending order
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
                const displayRate = product.exchange_rate_at_creation || usdToArsRate;
                const priceArsValue = Math.floor((parseFloat(product['Precio al CONTADO']) * displayRate) * 100) / 100;
                const priceArs = priceArsValue.toFixed(2);
                const row = document.createElement('tr');

                // Determine product status and apply classes/badges
                let statusHtml = '';
                let rowClass = '';
                if (!product.en_venta) {
                    rowClass = 'product-sold';
                    statusHtml = `<span class="badge bg-danger">Vendido</span>`;
                } else if (product.plan_pago_elegido) {
                    rowClass = 'product-in-plan';
                    statusHtml = `<span class="badge bg-warning text-dark">En Plan de Pago</span>`;
                } else {
                    rowClass = 'product-available';
                    statusHtml = `<span class="badge bg-success">Disponible</span>`;
                }
                row.classList.add(rowClass);

                const imageUrl = product.Imagenes && product.Imagenes.length > 0 ? product.Imagenes[0] : '/images/placeholder.png';

                // Build contextual actions
                let actionsHtml = '';
                if (!product.en_venta) {
                    // --- SOLD --- 
                    actionsHtml = `
                        <button class="btn btn-sm btn-light view-details" data-id="${product.id}" title="Ver Detalles"><i class="fas fa-eye"></i></button>
                        <button class="btn btn-sm btn-primary view-payment-summary" data-id="${product.id}" title="Ver Resumen de Venta"><i class="fas fa-receipt"></i></button>
                        <button class="btn btn-sm btn-danger delete-product" data-id="${product.id}" title="Eliminar"><i class="fas fa-trash"></i></button>
                    `;
                } else if (product.plan_pago_elegido) {
                    // --- IN PAYMENT PLAN ---
                    actionsHtml = `
                        <button class="btn btn-sm btn-light view-details" data-id="${product.id}" title="Ver Detalles"><i class="fas fa-eye"></i></button>
                        <button class="btn btn-sm btn-info manage-sale" data-id="${product.id}" title="Gestionar Plan"><i class="fas fa-tasks"></i></button>
                        <button class="btn btn-sm btn-primary view-payment-summary" data-id="${product.id}" title="Ver Resumen de Pago"><i class="fas fa-money-check-alt"></i></button>
                        <button class="btn btn-sm btn-danger delete-product" data-id="${product.id}" title="Eliminar"><i class="fas fa-trash"></i></button>
                    `;
                } else {
                    // --- AVAILABLE ---
                    actionsHtml = `
                        <button class="btn btn-sm btn-light view-details" data-id="${product.id}" title="Ver Detalles"><i class="fas fa-eye"></i></button>
                        <button class="btn btn-sm btn-info view-plan" data-id="${product.id}" title="Ver Planes de Pago"><i class="fas fa-credit-card"></i></button>
                        <button class="btn btn-sm btn-success manage-sale" data-id="${product.id}" title="Vender / Iniciar Plan"><i class="fas fa-hand-holding-usd"></i></button>
                        <button class="btn btn-sm btn-warning edit-product" data-id="${product.id}" title="Editar"><i class="fas fa-pencil-alt"></i></button>
                        <button class="btn btn-sm btn-danger delete-product" data-id="${product.id}" title="Eliminar"><i class="fas fa-trash"></i></button>
                    `;
                }

                row.innerHTML = `
                    <td data-label="Imagen"><img src="${imageUrl}" alt="${product.Producto}" class="img-thumbnail"></td>
                    <td data-label="Producto" class="product-name">${product.Producto || ''}</td>
                    <td data-label="Categoría">${product.CATEGORIA || ''}</td>
                    <td data-label="Estado">${statusHtml}</td>
                    <td data-label="Precio (ARS)">${priceArs}</td>
                    <td data-label="Acciones">
                        <div class="d-flex flex-wrap justify-content-end">
                            ${actionsHtml}
                        </div>
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
    let preciseContadoUSD = null; // Holds high-precision USD value to prevent rounding errors

    function updatePrices(source) {
        // Helper to truncate to 2 decimal places without rounding up, preventing issues like .01 artifacts.
        const truncate = (num) => {
            if (isNaN(num)) return '';
            // Multiplying and dividing by 100 handles floating point inaccuracies.
            return Math.floor(num * 100) / 100;
        };

        // When user types in USD field, they set the source of truth. Clear any high-precision temp value.
        if (source === 'contado') {
            preciseContadoUSD = null; 
            const contadoUSD = parseFloat(priceContadoInput.value);
            if (!isNaN(contadoUSD)) {
                priceArsInput.value = truncate(contadoUSD * usdToArsRate);
                pricePyInput.value = truncate(contadoUSD / 2);
            } else {
                priceArsInput.value = '';
                pricePyInput.value = '';
            }
        } else if (source === 'ars') {
            const ars = parseFloat(priceArsInput.value);
            if (!isNaN(ars) && usdToArsRate > 0) {
                const calculatedUsd = ars / usdToArsRate;
                // Store the high-precision value
                preciseContadoUSD = calculatedUsd; 
                // Display the truncated value
                priceContadoInput.value = truncate(calculatedUsd);
                pricePyInput.value = truncate(calculatedUsd / 2);
            } else {
                priceContadoInput.value = '';
                pricePyInput.value = '';
                preciseContadoUSD = null;
            }
        } else if (source === 'py') {
            const py = parseFloat(pricePyInput.value);
            if (!isNaN(py)) {
                const calculatedUsd = py * 2;
                // Store the high-precision value
                preciseContadoUSD = calculatedUsd;
                // Display the truncated value
                priceContadoInput.value = truncate(calculatedUsd);
                priceArsInput.value = truncate(calculatedUsd * usdToArsRate);
            } else {
                priceContadoInput.value = '';
                priceArsInput.value = '';
                preciseContadoUSD = null;
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
    statusFilter.addEventListener('change', applyFiltersAndSort);

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
        preciseContadoUSD = null; // Reset high-precision value
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
            // Use the high-precision value if it exists, otherwise use the (potentially rounded) input value.
            "Precio al CONTADO": preciseContadoUSD !== null ? preciseContadoUSD : (parseFloat(document.getElementById('productPriceContado').value) || 0),
            "Precio PY": parseFloat(document.getElementById('productPricePY').value) || 0,
            // en_venta will be handled by the server on creation
            exchange_rate_at_creation: usdToArsRate // Add the current exchange rate
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

            showLoader();
            try {
                const response = await fetch(url, {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(productDataToSend)
                });

                if (response.ok) {
                    currentSort = { column: null, direction: 'asc' }; // Reset sort to show newest first
                    const productId = currentlyEditingId || productDataToSend.id; // Get the ID of the affected product
                    await loadProducts(productId); // Pass the ID to prioritize
                    addProductModal.hide();
                    showToast(`Producto ${currentlyEditingId ? 'actualizado' : 'guardado'} con éxito.`);
                } else {
                    const errorData = await response.json();
                    console.error('Error saving product:', errorData.error);
                    showToast(`Error al guardar: ${errorData.error}`, 'danger');
                }
            } catch (error) {
                console.error('Network error saving product:', error);
                showToast('Error de red al guardar el producto.', 'danger');
            } finally {
                hideLoader();
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
        } else if (button.classList.contains('view-payment-summary')) {
            showPaymentSummary(productId);
        }
    });

    catalogTableBody.addEventListener('change', async (e) => {
        if (e.target.classList.contains('toggle-en-venta')) {
            const productId = e.target.dataset.id;
            const en_venta = e.target.checked;

            showLoader();
            try {
                const response = await fetch(`/products/${productId}/status`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ en_venta })
                });

                if (response.ok) {
                    currentSort = { column: null, direction: 'asc' }; // Reset sort to show newest first
                    await loadProducts(productId); // Pass the ID to prioritize
                    showToast('Estado del producto actualizado.');
                    showToast('Estado del producto actualizado.');
                } else {
                    const errorData = await response.json();
                    console.error('Error updating product status:', errorData.error);
                    showToast(`Error al actualizar: ${errorData.error}`, 'danger');
                    e.target.checked = !en_venta; // Revertir el switch si hay error
                }
            } catch (error) {
                console.error('Network error updating product status:', error);
                showToast('Error de red al actualizar el estado.', 'danger');
                e.target.checked = !en_venta; // Revertir el switch si hay error
            } finally {
                hideLoader();
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
        
        // Calculate and set ARS price using the stored rate if available
        const displayRate = product.exchange_rate_at_creation || usdToArsRate;
        if (!isNaN(priceContado)) {
            const priceArsValue = Math.floor((priceContado * displayRate) * 100) / 100;
            document.getElementById('productPriceArs').value = priceArsValue.toFixed(2);
        } else {
            document.getElementById('productPriceArs').value = '';
        }

        // Clear the file input for security reasons
        document.getElementById('productImages').value = '';

        addProductModal.show();
    }

        let productIdToDelete = null; // Variable to store the ID of the product to be deleted

    async function handleDelete(productId) {
        productIdToDelete = productId; // Store the ID
        const deleteConfirmModal = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
        deleteConfirmModal.show();
    }

    document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
        if (!productIdToDelete) return; // Should not happen

        const deleteConfirmModal = bootstrap.Modal.getInstance(document.getElementById('deleteConfirmModal'));
        deleteConfirmModal.hide();

        showLoader();
        try {
            const response = await fetch(`/products/${productIdToDelete}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                currentSort = { column: null, direction: 'asc' }; // Reset sort to show newest first
                await loadProducts(productIdToDelete); // Pass the ID to prioritize
                showToast('Producto eliminado con éxito.');
            } else {
                const errorData = await response.json();
                console.error('Error deleting product:', errorData.error);
                showToast(`Error al eliminar: ${errorData.error}`, 'danger');
            }
        } catch (error) {
            console.error('Network error deleting product:', error);
            showToast('Error de red al eliminar el producto.', 'danger');
        } finally {
            hideLoader();
            productIdToDelete = null; // Clear the stored ID
        }
    });

    // --- MODAL CONTENT FUNCTIONS ---
    function showDetails(product) {
        detailsModalTitle.textContent = `Detalles de: ${product.Producto}`;
        const priceContadoUSD = parseFloat(product['Precio al CONTADO']);
        const pricePyUSD = parseFloat(product['Precio PY']);
        const displayRate = product.exchange_rate_at_creation || usdToArsRate;
        const priceArs = (Math.floor((priceContadoUSD * displayRate) * 100) / 100).toFixed(2);

        let imagesHtml = '';
        if (product.Imagenes && product.Imagenes.length > 0) {
            const totalImages = product.Imagenes.length;
            imagesHtml = `
                <div id="productDetailCarousel" class="carousel slide mb-4" data-bs-ride="carousel">
                    <div class="carousel-inner">
            `;
            product.Imagenes.forEach((imgSrc, index) => {
                imagesHtml += `
                        <div class="carousel-item ${index === 0 ? 'active' : ''}">
                            ${totalImages > 1 ? `<div class="image-counter">${index + 1} / ${totalImages}</div>` : ''}
                            <img src="${imgSrc}" class="d-block w-100" alt="${product.Producto} - Imagen ${index + 1}" style="max-height: 400px; object-fit: contain;">
                        </div>
                `;
            });
            imagesHtml += `
                    </div>
                    ${totalImages > 1 ? `
                    <button class="carousel-control-prev" type="button" data-bs-target="#productDetailCarousel" data-bs-slide="prev">
                        <span class="carousel-control-prev-icon" aria-hidden="true"></span>
                        <span class="visually-hidden">Previous</span>
                    </button>
                    <button class="carousel-control-next" type="button" data-bs-target="#productDetailCarousel" data-bs-slide="next">
                        <span class="carousel-control-next-icon" aria-hidden="true"></span>
                        <span class="visually-hidden">Next</span>
                    </button>
                    ` : ''}
                </div>
            `;
        } else {
            imagesHtml = `<div class="text-center mb-4"><img src="/images/placeholder.png" alt="${product.Producto}" class="img-fluid rounded" style="max-height: 250px;"></div>`;
        }

        detailsModalBody.innerHTML = `
            ${imagesHtml}
            <h5 class="border-bottom pb-2 mb-3">Información del Producto</h5>
            <p><strong>Categoría:</strong> ${product.CATEGORIA}</p>
            
            <h5 class="border-bottom pb-2 mt-4 mb-3">Precios</h5>
            <ul class="list-group list-group-flush">
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    Precio Contado (ARS)
                    <span class="badge bg-primary rounded-pill fs-6">$ ${priceArs}</span>
                </li>
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    Precio Contado (USD)
                    <span class="badge bg-secondary rounded-pill">$ ${priceContadoUSD.toFixed(2)}</span>
                </li>
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    Precio PY (USD)
                    <span class="badge bg-secondary rounded-pill">$ ${pricePyUSD.toFixed(2)}</span>
                </li>
            </ul>
        `;
        detailsModal.show();
    }

    function showPaymentPlan(product) {
        detailsModalTitle.textContent = `Planes de Pago: ${product.Producto}`;
        detailsModalBody.innerHTML = getPaymentPlanHtml(product);
        detailsModal.show();
    }

    function showPaymentSummary(productId) {
        const product = products.find(p => p.id === productId);
        if (!product) return;

        const plans = [
            { months: 3, interest: 0.50, name: 'Plan 3 Cuotas' },
            { months: 6, interest: 1.00, name: 'Plan 6 Cuotas' },
            { months: 9, interest: 1.50, name: 'Plan 9 Cuotas' },
            { months: 12, interest: 2.00, name: 'Plan Exclusivo' }
        ];

        // Helper to set toast style
        const setToastStyle = (contextClass) => {
            toastHeader.querySelector('small').textContent = 'Ahora';
            toastLiveExample.className = 'toast'; // Reset classes
            toastHeader.className = 'toast-header'; // Reset classes
            toastLiveExample.classList.add('text-bg-' + contextClass);
        };

        const priceContado = parseFloat(product['Precio al CONTADO']);
        const exchangeRate = product.exchange_rate_at_sale || usdToArsRate;

        // --- Case 2: Product has an active PAYMENT PLAN ---
        const selectedPlan = plans.find(p => p.name === product.plan_pago_elegido);
        if (product.plan_pago_elegido && selectedPlan) {
            const finalPrice = priceContado * (1 + selectedPlan.interest);
            const installmentValue = finalPrice / selectedPlan.months;
            const installmentValueArs = Math.floor((installmentValue * exchangeRate) * 100) / 100;

            const pagosRealizados = product.pagos_realizados || [];
            const cuotasPagadasCount = pagosRealizados.length;
            const cuotasRestantes = selectedPlan.months - cuotasPagadasCount;

            const montoTotalAbonadoArs = (cuotasPagadasCount * installmentValueArs).toFixed(2);
            const montoRestanteTotalArs = (cuotasRestantes * installmentValueArs).toFixed(2);

            setToastStyle('success');
            toastBody.innerHTML = `
                <div class='container-fluid'>
                    <div class='row mb-2'>
                        <div class='col'>
                            <strong>Resumen: ${product.Producto}</strong><br>
                            <small>${selectedPlan.name}</small>
                        </div>
                    </div>
                    <hr class='my-1'>
                    <div class='d-flex justify-content-between'><span>Cuotas Pagadas:</span> <span class='fw-bold'>${cuotasPagadasCount} de ${selectedPlan.months}</span></div>
                    <div class='d-flex justify-content-between'><span>Cuotas Restantes:</span> <span class='fw-bold'>${cuotasRestantes}</span></div>
                    <hr class='my-1'>
                    <div class='d-flex justify-content-between'><span>Monto Abonado:</span> <span class='fw-bold text-light'>${montoTotalAbonadoArs} ARS</span></div>
                    <div class='d-flex justify-content-between'><span>Monto Restante:</span> <span class='fw-bold text-warning'>${montoRestanteTotalArs} ARS</span></div>
                    <hr class='my-1'>
                    <div class='d-flex justify-content-between align-items-center'>
                        <span>Valor Cuota:</span>
                        <span class='fw-bold fs-5'>${installmentValueArs.toFixed(2)} ARS</span>
                    </div>
                </div>`;
            toastBootstrap.show();
            return;
        }

        // --- Case 3: No payment plan associated ---
        setToastStyle('danger');
        toastBody.innerHTML = `El producto ${product.Producto} no tiene un plan de pago asociado.`;
        toastBootstrap.show();
    }

    function getPaymentPlanHtml(product) {
        const priceContado = parseFloat(product['Precio al CONTADO']);
        if (isNaN(priceContado)) return '<p class="text-danger">El precio del producto no es válido.</p>';

        const displayRate = product.exchange_rate_at_creation || usdToArsRate;
        const priceContadoArs = Math.floor((priceContado * displayRate) * 100) / 100;

        const plans = [
            { months: 3, interest: 0.50, name: 'Plan 3 Cuotas' },
            { months: 6, interest: 1.00, name: 'Plan 6 Cuotas' },
            { months: 9, interest: 1.50, name: 'Plan 9 Cuotas' },
            { months: 12, interest: 2.00, name: 'Plan Exclusivo' }
        ];

        let tableHtml = `
            <h5>Planes de Financiación</h5>
            <p>Precio Contado: <strong>${priceContado.toFixed(2)} USD / ${priceContadoArs.toFixed(2)} ARS</strong></p>
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
            const finalPriceArs = Math.floor((finalPrice * displayRate) * 100) / 100;
            const installmentValueArs = Math.floor((installmentValue * displayRate) * 100) / 100;

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
            const product = products.find(p => p.id === currentManagingSaleId); // Get the current product

            if (!selectedPlan) { // Contado
                currentTrackerDiv.innerHTML = '';
                return;
            }

            const priceContado = parseFloat(product['Precio al CONTADO']);
            if (isNaN(priceContado)) {
                currentTrackerDiv.innerHTML = '<p class="text-danger">El precio del producto no es válido para calcular el plan.</p>';
                return;
            }

            const exchangeRate = product.exchange_rate_at_sale || usdToArsRate;
            const finalPrice = priceContado * (1 + selectedPlan.interest);
            const installmentValue = finalPrice / selectedPlan.months;
            const installmentValueArs = (Math.floor((installmentValue * exchangeRate) * 100) / 100).toFixed(2);
            const finalPriceArs = (Math.floor((finalPrice * exchangeRate) * 100) / 100).toFixed(2);

            let trackerHtml = `
                <h5>Seguimiento de Cuotas (${selectedPlan.months} cuotas)</h5>
                <p>Valor por cuota: <strong>${installmentValueArs} ARS</strong></p>
                <p>Total del plan: <strong class="text-success">${finalPriceArs} ARS</strong></p>
                <hr>
            `;
            const startDate = new Date(currentStartDateInput.value + 'T00:00:00'); // Ensure date is parsed correctly

            // Ensure product.pagos_realizados is an array
            const pagosRealizados = product.pagos_realizados || [];
            // Sort pagosRealizados by installment_number to easily find the last paid one
            pagosRealizados.sort((a, b) => a.installment_number - b.installment_number);
            const lastPaidInstallment = pagosRealizados.length > 0 ? pagosRealizados[pagosRealizados.length - 1].installment_number : 0;
            const nextInstallmentToPay = lastPaidInstallment + 1;

            for (let i = 1; i <= selectedPlan.months; i++) {
                const dueDate = new Date(startDate);
                // Calculate fixed due date for each installment
                // For monthly plans, add 'i' months. For bi-weekly, add 'i * 15' days. For weekly, add 'i * 7' days.
                if (selectedPlan.name.includes('Cuotas')) { // Monthly plans (3, 6, 9, 12 Cuotas)
                    dueDate.setMonth(startDate.getMonth() + i);
                } else if (selectedPlan.name === 'quincenal') { // Assuming a bi-weekly plan might exist
                    dueDate.setDate(startDate.getDate() + (i * 15));
                } else if (selectedPlan.name === 'semanal') { // Assuming a weekly plan might exist
                    dueDate.setDate(startDate.getDate() + (i * 7));
                }

                const formattedDueDate = dueDate.toLocaleDateString('es-AR');

                // Find if this installment has been paid
                const paidRecord = pagosRealizados.find(p => p.installment_number === i);
                const paymentDateValue = paidRecord ? paidRecord.payment_date : '';

                // Determine if the checkbox should be disabled
                const isDisabled = paidRecord || (i !== nextInstallmentToPay);
                const isChecked = paidRecord ? 'checked' : '';
                const dateInputDisabled = !paidRecord ? 'disabled' : '';

                trackerHtml += `
                    <div class="mb-3 border p-2 rounded">
                        <div class="form-check">
                            <input class="form-check-input installment-paid-checkbox" type="checkbox" value="${i}" id="inst-paid-${i}" ${isChecked} ${isDisabled ? 'disabled' : ''}>
                            <label class="form-check-label" for="inst-paid-${i}">
                                Cuota ${i} (Vence: ${formattedDueDate})
                            </label>
                        </div>
                        <div class="mt-2">
                            <label for="inst-payment-date-${i}" class="form-label">Fecha de Pago Real:</label>
                            <input type="date" class="form-control installment-payment-date" id="inst-payment-date-${i}" data-installment-number="${i}" value="${paymentDateValue}" ${dateInputDisabled}>
                        </div>
                    </div>
                `;
            }
            currentTrackerDiv.innerHTML = trackerHtml;

            // Add event listeners for checkboxes to enable/disable date inputs
            currentTrackerDiv.querySelectorAll('.installment-paid-checkbox').forEach(checkbox => {
                checkbox.addEventListener('change', (event) => {
                    const installmentNumber = parseInt(event.target.value);
                    const dateInput = currentTrackerDiv.querySelector(`#inst-payment-date-${installmentNumber}`);
                    if (event.target.checked) {
                        dateInput.disabled = false;
                        if (!dateInput.value) { // If no date is set, pre-fill with today's date
                            dateInput.value = new Date().toISOString().split('T')[0];
                        }
                    } else {
                        dateInput.disabled = true;
                        dateInput.value = ''; // Clear date if unchecked
                    }
                });
            });
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

        const paidInstallments = [];
        document.querySelectorAll('.installment-paid-checkbox:checked').forEach(checkbox => {
            const installmentNumber = parseInt(checkbox.value);
            const paymentDateInput = document.getElementById(`inst-payment-date-${installmentNumber}`);
            if (paymentDateInput && paymentDateInput.value) {
                paidInstallments.push({
                    installment_number: installmentNumber,
                    payment_date: paymentDateInput.value
                });
            }
        });

        let response;
        showLoader();
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
                const saleData = {
                    plan_pago_elegido,
                    fecha_inicio_pago: document.getElementById('sale-start-date').value,
                    pagos_realizados: paidInstallments,
                    exchange_rate_at_sale: usdToArsRate // Freeze the exchange rate
                };

                response = await fetch(`/products/${currentManagingSaleId}/sale`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(saleData)
                });
            }

            if (response.ok) {
                manageSaleModal.hide();
                currentSort = { column: null, direction: 'asc' }; // Reset sort to show newest first
                await loadProducts(currentManagingSaleId); // Pass the ID to prioritize
                showToast('Cambios en la venta guardados con éxito.');
            } else {
                const errorData = await response.json();
                showToast(`Error al guardar los cambios: ${errorData.error}`, 'danger');
            }
        } catch (error) {
            console.error('Error de red al guardar los cambios:', error);
            showToast('Error de red al guardar los cambios.', 'danger');
        } finally {
            hideLoader();
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