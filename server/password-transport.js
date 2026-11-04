'use strict';

const crypto = require('node:crypto');

// The key lives only for this process. Challenges and ciphertext from an earlier
// process cannot be used after a restart.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const challenges = new Map();
const TTL_MS = 2 * 60_000;

function challenge() {
  const now = Date.now();
  for (const [id, expiresAt] of challenges) if (expiresAt <= now) challenges.delete(id);
  if (challenges.size >= 5000) throw Object.assign(new Error('请求过于频繁，请稍后重试'), { status: 429 });
  const id = crypto.randomBytes(24).toString('base64url');
  challenges.set(id, now + TTL_MS);
  return { publicKey, challenge: id };
}

function decrypt(body) {
  const { passwordCiphertext, passwordKey, passwordIv, passwordTag, passwordChallenge } = body;
  if (typeof passwordCiphertext !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(passwordCiphertext) ||
      passwordCiphertext.length > 1400 || typeof passwordKey !== 'string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(passwordKey) || passwordKey.length > 400 ||
      typeof passwordIv !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(passwordIv) || passwordIv.length > 32 ||
      typeof passwordTag !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(passwordTag) || passwordTag.length > 32 ||
      typeof passwordChallenge !== 'string' ||
      !/^[A-Za-z0-9_-]{32}$/.test(passwordChallenge))
    throw Object.assign(new Error('密码密文无效，请重试'), { status: 400 });
  const expiresAt = challenges.get(passwordChallenge);
  challenges.delete(passwordChallenge);
  if (!expiresAt || expiresAt <= Date.now())
    throw Object.assign(new Error('密码提交已过期，请重试'), { status: 400 });
  try {
    const key = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256' }, Buffer.from(passwordKey, 'base64'));
    const iv = Buffer.from(passwordIv, 'base64');
    const tag = Buffer.from(passwordTag, 'base64');
    if (key.length !== 32 || iv.length !== 12 || tag.length !== 16) throw new Error('invalid cipher');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(Buffer.from(passwordCiphertext, 'base64')),
      decipher.final()]).toString('utf8');
    const value = JSON.parse(plaintext);
    if (value.challenge !== passwordChallenge || typeof value.password !== 'string' || value.password.length > 128)
      throw new Error('invalid payload');
    return value.password;
  } catch (_) { throw Object.assign(new Error('密码密文无效，请重试'), { status: 400 }); }
}

module.exports = { challenge, decrypt };
