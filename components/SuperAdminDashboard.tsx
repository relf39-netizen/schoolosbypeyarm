import React, { useState, useEffect } from 'react';
import { School, Teacher, TeacherRole } from '../types';
import { 
    Building, Plus, LogOut, X, Trash2, 
    Loader2, ShieldCheck, Save, Shield, 
    Search, Users, Power, PowerOff, 
    ArrowLeft, Edit, Key, User as UserIcon, Eye, EyeOff,
    Clock, Check, ShieldPlus, UserMinus,
    Database, RefreshCw, Zap
} from 'lucide-react';
import { supabase, isConfigured as isSupabaseConfigured } from '../supabaseClient';

interface SuperAdminDashboardProps {
    schools: School[];
    teachers: Teacher[];
    onCreateSchool: (school: School) => Promise<void>;
    onUpdateSchool: (school: School) => Promise<void>;
    onDeleteSchool: (schoolId: string) => Promise<void>;
    onUpdateTeacher: (teacher: Teacher) => Promise<void>;
    onDeleteTeacher: (teacherId: string) => Promise<void>;
    onLogout: () => void;
    onEnterSchool: (schoolId: string) => void;
}

const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({ 
    schools, teachers, onCreateSchool, onUpdateSchool, onDeleteSchool, 
    onUpdateTeacher, onDeleteTeacher, onLogout, onEnterSchool
}) => {
    const [activeTab, setActiveTab] = useState<'SCHOOLS' | 'PENDING' | 'ACCOUNT' | 'DATABASE'>('SCHOOLS');
    const [showForm, setShowForm] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [formData, setFormData] = useState<Partial<School>>({ id: '', name: '' });
    const [isSavingSchool, setIsSavingSchool] = useState(false);
    const [schoolSearch, setSchoolSearch] = useState('');
    const [teacherSearch, setTeacherSearch] = useState('');
    
    // Account Management State
    const [superAdminData, setSuperAdminData] = useState({ username: '', password: '' });
    const [oldUsername, setOldUsername] = useState('');
    const [showAdminPassword, setShowAdminPassword] = useState(false);
    const [isSavingAccount, setIsSavingAccount] = useState(false);

    // School detail view
    const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null);
    const [isUpdatingTeacher, setIsUpdatingTeacher] = useState<string | null>(null);

    useEffect(() => {
        const fetchSuperAdmin = async () => {
            const client = supabase;
            if (isSupabaseConfigured && client) {
                const { data } = await client.from('super_admins').select('*').limit(1).maybeSingle();
                if (data) {
                    setSuperAdminData({ username: data.username, password: data.password });
                    setOldUsername(data.username);
                }
            }
        };
        fetchSuperAdmin();
    }, []);

    const filteredSchools = schools.filter(s => 
        s.name.toLowerCase().includes(schoolSearch.toLowerCase()) || 
        s.id.includes(schoolSearch)
    );

    // Filter only those who are not approved yet
    const pendingGlobalUsers = teachers.filter(t => t.isApproved === false);
    
    const currentSchoolObj = schools.find(s => s.id === selectedSchoolId);
    const schoolStaff = teachers.filter(t => t.schoolId === selectedSchoolId)
        .filter(t => t.name.toLowerCase().includes(teacherSearch.toLowerCase()) || t.id.includes(teacherSearch));

    const handleSchoolSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.id || !formData.name) return;
        setIsSavingSchool(true);
        try {
            if (isEditMode) await onUpdateSchool(formData as School);
            else await onCreateSchool(formData as School);
            setShowForm(false);
            setFormData({ id: '', name: '' });
        } catch (error) {
            alert("บันทึกไม่สำเร็จ");
        } finally {
            setIsSavingSchool(false);
        }
    };

    const handleAccountUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        const client = supabase;
        if (!isSupabaseConfigured || !client) return;
        if (!confirm("ยืนยันการเปลี่ยนข้อมูลเข้าสู่ระบบ Super Admin?")) return;
        setIsSavingAccount(true);
        try {
            if (superAdminData.username !== oldUsername) {
                await client.from('super_admins').delete().eq('username', oldUsername);
            }
            const { error } = await client.from('super_admins').upsert({
                username: superAdminData.username,
                password: superAdminData.password
            });
            if (!error) {
                alert("อัปเดตบัญชีสำเร็จ");
                setOldUsername(superAdminData.username);
            }
        } finally {
            setIsSavingAccount(false);
        }
    };

    const handleApproveAsAdmin = async (teacher: Teacher) => {
        if (!isSupabaseConfigured || !supabase) return;
        if (!confirm(`ยืนยันการอนุมัติและแต่งตั้งคุณ "${teacher.name}" เป็นผู้ดูแลระบบ (Admin) ของโรงเรียนนี้?`)) return;

        setIsUpdatingTeacher(teacher.id);
        // Ensure SYSTEM_ADMIN is included in roles
        const newRoles: TeacherRole[] = Array.from(new Set([...teacher.roles, 'SYSTEM_ADMIN']));
        
        try {
            const { error } = await supabase.from('profiles').update({ 
                is_approved: true,
                roles: newRoles 
            }).eq('id', teacher.id);

            if (!error) {
                await onUpdateTeacher({ ...teacher, isApproved: true, roles: newRoles });
                alert("อนุมัติและแต่งตั้ง Admin สำเร็จ บัญชีพร้อมใช้งานแล้ว");
            } else throw error;
        } catch (err: any) {
            alert("ขัดข้อง: " + err.message);
        } finally {
            setIsUpdatingTeacher(null);
        }
    };

    const handleToggleTeacherAdmin = async (teacher: Teacher) => {
        if (!isSupabaseConfigured || !supabase) return;
        const hasAdmin = teacher.roles.includes('SYSTEM_ADMIN');
        let newRoles: TeacherRole[] = hasAdmin 
            ? teacher.roles.filter(r => r !== 'SYSTEM_ADMIN') 
            : [...teacher.roles, 'SYSTEM_ADMIN'];
        
        if (!confirm(`ยืนยันการ${hasAdmin ? 'ถอนสิทธิ์' : 'แต่งตั้ง'}แอดมิน: ${teacher.name}?`)) return;

        setIsUpdatingTeacher(teacher.id);
        const { error } = await supabase.from('profiles').update({ roles: newRoles }).eq('id', teacher.id);
        if (!error) await onUpdateTeacher({ ...teacher, roles: newRoles });
        setIsUpdatingTeacher(null);
    };

    const handleToggleSchoolSuspension = async (school: School) => {
        if (!isSupabaseConfigured || !supabase) return;
        const newStatus = !school.isSuspended;
        if (!confirm(`ยืนยันการ${newStatus ? 'ระงับ' : 'เปิด'}การใช้งานโรงเรียน: ${school.name}?`)) return;
        const { error } = await supabase.from('schools').update({ is_suspended: newStatus }).eq('id', school.id);
        if (!error) await onUpdateSchool({ ...school, isSuspended: newStatus });
    };

    return (
        <div className="min-h-screen bg-slate-50 font-sarabun text-slate-900">
            <header className="bg-slate-900 text-white p-4 shadow-lg sticky top-0 z-30">
                <div className="max-w-7xl mx-auto w-full flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center font-black text-xl">S</div>
                        <div>
                            <h1 className="text-lg font-bold leading-none">Super Admin</h1>
                            <span className="text-[9px] text-blue-400 font-bold uppercase tracking-widest">Platform Core Dashboard</span>
                        </div>
                    </div>
                    <div className="hidden md:flex bg-slate-800 p-1 rounded-xl">
                        <button onClick={() => { setActiveTab('SCHOOLS'); setSelectedSchoolId(null); }} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'SCHOOLS' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>จัดการโรงเรียน</button>
                        <button onClick={() => { setActiveTab('PENDING'); setSelectedSchoolId(null); }} className={`relative px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'PENDING' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>
                            คำขอแอดมินใหม่
                            {pendingGlobalUsers.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full animate-pulse">{pendingGlobalUsers.length}</span>}
                        </button>
                        <button onClick={() => { setActiveTab('ACCOUNT'); setSelectedSchoolId(null); }} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'ACCOUNT' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>ตั้งค่าบัญชี</button>
                        <button onClick={() => { setActiveTab('DATABASE'); setSelectedSchoolId(null); }} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'DATABASE' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>จัดการฐานข้อมูล</button>
                    </div>
                    <button onClick={onLogout} className="p-2 text-slate-400 hover:text-red-400 transition-colors flex items-center gap-2 font-bold">
                        <span className="text-xs">LOGOUT</span>
                        <LogOut size={20}/>
                    </button>
                </div>
            </header>

            <div className="max-w-7xl mx-auto p-6">
                {activeTab === 'SCHOOLS' && !selectedSchoolId && (
                    <div className="animate-fade-in space-y-6">
                        <div className="flex flex-col md:flex-row justify-between gap-4 bg-white p-4 rounded-2xl border shadow-sm items-center">
                            <div className="flex-1 w-full md:max-w-sm relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18}/>
                                <input type="text" placeholder="ค้นหาโรงเรียน..." value={schoolSearch} onChange={e => setSchoolSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 bg-slate-50 border rounded-xl outline-none focus:ring-2 ring-blue-500/10 font-bold text-sm" />
                            </div>
                            <button onClick={() => { setFormData({id:'', name:''}); setIsEditMode(false); setShowForm(true); }} className="bg-blue-600 text-white px-6 py-2 rounded-xl shadow-md hover:bg-blue-700 font-bold flex items-center justify-center gap-2 transition-all active:scale-95 text-xs">
                                <Plus size={16}/> เพิ่มโรงเรียนใหม่
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {filteredSchools.map(s => (
                                <div key={s.id} className={`bg-white rounded-[2rem] border-2 transition-all overflow-hidden flex flex-col ${s.isSuspended ? 'border-red-100 bg-red-50/10 grayscale' : 'border-slate-100 hover:border-blue-200 shadow-sm'}`}>
                                    <div className="p-6 flex-1">
                                        <div className="flex justify-between items-start mb-6">
                                            <div className={`p-4 rounded-2xl ${s.isSuspended ? 'bg-red-100 text-red-600' : 'bg-blue-50 text-blue-600'}`}><Building size={28}/></div>
                                            <span className="text-[10px] font-black font-mono bg-slate-100 p-1.5 rounded px-2 text-slate-500">{s.id}</span>
                                        </div>
                                        <h3 className="font-bold text-lg text-slate-800 truncate mb-1">{s.name}</h3>
                                        <p className="text-xs text-slate-400 font-bold flex items-center gap-1"><Users size={12}/> {teachers.filter(t => t.schoolId === s.id).length} บุคลากร</p>
                                    </div>
                                    <div className="bg-slate-50 p-4 border-t flex justify-between items-center">
                                        <div className="flex gap-2">
                                            <button onClick={() => setSelectedSchoolId(s.id)} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black shadow-md hover:bg-blue-700 transition-all">ดูบุคลากร</button>
                                            <button onClick={() => onEnterSchool(s.id)} className="px-4 py-1.5 bg-rose-600 text-white rounded-lg text-[10px] font-black shadow-md hover:bg-rose-700 transition-all flex items-center gap-1">
                                                <Shield size={10}/> จัดการระบบ
                                            </button>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => { setFormData(s); setIsEditMode(true); setShowForm(true); }} className="p-2 bg-white border rounded-xl text-slate-500 hover:text-blue-600 transition-all"><Edit size={16}/></button>
                                            <button onClick={() => handleToggleSchoolSuspension(s)} className={`p-2 border rounded-xl transition-all ${s.isSuspended ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-500 hover:text-red-600'}`}>{s.isSuspended ? <Power size={16}/> : <PowerOff size={16}/>}</button>
                                            <button onClick={() => { if(confirm("ลบโรงเรียนนี้ถาวร?")) onDeleteSchool(s.id); }} className="p-2 bg-white border rounded-xl text-slate-300 hover:text-red-600 transition-all"><Trash2 size={16}/></button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'PENDING' && (
                    <div className="animate-fade-in space-y-6">
                        <div className="bg-white rounded-[2rem] shadow-xl border border-slate-200 overflow-hidden">
                            <div className="bg-amber-500 p-8 text-white">
                                <h2 className="text-2xl font-black mb-1 flex items-center gap-3"><ShieldCheck size={28}/> คำขออนุมัติแอดมินใหม่</h2>
                                <p className="text-amber-50 text-xs opacity-90 font-bold">อนุมัติผู้สมัครและแต่งตั้งเป็นผู้ดูแลระบบ (SYSTEM_ADMIN) ของโรงเรียนเพื่อให้บัญชีใช้งานได้ทันที</p>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50 text-slate-400 font-black text-[10px] uppercase tracking-widest border-b">
                                        <tr><th className="p-6">ชื่อ-นามสกุล</th><th className="p-6">โรงเรียน</th><th className="p-6 text-right">ดำเนินการ</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {pendingGlobalUsers.length === 0 ? (<tr><td colSpan={3} className="p-20 text-center text-slate-300 font-bold italic">ไม่มีรายการค้างอนุมัติ</td></tr>) : pendingGlobalUsers.map(t => (
                                            <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                                                <td className="p-6"><div className="font-bold text-slate-700">{t.name}</div><div className="text-[10px] font-mono text-slate-400">ID: {t.id}</div></td>
                                                <td className="p-6"><div className="font-bold text-slate-800 text-sm">{schools.find(s => s.id === t.schoolId)?.name || 'ไม่พบโรงเรียน'}</div><div className="text-[10px] text-slate-400 font-black">Code: {t.schoolId}</div></td>
                                                <td className="p-6 text-right">
                                                    <button onClick={() => handleApproveAsAdmin(t)} disabled={isUpdatingTeacher === t.id} className="px-6 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black shadow-lg hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 ml-auto">
                                                        {isUpdatingTeacher === t.id ? <Loader2 className="animate-spin" size={14}/> : <Check size={14}/>} อนุมัติเป็นแอดมินโรงเรียน
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'DATABASE' && (
                    <div className="animate-fade-in space-y-8 max-w-4xl mx-auto">
                        <div className="bg-white rounded-[2rem] shadow-xl border border-slate-200 p-8">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg">
                                    <ShieldPlus size={24}/>
                                </div>
                                <div>
                                    <h2 className="text-xl font-black text-slate-800">ปรับปรุงโครงสร้างฐานข้อมูล (Database Improvement)</h2>
                                    <p className="text-xs text-slate-400 font-bold">ตรวจสอบและเพิ่มตารางหรือคอลัมน์ที่ขาดหายไปในระบบ MySQL</p>
                                </div>
                            </div>
                            
                            <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100 mb-8">
                                <h4 className="text-indigo-900 font-black text-sm mb-2 flex items-center gap-2">
                                    <Clock size={16}/> รายละเอียดการปรับปรุง
                                </h4>
                                <ul className="text-xs text-indigo-700 space-y-1 font-bold list-disc ml-4">
                                    <li>ตรวจสอบตารางพื้นฐานทั้งหมด (Schools, Profiles, Students, etc.)</li>
                                    <li>เพิ่มคอลัมน์ใหม่ที่จำเป็นสำหรับการทำงาน (เช่น ข้อมูลสุขภาพนักเรียน, ระบบระงับการใช้งาน)</li>
                                    <li>ไม่ส่งผลกระทบต่อข้อมูลเดิมที่มีอยู่ในตาราง</li>
                                    <li>ควรทำทุกครั้งที่มีการอัปเดตเวอร์ชันของระบบ</li>
                                </ul>
                            </div>

                            <button 
                                onClick={async () => {
                                    if(!confirm("ยืนยันการปรับปรุงโครงสร้างฐานข้อมูล? ระบบจะตรวจสอบและเพิ่มส่วนที่ขาดหายไปโดยอัตโนมัติ")) return;
                                    try {
                                        const res = await fetch('/api/init-db', { method: 'POST' });
                                        const data = await res.json();
                                        if(data.success) alert("ปรับปรุงฐานข้อมูลสำเร็จ: " + data.message);
                                        else alert("เกิดข้อผิดพลาด: " + data.error);
                                    } catch(e) {
                                        alert("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
                                    }
                                }}
                                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-sm shadow-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
                            >
                                <ShieldPlus size={20}/> เริ่มการปรับปรุงฐานข้อมูล (Run Database Update)
                            </button>
                        </div>

                        <MigrationTool />
                    </div>
                )}

                {activeTab === 'ACCOUNT' && (
                    <div className="animate-fade-in max-w-md mx-auto">
                        <div className="bg-white rounded-[2rem] shadow-xl border border-slate-200 p-8 space-y-8">
                            <div className="text-center">
                                <div className="w-16 h-16 bg-slate-900 text-white rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-xl"><Shield size={32}/></div>
                                <h2 className="text-xl font-black">บัญชี Super Admin</h2>
                                <p className="text-xs text-slate-400 font-bold">แก้ไขข้อมูลการเข้าถึงระบบส่วนกลาง</p>
                            </div>
                            <form onSubmit={handleAccountUpdate} className="space-y-6">
                                <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Username</label><div className="relative"><UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18}/><input type="text" required value={superAdminData.username} onChange={e => setSuperAdminData({...superAdminData, username: e.target.value})} className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border rounded-xl outline-none focus:ring-2 ring-blue-500 font-bold transition-all text-sm"/></div></div>
                                <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Password</label><div className="relative"><Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18}/><input type={showAdminPassword ? "text" : "password"} required value={superAdminData.password} onChange={e => setSuperAdminData({...superAdminData, password: e.target.value})} className="w-full pl-11 pr-11 py-2.5 bg-slate-50 border rounded-xl outline-none focus:ring-2 ring-blue-500 font-bold transition-all text-sm"/><button type="button" onClick={() => setShowAdminPassword(!showAdminPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">{showAdminPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></div>
                                <button type="submit" disabled={isSavingAccount} className="w-full py-3 bg-slate-900 text-white rounded-xl font-black text-sm shadow-xl hover:bg-black transition-all flex items-center justify-center gap-3">
                                    {isSavingAccount ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>} บันทึกข้อมูลบัญชี
                                </button>
                            </form>

                            <div className="pt-6 border-t border-slate-100">
                                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 text-center">System Information</h3>
                                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[10px] font-black text-slate-400 uppercase">Platform Version</span>
                                        <span className="text-xs font-black text-slate-600">v1.2.0-stable</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-[10px] font-black text-slate-400 uppercase">Database Engine</span>
                                        <span className="text-xs font-black text-blue-600">MySQL 8.0</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {selectedSchoolId && (
                    <div className="animate-slide-up space-y-6">
                        <button onClick={() => setSelectedSchoolId(null)} className="flex items-center gap-2 text-slate-500 font-black hover:text-blue-600 transition-colors text-xs uppercase"><ArrowLeft size={16}/> กลับไปหน้าโรงเรียน</button>
                        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
                            <div className="p-6 bg-slate-50 border-b flex justify-between items-center"><h3 className="text-lg font-black text-slate-800 flex items-center gap-3"><Users className="text-blue-600"/> รายชื่อบุคลากร: {currentSchoolObj?.name}</h3></div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-50 text-slate-400 font-black text-[10px] uppercase tracking-widest border-b">
                                        <tr><th className="p-6">บุคลากร</th><th className="p-6">ตำแหน่ง</th><th className="p-6 text-center">สถานภาพ</th><th className="p-6 text-right">สิทธิ์ผู้ดูแล</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {schoolStaff.length === 0 ? (<tr><td colSpan={4} className="p-20 text-center text-slate-400 font-bold italic">ไม่พบรายชื่อบุคลากร</td></tr>) : schoolStaff.map(t => (
                                            <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                                                <td className="p-4 px-6"><div className="font-bold text-slate-700">{t.name}</div><div className="text-[10px] font-mono text-slate-400">ID: {t.id}</div></td>
                                                <td className="p-4 px-6 font-bold text-slate-500">{t.position}</td>
                                                <td className="p-4 px-6 text-center"><div className={`inline-flex px-3 py-1 rounded-full text-[10px] font-black uppercase ${t.isSuspended ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>{t.isSuspended ? 'ระงับการใช้งาน' : 'ปกติ'}</div></td>
                                                <td className="p-4 px-6 text-right">
                                                    <button onClick={() => handleToggleTeacherAdmin(t)} className={`px-4 py-1.5 rounded-lg transition-all border-2 flex items-center gap-2 text-[10px] font-black uppercase ml-auto ${t.roles.includes('SYSTEM_ADMIN') ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-700 border-indigo-100 hover:bg-indigo-50'}`}>
                                                        {isUpdatingTeacher === t.id ? <Loader2 className="animate-spin" size={12}/> : (t.roles.includes('SYSTEM_ADMIN') ? <UserMinus size={12}/> : <ShieldPlus size={12}/>)}
                                                        {t.roles.includes('SYSTEM_ADMIN') ? 'ถอนสิทธิ์แอดมิน' : 'ตั้งเป็นแอดมิน'}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {showForm && (
                <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center p-4 backdrop-blur-md">
                    <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm p-8 animate-scale-up">
                        <h3 className="text-xl font-black text-slate-800 mb-6 border-b pb-3">{isEditMode ? 'แก้ไขข้อมูลโรงเรียน' : 'เพิ่มโรงเรียนใหม่'}</h3>
                        <form onSubmit={handleSchoolSubmit} className="space-y-5">
                            <div><label className="block text-[10px] font-black text-slate-400 mb-1.5 uppercase tracking-widest ml-1">รหัสโรงเรียน 8 หลัก</label><input type="text" disabled={isEditMode} value={formData.id} onChange={e => setFormData({...formData, id: e.target.value})} className="w-full px-4 py-2.5 bg-slate-50 border rounded-xl outline-none focus:ring-2 ring-blue-500 font-black text-xl disabled:opacity-50 text-center tracking-widest" required /></div>
                            <div><label className="block text-[10px] font-black text-slate-400 mb-1.5 uppercase tracking-widest ml-1">ชื่อโรงเรียน</label><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2.5 bg-slate-50 border rounded-xl outline-none focus:ring-2 ring-blue-500 font-bold" required /></div>
                            <div className="flex gap-3 pt-4"><button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2.5 bg-slate-100 text-slate-500 rounded-xl font-black text-xs uppercase">ยกเลิก</button><button type="submit" disabled={isSavingSchool} className="flex-2 py-2.5 bg-blue-600 text-white rounded-xl font-black shadow-lg hover:bg-blue-700 transition-all active:scale-95 text-xs">{isSavingSchool ? <Loader2 className="animate-spin mx-auto" size={16}/> : 'บันทึกข้อมูล'}</button></div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

const MigrationTool: React.FC = () => {
    const [url, setUrl] = useState('');
    const [key, setKey] = useState('');
    const [isMigrating, setIsMigrating] = useState(false);
    const [results, setResults] = useState<any[] | null>(null);

    const tables = [
        'schools', 'profiles', 'school_configs', 'class_rooms', 'students', 
        'student_savings', 'academic_years', 'attendance', 'leave_requests', 
        'plan_projects', 'budget_settings', 'academic_enrollments', 
        'academic_test_scores', 'academic_calendar', 'academic_sar', 'director_events',
        'documents', 'student_attendance', 'student_health_records'
    ];

    const handleMigrate = async () => {
        if (!url || !key) return alert("กรุณากรอก Supabase URL และ Key");
        if (!confirm("ยืนยันการย้ายข้อมูล? ข้อมูลที่มีอยู่เดิมใน MySQL อาจถูกเขียนทับหากมี ID ซ้ำกัน")) return;

        setIsMigrating(true);
        setResults(null);

        try {
            const res = await fetch('/api/migrate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ supabaseUrl: url, supabaseKey: key, tables })
            });
            const data = await res.json();
            if (data.success) {
                setResults(data.results);
                alert("ย้ายข้อมูลสำเร็จ!");
            } else {
                alert("เกิดข้อผิดพลาด: " + data.error);
            }
        } catch (e) {
            alert("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
        } finally {
            setIsMigrating(false);
        }
    };

    return (
        <div className="space-y-8">
            <div className="bg-white rounded-[2rem] shadow-xl border border-slate-200 p-8 space-y-8">
                <div className="text-center">
                    <div className="w-16 h-16 bg-indigo-600 text-white rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-xl"><Database size={32}/></div>
                    <h2 className="text-xl font-black">Database Improvement</h2>
                    <p className="text-xs text-slate-400 font-bold">ปรับปรุงโครงสร้างฐานข้อมูลให้รองรับข้อมูล DMC</p>
                </div>

                <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100 space-y-3">
                    <h4 className="text-xs font-black text-indigo-700 uppercase tracking-widest flex items-center gap-2">
                        <RefreshCw size={14}/> รายละเอียดการปรับปรุง
                    </h4>
                    <p className="text-[11px] text-indigo-600 font-bold leading-relaxed">
                        ระบบจะทำการตรวจสอบตารางและคอลัมน์ในฐานข้อมูล MySQL หากพบว่ามีตารางหรือคอลัมน์ใดที่จำเป็นสำหรับการนำเข้าข้อมูล DMC ขาดหายไป ระบบจะทำการเพิ่มให้โดยอัตโนมัติ โดยไม่กระทบต่อข้อมูลเดิมที่มีอยู่
                    </p>
                    <ul className="text-[10px] text-indigo-500 space-y-1 list-disc ml-4 font-bold">
                        <li>เพิ่มคอลัมน์ในตาราง students (เลขประจำตัว, เลขบัตรประชาชน, ข้อมูลสุขภาพ ฯลฯ)</li>
                        <li>ตรวจสอบและสร้างตารางพื้นฐานที่จำเป็น</li>
                        <li>ปรับปรุงโครงสร้างให้ตรงกับมาตรฐาน DMC ล่าสุด</li>
                    </ul>
                </div>

                <button 
                    onClick={async () => {
                        if(!confirm("ยืนยันการปรับปรุงโครงสร้างฐานข้อมูล?")) return;
                        try {
                            const res = await fetch('/api/init-db', { method: 'POST' });
                            const data = await res.json();
                            if(data.success) {
                                alert(data.message);
                            } else {
                                alert("เกิดข้อผิดพลาด: " + data.error);
                            }
                        } catch (e) {
                            alert("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
                        }
                    }}
                    className="w-full py-4 bg-indigo-600 text-white rounded-xl font-black text-sm shadow-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 active:scale-95"
                >
                    <Zap size={20}/> เริ่มกระบวนการปรับปรุงฐานข้อมูล
                </button>
            </div>

            <div className="bg-white rounded-[2rem] shadow-xl border border-slate-200 p-8 space-y-8">
                <div className="text-center">
                    <div className="w-16 h-16 bg-blue-600 text-white rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-xl"><Power size={32}/></div>
                    <h2 className="text-xl font-black">Supabase Data Migration</h2>
                    <p className="text-xs text-slate-400 font-bold">ย้ายข้อมูลจาก Supabase เดิม มายัง MySQL ใหม่</p>
                </div>

            <div className="space-y-4">
                <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Supabase Project URL</label>
                    <input type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://xyz.supabase.co" className="w-full px-4 py-2.5 bg-slate-50 border rounded-xl outline-none focus:ring-2 ring-blue-500 font-bold text-sm"/>
                </div>
                <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Supabase Service Role Key (Secret)</label>
                    <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="eyJhbG..." className="w-full px-4 py-2.5 bg-slate-50 border rounded-xl outline-none focus:ring-2 ring-blue-500 font-bold text-sm"/>
                </div>
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                    <p className="text-[10px] text-blue-700 font-bold leading-relaxed">
                        * ระบบจะดึงข้อมูลจากตารางทั้งหมด ({tables.length} ตาราง) และนำมาใส่ใน MySQL โดยใช้คำสั่ง ON DUPLICATE KEY UPDATE เพื่อป้องกันข้อมูลซ้ำ
                    </p>
                </div>
                <button 
                    onClick={handleMigrate} 
                    disabled={isMigrating}
                    className="w-full py-4 bg-blue-600 text-white rounded-xl font-black text-sm shadow-xl hover:bg-blue-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                >
                    {isMigrating ? <Loader2 className="animate-spin" size={20}/> : <Power size={20}/>} เริ่มกระบวนการย้ายข้อมูล
                </button>
            </div>

            {results && (
                <div className="mt-8 space-y-4">
                    <h3 className="text-sm font-black text-slate-800 border-b pb-2">สรุปผลการย้ายข้อมูล</h3>
                    <div className="max-h-60 overflow-y-auto space-y-2">
                        {results.map((res, i) => (
                            <div key={i} className={`p-3 rounded-xl text-xs flex justify-between items-center ${res.status === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                <span className="font-bold">{res.table}</span>
                                <span>
                                    {res.status === 'success' ? `สำเร็จ: ${res.successCount} | พลาด: ${res.failCount}` : res.message}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    </div>
);
};

export default SuperAdminDashboard;
