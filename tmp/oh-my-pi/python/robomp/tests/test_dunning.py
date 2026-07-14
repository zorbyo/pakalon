"""Tests for the dunning email task."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from robomp.tasks.dunning import (
    due_invoice_window,
    free_trial_window,
    run_dunning,
)


def test_due_invoice_window_filters_correctly() -> None:
    today = datetime.now(tz=UTC).date()
    invoices = [
        {"invoice_id": "i1", "user_id": "u1", "amount_cents": 100, "status": "pending", "due_date": (today + timedelta(days=3)).isoformat()},
        {"invoice_id": "i2", "user_id": "u1", "amount_cents": 200, "status": "pending", "due_date": (today + timedelta(days=10)).isoformat()},
        {"invoice_id": "i3", "user_id": "u1", "amount_cents": 300, "status": "paid", "due_date": (today + timedelta(days=2)).isoformat()},
        {"invoice_id": "i4", "user_id": "u1", "amount_cents": 400, "status": "pending", "due_date": (today - timedelta(days=1)).isoformat()},
    ]
    out = due_invoice_window(invoices, days=7)
    assert len(out) == 1
    assert out[0]["invoice_id"] == "i1"


def test_free_trial_window_only_free_tier() -> None:
    today = datetime.now(tz=UTC).date()
    users = [
        {"user_id": "u1", "tier": "free", "trial_ends_at": (today + timedelta(days=3)).isoformat()},
        {"user_id": "u2", "tier": "pro", "trial_ends_at": (today + timedelta(days=3)).isoformat()},
        {"user_id": "u3", "tier": "free"},  # no trial_ends_at
        {"user_id": "u4", "tier": "free", "trial_ends_at": (today + timedelta(days=20)).isoformat()},
    ]
    out = free_trial_window(users, days=7)
    assert len(out) == 1
    assert out[0]["user_id"] == "u1"


def test_run_dunning_returns_counts() -> None:
    today = datetime.now(tz=UTC).date()
    invoices = [
        {"invoice_id": "i1", "user_id": "u1", "amount_cents": 100, "status": "pending", "due_date": (today + timedelta(days=3)).isoformat()},
    ]
    users = [
        {"user_id": "u1", "email": "u1@example.com", "tier": "pro"},
        {"user_id": "u3", "email": "u3@example.com", "tier": "free", "trial_ends_at": (today + timedelta(days=5)).isoformat()},
    ]
    counts = run_dunning(invoices=invoices, users=users)
    assert counts == {"invoices": 1, "trials": 1}
