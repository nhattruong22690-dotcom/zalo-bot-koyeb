const { Zalo, ThreadType, GroupMessage, UserMessage } = require('zca-js');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const next = require('next');
const { Redis } = require('@upstash/redis');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const sharp = require('sharp');
const XLSX = require('xlsx');

dotenv.config();

// Cache to store the last uploaded file for each user/group
const lastFileCache = new Map();
// Store user states (e.g., 'MENU', 'WAITING_FILE')
const userState = new Map();

const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();

const PORT = process.env.PORT || 3000;
const SESSION_FILE = path.join(__dirname, 'session.json');

// Initialize Redis if credentials exist
const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    : null;

// Background tracking interval (30 minutes)
let autoTrackingTimer = null;
const NOTIFY_GROUP_KEY = 'config:notify_group_id';
const NOTIFY_TYPE_KEY = 'config:notify_group_type';
const TRACKING_PREFIX = 'track:247:status:';

let zaloApi = null;
let botStatus = 'disconnected';
let qrData = null;

// Normalize Vietnamese text for searching
function normalizeText(text) {
    if (!text) return '';
    return String(text)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .trim();
}

async function searchGoogleSheet(searchKey) {
    try {
        const sheetId = process.env.GOOGLE_SHEET_ID;
        const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

        if (!sheetId || !clientEmail || !privateKey) {
            return "⚠️ Hệ thống chưa cấu hình đầy đủ thông tin Google Sheet (ID, Email hoặc Private Key).";
        }

        const serviceAccountAuth = new JWT({
            email: clientEmail,
            key: privateKey,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();

        const normalizedKey = normalizeText(searchKey);
        const matches = rows.filter(row => {
            // Adjust column names based on your sheet
            const rowName = normalizeText(row.get('HỌ VÀ TÊN'));
            const rowPhone = normalizeText(row.get('SDT'));
            return rowName.includes(normalizedKey) || rowPhone.includes(normalizedKey);
        });

        if (matches.length > 0) {
            let result = `🔍 Tìm thấy ${matches.length} kết quả cho "${searchKey}":\n\n`;
            const limit = Math.min(matches.length, 5);

            for (let i = 0; i < limit; i++) {
                const m = matches[i];
                const data = m.toObject();
                console.log("📄 Sheet Row Data:", JSON.stringify(data));

                // Helper to get value regardless of case/spaces in header
                const getVal = (possibleNames) => {
                    for (const name of possibleNames) {
                        const key = Object.keys(data).find(k => normalizeText(k) === normalizeText(name));
                        if (key && data[key]) return data[key];
                    }
                    return '---';
                };

                result += `👤 ${getVal(['HỌ VÀ TÊN', 'Tên', 'Name'])}\n`;
                result += `📅 ${getVal(['NĂM SINH', 'Năm', 'Year'])}\n`;
                result += `💳 ${getVal(['CMND', 'CCCD', 'ID'])}\n`;
                result += `📞 ${getVal(['SDT', 'SĐT', 'Phone'])}\n`;
                result += `📍 ${getVal(['ĐỊA CHỈ', 'Địa chỉ', 'Address'])}\n`;
                result += `📝 ${getVal(['N1', 'CHÚ THÍCH', 'Ghi chú', 'Note', 'Thông tin thêm'])}\n`;
                result += `======================================\n`;
            }

            if (matches.length > limit) {
                result += `*(Vẫn còn ${matches.length - limit} kết quả khác)*`;
            }
            return result.trim();
        } else {
            return `❌ Không tìm thấy thông tin nào cho "${searchKey}".`;
        }
    } catch (err) {
        console.error('Google Sheets Error:', err.message);
        return `⚠️ Lỗi tra cứu dữ liệu: ${err.message}`;
    }
}

// --- 247Express Helper Functions ---
const STATUS_MAP_247 = {
    'DATIEPNHAN': '📝 Đã tiếp nhận',
    'Nhập hệ thống': '📝 Đã tiếp nhận',
    'DALAYHANG': '📦 Đã lấy hàng',
    'Đã lấy hàng': '📦 Đã lấy hàng',
    'DANGVANCHUYEN': '🚚 Đang vận chuyển',
    'Đang vận chuyển': '🚚 Đang vận chuyển',
    'Đóng gói': '📦 Đang đóng gói',
    'Đến bưu cục': '🏬 Đã đến bưu cục',
    'Giao bưu tá phát': '🛵 Giao bưu tá',
    'DANGDIPHAT': '🛵 Đang đi phát',
    'Đi phát': '🛵 Đang đi phát',
    'PHATTHANHCONG': '✅ Phát thành công',
    'Phát thành công': '✅ Phát thành công',
    'HOANVE': '↩️ Hoàn về',
    'HUY': '❌ Đã hủy',
};

async function trackOrder247(orderCode) {
    const apiKey = process.env.GH247_API_KEY;
    const clientId = process.env.GH247_CLIENT_ID;
    const token = process.env.GH247_TOKEN;

    if (!apiKey) return '⚠️ Chưa có GH247_API_KEY trong .env';

    let address = '';
    let totalFee = 0;

    // --- Phase 1: Try to get detailed info from Internal Search API (for Address and Cost) ---
    if (clientId && token) {
        try {
            const searchUrl = 'https://customer-api.247express.vn/api/Order/SearchCPNOrders';
            const searchPayload = {
                "ClientID": parseInt(clientId),
                "OrderCode": orderCode,
                "FromDate": "2026-01-01T00:00:00", // Wide range to find the order
                "ToDate": "2026-12-31T23:59:59"
            };
            const searchRes = await fetch(searchUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'ClientID': clientId, 'token': token },
                body: JSON.stringify(searchPayload)
            });
            const searchData = await searchRes.json();
            if (searchData.orders && searchData.orders.length > 0) {
                const o = searchData.orders[0];
                address = o.receiverAddress || '';
                totalFee = o.totalCost || 0;
            }
        } catch (e) {
            console.error("Lỗi fetch SearchCPNOrders:", e.message);
        }
    }

    // --- Phase 2: Get Tracking Info (for Status and Journey) ---
    const url = `https://tracking.247express.vn/api/Order/v1/Tracking?ordercode=${encodeURIComponent(orderCode)}&apikey=${apiKey}`;
    const res = await fetch(url);
    const d = await res.json();

    if (d.errorCode || !d.orderCode) return `❌ Không tìm thấy đơn hàng "${orderCode}".`;

    // Use totalServiceCost from tracking if search API didn't provide it
    if (!totalFee) totalFee = d.totalServiceCost || 0;

    const latestStatus = d.statuses && d.statuses.length > 0 ? d.statuses[d.statuses.length - 1] : null;
    const statusLabel = latestStatus ? (STATUS_MAP_247[latestStatus.statusName] || latestStatus.trackingName) : '---';

    const fmtDate = (iso) => {
        if (!iso) return '';
        try {
            const dt = new Date(iso);
            // Ép múi giờ Việt Nam (GMT+7)
            const formatter = new Intl.DateTimeFormat('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            const parts = formatter.formatToParts(dt);
            const find = (type) => parts.find(p => p.type === type).value;
            return `${find('day')}/${find('month')} ${find('hour')}:${find('minute')}`;
        } catch (e) {
            return iso;
        }
    };

    const isDelivered = d.status === '30' || d.statusName === 'PHATTHANHCONG';
    const receiverLabel = isDelivered ? '📥 Người nhận thực tế' : '📥 Người nhận (theo bill)';

    let msg = `🔍 Vận đơn: ${d.orderCode}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📌 Trạng thái: ${statusLabel}\n`;
    if (d.realWeight) msg += `⚖️ Khối lượng: ${d.realWeight}g\n`;
    if (d.quantity) msg += `📦 Số lượng kiện: ${d.quantity}\n`;
    if (d.receiverName) msg += `${receiverLabel}: ${d.receiverName}\n`;
    if (address) msg += `📍 Địa chỉ: ${address}\n`;
    if (totalFee) msg += `💰 Tổng cước: ${Number(totalFee).toLocaleString('vi-VN')}đ\n`;

    if (Array.isArray(d.trackings) && d.trackings.length > 0) {
        msg += `\n📋 Hành trình:\n`;
        const allTrackings = [...d.trackings].reverse();
        for (const t of allTrackings) {
            const icon = (STATUS_MAP_247[t.statusName] || STATUS_MAP_247[t.trackingName]) ? (STATUS_MAP_247[t.statusName] || STATUS_MAP_247[t.trackingName]).split(' ')[0] : '▪️';
            const location = t.postOfficeName || t.provinceName || '';
            const noteStr = t.notes ? ` (${t.notes})` : '';
            msg += `${icon} ${t.statusName}${location ? ' tại ' + location : ''}${noteStr} - ${fmtDate(t.dateChange)}\n`;
        }
    }

    const billImageUrl = (Array.isArray(d.confirmImage) && d.confirmImage.length > 0) ? d.confirmImage[0] : null;
    if (billImageUrl) msg += `\n🖼️ Ảnh bill: ${billImageUrl}`;

    return msg.trim();
}

async function getOrderList247(showAll = false, fromDate = '2026-01-01T00:00:00', toDate = '2026-12-31T23:59:59') {
    const clientId = process.env.GH247_CLIENT_ID;
    const token = process.env.GH247_TOKEN;
    if (!clientId || !token) return '⚠️ Thiếu GH247_CLIENT_ID hoặc TOKEN trong .env';

    const url = 'https://customer-api.247express.vn/api/Order/SearchCPNOrders';
    const payload = {
        "ClientHubID": 0, "ClientID": parseInt(clientId), "PageIndex": 0, "PageSize": 50,
        "FromDate": fromDate,
        "ToDate": toDate
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
                    orders = orders.filter(o => o.status != "30"); // Chỉ đơn đang giao
                }

                if (orders.length === 0) return showAll ? "📭 Hiện chưa có vận đơn nào." : "✅ Tất cả đơn hàng đã giao thành công!";
                
                let reply = showAll ? `📋 TẤT CẢ VẬN ĐƠN 247\n` : `🚚 ĐƠN HÀNG ĐANG GIAO\n`;
                reply += `━━━━━━━━━━━━━━━━━━━\n`;
                orders.slice(0, 15).forEach((o, i) => {
                    const rawStatus = (o.status == "30") ? "✅ Thành công" : (o.statusName || '---');
                    const status = STATUS_MAP_247[rawStatus] || rawStatus; // Áp dụng icon nếu có
                    const receiver = o.receiverName || '---';
                    const address = o.receiverAddress || o.receiverProvinceName || '---';
                    reply += `${i + 1}. ${o.orderCode} - ${receiver} - ${address} - ${status}\n\n`;
                });
                return reply.trim();
            }
            return `❌ Lỗi từ API: ${data.errorMessage || 'Không thể lấy danh sách'}`;
        } catch (err) {
            attempts++;
            console.error(`❌ Lỗi lấy danh sách (Lần ${attempts}):`, err.message);
            if (attempts >= 2) throw err;
            await new Promise(r => setTimeout(r, 1000)); // Thử lại sau 1s
        }
    }
}

