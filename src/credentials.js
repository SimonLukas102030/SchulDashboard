import { db } from './firebase.js';
import {
  doc, setDoc, getDoc, deleteDoc,
  collection, getDocs,
} from 'firebase/firestore';
import { encrypt, decrypt } from './crypto.js';

const svcRef = (uid, id) => doc(db, 'users', uid, 'services', id);

export async function saveCredential(uid, key, serviceId, data) {
  const payload = await encrypt(key, JSON.stringify(data));
  await setDoc(svcRef(uid, serviceId), payload);
}

export async function loadCredential(uid, key, serviceId) {
  const snap = await getDoc(svcRef(uid, serviceId));
  if (!snap.exists()) return null;
  const plain = await decrypt(key, snap.data());
  return JSON.parse(plain);
}

export async function deleteCredential(uid, serviceId) {
  await deleteDoc(svcRef(uid, serviceId));
}

export async function hasCredential(uid, serviceId) {
  return (await getDoc(svcRef(uid, serviceId))).exists();
}

export async function hasAnyService(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'services'));
  return !snap.empty;
}

export async function savePrefs(uid, prefs) {
  await setDoc(doc(db, 'users', uid), prefs, { merge: true });
}

export async function loadPrefs(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return {};
  const { accentColor } = snap.data();
  return { accentColor };
}
