require('dotenv').config();

// Map status codes or names to Vietnamese labels with icons
const STATUS_MAP = {
    'DATIEPNHAN':     '📦 Đã tiếp nhận',
    'Nhập hệ thống':  '📦 Đã tiếp nhận',
    'DALAYHANG':      '🚚 Đã lấy hàng',
    'Đã lấy hàng':     '🚚 Đã lấy hàng',
    'DANGVANCHUYEN':  '🔄 Đang vận chuyển',
    'Đang vận chuyển': '🔄 Đang vận chuyển',
    'Đóng gói':        '📦 Đang đóng gói',
    'Đến bưu cục':     '🏬 Đã đến bưu cục',
    'Giao bưu tá phát': '🛵 Giao bưu tá',
    'DANGDIPHAT':     '🛵 Đang đi phát',
    'Đi phát':         '🛵 Đang đi phát',
    'PHATTHANHCONG':  '✅ Phát thành công',
    'Phát thành công': '✅ Phát thành công',
    'HOANVE':         '↩️ Hoàn về',
    'HUY':            '❌ Đã hủy',
};

async function trackOrder247(orderCode) {
    const apiKey = process.env.GH247_API_KEY;
    if (!apiKey) return { text: '⚠️ Chưa có GH247_API_KEY' };

    const url = `https://tracking.247express.vn/api/Order/v1/Tracking?ordercode=${encodeURIComponent(orderCode)}&apikey=${apiKey}`;
    console.log('🌐 Calling:', url);

    const res = await fetch(url);
    const d = await res.json();
    // console.log('📦 Raw response:', JSON.stringify(d, null, 2));

    if (d.errorCode || !d.orderCode) {
        return { text: `❌ Không tìm thấy đơn hàng "${orderCode}".` };
    }

    const latestStatus = d.statuses && d.statuses.length > 0
        ? d.statuses[d.statuses.length - 1] : null;
    const statusLabel = latestStatus
        ? (STATUS_MAP[latestStatus.statusName] || latestStatus.trackingName) : '---';

    const fmtDate = (iso) => {
        if (!iso) return '';
        const dt = new Date(iso);
        return `${dt.getDate().toString().padStart(2,'0')}/${(dt.getMonth()+1).toString().padStart(2,'0')} ${dt.getHours().toString().padStart(2,'0')}:${dt.getMinutes().toString().padStart(2,'0')}`;
    };

    let msg = `🔍 Vận đơn: ${d.orderCode}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📌 Trạng thái: ${statusLabel}\n`;
    if (d.realWeight) msg += `⚖️ Khối lượng: ${d.realWeight}g\n`;
    if (d.totalServiceCost) msg += `💰 Phí: ${Number(d.totalServiceCost).toLocaleString('vi-VN')}đ\n`;
    if (d.receiverName) msg += `\n📥 Người nhận: ${d.receiverName}\n`;
    
    if (Array.isArray(d.trackings) && d.trackings.length > 0) {
        msg += `\n📋 Hành trình:\n`;
        const recent = d.trackings.slice(-4).reverse();
        for (const t of recent) {
            const icon = (STATUS_MAP[t.statusName] || STATUS_MAP[t.trackingName]) 
                ? (STATUS_MAP[t.statusName] || STATUS_MAP[t.trackingName]).split(' ')[0] 
                : '▪️';
            const place = t.postOfficeName ? ` (${t.postOfficeName})` : '';
            msg += `${icon} ${t.statusName}${place} - ${fmtDate(t.dateChange)}\n`;
        }
    }

    const billImageUrl = (Array.isArray(d.confirmImage) && d.confirmImage.length > 0) 
        ? d.confirmImage[0] 
        : null;

    return { text: msg.trim(), imageUrl: billImageUrl };
}

// Lấy mã vận đơn từ command line
const orderCode = process.argv[2] || '90062162866';
console.log(`\n🧪 Testing tracking for: ${orderCode}\n`);

trackOrder247(orderCode).then(result => {
    console.log('\n=== KẾT QUẢ TIN NHẮN ===\n');
    console.log(result.text);
    if (result.imageUrl) {
        console.log(`\n🖼️ HÌNH ẢNH BILL: ${result.imageUrl}`);
    }
}).catch(err => {
    console.error('Error:', err);
});
