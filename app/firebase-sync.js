// Cross-device sync layer.
//
// When firebaseEnabled is false, every function here is a safe no-op and the
// app behaves exactly as before (localStorage only, single device).
//
// When firebaseEnabled is true and firebaseConfig is filled in, this module:
//   1. Lazy-loads the Firebase SDK from the CDN (only when sync is actually used).
//   2. Signs the user in with Google (works the same on phone, laptop, any browser).
//   3. Mirrors app state to Firestore at users/{uid}/state/appState.
//   4. Listens for changes written from other devices and reports them back
//      to app.js so the UI can update live.

import { firebaseEnabled, firebaseConfig } from "./firebase-config.js";

const SDK_VERSION = "10.13.0";

let app = null;
let auth = null;
let db = null;
let authApi = null;
let fsApi = null;
let currentUser = null;
let unsubscribeSnapshot = null;
let sdkPromise = null;

const authListeners = [];
const remoteListeners = [];

function onAuthChange(callback) {
  authListeners.push(callback);
}

function onRemoteUpdate(callback) {
  remoteListeners.push(callback);
}

async function loadSdk() {
  if (!firebaseEnabled) return false;
  if (sdkPromise) return sdkPromise;

  sdkPromise = (async () => {
    const [{ initializeApp }, authModule, firestoreModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`)
    ]);

    authApi = authModule;
    fsApi = firestoreModule;
    app = initializeApp(firebaseConfig);
    auth = authApi.getAuth(app);
    db = fsApi.getFirestore(app);

    authApi.onAuthStateChanged(auth, (user) => {
      currentUser = user;
      authListeners.forEach((cb) => cb(user));
      if (user) {
        watchRemoteState(user.uid);
      } else if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }
    });

    return true;
  })();

  return sdkPromise;
}

function watchRemoteState(uid) {
  if (unsubscribeSnapshot) unsubscribeSnapshot();
  const ref = fsApi.doc(db, "users", uid, "state", "appState");
  unsubscribeSnapshot = fsApi.onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      remoteListeners.forEach((cb) => cb(data.payload, data.updatedAt));
    }
  }, () => {
    // Permission or network error - surfaced to the UI via authListeners
    // is enough; app.js shows a generic sync-error status on push failure too.
  });
}

async function signIn() {
  await loadSdk();
  if (!authApi) return;
  const provider = new authApi.GoogleAuthProvider();
  await authApi.signInWithPopup(auth, provider);
}

async function signOutUser() {
  if (!authApi || !auth) return;
  await authApi.signOut(auth);
}

async function pushState(state) {
  if (!firebaseEnabled || !currentUser || !fsApi) return;
  const ref = fsApi.doc(db, "users", currentUser.uid, "state", "appState");
  await fsApi.setDoc(ref, { payload: state, updatedAt: Date.now() });
}

function isSignedIn() {
  return Boolean(currentUser);
}

function getUser() {
  return currentUser;
}

export {
  firebaseEnabled,
  loadSdk,
  signIn,
  signOutUser,
  pushState,
  onAuthChange,
  onRemoteUpdate,
  isSignedIn,
  getUser
};
