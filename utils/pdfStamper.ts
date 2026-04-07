
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

// --- Global Font Constants ---
const GLOBAL_FONT_REGULAR_URL = "https://drive.google.com/uc?export=download&id=1XmO0F-mR3Z_S7i-0j7l6Z0f8o7yB6Z0W"; 
const GLOBAL_FONT_BOLD_URL = "https://drive.google.com/uc?export=download&id=1S8X-rL0v_G7B8m0O0p7P6k0Z8o7m6L0Z";

const THAI_FONT_SOURCES = [
    "https://script-app.github.io/font/THSarabunNew.ttf",
    "https://cdn.jsdelivr.net/gh/googlefonts/sarabun@master/fonts/Sarabun-Regular.ttf",
    "https://raw.githack.com/googlefonts/sarabun/master/fonts/Sarabun-Regular.ttf",
    "https://github.com/googlefonts/sarabun/raw/master/fonts/Sarabun-Regular.ttf",
    "https://fonts.gstatic.com/s/sarabun/v12/dt80E6GCcm61WObS-2VvILfN.ttf"
];

const THAI_FONT_BOLD_SOURCES = [
    "https://cdn.jsdelivr.net/gh/googlefonts/sarabun@master/fonts/Sarabun-Bold.ttf",
    "https://raw.githack.com/googlefonts/sarabun/master/fonts/Sarabun-Bold.ttf",
    "https://github.com/googlefonts/sarabun/raw/master/fonts/Sarabun-Bold.ttf",
    "https://fonts.gstatic.com/s/sarabun/v12/dt8vE6GCcm61WObS-2VvPIdtM_E.ttf"
];

export const toThaiDigits = (num: string | number): string => {
    const thaiDigits = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];
    return num.toString().replace(/\d/g, (d) => thaiDigits[parseInt(d)]);
};

export const dataURItoUint8Array = (dataURI: string) => {
    try {
        if (!dataURI) return new Uint8Array(0);
        const base64 = dataURI.split(',')[1] || dataURI;
        const byteString = atob(base64.replace(/\s/g, ''));
        const ia = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
        return ia;
    } catch (e) {
        console.error("Error converting Base64", e);
        return new Uint8Array(0);
    }
};

const fetchFontFromPublicSources = async (sources: string[]) => {
    for (const url of sources) {
        try {
            const resp = await fetch(url, { method: 'GET', cache: 'force-cache' });
            if (resp.ok) {
                const buffer = await resp.arrayBuffer();
                if (buffer.byteLength > 10000) return buffer;
            }
        } catch (e) {}
    }
    return null;
};

const fetchThaiFont = async (proxyUrl?: string, customBase64?: string) => {
    if (customBase64) return dataURItoUint8Array(customBase64).buffer;
    const fontBuffer = await fetchFontFromPublicSources(THAI_FONT_SOURCES);
    if (fontBuffer) return fontBuffer;
    if (proxyUrl && proxyUrl.trim() !== "") {
        try {
            const resp = await fetch(proxyUrl.trim(), {
                method: 'POST',
                body: JSON.stringify({ action: 'fetchRemote', url: GLOBAL_FONT_REGULAR_URL }),
                redirect: 'follow'
            });
            const responseText = await resp.text();
            if (responseText.trim().startsWith('error:')) {
                throw new Error(responseText.trim().replace('error:', '').trim());
            }

            let result;
            try {
                result = JSON.parse(responseText);
            } catch (e) {
                throw new Error("เซิร์ฟเวอร์ตอบกลับด้วยรูปแบบที่ไม่ถูกต้องระหว่างโหลดฟอนต์: " + responseText.substring(0, 100));
            }
            if (result.status === 'success' && result.fileData) return dataURItoUint8Array(result.fileData).buffer;
        } catch (e) {}
    }
    throw new Error("ระบบไม่สามารถโหลดฟอนต์มาตรฐานได้");
};

const fetchThaiFontBold = async (proxyUrl?: string, customBase64?: string) => {
    if (customBase64) return dataURItoUint8Array(customBase64).buffer;
    const fontBuffer = await fetchFontFromPublicSources(THAI_FONT_BOLD_SOURCES);
    if (fontBuffer) return fontBuffer;
    if (proxyUrl && proxyUrl.trim() !== "") {
        try {
            const resp = await fetch(proxyUrl.trim(), {
                method: 'POST',
                body: JSON.stringify({ action: 'fetchRemote', url: GLOBAL_FONT_REGULAR_URL }),
                redirect: 'follow'
            });
            const responseText = await resp.text();
            if (responseText.trim().startsWith('error:')) {
                throw new Error(responseText.trim().replace('error:', '').trim());
            }

            let result;
            try {
                result = JSON.parse(responseText);
            } catch (e) {
                throw new Error("เซิร์ฟเวอร์ตอบกลับด้วยรูปแบบที่ไม่ถูกต้องระหว่างโหลดฟอนต์ (Bold): " + responseText.substring(0, 100));
            }
            if (result.status === 'success' && result.fileData) return dataURItoUint8Array(result.fileData).buffer;
        } catch (e) {}
    }
    return fetchThaiFont(proxyUrl, customBase64);
};

const splitTextIntoLines = (text: string, maxWidth: number, fontSize: number, font: any) => {
    if (!text) return [];
    const words = text.split(''); 
    const lines = [];
    let currentLine = words[0] || "";

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = font.widthOfTextAtSize(currentLine + word, fontSize);
        if (width < maxWidth) currentLine += word;
        else { lines.push(currentLine); currentLine = word; }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
};

const formatDateThai = (dateValue: Date, useThaiDigits = false) => {
    const months = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
    const result = `${dateValue.getDate()} ${months[dateValue.getMonth()]} พ.ศ. ${dateValue.getFullYear() + 543}`;
    return useThaiDigits ? toThaiDigits(result) : result;
};

const formatDateThaiStr = (dateStr: string, useThaiDigits = false) => {
    if (!dateStr) return "....................";
    return formatDateThai(new Date(dateStr), useThaiDigits);
};

// --- PDF STAMPER FUNCTIONS ---

interface ReceiveStampOptions {
    fileBase64: string; bookNumber: string; date: string; time: string;
    schoolName?: string; schoolLogoBase64?: string; proxyUrl?: string; thaiFontBase64?: string;
}

