require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const fetch = require('node-fetch');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

const initializeDatabase = async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
        // Step 1: Ensure the table exists with its original columns
        await client.query(`
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                producto TEXT,
                categoria TEXT,
                "Precio PY" REAL,
                "Precio al CONTADO" REAL,
                imagenes TEXT,
                en_venta BOOLEAN NOT NULL DEFAULT TRUE
            );
        `);

        // Step 2: Add new columns if they don't exist (simple migration)
        const columns = [
            { name: 'plan_pago_elegido', type: 'TEXT' },
            { name: 'cuotas_pagadas', type: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'fecha_inicio_pago', type: 'DATE' },
            { name: 'valor_cuota_ars', type: 'REAL' },
            { name: 'pagos_realizados', type: 'TEXT' },
            { name: 'exchange_rate_at_sale', type: 'REAL' },
            { name: 'exchange_rate_at_creation', type: 'REAL' } // Tasa de cambio al momento de crear/editar
        ];

        for (const col of columns) {
            const checkCol = await client.query(
                "SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = $1",
                [col.name]
            );
            if (checkCol.rowCount === 0) {
                await client.query(`ALTER TABLE products ADD COLUMN ${col.name} ${col.type}`);
                console.log(`Column ${col.name} added to products table.`);
            }
        }
    } catch (err) {
        console.error('Error during database initialization/migration:', err);
    } finally {
        client.release();
    }
};

initializeDatabase();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));

const mapProductForClient = (row) => {
    if (!row) return null;
    let imagenes = [];
    if (row.imagenes) {
        try {
            const parsed = JSON.parse(row.imagenes);
            if (Array.isArray(parsed)) {
                imagenes = parsed;
            }
        } catch (e) {
            console.error(`Error parsing Imagenes JSON for product id ${row.id}:`, row.imagenes);
        }
    }

    let pagosRealizados = [];
    if (row.pagos_realizados) {
        try {
            const parsed = JSON.parse(row.pagos_realizados);
            if (Array.isArray(parsed)) {
                pagosRealizados = parsed;
            }
        } catch (e) {
            console.error(`Error parsing pagos_realizados JSON for product id ${row.id}:`, row.pagos_realizados);
        }
    }
    return {
        id: row.id,
        Producto: row.producto,
        CATEGORIA: row.categoria,
        'Precio PY': row['Precio PY'],
        'Precio al CONTADO': row['Precio al CONTADO'],
        Imagenes: imagenes,
        en_venta: row.en_venta,
        plan_pago_elegido: row.plan_pago_elegido,
        cuotas_pagadas: row.cuotas_pagadas,
        fecha_inicio_pago: row.fecha_inicio_pago,
        valor_cuota_ars: row.valor_cuota_ars,
        pagos_realizados: pagosRealizados,
        exchange_rate_at_sale: row.exchange_rate_at_sale,
        exchange_rate_at_creation: row.exchange_rate_at_creation // Incluir el nuevo campo
    };
};

app.get('/api/exchange-rate', async (req, res) => {
    try {
        const apiKey = process.env.EXGENERATE_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Server configuration error: API key not set.' });
        }
        const url = `https://v6.exchangerate-api.com/v6/${apiKey}/pair/USD/ARS`;
        const apiResponse = await fetch(url);
        const data = await apiResponse.json();
        if (data.result === 'error') {
            return res.status(400).json({ error: `Exchange rate API error: ${data['error-type']}` });
        }
        res.json({ rates: { ARS: data.conversion_rate } });
    } catch (error) {
        console.error('Unexpected error in /api/exchange-rate:', error);
        res.status(500).json({ error: 'Internal server error while fetching exchange rate.' });
    }
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminUsername || !adminPassword) {
        return res.status(500).json({ success: false, message: 'Internal server configuration error.' });
    }

    if (username === adminUsername && password === adminPassword) {
        res.status(200).json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.get('/products', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT * FROM products ORDER BY producto ASC');
        client.release();
        const products = result.rows.map(mapProductForClient);
        res.json(products);
    } catch (err) {
        console.error('Error getting products:', err);
        res.status(500).json({ error: 'Error fetching products from database.' });
    }
});

app.post('/products', async (req, res) => {
    const { id, Producto, CATEGORIA, "Precio PY": PrecioPY, "Precio al CONTADO": PrecioContado, Imagenes, exchange_rate_at_creation } = req.body;
    const query = 'INSERT INTO products (id, producto, categoria, "Precio PY", "Precio al CONTADO", imagenes, en_venta, exchange_rate_at_creation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *';
    const values = [id, Producto, CATEGORIA, PrecioPY, PrecioContado, JSON.stringify(Imagenes || []), true, exchange_rate_at_creation];
    try {
        const client = await pool.connect();
        const result = await client.query(query, values);
        client.release();
        const newProduct = mapProductForClient(result.rows[0]);
        res.status(201).json({ message: 'Product added', product: newProduct });
    } catch (err) {
        console.error('Error adding product:', err);
        res.status(500).json({ error: 'Error adding product to database.' });
    }
});

