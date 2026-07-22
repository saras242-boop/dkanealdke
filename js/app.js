/* =========================================================
   دكاني الذكي — منطق الواجهة الرئيسي
   ========================================================= */

const GOOGLE_CLIENT_ID = ''; // ضع هنا Client ID من Google إذا أردت تسجيل دخول حقيقي
const viewTitles = {
  dashboard: 'لوحة المعلومات', cashier: 'شاشة الكاشير', products: 'إدارة المنتجات',
  inventory: 'المخزون', invoices: 'الفواتير', debts: 'الديون',
  reports: 'التقارير', employees: 'الموظفون', settings: 'الإعدادات',
};

let cart = []; // [{productId, name, price, qty, barcode}]
let scanner = null;
let scanSettings = { scanLockMs: 1500, cooldownMs: 2000 };
let googleAccessToken = null;
let googleTokenClient = null;
let pendingDriveAction = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await openDB();
  const settingsRow = await dbGet('settings', 'store');
  if (settingsRow) {
    showApp(settingsRow);
  } else {
    document.getElementById('loginScreen').classList.remove('hidden');
  }

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    alert('الرجاء استخدام زر Google لتسجيل الدخول وتفعيل النسخ الاحتياطي.');
  });
  document.getElementById('googleBackupBtnLogin').addEventListener('click', onGoogleLogin);

  wireNav();
  wireProducts();
  wireCashier();
  wireDebts();
  wireEmployees();
  wireSettings();
  prepareGoogleLogin();
  prepareGoogleDrive();
}

async function onLogin(e) {
  e.preventDefault();
  alert('الرجاء استخدام زر Google لتسجيل الدخول وتفعيل النسخ الاحتياطي.');
}

async function onGoogleLogin() {
  const storeName = document.getElementById('storeNameInput').value.trim();
  const userName = document.getElementById('userNameInput').value.trim();
  if (!storeName || !userName) {
    alert('يرجى إدخال اسم المتجر واسم المستخدم قبل تسجيل الدخول بحساب Google.');
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
      theme: 'outline', size: 'large', text: 'signin_with', locale: 'ar'
    });
    document.getElementById('googleBackupBtnLogin').textContent = 'تسجيل الدخول بحساب Google للنسخ الاحتياطي (مطلوب)';
    setGoogleStatus('يمكنك تسجيل الدخول بحساب Google فعلياً إذا تم إعداد Client ID.');
  } else {
    signInContainer.innerHTML = '';
    setGoogleStatus('لم يتم تهيئة Google Sign-In. سيتم استخدام تسجيل دخول محلي لحفظ بيانات المتجر.');
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
  if (googleAccessToken) {
    statusEl.textContent = 'تم تفعيل Google Drive. يمكنك الآن نسخ أو استعادة البيانات.';
  } else {
    statusEl.textContent = 'اضغط زر النسخة الاحتياطية أو الاستعادة للحصول على إذن Google Drive.';
  }
}

async function ensureGoogleDriveToken() {
  if (!GOOGLE_CLIENT_ID) {
    setDriveStatus('لم يتم تهيئة Google Drive. ضع GOOGLE_CLIENT_ID في app.js.');
    return;
  }
  if (googleAccessToken) {
    return performPendingDriveAction();
  }
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
    setDriveStatus('فشل الحصول على إذن Google Drive. يرجى المحاولة مرة أخرى.');
    return;
  }
  googleAccessToken = tokenResponse.access_token;
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
  } catch (err) {
    console.error(err);
    setDriveStatus('فشل حفظ النسخة الاحتياطية على Google Drive. تحقق من الاتصال وحاول مرة أخرى.');
  }
}

async function restoreBackupFromDrive() {
  try {
    const existing = await findDriveBackupFile();
    if (!existing) {
      setDriveStatus('لم يتم العثور على نسخة احتياطية في Google Drive.');
      return;
    }
    const text = await downloadDriveFile(existing.id);
    const data = JSON.parse(text);
    await importAllData(data);
    setDriveStatus('تمت استعادة النسخة الاحتياطية من Google Drive بنجاح. سيتم إعادة تحميل الصفحة.');
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    console.error(err);
    setDriveStatus('فشل استعادة النسخة الاحتياطية من Google Drive. حاول مرة أخرى لاحقاً.');
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
  const metadata = {
    name: 'dakkani-backup.json',
    mimeType: 'application/json',
  };
  const boundary = '-------314159265358979323846';
  const multipartRequestBody =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    content +
    `\r\n--${boundary}--`;

  await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + googleAccessToken,
      'Content-Type': 'multipart/related; boundary=' + boundary,
    },
    body: multipartRequestBody,
  });
}

