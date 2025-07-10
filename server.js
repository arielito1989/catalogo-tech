require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const fetch = require('node-fetch');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Create a new pool of connections to the database.
const isProduction = process.env.NODE_ENV === 'production';
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

// Function to create and update the products table schema
const initializeDatabase = async () => {
    const client = await pool.connect();
    try {
        // Base table creation
        await client.query(`
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                Producto TEXT,
                CATEGORIA TEXT,
                "Precio PY" REAL,
                "Precio al CONTADO" REAL,
                Imagenes TEXT,
                en_venta BOOLEAN NOT NULL DEFAULT TRUE,
                plan_pago_elegido TEXT,
                cuotas_pagadas INTEGER NOT NULL DEFAULT 0
            );
        `);

        // Add 'fecha_inicio_pago' column if it doesn't exist to avoid errors on existing databases
        const columnCheck = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'fecha_inicio_pago'");
        if (columnCheck.rowCount === 0) {
            await client.query('ALTER TABLE products ADD COLUMN fecha_inicio_pago DATE;');
            console.log('Column "fecha_inicio_pago" added to products table.');
        }
        
        console.log('Database schema is up to date.');
    } catch (err) {
        console.error('Error during database initialization:', err);
    } finally {
        client.release();
    }
};

initializeDatabase();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));

// --- Socket.IO Vercel-compatible setup ---
const io = new Server(server, {
    transports: ['polling'],
    cors: { origin: "*", methods: ["GET", "POST"] },
    cookie: false
});

io.on('connection', (socket) => {
    console.log('A user connected via polling');
    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Middleware to attach io to the request object
app.use((req, res, next) => {
    req.io = io;
    next();
});

// A centralized function to map database rows to the client-side product structure.
// This ensures consistency and safety, especially with JSON parsing.
const mapProductForClient = (row) => {
    if (!row) return null;

    let imagenes = [];
    if (row.imagenes) {
        try {
            // Attempt to parse the JSON string from the database.
            const parsed = JSON.parse(row.imagenes);
            // Ensure the result is an array before assigning it.
            if (Array.isArray(parsed)) {
                imagenes = parsed;
            }
        } catch (e) {
            // If parsing fails, log the error and default to an empty array.
            console.error(`Error parsing Imagenes JSON for product id ${row.id}:`, row.imagenes);
        }
    }

    // Return a consistently structured product object.
    return {
        id: row.id,
        Producto: row.producto, // Map from db's 'producto' to client's 'Producto'
        CATEGORIA: row.categoria, // Map from db's 'categoria' to client's 'CATEGORIA'
        'Precio PY': row['Precio PY'],
        'Precio al CONTADO': row['Precio al CONTADO'],
        Imagenes: imagenes, // The safely parsed array of images.
        en_venta: row.en_venta,
        plan_pago_elegido: row.plan_pago_elegido,
        cuotas_pagadas: row.cuotas_pagadas,
        fecha_inicio_pago: row.fecha_inicio_pago,
    };
};

// --- API Endpoints ---

let exchangeRateCache = { value: null, timestamp: null };
const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours in milliseconds

app.get('/api/exchange-rate', async (req, res) => {
    try {
        if (exchangeRateCache.value && (Date.now() - exchangeRateCache.timestamp < CACHE_DURATION)) {
            return res.json({ rates: { ARS: exchangeRateCache.value } });
        }
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
        exchangeRateCache.value = data.conversion_rate;
        exchangeRateCache.timestamp = Date.now();
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
        console.error('Error: Admin credentials are not set in environment variables.');
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
        
        // Use the mapper for each product to ensure consistent data structure.
        const products = result.rows.map(mapProductForClient);
        res.json(products);
    } catch (err) {
        console.error('Error getting products:', err);
        res.status(500).json({ error: 'Error fetching products from database.' });
    }
});

app.post('/products', async (req, res) => {
    const { id, Producto, CATEGORIA, "Precio PY": PrecioPY, "Precio al CONTADO": PrecioContado, Imagenes } = req.body;
    const query = 'INSERT INTO products (id, producto, categoria, "Precio PY", "Precio al CONTADO", imagenes, en_venta) VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING *';
    const values = [id, Producto, CATEGORIA, PrecioPY, PrecioContado, JSON.stringify(Imagenes || [])];

    try {
        const client = await pool.connect();
        const result = await client.query(query, values);
        client.release();
        
        // Use the mapper on the newly created product.
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
    const query = `
        UPDATE products SET 
            producto = $1, 
            categoria = $2, 
            "Precio PY" = $3, 
            "Precio al CONTADO" = $4, 
            imagenes = $5 
        WHERE id = $6
        RETURNING *
    `;
    const values = [Producto, CATEGORIA, PrecioPY, PrecioContado, JSON.stringify(Imagenes || []), id];

    try {
        const client = await pool.connect();
        const result = await client.query(query, values);
        client.release();

        if (result.rowCount > 0) {
            // Use the mapper on the updated product.
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
            // req.io.emit('productDeleted', id); // Desactivado para evitar polling
            res.json({ message: 'Product deleted', changes: result.rowCount });
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
        return res.status(400).json({ error: 'Invalid en_venta value. It must be a boolean.' });
    }

    const query = 'UPDATE products SET en_venta = $1 WHERE id = $2 RETURNING *';
    const values = [en_venta, id];

    try {
        const client = await pool.connect();
        const result = await client.query(query, values);
        client.release();

        if (result.rowCount > 0) {
            // Use the mapper on the updated product.
            const updatedProduct = mapProductForClient(result.rows[0]);
            res.json({ message: 'Product status updated', product: updatedProduct });
        } else {
            res.status(404).json({ error: 'Product not found' });
        }
    } catch (err) {
        console.error('Error updating product status:', err);
        res.status(500).json({ error: 'Error updating product status in database.' });
    }
});

app.put('/products/:id/sale', async (req, res) => {
    const { id } = req.params;
    const { en_venta, plan_pago_elegido, cuotas_pagadas, fecha_inicio_pago } = req.body;

    const fields = [];
    const values = [];
    
    const addField = (name, value) => {
        if (value !== undefined) {
            values.push(value);
            fields.push(`${name} = ${values.length}`);
        }
    };

    addField('en_venta', en_venta);
    addField('plan_pago_elegido', plan_pago_elegido);
    addField('cuotas_pagadas', cuotas_pagadas);
    // Ensure null is saved if date is cleared, not an empty string
    addField('fecha_inicio_pago', fecha_inicio_pago || null);

    if (fields.length === 0) {
        return res.status(400).json({ error: 'No fields to update provided.' });
    }

    const query = `UPDATE products SET ${fields.join(', ')} WHERE id = ${values.length + 1} RETURNING *`;
    values.push(id);

    try {
        const client = await pool.connect();
        const result = await client.query(query, values);
        client.release();

        if (result.rowCount > 0) {
            // Use the mapper on the updated product.
            const updatedProduct = mapProductForClient(result.rows[0]);
            res.json({ message: 'Product sale data updated', product: updatedProduct });
        } else {
            res.status(404).json({ error: 'Product not found' });
        }
    } catch (err) {
        console.error('Error updating product sale data:', err);
        res.status(500).json({ error: 'Error updating product sale data in database.' });
    }
});

// This is the crucial part for Vercel.
// We need to export the server, not the app.
// Vercel will handle the listening part.
module.exports = server;

// This part is for local development.
// Vercel will ignore this.
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}
