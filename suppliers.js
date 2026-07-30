/* =========================================================
   دكاني الذكي — ميزة الموردين (Firebase Realtime Database)
   ========================================================= */

const SUPPLIER_PRODUCT_CAP = 1600;

let currentSupplierSession = null; // { id, name }
let selectedSupplierId = null;
let selectedSupplierName = '';
let supplierCart = []; // [{productId, name, price, qty}]
let editingSupplierProductId = null;
let _storeIdCache = null;
let _mySupplierProductsCache = [];

document.addEventListener('DOMContentLoaded', async () => {
  // نربط كل جزء بشكل منفصل ومحمي: إذا فشل جزء واحد لأي سبب،
  // يبقى باقي الأجزاء (زر الدخول، التبويبات...) يعمل بشكل طبيعي.
  safeRun(wireSupplierLoginUi);
  safeRun(wireSupplierTabs);
  safeRun(wireSupplierBrowseUi);
  safeRun(wireSupplierDashboardUi);

  // ربط مباشر إضافي لزر "الموردين" في القائمة الجانبية (احتياطي مستقل
  // عن أي كود آخر) لضمان عمل القسم حتى لو تغيّر أي شيء في مكان آخر.
  const suppliersNavBtn = document.querySelector('.nav-btn[data-view="suppliers"]');
  if (suppliersNavBtn) suppliersNavBtn.addEventListener('click', () => safeRun(refreshSuppliersView));

  try {
    const saved = await dbGet('settings', 'supplierSession');
    if (saved && saved.id) {
      currentSupplierSession = { id: saved.id, name: saved.name };
      showSupplierShell();
    }
  } catch (err) { /* لا توجد جلسة محفوظة */ }
});

function safeRun(fn) {
  try { return fn(); } catch (err) { console.error('خطأ في ميزة الموردين:', err); }
}

/* استدعاء أي وعد (Promise) مع مهلة قصوى؛ إذا لم يستجب الخادم خلال المهلة
   نعتبرها فشلاً بدل أن تبقى الشاشة عالقة على "جارِ التحميل" للأبد. */
function withTimeout(promise, ms = 9000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('انتهت مهلة الاتصال بالخادم')), ms)),
  ]);
}

async function getStoreId() {
  if (_storeIdCache) return _storeIdCache;
  let row = await dbGet('settings', 'storeId');
  if (!row) {
    row = { key: 'storeId', id: uid() };
    await dbAdd('settings', row);
  }
  _storeIdCache = row.id;
  return _storeIdCache;
}

function firebaseErrorToast(err) {
  console.error(err);
  const isTimeout = err && /مهلة/.test(err.message || '');
  showToast(
    isTimeout
      ? 'انتهت مهلة الاتصال بخادم الموردين. تحقق من الإنترنت وحاول مرة أخرى.'
      : 'تعذر الاتصال بخادم الموردين. تحقق من اتصال الإنترنت أو من إعدادات Firebase وحاول مرة أخرى.',
    'error', 4500
  );
}

/* ============================================================
   دخول المورد
   ============================================================ */
function wireSupplierLoginUi() {
  document.getElementById('supplierLoginLink').addEventListener('click', () => {
    document.getElementById('supplierLoginUser').value = '';
    document.getElementById('supplierLoginPass').value = '';
    document.getElementById('supplierLoginError').textContent = '';
    document.getElementById('supplierLoginModal').classList.remove('hidden');
  });
  document.getElementById('supplierLoginCancel').addEventListener('click', () => {
    document.getElementById('supplierLoginModal').classList.add('hidden');
  });
  document.getElementById('supplierLoginModal').addEventListener('click', (e) => {
    if (e.target.id === 'supplierLoginModal') document.getElementById('supplierLoginCancel').click();
  });
  document.getElementById('supplierLoginOk').addEventListener('click', attemptSupplierLogin);
  document.getElementById('supplierLogoutBtn').addEventListener('click', async () => {
    const ok = await confirmDialog('تسجيل الخروج', 'هل تريد تسجيل الخروج من لوحة المورّد؟');
    if (!ok) return;
    await dbDelete('settings', 'supplierSession');
    location.reload();
  });
}

