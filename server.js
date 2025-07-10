require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);

// Connect to SQLite database
const db = new sqlite3.Database('./catalog.db', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initializeDatabase();
    }
});

// Function to create and update the products table schema
const initializeDatabase = () => {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                producto TEXT,
                categoria TEXT,
                "Precio PY" REAL,
                "Precio al CONTADO" REAL,
                imagenes TEXT,
                en_venta BOOLEAN NOT NULL DEFAULT 1,
                plan_pago_elegido TEXT,
                cuotas_pagadas INTEGER NOT NULL DEFAULT 0,
                fecha_inicio_pago DATE
            );
        `, (err) => {
            if (err) {
                console.error('Error creating table', err.message);
            }
        });
    });
};

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));

// A centralized function to map database rows to the client-side product structure.
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
        en_venta: !!row.en_venta, // Convert 0/1 to boolean
        plan_pago_elegido: row.plan_pago_elegido,
        cuotas_pagadas: row.cuotas_pagadas,
        fecha_inicio_pago: row.fecha_inicio_pago,
    };
};

// --- API Endpoints ---

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
        console.error('Error: Admin credentials are not set in environment variables.');
        return res.status(500).json({ success: false, message: 'Internal server configuration error.' });
    }

    if (username === adminUsername && password === adminPassword) {
        res.status(200).json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.get('/products', (req, res) => {
    db.all('SELECT * FROM products ORDER BY producto ASC', [], (err, rows) => {
        if (err) {
            console.error('Error getting products:', err);
            return res.status(500).json({ error: 'Error fetching products from database.' });
        }
        const products = rows.map(mapProductForClient);
        res.json(products);
    });
});

app.post('/products', (req, res) => {
    const { id, Producto, CATEGORIA, "Precio PY": PrecioPY, "Precio al CONTADO": PrecioContado, Imagenes } = req.body;
    const query = 'INSERT INTO products (id, producto, categoria, "Precio PY", "Precio al CONTADO", imagenes, en_venta) VALUES (?, ?, ?, ?, ?, ?, 1)';
    const values = [id, Producto, CATEGORIA, PrecioPY, PrecioContado, JSON.stringify(Imagenes || [])];
    
    db.run(query, values, function(err) {
        if (err) {
            console.error('Error adding product:', err);
            return res.status(500).json({ error: 'Error adding product to database.' });
        }
        db.get('SELECT * FROM products WHERE id = ?', [id], (err, row) => {
            if (err) {
                console.error('Error fetching new product:', err);
                return res.status(500).json({ error: 'Could not fetch the new product.' });
            }
            const newProduct = mapProductForClient(row);
            res.status(201).json({ message: 'Product added', product: newProduct });
        });
    });
});

app.put('/products/:id', (req, res) => {
    const { id } = req.params;
    const { Producto, CATEGORIA, "Precio PY": PrecioPY, "Precio al CONTADO": PrecioContado, Imagenes } = req.body;
    const query = `UPDATE products SET producto = ?, categoria = ?, "Precio PY" = ?, "Precio al CONTADO" = ?, imagenes = ? WHERE id = ?`;
    const values = [Producto, CATEGORIA, PrecioPY, PrecioContado, JSON.stringify(Imagenes || []), id];

    db.run(query, values, function(err) {
        if (err) {
            console.error('Error updating product:', err);
            return res.status(500).json({ error: 'Error updating product in database.' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        db.get('SELECT * FROM products WHERE id = ?', [id], (err, row) => {
            if (err) {
                console.error('Error fetching updated product:', err);
                return res.status(500).json({ error: 'Could not fetch the updated product.' });
            }
            const updatedProduct = mapProductForClient(row);
            res.json({ message: 'Product updated', product: updatedProduct });
        });
    });
});

app.delete('/products/:id', (req, res) => {
    const { id } = req.params;
    const query = 'DELETE FROM products WHERE id = ?';
    db.run(query, [id], function(err) {
        if (err) {
            console.error('Error deleting product:', err);
            return res.status(500).json({ error: 'Error deleting product from database.' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.json({ message: 'Product deleted' });
    });
});

app.put('/products/:id/status', (req, res) => {
    const { id } = req.params;
    const { en_venta } = req.body;
    if (typeof en_venta !== 'boolean') {
        return res.status(400).json({ error: 'Invalid en_venta value.' });
    }
    const query = 'UPDATE products SET en_venta = ? WHERE id = ?';
    db.run(query, [en_venta ? 1 : 0, id], function(err) {
        if (err) {
            console.error('Error updating product status:', err);
            return res.status(500).json({ error: 'Error updating product status.' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        db.get('SELECT * FROM products WHERE id = ?', [id], (err, row) => {
            if (err) {
                console.error('Error fetching updated product:', err);
                return res.status(500).json({ error: 'Could not fetch the updated product.' });
            }
            res.json(mapProductForClient(row));
        });
    });
});

app.put('/products/:id/sale', (req, res) => {
    const { id } = req.params;
    const { en_venta, plan_pago_elegido, cuotas_pagadas, fecha_inicio_pago } = req.body;
    
    const fields = [];
    const values = [];
    
    const addField = (name, value) => {
        if (value !== undefined) {
            fields.push(`${name} = ?`);
            values.push(value);
        }
    };

    addField('en_venta', en_venta === undefined ? undefined : (en_venta ? 1 : 0));
    addField('plan_pago_elegido', plan_pago_elegido);
    addField('cuotas_pagadas', cuotas_pagadas);
    addField('fecha_inicio_pago', fecha_inicio_pago || null);

    if (fields.length === 0) {
        return res.status(400).json({ error: 'No fields to update.' });
    }

    values.push(id);
    const query = `UPDATE products SET ${fields.join(', ')} WHERE id = ?`;

    db.run(query, values, function(err) {
        if (err) {
            console.error('Error updating sale data:', err);
            return res.status(500).json({ error: 'Error updating sale data.' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        db.get('SELECT * FROM products WHERE id = ?', [id], (err, row) => {
            if (err) {
                console.error('Error fetching updated product:', err);
                return res.status(500).json({ error: 'Could not fetch the updated product.' });
            }
            res.json(mapProductForClient(row));
        });
    });
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