async function runAutoTracking(api) {
    if (!redis) {
        console.log("⚠️ Redis not configured. Auto-tracking disabled.");
        return;
    }

    try {
        const targetGroupId = await redis.get(NOTIFY_GROUP_KEY);
        const targetType = await redis.get(NOTIFY_TYPE_KEY) || ThreadType.Group;
        if (!targetGroupId) {
            console.log("ℹ️ No notification target set. Use 'setnotify' in a chat.");
            return;
        }

        console.log("🕒 Running auto-tracking scan...");
        // Get orders for current month
        const now = new Date();
        const fromDate = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-01T00:00:00`;
        const toDate = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-31T23:59:59`;
        
        const clientId = process.env.GH247_CLIENT_ID;
        const token = process.env.GH247_TOKEN;
        const url = 'https://customer-api.247express.vn/api/Order/SearchCPNOrders';
        const payload = {
            "ClientHubID": 0, "ClientID": parseInt(clientId), "PageIndex": 0, "PageSize": 100,
            "FromDate": fromDate, "ToDate": toDate
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ClientID': clientId, 'token': token },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (res.ok && data.orders) {
            console.log(`📦 Found ${data.orders.length} orders in month ${now.getMonth() + 1}/${now.getFullYear()}`);
            let changeCount = 0;

            for (const o of data.orders) {
                const orderCode = o.orderCode;
                const currentStatus = o.statusName || '---';
                const redisKey = `${TRACKING_PREFIX}${orderCode}`;
                
                const oldStatus = await redis.get(redisKey);
                
                if (oldStatus && oldStatus !== currentStatus) {
                    changeCount++;
                    // Status changed! Notify.
                    const icon = (STATUS_MAP_247[currentStatus]) ? STATUS_MAP_247[currentStatus].split(' ')[0] : '🔔';
                    let msg = `🔔 **CẬP NHẬT ĐƠN HÀNG**\n`;
                    msg += `━━━━━━━━━━━━━━━━━━━\n`;
                    msg += `📦 Mã đơn: ${orderCode}\n`;
                    msg += `👤 Người nhận: ${o.receiverName || '---'}\n`;
                    msg += `🔄 Trạng thái: ${icon} ${currentStatus}\n`;
                    msg += `📍 Vị trí: ${o.receiverProvinceName || '---'}\n`;
                    msg += `━━━━━━━━━━━━━━━━━━━\n`;
                    msg += `👉 Nhắn mã đơn để xem chi tiết hành trình.`;

                    await api.sendMessage({ msg }, targetGroupId, targetType == 'Group' ? ThreadType.Group : ThreadType.User);
                    console.log(`✅ NOTIFIED: ${orderCode} (${oldStatus} -> ${currentStatus})`);
                }
                
                // Update Redis with current status
                await redis.set(redisKey, currentStatus, { ex: 60 * 60 * 24 * 7 });
            }
            console.log(`🏁 Scan finished. Detected ${changeCount} changes.`);
        } else {
            console.log("❌ No orders found or API error:", data.errorMessage);
        }
    } catch (err) {
        console.error("❌ Auto-tracking error:", err.message);
    }
}