async function attemptSupplierLogin() {
  const user = document.getElementById('supplierLoginUser').value.trim();
  const pass = document.getElementById('supplierLoginPass').value;
  const errEl = document.getElementById('supplierLoginError');
  errEl.textContent = '';
  if (!user || !pass) { errEl.textContent = 'يرجى إدخال اسم المستخدم وكلمة المرور'; return; }

  const okBtn = document.getElementById('supplierLoginOk');
  okBtn.disabled = true;
  okBtn.textContent = 'جارِ التحقق...';
  try {
    const db = getFirebaseDb();
    const snap = await withTimeout(db.ref('suppliers').once('value'));
    const all = snap.val() || {};
    let matchId = null, matchVal = null;
    Object.entries(all).forEach(([key, val]) => {
      if (matchId) return;
      const uMatch = val.username === user || val.phone === user;
      if (uMatch && val.password === pass) { matchId = key; matchVal = val; }
    });
    if (!matchId) { errEl.textContent = 'بيانات الدخول غير صحيحة'; return; }
    if (matchVal.status === 'suspended' || matchVal.status === 'disabled') {
      errEl.textContent = 'تم إيقاف هذا الحساب. تواصل مع إدارة دكاني الذكي.';
      return;
    }
    currentSupplierSession = { id: matchId, name: matchVal.supplierName || matchVal.name || 'مورّد' };
    await dbAdd('settings', { key: 'supplierSession', id: matchId, name: currentSupplierSession.name });
    document.getElementById('supplierLoginModal').classList.add('hidden');
    showSupplierShell();
  } catch (err) {
    console.error(err);
    errEl.textContent = 'تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.';
  } finally {
    okBtn.disabled = false;
    okBtn.textContent = 'دخول';
  }
}

function showSupplierShell() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('supplierShell').classList.remove('hidden');
  document.getElementById('supplierNameLabel').textContent = currentSupplierSession.name;
  document.getElementById('supplierUserChip').textContent = `مرحبًا، ${currentSupplierSession.name}`;
  switchSupplierView('orders');
}

/* ============================================================
   تبويبات قسم الموردين (لصاحب المحل)
   ============================================================ */
function wireSupplierTabs() {
  document.getElementById('supplierTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    document.querySelectorAll('#supplierTabs .tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.stab;
    document.getElementById('supplierBrowsePane').classList.toggle('hidden', tab !== 'browse');
    document.getElementById('supplierOrdersPane').classList.toggle('hidden', tab !== 'orders');
    if (tab === 'orders') loadMyOrders();
  });
}