async function updateDriveFile(fileId, content) {
  const metadata = {
    mimeType: 'application/json',
  };
  const boundary = '-------314159265358979323846';
  const multipartRequestBody =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    content +
    `\r\n--${boundary}--`;

  await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + googleAccessToken,
      'Content-Type': 'multipart/related; boundary=' + boundary,
    },
    body: multipartRequestBody,
  });
}

async function handleGoogleCredentialResponse(response) {
  try {
    const payload = parseJwt(response.credential);
    const storeName = document.getElementById('storeNameInput').value.trim();
    const userName = payload.name || document.getElementById('userNameInput').value.trim();
    await completeLogin(storeName, userName, true, payload.email);
  } catch (err) {
    alert('فشل تسجيل الدخول عبر Google. سيتم استخدام تسجيل الدخول المحلي بدلاً من ذلك.');
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
  setGoogleStatus(googleSignedIn ? `تم تسجيل الدخول بحساب Google (${email}).` : 'تم تسجيل الدخول محلياً كنسخة احتياطية مؤقتة.');
  showApp(row, 'cashier');
}

function setGoogleStatus(text) {
  const status = document.getElementById('googleStatus');
  if (status) status.textContent = text;
}

function parseJwt(token) {
  const payload = token.split('.')[1];
  const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(decodeURIComponent(Array.from(decoded).map(c => '%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join('')));
}

async function showApp(settingsRow, initialView = 'dashboard') {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  document.getElementById('storeNameLabel').textContent = settingsRow.storeName || '';
  document.getElementById('userLabel').textContent = settingsRow.userName ? `مرحبًا، ${settingsRow.userName}` : '';

  const scanCfg = await dbGet('settings', 'scanConfig');
  if (scanCfg) scanSettings = { scanLockMs: scanCfg.scanLockMs, cooldownMs: scanCfg.cooldownMs };
  document.getElementById('scanLockSetting').value = scanSettings.scanLockMs;
  document.getElementById('cooldownSetting').value = scanSettings.cooldownMs;

  await refreshDashboard();
  switchToView(initialView);
}

function switchToView(view) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.getElementById('viewTitle').textContent = viewTitles[view] || '';
}

/* ---------------- التنقل ---------------- */
function wireNav() {
  const titles = {
    dashboard: 'لوحة المعلومات', cashier: 'شاشة الكاشير', products: 'إدارة المنتجات',
    inventory: 'المخزون', invoices: 'الفواتير', debts: 'الديون',
    reports: 'التقارير', employees: 'الموظفون', settings: 'الإعدادات',
  };
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('view-' + view).classList.add('active');
      document.getElementById('viewTitle').textContent = titles[view];

      if (view !== 'cashier' && scanner && scanner.isRunning) {
        await scanner.stop();
        document.getElementById('cameraWrap').classList.add('hidden');
      }

      switchToView(view);
      if (view === 'dashboard') refreshDashboard();
      if (view === 'products') refreshProductsTable();
      if (view === 'inventory') refreshInventoryTable();
      if (view === 'invoices') refreshInvoicesTable();
      if (view === 'debts') refreshDebtsTable();
      if (view === 'reports') refreshReports();
      if (view === 'employees') refreshEmployeesTable();
    });
  });
}

function money(n) { return (Math.round(n * 100) / 100).toFixed(2) + ' ₪'; }

