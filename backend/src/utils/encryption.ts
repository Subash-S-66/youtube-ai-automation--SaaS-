import crypto from 'crypto';

const algorithm = 'aes-256-cbc';

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

const IV_LENGTH = 16;

export function encrypt(text: string): string {
    if (!text) return text;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(ENCRYPTION_KEY as string), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(text: string): string {
    if (!text) return text;
    const textParts = text.split(':');

    // Check if it looks like an encrypted string
    if (textParts.length !== 2) return text;

    try {
        const iv = Buffer.from(textParts[0] as string, 'hex');
        const encryptedText = Buffer.from(textParts[1] as string, 'hex');
        const decipher = crypto.createDecipheriv(algorithm, Buffer.from(ENCRYPTION_KEY as string), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        // If decryption fails (e.g. data was plain text or key changed), return raw
        return text;
    }
}
