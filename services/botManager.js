const https = require('https');
const db = require('./db');

class BotManager {
  constructor() {
    this.logs = [];
  }

  log(platform, action, status, details) {
    const entry = {
      timestamp: new Date().toLocaleTimeString('fa-IR'),
      platform,
      action,
      status,
      details
    };
    this.logs.unshift(entry);
    if (this.logs.length > 50) this.logs.pop();
    console.log(`[BOT-${platform.toUpperCase()}] ${action}: ${status} | ${JSON.stringify(details)}`);
  }

  getLogs() {
    return this.logs;
  }

  // 1. BALE BOT INTEGRATION (Official Bale Bot API)
  async sendBaleMessage(chatId, text, options = {}) {
    const config = db.get('botConfig')?.bale;
    if (!config || !config.enabled) {
      this.log('bale', 'sendMessage', 'SKIPPED', { reason: 'Bot disabled or not configured' });
      return { success: false, reason: 'Disabled' };
    }

    const payload = {
      chat_id: chatId || 'default_bale_group',
      text: text,
      reply_markup: options.reply_markup || {
        inline_keyboard: [
          [
            { text: '✅ دیدم و آماده می‌شوم', callback_data: `ack_alarm_${chatId}` }
          ]
        ]
      }
    };

    // If real token exists, send HTTPS request to tapi.bale.ai
    if (config.token && !config.token.includes('SAMPLE')) {
      try {
        await this._postHttps('tapi.bale.ai', `/bot${config.token}/sendMessage`, payload);
        this.log('bale', 'sendMessage', 'SENT', { chatId, textPreview: text.substring(0, 30) });
        return { success: true, live: true };
      } catch (err) {
        this.log('bale', 'sendMessage', 'ERROR', { error: err.message });
      }
    }

    // Simulation / local mode
    this.log('bale', 'sendMessage', 'SIMULATED', { chatId, payload });
    return { success: true, simulated: true };
  }

  // 2. EITAA BOT INTEGRATION (Eitaayar API)
  async sendEitaaMessage(chatId, text) {
    const config = db.get('botConfig')?.eitaa;
    if (!config || !config.enabled) {
      this.log('eitaa', 'sendMessage', 'SKIPPED', { reason: 'Bot disabled' });
      return { success: false, reason: 'Disabled' };
    }

    const payload = {
      chat_id: chatId || config.channelId,
      text: text,
      date: Math.floor(Date.now() / 1000)
    };

    if (config.token && !config.token.includes('SAMPLE')) {
      try {
        await this._postHttps('eitaayar.ir', `/api/${config.token}/sendMessage`, payload);
        this.log('eitaa', 'sendMessage', 'SENT', { chatId });
        return { success: true, live: true };
      } catch (err) {
        this.log('eitaa', 'sendMessage', 'ERROR', { error: err.message });
      }
    }

    this.log('eitaa', 'sendMessage', 'SIMULATED', { payload });
    return { success: true, simulated: true };
  }

  // 3. TELEGRAM BOT INTEGRATION
  async sendTelegramMessage(chatId, text, options = {}) {
    const config = db.get('botConfig')?.telegram;
    if (!config || !config.enabled) {
      this.log('telegram', 'sendMessage', 'SKIPPED', { reason: 'Bot disabled' });
      return { success: false, reason: 'Disabled' };
    }

    const payload = {
      chat_id: chatId || '12345678',
      text: text,
      parse_mode: 'HTML',
      reply_markup: options.reply_markup || {
        inline_keyboard: [
          [
            { text: '✅ تایید حضور و مشاهده پیام', callback_data: 'ack_alarm' }
          ]
        ]
      }
    };

    if (config.token && !config.token.includes('SAMPLE')) {
      try {
        await this._postHttps('api.telegram.org', `/bot${config.token}/sendMessage`, payload);
        this.log('telegram', 'sendMessage', 'SENT', { chatId });
        return { success: true, live: true };
      } catch (err) {
        this.log('telegram', 'sendMessage', 'ERROR', { error: err.message });
      }
    }

    this.log('telegram', 'sendMessage', 'SIMULATED', { payload });
    return { success: true, simulated: true };
  }

  // 4. WHATSAPP WEBHOOK / CLOUD API
  async sendWhatsAppMessage(phone, text) {
    const config = db.get('botConfig')?.whatsapp;
    if (!config || !config.enabled) {
      this.log('whatsapp', 'sendMessage', 'SKIPPED', { reason: 'WhatsApp disabled' });
      return { success: false };
    }

    const payload = {
      to: phone,
      type: 'text',
      text: { body: text }
    };

    this.log('whatsapp', 'sendMessage', 'SIMULATED', { phone, payload });
    return { success: true, simulated: true };
  }

  // BROADCAST TO ALL CHANNELS
  async broadcastShiftReminder(userName, shiftTime, storeName, phone) {
    const message = `🌱 سلام ${userName} جان!\n⏰ ساعت کارآموزی شما در «${storeName}» دقیقاً یک ساعت دیگر (ساعت ${shiftTime}) شروع می‌شود.\nلطفاً آماده رفتن به محل کارآموزی باش.\n\nجهت ثبت امتیاز خوش‌قولی، روی دکمه زیر کلیک کن 👇`;

    const results = await Promise.allSettled([
      this.sendBaleMessage(phone, message),
      this.sendEitaaMessage(phone, message),
      this.sendTelegramMessage(phone, message),
      this.sendWhatsAppMessage(phone, message)
    ]);

    return {
      success: true,
      broadcastResults: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason })
    };
  }

  // WEBHOOK HANDLER FOR INCOMING BOT RESPONSES
  handleIncomingWebhook(platform, body) {
    this.log(platform, 'webhookReceived', 'RECEIVED', body);

    // Case 1: Callback query for acknowledging alarm (e.g., from Bale or Telegram)
    if (body.callback_query) {
      const data = body.callback_query.data;
      const fromUser = body.callback_query.from;
      if (data && data.startsWith('ack_alarm')) {
        // Find matching user and acknowledge
        db.acknowledgeAlarm('u1'); // default to Shahab or user in context
        return { handled: true, action: 'alarm_acknowledged', user: fromUser };
      }
    }

    // Case 2: Inbound message from teen or store owner
    if (body.message && body.message.text) {
      const text = body.message.text;
      const senderName = body.message.from ? `${body.message.from.first_name || ''} ${body.message.from.last_name || ''}`.trim() : 'پیام‌رسان';

      // Route message into chat system
      const newMsg = db.addMessage({
        from: 'bot_bridge',
        fromName: `${senderName} (از طریق ${platform})`,
        to: 'coach',
        text: text
      });

      return { handled: true, action: 'chat_forwarded', message: newMsg };
    }

    return { handled: true, status: 'ok' };
  }

  // Internal HTTPS Request Helper
  _postHttps(hostname, endpoint, data) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(data);
      const req = https.request({
        hostname: hostname,
        port: 443,
        path: endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 6000
      }, res => {
        let resData = '';
        res.on('data', chunk => { resData += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(resData);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${resData}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout to bot endpoint'));
      });
      req.write(payload);
      req.end();
    });
  }
}

module.exports = new BotManager();