/* ---------------- لوحة المعلومات ---------------- */
async function refreshDashboard() {
  const [products, sales] = await Promise.all([dbGetAll('products'), dbGetAll('sales')]);
  const today = new Date().toDateString();
  const todaySales = sales.filter(s => new Date(s.date).toDateString() === today);
  const todayRevenue = todaySales.reduce((a, s) => a + s.total, 0);
  const todayProfit = todaySales.reduce((a, s) => a + s.profit, 0);
  const lowStock = products.filter(p => p.qty <= (p.minStock ?? 5));

  const grid = document.getElementById('statGrid');
  grid.innerHTML = '';
  const stats = [
    { label: 'عدد المنتجات', value: products.length },
    { label: 'مبيعات اليوم', value: money(todayRevenue) },
    { label: 'أرباح اليوم', value: money(todayProfit) },
    { label: 'منتجات منخفضة المخزون', value: lowStock.length },
  ];
  stats.forEach(s => {
    const div = document.createElement('div');
    div.className = 'stat-card';
    div.innerHTML = `<div class="label">${s.label}</div><div class="value">${s.value}</div>`;
    grid.appendChild(div);
  });

  const alertsList = document.getElementById('alertsList');
  alertsList.innerHTML = '';
  if (lowStock.length === 0) {
    alertsList.innerHTML = '<li class="empty">لا توجد تنبيهات حالياً — كل شيء على ما يرام ✅</li>';
  } else {
    lowStock.forEach(p => {
      const li = document.createElement('li');
      li.textContent = `⚠️ منتج "${p.name}" منخفض في المخزون (الكمية المتبقية: ${p.qty})`;
      alertsList.appendChild(li);
    });
  }
}

/* ---------------- إدارة المنتجات ---------------- */
function wireProducts() {
  document.getElementById('productForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('productId').value || uid();
    const product = {
      id,
      name: document.getElementById('pName').value.trim(),
      barcode: document.getElementById('pBarcode').value.trim(),
      price: parseFloat(document.getElementById('pPrice').value),
      cost: parseFloat(document.getElementById('pCost').value) || 0,
      qty: parseInt(document.getElementById('pQty').value, 10),
      category: document.getElementById('pCategory').value.trim(),
      unit: document.getElementById('pUnit').value.trim() || 'قطعة',
      minStock: parseInt(document.getElementById('pMinStock').value, 10) || 5,
      expiry: document.getElementById('pExpiry').value || null,
    };
    await dbAdd('products', product);
    e.target.reset();
    document.getElementById('productId').value = '';
    refreshProductsTable();
  });

  document.getElementById('productSearchBox').addEventListener('input', (e) => refreshProductsTable(e.target.value));
  refreshProductsTable();
}

