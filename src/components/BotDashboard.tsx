"use client";

import { useEffect, useState, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
    QrCode, 
    MessageSquare, 
    ShieldCheck, 
    Activity, 
    LogOut, 
    RefreshCcw, 
    Settings, 
    Users, 
    Trash2, 
    Plus, 
    Lock, 
    Unlock, 
    Check, 
    Globe, 
    Search,
    UserCheck
} from 'lucide-react';

const BOT_URL = ''; // Same host/port

interface ChatConfig {
    name: string;
    allowed: string[];
}

interface PermissionsConfig {
    allowAllByDefault: boolean;
    chats: Record<string, ChatConfig>;
}

export default function BotDashboard() {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [status, setStatus] = useState('disconnected');
    const [qr, setQr] = useState<string | null>(null);
    const [logs, setLogs] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);

    // Active tab: 'dashboard' or 'permissions'
    const [activeTab, setActiveTab] = useState<'dashboard' | 'permissions'>('dashboard');

    // Permissions configuration
    const [permissions, setPermissions] = useState<PermissionsConfig>({
        allowAllByDefault: true,
        chats: {}
    });

    // Search query for configured permissions
    const [searchQuery, setSearchQuery] = useState('');

    // Form inputs for adding allowed chats
    const [newChatId, setNewChatId] = useState('');
    const [newChatName, setNewChatName] = useState('');
    const [newChatAllowed, setNewChatAllowed] = useState<string[]>(['ORDER_IMPORT', 'BOT247_TRACKING']);

    // Feature definitions
    const FEATURES = [
        { key: 'ORDER_IMPORT', label: 'Nhập đơn Excel (Excel & Orders)', color: 'from-blue-600 to-indigo-600' },
        { key: 'BOT247_TRACKING', label: 'Tra cứu BOT247 (Vận đơn)', color: 'from-orange-500 to-red-500' },
        { key: 'SUPERMARKET_CHECK', label: 'Tra cứu siêu thị (/check)', color: 'from-emerald-500 to-teal-500' },
        { key: 'PROFILE_CHECK', label: 'Tra cứu hồ sơ (/checkprofile)', color: 'from-purple-500 to-pink-500' },
        { key: 'ignore', label: 'Bỏ qua nhóm/chat (Ignore/Skip)', color: 'from-red-600 to-rose-600' }
    ];

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

        newSocket.on('recent_logs', (history) => {
            setLogs(history);
        });

        newSocket.on('new_message', (msg) => {
            setLogs(prev => [msg, ...prev].slice(0, 100));
        });

        newSocket.on('permissions_update', (config) => {
            setPermissions(config);
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

    // Toggle global "allow all" setting
    const handleToggleAllowAll = () => {
        const updated = {
            ...permissions,
            allowAllByDefault: !permissions.allowAllByDefault
        };
        setPermissions(updated);
        socket?.emit('save_permissions', updated);
    };

    // Toggle specific permission for a chat
    const handleTogglePermission = (chatId: string, feature: string) => {
        const chat = permissions.chats[chatId];
        if (!chat) return;

        let newAllowed = [...chat.allowed];
        if (newAllowed.includes(feature)) {
            newAllowed = newAllowed.filter(f => f !== feature);
        } else {
            newAllowed.push(feature);
        }

        const updated = {
            ...permissions,
            chats: {
                ...permissions.chats,
                [chatId]: {
                    ...chat,
                    allowed: newAllowed
                }
            }
        };
        setPermissions(updated);
        socket?.emit('save_permissions', updated);
    };

    // Add a new allowed chat group
    const handleAddChat = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedId = newChatId.trim();
        const trimmedName = newChatName.trim();
        if (!trimmedId || !trimmedName) return;

        const updated = {
            ...permissions,
            chats: {
                ...permissions.chats,
                [trimmedId]: {
                    name: trimmedName,
                    allowed: [...newChatAllowed]
                }
            }
        };
        setPermissions(updated);
        socket?.emit('save_permissions', updated);

        // Reset fields
        setNewChatId('');
        setNewChatName('');
    };

    // Delete an allowed chat group
    const handleDeleteChat = (chatId: string) => {
        const updatedChats = { ...permissions.chats };
        delete updatedChats[chatId];

        const updated = {
            ...permissions,
            chats: updatedChats
        };
        setPermissions(updated);
        socket?.emit('save_permissions', updated);
    };

    // Checkbox toggle for adding a new chat
    const handleFormCheckboxToggle = (feature: string) => {
        if (newChatAllowed.includes(feature)) {
            setNewChatAllowed(newChatAllowed.filter(f => f !== feature));
        } else {
            setNewChatAllowed([...newChatAllowed, feature]);
        }
    };

    // Generate initials & unique visual gradients for avatars
    const getAvatarConfig = (name: string) => {
        const initials = name
            .split(' ')
            .map(w => w[0])
            .join('')
            .substring(0, 2)
            .toUpperCase() || 'ZD';

        // Select gradient colors based on character code hashing
        const gradients = [
            'from-blue-600 to-indigo-600 text-blue-100 border-blue-500/30',
            'from-violet-600 to-fuchsia-600 text-violet-100 border-violet-500/30',
            'from-emerald-600 to-teal-600 text-emerald-100 border-emerald-500/30',
            'from-orange-500 to-rose-500 text-orange-100 border-orange-500/30',
            'from-pink-600 to-rose-600 text-pink-100 border-pink-500/30',
            'from-cyan-600 to-blue-600 text-cyan-100 border-cyan-500/30'
        ];
        
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % gradients.length;
        
        return { initials, gradient: gradients[index] };
    };

    // Format timestamps to VN timezone (HH:MM:SS - DD/MM/YYYY)
    const formatVNTime = (timestamp: any) => {
        if (!timestamp) return '---';
        try {
            const date = new Date(timestamp);
            return date.toLocaleString('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour12: false
            });
        } catch (e) {
            return new Date(timestamp).toLocaleTimeString();
        }
    };

    // Count statistics
    const stats = useMemo(() => {
        const total = logs.length;
        const groupCount = logs.filter(l => l.isGroup).length;
        const privateCount = total - groupCount;
        return { total, groupCount, privateCount };
    }, [logs]);

    return (
        <div className="min-h-screen bg-[#07070a] text-zinc-100 p-4 sm:p-6 font-sans selection:bg-blue-600/30 selection:text-blue-200">
            {/* Ambient Background Glows */}
            <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-900/10 rounded-full blur-[140px] pointer-events-none" />
            <div className="absolute bottom-10 right-1/4 w-[400px] h-[400px] bg-purple-900/10 rounded-full blur-[120px] pointer-events-none" />

            <div className="max-w-7xl mx-auto relative z-10">
                {/* Header */}
                <header className="flex flex-col sm:flex-row justify-between items-center gap-4 border-b border-zinc-900 pb-6 mb-8">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 bg-linear-to-tr from-blue-600 to-indigo-500 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(37,99,235,0.4)]">
                            <ShieldCheck size={26} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-extrabold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-white via-zinc-100 to-zinc-400">
                                Zalo Cloud Bot
                            </h1>
                            <p className="text-zinc-500 text-xs mt-0.5 font-medium tracking-wide">TRẠM ĐIỀU KHIỂN & CẤU HÌNH</p>
                        </div>
                    </div>
                    
                    {/* Navigation Tabs (Only visible when connected) */}
                    {status === 'connected' && (
                        <div className="flex bg-zinc-900/60 p-1.5 rounded-2xl border border-zinc-800/60 backdrop-blur-md">
                            <button 
                                onClick={() => setActiveTab('dashboard')}
                                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${activeTab === 'dashboard' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
                            >
                                <Activity size={16} />
                                Bảng Điều Khiển
                            </button>
                            <button 
                                onClick={() => setActiveTab('permissions')}
                                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${activeTab === 'permissions' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
                            >
                                <Settings size={16} />
                                Phân Quyền Nhóm
                            </button>
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900/60 rounded-xl border border-zinc-800/80">
                            <div className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-green-500 shadow-[0_0_10px_#22c55e] animate-pulse' : status === 'logging_in' ? 'bg-yellow-500 animate-bounce' : 'bg-red-500'}`} />
                            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">{status.replace('_', ' ')}</span>
                        </div>
                        {status === 'connected' && (
                            <button 
                                onClick={handleLogout} 
                                title="Đăng xuất khỏi Zalo"
                                className="p-2.5 bg-red-950/20 hover:bg-red-950/40 text-red-400 hover:text-red-300 rounded-xl border border-red-900/20 hover:border-red-900/40 transition-all duration-200"
                            >
                                <LogOut size={18} />
                            </button>
                        )}
                    </div>
                </header>

                {/* State 1: Disconnected or Logging In (Gate) */}
                {status !== 'connected' ? (
                    <div className="max-w-md mx-auto my-12">
                        <section className="bg-zinc-900/35 border border-zinc-800/50 rounded-3xl p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden group text-center">
                            <div className="absolute -top-10 -right-10 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-all duration-500" />
                            
                            <div className="w-16 h-16 bg-blue-600/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-blue-500/20">
                                <QrCode className="text-blue-500" size={32} />
                            </div>
                            
                            <h2 className="text-xl font-extrabold mb-3 text-zinc-100">Xác Thực Kết Nối Zalo</h2>
                            <p className="text-zinc-400 text-xs leading-relaxed mb-8">
                                Hệ thống quản lý phân quyền đang ở chế độ bảo vệ. Hãy kết nối và đăng nhập tài khoản Zalo của Bot để xem cấu hình và nhật ký thời gian thực.
                            </p>

                            {status === 'disconnected' && (
                                <button 
                                    onClick={handleLogin}
                                    className="w-full py-4 bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-2xl font-bold transition-all transform hover:scale-[1.01] active:scale-95 shadow-[0_4px_25px_rgba(37,99,235,0.3)] text-sm tracking-wide"
                                >
                                    Kích Hoạt Zalo Bot Ngay
                                </button>
                            )}

                            {status === 'logging_in' && (
                                <div className="space-y-6">
                                    {qr ? (
                                        <div className="bg-white p-4 rounded-2xl shadow-inner mx-auto w-fit border border-zinc-200">
                                            <img src={qr} alt="Zalo QR Code" className="w-48 h-48" />
                                            <p className="text-black text-center mt-3 text-[10px] font-black uppercase tracking-widest animate-pulse">Quét mã bằng Zalo của bạn</p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-8">
                                            <RefreshCcw className="text-blue-500 animate-spin mb-4" size={36} />
                                            <p className="text-zinc-400 text-xs font-semibold">Đang chuẩn bị mã QR an toàn...</p>
                                        </div>
                                    )}
                                    {error && (
                                        <div className="p-3.5 bg-red-950/20 border border-red-900/30 rounded-xl">
                                            <p className="text-red-400 text-xs leading-relaxed">{error}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </section>
                    </div>
                ) : (
                    /* State 2: Connected (Full Access) */
                    <>
                        {/* Dashboard Tab */}
                        {activeTab === 'dashboard' && (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                
                                {/* Left Column: Status & Stats */}
                                <div className="lg:col-span-1 space-y-8">
                                    {/* Connection Health */}
                                    <div className="flex flex-col items-center justify-center py-10 bg-green-500/5 border border-green-500/10 rounded-3xl backdrop-blur-xl shadow-2xl relative overflow-hidden group">
                                        <div className="absolute -top-10 -right-10 w-20 h-20 bg-green-500/5 rounded-full blur-xl" />
                                        <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(34,197,94,0.15)] border border-green-500/20">
                                            <ShieldCheck size={32} className="text-green-500" />
                                        </div>
                                        <p className="text-green-400 font-extrabold text-sm tracking-wide uppercase">Hệ Thống Đã Kết Nối</p>
                                        <p className="text-zinc-500 text-xs mt-1.5">Trạng thái Zalo Bot: Hoạt động</p>
                                    </div>

                                    {/* Live statistics */}
                                    <section className="bg-zinc-900/35 border border-zinc-800/50 rounded-3xl p-6 backdrop-blur-xl shadow-2xl">
                                        <h2 className="text-lg font-bold mb-5 flex items-center gap-2.5 text-zinc-100">
                                            <Activity className="text-purple-500" size={20} />
                                            Thống Kê Hoạt Động
                                        </h2>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="p-4.5 bg-zinc-950/50 rounded-2xl border border-zinc-900 flex flex-col justify-between">
                                                <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-2">TỔNG TIN NHẮN</p>
                                                <p className="text-3xl font-black text-white">{stats.total}</p>
                                            </div>
                                            <div className="p-4.5 bg-zinc-950/50 rounded-2xl border border-zinc-900 flex flex-col justify-between">
                                                <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-2">CHAT CÁ NHÂN</p>
                                                <p className="text-3xl font-black text-green-400">{stats.privateCount}</p>
                                            </div>
                                            <div className="p-4.5 bg-zinc-950/50 rounded-2xl border border-zinc-900 flex flex-col justify-between col-span-2">
                                                <div className="flex justify-between items-center mb-1">
                                                    <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">TIN NHẮN TRONG NHÓM</p>
                                                    <span className="text-xs font-bold text-purple-400">{stats.total > 0 ? Math.round((stats.groupCount / stats.total) * 100) : 0}%</span>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <p className="text-2xl font-black text-purple-400 shrink-0">{stats.groupCount}</p>
                                                    <div className="w-full bg-zinc-900 rounded-full h-2 overflow-hidden border border-zinc-800">
                                                        <div 
                                                            className="bg-purple-500 h-2 rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                                                            style={{ width: `${stats.total > 0 ? (stats.groupCount / stats.total) * 100 : 0}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </section>
                                </div>

                                {/* Right Column: High Fidelity Logs */}
                                <div className="lg:col-span-2">
                                    <section className="bg-zinc-900/35 border border-zinc-800/50 rounded-3xl h-[640px] flex flex-col backdrop-blur-xl shadow-2xl overflow-hidden">
                                        <div className="p-5 border-b border-zinc-900 flex justify-between items-center bg-zinc-900/20">
                                            <h2 className="text-lg font-bold flex items-center gap-2.5">
                                                <MessageSquare className="text-orange-500" size={20} />
                                                Nhật Ký Tin Nhắn Thời Gian Thực
                                            </h2>
                                            <span className="px-3 py-1 bg-zinc-950/60 text-zinc-500 font-mono text-[10px] font-bold rounded-lg border border-zinc-900 tracking-wider">WS_STABLE</span>
                                        </div>
                                        
                                        <div className="flex-1 overflow-y-auto p-5 space-y-4.5 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                                            {logs.length === 0 ? (
                                                <div className="h-full flex flex-col items-center justify-center text-zinc-500 italic py-20">
                                                    <MessageSquare size={44} className="mb-3 opacity-20 text-zinc-400" />
                                                    <p className="text-sm font-medium">Chưa ghi nhận tin nhắn nào. Đang lắng nghe Zalo...</p>
                                                </div>
                                            ) : (
                                                logs.map((log, i) => {
                                                    const { initials, gradient } = getAvatarConfig(log.senderName);
                                                    return (
                                                        <div key={i} className="flex gap-4 p-4 bg-zinc-950/45 rounded-2xl border border-zinc-900/80 group hover:border-zinc-800 hover:bg-zinc-950/80 transition-all duration-200">
                                                            {/* Custom Initials Avatar */}
                                                            <div className={`w-11 h-11 rounded-full bg-linear-to-br ${gradient} flex items-center justify-center shrink-0 text-sm font-extrabold border shadow-sm tracking-wider`}>
                                                                {initials}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1.5 mb-2">
                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                        <p className="text-sm font-black text-white">{log.senderName}</p>
                                                                        <span className="text-[10px] text-zinc-500 font-mono select-all shrink-0 bg-zinc-900/60 px-2 py-0.5 rounded border border-zinc-900">UID: {log.sender}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        {/* Channel Badge */}
                                                                        <span className={`px-2 py-0.5 text-[9px] font-bold rounded-md uppercase tracking-wider border ${
                                                                            log.isGroup 
                                                                                ? 'bg-purple-950/20 text-purple-400 border-purple-900/20' 
                                                                                : 'bg-green-950/20 text-green-400 border-green-900/20'
                                                                        }`}>
                                                                            {log.isGroup ? 'Nhóm' : 'Cá Nhân'}
                                                                        </span>
                                                                        {/* VN time */}
                                                                        <span className="text-[10px] text-zinc-600 font-bold font-mono">
                                                                            {formatVNTime(log.timestamp)}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <p className="text-zinc-300 text-sm leading-relaxed wrap-break-word font-medium pr-2">{log.text}</p>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </section>
                                </div>
                            </div>
                        )}

                        {/* Permissions Tab */}
                        {activeTab === 'permissions' && (
                            <div className="space-y-8 animate-fade-in">
                                {/* Global Setting Alert & Form */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                    
                                    {/* Toggle global permission rule */}
                                    <div className="lg:col-span-1 bg-zinc-900/35 border border-zinc-800/50 rounded-3xl p-6 backdrop-blur-xl shadow-2xl flex flex-col justify-between">
                                        <div>
                                            <h2 className="text-lg font-bold mb-4 flex items-center gap-2.5 text-zinc-100">
                                                <Lock size={20} className="text-blue-500" />
                                                Chế Độ Bảo Mật
                                            </h2>
                                            <p className="text-zinc-400 text-xs leading-relaxed mb-6">
                                                Chọn chế độ kiểm soát quyền truy cập của bot. Khi bật chế độ Bảo mật cao, bot sẽ bỏ qua hoàn toàn và không phản hồi ở những nhóm hoặc tài khoản Zalo không nằm trong danh sách cấp phép bên cạnh.
                                            </p>
                                        </div>

                                        <div className="p-4 bg-zinc-950/60 rounded-2xl border border-zinc-900 space-y-4">
                                            <div className="flex justify-between items-center">
                                                <div className="flex items-center gap-2">
                                                    {permissions.allowAllByDefault ? (
                                                        <Globe size={18} className="text-green-500" />
                                                    ) : (
                                                        <Lock size={18} className="text-orange-500" />
                                                    )}
                                                    <span className="text-xs font-bold text-zinc-300">
                                                        {permissions.allowAllByDefault ? 'Đang Mở Khóa Tất Cả (Test)' : 'Chỉ Chấp Nhận Danh Sách'}
                                                    </span>
                                                </div>
                                                <button 
                                                    onClick={handleToggleAllowAll}
                                                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${permissions.allowAllByDefault ? 'bg-green-600' : 'bg-zinc-700'}`}
                                                >
                                                    <span 
                                                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${permissions.allowAllByDefault ? 'translate-x-5' : 'translate-x-0'}`}
                                                    />
                                                </button>
                                            </div>
                                            <div className="border-t border-zinc-900 pt-3">
                                                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wide">
                                                    TRẠNG THÁI HIỆN TẠI: {permissions.allowAllByDefault ? 'KHUYÊN DÙNG ĐỂ THỬ NGHIỆM' : 'BẢO MẬT TUYỆT ĐỐI'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Add allowed chat form */}
                                    <div className="lg:col-span-2 bg-zinc-900/35 border border-zinc-800/50 rounded-3xl p-6 backdrop-blur-xl shadow-2xl">
                                        <h2 className="text-lg font-bold mb-5 flex items-center gap-2.5 text-zinc-100">
                                            <Plus size={20} className="text-blue-500" />
                                            Cấp Quyền Nhóm / ID Chat Mới
                                        </h2>
                                        
                                        <form onSubmit={handleAddChat} className="space-y-5">
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-zinc-500 text-[10px] font-bold uppercase tracking-wider mb-2">UID NHÓM / CHAT ID (Copy từ nhật ký logs)</label>
                                                    <input 
                                                        type="text" 
                                                        value={newChatId}
                                                        onChange={(e) => setNewChatId(e.target.value)}
                                                        placeholder="VD: 1823746557604864432"
                                                        className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-zinc-700 text-white font-mono placeholder:text-zinc-700"
                                                        required
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-zinc-500 text-[10px] font-bold uppercase tracking-wider mb-2">TÊN GỢI NHỚ (Gợi nhớ, v.d: Nhóm Sales)</label>
                                                    <input 
                                                        type="text" 
                                                        value={newChatName}
                                                        onChange={(e) => setNewChatName(e.target.value)}
                                                        placeholder="VD: Nhóm Marketing, Chat Admin..."
                                                        className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-zinc-700 text-white placeholder:text-zinc-700"
                                                        required
                                                    />
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-zinc-500 text-[10px] font-bold uppercase tracking-wider mb-3">TÍCH CHỌN TÍNH NĂNG CẤP PHÉP:</label>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    {FEATURES.map(f => {
                                                        const checked = newChatAllowed.includes(f.key);
                                                        return (
                                                            <button
                                                                key={f.key}
                                                                type="button"
                                                                onClick={() => handleFormCheckboxToggle(f.key)}
                                                                className={`flex items-center justify-between p-3.5 rounded-xl border text-xs font-bold transition-all ${
                                                                    checked 
                                                                        ? 'bg-zinc-800 text-white border-zinc-700' 
                                                                        : 'bg-zinc-950/45 text-zinc-500 border-zinc-900 hover:border-zinc-800 hover:text-zinc-400'
                                                                }`}
                                                            >
                                                                <span>{f.label}</span>
                                                                <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${checked ? 'bg-blue-600 border-blue-500 text-white' : 'border-zinc-800'}`}>
                                                                    {checked && <Check size={12} strokeWidth={3} />}
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            <button 
                                                type="submit"
                                                className="w-full sm:w-auto px-6 py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-2 self-end shadow-lg"
                                            >
                                                <Plus size={16} />
                                                Thêm Vào Danh Sách Cho Phép
                                            </button>
                                        </form>
                                    </div>
                                </div>

                                {/* List of Configured Chats */}
                                <div className="bg-zinc-900/35 border border-zinc-800/50 rounded-3xl p-6 backdrop-blur-xl shadow-2xl overflow-hidden">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                                        <h2 className="text-lg font-bold flex items-center gap-2.5 text-zinc-100">
                                            <Users size={20} className="text-blue-500" />
                                            Danh Sách Nhóm / Cá Nhân Được Cấp Quyền ({Object.keys(permissions.chats).length})
                                        </h2>
                                        
                                        {/* Search input */}
                                        <div className="relative w-full sm:w-72">
                                            <Search className="absolute left-3.5 top-3.5 text-zinc-600" size={16} />
                                            <input 
                                                type="text"
                                                placeholder="Tìm kiếm theo Tên hoặc ID..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="w-full bg-zinc-950/80 border border-zinc-900 focus:border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs focus:outline-none text-white font-medium"
                                            />
                                        </div>
                                    </div>

                                    {Object.keys(permissions.chats).length === 0 ? (
                                        <div className="text-center py-12 text-zinc-600 italic">
                                            <UserCheck size={40} className="mx-auto mb-3 opacity-20" />
                                            Danh sách trống. Cấp quyền ở trên để lưu.
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="border-b border-zinc-900 text-zinc-500 text-[10px] font-bold uppercase tracking-wider">
                                                        <th className="pb-4 pr-4">Tên Nhóm / ID gợi nhớ</th>
                                                        <th className="pb-4 pr-4">UID Zalo Chat</th>
                                                        {FEATURES.map(f => (
                                                            <th key={f.key} className="pb-4 pr-4 text-center">{f.label.split(' (')[0]}</th>
                                                        ))}
                                                        <th className="pb-4 text-right">Hành động</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-zinc-900/40 text-sm">
                                                    {Object.entries(permissions.chats)
                                                        .filter(([chatId, config]) => {
                                                            const term = searchQuery.toLowerCase().trim();
                                                            if (!term) return true;
                                                            return chatId.toLowerCase().includes(term) || (config.name && config.name.toLowerCase().includes(term));
                                                        })
                                                        .map(([chatId, config]) => (
                                                            <tr key={chatId} className="group hover:bg-zinc-950/20 transition-all">
                                                                <td className="py-4 pr-4 font-bold text-zinc-200">{config.name}</td>
                                                                <td className="py-4 pr-4 font-mono text-zinc-500 text-xs select-all">{chatId}</td>
                                                                {FEATURES.map(f => {
                                                                    const allowed = config.allowed.includes(f.key);
                                                                    return (
                                                                        <td key={f.key} className="py-4 pr-4 text-center">
                                                                            <button
                                                                                onClick={() => handleTogglePermission(chatId, f.key)}
                                                                                className={`w-6 h-6 mx-auto rounded-lg border transition-all duration-150 flex items-center justify-center ${
                                                                                    allowed 
                                                                                        ? 'bg-blue-600/10 border-blue-500/30 text-blue-400' 
                                                                                        : 'bg-zinc-950 border-zinc-900 text-zinc-800 hover:border-zinc-800'
                                                                                }`}
                                                                            >
                                                                                {allowed && <Check size={14} strokeWidth={3.5} />}
                                                                            </button>
                                                                        </td>
                                                                    );
                                                                })}
                                                                <td className="py-4 text-right">
                                                                    <button 
                                                                        onClick={() => handleDeleteChat(chatId)}
                                                                        className="p-2 text-zinc-600 hover:text-red-400 bg-zinc-950/10 border border-transparent hover:border-red-950/30 hover:bg-red-950/10 rounded-lg transition-all"
                                                                    >
                                                                        <Trash2 size={15} />
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
