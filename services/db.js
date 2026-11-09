const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'store.json');

class Database {
  constructor() {
    this.cache = null;
    this.load();
    this.ensureFullMonthWeeks();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        this.cache = JSON.parse(data);
      } else {
        this.cache = { users: [], weeks: [], reports: [], messages: [], alarms: [], botConfig: {} };
        this.save();
      }
    } catch (e) {
      console.error('Error loading database:', e.message);
    }
  }

  save() {
    try {
      const tempPath = `${DB_FILE}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.cache, null, 2), 'utf8');
      fs.renameSync(tempPath, DB_FILE);
    } catch (e) {
      console.error('Error saving database:', e.message);
    }
  }

  // Populate Weeks 2, 3, 4 with the same 7 days standard structure if empty
  ensureFullMonthWeeks() {
    const weeks = this.get('weeks');
    if (!weeks || weeks.length === 0) return;

    const baseDays = weeks[0].days;
    const weekTitles = [
      'هفته اول (شنبه ۱۴ تا جمعه ۲۰ آبان)',
      'هفته دوم (شنبه ۲۱ تا جمعه ۲۷ آبان)',
      'هفته سوم (شنبه ۲۸ آبان تا جمعه ۴ آذر)',
      'هفته چهارم (شنبه ۵ تا جمعه ۱۱ آذر)'
    ];

    for (let w = 1; w <= 4; w++) {
      let week = weeks.find(item => item.weekId === w);
      if (!week) {
        week = { weekId: w, weekTitle: weekTitles[w - 1], days: [] };
        weeks.push(week);
      }
      if (!week.days || week.days.length === 0) {
        week.days = baseDays.map((d, dIdx) => ({
          dayKey: `${d.dayKey.split('_')[0]}_w${w}`,
          dayName: `${d.dayName.split(' ')[0]} (هفته ${w})`,
          ownerPresence: d.ownerPresence,
          slots: d.slots.map((s, sIdx) => ({
            slotId: `s${sIdx + 1}_w${w}_${d.dayKey.split('_')[0]}`,
            time: s.time,
            period: s.period,
            status: s.status === 'booked' ? 'available' : s.status, // free up for new weeks
            bookedBy: null,
            userId: null,
            reason: s.reason || null
          }))
        }));
      }
    }
    this.save();
  }

  get(collection) {
    if (!this.cache) this.load();
    return this.cache[collection] || [];
  }

  findUserById(id) {
    return this.get('users').find(u => u.id === id);
  }

  findUserByBirthdateAndPhone(birthdate, phone) {
    const cleanBirthdate = String(birthdate || '').replace(/[\/\-\_\s]/g, '');
    const cleanPhone = String(phone || '').replace(/[\-\_\s]/g, '');
    return this.get('users').find(u => {
      const uBirth = String(u.birthdate || '').replace(/[\/\-\_\s]/g, '');
      const uPhone = String(u.mobile || '').replace(/[\-\_\s]/g, '');
      return uBirth === cleanBirthdate && uPhone === cleanPhone;
    });
  }

  claimOrVerifyUser({ userId, birthdate, mobile, name, role }) {
    const users = this.get('users');
    const cleanBirthdate = String(birthdate || '').replace(/[\/\-\_\s]/g, '');
    const cleanMobile = String(mobile || '').replace(/[\-\_\s]/g, '');

    if (userId) {
      let user = users.find(u => u.id === userId);
      if (!user) return { success: false, message: 'کاربر مورد نظر یافت نشد.' };

      // If already has birthdate & mobile, verify match
      if (user.birthdate && user.mobile) {
        const uBirth = String(user.birthdate).replace(/[\/\-\_\s]/g, '');
        const uMobile = String(user.mobile).replace(/[\-\_\s]/g, '');
        if (uBirth !== cleanBirthdate || uMobile !== cleanMobile) {
          return {
            success: false,
            message: 'اطلاعات وارد شده (تاریخ تولد یا شماره همراه) با مشخصات ثبت‌شده برای این کاربر همخوانی ندارد.'
          };
        }
        return { success: true, user, isFirstLogin: false };
      } else {
        // First login: save user's self-determined birthdate and mobile
        user.birthdate = cleanBirthdate;
        user.mobile = cleanMobile;
        user.pin = cleanBirthdate.slice(-4);
        this.save();
        return { success: true, user, isFirstLogin: true };
      }
    }

    // Direct login by birthdate & mobile
    let found = users.find(u => {
      const uBirth = String(u.birthdate || '').replace(/[\/\-\_\s]/g, '');
      const uMobile = String(u.mobile || '').replace(/[\-\_\s]/g, '');
      return uBirth === cleanBirthdate && uMobile === cleanMobile;
    });

    if (found) {
      return { success: true, user: found };
    }

    return {
      success: false,
      needRegistration: true,
      message: 'کاربری با این مشخصات یافت نشد؛ لطفاً نام خود را از فهرست انتخاب فرمایید یا ثبت‌نام کنید.'
    };
  }

  registerUser({ name, role, birthdate, mobile, age }) {
    const users = this.get('users');
    const cleanBirthdate = String(birthdate || '').replace(/[\/\-\_\s]/g, '');
    const cleanPhone = String(mobile || '').replace(/[\-\_\s]/g, '');
    
    let existing = users.find(u => {
      const uBirth = String(u.birthdate || '').replace(/[\/\-\_\s]/g, '');
      const uPhone = String(u.mobile || '').replace(/[\-\_\s]/g, '');
      return uBirth === cleanBirthdate && uPhone === cleanPhone;
    });

    if (existing) {
      return { success: true, user: existing, alreadyExisted: true };
    }

    const newId = `u${Date.now()}`;
    const newUser = {
      id: newId,
      role: role || 'teen',
      name: name,
      age: Number(age) || 11,
      birthdate: cleanBirthdate,
      mobile: cleanPhone,
      pin: cleanBirthdate.slice(-4),
      coins: role === 'teen' ? 100 : 0,
      online: true,
      avatar: 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=200&auto=format&fit=crop&q=80'
    };
    users.push(newUser);
    this.save();
    return { success: true, user: newUser };
  }

  updateUserAvatar(id, newAvatar) {
    const user = this.findUserById(id);
    if (user) {
      user.avatar = newAvatar;
      this.save();
      return user;
    }
    return null;
  }

  getWeeks() {
    return this.get('weeks');
  }

  bookSlot(weekId, dayKey, slotId, userId, userName, userAvatar) {
    const weeks = this.get('weeks');
    const week = weeks.find(w => w.weekId === Number(weekId));
    if (!week) return { success: false, message: 'هفته کاری یافت نشد' };

    const day = week.days.find(d => d.dayKey === dayKey);
    if (!day) return { success: false, message: 'روز کاری یافت نشد' };

    const slot = day.slots.find(s => s.slotId === slotId);
    if (!slot) return { success: false, message: 'صندلی مورد نظر یافت نشد' };

    if (slot.status === 'booked' && slot.userId !== userId) {
      return { success: false, message: `این صندلی قبلاً توسط ${slot.bookedBy} رزرو شده است` };
    }

    if (slot.status === 'partial_locked') {
      return { success: false, message: 'این ساعت کمتر از ۲ ساعت است و نیاز به تایید ادمین یا استاد دارد' };
    }

    if (slot.status === 'disabled') {
      return { success: false, message: 'استاد کارورزی در این ساعت در فروشگاه حضور ندارد' };
    }

    slot.status = 'booked';
    slot.bookedBy = userName;
    slot.userId = userId;
    slot.avatar = userAvatar || null;

    // Reward teen with 10 coins
    const user = this.findUserById(userId);
    if (user && user.role === 'teen') {
      user.coins = (user.coins || 0) + 10;
    }

    this.save();
    return { success: true, slot, coins: user ? user.coins : 0 };
  }

  unlockPartialSlot(weekId, dayKey, slotId, approvedBy) {
    const weeks = this.get('weeks');
    const week = weeks.find(w => w.weekId === Number(weekId));
    if (!week) return { success: false, message: 'هفته یافت نشد' };

    const day = week.days.find(d => d.dayKey === dayKey);
    if (!day) return { success: false, message: 'روز یافت نشد' };

    const slot = day.slots.find(s => s.slotId === slotId);
    if (!slot) return { success: false, message: 'صندلی یافت نشد' };

    slot.status = 'available';
    slot.unlockedBy = approvedBy;
    slot.reason = `قفل ساعت ناقص توسط ${approvedBy} باز شد و قابل انتخاب است.`;

    this.save();
    return { success: true, slot };
  }

  cancelSlot(weekId, dayKey, slotId, userId) {
    const weeks = this.get('weeks');
    const week = weeks.find(w => w.weekId === Number(weekId));
    if (!week) return { success: false, message: 'هفته یافت نشد' };

    const day = week.days.find(d => d.dayKey === dayKey);
    if (!day) return { success: false, message: 'روز یافت نشد' };

    const slot = day.slots.find(s => s.slotId === slotId);
    if (!slot) return { success: false, message: 'صندلی یافت نشد' };

    slot.status = 'available';
    slot.bookedBy = null;
    slot.userId = null;
    slot.avatar = null;

    this.save();
    return { success: true };
  }

  acknowledgeAlarm(userId) {
    const user = this.findUserById(userId);
    if (user && user.role === 'teen') {
      user.coins = (user.coins || 0) + 5;
      this.save();
    }
    return { success: true, coins: user ? user.coins : 0 };
  }

  addReport(reportData) {
    const reports = this.get('reports');
    const newReport = {
      id: `rep-${Date.now()}`,
      createdAt: new Date().toLocaleDateString('fa-IR') + ' ' + new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
      ...reportData
    };
    reports.unshift(newReport);

    const user = this.findUserById(reportData.teenId);
    if (user && user.role === 'teen') {
      user.coins = (user.coins || 0) + 15;
    }

    this.save();
    return { success: true, report: newReport, coins: user ? user.coins : 0 };
  }

  addFeedback(reportId, role, feedbackText, authorName, authorAvatar) {
    const reports = this.get('reports');
    const report = reports.find(r => r.id === reportId);
    if (!report) return { success: false, message: 'گزارش یافت نشد' };

    if (role === 'store_owner') {
      report.mentorFeedback = feedbackText;
      report.mentorName = authorName || 'آقای رضا شیرازیان';
      report.mentorAvatar = authorAvatar || null;
    } else {
      report.coachFeedback = feedbackText;
      report.coachName = authorName || 'خانم نصیبه هاشمی';
      report.coachAvatar = authorAvatar || null;
    }

    this.save();
    return { success: true, report };
  }

  addMessage(message) {
    const messages = this.get('messages');
    const newMsg = {
      id: `m-${Date.now()}`,
      time: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
      ...message
    };
    messages.push(newMsg);
    this.save();
    return newMsg;
  }
}

module.exports = new Database();
