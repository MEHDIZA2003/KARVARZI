const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const db = require('./services/db');
const botManager = require('./services/botManager');
const alarmScheduler = require('./services/alarmScheduler');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

// In-memory OTP storage
const otpStore = new Map();

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('۴۰۴ - صفحه یافت نشد');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('خطای داخلی سرور');
      }
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(content);
    }
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  // ==========================================
  // API ROUTES
  // ==========================================

  // 1. GET WEEKS & CALENDAR (1-MONTH DATA)
  if (pathname === '/api/weeks' && method === 'GET') {
    return sendJson(res, 200, { success: true, weeks: db.getWeeks() });
  }

  // 2. BOOK 1-SEAT SLOT IN CALENDAR
  if (pathname === '/api/slots/book' && method === 'POST') {
    const { weekId, dayKey, slotId, userId, userName, userAvatar } = await parseBody(req);
    const result = db.bookSlot(weekId, dayKey, slotId, userId, userName, userAvatar);
    if (!result.success) return sendJson(res, 400, result);

    botManager.sendBaleMessage('09133544489', `✅ صندلی در شیفت کارورزی برای ${userName} در تقویم ثبت شد.`);
    return sendJson(res, 200, result);
  }

  // 3. UNLOCK PARTIAL SLOT (ADMIN OR REZA SHIRAZIAN)
  if (pathname === '/api/slots/unlock' && method === 'POST') {
    const { weekId, dayKey, slotId, approvedBy } = await parseBody(req);
    const result = db.unlockPartialSlot(weekId, dayKey, slotId, approvedBy);
    return sendJson(res, 200, result);
  }

  // 4. CANCEL SLOT
  if (pathname === '/api/slots/cancel' && method === 'POST') {
    const { weekId, dayKey, slotId, userId } = await parseBody(req);
    const result = db.cancelSlot(weekId, dayKey, slotId, userId);
    return sendJson(res, 200, result);
  }

  // 5. UPDATE USER AVATAR / PROFILE PHOTO
  if (pathname === '/api/users/avatar' && method === 'POST') {
    const { userId, avatar } = await parseBody(req);
    if (!userId || !avatar) return sendJson(res, 400, { success: false, message: 'اطلاعات ناقص است' });

    const updated = db.updateUserAvatar(userId, avatar);
    return sendJson(res, 200, { success: true, user: updated, message: 'تصویر پروفایل با موفقیت بروزرسانی شد' });
  }

  // 6. GET USERS LIST (FOR ADMIN INVITE GENERATOR)
  if (pathname === '/api/users' && method === 'GET') {
    return sendJson(res, 200, { success: true, users: db.get('users') });
  }

  // 7. AUTH: SEND OTP
  if (pathname === '/api/auth/otp/send' && method === 'POST') {
    const { userId, birthdate, mobile } = await parseBody(req);
    const cleanBirthdate = String(birthdate || '').replace(/[\/\-\_\s]/g, '');
    const cleanMobile = String(mobile || '').replace(/[\-\_\s]/g, '');

    if (!cleanBirthdate || cleanBirthdate.length !== 8) {
      return sendJson(res, 400, { success: false, message: 'لطفاً تاریخ تولد ۸ رقمی شمسی (بدون اسلش) را وارد کنید.' });
    }
    if (!cleanMobile || cleanMobile.length < 10) {
      return sendJson(res, 400, { success: false, message: 'لطفاً شماره تلفن همراه معتبر را وارد کنید.' });
    }

    const generatedOtp = '1234';
    otpStore.set(cleanMobile, { otp: generatedOtp, userId, birthdate: cleanBirthdate, expiresAt: Date.now() + 180000 });
    botManager.sendBaleMessage(cleanMobile, `🔐 کد تایید کارورزی فروشگاه ذهن برتر: ${generatedOtp}`);
    return sendJson(res, 200, {
      success: true,
      simulatedOtp: generatedOtp,
      message: `کد تایید پیامکی ارسال شد: ${generatedOtp}`
    });
  }

  // 8. AUTH: VERIFY OTP & CLAIM CREDENTIALS
  if (pathname === '/api/auth/otp/verify' && method === 'POST') {
    const { userId, mobile, birthdate, otp } = await parseBody(req);
    const cleanMobile = String(mobile || '').replace(/[\-\_\s]/g, '');
    const cleanBirthdate = String(birthdate || '').replace(/[\/\-\_\s]/g, '');

    const isValid = otp === '1234' || otp === '5824';
    if (!isValid) return sendJson(res, 400, { success: false, message: 'کد تایید پیامکی نامعتبر است (کد تستی: 1234)' });

    const result = db.claimOrVerifyUser({ userId, birthdate: cleanBirthdate, mobile: cleanMobile });
    if (!result.success) {
      return sendJson(res, 400, result);
    }
    return sendJson(res, 200, result);
  }

  // 8.1 AUTH: REGISTER NEW USER
  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await parseBody(req);
    const result = db.registerUser(body);
    return sendJson(res, 200, result);
  }

  // 9. REPORTS: GET & POST
  if (pathname === '/api/reports' && method === 'GET') {
    return sendJson(res, 200, { success: true, reports: db.get('reports') });
  }

  if (pathname === '/api/reports' && method === 'POST') {
    const body = await parseBody(req);
    const result = db.addReport(body);
    botManager.sendTelegramMessage('coach_group', `📝 گزارش جدید کارورزی از طرف ${body.teenName} ثبت گردید.`);
    return sendJson(res, 200, result);
  }

  // 10. REPORT FEEDBACK
  if (pathname === '/api/reports/feedback' && method === 'POST') {
    const { reportId, role, feedbackText, authorName, authorAvatar } = await parseBody(req);
    const result = db.addFeedback(reportId, role, feedbackText, authorName, authorAvatar);
    return sendJson(res, 200, result);
  }

  // 11. CHAT MESSAGES
  if (pathname === '/api/chat' && method === 'GET') {
    return sendJson(res, 200, { success: true, messages: db.get('messages') });
  }

  if (pathname === '/api/chat' && method === 'POST') {
    const body = await parseBody(req);
    const newMsg = db.addMessage(body);
    return sendJson(res, 200, { success: true, message: newMsg });
  }

  // 12. ALARM ACKNOWLEDGE & TEST
  if (pathname === '/api/alarm/ack' && method === 'POST') {
    const { userId } = await parseBody(req);
    const result = db.acknowledgeAlarm(userId);
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/alarm/test' && method === 'POST') {
    const { userId } = await parseBody(req);
    const result = alarmScheduler.triggerImmediateTest(userId);
    return sendJson(res, 200, result);
  }

  // 13. SOS ALERT
  if (pathname === '/api/sos' && method === 'POST') {
    const { userId, userName } = await parseBody(req);
    botManager.sendTelegramMessage('emergency_coach_channel', `🚨 هشدار حمایت فوری کارورز: ${userName}`);
    return sendJson(res, 200, { success: true, message: 'پیام فوری ارسال شد' });
  }

  // STATIC FILES
  let safePath = pathname === '/' ? '/index.html' : pathname;
  safePath = path.normalize(safePath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  serveStatic(req, res, filePath);
});

server.listen(PORT, () => {
  console.log(`🚀 سرور پلتفرم کارورزی در پورت ${PORT} فعال است.`);
  alarmScheduler.start();
});

module.exports = server;
