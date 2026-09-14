// Utility for sending LINE Business (Official Account) Notifications via Messaging API

export interface SendLineMessageOptions {
    channelAccessToken?: string;
    targetId?: string;
    message: string;
    title?: string;
    deepLinkUrl?: string;
    type?: 'leave' | 'calendar' | 'general';
}

/**
 * Sends a notification via LINE Official Account (Messaging API).
 * Proxies request through the server to avoid browser CORS restrictions.
 */
export const sendLineMessage = async ({
    channelAccessToken,
    targetId,
    message,
    title,
    deepLinkUrl,
    type = 'general'
}: SendLineMessageOptions): Promise<{ success: boolean; message?: string }> => {
    if (!channelAccessToken || !targetId) {
        console.warn("LINE Channel Access Token or Target ID is missing. Notification skipped.");
        return { success: false, message: "Token หรือ Target ID ไม่ครบถ้วน" };
    }

    try {
        const response = await fetch('/api/line/send-message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                channelAccessToken: channelAccessToken.trim(),
                targetId: targetId.trim(),
                message,
                title,
                deepLinkUrl,
                type
            })
        });

        const data = await response.json();
        if (response.ok && data.success) {
            console.log("LINE notification sent successfully to:", targetId);
            return { success: true };
        } else {
            console.error("LINE Messaging API error:", data);
            return { success: false, message: data.message || "ส่งข้อความ LINE ไม่สำเร็จ" };
        }
    } catch (error: any) {
        console.error("Failed to send LINE message fetch error:", error);
        return { success: false, message: error.message || "เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์" };
    }
};

/**
 * Tests the LINE Official Account connection by sending a test push message
 */
export const testLineConnection = async (channelAccessToken: string, targetId: string): Promise<{ success: boolean; message: string }> => {
    if (!channelAccessToken || !targetId) {
        return { success: false, message: "กรุณาระบุทั้ง Channel Access Token และ Target ID" };
    }

    try {
        const response = await fetch('/api/line/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                channelAccessToken: channelAccessToken.trim(),
                targetId: targetId.trim()
            })
        });

        const data = await response.json();
        if (response.ok && data.success) {
            return { success: true, message: "ส่งข้อความทดสอบเข้า LINE สำเร็จแล้ว!" };
        } else {
            return { success: false, message: data.message || "ส่งข้อความทดสอบล้มเหลว กรุณาตรวจสอบ Token และ Target ID" };
        }
    } catch (error: any) {
        return { success: false, message: "เกิดข้อผิดพลาดในการเชื่อมต่อ: " + error.message };
    }
};
