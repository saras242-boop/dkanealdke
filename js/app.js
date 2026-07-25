/* =========================================================
   دكاني الذكي — منطق الواجهة الرئيسي v2
   ========================================================= */

const GOOGLE_CLIENT_ID = '479200763607-b6h7ibe8qc1cacees0p0l2juig154pbf.apps.googleusercontent.com'; // Client ID من Google

const viewTitles = {
  dashboard: 'لوحة المعلومات', cashier: 'شاشة الكاشير', products: 'إدارة المنتجات',
  inventory: 'المخزون', invoices: 'الفواتير', debts: 'الديون',
  reports: 'التقارير', employees: 'الموظفون', settings: 'الإعدادات',
};
const viewSubtitles = {
  dashboard: 'نظرة سريعة على أداء متجرك اليوم',
  cashier: 'امسح، ابحث، وبِع بسرعة',
  products: 'أضف وعدّل منتجاتك وأسعارها',
  inventory: 'تابع الكميات وتواريخ الصلاحية',
  invoices: 'كل عمليات البيع السابقة',
  debts: 'ديون الزبائن والدفعات',
  reports: 'الأرباح والمبيعات الأكثر رواجًا',
  employees: 'فريق عملك',
  settings: 'النسخ الاحتياطي وإعدادات النظام',
};

let cart = []; // [{productId, name, price, cost, qty, barcode, unit, stockQty}]
let scanner = null;
let scanSettings = { scanLockMs: 1500, cooldownMs: 2000, beep: true, vibrate: true };
let googleAccessToken = null;
let googleTokenClient = null;
let pendingDriveAction = null;
let editingProductId = null;
let activeCategoryChip = null;
let activeInventoryFilter = 'all';

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await openDB();
  const settingsRow = await dbGet('settings', 'store');
  if (settingsRow) {
    showApp(settingsRow);
  } else {
    document.getElementById('loginScreen').classList.remove('hidden');
  }

  document.getElementById('loginForm').addEventListener('submit', (e) => e.preventDefault());
  document.getElementById('googleBackupBtnLogin').addEventListener('click', onGoogleLogin);
  document.getElementById('localLoginBtn').addEventListener('click', onLocalLogin);

  wireNav();
  wireProducts();
  wireCashier();
  wireDebts();
  wireEmployees();
  wireSettings();
  wireModals();
  prepareGoogleLogin();
  prepareGoogleDrive();
  startClock();
}

/* ============================================================
   أدوات عامة: تنبيهات (Toast) ونوافذ التأكيد
   ============================================================ */
function showToast(message, type = 'info', timeout = 3400) {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    el.style.transition = 'all .2s ease';
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

function confirmDialog(title, body) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirmModal');
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalBody').textContent = body;
    overlay.classList.remove('hidden');
    const okBtn = document.getElementById('confirmModalOk');
    const cancelBtn = document.getElementById('confirmModalCancel');
    const cleanup = (result) => {
      overlay.classList.add('hidden');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      resolve(result);
    };
    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
  });
}

function wireModals() {
  document.getElementById('confirmModal').addEventListener('click', (e) => {
    if (e.target.id === 'confirmModal') document.getElementById('confirmModalCancel').click();
  });
  document.getElementById('receiptCloseBtn').addEventListener('click', () => {
    document.getElementById('receiptModal').classList.add('hidden');
  });
  document.getElementById('receiptPrintBtn').addEventListener('click', () => window.print());
  document.getElementById('receiptModal').addEventListener('click', (e) => {
    if (e.target.id === 'receiptModal') document.getElementById('receiptCloseBtn').click();
  });
  document.getElementById('payDebtCancel').addEventListener('click', () => {
    document.getElementById('payDebtModal').classList.add('hidden');
  });
}

function startClock() {
  const chip = document.getElementById('clockChip');
  const tick = () => {
    chip.textContent = new Date().toLocaleString('ar-EG', {
      weekday: 'long', hour: '2-digit', minute: '2-digit',
    });
  };
  tick();
  setInterval(tick, 30000);
}

/* ============================================================
   تسجيل الدخول
   ============================================================ */
async function onLocalLogin() {
  const storeName = document.getElementById('storeNameInput').value.trim();
  const userName = document.getElementById('userNameInput').value.trim();
  if (!storeName || !userName) {
    showToast('يرجى إدخال اسم المتجر واسمك أولاً', 'error');
    return;
  }
  await completeLogin(storeName, userName, false);
}

async function onGoogleLogin() {
  const storeName = document.getElementById('storeNameInput').value.trim();
  const userName = document.getElementById('userNameInput').value.trim();
  if (!storeName || !userName) {
    showToast('يرجى إدخال اسم المتجر واسمك قبل تسجيل الدخول بحساب Google', 'error');
    return;
  }
  if (window.google?.accounts?.id && GOOGLE_CLIENT_ID) {
    google.accounts.id.prompt();
    setGoogleStatus('يتم فتح نافذة تسجيل دخول Google...');
    return;
  }
  await completeLogin(storeName, userName, false);
}

function prepareGoogleLogin() {
  const signInContainer = document.getElementById('googleSigninButton');
  if (!window.google) {
    setTimeout(prepareGoogleLogin, 200);
    return;
  }
  if (window.google?.accounts?.id && GOOGLE_CLIENT_ID) {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredentialResponse,
      ux_mode: 'popup',
    });
    google.accounts.id.renderButton(signInContainer, {
      theme: 'outline', size: 'large', text: 'signin_with', locale: 'ar', shape: 'pill',
    });
  } else {
    signInContainer.innerHTML = '';
    setGoogleStatus('لم يتم تهيئة تسجيل دخول Google. يمكنك المتابعة بالدخول المحلي.');
  }
}

