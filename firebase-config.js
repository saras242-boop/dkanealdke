/* =========================================================
   دكاني الذكي — إعداد الاتصال بـ Firebase (لميزة الموردين فقط)

   ملاحظة مهمة: هذه الميزة هي الجزء الوحيد في دكاني الذكي الذي
   يعتمد على خادم خارجي (Firebase Realtime Database). كل بقية
   النظام (الكاشير، المخزون، الفواتير...) يعمل محليًا بالكامل
   عبر IndexedDB ولا يحتاج إنترنت.
   ========================================================= */

const FIREBASE_CONFIG = {
  databaseURL: 'https://respict-212a7-default-rtdb.firebaseio.com/',
};

let _firebaseApp = null;
let _firebaseDb = null;

function getFirebaseDb() {
  if (_firebaseDb) return _firebaseDb;
  if (typeof firebase === 'undefined') {
    throw new Error('تعذر تحميل مكتبة Firebase. تحقق من اتصالك بالإنترنت.');
  }
  if (!_firebaseApp) {
    _firebaseApp = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
  }
  _firebaseDb = firebase.database();
  return _firebaseDb;
}
