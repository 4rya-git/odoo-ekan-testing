require('dotenv').config();
const express = require('express');
const xmlrpc = require('xmlrpc');
const app = express();

// Odoo server and database details
const url = 'https://your-odoo-instance-url';  // Change this to your Odoo instance URL
const db = 'your-database-name';
const username = 'your-username';
const password = 'your-password';

// XML-RPC client setup
const common = xmlrpc.createClient({ url: `${url}/xmlrpc/2/common` });
const models = xmlrpc.createClient({ url: `${url}/xmlrpc/2/object` });

// Middleware to parse JSON bodies
app.use(express.json());

// Webhook endpoint
app.post('/webhook', (req, res) => {
    console.log('📦 Received webhook data from Odoo:');
    console.log(JSON.stringify(req.body, null, 2));  // Pretty print JSON

    // Extract partner_id (customer) and invoice_line_ids (products)
    const partner_id = req.body.partner_id;
    const invoice_line_ids = req.body.invoice_line_ids;

    // Step 1: Fetch customer details (partner info)
    common.methodCall('authenticate', [db, username, password, {}], (error, uid) => {
        if (error) {
            console.log('Error authenticating with Odoo:', error);
            return res.status(500).send('Internal Server Error');
        }

        const partnerFields = ['name', 'email', 'phone'];
        models.methodCall('execute_kw', [db, uid, password, 'res.partner', 'read', [[partner_id]], { fields: partnerFields }], (err, partnerData) => {
            if (err) {
                console.log('Error fetching customer details:', err);
                return res.status(500).send('Internal Server Error');
            }

            const customerDetails = partnerData[0]; // Assuming the partner ID is valid
            const customerName = customerDetails.name;
            const customerEmail = customerDetails.email;
            const customerPhone = customerDetails.phone;

            // Step 2: Fetch product details from invoice lines
            const invoiceLineFields = ['product_id', 'quantity', 'price_unit']; // Fields we need from invoice lines
            models.methodCall('execute_kw', [db, uid, password, 'account.move.line', 'read', [invoice_line_ids], { fields: invoiceLineFields }], (err, invoiceLineData) => {
                if (err) {
                    console.log('Error fetching invoice line data:', err);
                    return res.status(500).send('Internal Server Error');
                }

                // Extract product IDs from invoice lines
                const productIds = invoiceLineData.map(line => line.product_id[0]);
                const productFields = ['name', 'default_code'];  // Product details (name and internal code)

                // Fetch product details
                models.methodCall('execute_kw', [db, uid, password, 'product.product', 'read', [productIds], { fields: productFields }], (err, productsData) => {
                    if (err) {
                        console.log('Error fetching product details:', err);
                        return res.status(500).send('Internal Server Error');
                    }

                    // Create response data
                    const products = invoiceLineData.map(line => {
                        const product = productsData.find(p => p.id === line.product_id[0]);
                        return {
                            product_name: product.name,
                            product_code: product.default_code,
                            quantity: line.quantity,
                            price_unit: line.price_unit,
                        };
                    });

                    // Combine customer and product data
                    const responseData = {
                        customer: {
                            name: customerName,
                            email: customerEmail,
                            phone: customerPhone,
                        },
                        products: products,
                    };

                    // Log and respond
                    console.log('🎯 Webhook Data with Customer and Product Info:', JSON.stringify(responseData, null, 2));
                    res.status(200).send('✅ Webhook received and processed successfully');
                });
            });
        });
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('✅ Server is healthy');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Webhook server is listening on port ${PORT}`);
});