function refreshSuppliersView() {
  document.querySelectorAll('#supplierTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.stab === 'browse'));
  document.getElementById('supplierBrowsePane').classList.remove('hidden');
  document.getElementById('supplierOrdersPane').classList.add('hidden');
  document.getElementById('supplierProductsWrap').classList.add('hidden');
  document.getElementById('supplierListWrap').classList.remove('hidden');
  loadSupplierList();
}
window.refreshSuppliersView = refreshSuppliersView;

/* ============================================================
   تصفح الموردين والمنتجات (لصاحب المحل)
   ============================================================ */
function wireSupplierBrowseUi() {
  document.getElementById('backToSuppliersBtn').addEventListener('click', () => {
    document.getElementById('supplierProductsWrap').classList.add('hidden');
    document.getElementById('supplierListWrap').classList.remove('hidden');
    supplierCart = [];
    renderSupplierCart();
  });
  document.getElementById('supplierProductSearch').addEventListener('input', (e) => {
    renderSupplierProducts(_currentSupplierProductsList, e.target.value);
  });
  document.getElementById('sendSupplierOrderBtn').addEventListener('click', sendSupplierOrder);
}

async function loadSupplierList() {
  const listEl = document.getElementById('supplierList');
  listEl.innerHTML = '<p class="hint">جارِ تحميل قائمة الموردين...</p>';
  try {
    const db = getFirebaseDb();
    const snap = await withTimeout(db.ref('suppliers').once('value'));
    const all = snap.val() || {};
    const suppliers = Object.entries(all)
      .map(([id, v]) => ({ id, ...v }))
      .filter(s => (s.status || 'active') === 'active');

    if (suppliers.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><span class="emoji">🚚</span>لا يوجد موردون معتمدون حاليًا.</div>';
      return;
    }
    listEl.innerHTML = suppliers.map(s => `
      <div class="supplier-card" data-id="${s.id}">
        <h4>${escapeHtml(s.supplierName || s.name || 'مورّد')}</h4>
        <span class="s-meta">📍 ${escapeHtml(s.city) || '-'}</span>
        <span class="s-meta">📞 ${escapeHtml(s.phone) || '-'}</span>
        ${s.categories ? `<div class="s-tags">${String(s.categories).split(',').map(c => `<span class="s-tag">${escapeHtml(c.trim())}</span>`).join('')}</div>` : ''}
      </div>`).join('');
    listEl.querySelectorAll('.supplier-card').forEach(card => {
      card.addEventListener('click', () => openSupplierProducts(card.dataset.id, all[card.dataset.id].supplierName || all[card.dataset.id].name));
    });
  } catch (err) {
    firebaseErrorToast(err);
    listEl.innerHTML = '<div class="empty-state"><span class="emoji">⚠️</span>تعذر تحميل الموردين. تحقق من الإنترنت.</div>';
  }
}

let _currentSupplierProductsList = [];

async function openSupplierProducts(supplierId, supplierName) {
  selectedSupplierId = supplierId;
  selectedSupplierName = supplierName || 'مورّد';
  supplierCart = [];
  renderSupplierCart();
  document.getElementById('supplierProductsTitle').textContent = `منتجات: ${selectedSupplierName}`;
  document.getElementById('supplierListWrap').classList.add('hidden');
  document.getElementById('supplierProductsWrap').classList.remove('hidden');
  document.getElementById('supplierProductSearch').value = '';
  const gridEl = document.getElementById('supplierProductsGrid');
  gridEl.innerHTML = '<p class="hint">جارِ تحميل المنتجات...</p>';

  try {
    const db = getFirebaseDb();
    const snap = await withTimeout(db.ref('supplierProducts/' + supplierId).once('value'));
    const all = snap.val() || {};
    _currentSupplierProductsList = Object.entries(all).map(([id, v]) => ({ id, ...v }));
    renderSupplierProducts(_currentSupplierProductsList);

    // تسجيل أن هذا المحل شاهد منتجات هذا المورّد (لإحصائية "عدد المحلات التي شاهدت منتجاته")
    const storeId = await getStoreId();
    db.ref(`productViews/${supplierId}/${storeId}`).set(true).catch(() => {});
  } catch (err) {
    firebaseErrorToast(err);
    gridEl.innerHTML = '<div class="empty-state"><span class="emoji">⚠️</span>تعذر تحميل منتجات هذا المورّد.</div>';
  }
}

function renderSupplierProducts(list, filter = '') {
  const gridEl = document.getElementById('supplierProductsGrid');
  const f = (filter || '').trim().toLowerCase();
  const filtered = f ? list.filter(p => (p.name || '').toLowerCase().includes(f) || (p.barcode || '').includes(f)) : list;
  if (filtered.length === 0) {
    gridEl.innerHTML = '<div class="empty-state"><span class="emoji">📦</span>لا توجد منتجات مطابقة.</div>';
    return;
  }
  gridEl.innerHTML = filtered.map(p => `
    <div class="supplier-product-card ${p.available === false ? 'unavailable' : ''}">
      <div class="sp-img" style="${p.imageUrl ? `background-image:url('${escapeHtml(p.imageUrl)}')` : ''}">${p.imageUrl ? '' : '📦'}</div>
      <div class="sp-body">
        <span class="sp-name">${escapeHtml(p.name)}</span>
        <span class="sp-desc">${escapeHtml(p.description) || ''}</span>
        <span class="sp-price">${money(Number(p.price) || 0)}</span>
        <button type="button" class="btn-primary" ${p.available === false ? 'disabled' : ''} onclick="addToSupplierCart('${p.id}')">
          ${p.available === false ? 'غير متوفر' : '+ أضف للطلب'}
        </button>
      </div>
    </div>`).join('');
}

function addToSupplierCart(productId) {
  const p = _currentSupplierProductsList.find(x => x.id === productId);
  if (!p) return;
  const existing = supplierCart.find(c => c.productId === productId);
  if (existing) existing.qty += 1;
  else supplierCart.push({ productId, name: p.name, price: Number(p.price) || 0, qty: 1 });
  renderSupplierCart();
  showToast(`تمت الإضافة: ${p.name}`, 'success', 1400);
}
window.addToSupplierCart = addToSupplierCart;

function renderSupplierCart() {
  const el = document.getElementById('supplierCartTable');
  if (supplierCart.length === 0) {
    el.innerHTML = '<div class="empty-cart">📨<br>لم تختر منتجات بعد لإرسال طلب شراء</div>';
  } else {
    el.innerHTML = supplierCart.map((c, i) => `
      <div class="cart-row">
        <span class="c-name">${escapeHtml(c.name)}<span class="c-sub">${money(c.price)}</span></span>
        <div class="qty-stepper">
          <button type="button" onclick="stepSupplierCartQty(${i}, -1)">−</button>
          <input type="number" min="1" value="${c.qty}" onchange="updateSupplierCartQty(${i}, this.value)">
          <button type="button" onclick="stepSupplierCartQty(${i}, 1)">+</button>
        </div>
        <span>${c.qty}×</span>
        <button class="remove-btn" onclick="removeFromSupplierCart(${i})">✕</button>
      </div>`).join('');
  }
  document.getElementById('supplierCartCount').textContent = supplierCart.reduce((a, c) => a + c.qty, 0);
}
function stepSupplierCartQty(i, delta) {
  const item = supplierCart[i];
  if (!item) return;
  const q = item.qty + delta;
  if (q < 1) return;
  item.qty = q;
  renderSupplierCart();
}
function updateSupplierCartQty(i, value) {
  const q = parseInt(value, 10);
  if (!supplierCart[i] || isNaN(q) || q < 1) { renderSupplierCart(); return; }
  supplierCart[i].qty = q;
  renderSupplierCart();
}
function removeFromSupplierCart(i) { supplierCart.splice(i, 1); renderSupplierCart(); }
window.stepSupplierCartQty = stepSupplierCartQty;
window.updateSupplierCartQty = updateSupplierCartQty;
window.removeFromSupplierCart = removeFromSupplierCart;

async function sendSupplierOrder() {
  if (supplierCart.length === 0) { showToast('اختر منتجات أولاً', 'error'); return; }
  const btn = document.getElementById('sendSupplierOrderBtn');
  btn.disabled = true;
  btn.textContent = 'جارِ الإرسال...';
  try {
    const db = getFirebaseDb();
    const storeId = await getStoreId();
    const storeSettings = await dbGet('settings', 'store');
    const order = {
      storeId,
      storeName: (storeSettings && storeSettings.storeName) || 'متجر',
      supplierId: selectedSupplierId,
      supplierName: selectedSupplierName,
      items: supplierCart.map(c => ({ productId: c.productId, name: c.name, price: c.price, quantity: c.qty })),
      status: 'new',
      createdAt: new Date().toISOString(),
    };
    await db.ref('orders').push(order);
    showToast('تم إرسال الطلب إلى المورّد بنجاح ✅', 'success');
    supplierCart = [];
    renderSupplierCart();
  } catch (err) {
    firebaseErrorToast(err);
  } finally {
    btn.disabled = false;
    btn.textContent = '📨 إرسال الطلب للمورد';
  }
}

async function loadMyOrders() {
  const el = document.getElementById('myOrdersTable');
  el.innerHTML = '<p class="hint">جارِ التحميل...</p>';
  try {
    const db = getFirebaseDb();
    const storeId = await getStoreId();
    const snap = await withTimeout(db.ref('orders').orderByChild('storeId').equalTo(storeId).once('value'));
    const all = snap.val() || {};
    const orders = Object.values(all).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    document.getElementById('myOrdersCount').textContent = `${orders.length} طلب`;
    if (orders.length === 0) { el.innerHTML = '<div class="empty-state"><span class="emoji">📨</span>لم ترسل أي طلبات بعد.</div>'; return; }
    const statusLabel = { new: 'قيد الانتظار', seen: 'تمت المشاهدة', fulfilled: 'تم التجهيز' };
    el.innerHTML = `<table class="tbl"><thead><tr><th>التاريخ</th><th>المورّد</th><th>المنتجات</th><th>الحالة</th></tr></thead><tbody>
      ${orders.map(o => `<tr>
        <td>${fmtDate(o.createdAt)}</td>
        <td>${escapeHtml(o.supplierName)}</td>
        <td>${o.items.map(i => `${escapeHtml(i.name)} × ${i.quantity}`).join('، ')}</td>
        <td><span class="badge status-${o.status || 'new'}">${statusLabel[o.status] || 'قيد الانتظار'}</span></td>
      </tr>`).join('')}
    </tbody></table>`;
  } catch (err) {
    firebaseErrorToast(err);
    el.innerHTML = '<div class="empty-state"><span class="emoji">⚠️</span>تعذر تحميل طلباتك.</div>';
  }
}

/* ============================================================
   لوحة تحكم المورّد
   ============================================================ */
function wireSupplierDashboardUi() {
  document.getElementById('supplierNav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;
    switchSupplierView(btn.dataset.sview);
  });

  document.getElementById('addSupplierProductBtn').addEventListener('click', () => openSupplierProductModal());
  document.getElementById('supplierProductCancel').addEventListener('click', () => {
    document.getElementById('supplierProductModal').classList.add('hidden');
  });
  document.getElementById('supplierProductModal').addEventListener('click', (e) => {
    if (e.target.id === 'supplierProductModal') document.getElementById('supplierProductCancel').click();
  });
  document.getElementById('supplierProductForm').addEventListener('submit', submitSupplierProduct);
  document.getElementById('supplierMyProductsSearch').addEventListener('input', (e) => {
    renderMySupplierProductsTable(e.target.value);
  });
}