function prepareGoogleDrive() {
  const backupButton = document.getElementById('driveBackupBtn');
  const restoreButton = document.getElementById('driveRestoreBtn');
  if (!backupButton || !restoreButton) return;

  backupButton.addEventListener('click', async () => {
    pendingDriveAction = 'backup';
    await ensureGoogleDriveToken();
  });
  restoreButton.addEventListener('click', async () => {
    pendingDriveAction = 'restore';
    await ensureGoogleDriveToken();
  });
  updateDriveStatus();
}

function updateDriveStatus() {
  const statusEl = document.getElementById('driveStatus');
  if (!statusEl) return;
  statusEl.textContent = googleAccessToken
    ? 'تم تفعيل Google Drive. يمكنك الآن نسخ أو استعادة البيانات.'
    : 'اضغط زر النسخة الاحتياطية أو الاستعادة للحصول على إذن Google Drive.';
}

async function ensureGoogleDriveToken() {
  if (!GOOGLE_CLIENT_ID) {
    setDriveStatus('لم يتم تهيئة Google Drive على هذا النظام.');
    return;
  }
  if (googleAccessToken) return performPendingDriveAction();
  if (!googleTokenClient && window.google?.accounts?.oauth2) {
    googleTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: handleGoogleDriveTokenResponse,
    });
  }
  if (!googleTokenClient) {
    setDriveStatus('خطأ في تحميل مكتبة Google OAuth. أعد تحميل الصفحة.');
    return;
  }
  googleTokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleGoogleDriveTokenResponse(tokenResponse) {
  if (tokenResponse.error) {
    setDriveStatus('فشل الحصول على إذن Google Drive. حاول مرة أخرى.');
    return;
  }
  googleAccessToken = tokenResponse.access_token;
  updateDriveStatus();
  performPendingDriveAction();
}

async function performPendingDriveAction() {
  if (pendingDriveAction === 'backup') {
    pendingDriveAction = null;
    await uploadBackupToDrive();
  } else if (pendingDriveAction === 'restore') {
    pendingDriveAction = null;
    await restoreBackupFromDrive();
  }
}

async function uploadBackupToDrive() {
  try {
    const data = await exportAllData();
    const json = JSON.stringify(data, null, 2);
    const existing = await findDriveBackupFile();
    if (existing) {
      await updateDriveFile(existing.id, json);
      setDriveStatus('تم تحديث النسخة الاحتياطية على Google Drive بنجاح.');
    } else {
      await createDriveFile(json);
      setDriveStatus('تم إنشاء النسخة الاحتياطية على Google Drive بنجاح.');
    }
    showToast('تم حفظ النسخة الاحتياطية على Google Drive ✅', 'success');
  } catch (err) {
    console.error(err);
    setDriveStatus('فشل حفظ النسخة الاحتياطية. تحقق من الاتصال وحاول مرة أخرى.');
    showToast('تعذر الحفظ على Google Drive', 'error');
  }
}

async function restoreBackupFromDrive() {
  try {
    const existing = await findDriveBackupFile();
    if (!existing) {
      setDriveStatus('لم يتم العثور على نسخة احتياطية في Google Drive.');
      showToast('لا توجد نسخة احتياطية على Drive', 'error');
      return;
    }
    const ok = await confirmDialog('استعادة من Google Drive', 'سيتم استبدال كل بياناتك الحالية بالنسخة المخزنة على Drive. هل تريد المتابعة؟');
    if (!ok) return;
    const text = await downloadDriveFile(existing.id);
    const data = JSON.parse(text);
    await importAllData(data);
    setDriveStatus('تمت الاستعادة بنجاح. سيتم إعادة تحميل الصفحة.');
    showToast('تمت الاستعادة بنجاح ✅', 'success');
    setTimeout(() => location.reload(), 900);
  } catch (err) {
    console.error(err);
    setDriveStatus('فشل استعادة النسخة الاحتياطية. حاول مرة أخرى لاحقاً.');
    showToast('تعذرت الاستعادة من Google Drive', 'error');
  }
}

function setDriveStatus(text) {
  const el = document.getElementById('driveStatus');
  if (el) el.textContent = text;
}

async function findDriveBackupFile() {
  const response = await fetch('https://www.googleapis.com/drive/v3/files?q=' +
    encodeURIComponent("name='dakkani-backup.json' and trashed=false") +
    '&spaces=drive&fields=files(id,name)&pageSize=1', {
    headers: { Authorization: 'Bearer ' + googleAccessToken },
  });
  const result = await response.json();
  return result.files && result.files.length ? result.files[0] : null;
}

async function downloadDriveFile(fileId) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: 'Bearer ' + googleAccessToken },
  });
  return await response.text();
}

async function createDriveFile(content) {
  const metadata = { name: 'dakkani-backup.json', mimeType: 'application/json' };
  const boundary = '-------314159265358979323846';
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}` +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + googleAccessToken, 'Content-Type': 'multipart/related; boundary=' + boundary },
    body,
  });
}

async function updateDriveFile(fileId, content) {
  const metadata = { mimeType: 'application/json' };
  const boundary = '-------314159265358979323846';
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}` +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + googleAccessToken, 'Content-Type': 'multipart/related; boundary=' + boundary },
    body,
  });
}

async function handleGoogleCredentialResponse(response) {
  try {
    const payload = parseJwt(response.credential);
    const storeName = document.getElementById('storeNameInput').value.trim();
    const userName = payload.name || document.getElementById('userNameInput').value.trim();
    await completeLogin(storeName, userName, true, payload.email);
  } catch (err) {
    showToast('فشل تسجيل الدخول عبر Google، تم استخدام الدخول المحلي', 'error');
    const storeName = document.getElementById('storeNameInput').value.trim();
    const userName = document.getElementById('userNameInput').value.trim();
    await completeLogin(storeName, userName, false);
  }
}