async function refreshProductsTable(filter = '') {
  const products = await dbGetAll('products');
  const f = filter.trim().toLowerCase();
  const filtered = f
    ? products.filter(p => p.name.toLowerCase().includes(f) || p.barcode.includes(f))
    : products;

  const el = document.getElementById('productsTable');
  if (filtered.length === 0) {
    el.innerHTML = '<p class="hint">لا توجد منتجات بعد.</p>';
    return;
  }
  let rows = filtered.map(p => `
    <tr>
      <td>${p.name}</td>
      <td>${p.barcode}</td>
      <td>${money(p.price)}</td>
      <td>${p.qty} ${p.unit}</td>
      <td>${p.category || '-'}</td>
      <td>
        <button class="link-btn" onclick="editProduct('${p.id}')">تعديل</button>
        <button class="link-btn danger" onclick="deleteProduct('${p.id}')">حذف</button>
      </td>
    </tr>`).join('');
  el.innerHTML = `<table class="tbl"><thead><tr>
    <th>الاسم</th><th>الباركود</th><th>السعر</th><th>الكمية</th><th>القسم</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

async function editProduct(id) {
  const p = await dbGet('products', id);
  if (!p) return;
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
  window.scrollTo(0, 0);
}

async function deleteProduct(id) {
  if (!confirm('هل تريد حذف هذا المنتج؟')) return;
  await dbDelete('products', id);
  refreshProductsTable();
}
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;

/* ---------------- المخزون ---------------- */
async function refreshInventoryTable() {
  const products = await dbGetAll('products');
  const el = document.getElementById('inventoryTable');
  if (products.length === 0) { el.innerHTML = '<p class="hint">لا توجد منتجات بعد.</p>'; return; }
  const rows = products.map(p => {
    const low = p.qty <= (p.minStock ?? 5);
    return `<tr>
      <td>${p.name}</td>
      <td>${p.qty} ${p.unit}</td>
      <td>${p.minStock ?? 5}</td>
      <td>${p.expiry || '-'}</td>
      <td><span class="badge ${low ? 'low' : 'ok'}">${low ? 'منخفض' : 'جيد'}</span></td>
    </tr>`;
  }).join('');
  el.innerHTML = `<table class="tbl"><thead><tr>
    <th>المنتج</th><th>الكمية</th><th>الحد الأدنى</th><th>الصلاحية</th><th>الحالة</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---------------- شاشة الكاشير ---------------- */
function wireCashier() {
  document.getElementById('manualSearch').addEventListener('input', onManualSearch);
  document.getElementById('openCameraBtn').addEventListener('click', openCamera);
  document.getElementById('closeCameraBtn').addEventListener('click', closeCamera);
  document.getElementById('checkoutBtn').addEventListener('click', checkout);
}

async function onManualSearch(e) {
  const q = e.target.value.trim().toLowerCase();
  const resultsEl = document.getElementById('searchResults');
  if (!q) { resultsEl.innerHTML = ''; return; }
  const products = await dbGetAll('products');
  const matches = products.filter(p => p.name.toLowerCase().includes(q) || p.barcode.includes(q)).slice(0, 8);
  resultsEl.innerHTML = matches.map(p => `
    <div class="result-row" onclick="addToCartById('${p.id}')">
      <span>${p.name} — ${money(p.price)}</span>
      <span>الكمية المتوفرة: ${p.qty}</span>
    </div>`).join('') || '<p class="hint">لا نتائج</p>';
}

async function addToCartById(productId) {
  const p = await dbGet('products', productId);
  if (!p) return;
  addProductToCart(p);
}
window.addToCartById = addToCartById;

function addProductToCart(p) {
  const existing = cart.find(c => c.productId === p.id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ productId: p.id, name: p.name, price: p.price, cost: p.cost || 0, qty: 1, barcode: p.barcode });
  }
  renderCart();
}

function renderCart() {
  const el = document.getElementById('cartTable');
  if (cart.length === 0) {
    el.innerHTML = '<p class="hint">السلة فارغة — امسح باركود أو ابحث عن منتج لإضافته.</p>';
  } else {
    el.innerHTML = cart.map((c, i) => `
      <div class="cart-row">
        <span>${c.name}</span>
        <input type="number" min="1" value="${c.qty}" onchange="updateCartQty(${i}, this.value)">
        <span>${money(c.price * c.qty)}</span>
        <button onclick="removeFromCart(${i})">✕</button>
      </div>`).join('');
  }
  const total = cart.reduce((a, c) => a + c.price * c.qty, 0);
  document.getElementById('cartTotal').textContent = money(total);
}

function updateCartQty(index, value) {
  const q = parseInt(value, 10);
  if (q > 0) cart[index].qty = q;
  renderCart();
}
function removeFromCart(index) {
  cart.splice(index, 1);
  renderCart();
}
window.updateCartQty = updateCartQty;
window.removeFromCart = removeFromCart;

/* --- الكاميرا والباركود --- */
async function openCamera() {
  document.getElementById('cameraWrap').classList.remove('hidden');
  const toastEl = document.getElementById('scanToast');

  scanner = new BarcodeScanner({
    elementId: 'cameraReader',
    scanLockMs: scanSettings.scanLockMs,
    cooldownMs: scanSettings.cooldownMs,
    onAccepted: async (code) => {
      const products = await dbGetAll('products');
      const p = products.find(pr => pr.barcode === code);
      showScanToast(p ? `✅ تمت إضافة: ${p.name}` : `❌ لا يوجد منتج بهذا الباركود (${code})`, !p);
      if (p) addProductToCart(p);
    },
    onIgnored: () => {
      showScanToast('⏳ الرجاء الانتظار قليلاً قبل إعادة المسح', true);
    },
  });

  try {
    await scanner.start();
  } catch (err) {
    alert('تعذر تشغيل الكاميرا: ' + err.message);
    document.getElementById('cameraWrap').classList.add('hidden');
  }
}