export const stampReceiveNumber = async (options: ReceiveStampOptions): Promise<string> => {
    const pdfDoc = await PDFDocument.load(dataURItoUint8Array(options.fileBase64));
    pdfDoc.registerFontkit(fontkit as any);
    const thaiFont = await pdfDoc.embedFont(await fetchThaiFont(options.proxyUrl, options.thaiFontBase64));
    const page = pdfDoc.getPages()[0];
    const { width, height } = page.getSize();
    const boxW = 160, boxH = 85, margin = 20;
    const x = width - boxW - margin, y = height - boxH - margin;
    page.drawRectangle({ x, y, width: boxW, height: boxH, color: rgb(1,1,1), borderColor: rgb(0.8, 0.2, 0.2), borderWidth: 1.5 });
    const textX = x + 6;
    let curY = y + boxH - 12;
    page.drawText(options.schoolName || '', { x: textX, y: curY, size: 14, font: thaiFont, color: rgb(0.8, 0.2, 0.2) });
    curY -= 18;
    page.drawText(`เลขรับที่: ${options.bookNumber}`, { x: textX, y: curY, size: 14, font: thaiFont, color: rgb(0.8, 0.2, 0.2) });
    curY -= 18;
    page.drawText(`วันที่: ${options.date}`, { x: textX, y: curY, size: 14, font: thaiFont, color: rgb(0.8, 0.2, 0.2) });
    curY -= 18;
    page.drawText(`เวลา: ${options.time}`, { x: textX, y: curY, size: 14, font: thaiFont, color: rgb(0.8, 0.2, 0.2) });
    return await pdfDoc.saveAsBase64({ dataUri: true });
};

interface CommandMemoOptions {
    schoolName: string; bookNumber: string; title: string; from: string; details: string; command: string;
    directorName: string; directorPosition: string; signatureBase64?: string; officialGarudaBase64?: string;
    signatureScale?: number; signatureYOffset?: number; proxyUrl?: string;
    thaiFontBase64?: string; thaiFontBoldBase64?: string;
    targetTeacherNames?: string[]; 
}

export const generateDirectorCommandMemoPdf = async (opt: CommandMemoOptions): Promise<string> => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit as any);
    const thaiFont = await pdfDoc.embedFont(await fetchThaiFont(opt.proxyUrl, opt.thaiFontBase64));
    const thaiFontBold = await pdfDoc.embedFont(await fetchThaiFontBold(opt.proxyUrl, opt.thaiFontBoldBase64));

    const page = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();
    const marginX = 50;
    const labelSize = 18, textSize = 16;
    const cmToPoints = 28.35;
    
    const indentPointsNormal = 2.5 * cmToPoints; 
    const indentPointsSpecial = 3.5 * cmToPoints; 

    let curY = height - 50;

    const titleY = curY - 50;
    const memoTitle = "บันทึกข้อความ";
    const memoTitleW = thaiFontBold.widthOfTextAtSize(memoTitle, 28);
    
    if (opt.officialGarudaBase64) {
        try {
            const garudaBytes = dataURItoUint8Array(opt.officialGarudaBase64);
            let garuda;
            try { garuda = await pdfDoc.embedPng(garudaBytes); } 
            catch { garuda = await pdfDoc.embedJpg(garudaBytes); }
            
            const gDim = garuda.scaleToFit(60, 60);
            page.drawImage(garuda, { x: marginX, y: titleY - 10, width: gDim.width, height: gDim.height });
        } catch (e) {}
    }

    page.drawText(memoTitle, { x: (width - memoTitleW) / 2, y: titleY, size: 28, font: thaiFontBold });
    
    curY = titleY - 60;

    page.drawText("ส่วนราชการ", { x: marginX, y: curY, size: labelSize, font: thaiFontBold });
    page.drawText(opt.schoolName, { x: 135, y: curY, size: textSize, font: thaiFont });
    page.drawLine({
        start: { x: 135, y: curY - 2 },
        end: { x: width - marginX, y: curY - 2 },
        thickness: 0.5,
        dashArray: [1, 2]
    });
    curY -= 30;

    page.drawText("ที่", { x: marginX, y: curY, size: labelSize, font: thaiFontBold });
    page.drawText(opt.bookNumber, { x: 75, y: curY, size: textSize, font: thaiFont });
    page.drawLine({
        start: { x: 75, y: curY - 2 },
        end: { x: 280, y: curY - 2 },
        thickness: 0.5,
        dashArray: [1, 2]
    });

    const dateStr = `วันที่  ${formatDateThai(new Date())}`;
    page.drawText(dateStr, { x: 300, y: curY, size: textSize, font: thaiFont });
    page.drawLine({
        start: { x: 340, y: curY - 2 },
        end: { x: width - marginX, y: curY - 2 },
        thickness: 0.5,
        dashArray: [1, 2]
    });
    curY -= 30;

    page.drawText("เรื่อง", { x: marginX, y: curY, size: labelSize, font: thaiFontBold });
    page.drawText(opt.title, { x: 95, y: curY, size: textSize, font: thaiFont });
    page.drawLine({
        start: { x: 95, y: curY - 2 },
        end: { x: width - marginX, y: curY - 2 },
        thickness: 0.5,
        dashArray: [1, 2]
    });
    curY -= 45;

    let recipientText = "เรียน  ข้าราชการครูและบุคลากรทางการศึกษาทุกท่าน";
    if (opt.targetTeacherNames && opt.targetTeacherNames.length > 0) {
        recipientText = `เรียน  ${opt.targetTeacherNames.join(' และ ')}`;
    }
    page.drawText(recipientText, { x: marginX, y: curY, size: textSize, font: thaiFont });
    curY -= 40;

    const contentWidth = width - (2 * marginX);
    
    const p1 = `ตามที่หนังสือราชการจาก ${opt.from} ได้แจ้งเรื่อง ${opt.title} เพื่อพิจารณาดำเนินการนั้น ${opt.details || ''}`;
    const p2 = opt.command || 'จึงแจ้งเวียนเพื่อทราบและดำเนินการตามระเบียบต่อไป';
    const p3 = "จึงแจ้งมาเพื่อทราบและดำเนินการ";

    const paragraphs = [
        { text: p1, indent: indentPointsNormal },
        { text: p2, indent: indentPointsNormal },
        { text: p3, indent: indentPointsSpecial }
    ];
    
    paragraphs.forEach((pObj) => {
        if (!pObj.text) return;
        const words = pObj.text.split('');
        let line = "";
        let isFirstLine = true;

        for (let i = 0; i < words.length; i++) {
            const char = words[i];
            const currentIndent = isFirstLine ? pObj.indent : 0;
            const maxWidth = contentWidth - currentIndent;
            const currentWidth = thaiFont.widthOfTextAtSize(line + char, textSize);

            if (currentWidth < maxWidth) {
                line += char;
            } else {
                page.drawText(line, { x: marginX + currentIndent, y: curY, size: textSize, font: thaiFont });
                curY -= 22;
                line = char;
                isFirstLine = false;
            }
        }
        if (line) {
            const lastLineIndent = isFirstLine ? pObj.indent : 0;
            page.drawText(line, { x: marginX + lastLineIndent, y: curY, size: textSize, font: thaiFont });
            curY -= 22;
        }
        curY -= 10;
    });

    curY -= 40;
    const sigX = 320;
    const linePrefix = "(ลงชื่อ)";
    const lineDots = ".................................................";
    const prefixW = thaiFont.widthOfTextAtSize(linePrefix, textSize);
    const dotsW = thaiFont.widthOfTextAtSize(lineDots, textSize);
    
    if (opt.signatureBase64 && opt.signatureBase64.length > 50) {
        try {
            const sigBytes = dataURItoUint8Array(opt.signatureBase64);
            let sig;
            try { sig = await pdfDoc.embedPng(sigBytes); } 
            catch { sig = await pdfDoc.embedJpg(sigBytes); }
            
            const sDim = sig.scaleToFit(110 * (opt.signatureScale || 1), 50);
            page.drawImage(sig, { 
                x: sigX + prefixW + (dotsW - sDim.width) / 2, 
                y: curY + (opt.signatureYOffset || 0) + 12, 
                width: sDim.width, 
                height: sDim.height 
            });
        } catch (e) {}
    }
    
    page.drawText(`${linePrefix}${lineDots}`, { x: sigX, y: curY, size: textSize, font: thaiFont });
    curY -= 25;
    page.drawText(`(${opt.directorName})`, { x: sigX + 25, y: curY, size: textSize, font: thaiFont });
    curY -= 25;
    page.drawText(`ตำแหน่ง ${opt.directorPosition}`, { x: sigX + 15, y: curY, size: textSize, font: thaiFont });

    return await pdfDoc.saveAsBase64({ dataUri: true });
};

