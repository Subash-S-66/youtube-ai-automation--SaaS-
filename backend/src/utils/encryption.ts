import crypto from 'crypto';

const algorithm = 'aes-256-gcm';
const legacyAlgorithm = 'aes-256-cbc';

const isProduction = process.env.NODE_ENV === 'production';
let ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

// Safe fallback for development
if (!ENCRYPTION_KEY) {
  if (isProduction) {
    throw new Error('ENCRYPTION_KEY must be set in production');
  } else {
    console.warn('⚠️ No ENCRYPTION_KEY provided. Using a fallback key for development ONLY.');
    ENCRYPTION_KEY = 'a-fallback-dev-key-must-be-32-by';
  }
}

// Ensure the key is exactly 32 bytes (256 bits) long.
if (isProduction && ENCRYPTION_KEY.length !== 32) {
  throw new Error('ENCRYPTION_KEY must be exactly 32 characters in production');
}
if (ENCRYPTION_KEY.length !== 32) {
  console.warn('⚠️ ENCRYPTION_KEY must be exactly 32 bytes. Padding/truncating for dev mode.');
  ENCRYPTION_KEY = ENCRYPTION_KEY.padEnd(32, '0').substring(0, 32);
}

const KEY_BUFFER = Buffer.from(ENCRYPTION_KEY as string, 'utf8');
const IV_LENGTH = 12;

export function encrypt(text: string): string {
    if (!text) return text;
    const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(algorithm, KEY_BUFFER, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(text: string): string {
    if (!text) return text;
    const textParts = text.split(':');

    try {
    if (textParts.length === 3) {
      const iv = Buffer.from(textParts[0] as string, 'hex');
      const authTag = Buffer.from(textParts[1] as string, 'hex');
      const encryptedText = Buffer.from(textParts[2] as string, 'hex');
      const decipher = crypto.createDecipheriv(algorithm, KEY_BUFFER, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
      return decrypted.toString('utf8');
    }

    // Backward compatibility for legacy AES-CBC payloads: iv:ciphertext
    if (textParts.length === 2) {
      const iv = Buffer.from(textParts[0] as string, 'hex');
      const encryptedText = Buffer.from(textParts[1] as string, 'hex');
      const decipher = crypto.createDecipheriv(legacyAlgorithm, KEY_BUFFER, iv);
      const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
      return decrypted.toString('utf8');
    }

    return text;
    } catch (e) {
        // If decryption fails (e.g. data was plain text or key changed), return raw
        return text;
    }
}
