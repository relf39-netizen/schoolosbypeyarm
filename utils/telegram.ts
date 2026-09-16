
// Utility for sending Telegram Notifications with rich formatting

interface SendMessagePayload {
    chat_id: string;
    text: string;
    parse_mode?: 'HTML' | 'Markdown';
    disable_web_page_preview?: boolean;
}

/**
 * Sends a formatted message to a Telegram chat.
 * Supports HTML tags like <b>, <i>, <a>, <code>, <pre>
 */
export const sendTelegramMessage = async (botToken: string, chatId: string, message: string, deepLinkUrl?: string) => {
    if (!botToken || !chatId) {
        console.warn("Telegram Bot Token or Chat ID is missing. Notification skipped.");
        return;
    }

    let finalMessage = message;
    
    // Add an action button-like link if provided
    if (deepLinkUrl) {
        finalMessage += `\n\n<b>🔗 ดำเนินการต่อในระบบ:</b>\n<a href="${deepLinkUrl}">คลิกที่นี่เพื่อเปิดแอปและลงชื่อรับทราบ</a>`;
    }

    const payload: SendMessagePayload = {
        chat_id: chatId,
        text: finalMessage,
        parse_mode: 'HTML',
        disable_web_page_preview: false
    };

    try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error("Telegram API returned invalid JSON:", responseText);
            return;
        }
        
        if (!data.ok) {
            console.error("Telegram API Error Response:", data);
        } else {
            console.log("Telegram notification sent successfully to chat:", chatId);
        }
    } catch (error) {
        console.error("Failed to send Telegram message fetch error:", error);
    }
};

/**
 * Tests the Telegram connection by sending a test push message
 */
export const testTelegramConnection = async (botToken: string, chatId: string): Promise<{ success: boolean; message: string }> => {
    if (!botToken || !chatId) {
        return { success: false, message: "กรุณาระบุทั้ง Telegram Bot Token และ Chat ID" };
    }

    try {
        const response = await fetch('/api/telegram/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                botToken: botToken.trim(),
                chatId: chatId.trim()
            })
        });

        const data = await response.json();
        if (response.ok && data.success) {
            return { success: true, message: "ส่งข้อความทดสอบเข้า Telegram สำเร็จแล้ว!" };
        } else {
            return { success: false, message: data.message || "ส่งข้อความทดสอบล้มเหลว กรุณาตรวจสอบ Bot Token และ Chat ID" };
        }
    } catch (error: any) {
        return { success: false, message: error.message || "เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์" };
    }
};

/**
 * Automatically sets the Telegram Webhook
 */
export const autoSetTelegramWebhook = async (botToken: string): Promise<{ success: boolean; message: string }> => {
    if (!botToken) {
        return { success: false, message: "กรุณาระบุ Bot Token" };
    }

    try {
        const response = await fetch('/api/telegram/set-webhook', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                botToken: botToken.trim()
            })
        });

        const data = await response.json();
        return { success: data.success, message: data.message };
    } catch (error: any) {
        return { success: false, message: error.message || "เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์" };
    }
};
