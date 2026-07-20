import React, { useState, useEffect } from 'react';
import { Download, Smartphone, Chrome, X, Share, PlusSquare, Info, CheckCircle, Star, Copy, ExternalLink, AlertTriangle } from 'lucide-react';

interface PWAInstallPromptProps {
    appName?: string;
    appLogoUrl?: string;
}

const PWAInstallPrompt: React.FC<PWAInstallPromptProps> = ({ appName, appLogoUrl }) => {
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [isInstalled, setIsInstalled] = useState(false);
    const [isIOS, setIsIOS] = useState(false);
    const [isAndroid, setIsAndroid] = useState(false);
    const [isInAppBrowser, setIsInAppBrowser] = useState(false);
    const [showPrompt, setShowPrompt] = useState(false);
    const [activeTab, setActiveTab] = useState<'AUTO' | 'IOS' | 'ANDROID_MANUAL' | 'IN_APP'>('AUTO');
    const [copySuccess, setCopySuccess] = useState(false);

    useEffect(() => {
        // 1. Check if already running in standalone mode (installed as PWA)
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                            (window.navigator as any).standalone === true;
        
        if (isStandalone) {
            setIsInstalled(true);
            return;
        }

        // 2. Detect platform and user agent
        const ua = window.navigator.userAgent.toLowerCase();
        const ios = /iphone|ipad|ipod/.test(ua);
        const android = /android/.test(ua);
        setIsIOS(ios);
        setIsAndroid(android);

        // Detect in-app browsers like LINE, Facebook, Instagram, Messenger, WeChat, Google Search App
        const isLNE = ua.includes('line');
        const isFB = ua.includes('fbav') || ua.includes('fb_iab') || ua.includes('fb4a') || ua.includes('fban');
        const isMessenger = ua.includes('messenger') || ua.includes('fbiab');
        const isInstagram = ua.includes('instagram');
        const isWeChat = ua.includes('micromessenger');
        const isOthersInApp = ua.includes('webview') || ua.includes('gsa'); // gsa is Google Search App on iOS

        const inApp = isLNE || isFB || isMessenger || isInstagram || isWeChat || isOthersInApp;
        setIsInAppBrowser(inApp);

        // Set default tab based on platform
        if (inApp) {
            setActiveTab('IN_APP');
        } else if (ios) {
            setActiveTab('IOS');
        } else {
            setActiveTab('AUTO');
        }

        // Check if user dismissed the prompt in this session
        const isDismissed = localStorage.getItem('schoolos_pwa_prompt_dismissed') === 'true';
        if (!isDismissed) {
            // Delay showing the prompt slightly for a better user experience
            const timer = setTimeout(() => {
                setShowPrompt(true);
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, []);

    useEffect(() => {
        // 3. Listen to the browser's native beforeinstallprompt event (Chrome/Android)
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            console.log('beforeinstallprompt event captured');
            setDeferredPrompt(e);
            
            // If we are not in an in-app browser, set to AUTO tab to show install option
            if (!isInAppBrowser) {
                setActiveTab('AUTO');
            }
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
    }, [isInAppBrowser]);

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

    const handleCopyLink = () => {
        navigator.clipboard.writeText(window.location.origin).then(() => {
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 3000);
        }).catch((err) => {
            console.error('Could not copy text: ', err);
        });
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
                    <div className="p-2 bg-blue-600 rounded-xl shadow-lg shadow-blue-500/30">
                        <Smartphone size={18} className="text-white animate-pulse" />
                    </div>
                    <div>
                        <h4 className="text-xs font-black tracking-wider text-blue-400 uppercase">MOBILE INSTALLATION</h4>
                        <h3 className="text-sm font-black text-white">ติดตั้งแอปพลิเคชัน {appName || "SchoolOS"}</h3>
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
            <div className="flex border-b border-slate-100 bg-slate-50 text-[10px] font-black uppercase tracking-wider">
                {isInAppBrowser && (
                    <button 
                        onClick={() => setActiveTab('IN_APP')}
                        className={`flex-1 py-3 text-center transition-all ${activeTab === 'IN_APP' ? 'text-red-600 border-b-2 border-red-500 bg-white' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        ⚠️ เบราว์เซอร์ในแอป
                    </button>
                )}
                <button 
                    onClick={() => setActiveTab('AUTO')}
                    className={`flex-1 py-3 text-center transition-all ${activeTab === 'AUTO' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    {deferredPrompt ? '📲 ติดตั้งทันที' : '🤖 แนะนำสำหรับ Android'}
                </button>
                <button 
                    onClick={() => setActiveTab('IOS')}
                    className={`flex-1 py-3 text-center transition-all ${activeTab === 'IOS' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-slate-400 hover:text-slate-600'}`}
                >
                    🍎 สำหรับ iPhone/iPad
                </button>
            </div>

            {/* Tab Contents */}
            <div className="p-5 max-h-[350px] overflow-y-auto">
                {activeTab === 'IN_APP' && (
                    <div className="space-y-4">
                        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl text-red-900 text-xs leading-relaxed space-y-2">
                            <div className="font-black text-red-800 flex items-center gap-2">
                                <AlertTriangle size={16} className="text-red-600 shrink-0" />
                                <span>พบการเปิดหน้าเว็บภายในแอปอื่น (In-App Browser)</span>
                            </div>
                            <p className="font-medium text-[11px]">
                                หน้าเว็บนี้เปิดขึ้นภายในเบราว์เซอร์ของแอปพลิเคชันอื่น (เช่น <b>LINE, Facebook, Messenger, หรือ Instagram</b>) ซึ่งเป็นระบบปิด <b>ไม่ยอมรับการสร้างไอคอนแอปพลิเคชันอย่างสมบูรณ์แบบ</b> ทำให้ไม่สามารถติดตั้งลงบนโทรศัพท์มือถือของคุณได้โดยตรง
                            </p>
                        </div>

                        <div className="space-y-3">
                            <h5 className="text-[11px] font-black text-slate-700 uppercase tracking-wider">วิธีการติดตั้งระบบจริง:</h5>
                            <div className="text-xs space-y-2.5 pl-1 text-slate-600 font-medium">
                                <div className="flex items-start gap-2">
                                    <span className="text-blue-600 font-black">1.</span>
                                    <span>กดปุ่ม <b>"คัดลอกลิงก์"</b> ด้านล่างนี้</span>
                                </div>
                                <div className="flex items-start gap-2">
                                    <span className="text-blue-600 font-black">2.</span>
                                    <span>ออกจากแอปนี้ แล้วเปิดแอปเบราว์เซอร์หลักของโทรศัพท์:
                                        <div className="mt-1 flex gap-2">
                                            <span className="px-2 py-0.5 bg-slate-100 text-slate-800 rounded-lg text-[10px] font-black inline-flex items-center gap-1"><Chrome size={10} className="text-blue-500" /> Google Chrome</span>
                                            <span className="px-2 py-0.5 bg-slate-100 text-slate-800 rounded-lg text-[10px] font-black inline-flex items-center gap-1">🌐 Safari</span>
                                        </div>
                                    </span>
                                </div>
                                <div className="flex items-start gap-2">
                                    <span className="text-blue-600 font-black">3.</span>
                                    <span>วางลิงก์ที่คัดลอก และกดเปิดใช้งาน จากนั้นแถบติดตั้งแอปจะขึ้นเพื่อให้คุณติดตั้งทันทีอย่างถูกต้อง!</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={handleCopyLink}
                                className={`flex-1 py-3 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-2 border-2 ${copySuccess ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-slate-900 hover:bg-slate-800 text-white border-slate-900'}`}
                            >
                                {copySuccess ? (
                                    <>
                                        <CheckCircle size={14} />
                                        คัดลอกเรียบร้อยแล้ว!
                                    </>
                                ) : (
                                    <>
                                        <Copy size={14} />
                                        คัดลอกลิงก์เพื่อไปเปิดในเบราว์เซอร์
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'AUTO' && (
                    <div className="space-y-4">
                        <div className="text-xs font-medium text-slate-600 leading-relaxed">
                            เปลี่ยนระบบเว็บไซต์ให้เป็น <span className="font-bold text-blue-600">แอปพลิเคชัน {appName || "SchoolOS"} แท้</span> บนโทรศัพท์มือถือของคุณ เพื่อการใช้งานแบบเต็มหน้าจอ รวดเร็ว ประหยัดเน็ต และปรากฏไอคอนแอปเดี่ยวบนหน้าจอโทรศัพท์เหมือนติดตั้งจาก Store!
                        </div>

                        {deferredPrompt ? (
                            <div className="space-y-3">
                                <div className="bg-blue-50/75 text-blue-900 p-3.5 rounded-2xl border border-blue-100 text-xs font-medium flex items-start gap-2.5">
                                    <CheckCircle size={16} className="text-blue-600 shrink-0 mt-0.5" />
                                    <span>อุปกรณ์ของคุณพร้อมรองรับ <b>"การติดตั้งแอปอัตโนมัติ"</b> ทันทีโดยไม่ต้องเปิดเมนูเบราว์เซอร์!</span>
                                </div>
                                <button
                                    onClick={handleInstallClick}
                                    className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg shadow-blue-500/20 hover:shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2"
                                >
                                    <Download size={15} />
                                    ติดตั้งแอปทันทีบนโทรศัพท์มือถือ
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="bg-amber-50/70 text-amber-900 p-4 rounded-2xl border border-amber-100 text-xs leading-relaxed space-y-2">
                                    <div className="font-black text-amber-800 flex items-center gap-1.5">
                                        <Info size={14} className="text-amber-600" />
                                        <span>คำแนะนำวิธีติดตั้งด่วนบน Android:</span>
                                    </div>
                                    <div className="font-medium space-y-1.5 pl-4 list-decimal block text-[11px] text-slate-700">
                                        <div>1. ตรวจสอบว่าเปิดเว็บนี้ในแอป <span className="font-bold text-slate-900">Google Chrome</span> หลักของเครื่องแล้ว (ไม่ใช่อยู่ในไลน์)</div>
                                        <div>2. สังเกตปุ่ม <span className="font-bold text-blue-600">จุดสามจุด (⁝)</span> ที่ขวาบน of Google Chrome</div>
                                        <div>3. กดเลือกเมนู <span className="font-bold text-blue-600">"ติดตั้งแอปพลิเคชัน" (Install App)</span> หรือ <span className="font-bold text-blue-600">"เพิ่มลงในหน้าจอหลัก" (Add to Home screen)</span></div>
                                        <div>4. กดปุ่มยืนยัน <span className="font-bold text-slate-900">"ติดตั้ง"</span> ระบบจะติดตั้งแอปพลิเคชันพร้อมแสดงไอคอน {appName || "SchoolOS"} บนหน้าจอทันที!</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'IOS' && (
                    <div className="space-y-4">
                        <div className="text-xs font-medium text-slate-600 leading-relaxed">
                            สำหรับ <span className="font-bold text-slate-900">Apple iPhone / iPad</span> เบราว์เซอร์ iOS บังคับให้ติดตั้งแอปผ่านการกดสั่งด้วยตนเองในเบราว์เซอร์ <span className="font-bold text-blue-600">Safari</span> ตามขั้นตอนที่ง่ายและปลอดภัยดังนี้:
                        </div>

                        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4.5 space-y-3.5 text-xs text-slate-700 font-medium">
                            <div className="flex items-start gap-3">
                                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-black text-[10px] shrink-0 mt-0.5 shadow-md shadow-blue-500/20">1</div>
                                <div>
                                    เปิดลิงก์หน้านี้ด้วยเว็บบนเบราว์เซอร์ <span className="font-black text-slate-950">Safari</span> (ไม่เปิดภายในแอปอื่น)
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-black text-[10px] shrink-0 mt-0.5 shadow-md shadow-blue-500/20">2</div>
                                <div className="space-y-1.5">
                                    <span>กดปุ่ม <span className="font-bold text-blue-600">"ปุ่มแชร์" (Share)</span> 📥 แถบด้านล่างสุดของหน้าจอซาฟารี</span>
                                    <div className="flex items-center gap-2 text-[10px] text-slate-500 bg-white px-2.5 py-1.5 rounded-xl border border-slate-100 max-w-max">
                                        <Share size={12} className="text-blue-500" />
                                        <span>ไอคอนรูปสี่เหลี่ยมที่มีลูกศรชี้ขึ้นตรงกลาง</span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-black text-[10px] shrink-0 mt-0.5 shadow-md shadow-blue-500/20">3</div>
                                <div className="space-y-1">
                                    <span>เลื่อนแถบเมนูขึ้นแล้วเลือกคำว่า <span className="font-bold text-blue-600 animate-pulse">"เพิ่มไปยังหน้าจอโฮม" (Add to Home Screen)</span> ➕</span>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-black text-[10px] shrink-0 mt-0.5 shadow-md shadow-blue-500/20">4</div>
                                <div>
                                    กดปุ่มคำว่า <span className="font-bold text-slate-900">"เพิ่ม" (Add)</span> ที่มุมขวาบน เพื่อนำแอป {appName || "SchoolOS"} ไปสร้างเป็นแอปเดี่ยวบนหน้าจอมือถือของคุณทันที
                                </div>
                            </div>
                        </div>

                        <div className="text-[10px] text-slate-400 font-bold text-center leading-relaxed">
                            * เมื่อเพิ่มสำเร็จ แอปจะกลายเป็นไอคอนแอป {appName || "SchoolOS"} แท้จริงที่เปิดทำงานแบบจอไร้ขอบ (Full Screen) เหมือนกับแอปโหลดจาก App Store!
                        </div>
                    </div>
                )}
            </div>

            {/* Footer Status */}
            <div className="bg-slate-50 px-5 py-3 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-bold">
                <span className="flex items-center gap-1">
                    <Star size={10} className="text-amber-500 fill-amber-500 animate-pulse" />
                    รองรับอุปกรณ์เคลื่อนที่ Android และ iOS อย่างเต็มระบบ
                </span>
                <span>Web App v5.1</span>
            </div>
        </div>
    );
};

export default PWAInstallPrompt;