function switchSupplierView(view) {
  document.querySelectorAll('#supplierNav .nav-btn').forEach(b => b.classList.toggle('active', b.dataset.sview === view));
  document.querySelectorAll('#supplierShell .view').forEach(v => v.classList.toggle('active', v.id === 'sview-' + view));
  if (view === 'orders') loadSupplierOrdersInbox();
  if (view === 'products') loadMySupplierProducts();
  if (view === 'stats') loadSupplierStats();
}

async function loadSupplierOrdersInbox() {
  const el = document.getElementById('supplierOrdersTable');
  el.innerHTML = '<p class="hint">جارِ التحميل...</p>';
  try {
    const db = getFirebaseDb();
    const snap = await withTimeout(db.ref('orders').orderByChild('supplierId').equalTo(currentSupplierSession.id).once('value'));
    const all = snap.val() || {};
    const orders = Object.entries(all).map(([key, v]) => ({ key, ...v })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    document.getElementById('supplierOrdersCount').textContent = `${orders.length} طلب`;
    if (orders.length === 0) { el.innerHTML = '<div class="empty-state"><span class="emoji">📭</span>لا توجد طلبات واردة بعد.</div>'; return; }
    const statusLabel = { new: 'جديد', seen: 'تمت المشاهدة', fulfilled: 'تم التجهيز' };
    el.innerHTML = `<table class="tbl"><thead><tr><th>التاريخ</th><th>المحل</th><th>المنتجات</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${orders.map(o => `<tr>
        <td>${fmtDate(o.createdAt)}</td>
        <td>${escapeHtml(o.storeName)}</td>
        <td>${o.items.map(i => `${escapeHtml(i.name)} × ${i.quantity}`).join('، ')}</td>
        <td><span class="badge status-${o.status || 'new'}">${statusLabel[o.status] || 'جديد'}</span></td>
        <td>
          ${o.status !== 'seen' && o.status !== 'fulfilled' ? `<button class="link-btn" onclick="markOrderStatus('${o.key}','seen')">تمت المشاهدة</button>` : ''}
          ${o.status !== 'fulfilled' ? `<button class="link-btn" onclick="markOrderStatus('${o.key}','fulfilled')">تم التجهيز</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody></table>`;
  } catch (err) {
    firebaseErrorToast(err);
    el.innerHTML = '<div class="empty-state"><span class="emoji">⚠️</span>تعذر تحميل الطلبات.</div>';
  }
}

async function markOrderStatus(orderKey, status) {
  try {
    const db = getFirebaseDb();
    await db.ref('orders/' + orderKey + '/status').set(status);
    showToast('تم تحديث حالة الطلب', 'success', 1600);
    loadSupplierOrdersInbox();
  } catch (err) { firebaseErrorToast(err); }
}
window.markOrderStatus = markOrderStatus;

async function loadMySupplierProducts() {
  const el = document.getElementById('supplierMyProductsTable');
  el.innerHTML = '<p class="hint">جارِ التحميل...</p>';
  try {
    const db = getFirebaseDb();
    const snap = await withTimeout(db.ref('supplierProducts/' + currentSupplierSession.id).once('value'));
    const all = snap.val() || {};
    _mySupplierProductsCache = Object.entries(all).map(([id, v]) => ({ id, ...v }));
    document.getElementById('supplierProductsCap').textContent = `${_mySupplierProductsCache.length} / ${SUPPLIER_PRODUCT_CAP} منتج`;
    renderMySupplierProductsTable();
  } catch (err) {
    firebaseErrorToast(err);
    el.innerHTML = '<div class="empty-state"><span class="emoji">⚠️</span>تعذر تحميل منتجاتك.</div>';
  }
}

function renderMySupplierProductsTable(filter = '') {
  const el = document.getElementById('supplierMyProductsTable');
  const f = (filter || '').trim().toLowerCase();
  const list = f ? _mySupplierProductsCache.filter(p => (p.name || '').toLowerCase().includes(f) || (p.barcode || '').includes(f)) : _mySupplierProductsCache;
  if (list.length === 0) { el.innerHTML = '<div class="empty-state"><span class="emoji">📦</span>لا توجد منتجات بعد. أضف أول منتج لك.</div>'; return; }
  el.innerHTML = `<table class="tbl"><thead><tr><th>الاسم</th><th>الباركود</th><th>السعر</th><th>الحالة</th><th></th></tr></thead><tbody>
    ${list.map(p => `<tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.barcode)}</td>
      <td>${money(Number(p.price) || 0)}</td>
      <td><span class="badge ${p.available === false ? 'low' : 'ok'}">${p.available === false ? 'غير متوفر' : 'متوفر'}</span></td>
      <td>
        <button class="link-btn" onclick="editSupplierProduct('${p.id}')">تعديل</button>
        <button class="link-btn danger" onclick="deleteSupplierProduct('${p.id}')">حذف</button>
      </td>
    </tr>`).join('')}
  </tbody></table>`;
}