function parseOrderCommand(text) {
    // Pattern: taodon_[project]_[w,m,y]_[destination]_{[content]}
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
    try {
        console.log(`📝 Starting to save order: W${orderData.week}-M${orderData.month}-Y${orderData.year}`);
        const sheetId = process.env.GOOGLE_SHEET_ID;
        const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

        if (!sheetId || !clientEmail || !privateKey) {
            throw new Error("Chưa cấu hình Google Sheet");
        }

        const serviceAccountAuth = new JWT({
            email: clientEmail,
            key: privateKey,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();

        // 1. Save to Summary Sheet (Orders)
        let summarySheet = doc.sheetsByTitle['Orders'] ||
            doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === 'orders');

        if (!summarySheet) throw new Error("Không tìm thấy sheet 'Orders'. Vui lòng tạo tab có tên là 'Orders'");
        console.log(`✅ Found Summary Sheet by Name: ${summarySheet.title}`);

        // Ensure headers for Summary
        try {
            await summarySheet.loadHeaderRow();
            const headers = summarySheet.headerValues;
            if (!headers.includes('OrderID')) {
                await summarySheet.setHeaderRow(['OrderID', 'Project', 'Destination', 'Timestamp', 'Week', 'Month', 'Year', 'Thời gian xuất', 'Status']);
            }
        } catch (e) {
            await summarySheet.setHeaderRow(['OrderID', 'Project', 'Destination', 'Timestamp', 'Week', 'Month', 'Year', 'Thời gian xuất', 'Status']);
        }

        const rows = await summarySheet.getRows();
        const periodPrefix = `W${orderData.week}-M${orderData.month}-Y${orderData.year}`;
        const existingInPeriod = rows.filter(r =>
            String(r.get('Week')) == String(orderData.week) &&
            String(r.get('Month')) == String(orderData.month) &&
            String(r.get('Year')) == String(orderData.year)
        );

        const nextSeq = existingInPeriod.length + 1;
        const orderId = `${periodPrefix}-${nextSeq}`;
        const now = new Date();
        const timestamp = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        
        // Format exportTime as DD/MM/YYYY HH:mm in VN timezone
        const vnOptions = { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
        const vnFmt = new Intl.DateTimeFormat('vi-VN', vnOptions).formatToParts(now);
        const getV = (t) => vnFmt.find(p => p.type === t).value;
        const exportTime = orderData.exportTime || `${getV('day')}/${getV('month')}/${getV('year')} ${getV('hour')}:${getV('minute')}`;

        await summarySheet.addRow({
            'OrderID': orderId,
            'Project': orderData.project.toLowerCase(),
            'Destination': orderData.destination.toLowerCase(),
            'Timestamp': timestamp,
            'Week': orderData.week,
            'Month': orderData.month,
            'Year': orderData.year,
            'Thời gian xuất': exportTime,
            'Status': 'mới tạo'
        });
        console.log(`✅ Added to Orders: ${orderId}`);

        // 2. Save to Detail Sheet (OrderDetails)
        let detailSheet = doc.sheetsByTitle['OrderDetails'] ||
            doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === 'orderdetails');

        if (!detailSheet) throw new Error("Không tìm thấy sheet 'OrderDetails'. Vui lòng tạo tab có tên là 'OrderDetails'");
        console.log(`✅ Found Detail Sheet by Name: ${detailSheet.title}`);

        // Ensure headers for Details
        try {
            await detailSheet.loadHeaderRow();
            const dHeaders = detailSheet.headerValues;
            if (!dHeaders.includes('OrderID')) {
                await detailSheet.setHeaderRow(['OrderID', 'ProductName', 'Quantity']);
            }
        } catch (e) {
            await detailSheet.setHeaderRow(['OrderID', 'ProductName', 'Quantity']);
        }

        console.log(`📦 Adding ${orderData.items.length} items to ${detailSheet.title}...`);
        for (const item of orderData.items) {
            await detailSheet.addRow({
                'OrderID': orderId,
                'ProductName': item.name.toLowerCase(),
                'Quantity': item.qty
            });
        }
        console.log(`✅ All items saved successfully to ${detailSheet.title}`);

        return { orderId, timestamp, status: 'Mới tạo' };
    } catch (err) {
        console.error('❌ Save Order Error:', err.message);
        throw err;
    }
}

async function processExcelFile(filePath, globalInfo = {}) {
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        if (rows.length < 2) throw new Error("File Excel không có dữ liệu hoặc sai định dạng.");

        const headers = rows[0];
        const isMatrix = headers[1] !== 'Thời gian' && headers[1] !== 'Time';

        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, new JWT({
            email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        }));
        await doc.loadInfo();

        let summarySheet = doc.sheetsByTitle['Orders'] || doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === 'orders');
        let detailSheet = doc.sheetsByTitle['OrderDetails'] || doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === 'orderdetails');

        // Load existing rows to calculate sequence
        const existingRows = await summarySheet.getRows();
        const week = globalInfo.week || 1;
        const month = globalInfo.month || 1;
        const year = globalInfo.year || 26;

        const existingInPeriod = existingRows.filter(r =>
            String(r.get('Week')) == String(week) &&
            String(r.get('Month')) == String(month) &&
            String(r.get('Year')) == String(year)
        );
        let nextSeq = existingInPeriod.length + 1;

        const summaryRowsToAdd = [];
        const detailRowsToAdd = [];
        const now = new Date();
        const timestamp = now.toLocaleString('vi-VN');
        const defaultExportTime = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        if (isMatrix) {
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const destination = row[0];
                if (!destination) continue;

                const items = [];
                for (let j = 1; j < headers.length; j++) {
                    const productName = headers[j];
                    const qty = row[j];
                    if (productName && qty && !isNaN(qty) && Number(qty) > 0) {
                        items.push({ name: String(productName), qty: String(qty) });
                    }
                }

                if (items.length > 0) {
                    const orderId = `W${week}-M${month}-Y${year}-${nextSeq++}`;
                    summaryRowsToAdd.push({
                        'OrderID': orderId,
                        'Project': (globalInfo.project || 'CHOLIMEX').toLowerCase(),
                        'Destination': String(destination).toLowerCase(),
                        'Timestamp': timestamp,
                        'Week': week,
                        'Month': month,
                        'Year': year,
                        'Thời gian xuất': defaultExportTime,
                        'Status': 'mới tạo (bulk)'
                    });

                    items.forEach(item => {
                        detailRowsToAdd.push({
                            'OrderID': orderId,
                            'ProductName': item.name.toLowerCase(),
                            'Quantity': item.qty
                        });
                    });
                }
            }
        } else {
            // Standard Row Format
            const data = XLSX.utils.sheet_to_json(worksheet);
            for (const row of data) {
                const project = row['Dự án'] || row['Project'] || globalInfo.project;
                const timeStr = String(row['Thời gian'] || row['Time'] || globalInfo.timeStr);
                const destination = row['Nơi đến'] || row['Destination'];
                const content = row['Nội dung'] || row['Content'];
                const exportTime = row['Thời gian xuất'] || row['Export Time'] || defaultExportTime;

                if (!project || !timeStr || !destination || !content) continue;

                const timeParts = timeStr.split(',');
                const orderId = `W${timeParts[0]}-M${timeParts[1]}-Y${timeParts[2]}-${nextSeq++}`;

                summaryRowsToAdd.push({
                    'OrderID': orderId,
                    'Project': project.toLowerCase(),
                    'Destination': destination.toLowerCase(),
                    'Timestamp': timestamp,
                    'Week': timeParts[0],
                    'Month': timeParts[1],
                    'Year': timeParts[2],
                    'Thời gian xuất': exportTime,
                    'Status': 'mới tạo (bulk)'
                });

                content.split(';').forEach(part => {
                    const [name, qty] = part.split(':').map(s => s.trim());
                    if (name && qty) {
                        detailRowsToAdd.push({ 'OrderID': orderId, 'ProductName': name.toLowerCase(), 'Quantity': qty });
                    }
                });
            }
        }

        // BATCH WRITE to Google Sheets
        if (summaryRowsToAdd.length > 0) {
            console.log(`🚀 Bulk pushing ${summaryRowsToAdd.length} orders and ${detailRowsToAdd.length} items...`);
            await summarySheet.addRows(summaryRowsToAdd);
            await detailSheet.addRows(detailRowsToAdd);
            return { successCount: summaryRowsToAdd.length, failCount: 0 };
        }

        return { successCount: 0, failCount: 0 };
    } catch (err) {
        console.error("Excel processing error:", err.message);
        throw err;
    }
}

