require('dotenv').config();

async function testList() {
    const clientId = process.env.GH247_CLIENT_ID;
    const token = process.env.GH247_TOKEN;
    const url = 'https://customer-api.247express.vn/api/Order/SearchCPNOrders';
    
    console.log("Testing with ClientID:", clientId);
    
    const payload = {
        "ClientHubID": 0, "ClientID": parseInt(clientId), "PageIndex": 0, "PageSize": 50,
        "FromDate": "2026-05-01T00:00:00", "ToDate": "2026-12-31T23:59:59"
    };

    try {
        const res = await fetch(url, {
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json', 
                'ClientID': clientId, 
                'token': token 
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        console.log("Response Status:", res.status);
        console.log("Data Summary:", JSON.stringify(data).substring(0, 200));
    } catch (err) {
        console.error("FETCH ERROR:", err);
    }
}

testList();
