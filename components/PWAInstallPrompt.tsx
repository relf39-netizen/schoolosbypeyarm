import React, { useState, useEffect } from 'react';
import { Download, Smartphone, Chrome, X, Share, PlusSquare, Info, CheckCircle, Star } from 'lucide-react';

const PWAInstallPrompt: React.FC = () => {
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [isInstalled, setIsInstalled] = useState(false);
    const [isIOS, setIsIOS] = useState(false);
    const [isAndroid, setIsAndroid] = useState(false);
    const [showPrompt, setShowPrompt] = useState(false);
    const [activeTab, setActiveTab] = useState<'AUTO' | 'IOS' | 'ANDROID_MANUAL'>('AUTO');

    useEffect(() => {
        // 1. Check if already running in standalone mode (installed)
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                            (window.navigator as any).standalone === true;
        
        if (isStandalone) {
            setIsInstalled(true);
            return;
        }

        // 2. Detect platform
        const ua = window.navigator.userAgent.toLowerCase();
        const ios = /iphone|ipad|ipod/.test(ua);
        const android = /android/.test(ua);
        setIsIOS(ios);
        setIsAndroid(android);

        // Set default tab based on platform
        if (ios) {
            setActiveTab('IOS');
        } else if (android) {
            setActiveTab('AUTO');
        } else {
            setActiveTab('AUTO');
        }

        // Check if user dismissed the prompt in this session
        const isDismissed = localStorage.getItem('schoolos_pwa_prompt_dismissed') === 'true';
        if (!isDismissed) {
            // Delay showing the prompt slightly for a better user experience
            const timer = setTimeout(() => {
                setShowPrompt(true);
            }, 1500);
            return () => clearTimeout(timer);
        }
    }, []);

    useEffect(() => {
        // 3. Listen to the browser's native beforeinstallprompt event (mainly Chrome/Android)
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            console.log('beforeinstallprompt event captured');
            setDeferredPrompt(e);
            // Auto switch to AUTO tab since we can trigger it programmatically
            setActiveTab('AUTO');
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        // Listen for successful installation
        const handleAppInstalled = () => {
            console.log('App was successfully installed!');
            setIsInstalled(true);
            setShowPrompt(false);
            localStorage.setItem('schoolos_pwa_installed', 'true');
        };

        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);

    const handleInstallClick = async () => {
        if (!deferredPrompt) {
            // If deferred prompt is not available, guide to manual installation
            if (isAndroid) {
                setActiveTab('ANDROID_MANUAL');
            } else if (isIOS) {
                setActiveTab('IOS');
            } else {
                setActiveTab('ANDROID_MANUAL');
            }
            return;
        }

        try {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to install prompt: ${outcome}`);
            if (outcome === 'accepted') {
                setDeferredPrompt(null);
                setShowPrompt(false);
            }
        } catch (error) {
            console.error('Error triggering PWA install prompt:', error);
        }
    };

    const handleDismiss = () => {
        setShowPrompt(false);
        // Persist dismissal so we don't annoy the user
        localStorage.setItem('schoolos_pwa_prompt_dismissed', 'true');
    };

    // If already installed, or prompt is closed, don't show anything
    if (isInstalled || !showPrompt) {
        return null;
    }

    return (
        <div id="pwa-install-banner" className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md bg-white rounded-3xl shadow-2xl border-2 border-blue-500/20 z-50 overflow-hidden animate-fade-in print:hidden">
            {/* Header */}
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-600 rounded-xl">
                        <Smartphone size={18} className="text-white animate-bounce" />
                    </div>
                    <div>
                        <h4 className="text-xs font-black tracking-wide text-blue-400 uppercase">PROGRESSIVE WEB APP</h4>
                        <h3 className="text-sm font-black text-white">ติดตั้งแอปพลิเคชัน SchoolOS</h3>
                    </div>
                </div>
                <button 
                    onClick={handleDismiss}
                    className="p-1.5 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition-colors"
                    title="ปิด"
                >
                    <X size={16} />
                </button>
            </div>

            {/* Platform Selection Tabs */}
            <div className="flex border-b border-slate-100 bg-slate-50 text-[11px] font-black uppercase tracking-wider">
                <button 
                    onClick={() => setActiveTab('AUTO')}
                    className={`flex-1 py-3 text-center transition-all ${activeTab === 'AUTO' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    {deferredPrompt ? '📲 ติดตั้งด่วน' : '📱 แนะนำสำหรับ Android'}
                </button>
                <button 
                    onClick={() => setActiveTab('IOS')}
                    className={`flex-1 py-3 text-center transition-all ${activeTab === 'IOS' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    🍎 สำหรับ iPhone / iPad
                </button>
                <button 
                    onClick={() => setActiveTab('ANDROID_MANUAL')}
                    className={`flex-1 py-3 text-center transition-all ${activeTab === 'ANDROID_MANUAL' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    🔍 วิธีติดตั้งมือถือทั่วไป
                </button>
            </div>

            {/* Tab Contents */}
            <div className="p-5 max-h-[320px] overflow-y-auto">
                {activeTab === 'AUTO' && (
                    <div className="space-y-4">
                        <div className="text-xs font-medium text-slate-600 leading-relaxed">
                            เปลี่ยนระบบเว็บไซต์ให้เป็น <span className="font-bold text-blue-600">แอปพลิเคชันเต็มรูปแบบ</span> บนมือถือของคุณ เพื่อการใช้งานที่เสถียร รวดเร็ว และลื่นไหลเหมือนแอปแท้ โดยไม่มีแถบที่อยู่เว็บของเบราว์เซอร์กวนใจ!
                        </div>

                        {deferredPrompt ? (
                            <div className="space-y-3">
                                <div className="bg-blue-50 text-blue-800 p-3.5 rounded-2xl border border-blue-100 text-xs font-bold flex items-start gap-2.5">
                                    <CheckCircle size={16} className="text-blue-600 shrink-0 mt-0.5" />
                                    <span>โทรศัพท์ของคุณรองรับการติดตั้งด่วนทันที! กดปุ่มติดตั้งด้านล่างเพื่อทำการสร้างแอป SchoolOS</span>
                                </div>
                                <button
                                    onClick={handleInstallClick}
                                    className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg shadow-blue-200 hover:shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2"
                                >
                                    <Download size={14} />
                                    ติดตั้งแอปทันที (Install App)
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="bg-amber-50/70 text-amber-900 p-4 rounded-2xl border border-amber-100 text-xs leading-relaxed space-y-2">
                                    <div className="font-bold text-amber-800 flex items-center gap-1.5">
                                        <Info size={14} className="text-amber-600" />
                                        <span>คำอธิบายวิธีติดตั้งบนระบบ Android:</span>
                                    </div>
                                    <div className="font-medium space-y-1.5 pl-5 list-decimal block">
                                        <div>1. เปิดลิงก์นี้ในแอป <span className="font-bold text-slate-800">Google Chrome</span> บนมือถือ</div>
                                        <div>2. สังเกตที่ด้านขวาบน คลิกสัญลักษณ์ <span className="font-bold text-slate-800">จุดสามจุด (⁝)</span></div>
                                        <div>3. เลือกเมนู <span className="font-bold text-blue-600">"ติดตั้งแอป" (Install App)</span> หรือ <span className="font-bold text-blue-600">"เพิ่มลงในหน้าจอหลัก" (Add to Home screen)</span></div>
                                        <div>4. กด <span className="font-bold text-slate-800">"ติดตั้ง"</span> ยืนยัน แอปจะปรากฏเป็นไอคอนบนหน้าจอมือถือของคุณทันที!</div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setActiveTab('ANDROID_MANUAL')}
                                    className="w-full py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2"
                                >
                                    <span>ดูขั้นตอนแบบมีรูปภาพประกอบ</span>
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'IOS' && (
                    <div className="space-y-4">
                        <div className="text-xs font-medium text-slate-600 leading-relaxed">
                            สำหรับอุปกรณ์ <span className="font-bold text-slate-900">Apple iPhone / iPad</span> สามารถติดตั้งเป็นแอปพลิเคชันได้ง่ายๆ ผ่านเว็บเบราว์เซอร์ <span className="font-bold text-blue-600">Safari</span> ตามขั้นตอนดังนี้:
                        </div>

                        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-3 text-xs text-slate-700 font-medium">
                            <div className="flex items-start gap-3">
                                <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center font-black text-[10px] shrink-0 mt-0.5">1</div>
                                <div>
                                    เปิดหน้านี้ด้วยเบราว์เซอร์ <span className="font-bold text-slate-900">Safari</span>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center font-black text-[10px] shrink-0 mt-0.5">2</div>
                                <div className="space-y-1">
                                    <span>กดปุ่ม <span className="font-bold text-blue-600">"แชร์" (Share)</span> 📥 ตรงแถบเมนูด้านล่างสุด</span>
                                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 bg-white p-1.5 rounded-lg border border-slate-100 max-w-max mt-1">
                                        <Share size={12} className="text-blue-500" />
                                        <span>ปุ่มแชร์รูปสี่เหลี่ยมที่มีลูกศรชี้ขึ้น</span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center font-black text-[10px] shrink-0 mt-0.5">3</div>
                                <div className="space-y-1">
                                    <span>เลื่อนลงมาแล้วกดเลือกเมนู <span className="font-bold text-blue-600">"เพิ่มไปยังหน้าจอโฮม" (Add to Home Screen)</span> ➕</span>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center font-black text-[10px] shrink-0 mt-0.5">4</div>
                                <div>
                                    กดปุ่ม <span className="font-bold text-slate-900">"เพิ่ม" (Add)</span> ที่มุมขวาบน เพื่อเสร็จสิ้นขั้นตอน
                                </div>
                            </div>
                        </div>

                        <div className="text-[10px] text-slate-400 font-bold text-center">
                            * เมื่อติดตั้งเรียบร้อยแล้ว แอป SchoolOS จะมีไอคอนและแสดงผลเต็มจอเหมือนแอปพลิเคชันทั่วไป!
                        </div>
                    </div>
                )}

                {activeTab === 'ANDROID_MANUAL' && (
                    <div className="space-y-3.5">
                        <div className="text-xs font-medium text-slate-600 leading-relaxed">
                            วิธีการติดตั้งแอปพลิเคชันด้วยตัวเองผ่านเมนูของเบราว์เซอร์:
                        </div>

                        <div className="border border-slate-150 rounded-2xl overflow-hidden text-xs">
                            <div className="bg-slate-50 px-4 py-2.5 font-bold text-slate-700 border-b border-slate-100 flex items-center gap-2">
                                <Chrome size={14} className="text-blue-500" />
                                <span>สำหรับ Google Chrome (Android / Desktop)</span>
                            </div>
                            <div className="p-4 space-y-2.5 font-medium text-slate-600">
                                <div className="flex gap-2">
                                    <span className="text-blue-500 font-bold">1.</span>
                                    <span>คลิกปุ่ม <span className="font-bold text-slate-800">จุดสามจุด (⁝)</span> ที่มุมขวาบนของ Chrome</span>
                                </div>
                                <div className="flex gap-2">
                                    <span className="text-blue-500 font-bold">2.</span>
                                    <span>หาเมนูคำว่า <span className="font-bold text-blue-600">"ติดตั้งแอป" (Install App)</span> หรือ <span className="font-bold text-blue-600">"เพิ่มลงในหน้าจอหลัก"</span></span>
                                </div>
                                <div className="flex gap-2">
                                    <span className="text-blue-500 font-bold">3.</span>
                                    <span>กดปุ่ม <span className="font-bold text-slate-800">"ติดตั้ง"</span> ระบบจะดาวน์โหลดและติดตั้งแอป SchoolOS ให้เป็นไอคอนแอปพลิเคชันเดี่ยวบนมือถือทันที!</span>
                                </div>
                            </div>
                        </div>

                        <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100 text-[10px] text-blue-800 font-medium">
                            💡 <b>ข้อดีของการติดตั้งเป็นแอป:</b> แอปจะทำงานแยกจากแท็บเบราว์เซอร์ทั่วไป, บูตระบบได้รวดเร็วยิ่งขึ้น, และช่วยประหยัดพลังงานแบตเตอรี่โทรศัพท์มือถือ
                        </div>
                    </div>
                )}
            </div>

            {/* Footer Status */}
            <div className="bg-slate-50 px-5 py-3 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-bold">
                <span className="flex items-center gap-1">
                    <Star size={10} className="text-amber-500 fill-amber-500 animate-pulse" />
                    รองรับทุกอุปกรณ์เคลื่อนที่ Android / iOS
                </span>
                <span>เวอร์ชันเว็บแอป v5.0</span>
            </div>
        </div>
    );
};

export default PWAInstallPrompt;
