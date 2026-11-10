// Облачная синхронизация через Firebase: вход Google + Firestore.
// Данные: users/{uid}/chars/{charId} = { json, updatedAt, deleted }. Побеждает более позднее изменение.
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const btn = document.getElementById('syncBtn');
const app = window.dndApp;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS = {
  out: ['☁ Войти', 'Войти через Google, чтобы синхронизировать персонажей', ''],
  load: ['☁ …', 'Подключение…', ''],
  sync: ['☁ ⟳', 'Синхронизация…', 'sync-busy'],
  ok: ['☁ ✓', 'Синхронизировано', 'sync-ok'],
  offline: ['☁ ⨯', 'Нет сети — изменения сохранены и отправятся позже', 'sync-off'],
  err: ['☁ !', 'Ошибка синхронизации', 'sync-err'],
};
let status = 'load';
let user = null;
let pending = 0;
function setStatus(s, detail) {
  status = s;
  const [text, title, cls] = STATUS[s];
  btn.textContent = text;
  btn.title = (user ? `${user.email}\n` : '') + title + (detail ? `\n${detail}` : '');
  btn.className = cls;
}

if (firebaseConfig) start().catch((e) => { btn.hidden = false; setStatus('err', e.message); });

async function start() {
  btn.hidden = false;
  setStatus('load');
  const [{ initializeApp }, A, F, R] = await Promise.all([
    import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js'), import(SDK + 'firebase-database.js'),
  ]);
  const fbApp = initializeApp(firebaseConfig);
  const auth = A.getAuth(fbApp);
  const db = F.initializeFirestore(fbApp, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  const provider = new A.GoogleAuthProvider();
  // Realtime Database — для игрового стола (частые обновления: токены, инициатива, кто онлайн)
  const authListeners = [];
  window.dndFirebase = {
    R, rtdb: firebaseConfig.databaseURL ? R.getDatabase(fbApp) : null,
    user: () => user,
    onUser: (fn) => { authListeners.push(fn); fn(user); },
    signIn: () => signIn(),
  };
  document.dispatchEvent(new Event('dnd-firebase'));
  A.getRedirectResult(auth).catch((e) => app.toast(`Вход не удался: ${esc(e.code || e.message)}`, 'fumble'));

  let unsub = null;
  const charDoc = (id) => F.doc(db, 'users', user.uid, 'chars', id);
  // Последнее известное содержимое документов облака: из него берутся прошлые версии (hist) и корзина (trash)
  const raw = new Map();

  // merge: поля, которых нет в записи (история версий), в облаке сохраняются
  function write(id, data) {
    if (!user) return;
    pending++;
    setStatus(navigator.onLine ? 'sync' : 'offline');
    raw.set(id, { ...(raw.get(id) || {}), ...data });
    F.setDoc(charDoc(id), data, { merge: true })
      .then(() => { pending--; if (!pending) setStatus('ok'); })
      .catch((e) => { pending--; setStatus('err', e.code || e.message); });
  }
  window.dndSync = {
    push: (c, o) => write(c.id, app.cloudPushDoc(c, raw.get(c.id), o && o.force)),
    // Удаление: лист уходит в корзину облака — его можно вернуть в «Версии и корзина»
    remove: (id, json) => write(id, { json: '', updatedAt: Date.now(), deleted: true, trash: json || (raw.get(id) || {}).json || null, deletedAt: Date.now() }),
    signedIn: () => !!user,
  };

  A.onAuthStateChanged(auth, (u) => {
    if (unsub) { unsub(); unsub = null; }
    user = u;
    authListeners.forEach((fn) => fn(u));
    raw.clear();
    // Не вошли — напомнить, что персонажи живут только в этом браузере
    if (!u) { setStatus('out'); setTimeout(() => { if (!user) app.cloudRemind(signIn); }, 4000); return; }
    setStatus('sync');
    let first = true;
    unsub = F.onSnapshot(F.collection(db, 'users', u.uid, 'chars'), (snap) => {
      const docs = snap.docs.map((d) => {
        const x = d.data();
        raw.set(d.id, x);
        let data = null;
        if (!x.deleted) { try { data = JSON.parse(x.json); } catch (e) { return null; } }
        return { id: d.id, deleted: !!x.deleted, updatedAt: x.updatedAt || 0, data };
      }).filter(Boolean);
      app.applyRemote(docs);
      if (first) {
        // Отправить локальных персонажей, которых нет в облаке или которые новее облачных
        first = false;
        const remote = new Map(docs.map((d) => [d.id, d]));
        Object.values(app.chars()).forEach((c) => {
          const r = remote.get(c.id);
          if (!r || (c.updatedAt || 0) > r.updatedAt) window.dndSync.push(c);
        });
      }
      if (!pending) setStatus(navigator.onLine ? 'ok' : 'offline');
    }, (e) => setStatus('err', e.code || e.message));
  });

  window.addEventListener('online', () => { if (user) setStatus(pending ? 'sync' : 'ok'); });
  window.addEventListener('offline', () => { if (user) setStatus('offline'); });

  async function signIn() {
    try { await A.signInWithPopup(auth, provider); }
    catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) {
        await A.signInWithRedirect(auth, provider);
      } else if (e.code !== 'auth/popup-closed-by-user') {
        app.toast(`Вход не удался: ${esc(e.code || e.message)}`, 'fumble');
      }
    }
  }

  btn.addEventListener('click', () => {
    if (!user) { signIn(); return; }
    const [, title] = STATUS[status];
    app.openModal(`<h2>☁ Синхронизация</h2>
      <p>Аккаунт: <b>${esc(user.email)}</b><br><span class="muted">${esc(title)}</span></p>
      <p class="muted small">Персонажи автоматически сохраняются в облаке и появляются на всех устройствах, где вы вошли этим аккаунтом. При одновременных изменениях побеждает более позднее — прошлые версии и удалённые персонажи хранятся, их можно вернуть.</p>
      <div class="modal-actions"><button id="syncOut" class="danger">Выйти</button><button id="syncHist">🕘 Версии и корзина</button><button data-act="closeModal">Закрыть</button></div>`);
    document.getElementById('syncHist').onclick = () => app.openCloudHistory([...raw.entries()], !!user);
    document.getElementById('syncOut').onclick = async () => {
      app.closeModal();
      await A.signOut(auth);
      app.toast('Вы вышли. Персонажи остались на этом устройстве.');
    };
  });
}
