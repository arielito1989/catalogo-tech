const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the root directory
app.use(express.static(path.join(__dirname, '')));

// Login endpoint
app.post('/login', (req, res) => {
    console.log('Login attempt:', req.body);
    console.log('Env vars:', { user: process.env.USERNAME, pass: process.env.PASSWORD });
    const { username, password } = req.body;
    if (username === process.env.USERNAME && password === process.env.PASSWORD) {
        res.status(200).json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