export const generateAcknowledgeMemoPdf = async (opt: any): Promise<string> => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit as any);
    const thaiFont = await pdfDoc.embedFont(await fetchThaiFont(opt.proxyUrl, opt.thaiFontBase64));
    const thaiFontBold = await pdfDoc.embedFont(await fetchThaiFontBold(opt.proxyUrl, opt.thaiFontBoldBase64));

    const page = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();
    const marginX = 50;
    const labelSize = 18, textSize = 16;
    const cmToPoints = 28.35;
    
    const indentPointsNormal = 2.5 * cmToPoints; 

    let curY = height - 50;

    const titleY = curY - 50;
    const memoTitle = "บันทึกข้อความ";
    const memoTitleW = thaiFontBold.widthOfTextAtSize(memoTitle, 28);
    
    if (opt.officialGarudaBase64) {
        try {
            const garudaBytes = dataURItoUint8Array(opt.officialGarudaBase64);
            let garuda;
            try { garuda = await pdfDoc.embedPng(garudaBytes); } 
            catch { garuda = await pdfDoc.embedJpg(garudaBytes); }
            
            const gDim = garuda.scaleToFit(60, 60);
            page.drawImage(garuda, { x: marginX, y: titleY - 10, width: gDim.width, height: gDim.height });
        } catch (e) {}
    }

    page.drawText(memoTitle, { x: (width - memoTitleW) / 2, y: titleY, size: 28, font: thaiFontBold });
    
    curY = titleY - 60;

    page.drawText("ส่วนราชการ", { x: marginX, y: curY, size: labelSize, font: thaiFontBold });
    page.drawText(opt.schoolName, { x: 135, y: curY, size: textSize, font: thaiFont });
    page.drawLine({
        start: { x: 135, y: curY - 2 },
        end: { x: width - marginX, y: curY - 2 },
        thickness: 0.5,
        dashArray: [1, 2]
    });
    curY -= 30;

    page.drawText("ที่", { x: marginX, y: curY, size: labelSize, font: thaiFontBold });
    page.drawText(opt.bookNumber, { x: 75, y: curY, size: textSize, font: thaiFont });
    page.drawLine({
        start: { x: 75, y: curY - 2 },
        end: { x: 280, y: curY - 2 },
        thickness: 0.5,
        dashArray: [1, 2]
    });

    const dateStr = `วันที่  ${formatDateThai(new Date())}`;
    page.drawText(dateStr, { x: 300, y: curY, size: textSize, font: thaiFont });
    page.drawLine({
        start: { x: 340, y: curY - 2 },
        end: { x: width - marginX, y: curY - 2 },
        thickness: 0.5,
        dashArray: [1, 2]
    });
    curY -= 30;

    page.drawText("เรื่อง", { x: marginX, y: curY, size: labelSize, font: thaiFontBold });
    page.drawText(opt.title, { x: 95, y: curY, size: textSize, font: thaiFont });
    page.drawLine({
        start: { x: 95, y: curY - 2 },
        end: { x: width - marginX, y: curY - 2 },
        thickness: 0.5,
        dashArray: [1, 2]
    });
    curY -= 45;

    page.drawText(`เรียน  ผู้อำนวยการโรงเรียน${opt.schoolNameOnly}`, { x: marginX, y: curY, size: textSize, font: thaiFont });
    curY -= 40;

    const contentWidth = width - (2 * marginX);
    
    const p1 = `ตามที่หนังสือราชการจาก ${opt.from} ได้แจ้งเรื่อง ${opt.title} เพื่อพิจารณาดำเนินการนั้น ${opt.details || ''}`;
    const p2 = "จึงเรียนมาเพื่อโปรดพิจารณา";

    const paragraphs = [
        { text: p1, indent: indentPointsNormal },
        { text: p2, indent: indentPointsNormal }
    ];
    
    paragraphs.forEach((pObj) => {
        if (!pObj.text) return;
        const words = pObj.text.split('');
        let line = "";
        let isFirstLine = true;

        for (let i = 0; i < words.length; i++) {
            const char = words[i];
            const currentIndent = isFirstLine ? pObj.indent : 0;
            const maxWidth = contentWidth - currentIndent;
            const currentWidth = thaiFont.widthOfTextAtSize(line + char, textSize);

            if (currentWidth < maxWidth) {
                line += char;
            } else {
                page.drawText(line, { x: marginX + currentIndent, y: curY, size: textSize, font: thaiFont });
                curY -= 22;
                line = char;
                isFirstLine = false;
            }
        }
        if (line) {
            const lastLineIndent = isFirstLine ? pObj.indent : 0;
            page.drawText(line, { x: marginX + lastLineIndent, y: curY, size: textSize, font: thaiFont });
            curY -= 22;
        }
        curY -= 10;
    });

    curY -= 30;
    const sigX = 320;
    
    const linePrefix = "(ลงชื่อ)";
    const lineDots = ".................................................";
    const prefixW = thaiFont.widthOfTextAtSize(linePrefix, textSize);
    const dotsW = thaiFont.widthOfTextAtSize(lineDots, textSize);

    // Officer Signature
    if (opt.officerSignatureBase64 && opt.officerSignatureBase64.length > 50) {
        try {
            const sigBytes = dataURItoUint8Array(opt.officerSignatureBase64);
            let sig;
            try { sig = await pdfDoc.embedPng(sigBytes); } 
            catch { sig = await pdfDoc.embedJpg(sigBytes); }
            
            const sDim = sig.scaleToFit(110, 50);
            page.drawImage(sig, { 
                x: sigX + prefixW + (dotsW - sDim.width) / 2, 
                y: curY + 15, 
                width: sDim.width, 
                height: sDim.height 
            });
        } catch (e) {}
    }
    
    page.drawText(`${linePrefix}${lineDots}`, { x: sigX, y: curY, size: textSize, font: thaiFont });
    curY -= 25;
    page.drawText(`(${opt.officerName})`, { x: sigX + prefixW + (dotsW - thaiFont.widthOfTextAtSize(`(${opt.officerName})`, textSize)) / 2, y: curY, size: textSize, font: thaiFont });
    curY -= 25;
    page.drawText(`ตำแหน่ง เจ้าหน้าที่ธุรการ`, { x: sigX + prefixW + (dotsW - thaiFont.widthOfTextAtSize(`ตำแหน่ง เจ้าหน้าที่ธุรการ`, textSize)) / 2, y: curY, size: textSize, font: thaiFont });

    // Director Acknowledge Section (Right side, below officer)
    curY -= 105; // Increased from 80 to 105 for an extra line gap
    const ackText = "รับทราบ";
    const ackW = thaiFontBold.widthOfTextAtSize(ackText, 20);
    const fullLineW = prefixW + dotsW;
    
    // Center "รับทราบ" relative to the entire signature line (prefix + dots)
    page.drawText(ackText, { 
        x: sigX + (fullLineW - ackW) / 2, 
        y: curY + 60, 
        size: 20, 
        font: thaiFontBold 
    });
    
    if (opt.directorSignatureBase64 && opt.directorSignatureBase64.length > 50) {
        try {
            const sigBytes = dataURItoUint8Array(opt.directorSignatureBase64);
            let sig;
            try { sig = await pdfDoc.embedPng(sigBytes); } 
            catch { sig = await pdfDoc.embedJpg(sigBytes); }
            
            const sDim = sig.scaleToFit(110 * (opt.signatureScale || 1), 50);
            page.drawImage(sig, { 
                x: sigX + prefixW + (dotsW - sDim.width) / 2, 
                y: curY + (opt.signatureYOffset || 0) + 10, 
                width: sDim.width, 
                height: sDim.height 
            });
        } catch (e) {}
    }

    page.drawText(`${linePrefix}${lineDots}`, { x: sigX, y: curY, size: textSize, font: thaiFont });
    curY -= 25;
    const dirNameText = `(${opt.directorName})`;
    page.drawText(dirNameText, { x: sigX + prefixW + (dotsW - thaiFont.widthOfTextAtSize(dirNameText, textSize)) / 2, y: curY, size: textSize, font: thaiFont });
    curY -= 25;
    const dirPosText = `ตำแหน่ง ${opt.directorPosition}`;
    page.drawText(dirPosText, { x: sigX + prefixW + (dotsW - thaiFont.widthOfTextAtSize(dirPosText, textSize)) / 2, y: curY, size: textSize, font: thaiFont });

    return await pdfDoc.saveAsBase64({ dataUri: true });
};

