"""SQLite-backed store for the Pakalon bridge.

Tables:
  - bridge_users:        per-user account record (tier, JWT, deposit).
  - bridge_device_codes: short-lived 6-digit pairing codes.
  - bridge_usage:        per-model token + cost ledger.
  - bridge_invoices:     Polar invoice mirror (post-paid).
  - bridge_auditor:      last auditor report per (user, project).
  - bridge_model_cache:  cached OpenRouter model catalog.
  - bridge_telegram:     encrypted bot tokens (Telegram /connect).

Follows the robomp `db.py` pattern: WAL mode, `BEGIN IMMEDIATE` for
claim contention, `INSERT OR IGNORE` for idempotency, `@dataclass`
row types. Thread-safe via an internal `_lock`.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import SecretStr

Tier = Literal["free", "pro", "unknown"]

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bridge_users (
    user_id        TEXT PRIMARY KEY,
    email          TEXT,
    tier           TEXT NOT NULL DEFAULT 'free'
                   CHECK (tier IN ('free','pro','unknown')),
    api_key_enc    TEXT,
    jwt_hash       TEXT,
    deposit_cents  INTEGER NOT NULL DEFAULT 0,
    trial_ends_at  TEXT,
    created_at     TEXT NOT NULL,
    last_seen_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bridge_users_tier ON bridge_users(tier);

CREATE TABLE IF NOT EXISTS bridge_device_codes (
    code         TEXT PRIMARY KEY,
    device_id    TEXT NOT NULL,
    user_id      TEXT,
    expires_at   INTEGER NOT NULL,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bridge_device_codes_expires
    ON bridge_device_codes(expires_at);

CREATE TABLE IF NOT EXISTS bridge_usage (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL,
    project_hash  TEXT NOT NULL,
    session_id    TEXT,
    model_id      TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_usd      REAL NOT NULL,
    period        TEXT NOT NULL,  -- YYYY-MM
    ts            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bridge_usage_user_period
    ON bridge_usage(user_id, period);

CREATE TABLE IF NOT EXISTS bridge_invoices (
    invoice_id   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    status       TEXT NOT NULL,
    due_date     TEXT NOT NULL,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bridge_invoices_due
    ON bridge_invoices(due_date, status);

CREATE TABLE IF NOT EXISTS bridge_auditor (
    user_id      TEXT NOT NULL,
    project_hash TEXT NOT NULL,
    report_md    TEXT NOT NULL,
    iteration    INTEGER NOT NULL,
    status       TEXT NOT NULL,  -- 'clean' | 'partial' | 'missing'
    created_at   TEXT NOT NULL,
    PRIMARY KEY (user_id, project_hash, iteration)
);

CREATE TABLE IF NOT EXISTS bridge_model_cache (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    provider      TEXT NOT NULL,
    context_length INTEGER NOT NULL,
    prompt_price  REAL NOT NULL,
    completion_price REAL NOT NULL,
    tier          TEXT NOT NULL,
    fetched_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bridge_model_cache_tier
    ON bridge_model_cache(tier, provider);

CREATE TABLE IF NOT EXISTS bridge_telegram (
    user_id        TEXT PRIMARY KEY,
    bot_token_enc  TEXT NOT NULL,
    webhook_url    TEXT,
    connected_at   TEXT NOT NULL
);
"""


@dataclass(slots=True, frozen=True)
class UserRow:
    user_id: str
    email: str | None
    tier: Tier
    deposit_cents: int
    trial_ends_at: str | None
    created_at: str
    last_seen_at: str


@dataclass(slots=True, frozen=True)
class DeviceCodeRow:
    code: str
    device_id: str
    user_id: str | None
    expires_at: int
    created_at: str


@dataclass(slots=True, frozen=True)
class UsageRow:
    user_id: str
    project_hash: str
    session_id: str | None
    model_id: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    period: str
    ts: str


@dataclass(slots=True, frozen=True)
class InvoiceRow:
    invoice_id: str
    user_id: str
    amount_cents: int
    status: str
    due_date: str
    created_at: str


