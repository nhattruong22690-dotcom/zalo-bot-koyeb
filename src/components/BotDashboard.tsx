"use client";

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { QrCode, MessageSquare, ShieldCheck, Activity, LogOut, RefreshCcw } from 'lucide-react';

const BOT_URL = ''; // Use same host/port as the page

export default function BotDashboard() {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [status, setStatus] = useState('disconnected');
    const [qr, setQr] = useState<string | null>(null);
    const [logs, setLogs] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const newSocket = io(BOT_URL);
        setSocket(newSocket);

        newSocket.on('status', (data) => {
            setStatus(data.status);
            if (data.error) setError(data.error);
        });

        newSocket.on('qr', (data) => {
            setQr(data.qr);
        });

        newSocket.on('new_message', (msg) => {
            setLogs(prev => [msg, ...prev].slice(0, 50));
        });

        return () => {
            newSocket.close();
        };
    }, []);

    const handleLogin = () => {
        setError(null);
        socket?.emit('login');
    };

    const handleLogout = () => {
        socket?.emit('logout');
        window.location.reload();
    };

    return (
        <div className="min-h-screen bg-black text-white p-6 font-sans">
            <header className="max-w-6xl mx-auto flex justify-between items-center mb-12">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.4)]">
                        <ShieldCheck size={24} />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">Zalo Cloud Bot</h1>
                </div>
                
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900 rounded-full border border-zinc-800">
                        <div className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-green-500 animate-pulse' : status === 'logging_in' ? 'bg-yellow-500 animate-bounce' : 'bg-red-500'}`} />
                        <span className="text-sm font-medium capitalize">{status.replace('_', ' ')}</span>
                    </div>
                    {status === 'connected' && (
                        <button onClick={handleLogout} className="p-2 text-zinc-400 hover:text-white transition-colors">
                            <LogOut size={20} />
                        </button>
                    )}
                </div>
            </header>

            <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Status & Login */}
                <div className="lg:col-span-1 space-y-8">
                    <section className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-8 backdrop-blur-xl">
                        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                            <QrCode className="text-blue-500" />
                            Authentication
                        </h2>
                        
                        {status === 'disconnected' && (
                            <div className="text-center py-8">
                                <p className="text-zinc-400 mb-6 text-sm">Bot is currently offline. Start the login process to activate.</p>
                                <button 
                                    onClick={handleLogin}
                                    className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-2xl font-bold transition-all transform hover:scale-[1.02] active:scale-95 shadow-lg"
                                >
                                    Start Zalo Bot
                                </button>
                            </div>
                        )}

                        {status === 'logging_in' && (
                            <div className="space-y-6">
                                {qr ? (
                                    <div className="bg-white p-4 rounded-2xl shadow-inner mx-auto w-fit">
                                        <img src={qr} alt="Zalo QR Code" className="w-48 h-48" />
                                        <p className="text-black text-center mt-4 text-xs font-bold uppercase tracking-widest">Scan with Zalo</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-12">
                                        <RefreshCcw className="text-blue-500 animate-spin mb-4" size={32} />
                                        <p className="text-zinc-400 text-sm">Generating QR code...</p>
                                    </div>
                                )}
                                {error && <p className="text-red-500 text-xs text-center">{error}</p>}
                            </div>
                        )}

                        {status === 'connected' && (
                            <div className="flex flex-col items-center justify-center py-12 bg-green-500/10 border border-green-500/20 rounded-2xl">
                                <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(34,197,94,0.4)]">
                                    <ShieldCheck size={32} />
                                </div>
                                <p className="text-green-500 font-bold">Authenticated</p>
                                <p className="text-zinc-500 text-xs mt-2">Bot is active and running</p>
                            </div>
                        )}
                    </section>

                    <section className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-8 backdrop-blur-xl">
                        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                            <Activity className="text-purple-500" />
                            Statistics
                        </h2>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 bg-zinc-950 rounded-2xl border border-zinc-800">
                                <p className="text-zinc-500 text-xs uppercase font-bold tracking-wider mb-1">Received</p>
                                <p className="text-2xl font-bold">{logs.length}</p>
                            </div>
                            <div className="p-4 bg-zinc-950 rounded-2xl border border-zinc-800">
                                <p className="text-zinc-500 text-xs uppercase font-bold tracking-wider mb-1">Uptime</p>
                                <p className="text-2xl font-bold">100%</p>
                            </div>
                        </div>
                    </section>
                </div>

                {/* Right Column: Logs */}
                <div className="lg:col-span-2">
                    <section className="bg-zinc-900/50 border border-zinc-800 rounded-3xl h-[600px] flex flex-col backdrop-blur-xl overflow-hidden">
                        <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
                            <h2 className="text-xl font-semibold flex items-center gap-2">
                                <MessageSquare className="text-orange-500" />
                                Real-time Logs
                            </h2>
                            <span className="text-xs text-zinc-500 font-mono">WS_LISTENING</span>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
                            {logs.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-zinc-600 italic">
                                    <MessageSquare size={48} className="mb-4 opacity-20" />
                                    <p>No messages captured yet.</p>
                                </div>
                            ) : (
                                logs.map((log, i) => (
                                    <div key={i} className="flex gap-4 p-4 bg-zinc-950/50 rounded-2xl border border-zinc-800/50 group hover:border-zinc-700 transition-colors">
                                        <div className="w-10 h-10 bg-zinc-900 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-zinc-500 border border-zinc-800">
                                            {log.sender.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-start mb-1">
                                                <p className="text-sm font-bold text-blue-400 truncate">UID: {log.sender}</p>
                                                <span className="text-[10px] text-zinc-600 font-mono">
                                                    {new Date(log.timestamp).toLocaleTimeString()}
                                                </span>
                                            </div>
                                            <p className="text-zinc-300 text-sm leading-relaxed wrap-break-word">{log.text}</p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}
