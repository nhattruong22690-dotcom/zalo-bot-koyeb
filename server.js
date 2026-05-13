const { Zalo, ThreadType } = require('zca-js');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const next = require('next');
const { Redis } = require('@upstash/redis');

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
        const isPlainText = typeof message.data.content === "string";
        const text = isPlainText ? message.data.content : "";
        const senderId = message.data.uidFrom || message.data.senderId;
        
        if (isPlainText && text) {
            let reply = "";
            if (text.toLowerCase().startsWith("check ")) {
                reply = `🔍 Bot đã nhận lệnh kiểm tra cho tham số: ${text.substring(6).trim()}`;
            } else if (text.toLowerCase() === "ping") {
                reply = "pong!";
            }

            if (reply) {
                try {
                    await api.sendMessage({ msg: reply }, senderId, message.threadType);
                } catch (err) {
                    console.error("Send message error:", err);
                }
            }
        }
        
        io.emit('new_message', {
            sender: senderId,
            text: text,
            timestamp: new Date().toISOString()
        });
    });

    api.listener.start();
}

async function login() {
    botStatus = 'logging_in';
    io.emit('status', { status: botStatus });
    const zalo = new Zalo();

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