async function completeLogin(storeName, userName, googleSignedIn, email = '') {
  const row = {
    key: 'store', storeName, userName,
    backupEnabled: true,
    backupProvider: googleSignedIn ? 'google' : 'local',
    googleEmail: email,
    createdAt: new Date().toISOString(),
  };
  await dbAdd('settings', row);
  setGoogleStatus(googleSignedIn ? `تم تسجيل الدخول بحساب Google (${email}).` : 'تم تسجيل الدخول محليًا على هذا الجهاز.');
  showApp(row, 'dashboard');
}

function setGoogleStatus(text) {
  const status = document.getElementById('googleStatus');
  if (status) status.textContent = text;
}

function parseJwt(token) {
  const payload = token.split('.')[1];
  const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(decodeURIComponent(Array.from(decoded).map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
}

/* ============================================================
   عرض التطبيق والتنقل
   ============================================================ */
async function showApp(settingsRow, initialView = 'dashboard') {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  document.getElementById('storeNameLabel').textContent = settingsRow.storeName || '';
  document.getElementById('userLabel').textContent = settingsRow.userName ? `مرحبًا، ${settingsRow.userName}` : '';

  const scanCfg = await dbGet('settings', 'scanConfig');
  if (scanCfg) {
    scanSettings = {
      scanLockMs: scanCfg.scanLockMs ?? 1500,
      cooldownMs: scanCfg.cooldownMs ?? 2000,
      beep: scanCfg.beep ?? true,
      vibrate: scanCfg.vibrate ?? true,
    };
  }
  document.getElementById('scanLockSetting').value = scanSettings.scanLockMs;
  document.getElementById('cooldownSetting').value = scanSettings.cooldownMs;
  document.getElementById('scanBeepSetting').checked = scanSettings.beep;
  document.getElementById('scanVibrateSetting').checked = scanSettings.vibrate;

  await refreshDashboard();
  await refreshEmployeesTable();
  await refreshCategoryList();
  switchToView(initialView);
}

function switchToView(view) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.getElementById('viewTitle').textContent = viewTitles[view] || '';
  document.getElementById('viewSubtitle').textContent = viewSubtitles[view] || '';
}

function wireNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const view = btn.dataset.view;

      if (view !== 'cashier' && scanner && scanner.isRunning) {
        await scanner.stop();
        document.getElementById('cameraWrap').classList.add('hidden');
      }

      switchToView(view);
      if (view === 'dashboard') refreshDashboard();
      if (view === 'products') { refreshProductsTable(); refreshCategoryList(); }
      if (view === 'inventory') refreshInventoryTable();
      if (view === 'invoices') refreshInvoicesTable();
      if (view === 'debts') refreshDebtsTable();
      if (view === 'reports') refreshReports();
      if (view === 'employees') refreshEmployeesTable();
      if (view === 'cashier') { refreshQuickCats(); refreshCashierEmployeeSelect(); }
    });
  });
}

function money(n) { return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2) + ' ₪'; }
function fmtDate(iso) { return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }); }

/* ============================================================
   لوحة المعلومات
   ============================================================ */
async function refreshDashboard() {
  const [products, sales, debts] = await Promise.all([dbGetAll('products'), dbGetAll('sales'), dbGetAll('debts')]);
  const today = new Date().toDateString();
  const todaySales = sales.filter(s => new Date(s.date).toDateString() === today);
  const todayRevenue = todaySales.reduce((a, s) => a + s.total, 0);
  const todayProfit = todaySales.reduce((a, s) => a + s.profit, 0);
  const lowStock = products.filter(p => p.qty <= (p.minStock ?? 5));
  const expiringSoon = products.filter(p => {
    const d = daysUntil(p.expiry);
    return d !== null && d <= 7;
  });
  const openDebts = debts.filter(d => (d.paidAmount ?? (d.paid ? d.amount : 0)) < d.amount);
  const openDebtsTotal = openDebts.reduce((a, d) => a + (d.amount - (d.paidAmount ?? (d.paid ? d.amount : 0))), 0);

  const grid = document.getElementById('statGrid');
  const stats = [
    { label: 'عدد المنتجات', value: products.length, cls: '' },
    { label: 'مبيعات اليوم', value: money(todayRevenue), cls: 'good' },
    { label: 'أرباح اليوم', value: money(todayProfit), cls: 'good' },
    { label: 'منتجات منخفضة المخزون', value: lowStock.length, cls: lowStock.length ? 'alert' : '' },
    { label: 'ديون مفتوحة', value: money(openDebtsTotal), cls: openDebtsTotal ? 'alert' : '' },
  ];
  grid.innerHTML = stats.map(s => `
    <div class="stat-card ${s.cls}">
      <div class="label">${s.label}</div>
      <div class="value">${s.value}</div>
    </div>`).join('');

  const alertsList = document.getElementById('alertsList');
  const alertItems = [];
  lowStock.forEach(p => alertItems.push({
    cls: '', text: `⚠️ "${p.name}" منخفض في المخزون (المتبقي: ${p.qty} ${p.unit || ''})`,
  }));
  expiringSoon.forEach(p => {
    const d = daysUntil(p.expiry);
    const msg = d < 0 ? `⏰ "${p.name}" منتهي الصلاحية منذ ${Math.abs(d)} يوم` : d === 0 ? `⏰ "${p.name}" ينتهي اليوم` : `⏰ "${p.name}" ينتهي خلال ${d} يوم`;
    alertItems.push({ cls: 'expiring', text: msg });
  });
  alertsList.innerHTML = alertItems.length
    ? alertItems.map(a => `<li class="${a.cls}">${a.text}</li>`).join('')
    : '<li class="empty">لا توجد تنبيهات حالياً — كل شيء على ما يرام ✅</li>';

  const weekSales = sales.filter(s => (Date.now() - new Date(s.date)) / 86400000 <= 7);
  const qtyMap = {};
  weekSales.forEach(s => s.items.forEach(i => { qtyMap[i.name] = (qtyMap[i.name] || 0) + i.qty; }));
  const top = Object.entries(qtyMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxQty = top.length ? top[0][1] : 1;
  const topEl = document.getElementById('dashTopProducts');
  topEl.innerHTML = top.length
    ? top.map(([name, qty]) => `
        <div class="bar-row">
          <div class="bar-label"><span>${name}</span><b>${qty}</b></div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(6, (qty / maxQty) * 100)}%"></div></div>
        </div>`).join('')
    : '<p class="hint">لا توجد مبيعات هذا الأسبوع بعد.</p>';
}

/* ============================================================
   إدارة المنتجات
   ============================================================ */
function wireProducts() {
  document.getElementById('productForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('pName').value.trim();
    const barcode = document.getElementById('pBarcode').value.trim();
    const price = parseFloat(document.getElementById('pPrice').value);
    const qty = parseInt(document.getElementById('pQty').value, 10);

    if (!name || !barcode || isNaN(price) || isNaN(qty)) {
      showToast('يرجى تعبئة الحقول المطلوبة بشكل صحيح', 'error');
      return;
    }

    const id = document.getElementById('productId').value || uid();
    const allProducts = await dbGetAll('products');
    const duplicate = allProducts.find(p => p.barcode === barcode && p.id !== id);
    if (duplicate) {
      showToast(`الباركود مستخدم مسبقًا للمنتج "${duplicate.name}"`, 'error');
      return;
    }

    const product = {
      id, name, barcode, price,
      cost: parseFloat(document.getElementById('pCost').value) || 0,
      qty,
      category: document.getElementById('pCategory').value.trim(),
      unit: document.getElementById('pUnit').value.trim() || 'قطعة',
      minStock: parseInt(document.getElementById('pMinStock').value, 10) || 5,
      expiry: document.getElementById('pExpiry').value || null,
    };
    await dbAdd('products', product);
    const wasEditing = !!editingProductId;
    resetProductForm();
    showToast(wasEditing ? 'تم تحديث المنتج بنجاح ✅' : 'تمت إضافة المنتج بنجاح ✅', 'success');
    refreshProductsTable();
    refreshCategoryList();
    refreshQuickCats();
  });

  document.getElementById('cancelEditBtn').addEventListener('click', resetProductForm);
  document.getElementById('productSearchBox').addEventListener('input', (e) => refreshProductsTable(e.target.value));
  refreshProductsTable();
}