function openSupplierProductModal(product = null) {
  editingSupplierProductId = product ? product.id : null;
  document.getElementById('supplierProductModalTitle').textContent = product ? 'تعديل منتج' : 'إضافة منتج';
  document.getElementById('spId').value = product ? product.id : '';
  document.getElementById('spName').value = product ? product.name : '';
  document.getElementById('spBarcode').value = product ? product.barcode : '';
  document.getElementById('spPrice').value = product ? product.price : '';
  document.getElementById('spImageUrl').value = product ? (product.imageUrl || '') : '';
  document.getElementById('spDescription').value = product ? (product.description || '') : '';
  document.getElementById('spAvailable').checked = product ? product.available !== false : true;
  document.getElementById('supplierProductModal').classList.remove('hidden');
}

async function editSupplierProduct(id) {
  const p = _mySupplierProductsCache.find(x => x.id === id);
  if (!p) return;
  openSupplierProductModal(p);
}
window.editSupplierProduct = editSupplierProduct;

async function deleteSupplierProduct(id) {
  const p = _mySupplierProductsCache.find(x => x.id === id);
  const ok = await confirmDialog('حذف المنتج', `هل تريد حذف "${p ? p.name : ''}" من منتجاتك؟`);
  if (!ok) return;
  try {
    const db = getFirebaseDb();
    await db.ref(`supplierProducts/${currentSupplierSession.id}/${id}`).remove();
    showToast('تم حذف المنتج', 'info');
    loadMySupplierProducts();
  } catch (err) { firebaseErrorToast(err); }
}
window.deleteSupplierProduct = deleteSupplierProduct;

