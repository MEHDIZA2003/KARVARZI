const db = require('./db');
const botManager = require('./botManager');

class AlarmScheduler {
  constructor() {
    this.timer = null;
    this.intervalMs = 30000; // Check every 30 seconds
    this.activeAlerts = [];
  }

  start() {
    if (this.timer) return;
    console.log('[ALARM-ENGINE] Persistent 5-minute Snooze Engine started.');
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[ALARM-ENGINE] Persistent Snooze Engine stopped.');
    }
  }

  tick() {
    const alarms = db.get('alarms');
    const now = new Date();

    alarms.forEach(alarm => {
      if (alarm.acknowledged) return;

      const lastAlert = new Date(alarm.lastAlertTime || 0);
      const diffMinutes = (now - lastAlert) / (1000 * 60);

      // SNOOZE CONDITION: If 5 or more minutes passed without acknowledgement
      if (diffMinutes >= 5) {
        alarm.snoozeCount = (alarm.snoozeCount || 0) + 1;
        alarm.lastAlertTime = now.toISOString();
        db.save();

        console.log(`[ALARM-SNOOZE] Re-triggering 5-minute alarm for ${alarm.userName} (Snooze #${alarm.snoozeCount})`);

        // Send alert via Bots
        const user = db.findUserById(alarm.userId);
        botManager.broadcastShiftReminder(
          alarm.userName,
          alarm.shiftTime,
          'فروشگاه کتاب و اسباب‌بازی خورشید',
          user?.mobile || '09133544489'
        );

        this.activeAlerts.push({
          userId: alarm.userId,
          userName: alarm.userName,
          time: now.toLocaleTimeString('fa-IR'),
          snoozeNumber: alarm.snoozeCount
        });
      }
    });
  }

  triggerImmediateTest(userId) {
    const user = db.findUserById(userId) || db.findUserById('u1');
    const now = new Date();

    const testAlarm = {
      id: `alm-test-${Date.now()}`,
      userId: user.id,
      userName: user.name,
      shiftTime: '۱۶:۰۰ الی ۱۸:۰۰',
      shiftDate: 'امروز',
      acknowledged: false,
      snoozeCount: 0,
      lastAlertTime: now.toISOString()
    };

    const alarms = db.get('alarms');
    // Clear any previous unacknowledged test alarms for this user
    const existingIdx = alarms.findIndex(a => a.userId === user.id && !a.acknowledged);
    if (existingIdx !== -1) {
      alarms[existingIdx] = testAlarm;
    } else {
      alarms.push(testAlarm);
    }
    db.save();

    // Broadcast through bots
    botManager.broadcastShiftReminder(
      user.name,
      '۱۶:۰۰',
      'فروشگاه کتاب، اسباب‌بازی و کادویی خورشید',
      user.mobile
    );

    return {
      success: true,
      alarm: testAlarm,
      message: `آلارم تست ۱ ساعت قبل برای ${user.name} فعال شد. تا زمان تایید، هر ۵ دقیقه تکرار خواهد شد.`
    };
  }

  getActiveAlerts() {
    return this.activeAlerts.slice(-10);
  }
}

module.exports = new AlarmScheduler();