interface LeavePdfOptions {
    req: any;
    stats: any;
    teacher: any;
    schoolName: string;
    directorName: string;
    directorPosition?: string;
    directorSignatureBase64?: string;
    teacherSignatureBase64?: string;
    officialGarudaBase64?: string; 
    directorSignatureScale?: number;
    directorSignatureYOffset?: number;
    proxyUrl?: string;
    thaiFontBase64?: string;
}

export const generateOfficialLeavePdf = async (options: LeavePdfOptions): Promise<string> => {
    const { req, stats, teacher, schoolName, directorName, directorSignatureBase64, teacherSignatureBase64, officialGarudaBase64 } = options;
    
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit as any);
    const thaiFont = await pdfDoc.embedFont(await fetchThaiFont(options.proxyUrl, options.thaiFontBase64));
    const page = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();
    const margin = 50;
    const fontSize = 16;
    const lineHeight = 18;
    const contentWidth = width - (2 * margin);
    const indent = 60;

    let curY = height - margin - 40;

    const drawCentered = (text: string, y: number, size: number = 16) => {
        const textWidth = thaiFont.widthOfTextAtSize(text, size);
        page.drawText(text, { x: (width - textWidth) / 2, y, size, font: thaiFont });
    };

    const drawParagraph = (text: string, startY: number, hasIndent: boolean = true) => {
        let currentY = startY;
        const indentVal = hasIndent ? indent : 0;
        const lines = [];
        const words = text.split('');
        let currentLine = "";

        for (let i = 0; i < words.length; i++) {
            const char = words[i];
            const maxWidth = lines.length === 0 ? contentWidth - indentVal : contentWidth;
            const currentWidth = thaiFont.widthOfTextAtSize(currentLine + char, fontSize);

            if (currentWidth < maxWidth) {
                currentLine += char;
            } else {
                lines.push(currentLine);
                currentLine = char;
            }
        }
        if (currentLine) lines.push(currentLine);

        lines.forEach((l, idx) => {
            page.drawText(l, { x: margin + (idx === 0 ? indentVal : 0), y: currentY, size: fontSize, font: thaiFont });
            currentY -= lineHeight + 4;
        });
        return currentY;
    };

    let formTitle = "แบบใบลาป่วย ลาคลอดบุตร ลากิจส่วนตัว";
    if (req.type === 'Late') formTitle = "แบบขออนุญาตเข้าสาย";
    if (req.type === 'OffCampus') formTitle = "แบบขออนุญาตออกนอกบริเวณโรงเรียน";
    drawCentered(formTitle, curY, 20);
    curY -= 40;

    const writeAt = `เขียนที่ ${schoolName}`;
    const dateStr = `วันที่ ${new Date().getDate()} เดือน ${new Date().toLocaleString('th-TH', { month: 'long' })} พ.ศ. ${new Date().getFullYear() + 543}`;
    
    page.drawText(writeAt, { x: width - margin - 200, y: curY, size: fontSize, font: thaiFont });
    curY -= lineHeight + 5;
    page.drawText(dateStr, { x: width - margin - 200, y: curY, size: fontSize, font: thaiFont });
    curY -= 40;

    const getLeaveTypeName = (type: string) => {
        const map: any = { 'Sick': 'ป่วย', 'Personal': 'กิจส่วนตัว', 'OffCampus': 'ออกนอกบริเวณ', 'Late': 'เข้าสาย', 'Maternity': 'คลอดบุตร' };
        return map[type] || type;
    };
    
    page.drawText(`เรื่อง  ขอลา${getLeaveTypeName(req.type)}`, { x: margin, y: curY, size: fontSize, font: thaiFont });
    curY -= 25;
    page.drawText(`เรียน  ผู้อำนวยการ${schoolName}`, { x: margin, y: curY, size: fontSize, font: thaiFont });
    curY -= 40;

    const bodyText = `ข้าพเจ้า ${teacher.name} ตำแหน่ง ${teacher.position} สังกัด ${schoolName} มีความประสงค์ขอลา${getLeaveTypeName(req.type)} เนื่องจาก ${req.reason} ตั้งแต่วันที่ ${formatDateThaiStr(req.startDate)} ถึงวันที่ ${formatDateThaiStr(req.endDate)} มีกำหนด ${stats.currentDays || 0} วัน ข้าพเจ้าได้ลาครั้งสุดท้ายตั้งแต่วันที่ ${formatDateThaiStr(stats.lastLeave?.startDate)} ถึงวันที่ ${formatDateThaiStr(stats.lastLeave?.endDate)} มีกำหนด ${stats.lastLeaveDays || '-'} วัน ในระหว่างลาติดต่อข้าพเจ้าได้ที่ ${req.contactInfo || '-'} โทร ${req.mobilePhone || '-'}`;
    
    curY = drawParagraph(bodyText, curY, true);
    curY -= 20;

    page.drawText("จึงเรียนมาเพื่อโปรดพิจารณา", { x: margin + indent, y: curY, size: fontSize, font: thaiFont });
    curY -= 60;

    const sigColX = width - 240;
    page.drawText("ขอแสดงความนับถือ", { x: sigColX + 30, y: curY, size: fontSize, font: thaiFont });
    curY -= 45;

    if (teacherSignatureBase64) {
        try {
            const sigBytes = dataURItoUint8Array(teacherSignatureBase64);
            let sigImg;
            if (teacherSignatureBase64.toLowerCase().includes('png')) sigImg = await pdfDoc.embedPng(sigBytes);
            else sigImg = await pdfDoc.embedJpg(sigBytes);
            const sDim = sigImg.scaleToFit(100, 40);
            page.drawImage(sigImg, { x: sigColX + 40, y: curY + 5, width: sDim.width, height: sDim.height });
        } catch (e) {}
    }
    
    page.drawText("(ลงชื่อ)...........................................................", { x: sigColX, y: curY, size: fontSize, font: thaiFont });
    curY -= 22;
    page.drawText(`(${teacher.name})`, { x: sigColX + 40, y: curY, size: fontSize, font: thaiFont });
    curY -= 40;

    const tableTop = curY;
    const colX = [margin, margin + 65, margin + 130, margin + 195];
    const rowH = 25;
    
    page.drawText("สถิติการลาในปีงบประมาณนี้", { x: margin, y: tableTop + 10, size: 14, font: thaiFont });
    
    const drawCell = (text: string, x: number, y: number, w: number) => {
        page.drawRectangle({ x, y: y - rowH, width: w, height: rowH, borderColor: rgb(0,0,0), borderWidth: 0.5 });
        page.drawText(text, { x: x + 5, y: y - rowH + 7, size: 12, font: thaiFont });
    };

    let rowY = tableTop - 10;
    drawCell("ประเภทลา", colX[0], rowY, 65);
    drawCell("ลามาแล้ว", colX[1], rowY, 65);
    drawCell("ลาครั้งนี้", colX[2], rowY, 65);
    drawCell("รวมเป็น", colX[3], rowY, 65);
    
    rowY -= rowH;
    const rowsArr = [
        { n: "ป่วย", p: stats.prevSick, c: req.type === 'Sick' ? stats.currentDays : 0 },
        { n: "กิจส่วนตัว", p: stats.prevPersonal, c: req.type === 'Personal' ? stats.currentDays : 0 },
        { n: "คลอดบุตร", p: stats.prevMaternity, c: req.type === 'Maternity' ? stats.currentDays : 0 }
    ];

    rowsArr.forEach(r => {
        drawCell(r.n, colX[0], rowY, 65);
        drawCell(r.p.toString(), colX[1], rowY, 65);
        drawCell(r.c > 0 ? r.c.toString() : "-", colX[2], rowY, 65);
        drawCell((r.p + r.c).toString(), colX[3], rowY, 65);
        rowY -= rowH;
    });

    const dirX = width / 2 + 20;
    const dirBoxH = 150;
    const dirY = tableTop - dirBoxH - 10;
    
    page.drawRectangle({ x: dirX, y: dirY, width: 230, height: dirBoxH, borderColor: rgb(0,0,0), borderWidth: 0.5 });
    page.drawText("ความเห็น / คำสั่ง", { x: dirX + 70, y: dirY + dirBoxH - 20, size: 14, font: thaiFont });
    
    const isApproved = req.status === 'Approved';
    const isRejected = req.status === 'Rejected';
    page.drawText(isApproved ? "[ / ] อนุญาต" : "[   ] อนุญาต", { x: dirX + 20, y: dirY + dirBoxH - 50, size: 14, font: thaiFont });
    page.drawText(isRejected ? "[ / ] ไม่อนุมัติ" : "[   ] ไม่อนุมัติ", { x: dirX + 20, y: dirY + dirBoxH - 75, size: 14, font: thaiFont });

    if ((isApproved || isRejected) && directorSignatureBase64) {
        try {
            const dSigBytes = dataURItoUint8Array(directorSignatureBase64);
            let dSigImg;
            if (directorSignatureBase64.toLowerCase().includes('png')) dSigImg = await pdfDoc.embedPng(dSigBytes);
            else dSigImg = await pdfDoc.embedJpg(dSigBytes);
            const dDim = dSigImg.scaleToFit(90 * (options.directorSignatureScale || 1), 40);
            page.drawImage(dSigImg, { x: dirX + 70, y: dirY + 40 + (options.directorSignatureYOffset || 0), width: dDim.width, height: dDim.height });
        } catch (e) {}
    }

    page.drawText(`(ลงชื่อ)...........................................................`, { x: dirX + 15, y: dirY + 35, size: 14, font: thaiFont });
    page.drawText(`(${directorName})`, { x: dirX + 60, y: dirY + 15, size: 14, font: thaiFont });
    
    const dPos = options.directorPosition || `ผู้อำนวยการ${schoolName}`;
    const dPosW = thaiFont.widthOfTextAtSize(dPos, 12);
    page.drawText(dPos, { x: dirX + (230 - dPosW) / 2, y: dirY - 2, size: 12, font: thaiFont });

    return await pdfDoc.saveAsBase64({ dataUri: true });
};

