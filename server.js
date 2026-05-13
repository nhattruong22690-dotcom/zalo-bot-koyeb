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

dotenv.config();

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
    try {
        const apiKey = process.env.GH247_API_KEY;
        if (!apiKey) {
            return { text: '⚠️ Chưa cấu hình GH247_API_KEY. Vui lòng liên hệ admin.' };
        }

        const url = `https://tracking.247express.vn/api/Order/v1/Tracking?ordercode=${encodeURIComponent(orderCode)}&apikey=${apiKey}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const d = await res.json();

        // API returns errorCode when not found
        if (d.errorCode || !d.orderCode) {
            return { text: `❌ Không tìm thấy đơn hàng "${orderCode}".\nKiểm tra lại mã vận đơn hoặc thử lại sau.` };
        }

        // Latest status from statuses array
        const latestStatus = d.statuses && d.statuses.length > 0
            ? d.statuses[d.statuses.length - 1]
            : null;
        
        const statusLabel = latestStatus
            ? (STATUS_MAP[latestStatus.statusName] || STATUS_MAP[latestStatus.trackingName] || latestStatus.trackingName || latestStatus.statusName)
            : '---';

        // Format date helper
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

        // Last 4 tracking events
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

        // Get bill image if exists
        const billImageUrl = (Array.isArray(d.confirmImage) && d.confirmImage.length > 0) 
            ? d.confirmImage[0] 
            : null;

        if (billImageUrl) {
            msg += `\n\n🖼️ Hình ảnh vận đơn:\n${billImageUrl}`;
        }

        return msg.trim();
    } catch (err) {
        console.error('247 Tracking Error:', err.message);
        return `⚠️ Lỗi tra cứu vận đơn: ${err.message}`;
    }
}

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

        console.log(`🎯 Detected: ${isGroup ? 'GROUP' : 'PRIVATE'} | Thread: ${targetId} | Sender: ${senderId}`);

        const isPlainText = typeof message.data.content === "string";
        const text = isPlainText ? message.data.content : (message.data.content?.text || "");

        if (text) {
            let reply = "";
            if (text.toLowerCase().startsWith("check ")) {
                const param = text.substring(6).trim();
                reply = await searchGoogleSheet(param);
            } else if (text.toLowerCase().startsWith("tracking ")) {
                const orderCode = text.substring(9).trim();
                reply = await trackOrder247(orderCode);
            } else if (text.toLowerCase() === "ping") {
                reply = "pong!";
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
