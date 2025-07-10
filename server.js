require('dotenv').config();
const express = require('express');
// const { Pool } = require('pg'); // Database connection disabled
const fetch = require('node-fetch');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);

// --- Database connection is disabled ---
// const pool = new Pool({
//     connectionString: process.env.DATABASE_URL
// });
//
// const initializeDatabase = async () => {
//     // This function is disabled as there is no database connection.
// };
//
// initializeDatabase();
// -----------------------------------------

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));

// This function is kept for potential future use but is not currently called.
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
            // Try to get the key from Vercel's environment variables if available
            const vercelApiKey = process.env.EXGENERATE_API_KEY;
            if (!vercelApiKey) {
                return res.status(500).json({ error: 'Server configuration error: API key not set.' });
            }
            apiKey = vercelApiKey;
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

// --- Product routes are disabled as there is no database ---
const dbDisabledMessage = { error: 'Database connection is not configured.' };

app.get('/products', async (req, res) => {
    res.json([]); // Return an empty array
});

app.post('/products', async (req, res) => {
    res.status(503).json(dbDisabledMessage);
});

app.put('/products/:id', async (req, res) => {
    res.status(503).json(dbDisabledMessage);
});

app.delete('/products/:id', async (req, res) => {
    res.status(503).json(dbDisabledMessage);
});

app.put('/products/:id/status', async (req, res) => {
    res.status(503).json(dbDisabledMessage);
});

app.put('/products/:id/sale', async (req, res) => {
    res.status(503).json(dbDisabledMessage);
});

module.exports = server;

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}