app.put('/products/:id', async (req, res) => {
    const { id } = req.params;
    const { Producto, CATEGORIA, "Precio PY": PrecioPY, "Precio al CONTADO": PrecioContado, Imagenes, exchange_rate_at_creation } = req.body;
    const query = `UPDATE products SET producto = $1, categoria = $2, "Precio PY" = $3, "Precio al CONTADO" = $4, imagenes = $5, exchange_rate_at_creation = $6 WHERE id = $7 RETURNING *`;
    const values = [Producto, CATEGORIA, PrecioPY, PrecioContado, JSON.stringify(Imagenes || []), exchange_rate_at_creation, id];
    try {
        const client = await pool.connect();
        const result = await client.query(query, values);
        client.release();
        if (result.rowCount > 0) {
            const updatedProduct = mapProductForClient(result.rows[0]);
            res.json({ message: 'Product updated', product: updatedProduct });
        } else {
            res.status(404).json({ error: 'Product not found' });
        }
    } catch (err) {
        console.error('Error updating product:', err);
        res.status(500).json({ error: 'Error updating product in database.' });
    }
});

app.delete('/products/:id', async (req, res) => {
    const { id } = req.params;
    const query = 'DELETE FROM products WHERE id = $1';
    try {
        const client = await pool.connect();
        const result = await client.query(query, [id]);
        client.release();
        if (result.rowCount > 0) {
            res.json({ message: 'Product deleted' });
        } else {
            res.status(404).json({ error: 'Product not found' });
        }
    } catch (err) {
        console.error('Error deleting product:', err);
        res.status(500).json({ error: 'Error deleting product from database.' });
    }
});

app.put('/products/:id/status', async (req, res) => {
    const { id } = req.params;
    const { en_venta } = req.body;
    if (typeof en_venta !== 'boolean') {
        return res.status(400).json({ error: 'Invalid en_venta value.' });
    }
    const query = 'UPDATE products SET en_venta = $1 WHERE id = $2 RETURNING *';
    try {
        const client = await pool.connect();
        const result = await client.query(query, [en_venta, id]);
        client.release();
        if (result.rowCount > 0) {
            res.json(mapProductForClient(result.rows[0]));
        } else {
            res.status(404).json({ error: 'Product not found' });
        }
    } catch (err) {
        console.error('Error updating product status:', err);
        res.status(500).json({ error: 'Error updating product status.' });
    }
});

app.put('/products/:id/sale', async (req, res) => {
    const { id } = req.params;
    const { plan_pago_elegido, fecha_inicio_pago, pagos_realizados } = req.body;

    const num_cuotas_pagadas = (pagos_realizados && Array.isArray(pagos_realizados)) ? pagos_realizados.length : 0;
    const pagos_realizados_json = (pagos_realizados && Array.isArray(pagos_realizados)) ? JSON.stringify(pagos_realizados) : null;

    let client;
    try {
        client = await pool.connect();

        // Fetch the current product to get total installments and existing exchange rate
        const currentProductResult = await client.query('SELECT * FROM products WHERE id = $1', [id]);
        if (currentProductResult.rowCount === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        const currentProduct = currentProductResult.rows[0];

        const plans = [
            { months: 3, interest: 0.50, name: 'Plan 3 Cuotas' },
            { months: 6, interest: 1.00, name: 'Plan 6 Cuotas' },
            { months: 9, interest: 1.50, name: 'Plan 9 Cuotas' },
            { months: 12, interest: 2.00, name: 'Plan Exclusivo' }
        ];
        const selectedPlan = plans.find(p => p.name === plan_pago_elegido);

        let enVentaStatus = true; // Default to true
        if (selectedPlan && num_cuotas_pagadas >= selectedPlan.months) {
            enVentaStatus = false; // Mark as sold if all installments are paid
        }

        let exchangeRateAtSale = currentProduct.exchange_rate_at_sale; // Use existing rate if available
        let valorCuotaArs = currentProduct.valor_cuota_ars; // Use existing value if available

        // If a new plan is being set or exchange rate is not yet recorded, fetch and set it
        if (plan_pago_elegido && !exchangeRateAtSale) {
            const apiKey = process.env.EXGENERATE_API_KEY;
            const url = `https://v6.exchangerate-api.com/v6/${apiKey}/pair/USD/ARS`;
            const apiResponse = await fetch(url);
            const data = await apiResponse.json();
            if (data.result === 'error') {
                console.error(`Exchange rate API error: ${data['error-type']}`);
                // Proceed without exchange rate if API fails, or return an error
                // For now, we'll proceed, but a more robust solution might return an error.
            } else {
                exchangeRateAtSale = data.conversion_rate;
                const priceContado = parseFloat(currentProduct['Precio al CONTADO']);
                const finalPrice = priceContado * (1 + selectedPlan.interest);
                valorCuotaArs = (finalPrice / selectedPlan.months) * exchangeRateAtSale;
            }
        }

        const query = `
            UPDATE products 
            SET 
                plan_pago_elegido = $1, 
                cuotas_pagadas = $2::integer, 
                fecha_inicio_pago = $3,
                valor_cuota_ars = $4,
                pagos_realizados = $5,
                en_venta = $6,
                exchange_rate_at_sale = $7
            WHERE id = $8
            RETURNING *`;

        const values = [
            plan_pago_elegido,
            num_cuotas_pagadas,
            fecha_inicio_pago || null,
            valorCuotaArs,
            pagos_realizados_json,
            enVentaStatus,
            exchangeRateAtSale,
            id
        ];

        const result = await client.query(query, values);
        
        if (result.rowCount > 0) {
            res.json(mapProductForClient(result.rows[0]));
        } else {
            res.status(404).json({ error: 'Product not found' });
        }
    } catch (err) {
        console.error('Error updating sale data:', err);
        res.status(500).json({ error: 'Error updating sale data.' });
    } finally {
        if (client) client.release();
    }
});

module.exports = server;

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}
