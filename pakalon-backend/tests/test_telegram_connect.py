"""Tests for Telegram connect token persistence endpoints."""

import pytest

from app.routers import users as users_router
from tests.conftest import make_jwt_for_user


@pytest.mark.asyncio
async def test_put_and_get_telegram_token(client, free_user, monkeypatch):
    token = make_jwt_for_user(free_user)

    async def fake_validate_telegram_token(value: str) -> str | None:
        assert value.startswith("123456:")
        return "pakalon_test_bot"

    monkeypatch.setattr(users_router, "_validate_telegram_token", fake_validate_telegram_token)

    payload = {
        "token": "123456:abcdefghijklmnopqrstuvwxyz0123456789",
        "webhook_url": "https://example.com/telegram/webhook",
    }

    put_response = await client.put(
        "/users/me/telegram-token",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
    )
    assert put_response.status_code == 200
    put_body = put_response.json()
    assert put_body["token"] == payload["token"]
    assert put_body["bot_username"] == "pakalon_test_bot"
    assert put_body["webhook_url"] == payload["webhook_url"]

    get_response = await client.get(
        "/users/me/telegram-token",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert get_response.status_code == 200
    get_body = get_response.json()
    assert get_body == put_body


@pytest.mark.asyncio
async def test_delete_telegram_token_clears_profile(client, free_user, monkeypatch):
    token = make_jwt_for_user(free_user)

    async def fake_validate_telegram_token(_value: str) -> str | None:
        return "pakalon_test_bot"

    monkeypatch.setattr(users_router, "_validate_telegram_token", fake_validate_telegram_token)

    await client.put(
        "/users/me/telegram-token",
        headers={"Authorization": f"Bearer {token}"},
        json={"token": "123456:abcdefghijklmnopqrstuvwxyz0123456789"},
    )

    delete_response = await client.delete(
        "/users/me/telegram-token",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["status"] == "ok"

    get_response = await client.get(
        "/users/me/telegram-token",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert get_response.status_code == 200
    body = get_response.json()
    assert body["token"] is None
    assert body["bot_username"] is None
    assert body["webhook_url"] is None