let toastTimer = null;
function showScanToast(msg, warn = false) {
  const toastEl = document.getElementById('scanToast');
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  toastEl.classList.toggle('warn', warn);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 1400);
}

async function closeCamera() {
  if (scanner) await scanner.stop();
  document.getElementById('cameraWrap').classList.add('hidden');
}

async function checkout() {
  if (cart.length === 0) { alert('السلة فارغة'); return; }
  const products = await dbGetAll('products');
  let total = 0, profit = 0;
  const items = [];

  for (const c of cart) {
    const p = products.find(pr => pr.id === c.productId);
    if (!p) continue;
    if (p.qty < c.qty) {
      alert(`الكمية غير كافية للمنتج: ${p.name} (المتوفر: ${p.qty})`);
      return;
    }
  }

  for (const c of cart) {
    const p = products.find(pr => pr.id === c.productId);
    const lineTotal = c.price * c.qty;
    const lineProfit = (c.price - (c.cost || 0)) * c.qty;
    total += lineTotal;
    profit += lineProfit;
    items.push({ productId: c.productId, name: c.name, price: c.price, qty: c.qty });
    p.qty -= c.qty;
    await dbAdd('products', p);
  }

  const sale = { id: uid(), date: new Date().toISOString(), items, total, profit };
  await dbAdd('sales', sale);

  cart = [];
  renderCart();
  document.getElementById('manualSearch').value = '';
  document.getElementById('searchResults').innerHTML = '';
  alert(`تم إتمام البيع بنجاح ✅\nالإجمالي: ${money(total)}`);
  refreshDashboard();
}

