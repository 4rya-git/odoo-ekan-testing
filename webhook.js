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

function stripHtml(html) {
    return html.replace(/<[^>]*>/g, '');  // Removes HTML tags
}

// Webhook endpoint
app.post('/webhook', (req, res) => {
    console.log('📦 Received webhook data from Odoo:');
    console.log(JSON.stringify(req.body, null, 2));

    const partner_id = req.body.partner_id;
    const invoice_line_ids = req.body.invoice_line_ids;
    const invoice_origin = req.body.invoice_origin;  // This will likely reference the sales order
    const payment_state = req.body.payment_state;
    const currency_id = req.body.currency_id;

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

            // Step 3: Fetch the sales order note (from sale.order) using invoice_origin
            const saleOrderFields = ['note'];  // Fetch only the note field
            models.methodCall('execute_kw', [db, uid, password, 'sale.order', 'search_read', [[['name', '=', invoice_origin]]], { fields: saleOrderFields }], (err, saleOrderData) => {
                if (err) {
                    console.error('❌ Error fetching sales order data:', err);
                    return res.status(500).send('Internal Server Error');
                }

                // Assuming invoice_origin corresponds to the sale order name
                const orderNote = saleOrderData.length > 0 ? saleOrderData[0].note : '';  // Default to empty if no note
                const plainOrderNote = stripHtml(orderNote);

                // Step 4: Fetch invoice line details
                const invoiceLineFields = ['product_id', 'quantity', 'price_unit'];
                models.methodCall('execute_kw', [db, uid, password, 'account.move.line', 'read', [invoice_line_ids], { fields: invoiceLineFields }], (err, invoiceLineData) => {
                    if (err) {
                        console.error('❌ Error fetching invoice line data:', err);
                        return res.status(500).send('Internal Server Error');
                    }

                    const productIds = invoiceLineData.map(line => line.product_id[0]);
                    const productFields = ['name', 'default_code'];

                    // Step 5: Fetch product details
                    models.methodCall('execute_kw', [db, uid, password, 'product.product', 'read', [productIds], { fields: productFields }], (err, productsData) => {
                        if (err) {
                            console.error('❌ Error fetching product details:', err);
                            return res.status(500).send('Internal Server Error');
                        }

                        const products = invoiceLineData.map(line => {
                            const product = productsData.find(p => p.id === line.product_id[0]);
                            return {
                                product_name: product?.name || '',
                                product_code: product?.default_code || '',
                                quantity: line.quantity,
                                price_unit: line.price_unit,
                            };
                        });

                        // Combined response data with sales order note
                        const responseData = {
                            invoice_origin: invoice_origin,
                            partner_id: partner_id,
                            payment_state: payment_state,
                            currency_id: currency_id,
                            customer: customerDetails,
                            order_note: plainOrderNote,  // Include the sales order note
                            products: products,
                        };

                        console.log('🎯 Webhook Data with Customer, Product, and Order Note Info:');
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
