export const sendTelegramMessage = async (chatId: string, message: string): Promise<void> => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      console.warn(`[TelegramService] Missing TELEGRAM_BOT_TOKEN. Skipping message to ${chatId}`);
      return;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Telegram API responded with ${response.status}: ${errorText}`);
    }

    console.log(`[TelegramService] Message sent successfully to ${chatId}`);
  } catch (error: any) {
    console.error(`[TelegramService] Failed to send message to ${chatId}:`, error.message);
  }
};