// Map status codes or names to Vietnamese labels with icons
const STATUS_MAP = {
    'DATIEPNHAN': '📦 Đã tiếp nhận',
    'Nhập hệ thống': '📦 Đã tiếp nhận',
    'DALAYHANG': '🚚 Đã lấy hàng',
    'Đã lấy hàng': '🚚 Đã lấy hàng',
    'DANGVANCHUYEN': '🔄 Đang vận chuyển',
    'Đang vận chuyển': '🔄 Đang vận chuyển',
    'Đóng gói': '📦 Đang đóng gói',
    'Đến bưu cục': '🏬 Đã đến bưu cục',
    'Giao bưu tá phát': '🛵 Giao bưu tá',
    'DANGDIPHAT': '🛵 Đang đi phát',
    'Đi phát': '🛵 Đang đi phát',
    'PHATTHANHCONG': '✅ Phát thành công',
    'Phát thành công': '✅ Phát thành công',
    'HOANVE': '↩️ Hoàn về',
    'HUY': '❌ Đã hủy',
};

async function startBot(api) {
    zaloApi = api;
    botStatus = 'connected';
    io.emit('status', { status: botStatus });

    const cookie = api.getCookie();
    // Save to Redis if available, else local file
    if (redis) {
        await redis.set('zalo_session', JSON.stringify(cookie));
        console.log("Session saved to Redis");
    } else {
        fs.writeFileSync(SESSION_FILE, JSON.stringify(cookie));
        console.log("Session saved to local file");
    }

    api.listener.on("message", async (message) => {
        console.log("📩 New Message:", JSON.stringify(message));

        const targetId = String(message.threadId);
        const senderId = String(message.data.uidFrom || message.data.senderId || message.threadId);

        // Foolproof Group Detection: If threadId != senderId, it MUST be a group
        const isGroup = targetId !== senderId;
        const stateKey = isGroup ? `${targetId}_${senderId}` : targetId;

        console.log(`🎯 Detected: ${isGroup ? 'GROUP' : 'PRIVATE'} | Thread: ${targetId} | Sender: ${senderId} | StateKey: ${stateKey}`);
        const isPlainText = typeof message.data.content === "string";
        let text = isPlainText ? message.data.content : (message.data.content?.text || message.data.content?.title || "");

        // --- NEW: Menu Mode Logic ---
        const currentState = userState.get(stateKey);

        // --- Global Exit Command (Context-Aware) ---
        const exitKeywords = ['thoat', 'tat', 'exit', 'stop', 'quit'];
        if (exitKeywords.includes(text.toLowerCase().trim())) {
            let exitMsg = "👋 Đã thoát chế độ Menu.";
            if (currentState && currentState.startsWith('BOT247_')) {
                exitMsg = "🤖 BOT247 đã dừng.";
            } else if (currentState === 'MENU') {
                exitMsg = "🤖 Menu đã dừng.";
            }
            userState.delete(stateKey);
            await api.sendMessage({ msg: exitMsg }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
            return;
        }

        // Handle 'menu' or 'start' command, or '0' only if NO state is active
        if (text.toLowerCase() === 'menu' || text.toLowerCase() === 'start' || (text === '0' && !currentState)) {
            userState.set(stateKey, 'MENU');
            let reply = "🤖 CHÀO MỪNG BẠN ĐẾN VỚI MENU ĐIỀU KHIỂN 🤖\n\n";
            reply += "Vui lòng nhắn số tương ứng với lệnh bạn muốn:\n";
            reply += "----------------------------\n";
            reply += "1️⃣  Nhập đơn hàng hàng loạt\n";
            reply += "2️⃣  Xem danh sách đơn hàng\n";
            reply += "3️⃣  Xem chi tiết đơn hàng (chitiet)\n";
            reply += "4️⃣  Chỉnh sửa/Xóa đơn hàng\n";
            reply += "5️⃣  Kiểm tra tình trạng hệ thống\n";
            reply += "6️⃣  Tra cứu thông tin siêu thị (check)\n";
            reply += "----------------------------\n";
            reply += "💡 Cú pháp: chitiet [MãĐơn] (VD: chitiet W1-M5-Y26-10)\n";
            reply += "👉 Nhắn '0' để quay lại Menu này bất cứ lúc nào.";

            await api.sendMessage({ msg: reply }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
            return;
        }

        if (currentState === 'MENU') {
            if (text === '1') {
                userState.delete(stateKey); 
                text = 'taodon';
            } else if (text === '2') {
                await api.sendMessage({ msg: "🔍 Bạn muốn xem dự án nào? Nhắn theo cú pháp: xem [DựÁn] [Tuần,Tháng,Năm]\nVD: xem cholimex 1,5,26" }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                userState.delete(stateKey);
                return;
            } else if (text === '3') {
                await api.sendMessage({ msg: "📄 Nhắn: chitiet [MãĐơn]\nVD: chitiet W1-M5-Y26-10" }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                userState.delete(stateKey);
                return;
            } else if (text === '4') {
                await api.sendMessage({ msg: "🛠️ Nhắn lệnh sửa đơn của bạn.\nVD: sua [MãĐơn] them [sản phẩm]:[số lượng]" }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                userState.delete(stateKey);
                return;
            } else if (text === '5') {
                text = 'tinhtrang';
                userState.delete(stateKey);
            } else if (text === '6') {
                await api.sendMessage({ msg: "🔎 Nhắn 'check [tên siêu thị]' để tôi tìm cho bạn." }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                userState.delete(stateKey);
                return;
            } else if (text === '0') {
                text = 'menu'; // Refresh main menu
            } else if (/^\d+$/.test(text)) {
                await api.sendMessage({ msg: "⚠️ Lựa chọn không hợp lệ. Vui lòng chọn số từ 1 đến 6, hoặc nhắn 'thoat' để dừng Bot." }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                return;
            }
        }

        // --- BOT247 Sub-Menu Logic ---
        if (currentState === 'BOT247_MENU') {
            if (text === '1') {
                text = '__cmd_danhsach';
            } else if (text === '2') {
                text = '__cmd_danhsach all';
            } else if (text === '3') {
                userState.set(stateKey, 'BOT247_SEARCH');
                await api.sendMessage({ msg: "🔍 Mời bạn nhập Mã Vận Đơn (11 chữ số) để tra cứu.\n👉 Nhắn '0' để quay lại Menu bot247." }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                return;
            } else if (text === '4') {
                userState.set(stateKey, 'BOT247_MONTH');
                await api.sendMessage({ msg: "📅 Mời bạn nhập Tháng và Năm theo định dạng: [Tháng,Năm] (vd: 5,26)\n👉 Nhắn '0' để quay lại Menu bot247." }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                return;
            } else if (text === '0') {
                text = 'bot247'; // Refresh BOT247 menu
            } else if (/^\d+$/.test(text)) {
                await api.sendMessage({ msg: "⚠️ Lựa chọn không hợp lệ. Vui lòng chọn số từ 1 đến 4, hoặc nhắn 'thoat' để dừng BOT247." }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                return;
            }
        }

        // --- BOT247 Month Search Logic ---
        if (currentState === 'BOT247_MONTH') {
            if (text === '0') {
                userState.set(stateKey, 'BOT247_MENU');
                text = 'bot247'; // Refresh menu
            } else if (/^\d{1,2},\d{2}$/.test(text)) {
                text = `__cmd_danhsach ${text}`;
                userState.set(stateKey, 'BOT247_MENU'); // Reset state after search
            } else {
                await api.sendMessage({ msg: "⚠️ Định dạng không đúng. Vui lòng nhập [Tháng,Năm] (vd: 5,26) hoặc nhắn '0' để quay lại." }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                return;
            }
        }
        
        // --- BOT247 Search Logic ---
        if (currentState === 'BOT247_SEARCH') {
            if (text === '0') {
                text = 'bot247';
                userState.set(stateKey, 'BOT247_MENU');
            }
        }
        // --- END: BOT247 Sub-Menu Logic ---
        // --- END: Menu Mode Logic ---

        // Handle 'taodon' command
        if (text.toLowerCase() === 'taodon') {
            let reply = "👋 Chào bạn! Tôi đã sẵn sàng nhận đơn hàng hàng loạt.\n\n";
            reply += "1️⃣ Bước 1: Bạn hãy gửi file Excel đơn hàng cho tôi.\n";
            reply += "2️⃣ Bước 2: Tôi sẽ xác nhận và hướng dẫn bạn nhập lệnh để bắt đầu.\n\n";
            reply += "💡 Lưu ý: File Excel nên theo định dạng Ma trận (Cột A là Nơi nhận, Dòng 1 là Sản phẩm).";

            await api.sendMessage({ msg: reply }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
            return;
        }

        // Handle 'sua ' command (Edit Order)
        if (text.toLowerCase().startsWith('sua ')) {
            const editRegex = /sua\s+([^\s]+)\s+([^\s]+)\s+(.+)/i;
            const deleteOrderRegex = /sua\s+([^\s]+)\s+xoadon/i;

            const editMatch = text.match(editRegex);
            const deleteMatch = text.match(deleteOrderRegex);

            try {
                const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, new JWT({
                    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
                }));
                await doc.loadInfo();
                let summarySheet = doc.sheetsByTitle['Orders'] || doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === 'orders');
                let detailSheet = doc.sheetsByTitle['OrderDetails'] || doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === 'orderdetails');

                // --- Case 1: Delete Entire Order ---
                if (deleteMatch) {
                    const orderId = deleteMatch[1].toUpperCase();
                    await api.sendMessage({ msg: `⌛ Đang xóa toàn bộ đơn hàng ${orderId}...` }, targetId, isGroup ? ThreadType.Group : ThreadType.User);

                    // Delete from Orders
                    const orderRows = await summarySheet.getRows();
                    const orderRow = orderRows.find(r => r.get('OrderID') === orderId);
                    if (orderRow) await orderRow.delete();

                    // Delete from OrderDetails
                    const detailRows = await detailSheet.getRows();
                    const detailsToDelete = detailRows.filter(r => r.get('OrderID') === orderId);
                    for (const r of detailsToDelete) await r.delete();

                    await api.sendMessage({ msg: `✅ Đã xóa đơn hàng ${orderId} thành công.\n\n👉 Nhắn '0' để quay lại Menu.` }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                    return;
                }

                // --- Case 2: Add/Update or Delete Items ---
                if (editMatch) {
                    const orderId = editMatch[1].toUpperCase();
                    const action = editMatch[2].toLowerCase(); // 'them' or 'xoa'
                    const content = editMatch[3];

                    await api.sendMessage({ msg: `⌛ Đang thực hiện ${action === 'them' ? 'thêm/sửa' : 'xóa'} sản phẩm cho đơn ${orderId}...` }, targetId, isGroup ? ThreadType.Group : ThreadType.User);

                    const detailRows = await detailSheet.getRows();

                    if (action === 'them') {
                        const items = content.split(';').map(p => {
                            const [name, qty] = p.split(':').map(s => s.trim());
                            return (name && qty) ? { name: name.toLowerCase(), qty } : null;
                        }).filter(i => i !== null);

                        for (const item of items) {
                            const existingItem = detailRows.find(r => r.get('OrderID') === orderId && r.get('ProductName')?.toLowerCase() === item.name);
                            if (existingItem) {
                                existingItem.set('Quantity', item.qty);
                                await existingItem.save();
                            } else {
                                await detailSheet.addRow({ 'OrderID': orderId, 'ProductName': item.name, 'Quantity': item.qty });
                            }
                        }
                        await api.sendMessage({ msg: `✅ Đã cập nhật xong ${items.length} sản phẩm cho đơn ${orderId}.\n\n👉 Nhắn '0' để quay lại Menu.` }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                    } else if (action === 'xoa') {
                        const productNames = content.split(';').map(s => s.trim().toLowerCase());
                        let count = 0;
                        for (const name of productNames) {
                            const itemsToDelete = detailRows.filter(r => r.get('OrderID') === orderId && r.get('ProductName')?.toLowerCase() === name);
                            for (const r of itemsToDelete) {
                                await r.delete();
                                count++;
                            }
                        }
                        let reply = count > 0
                            ? `✅ Đã xóa ${count} sản phẩm khỏi đơn ${orderId}.`
                            : `📭 Không tìm thấy sản phẩm nào để xóa trong đơn ${orderId}.`;

                        await api.sendMessage({ msg: reply + "\n\n👉 Nhắn '0' để quay lại Menu." }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                    }
                    return;
                }

                await api.sendMessage({ msg: "❌ Sai cú pháp. Vui lòng dùng:\n- sua [MãĐơn] them [SP:SL;...]\n- sua [MãĐơn] xoa [SP;...]\n- sua [MãĐơn] xoadon\n\n👉 Nhắn '0' để quay lại Menu." }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
            } catch (err) {
                console.error("Edit error:", err);
                await api.sendMessage({ msg: `⚠️ Lỗi: ${err.message}` }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
            }
            return;
        }

        // Handle 'xem ' command (View Orders)
        if (text.toLowerCase().startsWith('xem ')) {
            const xemRegex = /xem\s+([^\s]+)\s+(\d+,\d+,\d+)/i;
            const xemMatch = text.match(xemRegex);

            if (xemMatch) {
                try {
                    const project = xemMatch[1].toLowerCase();
                    const [week, month, year] = xemMatch[2].split(',');

                    await api.sendMessage({ msg: `🔍 Đang tra cứu đơn hàng dự án [${project.toUpperCase()}] Tuần ${week}, Tháng ${month}, Năm ${year}...` }, targetId, isGroup ? ThreadType.Group : ThreadType.User);

                    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, new JWT({
                        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                        key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
                    }));
                    await doc.loadInfo();
                    let summarySheet = doc.sheetsByTitle['Orders'] || doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === 'orders');

                    const rows = await summarySheet.getRows();
                    const filtered = rows.filter(r =>
                        r.get('Project')?.toLowerCase() === project &&
                        String(r.get('Week')) === week &&
                        String(r.get('Month')) === month &&
                        String(r.get('Year')) === year
                    );

                    if (filtered.length === 0) {
                        await api.sendMessage({ msg: `📭 Không tìm thấy đơn hàng nào cho dự án "${project}" trong thời gian này.\n\n👉 Nhắn '0' để quay lại Menu.` }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                        return;
                    }

                    let reply = `📋 DANH SÁCH ĐƠN HÀNG (${filtered.length} đơn):\n`;
                    reply += `----------------------------\n`;
                    filtered.forEach((r, idx) => {
                        const dest = r.get('Destination') || 'N/A';
                        const status = r.get('Status') || 'mới tạo';
                        const id = r.get('OrderID');
                        reply += `${idx + 1}. ${dest.toUpperCase()}\n   🆔 ${id} | 🚩 ${status}\n\n`;
                    });
                    reply += `----------------------------\n`;
                    reply += `💡 Gợi ý: Nhắn 'chitiet [MãĐơn]' để xem hàng bên trong.\n`;
                    reply += `👉 Nhắn '0' để quay lại Menu.`;

                    await api.sendMessage({ msg: reply }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                    return;
                } catch (err) {
                    console.error("View error:", err);
                    await api.sendMessage({ msg: `⚠️ Lỗi khi tra cứu: ${err.message}` }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                }
            } else {
                await api.sendMessage({ msg: "❌ Sai cú pháp. Vui lòng dùng: xem [DựÁn] [Tuần,Tháng,Năm]\nVí dụ: xem cholimex 1,5,26\n\n👉 Nhắn '0' để quay lại Menu." }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
            }
            return;
        }

        // --- NEW: Robust File Detection ---
        let excelFile = null;
        const msgType = message.data.msgType;

        // Check for attachments in standard content
        if (message.data.content?.attachments && message.data.content.attachments.length > 0) {
            excelFile = message.data.content.attachments.find(a => a.name?.toLowerCase().endsWith('.xlsx') || a.type === 'file');
        }
        // Check if the content itself is a file object (common in share.file type)
        else if (message.data.content?.href && (
            msgType === 'share.file' ||
            message.data.content.title?.toLowerCase().endsWith('.xlsx') ||
            message.data.content.type === 'file'
        )) {
            excelFile = {
                url: message.data.content.href,
                name: message.data.content.title || 'import.xlsx'
            };
        }

        if (excelFile && excelFile.url) {
            console.log("📎 Detected Excel File, caching for thread:", targetId);
            lastFileCache.set(targetId, {
                url: excelFile.url,
                name: excelFile.name,
                timestamp: Date.now()
            });
            // If there's no command in this message, just acknowledge
            if (!text.toLowerCase().includes('nhap ')) {
                let reply = `✅ Đã nhận file: ${excelFile.name}\n\n`;
                reply += `Bây giờ, bạn hãy nhắn tin theo cú pháp sau để tôi bắt đầu nhập dữ liệu:\n`;
                reply += `👉 nhap [DựÁn] [Tuần,Tháng,Năm]\n\n`;
                reply += `Ví dụ: nhap cholimex 1,5,26`;
                await api.sendMessage({ msg: reply }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
            }
        }

        // Handle 'nhap ' command
        if (text.toLowerCase().includes('nhap ')) {
            const bulkRegex = /nhap\s+([^\s]+)\s+(\d+,\d+,\d+)/i;
            const bulkMatch = text.match(bulkRegex);

            if (bulkMatch) {
                // Priority 1: Attachment in current message. Priority 2: Last cached file.
                const fileToProcess = excelFile || lastFileCache.get(targetId);

                if (fileToProcess && (Date.now() - (fileToProcess.timestamp || 0) < 300000)) { // 5 min expiry
                    try {
                        await api.sendMessage({ msg: `⏳ Đang xử lý file: ${fileToProcess.name}...` }, targetId, isGroup ? ThreadType.Group : ThreadType.User);

                        let globalInfo = {
                            project: bulkMatch[1],
                            timeStr: bulkMatch[2]
                        };
                        const timeParts = bulkMatch[2].split(',');
                        globalInfo.week = parseInt(timeParts[0]);
                        globalInfo.month = parseInt(timeParts[1]);
                        globalInfo.year = parseInt(timeParts[2]);

                        const tempPath = path.join(__dirname, `temp_${targetId}.xlsx`);
                        const res = await fetch(fileToProcess.url);
                        const buffer = await res.arrayBuffer();
                        fs.writeFileSync(tempPath, Buffer.from(buffer));

                        const result = await processExcelFile(tempPath, globalInfo);
                        fs.unlinkSync(tempPath);
                        lastFileCache.delete(targetId); // Clear after use

                        let reply = `📊 KẾT QUẢ NHẬP HÀNG LOẠT:\n`;
                        reply += `✅ Thành công: ${result.successCount} đơn\n`;
                        if (result.failCount > 0) reply += `❌ Thất bại: ${result.failCount} đơn.\n`;
                        reply += `\nToàn bộ dữ liệu đã lên Google Sheets (chữ thường).\n`;
                        reply += `----------------------------\n`;
                        reply += `💡 Gợi ý: Bạn có thể nhắn 'xem ${globalInfo.project} ${globalInfo.timeStr}' để kiểm tra danh sách vừa nhập.\n`;
                        reply += `👉 Nhắn '0' để quay lại Menu chính.`;

                        await api.sendMessage({ msg: reply }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                        return;
                    } catch (err) {
                        console.error("Import error:", err);
                        await api.sendMessage({ msg: `⚠️ Lỗi: ${err.message}` }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                    }
                } else {
                    await api.sendMessage({ msg: "❌ Không tìm thấy file Excel nào vừa gửi. Vui lòng gửi file trước khi nhắn lệnh." }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                }
            }
        }
        // --- END: Robust File Detection ---

        if (text) {
            let reply = "";
            if (text.toLowerCase() === 'setnotify') {
                if (!redis) {
                    reply = "⚠️ Redis chưa được cấu hình.";
                } else {
                    const type = isGroup ? 'Group' : 'User';
                    await redis.set(NOTIFY_GROUP_KEY, targetId);
                    await redis.set(NOTIFY_TYPE_KEY, type);
                    reply = `✅ Đã thiết lập ${isGroup ? 'Nhóm' : 'Cá nhân'} này nhận thông báo tự động từ BOT247.\n🆔 ID: ${targetId}`;
                }
            }

            if (text.toLowerCase() === 'testnotify') {
                if (!redis) {
                    reply = "⚠️ Redis chưa được cấu hình.";
                } else {
                    await api.sendMessage({ msg: "⏳ Đang quét kiểm tra thay đổi trạng thái đơn hàng..." }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                    runAutoTracking(api);
                    return;
                }
            }

            if (text.toLowerCase() === 'bot247') {
                userState.set(stateKey, 'BOT247_MENU');

                // --- Send Logo Image correctly ---
                try {
                    const logoPath = path.join(__dirname, 'public', 'logo_247.png');
                    if (fs.existsSync(logoPath)) {
                        const threadType = isGroup ? ThreadType.Group : ThreadType.User;
                        const attachments = await api.uploadAttachment(logoPath, targetId, threadType);
                        await api.sendMessage({ msg: "", attachments: attachments }, targetId, threadType);
                    }
                } catch (err) {
                    console.error("❌ Send Logo Error:", err.message);
                }

                let m = `🚚 BOT 247EXPRESS - MENU THEO DÕI\n`;
                m += `━━━━━━━━━━━━━━━━━━━\n`;
                m += `1️⃣  Xem vận đơn mới nhất (đang giao)\n`;
                m += `2️⃣  Xem toàn bộ vận đơn (tất cả)\n`;
                m += `3️⃣  Hướng dẫn tra cứu theo mã\n`;
                m += `4️⃣  Tra cứu theo tháng (MM,YY)\n`;
                m += `━━━━━━━━━━━━━━━━━━━\n`;
                m += `💡 Gợi ý: Nhắn 'danhsach 5,26' để xem theo tháng.\n`;
                await api.sendMessage({ msg: m }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                return;
            }

            if (text.toLowerCase().startsWith('__cmd_danhsach')) {
                try {
                    const parts = text.split(' ');
                    const showAll = text.toLowerCase().includes('all');
                    
                    // Pattern MM/YYYY or MM,YY
                    const monthPart = parts.find(p => /^\d{1,2}\/\d{4}$/.test(p) || /^\d{1,2},\d{2}$/.test(p));
                    let fromDate = '2026-01-01T00:00:00';
                    let toDate = '2026-12-31T23:59:59';

                    if (monthPart) {
                        let m, y;
                        if (monthPart.includes('/')) {
                            [m, y] = monthPart.split('/');
                        } else {
                            const [mPart, yPart] = monthPart.split(',');
                            m = mPart;
                            y = `20${yPart}`; // vd: 26 -> 2026
                        }
                        const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
                        fromDate = `${y}-${m.padStart(2, '0')}-01T00:00:00`;
                        toDate = `${y}-${m.padStart(2, '0')}-${lastDay}T23:59:59`;
                    }

                    const list = await getOrderList247(showAll, fromDate, toDate);
                    await api.sendMessage({ msg: list + "\n\n👉 Nhắn '0' để quay lại Menu bot247." }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                } catch (err) {
                    await api.sendMessage({ msg: `⚠️ Lỗi lấy danh sách: ${err.message}` }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                }
                return;
            }

            // Check if text is a 247 tracking code
            // RESTRICTED: Only search if in BOT247_SEARCH state, and accept any characters
            if (currentState === 'BOT247_SEARCH' && text !== '0' && text !== '') {
                try {
                    const result = await trackOrder247(text);
                    await api.sendMessage({ msg: result + "\n\n👉 Nhắn '0' để quay lại Menu." }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                } catch (err) {
                    await api.sendMessage({ msg: `⚠️ Lỗi tra cứu: ${err.message}` }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                }
                return;
            }

            if (text.toLowerCase().startsWith("chitiet ")) {
                const orderId = text.substring(8).trim().toUpperCase();
                try {
                    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, new JWT({
                        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                        key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
                    }));
                    await doc.loadInfo();
                    let summarySheet = doc.sheetsByTitle['Orders'] || doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === 'orders');
                    let detailSheet = doc.sheetsByTitle['OrderDetails'] || doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === 'orderdetails');

                    const orderRows = await summarySheet.getRows();
                    const orderHeader = orderRows.find(r => r.get('OrderID') === orderId);

                    if (!orderHeader) {
                        reply = `❌ Không tìm thấy đơn hàng ${orderId}.\n\n👉 Nhắn '0' để quay lại Menu.`;
                    } else {
                        const detailRows = await detailSheet.getRows();
                        const items = detailRows.filter(r => r.get('OrderID') === orderId);

                        reply = `📦 CHI TIẾT ĐƠN HÀNG: ${orderId}\n`;
                        reply += `📍 Siêu thị: ${orderHeader.get('Destination')?.toUpperCase()}\n`;
                        reply += `⏰ Xuất: ${orderHeader.get('Timestamp')} - 🚩 ${orderHeader.get('Status')}\n`;
                        reply += `━━━━━━━━━━━━━━━━━━━\n`;

                        if (items.length === 0) {
                            reply += `(Trống)\n`;
                        } else {
                            items.forEach((item, idx) => {
                                let name = item.get('ProductName') || '';
                                if (name) name = name.charAt(0).toUpperCase() + name.slice(1);
                                const qty = item.get('Quantity') || '0';
                                reply += `${idx + 1}. ${name}: ${qty}\n`;
                            });
                        }
                        reply += `\n💡 Gợi ý: Dùng 'sua ${orderId} ...' để thay đổi.\n👉 Nhắn '0' để quay lại Menu.`;
                    }
                } catch (err) {
                    reply = `⚠️ Lỗi: ${err.message}`;
                }
            } else if (text.toLowerCase().startsWith("check ")) {
                const param = text.substring(6).trim();
                const res = await searchGoogleSheet(param);
                reply = res + "\n\n👉 Nhắn '0' để quay lại Menu.";
            } else if (text.toLowerCase().startsWith("taodon ")) {
                const orderData = parseOrderCommand(text);
                if (orderData) {
                    try {
                        const saved = await saveOrderToSheets(orderData);
                        reply = `✅ Đã tạo đơn hàng thành công!\n`;
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
                        reply += table + "\n\n👉 Nhắn '0' để quay lại Menu.";
                    } catch (err) {
                        reply = `⚠️ Lỗi khi lưu đơn hàng: ${err.message}\n\n👉 Nhắn '0' để quay lại Menu.`;
                    }
                } else {
                    reply = `❌ Sai định dạng lệnh tạo đơn.\nVD: taodon cholimex 1,5,26 coopxlhn {tương ớt 300:10; tương ớt 270:20}`;
                }
            } else if (text.toLowerCase().startsWith("tracking ")) {
                const orderCode = text.substring(9).trim();
                const res = await trackOrder247(orderCode);
                await api.sendMessage({ msg: res + "\n\n👉 Nhắn '0' để quay lại Menu." }, targetId, isGroup ? ThreadType.Group : ThreadType.User);
                return;
            } else if (text.toLowerCase().startsWith("danh sach")) {
                const showAll = text.toLowerCase().includes("tat ca");
                const res = await getOrderList247(showAll);
                reply = res + "\n\n👉 Nhắn '0' để quay lại Menu.";
            } else if (text.toLowerCase() === "tinhtrang") {
                try {
                    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, new JWT({
                        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                        key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
                    }));
                    await doc.loadInfo();
                    reply = `🤖 TRẠNG THÁI HỆ THỐNG:\n✅ Bot: Đang hoạt động\n✅ Google Sheets: Đã kết nối (${doc.title})\n\n👉 Nhắn '0' để quay lại Menu.`;
                } catch (err) {
                    reply = `🤖 TRẠNG THÁI HỆ THỐNG:\n✅ Bot: Đang hoạt động\n❌ Google Sheets: Lỗi kết nối (${err.message})\n\n👉 Nhắn '0' để quay lại Menu.`;
                }
            } else if (text.toLowerCase() === "ping") {
                reply = "pong! 👉 Nhắn '0' để quay lại Menu.";
            }

            if (reply) {
                try {
                    await api.sendMessage(
                        { msg: reply },
                        targetId,
                        isGroup ? ThreadType.Group : ThreadType.User
                    );
                    console.log(`✅ Sent reply to ${isGroup ? 'Group' : 'User'}: ${targetId}`);
                } catch (err) {
                    console.error(`❌ Failed to send reply to ${targetId}: ${err.message}`);
                }
            }
        }

        io.emit('new_message', {
            sender: senderId,
            text: text,
            isGroup: isGroup
        });
    });

    api.listener.start();

    // Start Auto-tracking background job
    if (redis) {
        console.log("🚀 Starting auto-tracking background job (30m interval)...");
        // Run once at start
        runAutoTracking(api);
        // Then every 30 minutes
        autoTrackingTimer = setInterval(() => runAutoTracking(api), 30 * 60 * 1000);
    }
}

async function login() {
    botStatus = 'logging_in';
    io.emit('status', { status: botStatus });

    // Zalo init with sharp for image metadata
    const zalo = new Zalo({}, {
        imageMetadataGetter: async (filePath) => {
            const metadata = await sharp(filePath).metadata();
            return {
                width: metadata.width,
                height: metadata.height,
            };
        },
    });

    // Try to restore session from Redis first, then local file
    let cookie = null;
    if (redis) {
        console.log("Attempting to restore session from Redis...");
        cookie = await redis.get('zalo_session');
    }

    if (!cookie && fs.existsSync(SESSION_FILE)) {
        console.log("Attempting to restore session from local file...");
        cookie = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    }

    if (cookie) {
        try {
            const api = await zalo.loginCookie(cookie);
            await startBot(api);
            return;
        } catch (error) {
            console.error("Session restore failed:", error.message);
        }
    }

    const qrInterval = setInterval(() => {
        const qrPath = path.join(__dirname, 'qr.png');
        if (fs.existsSync(qrPath)) {
            const data = fs.readFileSync(qrPath).toString('base64');
            qrData = `data:image/png;base64,${data}`;
            io.emit('qr', { qr: qrData });
        }
    }, 2000);

    try {
        const api = await zalo.loginQR();
        clearInterval(qrInterval);
        qrData = null;
        io.emit('qr', { qr: null });
        await startBot(api);
    } catch (error) {
        console.error("Login Error:", error);
        botStatus = 'disconnected';
        io.emit('status', { status: botStatus, error: error.message });
    }
}

// Global IO variable to be used in startBot
let io;

nextApp.prepare().then(() => {
    const app = express();
    const server = http.createServer(app);
    io = new Server(server, {
        cors: { origin: "*", methods: ["GET", "POST"] }
    });

    io.on('connection', (socket) => {
        socket.emit('status', { status: botStatus });
        if (qrData) socket.emit('qr', { qr: qrData });
        socket.on('login', () => botStatus === 'disconnected' && login());
        socket.on('logout', async () => {
            if (redis) await redis.del('zalo_session');
            if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
            process.exit(0);
        });
    });

    // Handle all Next.js requests
    app.use((req, res) => handle(req, res));

    server.listen(PORT, (err) => {
        if (err) throw err;
        console.log(`> Ready on http://localhost:${PORT}`);
        login(); // Auto login on startup
    });
});
