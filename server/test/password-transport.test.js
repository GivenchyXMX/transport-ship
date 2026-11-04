'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const forge = require('node-forge');
const transport = require('../password-transport');

function encrypt(publicKey, challenge, password, innerChallenge = challenge) {
  const key = forge.random.getBytesSync(32);
  const iv = forge.random.getBytesSync(12);
  const cipher = forge.cipher.createCipher('AES-GCM', key);
  cipher.start({ iv, tagLength: 128 });
  cipher.update(forge.util.createBuffer(forge.util.encodeUtf8(JSON.stringify({ password, challenge: innerChallenge }))));
  assert.equal(cipher.finish(), true);
  return {
    passwordCiphertext: forge.util.encode64(cipher.output.getBytes()),
    passwordKey: forge.util.encode64(forge.pki.publicKeyFromPem(publicKey).encrypt(key, 'RSA-OAEP', {
      md: forge.md.sha256.create(), mgf1: { md: forge.md.sha256.create() },
    })),
    passwordIv: forge.util.encode64(iv),
    passwordTag: forge.util.encode64(cipher.mode.tag.getBytes()),
    passwordChallenge: challenge,
  };
}

test('浏览器 RSA-OAEP 密文可解密，挑战值只能使用一次', () => {
  const { publicKey, challenge } = transport.challenge();
  const body = encrypt(publicKey, challenge, '测试password123');
  assert.equal(transport.decrypt(body), '测试password123');
  assert.throws(() => transport.decrypt(body), /过期/);
});

test('明文密码和错误挑战值不能提交', () => {
  assert.throws(() => transport.decrypt({ password: 'password123' }), /密文无效/);
  const { publicKey, challenge } = transport.challenge();
  assert.throws(() => transport.decrypt(encrypt(publicKey, challenge, 'password123', 'other')), /密文无效/);
});