async function submitSupplierProduct(e) {
  e.preventDefault();
  const name = document.getElementById('spName').value.trim();
  const barcode = document.getElementById('spBarcode').value.trim();
  const price = parseFloat(document.getElementById('spPrice').value);
  if (!name || !barcode || isNaN(price)) { showToast('يرجى تعبئة الحقول المطلوبة', 'error'); return; }

  const isNew = !editingSupplierProductId;
  if (isNew && _mySupplierProductsCache.length >= SUPPLIER_PRODUCT_CAP) {
    showToast(`وصلت للحد الأقصى المسموح (${SUPPLIER_PRODUCT_CAP} منتج)`, 'error', 4500);
    return;
  }
  const duplicate = _mySupplierProductsCache.find(p => p.barcode === barcode && p.id !== editingSupplierProductId);
  if (duplicate) { showToast(`الباركود مستخدم مسبقًا للمنتج "${duplicate.name}"`, 'error'); return; }

  const id = editingSupplierProductId || uid();
  const product = {
    name, barcode, price,
    imageUrl: document.getElementById('spImageUrl').value.trim(),
    description: document.getElementById('spDescription').value.trim(),
    available: document.getElementById('spAvailable').checked,
    updatedAt: new Date().toISOString(),
  };
  try {
    const db = getFirebaseDb();
    await db.ref(`supplierProducts/${currentSupplierSession.id}/${id}`).set(product);
    document.getElementById('supplierProductModal').classList.add('hidden');
    showToast(isNew ? 'تمت إضافة المنتج بنجاح ✅' : 'تم تحديث المنتج ✅', 'success');
    loadMySupplierProducts();
  } catch (err) { firebaseErrorToast(err); }
}

