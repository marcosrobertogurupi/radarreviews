import crypto from 'node:crypto'

/**
 * Módulo de Criptografia para tokens sensíveis (Meta, etc.)
 * Usa AES-256-GCM para garantir confidencialidade e integridade.
 */

// A ENCRYPTION_KEY deve ser uma string de 64 caracteres hexadecimais (32 bytes)
const ENCRYPTION_KEY = process.env['ENCRYPTION_KEY'] || 'a'.repeat(64); // Fallback apenas para desenvolvimento
const IV_LENGTH = 12; // Para GCM, 12 bytes é o recomendado
const AUTH_TAG_LENGTH = 16;

/**
 * Criptografa uma string usando AES-256-GCM.
 * Retorna uma string no formato: iv_hex:auth_tag_hex:encrypted_hex
 */
export function encrypt(text: string): string {
  if (!text) return '';
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Descriptografa uma string gerada pela função encrypt.
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return '';
  
  try {
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    if (!ivHex || !authTagHex || !encrypted) {
      throw new Error('Formato de criptografia inválido');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (err) {
    console.error('[crypto] Erro ao descriptografar:', err instanceof Error ? err.message : String(err));
    return '';
  }
}
