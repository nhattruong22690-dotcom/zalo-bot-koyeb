const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

// Re-using the logic from server.js
function parseOrderCommand(text) {
    const regex = /^taodon_([^_]+)_(\d+,\d+,\d+)_([^_]+)_{(.*?)}$/i;
    const match = text.match(regex);
    if (!match) return null;

    const project = match[1];
    const timeParts = match[2].split(',');
    const destination = match[3];
    const contentStr = match[4];

    const week = parseInt(timeParts[0]);
    const month = parseInt(timeParts[1]);
    const year = parseInt(timeParts[2]);

    const items = contentStr.split(';').map(part => {
        const [name, qty] = part.split(':').map(s => s.trim());
        if (name && qty) return { name, qty };
        return null;
    }).filter(item => item !== null);

    if (items.length === 0) return null;
    return { project, destination, items, week, month, year };
}

async function saveOrderToSheets(orderData) {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    const serviceAccountAuth = new JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await doc.loadInfo();

    let summarySheet = doc.sheetsByTitle['Orders'] || doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === 'orders');
    let detailSheet = doc.sheetsByTitle['OrderDetails'] || doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === 'orderdetails');

    const rows = await summarySheet.getRows();
    const periodPrefix = `W${orderData.week}-M${orderData.month}-Y${orderData.year}`;
    const existingInPeriod = rows.filter(r => 
        String(r.get('Week')) == String(orderData.week) && 
        String(r.get('Month')) == String(orderData.month) && 
        String(r.get('Year')) == String(orderData.year)
    );
    
    const nextSeq = existingInPeriod.length + 1;
    const orderId = `${periodPrefix}-${nextSeq}`;
    const timestamp = new Date().toLocaleString('vi-VN');
    
    // Save Summary
    await summarySheet.addRow({
        'OrderID': orderId,
        'Project': orderData.project,
        'Destination': orderData.destination,
        'Timestamp': timestamp,
        'Week': orderData.week,
        'Month': orderData.month,
        'Year': orderData.year,
        'Status': 'Mới tạo (Giả lập)'
    });

    // Save Details
    for (const item of orderData.items) {
        await detailSheet.addRow({
            'OrderID': orderId,
            'ProductName': item.name,
            'Quantity': item.qty
        });
    }

    return { orderId, timestamp, status: 'Mới tạo' };
}

async function simulate() {
    const fakeIncomingMessage = "taodon_cholimex_1,5,26_coopxlhn_{tương ớt 300:10; tương ớt 270:20}";
    console.log(`📩 [Zalo] Người dùng gửi: ${fakeIncomingMessage}`);

    const orderData = parseOrderCommand(fakeIncomingMessage);
    if (orderData) {
        console.log("⚙️  [Bot] Đang phân tích và lưu lên Google Sheets...");
        try {
            const saved = await saveOrderToSheets(orderData);
            
            // Format response (Same as in server.js)
            let reply = `✅ Đã tạo đơn hàng thành công!\n`;
            reply += `━━━━━━━━━━━━━━━━━━━\n`;
            reply += `🆔 Mã đơn: ${saved.orderId}\n`;
            reply += `🏗️ Dự án: ${orderData.project}\n`;
            reply += `📍 Nơi xuất: ${orderData.destination}\n`;
            reply += `📅 Thời gian: ${saved.timestamp}\n`;
            reply += `📌 Trạng thái: ${saved.status}\n\n`;
            reply += `📋 DANH SÁCH SẢN PHẨM:\n`;
            
            let table = "```\n";
            table += "STT | TÊN SẢN PHẨM          | SL\n";
            table += "----+-----------------------+----\n";
            orderData.items.forEach((item, idx) => {
                const stt = (idx + 1).toString().padEnd(3);
                const name = item.name.substring(0, 21).padEnd(21);
                const qty = item.qty.toString().padEnd(3);
                table += `${stt} | ${name} | ${qty}\n`;
            });
            table += "```";
            reply += table;

            console.log("\n💬 [Bot] Phản hồi gửi cho người dùng:");
            console.log("---------------------------------------");
            console.log(reply);
            console.log("---------------------------------------");
            console.log("✅ Quy trình giả lập hoàn tất!");
        } catch (err) {
            console.error("❌ Lỗi giả lập:", err.message);
        }
    } else {
        console.log("❌ Lệnh không đúng định dạng.");
    }
}

simulate();
