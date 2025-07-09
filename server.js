const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app); // Create HTTP server
const io = new Server(server); // Initialize Socket.IO
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json({ limit: '50mb' }));

// Serve static files from the root directory
app.use(express.static(path.join(__dirname, '')));

// Initialize SQLite database
const db = new sqlite3.Database('./catalog.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            Producto TEXT,
            CATEGORIA TEXT,
            "Precio PY" REAL,
            "Precio al CONTADO" REAL,
            Imagenes TEXT
        )`, (err) => {
            if (err) {
                console.error('Error creating products table:', err.message);
            } else {
                console.log('Products table created or already exists.');
            }
        });
    }
});

// Login endpoint
app.post('/login', (req, res) => {
    console.log('Login attempt:', req.body);
    const { username, password } = req.body;
    if (username === 'admin' && password === 'catalogo2025') {
        res.status(200).json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// Get all products
app.get('/products', (req, res) => {
    db.all("SELECT * FROM products", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        // Parse the Imagenes field from JSON string back to array
        const productsWithParsedImages = rows.map(row => {
            try {
                return {
                    ...row,
                    Imagenes: row.Imagenes ? JSON.parse(row.Imagenes) : []
                };
            } catch (parseError) {
                console.error('Error parsing Imagenes for product:', row.id, parseError);
                return {
                    ...row,
                    Imagenes: [] // Return empty array if parsing fails
                };
            }
        });
        res.json(productsWithParsedImages);
    });
});

// Add a new product
app.post('/products', (req, res) => {
    const { id, Producto, CATEGORIA, "Precio PY": PrecioPY, "Precio al CONTADO": PrecioContado, Imagenes } = req.body;
    const stmt = db.prepare("INSERT INTO products (id, Producto, CATEGORIA, \"Precio PY\", \"Precio al CONTADO\", Imagenes) VALUES (?, ?, ?, ?, ?, ?)");
    stmt.run(id, Producto, CATEGORIA, PrecioPY, PrecioContado, JSON.stringify(Imagenes), function (err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.status(201).json({ message: 'Product added', id: this.lastID });
        io.emit('productAdded', { id, Producto, CATEGORIA, "Precio PY": PrecioPY, "Precio al CONTADO": PrecioContado, Imagenes }); // Emit event
    });
    stmt.finalize();
});

// Update a product
app.put('/products/:id', (req, res) => {
    const { id } = req.params;
    const { Producto, CATEGORIA, "Precio PY": PrecioPY, "Precio al CONTADO": PrecioContado, Imagenes } = req.body;
    db.run(`UPDATE products SET
        Producto = ?,
        CATEGORIA = ?,
        "Precio PY" = ?,
        "Precio al CONTADO" = ?,
        Imagenes = ?
        WHERE id = ?`, 
        [Producto, CATEGORIA, PrecioPY, PrecioContado, JSON.stringify(Imagenes), id],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'Product updated', changes: this.changes });
            io.emit('productUpdated', { id, Producto, CATEGORIA, "Precio PY": PrecioPY, "Precio al CONTADO": PrecioContado, Imagenes }); // Emit event
        }
    );
});

// Delete a product
app.delete('/products/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM products WHERE id = ?", id, function (err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Product deleted', changes: this.changes });
        io.emit('productDeleted', id); // Emit event
    });
});

server.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
