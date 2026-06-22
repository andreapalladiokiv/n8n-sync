import crypto from 'node:crypto';

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Generate an n8n-style id (default 16 alphanumerics) using CSPRNG bytes. */
export function genId(n = 16): string {
  const b = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ID_ALPHABET[b[i]! % ID_ALPHABET.length];
  return s;
}
