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
    if (pool) {
        const client = await pool.connect();
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS products (
                    id TEXT PRIMARY KEY,
                    producto TEXT,
                    categoria TEXT,
                    "Precio PY" REAL,
                    "Precio al CONTADO" REAL,
                    imagenes TEXT,
                    en_venta BOOLEAN NOT NULL DEFAULT TRUE,
                    plan_pago_elegido TEXT,
                    cuotas_pagadas INTEGER NOT NULL DEFAULT 0,
                    fecha_inicio_pago DATE
                );
            `);
        } catch (err) {
            console.error('Error during database initialization:', err);
        } finally {
            client.release();
        }
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
    const { id, Producto, CATEGORIA, "Precio PY": PrecioPY, "Precio al CONTADO": PrecioContado, Imagenes } = req.body;
    // Corrected query to use $7 for the boolean value
    const query = 'INSERT INTO products (id, producto, categoria, "Precio PY", "Precio al CONTADO", imagenes, en_venta) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *';
    // Added `true` to the values array for the en_venta column
    const values = [id, Producto, CATEGORIA, PrecioPY, PrecioContado, JSON.stringify(Imagenes || []), true];
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
    const { Producto, CATEGORIA, "Precio PY": PrecioPY, "Precio al CONTADO": PrecioContado, Imagenes } = req.body;
    const query = `UPDATE products SET producto = $1, categoria = $2, "Precio PY" = $3, "Precio al CONTADO" = $4, imagenes = $5 WHERE id = $6 RETURNING *`;
    const values = [Producto, CATEGORIA, PrecioPY, PrecioContado, JSON.stringify(Imagenes || []), id];
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
    const { plan_pago_elegido, cuotas_pagadas, fecha_inicio_pago } = req.body;

    const query = `
        UPDATE products 
        SET 
            plan_pago_elegido = $1, 
            cuotas_pagadas = $2, 
            fecha_inicio_pago = $3
        WHERE id = $4
        RETURNING *`;

    const values = [
        plan_pago_elegido,
        cuotas_pagadas,
        fecha_inicio_pago || null,
        id
    ];

    try {
        const client = await pool.connect();
        const result = await client.query(query, values);
        client.release();
        if (result.rowCount > 0) {
            res.json(mapProductForClient(result.rows[0]));
        } else {
            res.status(404).json({ error: 'Product not found' });
        }
    } catch (err) {
        console.error('Error updating sale data:', err);
        res.status(500).json({ error: 'Error updating sale data.' });
    }
});

module.exports = server;

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}
