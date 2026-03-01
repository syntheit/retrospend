#!/bin/bash
set -euo pipefail

# Database backup script for Retrospend
# Schedule via cron: 0 3 * * * /path/to/backup-db.sh >> /var/log/retrospend-backup.log 2>&1

BACKUP_DIR="${BACKUP_DIR:-/backups/retrospend}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/retrospend_${TIMESTAMP}.sql.gz"

# Container name (matches docker-compose.yml)
CONTAINER_NAME="${POSTGRES_CONTAINER:-retrospend-postgres}"
DB_NAME="${POSTGRES_DB_NAME:-retrospend}"
DB_USER="${POSTGRES_USER:-postgres}"

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting database backup..."

# Dump database from running container, compress with gzip
docker exec "${CONTAINER_NAME}" \
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" --no-owner --no-privileges \
  | gzip > "${BACKUP_FILE}"

# Verify the backup is not empty
FILESIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}" 2>/dev/null)
if [ "${FILESIZE}" -lt 100 ]; then
  echo "[$(date)] ERROR: Backup file is suspiciously small (${FILESIZE} bytes). Backup may have failed."
  rm -f "${BACKUP_FILE}"
  exit 1
fi

echo "[$(date)] Backup created: ${BACKUP_FILE} ($(numfmt --to=iec ${FILESIZE} 2>/dev/null || echo "${FILESIZE} bytes"))"

# Clean up old backups
DELETED=$(find "${BACKUP_DIR}" -name "retrospend_*.sql.gz" -mtime +"${RETENTION_DAYS}" -delete -print | wc -l)
if [ "${DELETED}" -gt 0 ]; then
  echo "[$(date)] Cleaned up ${DELETED} backup(s) older than ${RETENTION_DAYS} days"
fi

echo "[$(date)] Backup complete."
