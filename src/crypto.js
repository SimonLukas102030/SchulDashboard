const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export async function deriveKey(masterPassword, saltB64) {
  const raw = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromB64(saltB64),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    raw,
    { name: 'AES-GCM', length: 256 },
    true,  // extractable so key can be stored in sessionStorage
    ['encrypt', 'decrypt']
  );
}

export function generateSalt() {
  return toB64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

export async function encrypt(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const buf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return { iv: toB64(iv), ciphertext: toB64(new Uint8Array(buf)) };
}

export async function decrypt(key, { iv, ciphertext }) {
  const buf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(iv) },
    key,
    fromB64(ciphertext)
  );
  return new TextDecoder().decode(buf);
}

const toB64 = b => btoa(String.fromCharCode(...b));
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