@dataclass(slots=True, frozen=True)
class ModelCacheRow:
    id: str
    name: str
    provider: str
    context_length: int
    prompt_price: float
    completion_price: float
    tier: Tier
    fetched_at: str


class BridgeStore:
    """Thread-safe SQLite store for the Pakalon bridge."""

    def __init__(self, sqlite_path: Path) -> None:
        self._path = sqlite_path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_schema()

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(SCHEMA)

    @contextmanager
    def _connect(self):
        conn = sqlite3.connect(self._path, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            with self._lock:
                yield conn
        finally:
            conn.close()

    def close(self) -> None:
        """For tests: drop the connection. Schema is re-opened lazily."""
        pass  # each op opens & closes; nothing to release

    # ────────────────────────── Users ──────────────────────────

    def upsert_user(
        self,
        user_id: str,
        email: str | None,
        tier: Tier,
        deposit_cents: int = 0,
        trial_ends_at: str | None = None,
    ) -> UserRow:
        now = _now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO bridge_users (user_id, email, tier, deposit_cents, trial_ends_at, created_at, last_seen_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    email = COALESCE(excluded.email, email),
                    tier = excluded.tier,
                    deposit_cents = bridge_users.deposit_cents + excluded.deposit_cents,
                    trial_ends_at = COALESCE(excluded.trial_ends_at, trial_ends_at),
                    last_seen_at = excluded.last_seen_at
                """,
                (user_id, email, tier, deposit_cents, trial_ends_at, now, now),
            )
        return self.get_user(user_id)  # type: ignore[return-value]

    def get_user(self, user_id: str) -> UserRow | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM bridge_users WHERE user_id = ?", (user_id,)
            ).fetchone()
        if row is None:
            return None
        return _row_to_user(row)

    def set_user_tier(self, user_id: str, tier: Tier) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE bridge_users SET tier = ?, last_seen_at = ? WHERE user_id = ?",
                (tier, _now_iso(), user_id),
            )
        return cur.rowcount > 0

    def store_api_key(self, user_id: str, api_key_enc: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE bridge_users SET api_key_enc = ? WHERE user_id = ?",
                (api_key_enc, user_id),
            )
        return cur.rowcount > 0

    def store_jwt_hash(self, user_id: str, jwt_hash: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE bridge_users SET jwt_hash = ? WHERE user_id = ?",
                (jwt_hash, user_id),
            )
        return cur.rowcount > 0

    def lookup_user_by_jwt(self, jwt_hash: str) -> UserRow | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM bridge_users WHERE jwt_hash = ?", (jwt_hash,)
            ).fetchone()
        return _row_to_user(row) if row else None

    # ──────────────────────── Device codes ────────────────────────

    def store_device_code(
        self, code: str, device_id: str, expires_at: int
    ) -> DeviceCodeRow:
        row = DeviceCodeRow(
            code=code,
            device_id=device_id,
            user_id=None,
            expires_at=expires_at,
            created_at=_now_iso(),
        )
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO bridge_device_codes (code, device_id, user_id, expires_at, created_at)
                VALUES (?, ?, NULL, ?, ?)
                ON CONFLICT(code) DO UPDATE SET
                    device_id = excluded.device_id,
                    expires_at = excluded.expires_at,
                    user_id = NULL
                """,
                (code, device_id, expires_at, row.created_at),
            )
        return row

    def consume_device_code(self, code: str, user_id: str) -> DeviceCodeRow | None:
        """Atomically claim a code by binding it to a user. Returns None
        if the code is unknown, expired, or already consumed."""
        now_ms = _now_ms()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT * FROM bridge_device_codes WHERE code = ?", (code,)
            ).fetchone()
            if row is None:
                conn.execute("ROLLBACK")
                return None
            if row["expires_at"] < now_ms:
                conn.execute("DELETE FROM bridge_device_codes WHERE code = ?", (code,))
                conn.execute("COMMIT")
                return None
            if row["user_id"] is not None:
                conn.execute("ROLLBACK")
                return None
            conn.execute(
                "UPDATE bridge_device_codes SET user_id = ? WHERE code = ?",
                (user_id, code),
            )
            conn.execute("COMMIT")
        return DeviceCodeRow(
            code=row["code"],
            device_id=row["device_id"],
            user_id=user_id,
            expires_at=row["expires_at"],
            created_at=row["created_at"],
        )

    def get_device_code(self, code: str) -> DeviceCodeRow | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM bridge_device_codes WHERE code = ?", (code,)
            ).fetchone()
        return _row_to_device_code(row) if row else None

    def cleanup_expired_codes(self) -> int:
        now_ms = _now_ms()
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM bridge_device_codes WHERE expires_at < ?", (now_ms,)
            )
        return cur.rowcount

    # ────────────────────────── Usage ──────────────────────────

    def record_usage(self, event: UsageRow) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO bridge_usage
                  (user_id, project_hash, session_id, model_id,
                   input_tokens, output_tokens, cost_usd, period, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event.user_id, event.project_hash, event.session_id,
                    event.model_id, event.input_tokens, event.output_tokens,
                    event.cost_usd, event.period, event.ts,
                ),
            )

    def usage_summary(self, user_id: str, period: str) -> dict[str, Any]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT model_id,
                       SUM(input_tokens) AS input_tokens,
                       SUM(output_tokens) AS output_tokens,
                       SUM(cost_usd) AS cost_usd
                  FROM bridge_usage
                 WHERE user_id = ? AND period = ?
                 GROUP BY model_id
                """,
                (user_id, period),
            ).fetchall()
        breakdown = [
            {
                "model_id": r["model_id"],
                "input_tokens": int(r["input_tokens"]),
                "output_tokens": int(r["output_tokens"]),
                "cost_usd": float(r["cost_usd"]),
            }
            for r in rows
        ]
        total_tokens = sum(b["input_tokens"] + b["output_tokens"] for b in breakdown)
        total_cost = sum(b["cost_usd"] for b in breakdown)
        return {
            "period": period,
            "total_tokens": total_tokens,
            "total_cost": total_cost,
            "platform_fee": round(total_cost * 0.1, 6),
            "breakdown": breakdown,
        }

    # ────────────────────────── Invoices ──────────────────────────

    def record_invoice(self, inv: InvoiceRow) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO bridge_invoices
                  (invoice_id, user_id, amount_cents, status, due_date, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(invoice_id) DO UPDATE SET
                    status = excluded.status,
                    amount_cents = excluded.amount_cents,
                    due_date = excluded.due_date
                """,
                (
                    inv.invoice_id, inv.user_id, inv.amount_cents,
                    inv.status, inv.due_date, inv.created_at,
                ),
            )

    def due_invoices_within(self, days: int) -> list[InvoiceRow]:
        """All invoices with due_date in (today, today+days) and status='pending'."""
        today = datetime.now(tz=UTC).date().isoformat()
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM bridge_invoices
                 WHERE status = 'pending' AND due_date >= ? AND due_date <= date(?, '+' || ? || ' days')
                 ORDER BY due_date
                """,
                (today, today, days),
            ).fetchall()
        return [_row_to_invoice(r) for r in rows]

    # ────────────────────────── Auditor ──────────────────────────

    def save_auditor_report(
        self,
        user_id: str,
        project_hash: str,
        iteration: int,
        report_md: str,
        status: str,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO bridge_auditor
                  (user_id, project_hash, report_md, iteration, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, project_hash, iteration) DO UPDATE SET
                    report_md = excluded.report_md,
                    status = excluded.status,
                    created_at = excluded.created_at
                """,
                (user_id, project_hash, report_md, iteration, status, _now_iso()),
            )

    def latest_auditor(
        self, user_id: str, project_hash: str
    ) -> tuple[int, str, str] | None:
        """Returns (iteration, report_md, status) of the most recent report."""
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT iteration, report_md, status FROM bridge_auditor
                 WHERE user_id = ? AND project_hash = ?
                 ORDER BY iteration DESC LIMIT 1
                """,
                (user_id, project_hash),
            ).fetchone()
        if row is None:
            return None
        return (int(row["iteration"]), str(row["report_md"]), str(row["status"]))

    # ────────────────────────── Models cache ──────────────────────────

    def replace_model_cache(self, rows: list[ModelCacheRow]) -> int:
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DELETE FROM bridge_model_cache")
            conn.executemany(
                """
                INSERT INTO bridge_model_cache
                  (id, name, provider, context_length, prompt_price, completion_price, tier, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        r.id, r.name, r.provider, r.context_length,
                        r.prompt_price, r.completion_price, r.tier, r.fetched_at,
                    )
                    for r in rows
                ],
            )
            conn.execute("COMMIT")
        return len(rows)

    def list_model_cache(self, tier: Tier | None = None) -> list[ModelCacheRow]:
        with self._connect() as conn:
            if tier is None:
                rows = conn.execute(
                    "SELECT * FROM bridge_model_cache ORDER BY provider, id"
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM bridge_model_cache WHERE tier = ? ORDER BY provider, id",
                    (tier,),
                ).fetchall()
        return [_row_to_model(r) for r in rows]

    def last_model_fetch(self) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT MAX(fetched_at) AS f FROM bridge_model_cache"
            ).fetchone()
        if row is None or row["f"] is None:
            return None
        return str(row["f"])

    # ────────────────────────── Telegram ──────────────────────────

    def store_telegram_token(self, user_id: str, token_enc: SecretStr, webhook_url: str | None) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO bridge_telegram (user_id, bot_token_enc, webhook_url, connected_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    bot_token_enc = excluded.bot_token_enc,
                    webhook_url = excluded.webhook_url,
                    connected_at = excluded.connected_at
                """,
                (user_id, token_enc.get_secret_value(), webhook_url, _now_iso()),
            )

    def get_telegram_token(self, user_id: str) -> tuple[SecretStr, str | None, str] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM bridge_telegram WHERE user_id = ?", (user_id,)
            ).fetchone()
        if row is None:
            return None
        return (
            SecretStr(str(row["bot_token_enc"])),
            row["webhook_url"],
            str(row["connected_at"]),
        )

    def delete_telegram_token(self, user_id: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM bridge_telegram WHERE user_id = ?", (user_id,)
            )
        return cur.rowcount > 0


# ────────────────────────── helpers ──────────────────────────

def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def _now_ms() -> int:
    return int(datetime.now(tz=UTC).timestamp() * 1000)


def _row_to_user(row: sqlite3.Row) -> UserRow:
    return UserRow(
        user_id=str(row["user_id"]),
        email=row["email"],
        tier=row["tier"],  # type: ignore[arg-type]
        deposit_cents=int(row["deposit_cents"]),
        trial_ends_at=row["trial_ends_at"],
        created_at=str(row["created_at"]),
        last_seen_at=str(row["last_seen_at"]),
    )


def _row_to_device_code(row: sqlite3.Row) -> DeviceCodeRow:
    return DeviceCodeRow(
        code=str(row["code"]),
        device_id=str(row["device_id"]),
        user_id=row["user_id"],
        expires_at=int(row["expires_at"]),
        created_at=str(row["created_at"]),
    )


def _row_to_invoice(row: sqlite3.Row) -> InvoiceRow:
    return InvoiceRow(
        invoice_id=str(row["invoice_id"]),
        user_id=str(row["user_id"]),
        amount_cents=int(row["amount_cents"]),
        status=str(row["status"]),
        due_date=str(row["due_date"]),
        created_at=str(row["created_at"]),
    )


def _row_to_model(row: sqlite3.Row) -> ModelCacheRow:
    return ModelCacheRow(
        id=str(row["id"]),
        name=str(row["name"]),
        provider=str(row["provider"]),
        context_length=int(row["context_length"]),
        prompt_price=float(row["prompt_price"]),
        completion_price=float(row["completion_price"]),
        tier=row["tier"],  # type: ignore[arg-type]
        fetched_at=str(row["fetched_at"]),
    )
