import { auth, db } from './firebase.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged as fbOnAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  deleteUser,
} from 'firebase/auth';
import {
  doc, setDoc, getDoc,
  collection, getDocs, deleteDoc,
} from 'firebase/firestore';
import { deriveKey, generateSalt, encrypt, decrypt } from './crypto.js';

const googleProvider = new GoogleAuthProvider();
const VERIFY_TOKEN   = 'schuldashboard-v1';
const SESSION_STORE  = 'sd-session-key';

let _key             = null;
let _setupInProgress = false;

async function persistKey(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  sessionStorage.setItem(SESSION_STORE, btoa(String.fromCharCode(...new Uint8Array(raw))));
}

async function restoreKey() {
  const stored = sessionStorage.getItem(SESSION_STORE);
  if (!stored) return null;
  const raw = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export function clearPersistedKey() {
  sessionStorage.removeItem(SESSION_STORE);
}

export async function emergencyReset() {
  _key = null;
  clearPersistedKey();
  try { await fbSignOut(auth); } catch { /* best-effort */ }
}

export async function tryRestoreSession() {
  if (_key) return true;
  const key = await restoreKey().catch(() => null);
  if (!key) return false;
  _key = key;
  return true;
}

export async function register(email, password, masterPassword) {
  _setupInProgress = true;
  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    const salt = generateSalt();
    const key  = await deriveKey(masterPassword, salt);
    _key = key;
    await persistKey(key);
    try {
      const verify = await encrypt(key, VERIFY_TOKEN);
      await setDoc(doc(db, 'users', user.uid), { salt, verify });
    } catch (err) {
      _key = null;
      clearPersistedKey();
      await fbSignOut(auth);
      throw err;
    }
  } finally {
    _setupInProgress = false;
  }
}

export async function signIn(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}

// Opens a Google OAuth popup. Returns { user, isNewUser } on success.
export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  const snap   = await getDoc(doc(db, 'users', result.user.uid));
  return { user: result.user, isNewUser: !snap.exists() };
}

// Returns true when the current Firebase user has a Firestore doc (salt + verify).
export async function checkHasUserDoc() {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists();
}

export async function setupMasterPassword(masterPassword) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Nicht angemeldet');
  const salt = generateSalt();
  const key  = await deriveKey(masterPassword, salt);
  _key = key;
  await persistKey(key);
  try {
    const verify = await encrypt(key, VERIFY_TOKEN);
    await setDoc(doc(db, 'users', uid), { salt, verify });
  } catch (err) {
    _key = null;
    clearPersistedKey();
    throw err;
  }
}

export async function submitMasterPassword(masterPassword) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Nicht angemeldet');
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) throw new Error('Benutzerdaten nicht gefunden — Konto möglicherweise beschädigt');
  const { salt, verify } = snap.data();
  const key = await deriveKey(masterPassword, salt);
  let result;
  try {
    result = await decrypt(key, verify);
  } catch {
    throw new Error('Falsches Master-Passwort');
  }
  if (result !== VERIFY_TOKEN) throw new Error('Falsches Master-Passwort');
  _key = key;
  await persistKey(key);
}

export async function signOut() {
  _key = null;
  clearPersistedKey();
  await fbSignOut(auth);
}

// Deletes all Firestore data for the current user but keeps the Auth account.
// Used when the user forgot their master password — loses all encrypted credentials.
export async function resetMasterPassword() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Nicht angemeldet');
  const services = await getDocs(collection(db, 'users', uid, 'services'));
  for (const d of services.docs) await deleteDoc(d.ref);
  await deleteDoc(doc(db, 'users', uid));
  _key = null;
  clearPersistedKey();
}

export async function deleteAccount() {
  const user = auth.currentUser;
  if (!user) throw new Error('Nicht angemeldet');
  const uid      = user.uid;
  const services = await getDocs(collection(db, 'users', uid, 'services'));
  for (const d of services.docs) await deleteDoc(d.ref);
  await deleteDoc(doc(db, 'users', uid));
  _key = null;
  clearPersistedKey();
  await deleteUser(user);
}

export function getKey()            { return _key; }
export function isUnlocked()        { return _key !== null && auth.currentUser !== null; }
export function isSetupInProgress() { return _setupInProgress; }
export function getCurrentUser()    { return auth.currentUser; }
export function onAuthStateChanged(cb) { return fbOnAuthStateChanged(auth, cb); }