export const generateLeaveSummaryPdf = async (opt: any): Promise<string> => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit as any);
    const thaiFont = await pdfDoc.embedFont(await fetchThaiFont(opt.proxyUrl, opt.thaiFontBase64));
    const thaiFontBold = await pdfDoc.embedFont(await fetchThaiFontBold(opt.proxyUrl, opt.thaiFontBoldBase64));

    let page = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();
    const margin = 50;
    const contentWidth = width - (2 * margin);
    const cmToPoints = 28.35;
    const indentPointsNormal = 2.5 * cmToPoints;

    let curY = height - margin;

    // Header: Garuda & บันทึกข้อความ
    if (opt.officialGarudaBase64) {
        try {
            const garuda = await pdfDoc.embedPng(dataURItoUint8Array(opt.officialGarudaBase64));
            const gDim = garuda.scaleToFit(60, 60);
            page.drawImage(garuda, { x: margin, y: curY - 60, width: gDim.width, height: gDim.height });
        } catch (e) {}
    }
    
    const memoTitle = "บันทึกข้อความ";
    const memoTitleW = thaiFontBold.widthOfTextAtSize(memoTitle, 24);
    page.drawText(memoTitle, { x: (width - memoTitleW) / 2, y: curY - 45, size: 24, font: thaiFontBold });
    curY -= 100;

    const labelSize = 16, textSize = 16;
    
    // ส่วนราชการ
    page.drawText("ส่วนราชการ", { x: margin, y: curY, size: labelSize, font: thaiFontBold });
    page.drawText(opt.schoolName, { x: margin + 85, y: curY, size: textSize, font: thaiFont });
    curY -= 25;

    // ที่ & วันที่
    page.drawText("ที่", { x: margin, y: curY, size: labelSize, font: thaiFontBold });
    page.drawText(".................................................................", { x: margin + 25, y: curY, size: textSize, font: thaiFont });
    const dateText = `วันที่  ${formatDateThai(new Date())}`; 
    page.drawText(dateText, { x: 300, y: curY, size: textSize, font: thaiFont });
    curY -= 25;
    
    const startThai = formatDateThaiStr(opt.startDate);
    const endThai = formatDateThaiStr(opt.endDate);
    page.drawText("เรื่อง", { x: margin, y: curY, size: labelSize, font: thaiFontBold });
    page.drawText(`สรุปสถิติการลาของบุคลากร ระหว่างวันที่ ${startThai} ถึงวันที่ ${endThai}`, { x: margin + 45, y: curY, size: textSize, font: thaiFont });
    curY -= 35;

    page.drawText(`เรียน  ผู้อำนวยการ${opt.schoolName}`, { x: margin, y: curY, size: textSize, font: thaiFont });
    curY -= 35;

    // Intro Paragraph
    const intro = `ตามที่ ${opt.schoolName} ได้ดำเนินการรวบรวมข้อมูลสถิติการปฏิบัติราชการและการลาของบุคลากรเพื่อประกอบการพิจารณาเลื่อนเงินเดือนและการประเมินผลการปฏิบัติงานนั้น ในการนี้ จึงขอส่งสรุปสถิติการลาประเภทต่างๆ ประจำปีการศึกษา ดังรายละเอียดตามตารางที่แนบมาพร้อมนี้`;
    
    const introLines = splitTextIntoLines(intro, contentWidth - indentPointsNormal, textSize, thaiFont);
    introLines.forEach((l, idx) => {
        page.drawText(l, { x: margin + (idx === 0 ? indentPointsNormal : 0), y: curY, size: textSize, font: thaiFont });
        curY -= 22;
    });
    curY -= 20;

    // Table
    const colX = [margin, margin + 30, margin + 180, margin + 225, margin + 270, margin + 315, margin + 360, margin + 405];
    const tableHeaders = ["ที่", "ชื่อ-นามสกุล", "ป่วย", "กิจ", "คลอด", "สาย", "นอก", "ลงชื่อรับทราบ"];
    
    const drawTableHeader = (y: number) => {
        page.drawRectangle({ x: margin, y: y - 5, width: contentWidth, height: 25, color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0,0,0), borderWidth: 1 });
        tableHeaders.forEach((h, i) => {
            page.drawText(h, { x: colX[i] + 5, y, size: 12, font: thaiFontBold });
        });
    };

    drawTableHeader(curY);
    curY -= 25;

    opt.teachers.forEach((t: any, idx: number) => {
        if (curY < 150) { 
            page = pdfDoc.addPage([595.28, 841.89]);
            curY = height - margin - 50;
            drawTableHeader(curY);
            curY -= 25;
        }

        const s = opt.getStatsFn(t.id, opt.startDate, opt.endDate);
        const rowData = [
            (idx + 1).toString(),
            t.name,
            s.sick.toString(),
            s.personal.toString(),
            s.maternity.toString(),
            s.late.toString(),
            s.offCampus.toString(),
            ".............................."
        ];

        page.drawRectangle({ x: margin, y: curY - 5, width: contentWidth, height: 25, borderColor: rgb(0,0,0), borderWidth: 0.5 });
        rowData.forEach((d, i) => {
            page.drawText(d, { x: colX[i] + 5, y: curY, size: 11, font: thaiFont });
        });
        curY -= 25;
    });

    curY -= 60;
    if (curY < 150) {
        page = pdfDoc.addPage([595.28, 841.89]);
        curY = height - margin - 100;
    }

    // Signature Area
    const sigX = 320;
    const linePrefix = "(ลงชื่อ)";
    const lineDots = ".................................................";
    const prefixW = thaiFont.widthOfTextAtSize(linePrefix, 14);
    const dotsW = thaiFont.widthOfTextAtSize(lineDots, 14);

    if (opt.directorSignatureBase64) {
        try {
            const dSigBytes = dataURItoUint8Array(opt.directorSignatureBase64);
            let dSigImage;
            try { dSigImage = await pdfDoc.embedPng(dSigBytes); } catch { dSigImage = await pdfDoc.embedJpg(dSigBytes); }
            const dDim = dSigImage.scaleToFit(100 * (opt.directorSignatureScale || 1), 45);
            page.drawImage(dSigImage, { 
                x: sigX + prefixW + (dotsW - dDim.width) / 2, 
                y: curY + (opt.directorSignatureYOffset || 0) + 12, 
                width: dDim.width, 
                height: dDim.height 
            });
        } catch (e) {}
    }
    
    page.drawText(`${linePrefix}${lineDots}`, { x: sigX, y: curY, size: 14, font: thaiFont });
    curY -= 25;
    page.drawText(`(${opt.directorName})`, { x: sigX + 25, y: curY, size: 14, font: thaiFont });
    curY -= 25;
    const dPos = opt.directorPosition || `ผู้อำนวยการ${opt.schoolName}`;
    page.drawText(`ตำแหน่ง ${dPos}`, { x: sigX + 15, y: curY, size: 14, font: thaiFont });

    return await pdfDoc.saveAsBase64({ dataUri: true });
};

