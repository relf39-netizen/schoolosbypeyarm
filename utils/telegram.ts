
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