/* ---------------- الفواتير ---------------- */
async function refreshInvoicesTable() {
  const sales = (await dbGetAll('sales')).sort((a, b) => new Date(b.date) - new Date(a.date));
  const el = document.getElementById('invoicesTable');
  if (sales.length === 0) { el.innerHTML = '<p class="hint">لا توجد فواتير بعد.</p>'; return; }
  const rows = sales.map(s => `
    <tr>
      <td>${new Date(s.date).toLocaleString('ar-EG')}</td>
      <td>${s.items.map(i => `${i.name} × ${i.qty}`).join('، ')}</td>
      <td>${money(s.total)}</td>
    </tr>`).join('');
  el.innerHTML = `<table class="tbl"><thead><tr><th>التاريخ</th><th>المنتجات</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---------------- الديون ---------------- */
function wireDebts() {
  document.getElementById('debtForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const debt = {
      id: uid(),
      name: document.getElementById('dName').value.trim(),
      phone: document.getElementById('dPhone').value.trim(),
      amount: parseFloat(document.getElementById('dAmount').value),
      notes: document.getElementById('dNotes').value.trim(),
      paid: false,
      date: new Date().toISOString(),
    };
    await dbAdd('debts', debt);
    e.target.reset();
    refreshDebtsTable();
  });
}

async function refreshDebtsTable() {
  const debts = (await dbGetAll('debts')).sort((a, b) => new Date(b.date) - new Date(a.date));
  const el = document.getElementById('debtsTable');
  if (debts.length === 0) { el.innerHTML = '<p class="hint">لا توجد ديون مسجلة.</p>'; return; }
  const rows = debts.map(d => `
    <tr>
      <td>${d.name}</td>
      <td>${d.phone || '-'}</td>
      <td>${money(d.amount)}</td>
      <td><span class="badge ${d.paid ? 'ok' : 'low'}">${d.paid ? 'مسدد' : 'غير مسدد'}</span></td>
      <td>${!d.paid ? `<button class="link-btn" onclick="markDebtPaid('${d.id}')">تسديد</button>` : ''}</td>
    </tr>`).join('');
  el.innerHTML = `<table class="tbl"><thead><tr><th>الزبون</th><th>الهاتف</th><th>القيمة</th><th>الحالة</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function markDebtPaid(id) {
  const d = await dbGet('debts', id);
  d.paid = true;
  await dbAdd('debts', d);
  refreshDebtsTable();
}
window.markDebtPaid = markDebtPaid;

/* ---------------- التقارير ---------------- */
async function refreshReports() {
  const sales = await dbGetAll('sales');
  const now = new Date();
  const byRange = (days) => sales.filter(s => (now - new Date(s.date)) / 86400000 <= days);

  const revenue = (arr) => arr.reduce((a, s) => a + s.total, 0);
  const profit = (arr) => arr.reduce((a, s) => a + s.profit, 0);

  const grid = document.getElementById('reportStats');
  grid.innerHTML = '';
  const stats = [
    { label: 'ربح اليوم', value: money(profit(byRange(1))) },
    { label: 'ربح الأسبوع', value: money(profit(byRange(7))) },
    { label: 'ربح الشهر', value: money(profit(byRange(30))) },
    { label: 'ربح السنة', value: money(profit(byRange(365))) },
    { label: 'عدد عمليات البيع', value: sales.length },
    { label: 'متوسط قيمة الفاتورة', value: sales.length ? money(revenue(sales) / sales.length) : money(0) },
  ];
  stats.forEach(s => {
    const div = document.createElement('div');
    div.className = 'stat-card';
    div.innerHTML = `<div class="label">${s.label}</div><div class="value">${s.value}</div>`;
    grid.appendChild(div);
  });

  const qtyMap = {};
  sales.forEach(s => s.items.forEach(i => { qtyMap[i.name] = (qtyMap[i.name] || 0) + i.qty; }));
  const top = Object.entries(qtyMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const el = document.getElementById('topProductsTable');
  el.innerHTML = top.length
    ? `<table class="tbl"><thead><tr><th>المنتج</th><th>الكمية المباعة</th></tr></thead><tbody>${
        top.map(([name, qty]) => `<tr><td>${name}</td><td>${qty}</td></tr>`).join('')
      }</tbody></table>`
    : '<p class="hint">لا توجد بيانات مبيعات بعد.</p>';
}

/* ---------------- الموظفون ---------------- */
function wireEmployees() {
  document.getElementById('employeeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const emp = { id: uid(), name: document.getElementById('eName').value.trim(), role: document.getElementById('eRole').value };
    await dbAdd('employees', emp);
    e.target.reset();
    refreshEmployeesTable();
  });
}

async function refreshEmployeesTable() {
  const employees = await dbGetAll('employees');
  const el = document.getElementById('employeesTable');
  if (employees.length === 0) { el.innerHTML = '<p class="hint">لا يوجد موظفون بعد.</p>'; return; }
  const rows = employees.map(emp => `
    <tr><td>${emp.name}</td><td>${emp.role}</td>
    <td><button class="link-btn danger" onclick="deleteEmployee('${emp.id}')">حذف</button></td></tr>`).join('');
  el.innerHTML = `<table class="tbl"><thead><tr><th>الاسم</th><th>الصلاحية</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}
async function deleteEmployee(id) { await dbDelete('employees', id); refreshEmployeesTable(); }
window.deleteEmployee = deleteEmployee;

/* ---------------- الإعدادات ---------------- */
function wireSettings() {
  document.getElementById('exportBtn').addEventListener('click', async () => {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dakkani-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('سيتم استبدال كل البيانات الحالية بالنسخة الاحتياطية المستوردة. هل تريد المتابعة؟')) return;
    const text = await file.text();
    const data = JSON.parse(text);
    await importAllData(data);
    alert('تمت الاستعادة بنجاح. سيتم إعادة تحميل الصفحة.');
    location.reload();
  });

  document.getElementById('saveScanSettingsBtn').addEventListener('click', async () => {
    const scanLockMs = parseInt(document.getElementById('scanLockSetting').value, 10) || 1500;
    const cooldownMs = parseInt(document.getElementById('cooldownSetting').value, 10) || 2000;
    scanSettings = { scanLockMs, cooldownMs };
    await dbAdd('settings', { key: 'scanConfig', scanLockMs, cooldownMs });
    alert('تم حفظ إعدادات الماسح الضوئي.');
  });

  document.getElementById('wipeBtn').addEventListener('click', async () => {
    if (!confirm('سيتم حذف كل البيانات نهائيًا، هذا الإجراء لا يمكن التراجع عنه. هل أنت متأكد؟')) return;
    await dbClearAll();
    location.reload();
  });
}