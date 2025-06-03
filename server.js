const express = require('express');
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Webhook endpoint
app.post('/webhook', (req, res) => {
    console.log('📦 Received webhook data from Odoo:');
    console.log(JSON.stringify(req.body, null, 2));  // Pretty print JSON

    res.status(200).send('✅ Webhook received');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Webhook server is listening on port ${PORT}`);
});
