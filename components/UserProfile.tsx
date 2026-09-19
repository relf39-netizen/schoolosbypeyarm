import React, { useState, useEffect } from 'react';
import { Teacher, SystemConfig } from '../types';
import { ACADEMIC_POSITIONS } from '../constants';
import { User, Lock, Save, UploadCloud, FileSignature, Briefcase, Eye, EyeOff, Loader, MessageCircle, Smartphone, CheckCircle, Zap, AlertCircle, Info, Copy, MessageSquare, Search, Check, ExternalLink } from 'lucide-react';
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
    const [isCopiedUserinfoBot, setIsCopiedUserinfoBot] = useState(false);
    const [isSavingTelegramId, setIsSavingTelegramId] = useState(false);
    const [isSavingLineId, setIsSavingLineId] = useState(false);
    const [isCopiedIdWord, setIsCopiedIdWord] = useState(false);

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

    const handleCopyUserinfoBot = () => {
        navigator.clipboard.writeText('@userinfobot').catch(() => {});
        setIsCopiedUserinfoBot(true);
        setTimeout(() => setIsCopiedUserinfoBot(false), 5000);
        alert("✅ คัดลอก '@userinfobot' เรียบร้อยแล้ว!\n\nเปิดแอป Telegram แล้วนำไปวางในช่องค้นหา (Search) เพื่อดู Chat ID ได้ทันทีครับ");
    };

    const handleOpenUserinfoBot = () => {
        navigator.clipboard.writeText('@userinfobot').catch(() => {});
        setIsCopiedUserinfoBot(true);
        setTimeout(() => setIsCopiedUserinfoBot(false), 5000);
        window.open('https://t.me/userinfobot', '_blank');
    };

    const handleSaveTelegramChatId = async (idToSave?: string) => {
        const val = (idToSave !== undefined ? idToSave : (formData.telegramChatId || '')).trim();
        setIsSavingTelegramId(true);
        try {
            if (supabase) {
                const { error } = await supabase.from('profiles').update({
                    telegram_chat_id: val
                }).eq('id', currentUser.id);
                if (error) throw new Error(error.message);
            }
            // Notify backend API if available
            fetch('/api/telegram/link-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ citizenId: currentUser.id, chatId: val, schoolId: currentUser.schoolId })
            }).catch(() => {});

            const updated: Teacher = {
                ...currentUser,
                telegramChatId: val
            };
            setFormData(prev => ({ ...prev, telegramChatId: val }));
            onUpdateUser(updated);
            alert(val ? `✅ บันทึก Telegram Chat ID: ${val} เรียบร้อยแล้วครับ!\n\nระบบจะส่งการแจ้งเตือนหนังสือราชการและวันลาไปยัง Telegram ของท่านทันที` : "ล้างข้อมูล Telegram Chat ID เรียบร้อยแล้ว");
        } catch (e: any) {
            alert(`❌ บันทึกไม่สำเร็จ: ${e.message}`);
        } finally {
            setIsSavingTelegramId(false);
        }
    };

    const handleFindRecentTelegramId = async () => {
        setIsSearchingRecentTelegram(true);
        try {
            // 1. Sync updates (safely)
            await fetch('/api/telegram/sync-updates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ schoolId: currentUser.schoolId })
            }).catch(() => {});

            // 2. Fetch recent events safely with content-type check
            try {
                const res = await fetch(`/api/telegram/recent-events?schoolId=${currentUser.schoolId || ''}`);
                const contentType = res.headers.get('content-type') || '';
                if (res.ok && contentType.includes('application/json')) {
                    const events = await res.json();
                    if (Array.isArray(events) && events.length > 0) {
                        const match = events.find(e => 
                            (e.linkedUserId && String(e.linkedUserId) === String(currentUser.id)) ||
                            (e.text && e.text.includes(currentUser.id))
                        );

                        if (match && match.chatId) {
                            setFormData(prev => ({ ...prev, telegramChatId: match.chatId }));
                            onUpdateUser({ ...currentUser, telegramChatId: match.chatId });
                            await handleSaveTelegramChatId(match.chatId);
                            return;
                        }

                        const latest = events[0];
                        if (latest && latest.chatId) {
                            const confirmUse = window.confirm(`พบข้อความล่าสุดจาก Telegram:\n"${latest.text}"\nผู้ส่ง: ${latest.senderName || latest.username || 'ผู้ใช้'}\nChat ID: ${latest.chatId}\n\nนี่คือบัญชี Telegram ของท่านใช่หรือไม่? (กด ตกลง เพื่อบันทึก Chat ID นี้ทันที)`);
                            if (confirmUse) {
                                setFormData(prev => ({ ...prev, telegramChatId: latest.chatId }));
                                onUpdateUser({ ...currentUser, telegramChatId: latest.chatId });
                                await handleSaveTelegramChatId(latest.chatId);
                            }
                            return;
                        }
                    }
                }
            } catch (fetchErr) {
                console.warn("Recent events fetch non-critical error:", fetchErr);
            }

            // 3. Check DB
            if (supabase) {
                const { data } = await supabase.from('profiles').select('telegram_chat_id').eq('id', currentUser.id).maybeSingle();
                if (data && data.telegram_chat_id) {
                    setFormData(prev => ({ ...prev, telegramChatId: data.telegram_chat_id }));
                    onUpdateUser({ ...currentUser, telegramChatId: data.telegram_chat_id });
                    alert(`✅ ตรวจพบ Telegram Chat ID ในฐานข้อมูลแล้ว: ${data.telegram_chat_id}`);
                    return;
                }
            }

            alert(`💡 แนะนำวิธีที่สะดวกและเร็วที่สุด:\n\n1. กดที่ปุ่ม "@userinfobot" ด้านบนเพื่อคัดลอกชื่อบอท\n2. ไปค้นหาในแอป Telegram แล้วกดปุ่ม Start\n3. คัดลอกเลข Id ที่บอทแจ้ง มาวางในช่อง "Telegram Chat ID" แล้วกด "บันทึก Chat ID" ได้ทันทีครับ!`);
        } catch (e: any) {
            console.error("Error finding recent Telegram ID:", e);
            alert(`💡 แนะนำวิธีที่สะดวกและเร็วที่สุด:\n\n1. กดที่ปุ่ม "@userinfobot" ด้านบนเพื่อคัดลอกชื่อบอท\n2. ไปค้นหาในแอป Telegram แล้วกดปุ่ม Start\n3. คัดลอกเลข Id ที่บอทแจ้ง มาวางในช่อง "Telegram Chat ID" แล้วกด "บันทึก Chat ID" ได้ทันทีครับ!`);
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

    const handleSaveLineUserId = async (idToSave?: string) => {
        const val = (idToSave !== undefined ? idToSave : (formData.lineUserId || '')).trim();
        setIsSavingLineId(true);
        try {
            if (supabase) {
                const { error } = await supabase.from('profiles').update({
                    line_user_id: val
                }).eq('id', currentUser.id);
                if (error) throw new Error(error.message);
            }
            // Notify backend API
            fetch('/api/line/link-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ citizenId: currentUser.id, lineUserId: val })
            }).catch(() => {});

            const updated: Teacher = {
                ...currentUser,
                lineUserId: val
            };
            setFormData(prev => ({ ...prev, lineUserId: val }));
            onUpdateUser(updated);
            alert(val ? `✅ บันทึก LINE User ID: ${val} เรียบร้อยแล้วครับ!\n\nระบบจะส่งการแจ้งเตือนไปยัง LINE ของท่านทันที 🟢` : "ล้างข้อมูล LINE User ID เรียบร้อยแล้ว");
        } catch (e: any) {
            alert(`❌ บันทึกไม่สำเร็จ: ${e.message}`);
        } finally {
            setIsSavingLineId(false);
        }
    };

    const handleCopyIdWord = () => {
        navigator.clipboard.writeText('id').catch(() => {});
        setIsCopiedIdWord(true);
        setTimeout(() => setIsCopiedIdWord(false), 4000);
    };

    const handleFindRecentLineId = async () => {
        setIsSearchingRecentLine(true);
        try {
            // 1. Check DB first (in case webhook or another process already updated it)
            if (supabase) {
                const { data } = await supabase.from('profiles').select('line_user_id').eq('id', currentUser.id).maybeSingle();
                if (data && data.line_user_id) {
                    setFormData(prev => ({ ...prev, lineUserId: data.line_user_id }));
                    onUpdateUser({ ...currentUser, lineUserId: data.line_user_id });
                    alert(`✅ ตรวจพบ LINE User ID ในฐานข้อมูลเรียบร้อยแล้ว!\n\nUser ID: ${data.line_user_id}`);
                    return;
                }
            }

            // 2. Safely check recent webhook events from backend
            try {
                const res = await fetch(`/api/line/recent-events?schoolId=${currentUser.schoolId || ''}`);
                const contentType = res.headers.get('content-type') || '';
                if (res.ok && contentType.includes('application/json')) {
                    const events = await res.json();
                    if (Array.isArray(events) && events.length > 0) {
                        // Check if an event mentions user's 13-digit ID
                        const match = events.find(e => e.text && e.text.includes(currentUser.id));
                        if (match && match.lineUserId && match.lineUserId !== 'unknown') {
                            await handleSaveLineUserId(match.lineUserId);
                            return;
                        }

                        // Otherwise check latest event
                        const latest = events[0];
                        if (latest && latest.lineUserId && latest.lineUserId !== 'unknown') {
                            const confirmUse = window.confirm(`พบข้อความล่าสุดจาก LINE:\n"${latest.text || latest.type}"\nรหัส LINE User ID: ${latest.lineUserId}\nเวลา: ${new Date(latest.timestamp).toLocaleTimeString('th-TH')}\n\nนี่คือบัญชี LINE ของท่านใช่หรือไม่?\n(กด ตกลง เพื่อบันทึกรหัสนี้เข้าระบบทันที)`);
                            if (confirmUse) {
                                await handleSaveLineUserId(latest.lineUserId);
                                return;
                            }
                        }
                    }
                }
            } catch (fetchErr) {
                console.warn("LINE recent events fetch non-critical error:", fetchErr);
            }

            alert(`💡 วิธีรับ LINE User ID ของท่านที่ง่ายที่สุด:\n\n1. กดปุ่ม "เปิดแอป LINE" ด้านบน\n2. ส่งคำว่า "id" หรือพิมพ์ "#ผูกLINE ${currentUser.id}" เข้าไปในแชทบอท\n3. บอทจะตอบกลับรหัส U... ให้นำมาวางในช่อง "LINE User ID" แล้วกดปุ่ม "บันทึก LINE ID ทันที" ได้เลยครับ\n\n📌 หมายเหตุ: หากส่งข้อความแล้วบอทไม่ตอบ แสดงว่าแอดมินยังไม่ได้เปิดสวิตช์ "Use Webhook" ใน LINE Developers Console ครับ`);
        } catch (e: any) {
            console.error("Error finding recent LINE ID:", e);
            alert("ไม่สามารถค้นหาข้อความได้ในขณะนี้: " + (e.message || ''));
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

                        {/* PROMINENT @userinfobot CARD - HARMONIZED & ELEGANT */}
                        <div className="relative z-10 bg-gradient-to-br from-indigo-50/80 via-white to-blue-50/80 border border-indigo-200 rounded-xl p-3.5 sm:p-4 shadow-sm space-y-3">
                            <div>
                                <h5 className="text-sm sm:text-base font-bold text-indigo-950 flex items-center gap-1.5">
                                    <Zap className="text-amber-500 fill-amber-500" size={16}/>
                                    วิธีรับ Chat ID ที่ง่ายที่สุด (ผ่านบอท @userinfobot)
                                </h5>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    ดูเลข ID ของตัวเองได้ทันทีใน 5 วินาที ผ่านบอทกลางของ Telegram
                                </p>
                            </div>

                            {/* HARMONIZED @userinfobot BOX */}
                            <div className="p-3 bg-white rounded-lg border border-indigo-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-2.5 text-center sm:text-left">
                                <div 
                                    onClick={handleCopyUserinfoBot}
                                    className="cursor-pointer group flex items-center gap-2.5"
                                    title="คลิกเพื่อคัดลอก @userinfobot"
                                >
                                    <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs group-hover:scale-105 transition-transform">
                                        <MessageSquare size={18}/>
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                            ค้นหาบอทชื่อนี้ใน Telegram
                                        </div>
                                        <div className="text-base sm:text-lg font-bold text-indigo-900 font-mono tracking-wide group-hover:text-indigo-600 transition-colors">
                                            @userinfobot
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-wrap sm:flex-nowrap gap-1.5 w-full sm:w-auto">
                                    <button
                                        type="button"
                                        onClick={handleCopyUserinfoBot}
                                        className="flex-1 sm:flex-none px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1 shadow-xs"
                                    >
                                        {isCopiedUserinfoBot ? <Check size={14} className="text-emerald-300"/> : <Copy size={14}/>}
                                        {isCopiedUserinfoBot ? 'คัดลอกแล้ว!' : 'คัดลอก @userinfobot'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleOpenUserinfoBot}
                                        className="flex-1 sm:flex-none px-3 py-1.5 bg-white border border-indigo-300 hover:bg-indigo-50 active:scale-95 text-indigo-700 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1 shadow-xs"
                                    >
                                        <ExternalLink size={14}/>
                                        เปิด Telegram
                                    </button>
                                </div>
                            </div>

                            {/* STEP-BY-STEP INSTRUCTIONS */}
                            <div className="bg-indigo-50/50 p-2.5 rounded-lg border border-indigo-100 space-y-1.5">
                                <div className="text-[11px] font-bold text-indigo-950 uppercase tracking-wider">
                                    📌 ขั้นตอนการขอรับ Chat ID (ทำเพียงครั้งเดียว):
                                </div>
                                <ol className="text-xs text-slate-600 space-y-1 font-medium">
                                    <li className="flex items-start gap-1.5">
                                        <span className="w-4 h-4 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                                        <span>กดปุ่ม <b>"คัดลอก @userinfobot"</b> หรือกด <b>"เปิด Telegram"</b> ด้านบน</span>
                                    </li>
                                    <li className="flex items-start gap-1.5">
                                        <span className="w-4 h-4 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
                                        <span>ในแอป Telegram ให้กดปุ่ม <b>Start</b> บอทจะตอบกลับตัวเลข เช่น: <code className="bg-white px-1.5 py-0.5 rounded border border-indigo-200 text-indigo-700 font-bold font-mono">Id: 123456789</code></span>
                                    </li>
                                    <li className="flex items-start gap-1.5">
                                        <span className="w-4 h-4 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
                                        <span>คัดลอกเฉพาะตัวเลข <b>Id</b> มาวางในช่องด้านล่าง แล้วกด <b>"บันทึก Chat ID ทันที"</b></span>
                                    </li>
                                </ol>
                            </div>

                            {/* CHAT ID INPUT & INSTANT SAVE BUTTON */}
                            <div className="bg-white p-3 rounded-lg border border-indigo-200 shadow-xs space-y-1.5">
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1">
                                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                        <span>Telegram Chat ID ของท่าน (ตัวเลข):</span>
                                    </label>
                                    <span className="text-[11px] font-bold">
                                        {formData.telegramChatId ? (
                                            <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                                🟢 บันทึกแล้ว: {formData.telegramChatId}
                                            </span>
                                        ) : (
                                            <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                                ⚠️ ยังไม่ได้ระบุ Chat ID
                                            </span>
                                        )}
                                    </span>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <div className="relative flex-1">
                                        <input 
                                            type="text"
                                            placeholder="วางตัวเลข Chat ID เช่น 123456789"
                                            value={formData.telegramChatId || ''} 
                                            onChange={e => setFormData({ ...formData, telegramChatId: e.target.value.trim() })}
                                            className="w-full px-3 py-1.5 border border-slate-200 focus:border-indigo-500 rounded-lg bg-slate-50 focus:bg-white font-mono text-sm font-bold text-indigo-900 outline-none transition-all"
                                        />
                                        {formData.telegramChatId && (
                                            <button
                                                type="button"
                                                onClick={() => setFormData({ ...formData, telegramChatId: '' })}
                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500 font-bold text-xs"
                                                title="ล้างค่า"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleSaveTelegramChatId()}
                                        disabled={isSavingTelegramId}
                                        className="py-1.5 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs transition-all shadow-xs active:scale-95 flex items-center justify-center gap-1.5 shrink-0"
                                    >
                                        {isSavingTelegramId ? <Loader className="animate-spin" size={14}/> : <Save size={14}/>}
                                        บันทึก Chat ID ทันที
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* SECONDARY / BACKUP: SCHOOL BOT AUTOMATIC LINK */}
                        <div className="relative z-10 pt-1 border-t border-indigo-100">
                            <button
                                type="button"
                                onClick={() => setShowManualTelegramInput(!showManualTelegramInput)}
                                className="text-xs font-bold text-indigo-700 hover:text-indigo-900 flex items-center justify-between w-full p-1.5 hover:bg-indigo-50/50 rounded-lg transition-colors"
                            >
                                <span>⚙️ ตัวเลือกเสริม: เชื่อมต่อผ่านบอทโรงเรียนอัตโนมัติ ({botUsername || 'บอทโรงเรียน'})</span>
                                <span className="text-[11px] underline font-medium">{showManualTelegramInput ? 'ซ่อน' : 'แสดง'}</span>
                            </button>

                            {showManualTelegramInput && (
                                <div className="mt-2 p-3 bg-white rounded-xl border border-indigo-200 space-y-3">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                        <button 
                                            type="button" 
                                            onClick={handleConnectTelegram}
                                            disabled={isLoadingConfig || isConnectingTelegram}
                                            className="sm:col-span-2 py-2 bg-indigo-600 text-white rounded-lg font-bold shadow-xs hover:bg-indigo-700 transition-all active:scale-95 flex items-center justify-center gap-1.5 text-xs"
                                        >
                                            {isLoadingConfig || isConnectingTelegram ? <Loader className="animate-spin" size={14}/> : <Zap size={14}/>} 
                                            {isConnectingTelegram ? 'กำลังรอตรวจจับ...' : 'เชื่อมต่อผ่านบอทโรงเรียน (อัตโนมัติ)'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleFindRecentTelegramId}
                                            disabled={isSearchingRecentTelegram}
                                            className="py-2 bg-white text-indigo-700 border border-indigo-300 rounded-lg font-bold text-xs hover:bg-indigo-50 transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-xs"
                                        >
                                            {isSearchingRecentTelegram ? <Loader className="animate-spin" size={14}/> : <Search size={14}/>}
                                            ตรวจหา ID ล่าสุด
                                        </button>
                                    </div>
                                    <p className="text-[11px] text-slate-500 leading-relaxed">
                                        💡 หากกด Start ในบอทโรงเรียนแล้ว หรือเคยส่งเลข <b>{currentUser.id}</b> ให้บอทโรงเรียนแล้ว สามารถกดปุ่ม "ตรวจหา ID ล่าสุด" เพื่อดึงข้อมูลได้เช่นกัน
                                    </p>
                                </div>
                            )}
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
                    <div className="md:col-span-2 bg-emerald-50/60 p-4 sm:p-5 rounded-2xl border border-emerald-200 space-y-4 relative overflow-hidden">
                        <div className="flex justify-between items-start relative z-10">
                            <div>
                                <h4 className="font-bold text-emerald-950 flex items-center gap-2 mb-0.5 text-sm sm:text-base">
                                    <MessageSquare size={18} className="text-emerald-600"/> ระบบแจ้งเตือน LINE Official Account
                                </h4>
                                <p className="text-xs text-emerald-700">รับการแจ้งเตือนหนังสือราชการและการลาส่วนบุคคลผ่าน LINE อัตโนมัติ</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {currentUser.lineUserId ? (
                                    <div className="bg-emerald-600 text-white px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 shadow-xs">
                                        <CheckCircle size={12}/> เชื่อมต่อแล้ว
                                    </div>
                                ) : (
                                    <div className="bg-slate-200 text-slate-600 px-2.5 py-1 rounded-full text-[10px] font-bold">ยังไม่ผูกบัญชี</div>
                                )}
                                <button 
                                    type="button"
                                    onClick={handleRefreshLine}
                                    disabled={isRefreshingLine}
                                    className="text-emerald-700 hover:text-emerald-900 flex items-center gap-1 text-[10px] font-bold bg-white px-2 py-1 rounded-lg border border-emerald-200 shadow-xs"
                                >
                                    <Zap size={11} className={isRefreshingLine ? 'animate-spin' : ''}/>
                                    {isRefreshingLine ? 'กำลังตรวจ...' : 'รีเฟรช'}
                                </button>
                            </div>
                        </div>

                        {/* PROMINENT & HARMONIZED LINE CONNECT CARD */}
                        <div className="relative z-10 bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/90 border border-emerald-200 rounded-xl p-3.5 sm:p-4 shadow-sm space-y-3">
                            <div>
                                <h5 className="text-sm sm:text-base font-bold text-emerald-950 flex items-center gap-1.5">
                                    <Zap className="text-emerald-600 fill-emerald-600" size={16}/>
                                    วิธีเชื่อมต่อและดึง LINE User ID (แนะนำ)
                                </h5>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    ส่งข้อความหรือคำสั่งไปยัง LINE บอทของโรงเรียนเพื่อรับรหัส <span className="font-mono font-bold text-emerald-700">U...</span> สำหรับเชื่อมต่อ
                                </p>
                            </div>

                            {/* LINE ACTION BUTTONS BAR */}
                            <div className="p-3 bg-white rounded-lg border border-emerald-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-2.5 text-center sm:text-left">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                                        <MessageSquare size={18}/>
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                            LINE บอทโรงเรียน
                                        </div>
                                        <div className="text-sm sm:text-base font-bold text-emerald-900 font-mono tracking-wide">
                                            {lineBotId ? (lineBotId.startsWith('@') ? lineBotId : `@${lineBotId}`) : 'LINE Official Account'}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-wrap sm:flex-nowrap gap-1.5 w-full sm:w-auto">
                                    <button
                                        type="button"
                                        onClick={handleConnectLine}
                                        className="flex-1 sm:flex-none px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1 shadow-xs"
                                        title="คัดลอกคำสั่งและเปิดแอป LINE ทันที"
                                    >
                                        <Copy size={13}/>
                                        คัดลอกคำสั่ง #ผูกLINE
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCopyIdWord}
                                        className="px-2.5 py-1.5 bg-white border border-emerald-300 hover:bg-emerald-50 active:scale-95 text-emerald-800 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1 shadow-xs"
                                        title="คัดลอกคำว่า id เพื่อนำไปส่งในแชทบอท"
                                    >
                                        {isCopiedIdWord ? <Check size={13} className="text-emerald-600"/> : <Copy size={13}/>}
                                        {isCopiedIdWord ? 'คัดลอกแล้ว' : 'คัดลอกคำว่า id'}
                                    </button>
                                    {lineBotId && (
                                        <a
                                            href={`https://line.me/R/ti/p/@${lineBotId.replace('@', '').trim()}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-3 py-1.5 bg-white border border-emerald-400 hover:bg-emerald-50 active:scale-95 text-emerald-700 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1 shadow-xs"
                                        >
                                            <ExternalLink size={13}/>
                                            เปิด LINE
                                        </a>
                                    )}
                                </div>
                            </div>

                            {isCopiedLine && (
                                <div className="bg-emerald-100 text-emerald-900 text-xs px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 border border-emerald-200">
                                    <CheckCircle size={14} className="text-emerald-700 shrink-0"/>
                                    <span>คัดลอกคำสั่ง <code className="bg-white/80 px-1 py-0.5 rounded font-mono">#ผูกLINE {currentUser.id}</code> เรียบร้อยแล้ว! โปรดวางและส่งในแชทบอท LINE ของโรงเรียน</span>
                                </div>
                            )}

                            {/* STEP-BY-STEP INSTRUCTIONS */}
                            <div className="bg-emerald-50/50 p-2.5 rounded-lg border border-emerald-100 space-y-1.5">
                                <div className="text-[11px] font-bold text-emerald-950 uppercase tracking-wider">
                                    📌 ขั้นตอนการดึงและเชื่อมต่อ LINE User ID:
                                </div>
                                <ol className="text-xs text-slate-600 space-y-1 font-medium">
                                    <li className="flex items-start gap-1.5">
                                        <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                                        <span>กดปุ่ม <b>"คัดลอกคำสั่ง #ผูกLINE"</b> หรือกด <b>"เปิด LINE"</b> ด้านบน</span>
                                    </li>
                                    <li className="flex items-start gap-1.5">
                                        <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
                                        <span>ในแชทกับบอทโรงเรียน ให้ส่งข้อความ <code className="bg-white px-1.5 py-0.5 rounded border border-emerald-200 text-emerald-800 font-bold font-mono">#ผูกLINE {currentUser.id}</code> หรือส่งคำว่า <code className="bg-white px-1 py-0.5 rounded border border-emerald-200 text-emerald-800 font-bold font-mono">id</code> บอทจะตอบกลับรหัส <span className="font-mono text-emerald-700 font-bold">U...</span></span>
                                    </li>
                                    <li className="flex items-start gap-1.5">
                                        <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
                                        <span>กดปุ่ม <b>"ตรวจหา LINE ID ล่าสุด"</b> ด้านล่าง (ระบบจะดึงรหัสมาใส่และบันทึกให้อัตโนมัติ) หรือคัดลอกรหัส <span className="font-mono text-emerald-700 font-bold">U...</span> มาวางในช่องแล้วกด <b>"บันทึก LINE ID ทันที"</b></span>
                                    </li>
                                </ol>
                            </div>

                            {/* LINE USER ID INPUT & INSTANT ACTIONS */}
                            <div className="bg-white p-3 rounded-lg border border-emerald-200 shadow-xs space-y-1.5">
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1">
                                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                        <span>LINE User ID ของท่าน (ขึ้นต้นด้วย U...):</span>
                                    </label>
                                    <span className="text-[11px] font-bold">
                                        {formData.lineUserId ? (
                                            <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                                🟢 บันทึกแล้ว: {formData.lineUserId}
                                            </span>
                                        ) : (
                                            <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                                ⚠️ ยังไม่ได้ระบุ LINE User ID
                                            </span>
                                        )}
                                    </span>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <div className="relative flex-1">
                                        <input 
                                            type="text"
                                            placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (33 ตัวอักษร)"
                                            value={formData.lineUserId || ''} 
                                            onChange={e => setFormData({ ...formData, lineUserId: e.target.value.trim() })}
                                            className="w-full px-3 py-1.5 border border-slate-200 focus:border-emerald-500 rounded-lg bg-slate-50 focus:bg-white font-mono text-sm font-bold text-emerald-800 outline-none transition-all"
                                        />
                                        {formData.lineUserId && (
                                            <button
                                                type="button"
                                                onClick={() => setFormData({ ...formData, lineUserId: '' })}
                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500 font-bold text-xs"
                                                title="ล้างค่า"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleSaveLineUserId()}
                                        disabled={isSavingLineId}
                                        className="py-1.5 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs transition-all shadow-xs active:scale-95 flex items-center justify-center gap-1.5 shrink-0"
                                    >
                                        {isSavingLineId ? <Loader className="animate-spin" size={14}/> : <Save size={14}/>}
                                        บันทึก LINE ID ทันที
                                    </button>
                                    <button 
                                        type="button" 
                                        onClick={handleFindRecentLineId}
                                        disabled={isSearchingRecentLine}
                                        className="py-1.5 px-3 bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 rounded-lg font-bold text-xs transition-all active:scale-95 flex items-center justify-center gap-1 shrink-0"
                                        title="หากส่งข้อความใน LINE แล้ว ให้กดปุ่มนี้เพื่อดึงรหัสมาใส่และบันทึกอัตโนมัติ"
                                    >
                                        {isSearchingRecentLine ? <Loader className="animate-spin" size={14}/> : <Search size={14}/>}
                                        ตรวจหา LINE ID ล่าสุด
                                    </button>
                                </div>
                            </div>

                            {/* HELPFUL NOTE / TROUBLESHOOTING */}
                            <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-200/60 space-y-1">
                                <div className="font-bold text-slate-700 flex items-center gap-1">
                                    💡 ทำไม LINE User ID ถึงไม่ใช่ชื่อหรือเบอร์โทร?
                                </div>
                                <p>
                                    ระบบแจ้งเตือนของ LINE Messaging API จะต้องใช้รหัสเทคนิคัล (ขึ้นต้นด้วยตัว <b>U</b> ตามด้วยตัวอักษรและตัวเลข 32 ตัว) ซึ่งไม่ใช่ชื่อไอดีที่ตั้งในโปรไฟล์ทั่วไป การส่งข้อความไปหาบอทของโรงเรียนคือวิธีที่สะดวกและถูกต้องที่สุดในการรับรหัสนี้ครับ
                                </p>
                                <div className="text-[10px] text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200 font-medium space-y-1">
                                    <div className="font-bold text-amber-900 flex items-center gap-1">
                                        ⚙️ กรณีส่งข้อความไปแล้วบอทไม่ตอบกลับ (ต้องตั้งค่าใน LINE 2 จุด):
                                    </div>
                                    <p>
                                        <b>จุดที่ 1 (LINE Developers Console):</b> ตั้ง Webhook URL เป็น <code className="bg-white px-1 py-0.5 rounded font-mono text-emerald-800 font-bold">{typeof window !== 'undefined' ? `${window.location.origin}/api/line/webhook` : '/api/line/webhook'}</code> แล้วกด <b>Verify</b> และเปิดสวิตช์ <b>"Use Webhook"</b> ให้เป็นสีเขียว
                                    </p>
                                    <p>
                                        <b>จุดที่ 2 (LINE Official Account Manager - manager.line.biz):</b> ไปที่ <i>ตั้งค่า</i> &gt; <i>การตั้งค่าตอบกลับ</i> &gt; ในส่วนการตั้งค่าโดยละเอียด ให้เปิด <b>"Webhook"</b> เป็น <b>"เปิด (ON)"</b> (หากปิดอยู่ LINE จะไม่ส่งข้อความเข้ามาที่บอท)
                                    </p>
                                </div>
                            </div>
                        </div>
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