function resetProductForm() {
  document.getElementById('productForm').reset();
  document.getElementById('pMinStock').value = 5;
  document.getElementById('productId').value = '';
  editingProductId = null;
  document.getElementById('productFormTitle').textContent = 'إضافة منتج';
  document.getElementById('cancelEditBtn').classList.add('hidden');
}

async function refreshCategoryList() {
  const products = await dbGetAll('products');
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
  const list = document.getElementById('categoryList');
  if (list) list.innerHTML = categories.map(c => `<option value="${escapeHtml(c)}">`).join('');
}

async function refreshProductsTable(filter = '') {
  const products = (await dbGetAll('products')).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const f = filter.trim().toLowerCase();
  const filtered = f
    ? products.filter(p => p.name.toLowerCase().includes(f) || p.barcode.includes(f) || (p.category || '').toLowerCase().includes(f))
    : products;

  document.getElementById('productsCount').textContent = `${products.length} منتج`;
  const el = document.getElementById('productsTable');
  if (filtered.length === 0) {
    el.innerHTML = '<div class="empty-state"><span class="emoji">📦</span>لا توجد منتجات مطابقة بعد.</div>';
    return;
  }
  const rows = filtered.map(p => {
    const low = p.qty <= (p.minStock ?? 5);
    return `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.barcode)}</td>
      <td>${money(p.price)}</td>
      <td>${p.qty} ${escapeHtml(p.unit || '')} ${low ? '<span class="badge low">منخفض</span>' : ''}</td>
      <td>${escapeHtml(p.category) || '-'}</td>
      <td>
        <button class="link-btn" onclick="editProduct('${p.id}')">تعديل</button>
        <button class="link-btn danger" onclick="deleteProduct('${p.id}')">حذف</button>
      </td>
    </tr>`;
  }).join('');
  el.innerHTML = `<table class="tbl"><thead><tr>
    <th>الاسم</th><th>الباركود</th><th>السعر</th><th>الكمية</th><th>القسم</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

async function editProduct(id) {
  const p = await dbGet('products', id);
  if (!p) return;
  editingProductId = id;
  document.getElementById('productId').value = p.id;
  document.getElementById('pName').value = p.name;
  document.getElementById('pBarcode').value = p.barcode;
  document.getElementById('pPrice').value = p.price;
  document.getElementById('pCost').value = p.cost;
  document.getElementById('pQty').value = p.qty;
  document.getElementById('pCategory').value = p.category;
  document.getElementById('pUnit').value = p.unit;
  document.getElementById('pMinStock').value = p.minStock;
  document.getElementById('pExpiry').value = p.expiry || '';
  document.getElementById('productFormTitle').textContent = `تعديل: ${p.name}`;
  document.getElementById('cancelEditBtn').classList.remove('hidden');
  switchToView('products');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteProduct(id) {
  const p = await dbGet('products', id);
  const ok = await confirmDialog('حذف المنتج', `هل تريد حذف المنتج "${p ? p.name : ''}" نهائيًا؟`);
  if (!ok) return;
  await dbDelete('products', id);
  showToast('تم حذف المنتج', 'info');
  refreshProductsTable();
  refreshCategoryList();
  refreshQuickCats();
}
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============================================================
   المخزون
   ============================================================ */
function wireInventoryTabs() {
  document.getElementById('inventoryTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    document.querySelectorAll('#inventoryTabs .tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    activeInventoryFilter = btn.dataset.filter;
    refreshInventoryTable();
  });
}

async function refreshInventoryTable() {
  const products = (await dbGetAll('products')).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  let list = products;
  if (activeInventoryFilter === 'low') list = products.filter(p => p.qty <= (p.minStock ?? 5));
  if (activeInventoryFilter === 'expiring') list = products.filter(p => { const d = daysUntil(p.expiry); return d !== null && d <= 7; });

  const el = document.getElementById('inventoryTable');
  if (list.length === 0) { el.innerHTML = '<div class="empty-state"><span class="emoji">🗃️</span>لا توجد عناصر لعرضها.</div>'; return; }
  const rows = list.map(p => {
    const low = p.qty <= (p.minStock ?? 5);
    const d = daysUntil(p.expiry);
    let expiryBadge = '-';
    if (p.expiry) {
      if (d < 0) expiryBadge = `<span class="badge low">منتهي</span>`;
      else if (d <= 7) expiryBadge = `<span class="badge warn">${d} يوم</span>`;
      else expiryBadge = escapeHtml(p.expiry);
    }
    return `<tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${p.qty} ${escapeHtml(p.unit || '')}</td>
      <td>${p.minStock ?? 5}</td>
      <td>${expiryBadge}</td>
      <td><span class="badge ${low ? 'low' : 'ok'}">${low ? 'منخفض' : 'جيد'}</span></td>
    </tr>`;
  }).join('');
  el.innerHTML = `<table class="tbl"><thead><tr>
    <th>المنتج</th><th>الكمية</th><th>الحد الأدنى</th><th>الصلاحية</th><th>الحالة</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

/* ============================================================
   شاشة الكاشير
   ============================================================ */
function wireCashier() {
  document.getElementById('manualSearch').addEventListener('input', onManualSearch);
  document.getElementById('manualSearch').addEventListener('keydown', onManualSearchKeydown);
  document.getElementById('openCameraBtn').addEventListener('click', openCamera);
  document.getElementById('closeCameraBtn').addEventListener('click', closeCamera);
  document.getElementById('checkoutBtn').addEventListener('click', checkout);
  document.getElementById('clearCartBtn').addEventListener('click', async () => {
    if (cart.length === 0) return;
    const ok = await confirmDialog('إفراغ السلة', 'هل تريد إفراغ سلة المبيعات الحالية؟');
    if (ok) { cart = []; renderCart(); }
  });
  document.getElementById('cashierEmployee').addEventListener('change', async (e) => {
    await dbAdd('settings', { key: 'lastCashier', name: e.target.value });
  });
  renderCart();
}

async function refreshCashierEmployeeSelect() {
  const select = document.getElementById('cashierEmployee');
  const employees = await dbGetAll('employees');
  const last = await dbGet('settings', 'lastCashier');
  const options = ['<option value="">بدون تحديد</option>', ...employees.map(e => `<option value="${escapeHtml(e.name)}">${escapeHtml(e.name)} (${escapeHtml(e.role)})</option>`)];
  select.innerHTML = options.join('');
  if (last && employees.some(e => e.name === last.name)) select.value = last.name;
}

async function refreshQuickCats() {
  const products = await dbGetAll('products');
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
  const el = document.getElementById('quickCats');
  if (categories.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = categories.map(c => `<button type="button" class="quick-cat-chip" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
  el.querySelectorAll('.quick-cat-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const cat = chip.dataset.cat;
      document.getElementById('manualSearch').value = '';
      if (activeCategoryChip === cat) {
        activeCategoryChip = null;
        el.querySelectorAll('.quick-cat-chip').forEach(c => c.classList.remove('active'));
        document.getElementById('searchResults').innerHTML = '';
        return;
      }
      activeCategoryChip = cat;
      el.querySelectorAll('.quick-cat-chip').forEach(c => c.classList.toggle('active', c === chip));
      const products = await dbGetAll('products');
      renderProductResults(products.filter(p => p.category === cat));
    });
  });
}

function renderProductResults(products) {
  const resultsEl = document.getElementById('searchResults');
  if (products.length === 0) { resultsEl.innerHTML = '<p class="hint">لا نتائج</p>'; return; }
  resultsEl.innerHTML = products.slice(0, 30).map(p => `
    <div class="result-row ${p.qty <= 0 ? 'disabled' : ''}" onclick="addToCartById('${p.id}')">
      <span class="r-name">${escapeHtml(p.name)}<span class="r-meta"> — ${money(p.price)}</span></span>
      <span class="r-meta">المتوفر: ${p.qty} ${escapeHtml(p.unit || '')}</span>
    </div>`).join('');
}

async function onManualSearch(e) {
  const q = e.target.value.trim().toLowerCase();
  if (q) {
    activeCategoryChip = null;
    document.querySelectorAll('.quick-cat-chip').forEach(c => c.classList.remove('active'));
  }
  const resultsEl = document.getElementById('searchResults');
  if (!q) { resultsEl.innerHTML = ''; return; }
  const products = await dbGetAll('products');
  const matches = products.filter(p => p.name.toLowerCase().includes(q) || p.barcode.includes(q)).slice(0, 12);
  renderProductResults(matches);
}

async function onManualSearchKeydown(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const input = e.target;
  const code = input.value.trim();
  if (!code) return;
  const products = await dbGetAll('products');
  const exact = products.find(p => p.barcode === code);
  if (exact) {
    addProductToCart(exact);
    input.value = '';
    document.getElementById('searchResults').innerHTML = '';
    showToast(`تمت الإضافة: ${exact.name}`, 'success', 1500);
  } else {
    showToast(`لا يوجد منتج بهذا الباركود (${code})`, 'error');
  }
}

async function addToCartById(productId) {
  const p = await dbGet('products', productId);
  if (!p) return;
  addProductToCart(p);
}
window.addToCartById = addToCartById;

function addProductToCart(p) {
  if (p.qty <= 0) { showToast(`"${p.name}" غير متوفر في المخزون`, 'error'); return; }
  const existing = cart.find(c => c.productId === p.id);
  if (existing) {
    if (existing.qty + 1 > p.qty) { showToast(`الكمية المتوفرة من "${p.name}" هي ${p.qty} فقط`, 'error'); return; }
    existing.qty += 1;
  } else {
    cart.push({ productId: p.id, name: p.name, price: p.price, cost: p.cost || 0, qty: 1, barcode: p.barcode, unit: p.unit || 'قطعة', stockQty: p.qty });
  }
  renderCart();
}

function renderCart() {
  const el = document.getElementById('cartTable');
  if (cart.length === 0) {
    el.innerHTML = '<div class="empty-cart">🛒<br>السلة فارغة — امسح باركودًا أو ابحث عن منتج لإضافته</div>';
  } else {
    el.innerHTML = cart.map((c, i) => `
      <div class="cart-row">
        <span class="c-name">${escapeHtml(c.name)}<span class="c-sub">${money(c.price)} / ${escapeHtml(c.unit)}</span></span>
        <div class="qty-stepper">
          <button type="button" onclick="stepCartQty(${i}, -1)">−</button>
          <input type="number" min="1" value="${c.qty}" onchange="updateCartQty(${i}, this.value)">
          <button type="button" onclick="stepCartQty(${i}, 1)">+</button>
        </div>
        <span>${money(c.price * c.qty)}</span>
        <button class="remove-btn" onclick="removeFromCart(${i})">✕</button>
      </div>`).join('');
  }
  const total = cart.reduce((a, c) => a + c.price * c.qty, 0);
  document.getElementById('cartTotal').textContent = money(total);
}

function stepCartQty(index, delta) {
  const item = cart[index];
  if (!item) return;
  const newQty = item.qty + delta;
  if (newQty < 1) return;
  if (delta > 0 && newQty > item.stockQty) { showToast(`الكمية المتوفرة هي ${item.stockQty} فقط`, 'error'); return; }
  item.qty = newQty;
  renderCart();
}
function updateCartQty(index, value) {
  const q = parseInt(value, 10);
  const item = cart[index];
  if (!item || isNaN(q) || q < 1) { renderCart(); return; }
  if (q > item.stockQty) { showToast(`الكمية المتوفرة هي ${item.stockQty} فقط`, 'error'); item.qty = item.stockQty; renderCart(); return; }
  item.qty = q;
  renderCart();
}
function removeFromCart(index) { cart.splice(index, 1); renderCart(); }
window.stepCartQty = stepCartQty;
window.updateCartQty = updateCartQty;
window.removeFromCart = removeFromCart;

/* --- الكاميرا والباركود --- */
async function openCamera() {
  document.getElementById('cameraWrap').classList.remove('hidden');

  scanner = new BarcodeScanner({
    elementId: 'cameraReader',
    scanLockMs: scanSettings.scanLockMs,
    cooldownMs: scanSettings.cooldownMs,
    beep: scanSettings.beep,
    vibrate: scanSettings.vibrate,
    onAccepted: async (code) => {
      const products = await dbGetAll('products');
      const p = products.find(pr => pr.barcode === code);
      if (p) {
        showScanToast(`✅ تمت إضافة: ${p.name}`, false);
        addProductToCart(p);
      } else {
        showScanToast(`❌ لا يوجد منتج بهذا الباركود`, true);
        offerQuickAddProduct(code);
      }
    },
    onIgnored: () => showScanToast('⏳ الرجاء الانتظار قليلاً قبل إعادة المسح', true),
    onError: (msg) => showToast(msg, 'error', 5000),
  });

  try {
    await scanner.start();
  } catch (err) {
    document.getElementById('cameraWrap').classList.add('hidden');
  }
}

function offerQuickAddProduct(code) {
  showToast(`باركود غير معروف (${code}) — يمكنك إضافته من "إدارة المنتجات"`, 'info', 4500);
}

let toastTimer = null;
function showScanToast(msg, warn = false) {
  const toastEl = document.getElementById('scanToast');
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  toastEl.classList.toggle('warn', warn);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 1500);
}

async function closeCamera() {
  if (scanner) await scanner.stop();
  document.getElementById('cameraWrap').classList.add('hidden');
}

async function checkout() {
  if (cart.length === 0) { showToast('السلة فارغة', 'error'); return; }
  const products = await dbGetAll('products');

  for (const c of cart) {
    const p = products.find(pr => pr.id === c.productId);
    if (!p) { showToast(`المنتج "${c.name}" لم يعد موجودًا`, 'error'); return; }
    if (p.qty < c.qty) { showToast(`الكمية غير كافية للمنتج "${p.name}" (المتوفر: ${p.qty})`, 'error'); return; }
  }

  let total = 0, profit = 0;
  const items = [];
  for (const c of cart) {
    const p = products.find(pr => pr.id === c.productId);
    const lineTotal = c.price * c.qty;
    const lineProfit = (c.price - (c.cost || 0)) * c.qty;
    total += lineTotal;
    profit += lineProfit;
    items.push({ productId: c.productId, name: c.name, price: c.price, qty: c.qty, unit: c.unit });
    p.qty -= c.qty;
    await dbAdd('products', p);
  }

  const employeeName = document.getElementById('cashierEmployee').value || '';
  const sale = { id: uid(), date: new Date().toISOString(), items, total, profit, employeeName };
  await dbAdd('sales', sale);

  cart = [];
  renderCart();
  document.getElementById('manualSearch').value = '';
  document.getElementById('searchResults').innerHTML = '';
  showToast(`تم إتمام البيع بنجاح — ${money(total)} ✅`, 'success');
  showReceipt(sale);
  refreshDashboard();
}

async function showReceipt(sale) {
  const store = await dbGet('settings', 'store');
  const content = document.getElementById('receiptContent');
  content.innerHTML = `
    <div class="r-head">
      <h3>${escapeHtml(store ? store.storeName : 'دكاني الذكي')}</h3>
      <p>${fmtDate(sale.date)}</p>
      ${sale.employeeName ? `<p>الكاشير: ${escapeHtml(sale.employeeName)}</p>` : ''}
    </div>
    <table>
      ${sale.items.map(i => `<tr><td>${escapeHtml(i.name)} × ${i.qty}</td><td style="text-align:left">${money(i.price * i.qty)}</td></tr>`).join('')}
    </table>
    <div class="r-total"><span>الإجمالي</span><span>${money(sale.total)}</span></div>
  `;
  document.getElementById('receiptModal').classList.remove('hidden');
}

/* ============================================================
   الفواتير
   ============================================================ */
async function refreshInvoicesTable() {
  const sales = (await dbGetAll('sales')).sort((a, b) => new Date(b.date) - new Date(a.date));
  document.getElementById('invoicesCount').textContent = `${sales.length} فاتورة`;
  const el = document.getElementById('invoicesTable');
  if (sales.length === 0) { el.innerHTML = '<div class="empty-state"><span class="emoji">🧾</span>لا توجد فواتير بعد.</div>'; return; }
  const rows = sales.map(s => `
    <tr>
      <td>${fmtDate(s.date)}</td>
      <td>${s.items.map(i => `${escapeHtml(i.name)} × ${i.qty}`).join('، ')}</td>
      <td>${escapeHtml(s.employeeName) || '-'}</td>
      <td>${money(s.total)}</td>
    </tr>`).join('');
  el.innerHTML = `<table class="tbl"><thead><tr><th>التاريخ</th><th>المنتجات</th><th>الكاشير</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ============================================================
   الديون
   ============================================================ */
function wireDebts() {
  document.getElementById('debtForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('dName').value.trim();
    const amount = parseFloat(document.getElementById('dAmount').value);
    if (!name || isNaN(amount) || amount <= 0) { showToast('يرجى إدخال بيانات صحيحة', 'error'); return; }
    const debt = {
      id: uid(), name,
      amount,
      paidAmount: 0,
      notes: document.getElementById('dNotes').value.trim(),
      paid: false,
      date: new Date().toISOString(),
    };
    await dbAdd('debts', debt);
    e.target.reset();
    showToast('تم تسجيل الدين بنجاح', 'success');
    refreshDebtsTable();
  });

  document.getElementById('payDebtOk').addEventListener('click', submitDebtPayment);
}

async function refreshDebtsTable() {
  const debts = (await dbGetAll('debts')).sort((a, b) => new Date(b.date) - new Date(a.date));

  const totalOwed = debts.reduce((a, d) => a + d.amount, 0);
  const totalPaid = debts.reduce((a, d) => a + (d.paidAmount ?? (d.paid ? d.amount : 0)), 0);
  const totalRemaining = totalOwed - totalPaid;
  document.getElementById('debtStats').innerHTML = `
    <div class="stat-card"><div class="label">إجمالي الديون المسجلة</div><div class="value">${money(totalOwed)}</div></div>
    <div class="stat-card good"><div class="label">المسدد</div><div class="value">${money(totalPaid)}</div></div>
    <div class="stat-card ${totalRemaining ? 'alert' : ''}"><div class="label">المتبقي</div><div class="value">${money(totalRemaining)}</div></div>
  `;

  const el = document.getElementById('debtsTable');
  if (debts.length === 0) { el.innerHTML = '<div class="empty-state"><span class="emoji">💳</span>لا توجد ديون مسجلة.</div>'; return; }
  const rows = debts.map(d => {
    const paidAmount = d.paidAmount ?? (d.paid ? d.amount : 0);
    const remaining = d.amount - paidAmount;
    const isPaid = remaining <= 0.005;
    return `
    <tr>
      <td>${escapeHtml(d.name)}</td>
      <td>${money(d.amount)}</td>
      <td>${money(remaining)}</td>
      <td><span class="badge ${isPaid ? 'ok' : 'low'}">${isPaid ? 'مسدد' : 'غير مسدد'}</span></td>
      <td>${!isPaid ? `<button class="link-btn" onclick="openPayDebtModal('${d.id}')">تسجيل دفعة</button>` : ''}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<table class="tbl"><thead><tr><th>الزبون</th><th>القيمة</th><th>المتبقي</th><th>الحالة</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

let payingDebtId = null;
async function openPayDebtModal(id) {
  const d = await dbGet('debts', id);
  if (!d) return;
  payingDebtId = id;
  const paidAmount = d.paidAmount ?? (d.paid ? d.amount : 0);
  const remaining = d.amount - paidAmount;
  document.getElementById('payDebtInfo').textContent = `${d.name} — المتبقي: ${money(remaining)}`;
  const amountInput = document.getElementById('payDebtAmount');
  amountInput.value = remaining.toFixed(2);
  amountInput.max = remaining;
  document.getElementById('payDebtModal').classList.remove('hidden');
}
window.openPayDebtModal = openPayDebtModal;

async function submitDebtPayment() {
  if (!payingDebtId) return;
  const d = await dbGet('debts', payingDebtId);
  if (!d) return;
  const paidAmount = d.paidAmount ?? (d.paid ? d.amount : 0);
  const remaining = d.amount - paidAmount;
  const value = parseFloat(document.getElementById('payDebtAmount').value);
  if (isNaN(value) || value <= 0) { showToast('يرجى إدخال قيمة صحيحة', 'error'); return; }
  const applied = Math.min(value, remaining);
  d.paidAmount = paidAmount + applied;
  d.paid = d.paidAmount >= d.amount - 0.005;
  await dbAdd('debts', d);
  document.getElementById('payDebtModal').classList.add('hidden');
  showToast(`تم تسجيل دفعة بقيمة ${money(applied)} ✅`, 'success');
  payingDebtId = null;
  refreshDebtsTable();
}

/* ============================================================
   التقارير
   ============================================================ */
async function refreshReports() {
  const sales = await dbGetAll('sales');
  const now = new Date();
  const byRange = (days) => sales.filter(s => (now - new Date(s.date)) / 86400000 <= days);
  const revenue = (arr) => arr.reduce((a, s) => a + s.total, 0);
  const profit = (arr) => arr.reduce((a, s) => a + s.profit, 0);

  const grid = document.getElementById('reportStats');
  const stats = [
    { label: 'ربح اليوم', value: money(profit(byRange(1))) },
    { label: 'ربح الأسبوع', value: money(profit(byRange(7))) },
    { label: 'ربح الشهر', value: money(profit(byRange(30))) },
    { label: 'ربح السنة', value: money(profit(byRange(365))) },
    { label: 'عدد عمليات البيع', value: sales.length },
    { label: 'متوسط قيمة الفاتورة', value: sales.length ? money(revenue(sales) / sales.length) : money(0) },
  ];
  grid.innerHTML = stats.map(s => `<div class="stat-card"><div class="label">${s.label}</div><div class="value">${s.value}</div></div>`).join('');

  const qtyMap = {};
  sales.forEach(s => s.items.forEach(i => { qtyMap[i.name] = (qtyMap[i.name] || 0) + i.qty; }));
  const top = Object.entries(qtyMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxQty = top.length ? top[0][1] : 1;
  const el = document.getElementById('topProductsTable');
  el.innerHTML = top.length
    ? top.map(([name, qty]) => `
        <div class="bar-row">
          <div class="bar-label"><span>${escapeHtml(name)}</span><b>${qty} وحدة</b></div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(6, (qty / maxQty) * 100)}%"></div></div>
        </div>`).join('')
    : '<p class="hint">لا توجد بيانات مبيعات بعد.</p>';
}

/* ============================================================
   الموظفون
   ============================================================ */
function wireEmployees() {
  document.getElementById('employeeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('eName').value.trim();
    if (!name) { showToast('يرجى إدخال اسم الموظف', 'error'); return; }
    const emp = { id: uid(), name, phone: document.getElementById('ePhone').value.trim(), role: document.getElementById('eRole').value };
    await dbAdd('employees', emp);
    e.target.reset();
    showToast('تمت إضافة الموظف', 'success');
    refreshEmployeesTable();
  });
}

async function refreshEmployeesTable() {
  const employees = await dbGetAll('employees');
  const el = document.getElementById('employeesTable');
  if (employees.length === 0) { el.innerHTML = '<div class="empty-state"><span class="emoji">👥</span>لا يوجد موظفون بعد.</div>'; }
  else {
    const rows = employees.map(emp => `
      <tr>
        <td>${escapeHtml(emp.name)}</td>
        <td>${escapeHtml(emp.phone) || '-'}</td>
        <td><span class="badge ${emp.role === 'مدير' ? 'warn' : 'ok'}">${escapeHtml(emp.role)}</span></td>
        <td><button class="link-btn danger" onclick="deleteEmployee('${emp.id}')">حذف</button></td>
      </tr>`).join('');
    el.innerHTML = `<table class="tbl"><thead><tr><th>الاسم</th><th>الهاتف</th><th>الصلاحية</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  refreshCashierEmployeeSelect();
}
async function deleteEmployee(id) {
  const ok = await confirmDialog('حذف الموظف', 'هل تريد حذف هذا الموظف؟');
  if (!ok) return;
  await dbDelete('employees', id);
  showToast('تم حذف الموظف', 'info');
  refreshEmployeesTable();
}
window.deleteEmployee = deleteEmployee;

/* ============================================================
   الإعدادات
   ============================================================ */
function wireSettings() {
  wireInventoryTabs();

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dakkani-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showToast('تم تنزيل النسخة الاحتياطية', 'success');
  });

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ok = await confirmDialog('استعادة نسخة احتياطية', 'سيتم استبدال كل البيانات الحالية بالنسخة المستوردة. هل تريد المتابعة؟');
    if (!ok) { e.target.value = ''; return; }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importAllData(data);
      showToast('تمت الاستعادة بنجاح، سيتم إعادة تحميل الصفحة', 'success');
      setTimeout(() => location.reload(), 900);
    } catch (err) {
      showToast('تعذرت قراءة ملف النسخة الاحتياطية', 'error');
    }
  });

  document.getElementById('saveScanSettingsBtn').addEventListener('click', async () => {
    const scanLockMs = parseInt(document.getElementById('scanLockSetting').value, 10) || 1500;
    const cooldownMs = parseInt(document.getElementById('cooldownSetting').value, 10) || 2000;
    const beep = document.getElementById('scanBeepSetting').checked;
    const vibrate = document.getElementById('scanVibrateSetting').checked;
    scanSettings = { scanLockMs, cooldownMs, beep, vibrate };
    await dbAdd('settings', { key: 'scanConfig', scanLockMs, cooldownMs, beep, vibrate });
    showToast('تم حفظ إعدادات الماسح الضوئي', 'success');
  });

  document.getElementById('wipeBtn').addEventListener('click', async () => {
    const ok = await confirmDialog('حذف كل البيانات', 'سيتم حذف كل البيانات نهائيًا. هذا الإجراء لا يمكن التراجع عنه. هل أنت متأكد؟');
    if (!ok) return;
    await dbClearAll();
    location.reload();
  });
}
