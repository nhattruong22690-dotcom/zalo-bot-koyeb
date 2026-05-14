require('dotenv').config();

async function testSearchByCode(orderCode) {
    const clientId = process.env.GH247_CLIENT_ID;
    const token = process.env.GH247_TOKEN;
    const url = 'https://customer-api.247express.vn/api/Order/SearchCPNOrders';
    const payload = {
        "ClientID": parseInt(clientId),
        "OrderCode": orderCode, // Testing if this works
        "FromDate": "2026-05-01T00:00:00",
        "ToDate": "2026-12-31T23:59:59"
    };

    const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'ClientID': clientId, 'token': token },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log(JSON.stringify(data.orders?.[0], null, 2));
}

testSearchByCode('90061199378');