async function loadSupplierStats() {
  const grid = document.getElementById('supplierStatGrid');
  grid.innerHTML = '<p class="hint">جارِ التحميل...</p>';
  try {
    const db = getFirebaseDb();
    const [ordersSnap, viewsSnap, productsSnap] = await withTimeout(Promise.all([
      db.ref('orders').orderByChild('supplierId').equalTo(currentSupplierSession.id).once('value'),
      db.ref('productViews/' + currentSupplierSession.id).once('value'),
      db.ref('supplierProducts/' + currentSupplierSession.id).once('value'),
    ]));
    const orders = Object.values(ordersSnap.val() || {});
    const viewsCount = Object.keys(viewsSnap.val() || {}).length;
    const productsCount = Object.keys(productsSnap.val() || {}).length;

    grid.innerHTML = `
      <div class="stat-card good"><div class="label">إجمالي الطلبات</div><div class="value">${orders.length}</div></div>
      <div class="stat-card"><div class="label">محلات شاهدت منتجاتك</div><div class="value">${viewsCount}</div></div>
      <div class="stat-card"><div class="label">عدد منتجاتك</div><div class="value">${productsCount} / ${SUPPLIER_PRODUCT_CAP}</div></div>
    `;

    const qtyMap = {};
    orders.forEach(o => (o.items || []).forEach(i => { qtyMap[i.name] = (qtyMap[i.name] || 0) + Number(i.quantity || 0); }));
    const top = Object.entries(qtyMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxQty = top.length ? top[0][1] : 1;
    const topEl = document.getElementById('supplierTopProducts');
    topEl.innerHTML = top.length
      ? top.map(([name, qty]) => `
          <div class="bar-row">
            <div class="bar-label"><span>${escapeHtml(name)}</span><b>${qty}</b></div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.max(6, (qty / maxQty) * 100)}%"></div></div>
          </div>`).join('')
      : '<p class="hint">لا توجد طلبات كافية بعد لعرض الأكثر طلبًا.</p>';
  } catch (err) {
    firebaseErrorToast(err);
    grid.innerHTML = '';
  }
}
