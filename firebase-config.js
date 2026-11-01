// Конфиг Firebase для синхронизации персонажей между устройствами.
// Взять: консоль Firebase → Project settings → Your apps → Web app → SDK setup and configuration → Config.
// Конфиг не секретный: доступ к данным защищают правила Firestore (каждый видит только своих персонажей).
// Если заменить на null, синхронизация выключится и кнопка входа скроется.
export const firebaseConfig = {
  apiKey: 'AIzaSyCbx4pgP0LO9mAwQXx54GkjvT-NlP_svzg',
  authDomain: 'dnd-sheet-4d594.firebaseapp.com',
  projectId: 'dnd-sheet-4d594',
  storageBucket: 'dnd-sheet-4d594.firebasestorage.app',
  messagingSenderId: '661867101284',
  appId: '1:661867101284:web:1a305a99a40742e043b371',
  databaseURL: 'https://dnd-sheet-4d594-default-rtdb.europe-west1.firebasedatabase.app',
};
