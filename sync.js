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
  const [{ initializeApp }, A, F] = await Promise.all([
    import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js'),
  ]);
  const fbApp = initializeApp(firebaseConfig);
  const auth = A.getAuth(fbApp);
  const db = F.initializeFirestore(fbApp, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  const provider = new A.GoogleAuthProvider();
  A.getRedirectResult(auth).catch((e) => app.toast(`Вход не удался: ${esc(e.code || e.message)}`, 'fumble'));

  let unsub = null;
  const charDoc = (id) => F.doc(db, 'users', user.uid, 'chars', id);

  function write(id, data) {
    if (!user) return;
    pending++;
    setStatus(navigator.onLine ? 'sync' : 'offline');
    F.setDoc(charDoc(id), data)
      .then(() => { pending--; if (!pending) setStatus('ok'); })
      .catch((e) => { pending--; setStatus('err', e.code || e.message); });
  }
  window.dndSync = {
    push: (c) => write(c.id, { json: JSON.stringify(c), updatedAt: c.updatedAt || Date.now(), deleted: false }),
    remove: (id) => write(id, { json: '', updatedAt: Date.now(), deleted: true }),
  };

  A.onAuthStateChanged(auth, (u) => {
    if (unsub) { unsub(); unsub = null; }
    user = u;
    if (!u) { setStatus('out'); return; }
    setStatus('sync');
    let first = true;
    unsub = F.onSnapshot(F.collection(db, 'users', u.uid, 'chars'), (snap) => {
      const docs = snap.docs.map((d) => {
        const x = d.data();
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
      <p class="muted small">Персонажи автоматически сохраняются в облаке и появляются на всех устройствах, где вы вошли этим аккаунтом. При одновременных изменениях побеждает более позднее.</p>
      <div class="modal-actions"><button id="syncOut" class="danger">Выйти</button><button data-act="closeModal">Закрыть</button></div>`);
    document.getElementById('syncOut').onclick = async () => {
      app.closeModal();
      await A.signOut(auth);
      app.toast('Вы вышли. Персонажи остались на этом устройстве.');
    };
  });
}
