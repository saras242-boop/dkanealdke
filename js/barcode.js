class BarcodeScanner {
  constructor({ elementId, scanLockMs = 1500, cooldownMs = 2000, onAccepted, onIgnored }) {
    this.elementId = elementId;
    this.scanLockMs = scanLockMs;
    this.cooldownMs = cooldownMs;
    this.onAccepted = onAccepted;
    this.onIgnored = onIgnored;
    this.isRunning = false;
    this.lastScanTime = 0;
    this.reader = null;
  }

  async start() {
    if (this.isRunning) return;
    const html5QrCode = new Html5Qrcode(this.elementId);
    this.reader = html5QrCode;
    this.isRunning = true;
    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 250 },
      (decodedText) => this.handleDecode(decodedText),
      (errorMessage) => {
        // ignore small errors while scanning
      }
    );
  }

  async stop() {
    if (!this.isRunning || !this.reader) return;
    await this.reader.stop();
    await this.reader.clear();
    this.reader = null;
    this.isRunning = false;
  }

  async handleDecode(code) {
    const now = Date.now();
    if (now - this.lastScanTime < this.scanLockMs) {
      if (this.onIgnored) this.onIgnored();
      return;
    }
    this.lastScanTime = now;
    if (this.onAccepted) this.onAccepted(code);
    await new Promise(resolve => setTimeout(resolve, this.cooldownMs));
  }
}
