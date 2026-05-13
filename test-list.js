require('dotenv').config();

async function getOrderList() {
    const clientId = process.env.GH247_CLIENT_ID;
    const token = process.env.GH247_TOKEN;

    if (!clientId || !token) {
        console.error('❌ Missing GH247_CLIENT_ID or GH247_TOKEN in .env');
        return;
    }

    const url = 'https://customer-api.247express.vn/api/Order/SearchCPNOrders';

    const payload = {
        "ClientHubID": 0,
        "ClientID": parseInt(clientId),
        "FromDate": "2026-05-01T00:00:00",
        "ToDate": "2026-12-31T23:59:59",
        "IsFilterTotalCost": true,
        "MaxTotalCost": 0,
        "MinTotalCost": 0,
        "OrderType": null,
        "PageIndex": 0,
        "PageSize": 100,
        "Status": null,
        "TextSearch": ""
    };

    console.log(`📡 Calling: ${url}`);
    
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
        
        if (res.ok && !data.errorCode) {
            const orders = data.orders || [];
            let table = "```\n";
            table += "STT | MÃ ĐƠN      | TRẠNG THÁI     | ĐÍCH ĐẾN\n";
            table += "----+-------------+----------------+------------\n";
            
            orders.forEach((o, i) => {
                const id = (i+1).toString().padEnd(3);
                const code = o.orderCode.padEnd(11);
                const status = (o.status == "30") ? "Thành công" : (o.statusName || '---').substring(0, 14);
                const province = (o.receiverProvinceName || '---').substring(0, 10);
                
                table += `${id} | ${code} | ${status.padEnd(14)} | ${province}\n`;
            });
            table += "```";
            
            console.log(`✅ Success!\n\n${table}`);
        }
 else {
            console.log(`❌ Failed: ${data.errorMessage || data.message || 'Unknown error'}`);
        }
    } catch (err) {
        console.log(`⚠️ Error: ${err.message}`);
    }
}

getOrderList();
