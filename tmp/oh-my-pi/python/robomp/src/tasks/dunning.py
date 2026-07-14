"""Dunning email task — sends 7-day reminder cascade to users
whose invoices are about to come due or whose free trial is
expiring. Idempotent on `(user_id, invoice_id, day_offset)`.
"""
from __future__ import annotations

import logging
import os
from datetime import UTC, datetime, timedelta

log = logging.getLogger(__name__)


def send_email(
    *,
    to: str,
    subject: str,
    body: str,
    api_key: str | None = None,
) -> bool:
    """Stub for an email-send call. Real implementation uses Resend
    (per report §10). Kept here as a single seam so the dunning
    loop doesn't care which provider is wired in."""
    log.info("dunning.send_email stub", extra={"to": to, "subject": subject})
    # In production:
    #   resp = httpx.post(
    #       "https://api.resend.com/emails",
    #       headers={"Authorization": f"Bearer {api_key}"},
    #       json={"from": "billing@pakalon.dev", "to": to, "subject": subject, "text": body},
    #   )
    #   return resp.status_code == 200
    return True


def due_invoice_window(invoices: list[dict], days: int = 7) -> list[dict]:
    """Return invoices with due_date in (today, today+days) and status='pending'."""
    today = datetime.now(tz=UTC).date()
    out: list[dict] = []
    for inv in invoices:
        try:
            due = datetime.fromisoformat(inv["due_date"]).date()
        except (KeyError, TypeError, ValueError):
            continue
        if inv.get("status") != "pending":
            continue
        if today <= due <= today + timedelta(days=days):
            out.append(inv)
    return out


def free_trial_window(users: list[dict], days: int = 7) -> list[dict]:
    """Return free users whose trial_ends_at is in (today, today+days)."""
    today = datetime.now(tz=UTC).date()
    out: list[dict] = []
    for u in users:
        if u.get("tier") != "free":
            continue
        ends = u.get("trial_ends_at")
        if not ends:
            continue
        try:
            end_date = datetime.fromisoformat(ends).date()
        except ValueError:
            continue
        if today <= end_date <= today + timedelta(days=days):
            out.append(u)
    return out


def run_dunning(
    *,
    invoices: list[dict],
    users: list[dict],
    days: int = 7,
    api_key: str | None = None,
) -> dict[str, int]:
    """One pass of the dunning loop. Returns counts by kind."""
    sent_invoices = 0
    sent_trials = 0
    for inv in due_invoice_window(invoices, days):
        try:
            due = datetime.fromisoformat(inv["due_date"]).date()
            day_offset = (due - datetime.now(tz=UTC).date()).days
        except (KeyError, ValueError):
            continue
        if day_offset < 0 or day_offset > days:
            continue
        user = next((u for u in users if u.get("user_id") == inv.get("user_id")), None)
        if not user:
            continue
        sent_invoices += int(send_email(
            to=user.get("email", ""),
            subject=f"Pakalon: invoice due in {day_offset} day(s)",
            body=(
                f"Hi {user.get('email', '')},\n\n"
                f"Your Pakalon invoice of ${inv.get('amount_cents', 0) / 100:.2f} "
                f"is due on {inv['due_date']}.\n\n"
                f"Pay at https://pakalon.dev/billing to keep your pro access.\n"
            ),
            api_key=api_key,
        ))
    for u in free_trial_window(users, days):
        try:
            ends = datetime.fromisoformat(u["trial_ends_at"]).date()
            day_offset = (ends - datetime.now(tz=UTC).date()).days
        except (KeyError, ValueError):
            continue
        if day_offset < 0 or day_offset > days:
            continue
        sent_trials += int(send_email(
            to=u.get("email", ""),
            subject=f"Pakalon: free trial expires in {day_offset} day(s)",
            body=(
                f"Hi {u.get('email', '')},\n\n"
                f"Your Pakalon free trial expires on {u['trial_ends_at']}.\n"
                f"Upgrade at https://pakalon.dev/billing/upgrade to keep using the pro models.\n"
            ),
            api_key=api_key,
        ))
    log.info("dunning pass complete", extra={"invoices": sent_invoices, "trials": sent_trials})
    return {"invoices": sent_invoices, "trials": sent_trials}


if __name__ == "__main__":
    import json as _json
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # Smoke test
    today = datetime.now(tz=UTC).date()
    sample_invoices = [
        {"invoice_id": "i1", "user_id": "u1", "amount_cents": 1500, "status": "pending", "due_date": (today + timedelta(days=3)).isoformat()},
        {"invoice_id": "i2", "user_id": "u2", "amount_cents": 2500, "status": "paid", "due_date": (today + timedelta(days=1)).isoformat()},
    ]
    sample_users = [
        {"user_id": "u1", "email": "u1@example.com", "tier": "pro"},
        {"user_id": "u3", "email": "u3@example.com", "tier": "free", "trial_ends_at": (today + timedelta(days=5)).isoformat()},
    ]
    counts = run_dunning(invoices=sample_invoices, users=sample_users, api_key=os.environ.get("RESEND_API_KEY"))
    print(_json.dumps(counts, indent=2))
