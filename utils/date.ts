
export const getTodayDateStr = () => {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
};

export const getThaiDate = (dateStr: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('th-TH', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        timeZone: 'Asia/Bangkok'
    });
};

export const getThaiMonthYear = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('th-TH', { 
        month: 'long', 
        year: 'numeric',
        timeZone: 'Asia/Bangkok'
    });
};

export const getThailandTime = () => {
    return new Date().toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Bangkok'
    });
};
