import React, { useState, useEffect } from 'react';
import { Teacher, SystemConfig } from '../types';
import { ACADEMIC_POSITIONS } from '../constants';
import { User, Lock, Save, UploadCloud, FileSignature, Briefcase, Eye, EyeOff, Loader, MessageCircle, Smartphone, CheckCircle, Zap, AlertCircle, Info, Copy, MessageSquare, Search } from 'lucide-react';
import { supabase } from '../supabaseClient';

interface UserProfileProps {
    currentUser: Teacher;
    onUpdateUser: (updatedUser: Teacher) => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ currentUser, onUpdateUser }) => {
    const [formData, setFormData] = useState({
        name: currentUser.name,
        position: currentUser.position,
        password: currentUser.password || '',
        id: currentUser.id,
        telegramChatId: currentUser.telegramChatId || '',
        lineUserId: currentUser.lineUserId || ''
    });
    const [signaturePreview, setSignaturePreview] = useState<string>(currentUser.signatureBase64 || '');
    const [showPassword, setShowPassword] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [botUsername, setBotUsername] = useState<string>('');
    const [lineBotId, setLineBotId] = useState<string>('');
    const [isLoadingConfig, setIsLoadingConfig] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isRefreshingLine, setIsRefreshingLine] = useState(false);
    const [isSearchingRecentLine, setIsSearchingRecentLine] = useState(false);
    const [isSearchingRecentTelegram, setIsSearchingRecentTelegram] = useState(false);
    const [isConnectingTelegram, setIsConnectingTelegram] = useState(false);
    const [isCopiedLine, setIsCopiedLine] = useState(false);
    const [showManualLineInput, setShowManualLineInput] = useState(false);
    const [showManualTelegramInput, setShowManualTelegramInput] = useState(false);

    // Sync formData when currentUser prop changes (e.g. from realtime update)
    useEffect(() => {
        setFormData(prev => ({
            ...prev,
            name: currentUser.name,
            position: currentUser.position,
            telegramChatId: currentUser.telegramChatId || '',
            lineUserId: currentUser.lineUserId || ''
        }));
        if (currentUser.signatureBase64) {
            setSignaturePreview(currentUser.signatureBase64);
        }
    }, [currentUser]);

    // Interval check for Telegram and LINE link
    useEffect(() => {
        let interval: any;
        if ((!currentUser.telegramChatId && botUsername) || (!currentUser.lineUserId && lineBotId)) {
            interval = setInterval(async () => {
                if (supabase) {
                    const { data } = await supabase.from('profiles').select('telegram_chat_id, line_user_id').eq('id', currentUser.id).maybeSingle();
                    if (data) {
                        let shouldUpdate = false;
                        const updated = { ...currentUser };
                        if (data.telegram_chat_id && data.telegram_chat_id !== currentUser.telegramChatId) {
                            updated.telegramChatId = data.telegram_chat_id;
                            setFormData(prev => ({ ...prev, telegramChatId: data.telegram_chat_id }));
                            shouldUpdate = true;
                        }
                        if (data.line_user_id && data.line_user_id !== currentUser.lineUserId) {
                            updated.lineUserId = data.line_user_id;
                            setFormData(prev => ({ ...prev, lineUserId: data.line_user_id }));
                            shouldUpdate = true;
                        }
                        if (shouldUpdate) {
                            onUpdateUser(updated);
                        }
                    }
                }
            }, 3000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [currentUser.telegramChatId, currentUser.lineUserId, botUsername, lineBotId, currentUser.id]);

    const handleRefreshTelegram = async () => {
        setIsRefreshing(true);
        try {
            // Trigger sync-updates in case webhook needs auto-recovery or updates need fetching
            await fetch('/api/telegram/sync-updates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ schoolId: currentUser.schoolId })
            }).catch(() => {});

            if (supabase) {
                const { data, error } = await supabase.from('profiles').select('telegram_chat_id').eq('id', currentUser.id).maybeSingle();
                if (error) throw error;
                if (data && data.telegram_chat_id) {
                    setFormData(prev => ({ ...prev, telegramChatId: data.telegram_chat_id }));
                    onUpdateUser({ ...currentUser, telegramChatId: data.telegram_chat_id });
                    alert(`✅ ตรวจพบการเชื่อมต่อ Telegram เรียบร้อยแล้ว!\nChat ID: ${data.telegram_chat_id}`);
                    return;
                }
            }
            alert("ยังไม่พบข้อมูลการเชื่อมต่อ กรุณากดปุ่ม 'เชื่อมต่อ Telegram ทันที' แล้วกดปุ่ม Start (เริ่ม) ในบอท หรือใช้ปุ่ม 'ตรวจหา Telegram ID ล่าสุด' ครับ");
        } catch (err: any) {
            console.error("Refresh telegram error:", err);
            alert("ไม่สามารถอัปเดตข้อมูลได้ในขณะนี้: " + (err.message || ''));
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleFindRecentTelegramId = async () => {
        setIsSearchingRecentTelegram(true);
        try {
            // 1. Sync updates and check webhook
            await fetch('/api/telegram/sync-updates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ schoolId: currentUser.schoolId })
            }).catch(() => {});

            // 2. Fetch recent events
            const res = await fetch(`/api/telegram/recent-events?schoolId=${currentUser.schoolId || ''}`);
            if (res.ok) {
                const events = await res.json();
                if (Array.isArray(events) && events.length > 0) {
                    // Try to find an event with user's ID
                    const match = events.find(e => 
                        (e.linkedUserId && String(e.linkedUserId) === String(currentUser.id)) ||
                        (e.text && e.text.includes(currentUser.id))
                    );

                    if (match && match.chatId) {
                        setFormData(prev => ({ ...prev, telegramChatId: match.chatId }));
                        setShowManualTelegramInput(true);
                        onUpdateUser({ ...currentUser, telegramChatId: match.chatId });
                        // Persist to backend
                        await fetch('/api/telegram/link-user', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ citizenId: currentUser.id, chatId: match.chatId, schoolId: currentUser.schoolId })
                        }).catch(() => {});
                        alert(`🎯 ตรวจพบ Telegram Chat ID ของท่านแล้ว!\n\nChat ID: ${match.chatId}\nผู้ส่ง: ${match.senderName || match.username || 'ผู้ใช้'}\nข้อความ: "${match.text}"\n\nระบบบันทึกและผูกบัญชีเข้าสู่ระบบเรียบร้อยแล้วครับ!`);
                        return;
                    }

                    // Otherwise pick the most recent event
                    const latest = events[0];
                    if (latest && latest.chatId) {
                        const confirmUse = window.confirm(`พบข้อความล่าสุดจาก Telegram:\n"${latest.text}"\nผู้ส่ง: ${latest.senderName || latest.username || 'ผู้ใช้'}\nChat ID: ${latest.chatId}\nเวลา: ${new Date(latest.timestamp).toLocaleTimeString('th-TH')}\n\nนี่คือบัญชี Telegram ของท่านใช่หรือไม่? (กด ตกลง เพื่อบันทึกและผูก Chat ID นี้เข้าสู่ระบบทันที)`);
                        if (confirmUse) {
                            setFormData(prev => ({ ...prev, telegramChatId: latest.chatId }));
                            setShowManualTelegramInput(true);
                            onUpdateUser({ ...currentUser, telegramChatId: latest.chatId });
                            // Persist to backend
                            await fetch('/api/telegram/link-user', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ citizenId: currentUser.id, chatId: latest.chatId, schoolId: currentUser.schoolId })
                            }).catch(() => {});
                            alert(`✅ บันทึกและผูก Telegram Chat ID: ${latest.chatId} เข้าสู่ระบบเรียบร้อยแล้วครับ!`);
                        }
                        return;
                    }
                }
            }

            // 3. Check DB
            if (supabase) {
                const { data } = await supabase.from('profiles').select('telegram_chat_id').eq('id', currentUser.id).maybeSingle();
                if (data && data.telegram_chat_id) {
                    setFormData(prev => ({ ...prev, telegramChatId: data.telegram_chat_id }));
                    setShowManualTelegramInput(true);
                    onUpdateUser({ ...currentUser, telegramChatId: data.telegram_chat_id });
                    alert(`✅ ตรวจพบ Telegram Chat ID ในฐานข้อมูลแล้ว: ${data.telegram_chat_id}`);
                    return;
                }
            }

            alert(`ยังไม่พบข้อความที่ส่งเข้ามาใน Telegram ล่าสุด\n\nคำแนะนำ:\n1. กดปุ่ม "เชื่อมต่อ Telegram ทันที (อัตโนมัติ)" แล้วกดปุ่ม Start (เริ่ม) ในบอท\n2. หรือพิมพ์เลขบัตรประชาชน 13 หลัก (${currentUser.id}) ส่งให้บอท\n3. หรือพิมพ์คำว่า id ส่งให้บอท แล้วนำเลข Chat ID มากดใส่ในช่องได้เลยครับ`);
        } catch (e: any) {
            console.error("Error finding recent Telegram ID:", e);
            alert("ไม่สามารถค้นหาข้อความได้ในขณะนี้: " + (e.message || ''));
        } finally {
            setIsSearchingRecentTelegram(false);
        }
    };

    const handleRefreshLine = async () => {
        setIsRefreshingLine(true);
        if (supabase) {
            try {
                const { data, error } = await supabase.from('profiles').select('line_user_id').eq('id', currentUser.id).maybeSingle();
                if (error) throw error;
                if (data) {
                    onUpdateUser({ ...currentUser, lineUserId: data.line_user_id || '' });
                    if (data.line_user_id) {
                        alert("✅ ตรวจพบการเชื่อมต่อ LINE เรียบร้อยแล้วครับ!");
                    } else {
                        alert("ยังไม่พบการเชื่อมต่อ LINE กรุณากดปุ่ม 'กดเพื่อเชื่อมต่อ LINE ทันที' แล้วส่งข้อความใน LINE หรือใช้ปุ่ม 'ดึง LINE ID ล่าสุด' ครับ");
                    }
                }
            } catch (err) {
                console.error("Refresh line error:", err);
                alert("ไม่สามารถตรวจสอบสถานะได้ในขณะนี้");
            } finally {
                setIsRefreshingLine(false);
            }
        } else {
            setIsRefreshingLine(false);
        }
    };

    const handleFindRecentLineId = async () => {
        setIsSearchingRecentLine(true);
        try {
            const res = await fetch(`/api/line/recent-events?schoolId=${currentUser.schoolId || ''}`);
            if (res.ok) {
                const events = await res.json();
                if (Array.isArray(events) && events.length > 0) {
                    // Try to find an event with user's 13-digit ID
                    const match = events.find(e => e.text && e.text.includes(currentUser.id));
                    if (match && match.lineUserId) {
                        setFormData(prev => ({ ...prev, lineUserId: match.lineUserId }));
                        setShowManualLineInput(true);
                        alert(`🎯 ตรวจพบ LINE User ID ของท่านแล้ว!\n\nUser ID: ${match.lineUserId}\nข้อความที่ส่ง: "${match.text}"\n\nระบบนำมากรอกในช่องให้เรียบร้อยแล้ว กรุณากดปุ่ม "บันทึกการเปลี่ยนแปลง" ด้านล่างของหน้าเพื่อยืนยันครับ`);
                        return;
                    }

                    // Otherwise pick the most recent event
                    const latest = events[0];
                    if (latest && latest.lineUserId && latest.lineUserId !== 'unknown') {
                        const confirmUse = window.confirm(`พบข้อความล่าสุดจาก LINE:\n"${latest.text || latest.type}"\nรหัส LINE User ID: ${latest.lineUserId}\nเวลา: ${new Date(latest.timestamp).toLocaleTimeString('th-TH')}\n\nนี่คือบัญชี LINE ของท่านใช่หรือไม่? (กด ตกลง เพื่อนำรหัสนี้มาใส่ในระบบทันที)`);
                        if (confirmUse) {
                            setFormData(prev => ({ ...prev, lineUserId: latest.lineUserId }));
                            setShowManualLineInput(true);
                            alert(`✅ นำรหัส ${latest.lineUserId} มาใส่ในช่องเรียบร้อยแล้ว กรุณากดปุ่ม "บันทึกการเปลี่ยนแปลง" ด้านล่างของหน้าเพื่อบันทึกครับ`);
                        }
                        return;
                    }
                }
                alert("ยังไม่พบข้อความที่ส่งเข้ามาใน LINE Official Account ล่าสุด\n\nคำแนะนำ:\n1. ตรวจสอบว่าแอดมินตั้งค่า Webhook ใน LINE Developers และเปิด Use Webhook แล้วหรือยัง\n2. ลองส่งข้อความคำว่า 'id' หรือ '#ผูกLINE " + currentUser.id + "' เข้าไปในแชทบอท LINE ของโรงเรียนก่อน แล้วกดปุ่มนี้อีกครั้ง");
            }
        } catch (e: any) {
            console.error("Error finding recent LINE ID:", e);
            alert("ไม่สามารถค้นหาข้อความได้ในขณะนี้: " + e.message);
        } finally {
            setIsSearchingRecentLine(false);
        }
    };

    const handleConnectLine = () => {
        const linkCommand = `#ผูกLINE ${currentUser.id}`;
        navigator.clipboard.writeText(linkCommand).catch(() => {});
        setIsCopiedLine(true);
        setTimeout(() => setIsCopiedLine(false), 8000);

        if (lineBotId) {
            const cleanId = lineBotId.replace('@', '').trim();
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const lineUrl = `https://line.me/R/ti/p/@${cleanId}`;
            
            if (isMobile) {
                window.location.href = lineUrl;
            } else {
                window.open(lineUrl, '_blank');
            }
        } else {
            alert(`คัดลอกคำสั่ง: "${linkCommand}" เรียบร้อยแล้ว!\n\nกรุณาเปิด LINE Official Account ของโรงเรียน แล้วส่งข้อความนี้เพื่อเชื่อมต่อระบบครับ`);
        }
    };

    useEffect(() => {
        const loadBotConfig = async () => {
            if (supabase) {
                try {
                    const { data, error } = await supabase
                        .from('school_configs')
                        .select('telegram_bot_username, line_bot_basic_id')
                        .eq('school_id', currentUser.schoolId)
                        .maybeSingle();
                    
                    if (data) {
                        if (data.telegram_bot_username) setBotUsername(data.telegram_bot_username);
                        if (data.line_bot_basic_id) setLineBotId(data.line_bot_basic_id);
                    }
                } catch (err) {
                    console.error("Error loading bot config:", err);
                    setBotUsername('');
                } finally {
                    setIsLoadingConfig(false);
                }
            } else {
                setIsLoadingConfig(false);
            }
        };
        loadBotConfig();
    }, [currentUser.schoolId]);

    // Helper: Resize Image and convert to PNG
    const resizeImage = (file: File, maxWidth: number = 300): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(img, 0, 0, width, height);
                        resolve(canvas.toDataURL('image/png', 0.8)); // Convert to PNG
                    } else {
                        reject(new Error("Canvas context error"));
                    }
                };
                img.onerror = () => reject(new Error("Image load error"));
                img.src = event.target?.result as string;
            };
            reader.onerror = error => reject(error);
            reader.readAsDataURL(file);
        });
    };

    const handleSignatureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            try {
                const base64 = await resizeImage(file, 400); 
                setSignaturePreview(base64);
            } catch (error) {
                console.error("Error processing signature", error);
                alert("เกิดข้อผิดพลาดในการประมวลผลรูปภาพ");
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        
        const updated: Teacher = {
            ...currentUser,
            name: formData.name,
            position: formData.position,
            password: formData.password,
            signatureBase64: signaturePreview,
            telegramChatId: formData.telegramChatId,
            lineUserId: formData.lineUserId
        };

        try {
            // Update in MySQL profiles table (using mock supabase proxy client)
            if (supabase) {
                const { error } = await supabase.from('profiles').update({
                    name: updated.name,
                    position: updated.position,
                    password: updated.password,
                    signature_base_64: updated.signatureBase64,
                    telegram_chat_id: updated.telegramChatId,
                    line_user_id: updated.lineUserId
                }).eq('id', updated.id);
                if (error) throw new Error(error.message);
            }

            onUpdateUser(updated);
            alert("บันทึกข้อมูลเรียบร้อยแล้ว");
        } catch (error: any) {
            console.error("Save profile error", error);
            alert(`บันทึกข้อมูลไม่สำเร็จ: ${error.message || "เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล"}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleConnectTelegram = () => {
        if (!botUsername) {
            alert("⚠️ ยังไม่ได้ตั้งค่า 'Telegram Bot Username' ของโรงเรียนนี้ กรุณาติดต่อผู้ดูแลระบบโรงเรียนของท่านเพื่อตั้งค่าในเมนูแอดมินครับ");
            return;
        }

        // Clean bot username
        const cleanBotUser = botUsername.replace('@', '').trim();
        const webUrl = `https://t.me/${cleanBotUser}?start=${currentUser.id}`;

        // Auto copy 13-digit ID to clipboard as quick backup
        navigator.clipboard.writeText(currentUser.id).catch(() => {});

        // Open Telegram directly in a new window/tab
        window.open(webUrl, '_blank');

        // Trigger sync-updates to start poller / fetch updates
        fetch('/api/telegram/sync-updates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolId: currentUser.schoolId })
        }).catch(() => {});

        // Start active detection polling for 60 seconds (every 2s)
        setIsConnectingTelegram(true);
        let pollCount = 0;
        const linkCheckInterval = setInterval(async () => {
            pollCount++;
            if (pollCount > 30) { // 30 * 2s = 60s
                clearInterval(linkCheckInterval);
                setIsConnectingTelegram(false);
                return;
            }

            try {
                // Every 3 ticks (~6s), trigger sync-updates to ensure Telegram queue is flushed
                if (pollCount % 3 === 0) {
                    fetch('/api/telegram/sync-updates', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ schoolId: currentUser.schoolId })
                    }).catch(() => {});
                }

                // Check profiles table in DB
                if (supabase) {
                    const { data } = await supabase.from('profiles').select('telegram_chat_id').eq('id', currentUser.id).maybeSingle();
                    if (data && data.telegram_chat_id) {
                        setFormData(prev => ({ ...prev, telegramChatId: data.telegram_chat_id }));
                        onUpdateUser({ ...currentUser, telegramChatId: data.telegram_chat_id });
                        clearInterval(linkCheckInterval);
                        setIsConnectingTelegram(false);
                        alert(`🎉 เชื่อมต่อ Telegram สำเร็จเรียบร้อยแล้ว!\nTelegram Chat ID: ${data.telegram_chat_id}`);
                        return;
                    }
                }

                // Check recent events from server
                const res = await fetch(`/api/telegram/recent-events?schoolId=${currentUser.schoolId || ''}`);
                if (res.ok) {
                    const events = await res.json();
                    if (Array.isArray(events)) {
                        const match = events.find(e => 
                            (e.linkedUserId && String(e.linkedUserId) === String(currentUser.id)) ||
                            (e.text && e.text.includes(currentUser.id))
                        );
                        if (match && match.chatId) {
                            setFormData(prev => ({ ...prev, telegramChatId: match.chatId }));
                            onUpdateUser({ ...currentUser, telegramChatId: match.chatId });
                            fetch('/api/telegram/link-user', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ citizenId: currentUser.id, chatId: match.chatId, schoolId: currentUser.schoolId })
                            }).catch(() => {});
                            clearInterval(linkCheckInterval);
                            setIsConnectingTelegram(false);
                            alert(`🎉 เชื่อมต่อ Telegram สำเร็จเรียบร้อยแล้ว!\nTelegram Chat ID: ${match.chatId}`);
                            return;
                        }
                    }
                }
            } catch (err) {
                // silent
            }
        }, 2000);
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6 animate-fade-in pb-20">
             <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
                <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center font-bold text-2xl">
                    {formData.name[0]}
                </div>
                <div>
                    <h2 className="text-xl font-bold text-slate-800">ข้อมูลส่วนตัว</h2>
                    <p className="text-slate-500 text-sm">จัดการข้อมูลผู้ใช้งานและลายเซ็นดิจิทัล</p>
                </div>
             </div>

             <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Telegram Section */}
                    <div className="md:col-span-2 bg-indigo-50 p-6 rounded-2xl border border-indigo-100 space-y-4 relative overflow-hidden">
                        <div className="flex justify-between items-start relative z-10">
                            <div>
                                <h4 className="font-bold text-indigo-900 flex items-center gap-2 mb-1">
                                    <Smartphone size={18}/> ระบบแจ้งเตือน Telegram
                                </h4>
                                <p className="text-[11px] text-indigo-600">รับการแจ้งเตือนหนังสือราชการและการลาผ่านมือถือ</p>
                            </div>
                            {currentUser.telegramChatId ? (
                                <div className="bg-emerald-500 text-white px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 shadow-sm">
                                    <CheckCircle size={12}/> เชื่อมต่อแล้ว
                                </div>
                            ) : (
                                <div className="bg-slate-200 text-slate-500 px-3 py-1 rounded-full text-[10px] font-bold">ยังไม่ผูกบัญชี</div>
                            )}
                            {currentUser.telegramChatId && (
                                <button 
                                    type="button"
                                    onClick={handleRefreshTelegram}
                                    disabled={isRefreshing}
                                    className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 text-[10px] font-bold"
                                >
                                    <Zap size={12} className={isRefreshing ? 'animate-spin' : ''}/>
                                    {isRefreshing ? 'กำลังอัปเดต...' : 'รีเฟรชสถานะ'}
                                </button>
                            )}
                        </div>

                        {!currentUser.telegramChatId && !showManualTelegramInput ? (
                            <div className="p-4 bg-white/80 rounded-xl border border-dashed border-indigo-200 text-center space-y-3 relative z-10">
                                <MessageCircle size={24} className="mx-auto text-indigo-300"/>
                                <p className="text-xs font-bold text-slate-600">กดปุ่มเชื่อมต่อเพื่อเปิด Telegram อัตโนมัติ หรือกดปุ่ม <b>"ระบุ Chat ID เอง"</b><br/><span className="text-indigo-600 font-bold">เมื่อกดปุ่มแล้ว โปรดกดปุ่ม Start (เริ่ม) ในบอท Telegram ด้วยครับ</span></p>
                                
                                <button 
                                    type="button"
                                    onClick={handleRefreshTelegram}
                                    disabled={isRefreshing}
                                    className="mx-auto text-[10px] text-indigo-500 hover:text-indigo-700 font-bold flex items-center gap-1 border border-indigo-100 px-3 py-1 rounded-full bg-white/50"
                                >
                                    {isRefreshing ? <Loader size={10} className="animate-spin"/> : <Zap size={10}/>}
                                    กดตรวจสอบสถานะหากท่านกด Start ใน Telegram แล้ว
                                </button>
                            </div>
                        ) : null}

                        {(currentUser.telegramChatId || showManualTelegramInput) && (
                            <div className="space-y-1.5 relative z-10 bg-white p-3 rounded-xl border border-indigo-200 shadow-sm">
                                <div className="flex justify-between items-center">
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                        Telegram Chat ID (ตัวเลข)
                                    </label>
                                    <span className="text-[9px] text-indigo-600 font-bold">
                                        {formData.telegramChatId ? 'พร้อมใช้งาน' : 'ยังไม่ระบุ'}
                                    </span>
                                </div>
                                <div className="flex gap-2">
                                    <input 
                                        type="text"
                                        placeholder="เช่น 123456789 หรือ -100123456789"
                                        value={formData.telegramChatId || ''} 
                                        onChange={e => setFormData({ ...formData, telegramChatId: e.target.value.trim() })}
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 focus:bg-white font-mono text-sm font-bold text-indigo-700 outline-none focus:border-indigo-500 transition-all shadow-inner"
                                    />
                                    {formData.telegramChatId && (
                                        <button
                                            type="button"
                                            onClick={() => setFormData({ ...formData, telegramChatId: '' })}
                                            className="px-2.5 py-1 text-slate-400 hover:text-rose-500 border border-slate-200 rounded-lg text-xs"
                                            title="ล้างค่า"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                                <p className="text-[10px] text-slate-500 leading-relaxed">
                                    💡 <b>วิธีดู Chat ID:</b> เปิด Telegram ค้นหาบอท <b>@userinfobot</b> แล้วกด Start นำเลข <code>Id</code> มาใส่ในช่องนี้ แล้วกด <b>"บันทึกข้อมูลส่วนตัว"</b> ด้านล่าง หรือส่งเลขบัตรประชาชน 13 หลักให้บอทของโรงเรียนเพื่อผูกอัตโนมัติ
                                </p>
                            </div>
                        )}

                        {isConnectingTelegram && (
                            <div className="relative z-10 p-3.5 bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-xl text-xs text-indigo-950 flex flex-col gap-2.5 shadow-sm">
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm animate-spin">
                                            <Loader size={16}/>
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm text-indigo-900">กำลังรอตรวจจับการเชื่อมต่อจาก Telegram...</p>
                                            <p className="text-[11px] text-indigo-700">
                                                หากมีปุ่ม <b>Start</b> ให้กดปุ่ม Start ได้เลย หรือถ้าเคยเปิดแชทไว้แล้ว ให้ส่งเลข 13 หลักเข้าแชทบอท
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                                        <button
                                            type="button"
                                            onClick={handleFindRecentTelegramId}
                                            disabled={isSearchingRecentTelegram}
                                            className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-bold text-xs hover:bg-indigo-700 shadow-sm flex items-center gap-1 active:scale-95"
                                        >
                                            {isSearchingRecentTelegram ? <Loader className="animate-spin" size={12}/> : <Search size={12}/>}
                                            ตรวจหา ID ทันที
                                        </button>
                                    </div>
                                </div>
                                <div className="pt-2 border-t border-indigo-100 flex flex-wrap items-center justify-between gap-2 text-[11px] bg-white/70 p-2 rounded-lg">
                                    <span className="text-slate-600">
                                        ⚠️ <b>กรณีไม่มีปุ่ม Start ให้กด:</b> ให้คัดลอกเลขบัตรประชาชนนี้ไปส่งให้บอทในแชท:
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigator.clipboard.writeText(currentUser.id);
                                            alert(`คัดลอกเลขประจำตัว: ${currentUser.id} เรียบร้อยแล้ว\nนำไปวางแล้วส่งให้บอทในแชท Telegram ได้เลยครับ!`);
                                        }}
                                        className="px-2.5 py-1 bg-indigo-100 text-indigo-800 font-mono font-bold rounded hover:bg-indigo-200 flex items-center gap-1 shrink-0"
                                    >
                                        📋 {currentUser.id} (กดคัดลอก)
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 relative z-10">
                            <button 
                                type="button" 
                                onClick={handleConnectTelegram}
                                disabled={isLoadingConfig || isConnectingTelegram}
                                className="sm:col-span-2 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-all active:scale-95 flex items-center justify-center gap-2 text-sm"
                            >
                                {isLoadingConfig || isConnectingTelegram ? <Loader className="animate-spin" size={16}/> : <Zap size={16}/>} 
                                {isConnectingTelegram ? 'กำลังรอตรวจจับการกด Start...' : (currentUser.telegramChatId ? 'เชื่อมต่อ Telegram อีกครั้ง' : 'เชื่อมต่อ Telegram ทันที (อัตโนมัติ)')}
                            </button>
                            <button
                                type="button"
                                onClick={handleFindRecentTelegramId}
                                disabled={isSearchingRecentTelegram}
                                className="py-3 bg-white text-indigo-700 border-2 border-indigo-200 rounded-xl font-bold text-xs hover:bg-indigo-50 transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-sm"
                                title="ค้นหาข้อความจาก Telegram ล่าสุดเพื่อดึง Chat ID"
                            >
                                {isSearchingRecentTelegram ? <Loader className="animate-spin" size={14}/> : <Search size={14}/>}
                                ตรวจหา Chat ID ล่าสุด
                            </button>
                        </div>

                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center text-[10px] text-indigo-700 font-medium px-1 gap-1">
                            <span>💡 หากกด Start ในบอทแล้ว ID ยังไม่ขึ้น หรือส่งข้อความ <b>{currentUser.id}</b> เข้าบอทแล้ว ให้กด <b>"ตรวจหา Chat ID ล่าสุด"</b></span>
                            <button
                                type="button"
                                onClick={() => setShowManualTelegramInput(!showManualTelegramInput)}
                                className="underline hover:text-indigo-900 font-bold shrink-0"
                            >
                                {showManualTelegramInput ? 'ซ่อนช่องกรอกเอง' : 'ต้องการกรอก Chat ID เอง'}
                            </button>
                        </div>

                        {!isLoadingConfig && !botUsername && (
                            <div className="absolute inset-0 bg-white/90 backdrop-blur-[2px] z-20 flex items-center justify-center p-4 text-center">
                                <div className="space-y-2">
                                    <AlertCircle className="mx-auto text-amber-500" size={24}/>
                                    <p className="text-xs font-bold text-slate-600">แอดมินยังไม่ได้ตั้งค่า Username บอทให้โรงเรียนนี้ <br/>กรุณาแจ้งแอดมินโรงเรียนที่เมนู "การเชื่อมต่อ"</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* LINE Official Account Section */}
                    <div className="md:col-span-2 bg-emerald-50 p-6 rounded-2xl border border-emerald-200 space-y-4 relative overflow-hidden">
                        <div className="flex justify-between items-start relative z-10">
                            <div>
                                <h4 className="font-bold text-emerald-900 flex items-center gap-2 mb-1">
                                    <MessageSquare size={18} className="text-emerald-600"/> ระบบแจ้งเตือน LINE Official Account
                                </h4>
                                <p className="text-[11px] text-emerald-700">รับการแจ้งเตือนหนังสือราชการและการลาส่วนบุคคลผ่าน LINE อัตโนมัติ</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {currentUser.lineUserId ? (
                                    <div className="bg-emerald-600 text-white px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 shadow-sm">
                                        <CheckCircle size={12}/> เชื่อมต่อแล้ว
                                    </div>
                                ) : (
                                    <div className="bg-slate-200 text-slate-500 px-3 py-1 rounded-full text-[10px] font-bold">ยังไม่ผูกบัญชี</div>
                                )}
                                <button 
                                    type="button"
                                    onClick={handleRefreshLine}
                                    disabled={isRefreshingLine}
                                    className="text-emerald-700 hover:text-emerald-900 flex items-center gap-1 text-[10px] font-bold bg-white/70 px-2 py-1 rounded-lg border border-emerald-200"
                                >
                                    <Zap size={12} className={isRefreshingLine ? 'animate-spin' : ''}/>
                                    {isRefreshingLine ? 'กำลังตรวจ...' : 'รีเฟรชสถานะ'}
                                </button>
                            </div>
                        </div>

                        {!currentUser.lineUserId ? (
                            <div className="p-4 bg-white/90 rounded-xl border border-dashed border-emerald-300 text-center space-y-3 relative z-10">
                                <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                                    <MessageSquare size={20}/>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-bold text-slate-700">เชื่อมต่อง่ายๆ เพียง 1 คลิก</p>
                                    <p className="text-[11px] text-slate-500">
                                        กดปุ่มด้านล่าง ระบบจะคัดลอกคำสั่ง <span className="font-mono font-bold text-emerald-700 bg-emerald-100 px-1 rounded">#ผูกLINE {currentUser.id}</span> ให้อัตโนมัติ แล้วเปิด LINE ให้ท่านกดส่งข้อความได้ทันที
                                    </p>
                                </div>
                                
                                {isCopiedLine && (
                                    <div className="bg-emerald-100 text-emerald-800 text-xs px-3 py-1.5 rounded-lg font-bold flex items-center justify-center gap-1">
                                        <CheckCircle size={14}/> คัดลอกคำสั่งแล้ว! กำลังเปิด LINE โปรดวางแล้วกดส่งในแชทบอทครับ
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-1 relative z-10">
                                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">My LINE User ID</label>
                                <div className="flex gap-2">
                                    <input 
                                        type="text"
                                        value={formData.lineUserId || ''} 
                                        onChange={e => setFormData({ ...formData, lineUserId: e.target.value.trim() })}
                                        className="w-full px-3 py-2 border rounded-lg bg-white font-mono text-sm font-bold text-emerald-700 shadow-sm outline-none focus:border-emerald-500"
                                    />
                                    {formData.lineUserId && (
                                        <button
                                            type="button"
                                            onClick={() => setFormData({ ...formData, lineUserId: '' })}
                                            className="px-2.5 py-1 text-slate-400 hover:text-rose-500 border border-slate-200 rounded-lg text-xs"
                                            title="ล้างค่า"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col sm:flex-row gap-2 relative z-10">
                            <button 
                                type="button" 
                                onClick={handleConnectLine}
                                disabled={isLoadingConfig}
                                className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold shadow-lg hover:bg-emerald-700 transition-all active:scale-95 flex items-center justify-center gap-2 text-sm"
                            >
                                {isLoadingConfig ? <Loader className="animate-spin" size={16}/> : <Zap size={16}/>} 
                                {currentUser.lineUserId ? '🟢 อัปเดต/เชื่อมต่อ LINE ใหม่' : '🟢 กดเพื่อเชื่อมต่อ LINE ทันที (คลิกเดียว)'}
                            </button>

                            <button 
                                type="button" 
                                onClick={handleFindRecentLineId}
                                disabled={isSearchingRecentLine}
                                className="px-4 py-3 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl font-bold text-xs hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1.5"
                                title="หากพิมพ์ข้อความใน LINE แล้วแต่ยังไม่ขึ้น ให้กดปุ่มนี้เพื่อดึง LINE User ID ทันที"
                            >
                                <Search size={14} className={isSearchingRecentLine ? 'animate-spin' : ''}/>
                                {isSearchingRecentLine ? 'กำลังตรวจ...' : 'ตรวจหา LINE ID ล่าสุด'}
                            </button>

                            <button 
                                type="button"
                                onClick={() => setShowManualLineInput(!showManualLineInput)}
                                className="px-4 py-3 bg-white text-slate-600 border border-emerald-300 rounded-xl font-medium text-xs hover:bg-emerald-50 transition-colors"
                            >
                                {showManualLineInput ? 'ซ่อนการระบุเอง' : 'ระบุ ID เอง'}
                            </button>
                        </div>

                        {showManualLineInput && (
                            <div className="p-3 bg-white rounded-xl border border-emerald-200 space-y-2 relative z-10">
                                <label className="block text-xs font-bold text-slate-700">กรอก LINE User ID (ขึ้นต้นด้วย U...)</label>
                                <div className="flex gap-2">
                                    <input 
                                        type="text" 
                                        placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                        value={formData.lineUserId}
                                        onChange={e => setFormData({ ...formData, lineUserId: e.target.value.trim() })}
                                        className="flex-1 px-3 py-1.5 border rounded-lg font-mono text-xs outline-none focus:ring-2 focus:ring-emerald-500"
                                    />
                                </div>
                                <div className="text-[10px] text-slate-500 space-y-1 bg-slate-50 p-2 rounded-lg border border-slate-100">
                                    <p className="font-bold text-slate-700">💡 วิธีนำ LINE User ID มาใส่ในช่องนี้:</p>
                                    <p>1. เปิดแชทกับ LINE Official Account ของโรงเรียน แล้วพิมพ์คำว่า <b>id</b> หรือ <b>สวัสดี</b> ส่งไปในแชท</p>
                                    <p>2. กดปุ่ม <b>"ตรวจหา LINE ID ล่าสุด"</b> ด้านบน ระบบจะค้นหารหัส <span className="font-mono text-emerald-700 font-bold">U...</span> จากแชทที่เพิ่งส่งมาใส่ในช่องนี้ให้อัตโนมัติทันที</p>
                                    <p>3. เลื่อนลงไปด้านล่างสุดของหน้าแล้วกดปุ่ม <b>"บันทึกการเปลี่ยนแปลง"</b></p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                             <User size={16}/> ชื่อ - นามสกุล
                        </label>
                        <input 
                            type="text" 
                            required
                            value={formData.name}
                            onChange={e => setFormData({...formData, name: e.target.value})}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                             <Briefcase size={16}/> ตำแหน่ง
                        </label>
                        <select 
                            value={formData.position} 
                            onChange={e => setFormData({...formData, position: e.target.value})}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                        >
                             {ACADEMIC_POSITIONS.map(p => (
                                <option key={p} value={p}>{p}</option>
                             ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">เลขบัตรประชาชน (ID)</label>
                        <input 
                            type="text" 
                            disabled
                            value={formData.id}
                            className="w-full px-3 py-2 border rounded-lg bg-slate-100 text-slate-500 cursor-not-allowed"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                             <Lock size={16}/> รหัสผ่าน
                        </label>
                        <div className="relative">
                            <input 
                                type={showPassword ? "text" : "password"} 
                                value={formData.password}
                                onChange={e => setFormData({...formData, password: e.target.value})}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                            />
                            <button 
                                type="button" 
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                {showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="border-t pt-6">
                    <label className="block text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                        <FileSignature size={18}/> ลายเซ็นดิจิทัล (สำหรับลงนามเอกสาร)
                    </label>
                    
                    <div className="flex flex-col md:flex-row gap-6">
                        <div className="w-full md:w-1/2 h-32 border-2 border-dashed border-slate-300 rounded-xl flex items-center justify-center bg-slate-50 overflow-hidden relative">
                            {signaturePreview ? (
                                <img src={signaturePreview} className="max-h-full max-w-full object-contain" alt="Signature" />
                            ) : (
                                <span className="text-slate-400 text-sm">ยังไม่มีลายเซ็น</span>
                            )}
                        </div>
                        <div className="flex-1 flex flex-col justify-center gap-2">
                            <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 mb-2">
                                <p className="text-[10px] md:text-xs text-blue-700 font-bold leading-relaxed">
                                    <Info size={14} className="inline mr-1 mb-1"/> <b>คำแนะนำขนาดลายเซ็น:</b><br/>
                                    1. แนะนำขนาด <b>400 x 200 พิกเซล</b> (หรือสัดส่วน 2:1)<br/>
                                    2. ควรใช้พื้นหลัง <b>โปร่งใส (Transparent PNG)</b><br/>
                                    3. วางลายเซ็นให้ <b>อยู่กึ่งกลางรูปภาพ</b> พอดี<br/>
                                    เพื่อให้ลายเซ็นวางบนเส้นประในเอกสารได้สวยงามที่สุด
                                </p>
                            </div>
                            <label className="cursor-pointer bg-purple-50 text-purple-700 border border-purple-200 px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-purple-100 transition-colors">
                                <UploadCloud size={20}/> เลือกรูปภาพลายเซ็น
                                <input type="file" className="hidden" accept="image/*" onChange={handleSignatureUpload}/>
                            </label>
                            {signaturePreview && (
                                <button 
                                    type="button" 
                                    onClick={() => setSignaturePreview('')}
                                    className="text-red-500 text-sm hover:underline text-center"
                                >
                                    ลบลายเซ็น
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex justify-end pt-4">
                    <button 
                        type="submit" 
                        disabled={isSaving}
                        className="bg-purple-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                    >
                        {isSaving ? <Loader className="animate-spin" size={20}/> : <Save size={20}/>} 
                        {isSaving ? 'กำลังบันทึก...' : 'บันทึกข้อมูลส่วนตัว'}
                    </button>
                </div>
             </form>
        </div>
    );
};

export default UserProfile;
