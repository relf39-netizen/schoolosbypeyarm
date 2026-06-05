import React, { useState, useEffect, useMemo } from 'react';
import { 
    Calendar, CheckCircle2, XCircle, Clock, AlertCircle, 
    Users, Search, Filter, Download, 
    Printer, Save, ArrowLeft, Plus, Trash2, Loader, BarChart3, FileText, Upload
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { PDFDocument } from 'pdf-lib';
import { supabase } from '../supabaseClient';
import { Teacher } from '../types';
import { getDirectDriveUrl } from '../utils/drive';
import { motion, AnimatePresence } from 'framer-motion';

const THAI_MONTHS = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

const formatToISODate = (date: Date) => {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
};

const formatToThaiDate = (dateString: string) => {
    if (!dateString) return '';
    const cleanDateStr = dateString.split('T')[0];
    const parts = cleanDateStr.split('-');
    if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const date = new Date(year, month, day, 12, 0, 0);
        return date.toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
    const date = new Date(dateString);
    return date.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Bangkok'
    });
};

interface TeacherDutySystemProps {
    currentUser: Teacher;
    schoolConfig: any;
    directorName: string;
    onBack: () => void;
}

export const TeacherDutySystem: React.FC<TeacherDutySystemProps> = ({ 
    currentUser, 
    schoolConfig, 
    directorName,
    onBack 
}) => {
    const [dutyReports, setDutyReports] = useState<any[]>([]);
    const [dutyViewType, setDutyViewType] = useState<'ROW' | 'CARD'>('ROW');
    const [dutyPage, setDutyPage] = useState<number>(1);
    const [dutySearchQuery, setDutySearchQuery] = useState<string>('');
    const [dutyMonthFilter, setDutyMonthFilter] = useState<string>('ALL');
    const [selectedDutyReport, setSelectedDutyReport] = useState<any | null>(null);
    const [activeDutyTab, setActiveDutyTab] = useState<'LIST' | 'FORM'>('LIST');
    const [dutyDate, setDutyDate] = useState<string>(formatToISODate(new Date()));
    const [morningReport, setMorningReport] = useState<string>('');
    const [afternoonReport, setAfternoonReport] = useState<string>('');
    const [pic1Url, setPic1Url] = useState<string>('');
    const [pic1Desc, setPic1Desc] = useState<string>('ครูเวรประจำวันตรวจความเรียบร้อยบริเวณประตูทางเข้าโรงเรียนในช่วงเช้าก่อนเข้าเรียน');
    const [pic2Url, setPic2Url] = useState<string>('');
    const [pic2Desc, setPic2Desc] = useState<string>('กิจกรรมการเคารพธงชาติและอบรมความมีระเบียบวินัยนักเรียนบริเวณหน้าเสาธง');
    const [pic3Url, setPic3Url] = useState<string>('');
    const [pic3Desc, setPic3Desc] = useState<string>('ดูแลความเรียบร้อยและสุขอนามัยของนักเรียนระหว่างการรับประทานอาหารกลางวัน');
    const [pic4Url, setPic4Url] = useState<string>('');
    const [pic4Desc, setPic4Desc] = useState<string>('ครูเวรประจำวันส่งนักเรียนและอำนวยความสะดวกการจราจรขณะเดินทางกลับบ้านอย่างปลอดภัย');
    
    // Process flags
    const [isSavingDuty, setIsSavingDuty] = useState<boolean>(false);
    const [loadingDutyList, setLoadingDutyList] = useState<boolean>(false);
    const [uploadingPicIndex, setUploadingPicIndex] = useState<number | null>(null);
    const [activeDutyStats, setActiveDutyStats] = useState<any>({ total: 0, present: 0, late: 0, sick: 0, absent: 0 });

    const rolesList = Array.isArray(currentUser.roles) ? currentUser.roles : [];
    const isAdmin = rolesList.includes('SYSTEM_ADMIN') || rolesList.includes('ADMIN') || rolesList.includes('DIRECTOR') || rolesList.includes('VICE_DIRECTOR') || currentUser.isActingDirector;
    const isDirector = rolesList.includes('DIRECTOR') || rolesList.includes('VICE_DIRECTOR') || currentUser.isActingDirector;

    useEffect(() => {
        fetchDutyReports();
    }, [currentUser.schoolId]);

    const fetchFullSchoolStatsForDate = async (targetDate: string) => {
        if (!supabase) return { total: 0, present: 0, late: 0, sick: 0, absent: 0, classDetails: [] };
        try {
            const { data: allStuds, error: studsErr } = await supabase
                .from('students')
                .select('id, current_class')
                .eq('school_id', currentUser.schoolId)
                .eq('is_active', true)
                .eq('is_alumni', false);
            
            if (studsErr) throw studsErr;
            const totalCount = allStuds ? allStuds.length : 0;

            const { data: allAtt, error: attErr } = await supabase
                .from('student_attendance')
                .select('student_id, status')
                .eq('school_id', currentUser.schoolId)
                .eq('date', targetDate);

            if (attErr) throw attErr;

            const attendedMap = new Map<string, string>();
            if (allAtt) {
                allAtt.forEach((a: any) => {
                    attendedMap.set(a.student_id, a.status);
                });
            }

            let present = 0;
            let late = 0;
            let sick = 0;
            let absent = 0;

            const classStatsMap: Record<string, { total: number, present: number, late: number, sick: number, absent: number }> = {};

            if (allStuds) {
                allStuds.forEach((s: any) => {
                    const cName = s.current_class || 'ไม่ระบุชั้น';
                    if (!classStatsMap[cName]) {
                        classStatsMap[cName] = { total: 0, present: 0, late: 0, sick: 0, absent: 0 };
                    }
                    classStatsMap[cName].total++;

                    const status = attendedMap.get(s.id);
                    if (status === 'Present') {
                        present++;
                        classStatsMap[cName].present++;
                    } else if (status === 'Late') {
                        late++;
                        classStatsMap[cName].late++;
                    } else if (status === 'Sick') {
                        sick++;
                        classStatsMap[cName].sick++;
                    } else if (status === 'Absent') {
                        absent++;
                        classStatsMap[cName].absent++;
                    } else {
                        absent++;
                        classStatsMap[cName].absent++;
                    }
                });
            }

            const classDetailsList = Object.entries(classStatsMap).map(([className, st]) => ({
                className,
                total: st.total,
                present: st.present,
                late: st.late,
                sick: st.sick,
                absent: st.absent,
                rate: st.total > 0 ? ((st.present / st.total) * 100).toFixed(2) : '0.00'
            })).sort((a, b) => a.className.localeCompare(b.className, 'th'));

            return {
                total: totalCount,
                present,
                late,
                sick,
                absent,
                classDetails: classDetailsList
            };
        } catch (e) {
            console.error("Error fetching full school stats:", e);
            return { total: 0, present: 0, late: 0, sick: 0, absent: 0, classDetails: [] };
        }
    };

    const fetchDutyReports = async () => {
        if (!supabase) return;
        setLoadingDutyList(true);
        try {
            const { data, error } = await supabase
                .from('teacher_duty_reports')
                .select('*')
                .eq('school_id', currentUser.schoolId)
                .order('date', { ascending: false });
            if (error) throw error;
            if (data) {
                const mapped = data.map((d: any) => ({
                    id: d.id,
                    schoolId: d.school_id,
                    date: typeof d.date === 'string' ? d.date.split('T')[0] : d.date,
                    teacherId: d.teacher_id,
                    teacherName: d.teacher_name,
                    morningReport: d.morning_report || '',
                    afternoonReport: d.afternoon_report || '',
                    pic1Url: d.pic1_url || '',
                    pic1Desc: d.pic1_desc || '',
                    pic2Url: d.pic2_url || '',
                    pic2Desc: d.pic2_desc || '',
                    pic3Url: d.pic3_url || '',
                    pic3Desc: d.pic3_desc || '',
                    pic4Url: d.pic4_url || '',
                    pic4Desc: d.pic4_desc || '',
                    pdfUrl: d.pdf_url || '',
                    createdAt: d.created_at
                }));
                setDutyReports(mapped);
            }
        } catch (e) {
            console.error("Error fetching duty reports:", e);
        } finally {
            setLoadingDutyList(false);
        }
    };

    const getDutyReportNumberText = (dateString: string, id?: string) => {
        if (!dateString) return '';
        const targetYear = new Date(dateString).getFullYear();
        const thaiYear = targetYear + 543;
        
        const yearReports = dutyReports
            .filter(r => {
                const rYear = new Date(r.date).getFullYear();
                return rYear === targetYear;
            })
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        let seqNo = 1;
        if (id) {
            const index = yearReports.findIndex(r => r.id === id);
            if (index !== -1) {
                seqNo = index + 1;
            }
        } else {
            const index = yearReports.findIndex(r => r.date === dateString);
            if (index !== -1) {
                seqNo = index + 1;
            } else {
                seqNo = yearReports.length + 1;
            }
        }
        
        return `${seqNo}/${thaiYear}`;
    };

    const deleteDutyReport = async (reportId: string) => {
        if (!supabase) return;
        if (!window.confirm('คุณต้องการลบรายงานตัวนี้ใช่หรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้')) return;
        try {
            const { error } = await supabase
                .from('teacher_duty_reports')
                .delete()
                .eq('id', reportId);
            if (error) throw error;
            alert('ลบรายงานเวรประจำวันเรียบร้อยแล้ว!');
            fetchDutyReports();
            if (selectedDutyReport?.id === reportId) {
                setSelectedDutyReport(null);
            }
        } catch (e: any) {
            alert('เกิดข้อผิดพลาดในการลบรายงานเวร: ' + e.message);
        }
    };

    const handleDutyDateChange = async (dateString: string) => {
        setDutyDate(dateString);
        
        // Load stats
        const stats = await fetchFullSchoolStatsForDate(dateString);
        setActiveDutyStats(stats);

        // Load existing
        if (!supabase) return;
        try {
            const { data, error } = await supabase
                .from('teacher_duty_reports')
                .select('*')
                .eq('school_id', currentUser.schoolId)
                .eq('date', dateString)
                .limit(1);
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                const report = data[0];
                setMorningReport(report.morning_report || '');
                setAfternoonReport(report.afternoon_report || '');
                setPic1Url(report.pic1_url || '');
                setPic2Url(report.pic2_url || '');
                setPic3Url(report.pic3_url || '');
                setPic4Url(report.pic4_url || '');
                setPic1Desc(report.pic1_desc || 'ครูเวรประจำวันตรวจความเรียบร้อยบริเวณประตูทางเข้าโรงเรียนในช่วงเช้าก่อนเข้าเรียน');
                setPic2Desc(report.pic2_desc || 'กิจกรรมการเคารพธงชาติและอบรมความมีระเบียบวินัยนักเรียนบริเวณหน้าเสาธง');
                setPic3Desc(report.pic3_desc || 'ดูแลความเรียบร้อยและสุขอนามัยของนักเรียนระหว่างการรับประทานอาหารกลางวัน');
                setPic4Desc(report.pic4_desc || 'ครูเวรประจำวันส่งนักเรียนและอำนวยความสะดวกการจราจรขณะเดินทางกลับบ้านอย่างปลอดภัย');
            } else {
                setMorningReport('');
                setAfternoonReport('');
                setPic1Url('');
                setPic2Url('');
                setPic3Url('');
                setPic4Url('');
                setPic1Desc('ครูเวรประจำวันตรวจความเรียบร้อยบริเวณประตูทางเข้าโรงเรียนในช่วงเช้าก่อนเข้าเรียน');
                setPic2Desc('กิจกรรมการเคารพธงชาติและอบรมความมีระเบียบวินัยนักเรียนบริเวณหน้าเสาธง');
                setPic3Desc('ดูแลความเรียบร้อยและสุขอนามัยของนักเรียนระหว่างการรับประทานอาหารกลางวัน');
                setPic4Desc('ครูเวรประจำวันส่งนักเรียนและอำนวยความสะดวกการจราจรขณะเดินทางกลับบ้านอย่างปลอดภัย');
            }
        } catch (e) {
            console.error("Error reading existing report for date:", e);
        }
    };

    const compressImage = (file: File, maxWidth: number = 1000, maxHeight: number = 800, quality: number = 0.8): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target?.result as string;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxWidth) {
                            height = Math.round((height * maxWidth) / width);
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width = Math.round((width * maxHeight) / height);
                            height = maxHeight;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error("Canvas context is not supported"));
                        return;
                    }
                    ctx.drawImage(img, 0, 0, width, height);
                    const base64Data = canvas.toDataURL('image/jpeg', quality);
                    resolve(base64Data.split(',')[1]);
                };
                img.onerror = (err) => reject(err);
            };
            reader.onerror = (err) => reject(err);
        });
    };

    const handleDutyPicUpload = async (file: File, picIndex: number) => {
        if (!schoolConfig?.script_url || !schoolConfig?.drive_folder_id) {
            alert("กรุณาให้ผู้ดูแลระบบตั้งค่า Google Drive ในหน้าตั้งค่าก่อน");
            return;
        }

        setUploadingPicIndex(picIndex);
        try {
            let base64Data = '';
            try {
                if (file.type.startsWith('image/')) {
                    base64Data = await compressImage(file, 1000, 800, 0.82);
                } else {
                    const reader = new FileReader();
                    const base64Promise = new Promise<string>((resolve) => {
                        reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
                        reader.readAsDataURL(file);
                    });
                    base64Data = await base64Promise;
                }
            } catch (err) {
                console.warn("Failed to compress, uploading original", err);
                const reader = new FileReader();
                const base64Promise = new Promise<string>((resolve) => {
                    reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
                    reader.readAsDataURL(file);
                });
                base64Data = await base64Promise;
            }

            const payload = {
                folderId: schoolConfig.drive_folder_id,
                fileName: `duty_${picIndex}_${Date.now()}_${file.name.split('.')[0]}.jpg`,
                mimeType: 'image/jpeg',
                fileData: base64Data
            };

            const response = await fetch(schoolConfig.script_url, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'text/plain;charset=utf-8' }
            });

            const responseText = await response.text();
            let result;
            try {
                result = JSON.parse(responseText);
            } catch (e) {
                if (responseText.trim().startsWith('error:')) {
                    throw new Error(responseText.trim().replace('error:', '').trim());
                }
                throw new Error("Server returned invalid JSON response");
            }
            if (result.status === 'success') {
                if (picIndex === 1) setPic1Url(result.viewUrl);
                else if (picIndex === 2) setPic2Url(result.viewUrl);
                else if (picIndex === 3) setPic3Url(result.viewUrl);
                else if (picIndex === 4) setPic4Url(result.viewUrl);
                alert("อัปโหลดรูปภาพสำเร็จ");
            } else {
                throw new Error(result.message || "Upload failed");
            }
        } catch (err: any) {
            alert("เกิดข้อผิดพลาดในการอัปโหลดรูปภาพไปยัง Google Drive: " + err.message);
        } finally {
            setUploadingPicIndex(null);
        }
    };

    const saveDutyReport = async () => {
        if (!supabase) return;
        setIsSavingDuty(true);
        try {
            // Find existing id or let POST generate uuid
            const { data: existingData } = await supabase
                .from('teacher_duty_reports')
                .select('id')
                .eq('school_id', currentUser.schoolId)
                .eq('date', dutyDate)
                .limit(1);

            const reportId = existingData && existingData.length > 0 ? existingData[0].id : undefined;

            const reportPayload: any = {
                school_id: currentUser.schoolId,
                date: dutyDate,
                teacher_id: currentUser.id,
                teacher_name: currentUser.name,
                morning_report: morningReport,
                afternoon_report: afternoonReport,
                pic1_url: pic1Url,
                pic1_desc: pic1Desc,
                pic2_url: pic2Url,
                pic2_desc: pic2Desc,
                pic3_url: pic3Url,
                pic3_desc: pic3Desc,
                pic4_url: pic4Url,
                pic4_desc: pic4Desc
            };

            if (reportId) {
                reportPayload.id = reportId;
                const { error: saveErr } = await supabase
                    .from('teacher_duty_reports')
                    .update(reportPayload)
                    .eq('id', reportId);
                if (saveErr) throw saveErr;
            } else {
                const { error: saveErr } = await supabase
                    .from('teacher_duty_reports')
                    .insert([reportPayload]);
                if (saveErr) throw saveErr;
            }

            // Capture elements and upload PDF
            if (schoolConfig?.script_url && schoolConfig?.drive_folder_id) {
                const pdfDoc = await PDFDocument.create();
                let hasPages = false;

                const p1Element = document.getElementById('official-duty-memo-print-p1');
                const p2Element = document.getElementById('official-duty-memo-print-p2');

                if (p1Element && p2Element) {
                    // Page 1
                    const origStyle1 = p1Element.style.cssText;
                    p1Element.style.cssText = "background: white; color: black; display: block; position: relative; z-index: 1000; width: 595.28px; min-height: 841.89px; margin: 0; padding: 40px;";
                    const canvas1 = await html2canvas(p1Element, { 
                        scale: 2.0, 
                        useCORS: true,
                        allowTaint: true,
                        logging: false
                    });
                    p1Element.style.cssText = origStyle1;
                    const imgData1 = canvas1.toDataURL('image/jpeg', 0.90);
                    const page1 = pdfDoc.addPage([595.28, 841.89]);
                    const img1 = await pdfDoc.embedJpg(imgData1);
                    page1.drawImage(img1, { x: 0, y: 0, width: 595.28, height: 841.89 });

                    // Page 2
                    const origStyle2 = p2Element.style.cssText;
                    p2Element.style.cssText = "background: white; color: black; display: block; position: relative; z-index: 1000; width: 595.28px; min-height: 841.89px; margin: 0; padding: 40px;";
                    const canvas2 = await html2canvas(p2Element, { 
                        scale: 2.0, 
                        useCORS: true,
                        allowTaint: true,
                        logging: false
                    });
                    p2Element.style.cssText = origStyle2;
                    const imgData2 = canvas2.toDataURL('image/jpeg', 0.90);
                    const page2 = pdfDoc.addPage([595.28, 841.89]);
                    const img2 = await pdfDoc.embedJpg(imgData2);
                    page2.drawImage(img2, { x: 0, y: 0, width: 595.28, height: 841.89 });

                    hasPages = true;
                }

                if (hasPages) {
                    const pdfBytes = await pdfDoc.save();
                    const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
                    const base64Pdf = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const dataUrl = reader.result as string;
                            const base64 = dataUrl.split(',')[1];
                            resolve(base64);
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });

                    const uploadPayload = {
                        folderId: schoolConfig.drive_folder_id,
                        fileName: `Duty_Report_${dutyDate}_${currentUser.name.replace(/\s+/g, '_')}.pdf`,
                        mimeType: 'application/pdf',
                        fileData: base64Pdf
                    };

                    const response = await fetch(schoolConfig.script_url, {
                        method: 'POST',
                        body: JSON.stringify(uploadPayload),
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' }
                    });

                    const responseText = await response.text();
                    let resJSON;
                    try {
                        resJSON = JSON.parse(responseText);
                    } catch (e) {
                        console.error("Invalid GAS PDF response", responseText);
                    }

                    if (resJSON?.status === 'success' && resJSON?.viewUrl) {
                        let finalId = reportId;
                        if (!finalId) {
                            const { data: freshRec } = await supabase
                                .from('teacher_duty_reports')
                                .select('id')
                                .eq('school_id', currentUser.schoolId)
                                .eq('date', dutyDate)
                                .limit(1);
                            if (freshRec && freshRec.length > 0) {
                                finalId = freshRec[0].id;
                            }
                        }
                        
                        if (finalId) {
                            await supabase
                                .from('teacher_duty_reports')
                                .update({ pdf_url: resJSON.viewUrl })
                                .eq('id', finalId);
                        }
                    }
                }
            }

            alert("บันทึกข้อมูลรายงานเวรและอัปโหลด PDF ไปยัง Google Drive สำเร็จเรียบร้อยแล้ว!");
            await fetchDutyReports();
            setActiveDutyTab('LIST');
        } catch (e: any) {
            alert("ขัดข้อง: " + e.message);
        } finally {
            setIsSavingDuty(false);
        }
    };

    // Filter and paginate reports
    const dutyMonthOptions = useMemo(() => {
        const months = new Set<string>();
        dutyReports.forEach(r => {
            if (r.date) {
                const parts = r.date.split('-');
                if (parts.length >= 2) {
                    months.add(`${parts[0]}-${parts[1]}`);
                }
            }
        });
        return Array.from(months).sort().reverse();
    }, [dutyReports]);

    const formatMonthYearToThai = (ym: string) => {
        const [y, m] = ym.split('-');
        const yearTh = parseInt(y) + 543;
        const monthTh = THAI_MONTHS[parseInt(m) - 1];
        return `${monthTh} ${yearTh}`;
    };

    const filteredDutyReports = useMemo(() => {
        return dutyReports.filter(r => {
            const matchSearch = dutySearchQuery === '' || 
                (r.teacherName && r.teacherName.toLowerCase().includes(dutySearchQuery.toLowerCase())) ||
                (r.morningReport && r.morningReport.toLowerCase().includes(dutySearchQuery.toLowerCase())) ||
                (r.afternoonReport && r.afternoonReport.toLowerCase().includes(dutySearchQuery.toLowerCase()));

            const matchMonth = dutyMonthFilter === 'ALL' || r.date.startsWith(dutyMonthFilter);

            return matchSearch && matchMonth;
        });
    }, [dutyReports, dutySearchQuery, dutyMonthFilter]);

    const itemsPerPage = 8;
    const totalPages = Math.ceil(filteredDutyReports.length / itemsPerPage);
    const paginatedDutyReports = useMemo(() => {
        const start = (dutyPage - 1) * itemsPerPage;
        return filteredDutyReports.slice(start, start + itemsPerPage);
    }, [filteredDutyReports, dutyPage]);

    // Async stats loader when selected report changes
    useEffect(() => {
        if (selectedDutyReport) {
            fetchFullSchoolStatsForDate(selectedDutyReport.date).then(stats => {
                setActiveDutyStats(stats);
            });
        }
    }, [selectedDutyReport]);

    return (
        <div className="space-y-6 animate-fade-in print:m-0 print:p-0">
            {/* Embedded styles for print perfectness and scroll on screen */}
            <style dangerouslySetInnerHTML={{ __html: `
                @media screen {
                    .screen-scroll-container {
                        max-height: 80vh;
                        overflow-y: auto;
                    }
                    #print-content-area, .print-only-area {
                        display: none !important;
                    }
                }
                @media print {
                    /* Establish A4 rules */
                    @page {
                        size: A4 portrait;
                        margin: 0mm !important;
                    }
                    
                    /* Force base tags to print cleanly without borders or scrolls */
                    html, body {
                        width: 210mm !important;
                        height: 297mm !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        background: white !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                        overflow: visible !important;
                        visibility: hidden !important;
                    }

                    /* Disable scrolling and overlay frames */
                    #root, .app-container, main {
                        height: auto !important;
                        min-height: auto !important;
                        max-height: none !important;
                        overflow: visible !important;
                        position: static !important;
                        display: block !important;
                    }

                    /* Ensure print content container is direct-rendered block and visible */
                    #print-content-area, .print-only-area {
                        display: block !important;
                        visibility: visible !important;
                        position: absolute !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 210mm !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        background: white !important;
                    }

                    #print-content-area *, .print-only-area * {
                        visibility: visible !important;
                    }

                    /* Hide all web components except print area */
                    .print\\:hidden,
                    button,
                    nav,
                    header,
                    footer,
                    .no-print {
                        display: none !important;
                    }

                    /* Print layout with exact standard margins */
                    .print-page-layout {
                        width: 210mm !important;
                        height: 297mm !important;
                        page-break-after: always !important;
                        page-break-inside: avoid !important;
                        break-after: page !important;
                        break-inside: avoid !important;
                        box-sizing: border-box !important;
                        padding: 20mm 20mm 20mm 25mm !important; /* Standard Thai official margins: top 2cm, bottom 2cm, right 2cm, left 2.5cm */
                        background: white !important;
                        color: black !important;
                        position: relative !important;
                        display: flex !important;
                        flex-direction: column !important;
                        justify-content: space-between !important;
                        overflow: hidden !important;
                    }

                    /* Avoid trailing blank page */
                    .print-page-layout:last-child {
                        page-break-after: avoid !important;
                        break-after: avoid !important;
                    }
                }
            `}} />

            {/* Header bar */}
            <div className="flex justify-between items-center print:hidden">
                <div className="flex items-center gap-4">
                    <button 
                        onClick={onBack}
                        className="p-3 bg-white text-slate-600 rounded-2xl shadow-sm border border-slate-100 hover:bg-slate-50 transition-all cursor-pointer"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h3 className="text-xl font-black text-slate-800">ระบบรายงานเวรดูแลความปลอดภัยประจำวันคุณครู</h3>
                        <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest">Daily Teacher Duty Security Report</p>
                    </div>
                </div>

                {activeDutyTab === 'LIST' && (
                    <button 
                        onClick={() => {
                            handleDutyDateChange(formatToISODate(new Date()));
                            setActiveDutyTab('FORM');
                        }}
                        className="px-6 py-2.5 bg-rose-600 text-white rounded-xl font-black text-xs hover:bg-rose-700 transition-all shadow-lg shadow-rose-100 flex items-center gap-2 cursor-pointer"
                    >
                        <Plus size={16} /> เขียนรายงานเวรสำหรับวันนี้
                    </button>
                )}
            </div>

            {activeDutyTab === 'LIST' ? (
                <div className="bg-white p-6 sm:p-8 rounded-[2.5rem] shadow-sm border border-slate-100 animate-fade-in print:hidden">
                    {/* Title Area */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5 mb-6">
                        <h4 className="font-black text-slate-700 text-md flex items-center gap-2">
                            <FileText size={20} className="text-rose-500" /> ประวัติการบันทึกรายงานเวรทั้งหมดของโรงเรียน
                        </h4>
                        
                        {/* View Type selector */}
                        <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-150 inline-flex self-start md:self-auto">
                            <button
                                onClick={() => setDutyViewType('ROW')}
                                className={`px-4 py-1.5 rounded-xl font-black text-xs transition-all flex items-center gap-1.5 cursor-pointer ${
                                    dutyViewType === 'ROW'
                                        ? 'bg-white text-slate-800 shadow-sm'
                                        : 'text-slate-400 hover:text-slate-600'
                                }`}
                            >
                                แสดงแบบแถวเดี่ยว
                            </button>
                            <button
                                onClick={() => setDutyViewType('CARD')}
                                className={`px-4 py-1.5 rounded-xl font-black text-xs transition-all flex items-center gap-1.5 cursor-pointer ${
                                    dutyViewType === 'CARD'
                                        ? 'bg-white text-slate-800 shadow-sm'
                                        : 'text-slate-400 hover:text-slate-600'
                                }`}
                            >
                                แสดงแบบการ์ด
                            </button>
                        </div>
                    </div>

                    {/* Filter controls */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 mb-6 bg-slate-50 p-4 rounded-3xl border border-slate-150">
                        <div className="sm:col-span-7 relative">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input
                                type="text"
                                placeholder="ค้นหาชื่อครู, หรือรายละเอียดในรายงาน..."
                                value={dutySearchQuery}
                                onChange={(e) => {
                                    setDutySearchQuery(e.target.value);
                                    setDutyPage(1);
                                }}
                                className="w-full bg-white pl-10 pr-4 py-2.5 rounded-2xl border border-slate-200 focus:border-rose-500 focus:ring-rose-500 text-slate-700 text-xs font-semibold placeholder-slate-400"
                            />
                        </div>
                        <div className="sm:col-span-5 relative flex gap-2">
                            <div className="relative flex-1">
                                <Filter className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={14} />
                                <select
                                    value={dutyMonthFilter}
                                    onChange={(e) => {
                                        setDutyMonthFilter(e.target.value);
                                        setDutyPage(1);
                                    }}
                                    className="w-full bg-white pl-10 pr-8 py-2.5 rounded-2xl border border-slate-200 focus:border-rose-500 focus:ring-rose-500 text-slate-700 text-xs font-black appearance-none cursor-pointer text-ellipsis overflow-hidden"
                                >
                                    <option value="ALL">📅 ทุกช่วงเวลา / ทุกเดือน</option>
                                    {dutyMonthOptions.map(ym => (
                                        <option key={ym} value={ym}>
                                            🗓️ {formatMonthYearToThai(ym)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Duty Reports List */}
                    {loadingDutyList ? (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-450 gap-3">
                            <Loader className="animate-spin text-rose-500" size={32} />
                            <p className="text-xs font-bold text-slate-400">กำลังดาวน์โหลดข้อมูลบันทึกเวรประจำวัน...</p>
                        </div>
                    ) : filteredDutyReports.length === 0 ? (
                        <div className="text-center py-16 border-2 border-dashed border-slate-100 rounded-3xl bg-slate-50/50">
                            <FileText className="mx-auto text-slate-300 mb-2" size={40} />
                            <p className="text-slate-400 font-bold text-xs">ไม่พบข้อมูลรายงานเวรตรงตามเงื่อนไขค้นหา</p>
                        </div>
                    ) : dutyViewType === 'ROW' ? (
                        <div className="overflow-x-auto rounded-2xl border border-slate-100">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="bg-slate-50 text-slate-500 font-black border-b border-slate-100">
                                        <th className="p-4 w-28">เลขที่รายงาน</th>
                                        <th className="p-4 w-36">วันที่ปฏิบัติเวร</th>
                                        <th className="p-4 w-44">ครูผู้บันทึกรายงาน</th>
                                        <th className="p-4">รายละเอียดผลปฏิบัติงานย่อ</th>
                                        <th className="p-4 w-28 text-center scroll-px-4">เอกสาร PDF</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedDutyReports.map((report) => (
                                        <tr 
                                            key={report.id} 
                                            onClick={() => setSelectedDutyReport(report)}
                                            className="border-b border-slate-50 hover:bg-slate-50/60 transition-all cursor-pointer font-bold text-slate-700"
                                        >
                                            <td className="p-4 text-slate-500 font-mono">#{getDutyReportNumberText(report.date, report.id)}</td>
                                            <td className="p-4 whitespace-nowrap">{formatToThaiDate(report.date)}</td>
                                            <td className="p-4 whitespace-nowrap text-slate-800 font-black">{report.teacherName}</td>
                                            <td className="p-4 truncate max-w-[200px] font-medium text-slate-500">
                                                เช้า: {report.morningReport || 'คลิกเพื่อระบุ'} / บ่าย: {report.afternoonReport || 'คลิกเพื่อระบุ'}
                                            </td>
                                            <td className="p-4 text-center">
                                                {report.pdfUrl ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-[10px] font-black text-emerald-700 border border-emerald-100">
                                                        <CheckCircle2 size={10} /> พร้อมพิมพ์
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-[10px] font-bold text-slate-405 text-slate-500">
                                                        ร่างเอกสาร
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            {paginatedDutyReports.map((report) => (
                                <div 
                                    key={report.id}
                                    onClick={() => setSelectedDutyReport(report)}
                                    className="bg-slate-50 hover:bg-slate-100/70 border border-slate-150 rounded-2xl p-5 cursor-pointer transition-all flex flex-col justify-between h-[180px]"
                                >
                                    <div>
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="text-[10px] font-mono text-slate-400">#{getDutyReportNumberText(report.date, report.id)}</span>
                                            {report.pdfUrl && (
                                                <span className="p-1 rounded-md bg-emerald-50 text-emerald-700 leading-none">
                                                    <CheckCircle2 size={12} />
                                                </span>
                                            )}
                                        </div>
                                        <h5 className="font-extrabold text-slate-800 text-xs mb-1 line-clamp-1">{formatToThaiDate(report.date)}</h5>
                                        <p className="text-[10px] text-slate-400 font-bold mb-3">{report.teacherName}</p>
                                        <p className="text-[10px] font-medium text-slate-500 line-clamp-2 h-7 leading-snug">
                                            เช้า: {report.morningReport || 'ยังไม่รายงานรายละเอียด'}
                                        </p>
                                    </div>
                                    <div className="text-[9px] font-mono text-slate-400 pt-2 border-t border-slate-200/50 flex justify-between">
                                        <span>แนบ {[[report.pic1Url, report.pic2Url, report.pic3Url, report.pic4Url].filter(Boolean).length]} รูปภาพ</span>
                                        <span className="text-rose-500 font-bold hover:underline">คลิกเปิดดู</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Pagination area */}
                    {totalPages > 1 && (
                        <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-100">
                            <span className="text-[10px] font-black text-slate-400">
                                หน้า {dutyPage} จากทั้งหมด {totalPages} หน้า (ทั้งหมด {filteredDutyReports.length} บันทึก)
                            </span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setDutyPage(p => Math.max(1, p - 1))}
                                    disabled={dutyPage === 1}
                                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-[10px] font-black hover:bg-slate-50 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                                >
                                    ก่อนหน้า
                                </button>
                                <button
                                    onClick={() => setDutyPage(p => Math.min(totalPages, p + 1))}
                                    disabled={dutyPage === totalPages}
                                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-[10px] font-black hover:bg-slate-50 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                                >
                                    ถัดไป
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                /* FORM VIEW */
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 print:hidden">
                    {/* Left panel inputs */}
                    <div className="lg:col-span-7 bg-white p-6 sm:p-8 rounded-[2.5rem] shadow-sm border border-slate-100 space-y-5">
                        <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                            <h4 className="font-black text-slate-800 text-sm flex items-center gap-2">
                                <Plus size={18} className="text-rose-500" /> กรอกประวัติรายงานเวรประจำวัน
                            </h4>
                            <button 
                                onClick={() => setActiveDutyTab('LIST')}
                                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-500 font-black rounded-lg text-[10px] cursor-pointer"
                            >
                                ย้อนกลับ
                            </button>
                        </div>

                        {/* Date selection component */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] uppercase font-black text-slate-400 mb-1.5">วันที่ปฏิบัติเวรประจำวัน</label>
                                <input
                                    type="date"
                                    value={dutyDate}
                                    onChange={(e) => handleDutyDateChange(e.target.value)}
                                    className="w-full bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase font-black text-slate-400 mb-1.5">ผู้รายงานเวร</label>
                                <input
                                    type="text"
                                    disabled
                                    value={currentUser.name}
                                    className="w-full bg-slate-100 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-xs font-bold"
                                />
                            </div>
                        </div>

                        {/* Descriptions fields */}
                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] uppercase font-black text-slate-400 mb-1.5">๑. รายละเอียดยามเช้า (ช่วงก่อนเข้าเรียน)</label>
                                <textarea
                                    rows={3}
                                    placeholder="ระบุความเรียบร้อย ปัญหา อุปสรรค หรือเหตุการณ์สำคัญในช่วงเช้า..."
                                    value={morningReport}
                                    onChange={(e) => setMorningReport(e.target.value)}
                                    className="w-full bg-slate-50 p-4 rounded-xl border border-slate-200 text-slate-700 text-xs font-medium placeholder-slate-400 focus:ring-rose-500 focus:border-rose-500"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] uppercase font-black text-slate-400 mb-1.5">๒. รายละเอียดกลางวันและเย็น (หลังเลิกเรียน)</label>
                                <textarea
                                    rows={3}
                                    placeholder="ระบุข้อความการดูแลความปลอดภัย อาหารกลางวัน การส่งเด็กกลับบ้าน..."
                                    value={afternoonReport}
                                    onChange={(e) => setAfternoonReport(e.target.value)}
                                    className="w-full bg-slate-50 p-4 rounded-xl border border-slate-200 text-slate-700 text-xs font-medium placeholder-slate-400 focus:ring-rose-500 focus:border-rose-500"
                                />
                            </div>
                        </div>

                        {/* Photos upload sections */}
                        <div className="space-y-3 pt-4 border-t border-slate-100">
                            <h5 className="font-black text-xs text-slate-700">๓. แนบภาพถ่ายการปฏิบัติหน้าที่ (๔ ภาพที่จำแนกหมวดหมู่ชัดเจน)</h5>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Photo 1 */}
                                <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/50 space-y-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-[10px] font-black text-slate-500">ภาพที่ ๑ ช่วงเช้าหน้าโรงเรียน</span>
                                        {uploadingPicIndex === 1 && <Loader size={12} className="animate-spin text-rose-500" />}
                                    </div>
                                    <div className="relative border border-dashed border-slate-300 rounded-lg h-32 flex items-center justify-center p-2 bg-white">
                                        {pic1Url ? (
                                            <div className="relative group w-full h-full">
                                                <img src={getDirectDriveUrl(pic1Url)} alt="ภาพช่วงเช้า" className="w-full h-full object-cover rounded" referrerPolicy="no-referrer" />
                                                <button onClick={() => setPic1Url('')} className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center text-white text-[10px] font-bold rounded">คลิกลบภาพ</button>
                                            </div>
                                        ) : (
                                            <label className="cursor-pointer text-center p-3">
                                                <Upload className="mx-auto text-slate-400 mb-1" size={20} />
                                                <p className="text-[9px] font-bold text-slate-400">เลือกภาพ/ลากวาง</p>
                                                <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleDutyPicUpload(e.target.files[0], 1)} className="hidden" />
                                            </label>
                                        )}
                                    </div>
                                    <input 
                                        type="text" 
                                        value={pic1Desc} 
                                        onChange={(e) => setPic1Desc(e.target.value)} 
                                        placeholder="คำอธิบายภาพ ๑" 
                                        className="w-full border border-slate-200 p-2 rounded-lg text-[9px] font-medium"
                                    />
                                </div>

                                {/* Photo 2 */}
                                <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/50 space-y-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-[10px] font-black text-slate-500">ภาพที่ ๒ กิจกรรมหน้าเสาธง</span>
                                        {uploadingPicIndex === 2 && <Loader size={12} className="animate-spin text-rose-500" />}
                                    </div>
                                    <div className="relative border border-dashed border-slate-300 rounded-lg h-32 flex items-center justify-center p-2 bg-white">
                                        {pic2Url ? (
                                            <div className="relative group w-full h-full">
                                                <img src={getDirectDriveUrl(pic2Url)} alt="กิจกรรมหน้าเสาธง" className="w-full h-full object-cover rounded" referrerPolicy="no-referrer" />
                                                <button onClick={() => setPic2Url('')} className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center text-white text-[10px] font-bold rounded">คลิกลบภาพ</button>
                                            </div>
                                        ) : (
                                            <label className="cursor-pointer text-center p-3">
                                                <Upload className="mx-auto text-slate-400 mb-1" size={20} />
                                                <p className="text-[9px] font-bold text-slate-400">เลือกภาพ/ลากวาง</p>
                                                <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleDutyPicUpload(e.target.files[0], 2)} className="hidden" />
                                            </label>
                                        )}
                                    </div>
                                    <input 
                                        type="text" 
                                        value={pic2Desc} 
                                        onChange={(e) => setPic2Desc(e.target.value)} 
                                        placeholder="คำอธิบายภาพ ๒" 
                                        className="w-full border border-slate-200 p-2 rounded-lg text-[9px] font-medium"
                                    />
                                </div>

                                {/* Photo 3 */}
                                <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/50 space-y-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-[10px] font-black text-slate-500">ภาพที่ ๓ อาหารกลางวันนักเรียน</span>
                                        {uploadingPicIndex === 3 && <Loader size={12} className="animate-spin text-rose-500" />}
                                    </div>
                                    <div className="relative border border-dashed border-slate-300 rounded-lg h-32 flex items-center justify-center p-2 bg-white">
                                        {pic3Url ? (
                                            <div className="relative group w-full h-full">
                                                <img src={getDirectDriveUrl(pic3Url)} alt="อาหารกลางวันนักเรียน" className="w-full h-full object-cover rounded" referrerPolicy="no-referrer" />
                                                <button onClick={() => setPic3Url('')} className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center text-white text-[10px] font-bold rounded">คลิกลบภาพ</button>
                                            </div>
                                        ) : (
                                            <label className="cursor-pointer text-center p-3">
                                                <Upload className="mx-auto text-slate-400 mb-1" size={20} />
                                                <p className="text-[9px] font-bold text-slate-400">เลือกภาพ/ลากวาง</p>
                                                <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleDutyPicUpload(e.target.files[0], 3)} className="hidden" />
                                            </label>
                                        )}
                                    </div>
                                    <input 
                                        type="text" 
                                        value={pic3Desc} 
                                        onChange={(e) => setPic3Desc(e.target.value)} 
                                        placeholder="คำอธิบายภาพ ๓" 
                                        className="w-full border border-slate-200 p-2 rounded-lg text-[9px] font-medium"
                                    />
                                </div>

                                {/* Photo 4 */}
                                <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/50 space-y-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-[10px] font-black text-slate-500">ภาพที่ ๔ ดูแลส่งกลับบ้านช่วงเย็น</span>
                                        {uploadingPicIndex === 4 && <Loader size={12} className="animate-spin text-rose-500" />}
                                    </div>
                                    <div className="relative border border-dashed border-slate-300 rounded-lg h-32 flex items-center justify-center p-2 bg-white">
                                        {pic4Url ? (
                                            <div className="relative group w-full h-full">
                                                <img src={getDirectDriveUrl(pic4Url)} alt="ดูแลส่งกลับบ้านช่วงเย็น" className="w-full h-full object-cover rounded" referrerPolicy="no-referrer" />
                                                <button onClick={() => setPic4Url('')} className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center text-white text-[10px] font-bold rounded">คลิกลบภาพ</button>
                                            </div>
                                        ) : (
                                            <label className="cursor-pointer text-center p-3">
                                                <Upload className="mx-auto text-slate-400 mb-1" size={20} />
                                                <p className="text-[9px] font-bold text-slate-400">เลือกภาพ/ลากวาง</p>
                                                <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleDutyPicUpload(e.target.files[0], 4)} className="hidden" />
                                            </label>
                                        )}
                                    </div>
                                    <input 
                                        type="text" 
                                        value={pic4Desc} 
                                        onChange={(e) => setPic4Desc(e.target.value)} 
                                        placeholder="คำอธิบายภาพ ๔" 
                                        className="w-full border border-slate-200 p-2 rounded-lg text-[9px] font-medium"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Save Action section */}
                        <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
                            <button
                                onClick={saveDutyReport}
                                disabled={isSavingDuty}
                                className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl font-black text-xs transition-all shadow-md flex items-center gap-2 cursor-pointer"
                            >
                                <Save size={14} /> {isSavingDuty ? 'กำลังบันทึกและส่งรายงาน...' : 'บันทึกรายงานเวรประจำวัน'}
                            </button>
                        </div>
                    </div>

                    {/* Right preview panel - standard screen representation */}
                    <div className="lg:col-span-5 bg-slate-100 p-6 rounded-[2.5rem] flex flex-col items-center">
                        <p className="text-[10px] uppercase font-black text-slate-400 mb-4">แสดงส่วนแบบจำลองบันทึกข้อความจริง ๒ หน้า (A4)</p>
                        
                        <div id="official-duty-memo-print" className="space-y-4 max-w-full w-full">
                            {/* Draft Page 1 */}
                            <div id="official-duty-memo-print-p1" className="bg-white p-8 border border-slate-300 rounded-3xl relative text-slate-900 text-[10px] leading-relaxed w-full min-h-[720px] shadow-sm flex flex-col justify-between">
                                <div>
                                    {/* Logo header */}
                                    <div className="flex justify-start mb-1">
                                        <img 
                                            src={schoolConfig?.official_garuda_base_64 ? (schoolConfig.official_garuda_base_64.startsWith('data:') ? schoolConfig.official_garuda_base_64 : `data:image/png;base64,${schoolConfig.official_garuda_base_64}`) : "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Garuda_Emb_of_Thailand.svg/1200px-Garuda_Emb_of_Thailand.svg.png"} 
                                            alt="Garuda" 
                                            className="h-14 w-auto object-contain"
                                            referrerPolicy="no-referrer"
                                        />
                                    </div>
                                    <div className="text-center mb-3">
                                        <p className="text-sm font-extrabold text-black">บันทึกข้อความ</p>
                                    </div>

                                    {/* Memo details */}
                                    <div className="space-y-1 text-[9.5px] mb-4 border-b border-double border-slate-300 pb-2">
                                        <div className="flex items-end">
                                            <span className="font-extrabold w-20 shrink-0">ส่วนราชการ</span>
                                            <span className="border-b border-dotted border-slate-350 flex-1 pl-2 text-slate-800">
                                                {schoolConfig?.school_name || 'โรงเรียนของท่าน'}
                                            </span>
                                        </div>
                                        <div className="flex">
                                            <div className="w-1/2 flex items-end">
                                                <span className="font-extrabold w-6 shrink-0">ที่</span>
                                                <span className="border-b border-dotted border-slate-350 flex-1 pl-2 text-slate-800 font-bold">{getDutyReportNumberText(dutyDate)}</span>
                                            </div>
                                            <div className="w-1/2 flex items-end">
                                                <span className="font-extrabold shrink-0 pl-3 w-10 text-right">วันที่</span>
                                                <span className="border-b border-dotted border-slate-350 flex-1 text-center font-bold text-slate-900">
                                                    {formatToThaiDate(dutyDate)}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-end">
                                            <span className="font-extrabold w-10 shrink-0">เรื่อง</span>
                                            <span className="border-b border-dotted border-slate-350 flex-1 pl-2 font-bold text-slate-900">
                                                รายงานเวรประจำวันที่ {formatToThaiDate(dutyDate)}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="mb-4 text-[9.5px]">
                                        <p className="font-extrabold mb-2">เรียน ผู้อำนวยการโรงเรียน{(schoolConfig?.school_name || '').replace(/^โรงเรียน/, '') || '................................................'}</p>
                                        
                                        <p className="indent-8 text-slate-800 leading-relaxed mb-3">
                                            ตามที่ ข้าพเจ้า <span className="font-bold text-black">{currentUser.name}</span> ตำแหน่ง <span className="font-bold text-black">{currentUser.position || 'ครู'}</span> ได้รับมอบหมายให้ปฏิบัติหน้าที่ครูเวรประจำวัน ประจำวันที่ <span className="font-bold text-black">{formatToThaiDate(dutyDate)}</span> นั้น
                                        </p>
                                        <p className="indent-8 text-slate-800 leading-relaxed mb-4">
                                            บัดนี้การปฏิบัติหน้าที่ครูเวรประจำวันเสร็จสิ้นเรียบร้อยแล้ว จึงขอส่งรายงานสรุปผลการปฏิบัติหน้าที่ ตลอดจนข้อมูลเข้าเรียนของนักเรียน ดังมีรายละเอียดต่อไปนี้:
                                        </p>

                                        {/* Statistics table */}
                                        <p className="font-extrabold mb-1.5 text-slate-800">
                                            ๑. ข้อมูลนักเรียนที่มาเรียนแยกตามทุกระดับชั้น:
                                        </p>
                                        <div className="overflow-hidden mb-3">
                                            <table className="w-full border-collapse border border-black text-center text-[8px] text-slate-800">
                                                <thead>
                                                    <tr className="bg-slate-50 font-bold">
                                                        <th className="border border-black p-1">จำนวนนักเรียนทั้งหมด</th>
                                                        <th className="border border-black p-1 text-emerald-800">มาเรียน (คน)</th>
                                                        <th className="border border-black p-1 text-amber-700">เข้าเรียนสาย (คน)</th>
                                                        <th className="border border-black p-1 text-blue-800">ลาป่วย (คน)</th>
                                                        <th className="border border-black p-1 text-rose-800">ขาดเรียน (คน)</th>
                                                        <th className="border border-black p-1">คิดเป็นเข้าเรียนร้อยละ</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr className="font-bold">
                                                        <td className="border border-black p-1">{activeDutyStats?.total || 0}</td>
                                                        <td className="border border-black p-1 text-emerald-800">{activeDutyStats?.present || 0}</td>
                                                        <td className="border border-black p-1 text-amber-700">{activeDutyStats?.late || 0}</td>
                                                        <td className="border border-black p-1 text-blue-800">{activeDutyStats?.sick || 0}</td>
                                                        <td className="border border-black p-1 text-rose-800">{activeDutyStats?.absent || 0}</td>
                                                        <td className="border border-black p-1 text-indigo-700">
                                                            {activeDutyStats?.total > 0 
                                                              ? ((activeDutyStats.present / activeDutyStats.total) * 100).toFixed(2) 
                                                              : '0.00'
                                                            }%
                                                        </td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Details */}
                                        <p className="font-extrabold mb-1.5 text-slate-800">๒. รายละเอียดการปฏิบัติหน้าที่ครูเวรประจำวัน:</p>
                                        <div className="space-y-1 text-slate-800 mb-4 whitespace-pre-line">
                                            <p className="indent-4"><span className="font-bold underline text-black">ช่วงเช้า:</span> {morningReport || '(ยังคงเว้นว่างไว้ในแบบบันทึกร่าง)'}</p>
                                            <p className="indent-4"><span className="font-bold underline text-black">ช่วงกลางวันและเย็น:</span> {afternoonReport || '(ยังคงเว้นว่างไว้ในแบบบันทึกร่าง)'}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Draft Page 2 */}
                            <div id="official-duty-memo-print-p2" className="bg-white p-8 border border-slate-300 rounded-3xl relative text-slate-900 text-[10px] leading-relaxed w-full min-h-[720px] shadow-sm flex flex-col justify-between">
                                <div>
                                    <p className="font-extrabold mb-2.5 text-slate-800">๓. รูปภาพประกอบการรายงานเวร:</p>
                                    <div className="grid grid-cols-2 gap-3 mb-4">
                                        {pic1Url ? (
                                            <div className="border border-slate-350 p-1 rounded bg-slate-50 flex flex-col items-center">
                                                <p className="text-[7.5px] font-bold text-center text-slate-650 mb-0.5 line-clamp-1">{pic1Desc}</p>
                                                <img src={getDirectDriveUrl(pic1Url)} alt="ภาพเช้า" className="h-[60px] w-full object-cover rounded" referrerPolicy="no-referrer" />
                                            </div>
                                        ) : (
                                            <div className="h-[75px] border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-[8px] text-slate-400 italic rounded text-center">ทางเข้าโรงเรียนช่วงเช้า<br/>(ยังไม่แนบ)</div>
                                        )}

                                        {pic2Url ? (
                                            <div className="border border-slate-350 p-1 rounded bg-slate-50 flex flex-col items-center">
                                                <p className="text-[7.5px] font-bold text-center text-slate-650 mb-0.5 line-clamp-1">{pic2Desc}</p>
                                                <img src={getDirectDriveUrl(pic2Url)} alt="ภาพธง" className="h-[60px] w-full object-cover rounded" referrerPolicy="no-referrer" />
                                            </div>
                                        ) : (
                                            <div className="h-[75px] border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-[8px] text-slate-400 italic rounded text-center">กิจกรรมหน้าเสาธง<br/>(ยังไม่แนบ)</div>
                                        )}

                                        {pic3Url ? (
                                            <div className="border border-slate-350 p-1 rounded bg-slate-50 flex flex-col items-center">
                                                <p className="text-[7.5px] font-bold text-center text-slate-650 mb-0.5 line-clamp-1">{pic3Desc}</p>
                                                <img src={getDirectDriveUrl(pic3Url)} alt="ภาพข้าว" className="h-[60px] w-full object-cover rounded" referrerPolicy="no-referrer" />
                                            </div>
                                        ) : (
                                            <div className="h-[75px] border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-[8px] text-slate-400 italic rounded text-center">อาหารกลางวันนักเรียน<br/>(ยังไม่แนบ)</div>
                                        )}

                                        {pic4Url ? (
                                            <div className="border border-slate-350 p-1 rounded bg-slate-50 flex flex-col items-center">
                                                <p className="text-[7.5px] font-bold text-center text-slate-650 mb-0.5 line-clamp-1">{pic4Desc}</p>
                                                <img src={getDirectDriveUrl(pic4Url)} alt="ภาพกลับบ้าน" className="h-[60px] w-full object-cover rounded" referrerPolicy="no-referrer" />
                                            </div>
                                        ) : (
                                            <div className="h-[75px] border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-[8px] text-slate-400 italic rounded text-center">หลังเลิกเรียนและเดินทางกลับ<br/>(ยังไม่แนบ)</div>
                                        )}
                                    </div>

                                    <div className="indent-12 mt-4 text-[10px] mb-6">
                                        <p className="font-bold text-left">จึงเรียนมาเพื่อโปรดทราบและพิจารณา</p>
                                    </div>
                                </div>

                                <div className="space-y-6 text-center text-[9px] mt-auto">
                                    <div className="flex flex-col items-end pr-4">
                                        <div className="flex flex-col items-center w-[180px]">
                                            <p className="mb-0.5 text-slate-500">ลงชื่อ............................................................ผู้รายงาน</p>
                                            <p className="font-extrabold text-black">( {currentUser.name} )</p>
                                            <p className="text-[8px] text-slate-500">ตำแหน่ง {currentUser.position || 'ครูเวรประจำวัน'}</p>
                                        </div>
                                    </div>

                                    <div className="flex flex-col items-end pr-4">
                                        <div className="flex flex-col items-center w-[180px]">
                                            <p className="mb-0.5 text-slate-500">ลงชื่อ............................................................ผู้รับทราบ/ผู้อนุมัติ</p>
                                            <p className="font-extrabold text-black">( {directorName || 'ผู้อำนวยการโรงเรียน'} )</p>
                                            <p className="text-[8px] text-slate-500">ผู้อำนวยการโรงเรียน{(schoolConfig?.school_name || '').replace(/^โรงเรียน/, '') || '................................'}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Print Perfect Modal System (Double-Sided A4 Sheet Layout) */}
            <AnimatePresence>
                {selectedDutyReport && (
                    <div className="fixed inset-0 z-50 bg-slate-905 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto no-print">
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white p-6 sm:p-10 rounded-[2.5rem] shadow-2xl max-w-4xl w-full relative text-slate-900 font-sarabun"
                        >
                            {/* Modal actions / header inside overlay */}
                            <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4 modal-header">
                                <div className="flex items-center gap-2">
                                    <Printer className="text-rose-500" size={20} />
                                    <h4 className="font-black text-slate-800 text-sm">รายงานบันทึกข้อความครูเวรประจำวัน (ตราครุฑ ๒ หน้า A4)</h4>
                                </div>
                                <div className="flex items-center gap-2">
                                    {(isAdmin || isDirector) && (
                                        <button 
                                            onClick={() => deleteDutyReport(selectedDutyReport.id)}
                                            className="px-4 py-2 bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs font-black rounded-xl transition-all flex items-center gap-1 border border-rose-200 cursor-pointer"
                                        >
                                            ลบรายงานเวร
                                        </button>
                                    )}
                                    {selectedDutyReport.pdfUrl && (
                                        <a 
                                            href={selectedDutyReport.pdfUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-black rounded-xl transition-all flex items-center gap-1 border border-indigo-100 cursor-pointer"
                                        >
                                            เปิดเอกสาร Drive
                                        </a>
                                    )}
                                    <button 
                                        onClick={() => window.print()}
                                        className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-black rounded-xl transition-all flex items-center gap-1 shadow-md cursor-pointer"
                                    >
                                        <Printer size={12} /> พิมพ์รายงานทางเบราว์เซอร์ (A4)
                                    </button>
                                    <button 
                                        onClick={() => {
                                            setSelectedDutyReport(null);
                                        }}
                                        className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl transition-all cursor-pointer"
                                    >
                                        ปิดหน้าต่าง
                                    </button>
                                </div>
                            </div>

                            {/* View container on screen: compact layout that comfortably scrolls */}
                            <div className="screen-scroll-container border border-slate-200 rounded-2xl p-6 bg-slate-50 max-h-[60vh] space-y-6">
                                {/* Simulated Page 1 */}
                                <div className="bg-white p-8 rounded-xl border border-slate-150 max-w-[650px] mx-auto shadow-sm">
                                    {/* Garuda */}
                                    <div className="flex justify-start mb-2">
                                        <img 
                                            src={schoolConfig?.official_garuda_base_64 ? (schoolConfig.official_garuda_base_64.startsWith('data:') ? schoolConfig.official_garuda_base_64 : `data:image/png;base64,${schoolConfig.official_garuda_base_64}`) : "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Garuda_Emb_of_Thailand.svg/1200px-Garuda_Emb_of_Thailand.svg.png"} 
                                            alt="Garuda" 
                                            className="h-14 w-auto object-contain"
                                            referrerPolicy="no-referrer"
                                        />
                                    </div>
                                    <div className="text-center mb-4">
                                        <p className="text-sm font-extrabold text-black">บันทึกข้อความ (ส่วนที่ ๑)</p>
                                    </div>

                                    {/* Meta */}
                                    <div className="space-y-1 mb-4 border-b border-double border-slate-300 pb-2 text-[10px]">
                                        <div className="flex items-end">
                                            <span className="font-extrabold w-20 shrink-0">ส่วนราชการ</span>
                                            <span className="border-b border-dotted border-slate-300 flex-1 pl-2 text-slate-800">
                                                {schoolConfig?.school_name || 'โรงเรียนของท่าน'}
                                            </span>
                                        </div>
                                        <div className="flex">
                                            <div className="w-1/2 flex items-end">
                                                <span className="font-extrabold w-6 shrink-0">ที่</span>
                                                <span className="border-b border-dotted border-slate-300 flex-1 pl-2 text-slate-800 font-bold">{getDutyReportNumberText(selectedDutyReport.date, selectedDutyReport.id)}</span>
                                            </div>
                                            <div className="w-1/2 flex items-end">
                                                <span className="font-extrabold shrink-0 pl-3 w-10 text-right">วันที่</span>
                                                <span className="border-b border-dotted border-slate-300 flex-1 text-center font-bold text-slate-900">
                                                    {formatToThaiDate(selectedDutyReport.date)}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-end">
                                            <span className="font-extrabold w-10 shrink-0">เรื่อง</span>
                                            <span className="border-b border-dotted border-slate-300 flex-1 pl-2 font-bold text-slate-900">
                                                รายงานเวรประจำวันที่ {formatToThaiDate(selectedDutyReport.date)}
                                            </span>
                                        </div>
                                    </div>

                                    {/*เรียน */}
                                    <div className="mb-4 text-[10px]">
                                        <p className="font-extrabold mb-2">เรียน ผู้อำนวยการโรงเรียน{(schoolConfig?.school_name || '').replace(/^โรงเรียน/, '') || '................................................'}</p>
                                        <p className="indent-8 text-slate-800 leading-relaxed mb-3">
                                            ตามที่ ข้าพเจ้า <span className="font-bold text-black">{selectedDutyReport.teacherName}</span> ตำแหน่ง <span className="font-bold text-black">{selectedDutyReport.teacherPosition || 'ครู'}</span> ได้รับมอบหน้าที่เป็นครูเวรประจำวันที่ <span className="font-bold text-black">{formatToThaiDate(selectedDutyReport.date)}</span> นั้น จึงขอรายงานเวร ดังนี้
                                        </p>

                                        {/* Attendance table */}
                                        <p className="font-extrabold mb-1.5 text-slate-800">๑. ข้อมูลนักเรียนที่มาเรียนแยกตามทุกระดับชั้น:</p>
                                        <table className="w-full border-collapse border border-black text-center text-[9px] text-slate-800 mb-3">
                                            <thead>
                                                <tr className="bg-slate-50 font-bold">
                                                    <th className="border border-black p-1">จำนวนนักเรียนทั้งหมดกี่คน</th>
                                                    <th className="border border-black p-1 text-emerald-800">มาเรียน (คน)</th>
                                                    <th className="border border-black p-1 text-amber-700">เข้าเรียนสาย (คน)</th>
                                                    <th className="border border-black p-1 text-blue-800">ลาป่วย (คน)</th>
                                                    <th className="border border-black p-1 text-rose-800">ขาดเรียน (คน)</th>
                                                    <th className="border border-black p-1">ร้อยละมาเข้าเรียน</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr className="font-bold">
                                                    <td className="border border-black p-1">{activeDutyStats?.total || 0}</td>
                                                    <td className="border border-black p-1 text-emerald-800">{activeDutyStats?.present || 0}</td>
                                                    <td className="border border-black p-1 text-amber-700">{activeDutyStats?.late || 0}</td>
                                                    <td className="border border-black p-1 text-blue-800">{activeDutyStats?.sick || 0}</td>
                                                    <td className="border border-black p-1 text-rose-800">{activeDutyStats?.absent || 0}</td>
                                                    <td className="border border-black p-1 text-indigo-700">
                                                        {activeDutyStats?.total > 0 
                                                          ? ((activeDutyStats.present / activeDutyStats.total) * 100).toFixed(2) 
                                                          : '0.00'
                                                        }%
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>

                                        {/* Details list */}
                                        <p className="font-extrabold mb-1.5 text-slate-800">๒. รายละเอียดการปฏิบัติหน้าที่ครูเวรประจำวัน:</p>
                                        <div className="space-y-1 text-slate-800 pl-2">
                                            <p><span className="font-bold underline text-black">ช่วงเช้า:</span> {selectedDutyReport.morningReport || 'ไม่มีบันทึกข้อมูลอื่นเพิ่มเติม'}</p>
                                            <p><span className="font-bold underline text-black">ช่วงกลางวันและเย็น:</span> {selectedDutyReport.afternoonReport || 'ไม่มีบันทึกข้อมูลอื่นเพิ่มเติม'}</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Simulated Page 2 */}
                                <div className="bg-white p-8 rounded-xl border border-slate-150 max-w-[650px] mx-auto shadow-sm space-y-6">
                                    <div className="text-center border-b border-slate-100 pb-2">
                                        <p className="text-xs font-extrabold text-slate-500">เอกสารรายงานเวร (หน้าบันทึกที่ ๒)</p>
                                    </div>

                                    {/* Photos mapping */}
                                    <div>
                                        <p className="font-extrabold mb-2 text-slate-800 text-[10px]">๓. รูปภาพประกอบการรายงานเวร:</p>
                                        <div className="grid grid-cols-2 gap-4">
                                            {selectedDutyReport.pic1Url ? (
                                                <div className="border border-slate-200 p-2 rounded bg-slate-50 flex flex-col items-center">
                                                    <p className="text-[8px] font-bold text-center text-slate-500 mb-1 truncate max-w-full">{selectedDutyReport.pic1Desc}</p>
                                                    <img src={getDirectDriveUrl(selectedDutyReport.pic1Url)} alt="ภาพช่วงเช้า" className="h-[90px] w-full object-cover rounded" referrerPolicy="no-referrer" />
                                                </div>
                                            ) : (
                                                <div className="h-[110px] border border-dashed border-slate-300 bg-slate-100 flex items-center justify-center text-[9px] text-slate-400 italic rounded">ช่วงเช้าโรงเรียน (ไม่ได้ติดตั้ง)</div>
                                            )}

                                            {selectedDutyReport.pic2Url ? (
                                                <div className="border border-slate-200 p-2 rounded bg-slate-50 flex flex-col items-center">
                                                    <p className="text-[8px] font-bold text-center text-slate-500 mb-1 truncate max-w-full">{selectedDutyReport.pic2Desc}</p>
                                                    <img src={getDirectDriveUrl(selectedDutyReport.pic2Url)} alt="กิจกรรมเสาธง" className="h-[90px] w-full object-cover rounded" referrerPolicy="no-referrer" />
                                                </div>
                                            ) : (
                                                <div className="h-[110px] border border-dashed border-slate-300 bg-slate-100 flex items-center justify-center text-[9px] text-slate-400 italic rounded">กิจกรรมเสาธง (ไม่ได้ติดตั้ง)</div>
                                            )}

                                            {selectedDutyReport.pic3Url ? (
                                                <div className="border border-slate-200 p-2 rounded bg-slate-50 flex flex-col items-center">
                                                    <p className="text-[8px] font-bold text-center text-slate-500 mb-1 truncate max-w-full">{selectedDutyReport.pic3Desc}</p>
                                                    <img src={getDirectDriveUrl(selectedDutyReport.pic3Url)} alt="ภาพอาหาร" className="h-[90px] w-full object-cover rounded" referrerPolicy="no-referrer" />
                                                </div>
                                            ) : (
                                                <div className="h-[110px] border border-dashed border-slate-300 bg-slate-100 flex items-center justify-center text-[9px] text-slate-400 italic rounded">อาหารกลางวัน (ไม่ได้ติดตั้ง)</div>
                                            )}

                                            {selectedDutyReport.pic4Url ? (
                                                <div className="border border-slate-200 p-2 rounded bg-slate-50 flex flex-col items-center">
                                                    <p className="text-[8px] font-bold text-center text-slate-500 mb-1 truncate max-w-full">{selectedDutyReport.pic4Desc}</p>
                                                    <img src={getDirectDriveUrl(selectedDutyReport.pic4Url)} alt="ภาพเดินทางกลับ" className="h-[90px] w-full object-cover rounded" referrerPolicy="no-referrer" />
                                                </div>
                                            ) : (
                                                <div className="h-[110px] border border-dashed border-slate-300 bg-slate-100 flex items-center justify-center text-[9px] text-slate-400 italic rounded">ตรวจส่งเด็กกลับบ้าน (ไม่ได้ติดตั้ง)</div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Sign block screen simulation */}
                                    <div className="pt-4 mt-6 text-[10px]">
                                        <p className="font-extrabold mb-10 text-center">จึงเรียนมาเพื่อโปรดทราบและพิจารณา</p>
                                        
                                        <div className="grid grid-cols-2 gap-4 text-center mt-4">
                                            <div className="flex flex-col items-center">
                                                <p className="mb-8 font-black">ลงชื่อครูเวรประจำวัน</p>
                                                <p className="mb-1 text-slate-400">ลงชื่อ............................................................</p>
                                                <p className="font-extrabold text-black">( {selectedDutyReport.teacherName} )</p>
                                                <p className="text-[8px] text-slate-500">ครูเวรประจำวัน</p>
                                            </div>
                                            <div className="flex flex-col items-center">
                                                <p className="mb-8 font-black">รับทราบ</p>
                                                <p className="mb-1 text-slate-400">ลงชื่อ............................................................</p>
                                                <p className="font-extrabold text-black">( {directorName || 'ผู้อำนวยการโรงเรียน'} )</p>
                                                <p className="text-[8px] text-slate-500">ผู้อำนวยการโรงเรียน{(schoolConfig?.school_name || '').replace(/^โรงเรียน/, '') || '................................'}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Print Area - EXCELLENT PERFECT A4 FORMAT VISIBLE ONLY WHEN window.print() RUNS */}
            {selectedDutyReport && (
                <div id="print-content-area" className="print-only-area">
                    {/* PAGE 1: Garuda, Administrative details, Section 1 table and Section 2 descriptions */}
                    <div className="print-page-layout">
                        <div>
                            {/* Garuda Image */}
                            <div className="flex justify-start mb-2">
                                <img 
                                    src={schoolConfig?.official_garuda_base_64 ? (schoolConfig.official_garuda_base_64.startsWith('data:') ? schoolConfig.official_garuda_base_64 : `data:image/png;base64,${schoolConfig.official_garuda_base_64}`) : "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Garuda_Emb_of_Thailand.svg/1200px-Garuda_Emb_of_Thailand.svg.png"} 
                                    alt="Garuda" 
                                    className="h-16 w-auto object-contain"
                                    referrerPolicy="no-referrer"
                                />
                            </div>
                            
                            <div className="text-center mb-6">
                                <h1 className="text-lg font-extrabold tracking-tight text-center text-black font-sarabun" style={{ fontSize: '20px', fontWeight: 'bold' }}>บันทึกข้อความ</h1>
                            </div>

                            {/* Header details section */}
                            <div className="space-y-2 mb-6 border-b-2 border-double border-black pb-3 text-[11px] font-sarabun text-black" style={{ fontSize: '15px' }}>
                                <div className="flex items-end">
                                    <span className="font-bold w-24 shrink-0">ส่วนราชการ</span>
                                    <span className="border-b border-dotted border-black flex-1 pl-2 pb-0.5">
                                        {schoolConfig?.school_name || 'โรงเรียน................................................'}
                                    </span>
                                </div>
                                <div className="flex">
                                    <div className="w-1/2 flex items-end">
                                        <span className="font-bold w-12 shrink-0">ที่</span>
                                        <span className="border-b border-dotted border-black flex-1 pl-2 pb-0.5 font-bold">
                                            {getDutyReportNumberText(selectedDutyReport.date, selectedDutyReport.id)}
                                        </span>
                                    </div>
                                    <div className="w-1/2 flex items-end">
                                        <span className="font-bold shrink-0 pl-3 w-16 text-right">วันที่</span>
                                        <span className="border-b border-dotted border-black flex-1 text-center font-bold pb-0.5">
                                            {formatToThaiDate(selectedDutyReport.date)}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-end">
                                    <span className="font-bold w-12 shrink-0">เรื่อง</span>
                                    <span className="border-b border-dotted border-black flex-1 pl-2 pb-0.5 font-bold">
                                        รายงานสรุปผลการปฏิบัติหน้าที่ครูเวรประจำวันที่ {formatToThaiDate(selectedDutyReport.date)}
                                    </span>
                                </div>
                            </div>

                            {/* Content area */}
                            <div className="text-black font-sarabun" style={{ fontSize: '15px', lineHeight: '1.6' }}>
                                <p className="font-bold mb-4">เรียน ผู้อำนวยการโรงเรียน{(schoolConfig?.school_name || '').replace(/^โรงเรียน/, '') || '................................................'}</p>
                                
                                <p className="indent-12 text-justify mb-4">
                                    ตามที่ ข้าพเจ้า <span className="font-bold text-black">{selectedDutyReport.teacherName}</span> ตำแหน่ง <span className="font-bold text-black">{selectedDutyReport.teacherPosition || 'ครู'}</span> ได้รับมอบหมายให้ปฏิบัติหน้าที่ครูเวรดูแลความปลอดภัยประจำวันที่ <span className="font-bold text-black">{formatToThaiDate(selectedDutyReport.date)}</span> นั้น บัดนี้การปฏิบัติหน้าที่ดังกล่าวเสร็จสิ้นเรียบร้อยแล้ว จึงขอรายงานผลปฏิบัติงานแยกตามหัวข้อต่อไปนี้หลักเกณฑ์
                                </p>

                                <p className="font-bold mt-5 mb-2.5">๑. ข้อมูลนักเรียนที่มาเรียนทั้งหมดแยกตามรายประเภทเข้าเรียน:</p>
                                
                                <div className="w-full mb-6">
                                    <table className="w-full border-collapse border border-black text-center text-[12px] text-black font-sarabun" style={{ width: '100%', fontSize: '13px' }}>
                                        <thead>
                                            <tr className="bg-slate-100 font-bold border-b border-black">
                                                <th className="border border-black p-2 bg-slate-50" style={{ borderWidth: '1px', borderColor: '#000' }}>จำนวนนักเรียนทั้งหมดกี่คน</th>
                                                <th className="border border-black p-2" style={{ borderWidth: '1px', borderColor: '#000' }}>มาเรียน (คน)</th>
                                                <th className="border border-black p-2" style={{ borderWidth: '1px', borderColor: '#000' }}>เข้าเรียนสาย (คน)</th>
                                                <th className="border border-black p-2" style={{ borderWidth: '1px', borderColor: '#000' }}>ลาป่วย (คน)</th>
                                                <th className="border border-black p-2" style={{ borderWidth: '1px', borderColor: '#000' }}>ขาดเรียน (คน)</th>
                                                <th className="border border-black p-2" style={{ borderWidth: '1px', borderColor: '#000' }}>คิดเป็นอัตราส่วนร้อยละ</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr className="font-bold" style={{ height: '30px' }}>
                                                <td className="border border-black p-2" style={{ borderWidth: '1px', borderColor: '#000' }}>{activeDutyStats?.total || 0}</td>
                                                <td className="border border-black p-2 text-emerald-800" style={{ borderWidth: '1px', borderColor: '#000' }}>{activeDutyStats?.present || 0}</td>
                                                <td className="border border-black p-2 text-amber-700" style={{ borderWidth: '1px', borderColor: '#000' }}>{activeDutyStats?.late || 0}</td>
                                                <td className="border border-black p-2 text-blue-800" style={{ borderWidth: '1px', borderColor: '#000' }}>{activeDutyStats?.sick || 0}</td>
                                                <td className="border border-black p-2 text-rose-800" style={{ borderWidth: '1px', borderColor: '#000' }}>{activeDutyStats?.absent || 0}</td>
                                                <td className="border border-black p-2 text-indigo-805 text-indigo-700" style={{ borderWidth: '1px', borderColor: '#000' }}>
                                                    {activeDutyStats?.total > 0 
                                                        ? ((activeDutyStats.present / activeDutyStats.total) * 100).toFixed(2) 
                                                        : '0.00'
                                                    }%
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>

                                <p className="font-bold mt-5 mb-2">๒. คำอธิบายรายละเอียดความเรียบร้อยระดับปฏิบัติงาน:</p>
                                <div className="space-y-3.5 pl-4 leading-relaxed" style={{ textIndent: '1cm' }}>
                                    <p className="text-justify-all" style={{ textIndent: '1cm' }}>
                                        <span className="font-bold underline text-black">กิจกรรมเวรช่วงเช้า:</span> {selectedDutyReport.morningReport || 'ปฏิบัติหน้าที่คอยต้อนรับนักเรียนและตรวจระเบียบวินัยก่อนเดินทางเข้าแถวในช่วงเช้าตามปกติด้วยความเรียบร้อยและปลอดภัย อบรมแกนนำจิตอาสาคอยอำนวยความสะดวกการจราจรร่วมกับชุมชน'}
                                    </p>
                                    <p className="text-justify-all animate-none" style={{ textIndent: '1cm' }}>
                                        <span className="font-bold underline text-black">กิจกรรมเวรช่วงกลางวันและเย็น:</span> {selectedDutyReport.afternoonReport || 'ดูแลความเรียบร้อยของนักเรียนโรงอาหารระหว่างเวลารับประทานอาหารกลางวัน ช่วยส่งนักเรียนกลับบ้านและรักษาความปลอดภัยสถานที่ราชการก่อนปิดบริการโรงเรียน'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* PAGE 2: Section 3 Photos and sign-offs block with exact spacing */}
                    <div className="print-page-layout">
                        <div>
                            <p className="font-extrabold mb-4 font-sarabun text-black" style={{ fontSize: '15px' }}>๓. รูปภาพหลักฐานภาพถ่ายรายงานปฏิบัติการตรวจเวร:</p>
                            
                            <div className="grid grid-cols-2 gap-x-6 gap-y-4 mb-4 font-sarabun text-black">
                                {selectedDutyReport.pic1Url ? (
                                    <div className="border border-black p-2 rounded bg-white flex flex-col items-center">
                                        <p className="text-[11px] font-bold text-center text-black mb-1.5 line-clamp-1 h-4">{selectedDutyReport.pic1Desc}</p>
                                        <img src={getDirectDriveUrl(selectedDutyReport.pic1Url)} alt="ภาพช่วงเช้า" className="h-[105px] w-full object-cover rounded border border-slate-300" referrerPolicy="no-referrer" />
                                    </div>
                                ) : (
                                    <div className="h-[120px] border border-dashed border-black/80 bg-slate-50 flex items-center justify-center text-[11px] text-slate-500 italic rounded text-center">ช่วงเช้าหน้าโรงเรียน (เว้นว่างรูปแนบ)</div>
                                )}

                                {selectedDutyReport.pic2Url ? (
                                    <div className="border border-black p-2 rounded bg-white flex flex-col items-center">
                                        <p className="text-[11px] font-bold text-center text-black mb-1.5 line-clamp-1 h-4">{selectedDutyReport.pic2Desc}</p>
                                        <img src={getDirectDriveUrl(selectedDutyReport.pic2Url)} alt="กิจกรรมเสาธง" className="h-[105px] w-full object-cover rounded border border-slate-300" referrerPolicy="no-referrer" />
                                    </div>
                                ) : (
                                    <div className="h-[120px] border border-dashed border-black/80 bg-slate-50 flex items-center justify-center text-[11px] text-slate-500 italic rounded text-center">กิจกรรมเสาธง (เว้นว่างรูปแนบ)</div>
                                )}

                                {selectedDutyReport.pic3Url ? (
                                    <div className="border border-black p-2 rounded bg-white flex flex-col items-center">
                                        <p className="text-[11px] font-bold text-center text-black mb-1.5 line-clamp-1 h-4">{selectedDutyReport.pic3Desc}</p>
                                        <img src={getDirectDriveUrl(selectedDutyReport.pic3Url)} alt="ภาพอาหาร" className="h-[105px] w-full object-cover rounded border border-slate-300" referrerPolicy="no-referrer" />
                                    </div>
                                ) : (
                                    <div className="h-[120px] border border-dashed border-black/80 bg-slate-50 flex items-center justify-center text-[11px] text-slate-500 italic rounded text-center">ดูแลอาหารกลางวัน (เว้นว่างรูปแนบ)</div>
                                )}

                                {selectedDutyReport.pic4Url ? (
                                    <div className="border border-black p-2 rounded bg-white flex flex-col items-center">
                                        <p className="text-[11px] font-bold text-center text-black mb-1.5 line-clamp-1 h-4">{selectedDutyReport.pic4Desc}</p>
                                        <img src={getDirectDriveUrl(selectedDutyReport.pic4Url)} alt="ภาพเดินทางกลับ" className="h-[105px] w-full object-cover rounded border border-slate-300" referrerPolicy="no-referrer" />
                                    </div>
                                ) : (
                                    <div className="h-[120px] border border-dashed border-black/80 bg-slate-50 flex items-center justify-center text-[11px] text-slate-500 italic rounded text-center">ตอนเดินทางกลับเย็น (เว้นว่างรูปแนบ)</div>
                                )}
                            </div>

                            <p className="font-extrabold text-[15px] font-sarabun text-black text-center mt-6 mb-6">จึงเรียนมาเพื่อโปรดทราบและพิจารณา</p>
                        </div>

                        {/* Sign-offs layout exactly A4 fitted at footer */}
                        <div className="grid grid-cols-2 gap-12 text-center text-[14px] font-sarabun text-black mt-auto pb-4" style={{ fontSize: '15px' }}>
                            <div className="flex flex-col items-center justify-end">
                                <p className="mb-14 font-bold text-black" style={{ marginBottom: '55px' }}>ลงชื่อครูเวรประจำวัน</p>
                                <p className="mb-1 font-medium text-black">ลงชื่อ............................................................ผู้รายงาน</p>
                                <p className="font-bold text-black">( {selectedDutyReport.teacherName} )</p>
                                <p className="text-[12px] text-slate-650" style={{ fontSize: '13px' }}>ครูเวรประจำวัน</p>
                            </div>
                            <div className="flex flex-col items-center justify-end">
                                <p className="mb-14 font-bold text-black" style={{ marginBottom: '55px' }}>รับทราบ</p>
                                <p className="mb-1 font-medium text-black">ลงชื่อ............................................................ผู้อนุมัติ</p>
                                <p className="font-bold text-black">( {directorName || 'ผู้อำนวยการโรงเรียน'} )</p>
                                <p className="text-[12px] text-slate-650" style={{ fontSize: '13px' }}>ผู้อำนวยการโรงเรียน{(schoolConfig?.school_name || '').replace(/^โรงเรียน/, '') || '................................'}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
