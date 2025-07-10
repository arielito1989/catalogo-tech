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

// --- DEBUGGING: Log the connection string ---
console.log('Attempting to connect with POSTGRES_URL:', process.env.POSTGRES_URL);

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

// Function to create the products table if it doesn't exist
const createTable = async () => {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            Producto TEXT,
            CATEGORIA TEXT,
            "Precio PY" REAL,
            "Precio al CONTADO" REAL,
            Imagenes TEXT
        );
    `;
    try {
        const client = await pool.connect();
        await client.query(createTableQuery);
        client.release();
        console.log('Products table created or already exists.');
    } catch (err) {
        console.error('Error creating table:', err);
    }
};

createTable();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));

// --- Socket.IO Vercel-compatible setup ---
const io = new Server(server, {
    transports: ['polling'],
    cors: { origin: "*", methods: ["GET", "POST"] }
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

app.get('/products', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT * FROM products');
        client.release();
        
        const productsWithParsedImages = result.rows.map(row => ({
            ...row,
            Imagenes: row.imagenes ? JSON.parse(row.imagenes) : []
        }));
        res.json(productsWithParsedImages);
    } catch (err) {
        console.error('Error getting products:', err);
        res.status(500).json({ error: 'Error fetching products from database.' });
    }
});

app.post('/products', async (req, res) => {
    const { id, Producto, CATEGORIA, "Precio PY": PrecioPY, "Precio al CONTADO": PrecioContado, Imagenes } = req.body;
    const query = 'INSERT INTO products (id, Producto, CATEGORIA, "Precio PY", "Precio al CONTADO", Imagenes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *';
    const values = [id, Producto, CATEGORIA, PrecioPY, PrecioContado, JSON.stringify(Imagenes)];

    try {
        const client = await pool.connect();
        const result = await client.query(query, values);
        client.release();
        const newProduct = {
            ...result.rows[0],
            Imagenes: result.rows[0].imagenes ? JSON.parse(result.rows[0].imagenes) : []
        };
        req.io.emit('productAdded', newProduct);
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
            Producto = $1, 
            CATEGORIA = $2, 
            "Precio PY" = $3, 
            "Precio al CONTADO" = $4, 
            Imagenes = $5 
        WHERE id = $6
        RETURNING *
    `;
    const values = [Producto, CATEGORIA, PrecioPY, PrecioContado, JSON.stringify(Imagenes), id];

    try {
        const client = await pool.connect();
        const result = await client.query(query, values);
        client.release();

        if (result.rowCount > 0) {
            const updatedProduct = {
                ...result.rows[0],
                Imagenes: result.rows[0].imagenes ? JSON.parse(result.rows[0].imagenes) : []
            };
            req.io.emit('productUpdated', updatedProduct);
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
            req.io.emit('productDeleted', id);
            res.json({ message: 'Product deleted', changes: result.rowCount });
        } else {
            res.status(404).json({ error: 'Product not found' });
        }
    } catch (err) {
        console.error('Error deleting product:', err);
        res.status(500).json({ error: 'Error deleting product from database.' });
    }
});

// This is the crucial part for Vercel.
// We need to export the server, not the app.
// Vercel will handle the listening part.
module.exports = server;