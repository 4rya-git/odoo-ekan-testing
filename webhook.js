require('dotenv').config();
const express = require('express');
const xmlrpc = require('xmlrpc');
const app = express();

// Odoo server and database details
const url = process.env.ODOO_URL || '';  // Change this to your Odoo instance URL
const db = process.env.ODOO_DB || '';
const username = process.env.ODOO_USERNAME || '';
const password = process.env.ODOO_PASSWORD || '';

// XML-RPC client setup
const common = xmlrpc.createClient({ url: `${url}/xmlrpc/2/common` });
const models = xmlrpc.createClient({ url: `${url}/xmlrpc/2/object` });

// Middleware to parse JSON bodies
app.use(express.json());

// Webhook endpoint
app.post('/webhook', (req, res) => {
    console.log('📦 Received webhook data from Odoo:');
    console.log(JSON.stringify(req.body, null, 2));

    const partner_id = req.body.partner_id;
    const invoice_line_ids = req.body.invoice_line_ids;

    // Step 1: Authenticate with Odoo
    common.methodCall('authenticate', [db, username, password, {}], (error, uid) => {
        if (error) {
            console.error('❌ Error authenticating with Odoo:', error);
            return res.status(500).send('Internal Server Error');
        }

        // Step 2: Fetch customer (partner) details
        const partnerFields = [
            'name', 'email', 'phone', 'street', 'street2',
            'city', 'state_id', 'zip', 'country_id'
        ];

        models.methodCall('execute_kw', [db, uid, password, 'res.partner', 'read', [[partner_id]], { fields: partnerFields }], (err, partnerData) => {
            if (err) {
                console.error('❌ Error fetching customer details:', err);
                return res.status(500).send('Internal Server Error');
            }

            const customer = partnerData[0];
            const customerDetails = {
                name: customer.name,
                email: customer.email,
                phone: customer.phone,
                address: {
                    street: customer.street || '',
                    street2: customer.street2 || '',
                    city: customer.city || '',
                    state: customer.state_id ? customer.state_id[1] : '',
                    zip: customer.zip || '',
                    country: customer.country_id ? customer.country_id[1] : ''
                }
            };

            // Step 3: Fetch invoice line details
            const invoiceLineFields = ['product_id', 'quantity', 'price_unit', 'move_id'];  // We also fetch 'move_id' to link with sales order
            models.methodCall('execute_kw', [db, uid, password, 'account.move.line', 'read', [invoice_line_ids], { fields: invoiceLineFields }], (err, invoiceLineData) => {
                if (err) {
                    console.error('❌ Error fetching invoice line data:', err);
                    return res.status(500).send('Internal Server Error');
                }

                const moveIds = invoiceLineData.map(line => line.move_id[0]);  // Extract move_id (sale order related)

                // Step 4: Fetch sales order details (including note) from sale.order
                models.methodCall('execute_kw', [db, uid, password, 'sale.order', 'read', [moveIds], { fields: ['note'] }], (err, saleOrderData) => {
                    if (err) {
                        console.error('❌ Error fetching sales order details:', err);
                        return res.status(500).send('Internal Server Error');
                    }

                    const saleOrderNotes = saleOrderData.reduce((notesMap, order) => {
                        notesMap[order.id] = order.note || '';  // Store notes in a map by sale order id
                        return notesMap;
                    }, {});

                    // Step 5: Fetch product details
                    const productIds = invoiceLineData.map(line => line.product_id[0]);
                    const productFields = ['name', 'default_code'];

                    models.methodCall('execute_kw', [db, uid, password, 'product.product', 'read', [productIds], { fields: productFields }], (err, productsData) => {
                        if (err) {
                            console.error('❌ Error fetching product details:', err);
                            return res.status(500).send('Internal Server Error');
                        }

                        const products = invoiceLineData.map(line => {
                            const product = productsData.find(p => p.id === line.product_id[0]);
                            const saleOrderNote = saleOrderNotes[line.move_id[0]] || '';  // Get note from map
                            return {
                                product_name: product?.name || '',
                                product_code: product?.default_code || '',
                                quantity: line.quantity,
                                price_unit: line.price_unit,
                                sale_order_note: saleOrderNote,  // Add note to the product info
                            };
                        });

                        // Combined response data
                        const responseData = {
                            customer: customerDetails,
                            products: products,
                        };

                        console.log('🎯 Webhook Data with Customer, Product, and Sales Order Notes:');
                        console.log(JSON.stringify(responseData, null, 2));
                        res.status(200).send('✅ Webhook received and processed successfully');
                    });
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
