/** JSON escaping and indented backups can be much larger than the 2 MiB VFS content quota. */
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
export const MAX_BACKUP_LABEL = '32 MiB';
export function assertBackupSize(text) {
  if (typeof text !== 'string' || text.length > MAX_BACKUP_BYTES || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) {
    throw new Error(`backup exceeds ${MAX_BACKUP_LABEL}`);
  }
}