export const stampPdfDocument = async (opt: any): Promise<string> => {
    const pdfDoc = await PDFDocument.load(dataURItoUint8Array(opt.fileUrl));
    pdfDoc.registerFontkit(fontkit as any);
    const thaiFont = await pdfDoc.embedFont(await fetchThaiFont(opt.proxyUrl, opt.thaiFontBase64));
    const page = pdfDoc.getPages()[(opt.targetPage || 1) - 1] || pdfDoc.getPages()[0];
    const { width } = page.getSize();
    const boxW = 260, boxX = opt.alignment === 'left' ? 20 : width - boxW - 20;
    page.drawRectangle({ x: boxX, y: 30, width: boxW, height: 180, color: rgb(0.98, 0.98, 1), borderColor: rgb(0,0,0.5), borderWidth: 1 });
    let curY = 190;
    const lines = splitTextIntoLines(opt.commandText, boxW - 20, 14, thaiFont);
    lines.slice(0, 4).forEach(l => { page.drawText(l, { x: boxX + 10, y: curY, size: 14, font: thaiFont }); curY -= 18; });
    const centerX = boxX + boxW/2;
    if (opt.signatureImageBase64) {
        try {
            const sigBytes = dataURItoUint8Array(opt.signatureImageBase64);
            let sig;
            try { sig = await pdfDoc.embedPng(sigBytes); } catch { sig = await pdfDoc.embedJpg(sigBytes); }
            const sDim = sig.scaleToFit(80 * (opt.signatureScale || 1), 40);
            page.drawImage(sig, { x: centerX - sDim.width/2, y: 75 + (opt.signatureYOffset || 0), width: sDim.width, height: sDim.height });
        } catch (e) {}
    }
    page.drawText(`(${opt.directorName})`, { x: centerX - 60, y: 60, size: 14, font: thaiFont });
    page.drawText(formatDateThai(new Date()), { x: centerX - 40, y: 40, size: 14, font: thaiFont });
    return await pdfDoc.saveAsBase64({ dataUri: true });
};

