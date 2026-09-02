import crypto from 'node:crypto';
import { sha256 } from './utils.js';

const VERSION = 1;

function secretKey() {
  const secret = process.env.CONFIG_SECRET || '';
  return secret ? sha256(secret) : null;
}

export function encodeConfig(config) {
  const payload = Buffer.from(JSON.stringify({
    ...config,
    uid: config.uid || crypto.randomUUID(),
    v: VERSION
  }), 'utf8');
  const key = secretKey();
  if (!key) return `dev.${payload.toString('base64url')}`;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${Buffer.concat([iv, tag, ciphertext]).toString('base64url')}`;
}

export function decodeConfig(token) {
  if (!token || typeof token !== 'string') throw new Error('Missing addon configuration.');
  let data;
  if (token.startsWith('dev.')) {
    data = JSON.parse(Buffer.from(token.slice(4), 'base64url').toString('utf8'));
  } else if (token.startsWith('v1.')) {
    const key = secretKey();
    if (!key) throw new Error('CONFIG_SECRET is not set on this server.');
    const raw = Buffer.from(token.slice(3), 'base64url');
    if (raw.length < 29) throw new Error('Invalid configuration token.');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    data = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
  } else {
    throw new Error('Unsupported configuration token.');
  }
  validateConfig(data);
  return data;
}

export function validateConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Invalid configuration.');
  if (!String(config.username || '').trim()) throw new Error('KRA username is required.');
  if (!String(config.password || '')) throw new Error('KRA password is required.');
  if (!config.uid || !/^[0-9a-f-]{20,}$/i.test(config.uid)) throw new Error('Invalid device UUID in configuration.');
  return true;
}

export function configSecurityMode() {
  return secretKey() ? 'encrypted' : 'development-base64';
}
