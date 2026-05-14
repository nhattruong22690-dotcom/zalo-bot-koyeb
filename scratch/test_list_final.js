require('dotenv').config();

// Copy exactly from server.js
async function getOrderList247(showAll = false) {
    const clientId = process.env.GH247_CLIENT_ID;
    const token = process.env.GH247_TOKEN;
    if (!clientId || !token) return '⚠️ Thiếu GH247_CLIENT_ID hoặc TOKEN trong .env';

    const url = 'https://customer-api.247express.vn/api/Order/SearchCPNOrders';
    const payload = {
        "ClientHubID": 0, "ClientID": parseInt(clientId), "PageIndex": 0, "PageSize": 50,
        "FromDate": "2026-01-01T00:00:00",
        "ToDate": "2026-12-31T23:59:59"
    };

    let attempts = 0;
    while (attempts < 2) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'ClientID': clientId, 'token': token },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            
            if (res.ok && !data.errorCode) {
                let orders = data.orders || [];
                if (!showAll) {
                    orders = orders.filter(o => o.status != "30"); 
                }

                if (orders.length === 0) return showAll ? "📭 Hiện chưa có vận đơn nào." : "✅ Tất cả đơn hàng đã giao thành công!";
                
                let reply = showAll ? `📋 TẤT CẢ VẬN ĐƠN 247\n` : `🚚 ĐƠN HÀNG ĐANG GIAO\n`;
                reply += `━━━━━━━━━━━━━━━━━━━\n`;
                orders.slice(0, 15).forEach((o, i) => {
                    const status = (o.status == "30") ? "✅ Thành công" : (o.statusName || '---');
                    reply += `${i + 1}. ${o.orderCode} | ${status}\n📍 ${o.receiverProvinceName || '---'}\n\n`;
                });
                return reply.trim();
            }
            return `❌ Lỗi từ API: ${data.errorMessage || 'Không thể lấy danh sách'}`;
        } catch (err) {
            attempts++;
            console.error(`❌ Lỗi lấy danh sách (Lần ${attempts}):`, err.message);
            if (attempts >= 2) throw err;
            await new Promise(r => setTimeout(r, 1000)); 
        }
    }
}

getOrderList247(true).then(res => console.log(res)).catch(err => console.error(err));