export const stampAcknowledgePdf = async (opt: any): Promise<string> => {
    const pdfDoc = await PDFDocument.load(dataURItoUint8Array(opt.fileBase64));
    pdfDoc.registerFontkit(fontkit as any);
    const thaiFont = await pdfDoc.embedFont(await fetchThaiFont(opt.proxyUrl, opt.thaiFontBase64));
    const thaiFontBold = await pdfDoc.embedFont(await fetchThaiFontBold(opt.proxyUrl, opt.thaiFontBoldBase64));
    
    const page = pdfDoc.getPages()[0]; // Always first page
    const { width, height } = page.getSize();
    
    const boxW = 200;
    const boxX = width - boxW - 50;
    let curY = 150; // Start from bottom right area
    
    // Draw "รับทราบ"
    const ackText = "รับทราบ";
    const ackW = thaiFontBold.widthOfTextAtSize(ackText, 24);
    page.drawText(ackText, { 
        x: boxX + (boxW - ackW) / 2, 
        y: curY + 60, 
        size: 24, 
        font: thaiFontBold,
        color: rgb(0, 0, 0.5)
    });

    const centerX = boxX + boxW / 2;
    
    // Draw Signature
    if (opt.signatureImageBase64) {
        try {
            const sigBytes = dataURItoUint8Array(opt.signatureImageBase64);
            let sig;
            try { sig = await pdfDoc.embedPng(sigBytes); } catch { sig = await pdfDoc.embedJpg(sigBytes); }
            const sDim = sig.scaleToFit(100 * (opt.signatureScale || 1), 50);
            page.drawImage(sig, { 
                x: centerX - sDim.width / 2, 
                y: curY + (opt.signatureYOffset || 0) + 10, 
                width: sDim.width, 
                height: sDim.height 
            });
        } catch (e) {}
    }

    // Draw Name and Date
    const nameText = `(${opt.directorName})`;
    const nameW = thaiFont.widthOfTextAtSize(nameText, 16);
    page.drawText(nameText, { x: centerX - nameW / 2, y: curY - 10, size: 16, font: thaiFont });
    
    const dateText = formatDateThai(new Date());
    const dateW = thaiFont.widthOfTextAtSize(dateText, 14);
    page.drawText(dateText, { x: centerX - dateW / 2, y: curY - 30, size: 14, font: thaiFont });
    
    return await pdfDoc.saveAsBase64({ dataUri: true });
};

