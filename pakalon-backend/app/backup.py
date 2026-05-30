"""Backup and disaster recovery for Pakalon backend.

Provides data backup and disaster recovery capabilities for self-hosted deployments.
"""

import json
import logging
import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class BackupResult(BaseModel):
    """Result of a backup operation."""

    success: bool
    backup_id: str
    timestamp: datetime
    size_bytes: int = 0
    error: str | None = None


class RestoreResult(BaseModel):
    """Result of a restore operation."""

    success: bool
    backup_id: str
    timestamp: datetime
    records_restored: int = 0
    error: str | None = None


class BackupManager:
    """Manages data backups for self-hosted deployments."""

    def __init__(self, backup_dir: str | None = None):
        self._backup_dir = backup_dir or os.path.join(
            os.path.expanduser("~"), ".pakalon", "backups"
        )
        self._ensure_backup_dir()

    def _ensure_backup_dir(self) -> None:
        """Ensure backup directory exists."""
        os.makedirs(self._backup_dir, exist_ok=True)

    def create_backup(self, db_path: str) -> BackupResult:
        """Create a backup of the SQLite database."""
        backup_id = f"backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

        try:
            if not os.path.exists(db_path):
                return BackupResult(
                    success=False,
                    backup_id=backup_id,
                    timestamp=datetime.now(),
                    error=f"Database file not found: {db_path}",
                )

            backup_path = os.path.join(self._backup_dir, f"{backup_id}.db")
            shutil.copy2(db_path, backup_path)

            size = os.path.getsize(backup_path)
            logger.info(f"Created backup: {backup_id} ({size} bytes)")

            return BackupResult(
                success=True,
                backup_id=backup_id,
                timestamp=datetime.now(),
                size_bytes=size,
            )
        except Exception as e:
            logger.error(f"Backup failed: {e}")
            return BackupResult(
                success=False,
                backup_id=backup_id,
                timestamp=datetime.now(),
                error=str(e),
            )

    def restore_backup(self, backup_id: str, db_path: str) -> RestoreResult:
        """Restore a backup to the database."""
        try:
            backup_path = os.path.join(self._backup_dir, f"{backup_id}.db")

            if not os.path.exists(backup_path):
                return RestoreResult(
                    success=False,
                    backup_id=backup_id,
                    timestamp=datetime.now(),
                    error=f"Backup file not found: {backup_path}",
                )

            # Count records before restore
            records_before = self._count_records(db_path)

            # Restore
            shutil.copy2(backup_path, db_path)

            # Count records after restore
            records_after = self._count_records(db_path)

            logger.info(f"Restored backup: {backup_id}")

            return RestoreResult(
                success=True,
                backup_id=backup_id,
                timestamp=datetime.now(),
                records_restored=records_after,
            )
        except Exception as e:
            logger.error(f"Restore failed: {e}")
            return RestoreResult(
                success=False,
                backup_id=backup_id,
                timestamp=datetime.now(),
                error=str(e),
            )

    def list_backups(self) -> list[dict[str, Any]]:
        """List all available backups."""
        backups = []

        for filename in os.listdir(self._backup_dir):
            if filename.endswith(".db"):
                filepath = os.path.join(self._backup_dir, filename)
                stat = os.stat(filepath)
                backups.append({
                    "backup_id": filename[:-3],  # Remove .db
                    "timestamp": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "size_bytes": stat.st_size,
                })

        # Sort by timestamp, newest first
        backups.sort(key=lambda x: x["timestamp"], reverse=True)
        return backups

    def delete_backup(self, backup_id: str) -> bool:
        """Delete a backup."""
        try:
            backup_path = os.path.join(self._backup_dir, f"{backup_id}.db")
            if os.path.exists(backup_path):
                os.remove(backup_path)
                logger.info(f"Deleted backup: {backup_id}")
                return True
            return False
        except Exception as e:
            logger.error(f"Delete backup failed: {e}")
            return False

    def _count_records(self, db_path: str) -> int:
        """Count total records in SQLite database."""
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()

            # Get all table names
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = cursor.fetchall()

            total = 0
            for (table_name,) in tables:
                try:
                    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
                    total += cursor.fetchone()[0]
                except Exception:
                    pass

            conn.close()
            return total
        except Exception:
            return 0


# Global instance
backup_manager = BackupManager()
