/* =========================================================
   دكاني الذكي — طبقة الماسح الضوئي (الكاميرا)
   ========================================================= */

class BarcodeScanner {
  constructor({ elementId, scanLockMs = 1500, cooldownMs = 2000, beep = true, vibrate = true, onAccepted, onIgnored, onError }) {
    this.elementId = elementId;
    this.scanLockMs = scanLockMs;
    this.cooldownMs = cooldownMs;
    this.beep = beep;
    this.vibrate = vibrate;
    this.onAccepted = onAccepted;
    this.onIgnored = onIgnored;
    this.onError = onError;
    this.isRunning = false;
    this.isLocked = false;
    this.lastScanTime = 0;
    this.reader = null;
    this._audioCtx = null;
    this._visibilityHandler = () => {
      if (document.hidden && this.isRunning) this.stop();
    };
  }

  /* ننشئ ونفعّل AudioContext هنا لأن start() يُستدعى مباشرة من ضغطة زر
     المستخدم (فتح الكاميرا) — هذا يضمن أن المتصفح يسمح بتشغيل الصوت
     لاحقًا عند نجاح كل مسح، بدل أن يمنعه لعدم وجود "تفاعل مستخدم" مباشر. */
  _ensureAudio() {
    if (!this.beep) return;
    try {
      this._audioCtx = this._audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (this._audioCtx.state === 'suspended') this._audioCtx.resume();
    } catch (e) { /* الصوت غير مدعوم على هذا المتصفح */ }
  }

  async start() {
    if (this.isRunning) return;
    this._ensureAudio();
    if (typeof Html5Qrcode === 'undefined') {
      throw new Error('مكتبة قراءة الباركود لم تُحمّل بعد. تحقق من اتصال الإنترنت وأعد المحاولة.');
    }
    const html5QrCode = new Html5Qrcode(this.elementId, { verbose: false });
    this.reader = html5QrCode;

    const config = {
      fps: 12,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.72);
        return { width: size, height: size };
      },
    };

    const onDecode = (decodedText) => this.handleDecode(decodedText);
    const onScanErr = () => { /* أخطاء إطار بإطار طبيعية أثناء البحث عن باركود، تُتجاهل */ };

    try {
      await html5QrCode.start({ facingMode: 'environment' }, config, onDecode, onScanErr);
    } catch (err1) {
      // بعض الأجهزة (كمبيوتر مكتبي بدون كاميرا خلفية) لا تدعم facingMode مباشرة
      try {
        const cams = await Html5Qrcode.getCameras();
        if (!cams || cams.length === 0) throw new Error('لا توجد كاميرا متاحة على هذا الجهاز.');
        await html5QrCode.start({ deviceId: { exact: cams[0].id } }, config, onDecode, onScanErr);
      } catch (err2) {
        this.reader = null;
        const msg = /NotAllowedError|Permission/i.test(String(err2))
          ? 'تم رفض إذن الوصول إلى الكاميرا. فعّل الإذن من إعدادات المتصفح.'
          : (err2 && err2.message) || 'تعذر تشغيل الكاميرا.';
        if (this.onError) this.onError(msg);
        throw new Error(msg);
      }
    }

    this.isRunning = true;
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  async stop() {
    document.removeEventListener('visibilitychange', this._visibilityHandler);
    if (!this.isRunning || !this.reader) { this.isRunning = false; return; }
    try {
      await this.reader.stop();
      await this.reader.clear();
    } catch (err) {
      // الماسح قد يكون توقف مسبقًا؛ تجاهل الخطأ بأمان
    }
    this.reader = null;
    this.isRunning = false;
  }

  handleDecode(code) {
    const now = Date.now();
    if (this.isLocked || now - this.lastScanTime < this.scanLockMs) {
      if (this.onIgnored) this.onIgnored(code);
      return;
    }
    this.lastScanTime = now;
    this.isLocked = true;
    this._feedback();
    if (this.onAccepted) this.onAccepted(code);
    setTimeout(() => { this.isLocked = false; }, this.cooldownMs);
  }

  _feedback() {
    if (this.vibrate && navigator.vibrate) {
      try { navigator.vibrate(60); } catch (e) { /* ignore */ }
    }
    if (this.beep) this._playBeep();
  }

  /* صوت تنبيه قصير واضح ("طقّة" مزدوجة) يشبه أجهزة نقاط البيع الاحترافية،
     يتشغّل فور نجاح التقاط الباركود مباشرة. */
  _playBeep() {
    try {
      this._audioCtx = this._audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this._audioCtx;
      if (ctx.state === 'suspended') ctx.resume();

      const playTone = (freq, startAt, duration, volume) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + startAt);
        gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + startAt + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + startAt);
        osc.stop(ctx.currentTime + startAt + duration + 0.02);
      };

      // نغمتان سريعتان متصاعدتان: "بيب-بيب" تأكيدية
      playTone(1400, 0, 0.075, 0.18);
      playTone(1900, 0.09, 0.09, 0.18);
    } catch (e) { /* بعض المتصفحات تمنع تشغيل الصوت قبل تفاعل المستخدم */ }
  }
}
