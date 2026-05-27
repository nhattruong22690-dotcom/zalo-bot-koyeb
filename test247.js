require('dotenv').config();

const cid = process.env.GH247_CLIENT_ID;
const token = process.env.GH247_TOKEN;

console.log('=== DEBUG 247Express API ===');
console.log('ClientID:', JSON.stringify(cid), '| length:', cid?.length);
console.log('Token:', JSON.stringify(token?.substring(0, 15)) + '...', '| length:', token?.length);
console.log('Token has quotes:', token?.includes('"') || token?.includes("'"));
console.log('Token has trailing space:', token !== token?.trim());
console.log('');

const url = 'https://customer-api.247express.vn/api/Order/SearchCPNOrders';
const payload = {
    ClientHubID: 0,
    ClientID: parseInt(cid),
    FromDate: '2026-01-01T00:00:00',
    ToDate: '2026-12-31T23:59:59',
    IsFilterTotalCost: true,
    MaxTotalCost: 0,
    MinTotalCost: 0,
    OrderType: null,
    PageIndex: 0,
    PageSize: 5,
    Status: null,
    TextSearch: ''
};

const headers = {
    'Content-Type': 'application/json',
    'ClientID': String(cid),
    'token': token,
    'Token': token
};

console.log('Request headers:', JSON.stringify(headers, null, 2));
console.log('Request body:', JSON.stringify(payload, null, 2));
console.log('');

fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload)
}).then(r => {
    console.log('HTTP Status:', r.status);
    console.log('Response headers:', Object.fromEntries(r.headers.entries()));
    return r.json();
}).then(d => {
    console.log('Response body:', JSON.stringify(d, null, 2).substring(0, 500));
    if (d.errorMessage) {
        console.log('\n❌ API ERROR:', d.errorMessage);
    } else if (d.orders) {
        console.log('\n✅ SUCCESS! Found', d.orders.length, 'orders');
    }
}).catch(e => console.error('Fetch Error:', e.message));