export const generateActionPlanPdf = async (opt: any): Promise<string> => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit as any);
    const thaiFont = await pdfDoc.embedFont(await fetchThaiFont(opt.proxyUrl, opt.thaiFontBase64));
    const thaiFontBold = await pdfDoc.embedFont(await fetchThaiFontBold(opt.proxyUrl, opt.thaiFontBoldBase64));

    let page = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();
    const margin = 50;
    const contentWidth = width - (2 * margin);

    let curY = height - margin;

    // Logo / Garuda
    if (opt.officialGarudaBase64) {
        try {
            const garuda = await pdfDoc.embedPng(dataURItoUint8Array(opt.officialGarudaBase64));
            const gDim = garuda.scaleToFit(60, 60);
            page.drawImage(garuda, { x: (width - gDim.width) / 2, y: curY - 60, width: gDim.width, height: gDim.height });
        } catch (e) {}
    }
    curY -= 80;

    const drawCenteredBold = (text: string, y: number, size: number) => {
        const w = thaiFontBold.widthOfTextAtSize(text, size);
        page.drawText(text, { x: (width - w) / 2, y, size, font: thaiFontBold });
    };

    drawCenteredBold("แผนปฏิบัติการประจำปีงบประมาณ พ.ศ. " + opt.fiscalYear, curY, 20);
    curY -= 25;
    drawCenteredBold(opt.schoolName, curY, 18);
    curY -= 40;

    // Summary Box
    page.drawRectangle({ x: margin, y: curY - 60, width: contentWidth, height: 60, color: rgb(0.95, 0.97, 1), borderColor: rgb(0.2, 0.4, 0.8), borderWidth: 1 });
    page.drawText("สรุปงบประมาณรวม:", { x: margin + 15, y: curY - 20, size: 14, font: thaiFontBold, color: rgb(0.1, 0.2, 0.4) });
    page.drawText(`งบประมาณเสนอโครงการรวม: ${opt.stats.totalProposed.toLocaleString()} บาท`, { x: margin + 15, y: curY - 38, size: 12, font: thaiFont });
    page.drawText(`งบประมาณคงเหลือจริง (หลังจัดสรร): ${opt.stats.remainingAfterProposal.toLocaleString()} บาท`, { x: margin + 15, y: curY - 52, size: 12, font: thaiFont });
    curY -= 80;

    // x-coordinates for columns to fit within contentWidth (495.28 pts starting from x=50)
    // colX indices: [ที่, โครงการ, อุดหนุน, กิจกรรม, รวม, จ่ายจริง, สถานะ]
    const colX = [margin, margin + 25, margin + 170, margin + 235, margin + 300, margin + 365, margin + 430];
    const tableHeaders = ["ที่", "โครงการ", "อุดหนุน", "กิจกรรม", "รวม", "จ่ายจริง", "สถานะ"];

    const drawTableHeader = (y: number) => {
        page.drawRectangle({ x: margin, y: y - 5, width: contentWidth, height: 25, color: rgb(0.9, 0.9, 0.9), borderColor: rgb(0,0,0), borderWidth: 1 });
        tableHeaders.forEach((h, i) => {
            page.drawText(h, { x: colX[i] + 3, y, size: 10, font: thaiFontBold });
        });
    };

    opt.departments.forEach((dept: any) => {
        if (curY < 120) {
            page = pdfDoc.addPage([595.28, 841.89]);
            curY = height - margin;
        }

        page.drawText(dept.name, { x: margin, y: curY, size: 14, font: thaiFontBold, color: rgb(0.2, 0.2, 0.6) });
        curY -= 20;

        drawTableHeader(curY);
        curY -= 25;

        dept.projects.forEach((p: any, idx: number) => {
            if (curY < 80) {
                page = pdfDoc.addPage([595.28, 841.89]);
                curY = height - margin;
                drawTableHeader(curY);
                curY -= 25;
            }

            const rowData = [
                (idx + 1).toString(),
                p.name.length > 30 ? p.name.substring(0, 27) + "..." : p.name,
                p.subsidyBudget.toLocaleString(),
                p.learnerDevBudget.toLocaleString(),
                (p.subsidyBudget + p.learnerDevBudget).toLocaleString(),
                p.actualExpense?.toLocaleString() || "0",
                p.status === 'Completed' ? 'ปิดยอด' : (p.status === 'Approved' ? 'อนุมัติ' : 'ร่าง')
            ];

            page.drawRectangle({ x: margin, y: curY - 5, width: contentWidth, height: 25, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });
            rowData.forEach((d, i) => {
                // Align numeric values to the right if they are budgets
                const isNumeric = i >= 2 && i <= 5;
                const textX = isNumeric 
                    ? colX[i] + 60 - thaiFont.widthOfTextAtSize(d, 9) // Approximate right-align in 65pt columns
                    : colX[i] + 3;
                
                page.drawText(d, { x: textX, y: curY, size: 9, font: thaiFont });
            });
            curY -= 25;
        });

        curY -= 15;
    });

    return await pdfDoc.saveAsBase64({ dataUri: true });
};
