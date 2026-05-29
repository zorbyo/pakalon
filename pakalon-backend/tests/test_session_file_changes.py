"""Tests for per-session file change history endpoints."""

from tests.conftest import make_jwt_for_user


async def test_record_and_list_session_file_changes(client, free_user):
    token = make_jwt_for_user(free_user)
    headers = {"Authorization": f"Bearer {token}"}

    create_response = await client.post(
        "/sessions",
        headers=headers,
        json={"title": "file change sync", "model_id": "test-model"},
    )
    assert create_response.status_code == 201
    session_id = create_response.json()["id"]

    record_response = await client.post(
        f"/sessions/{session_id}/file-changes",
        headers=headers,
        json={
            "changes": [
                {
                    "path": "src/app.ts",
                    "lines_added": 12,
                    "lines_deleted": 3,
                    "diff": "--- src/app.ts\n+++ src/app.ts",
                },
                {
                    "path": "src/api.ts",
                    "lines_added": 4,
                    "lines_deleted": 0,
                },
            ]
        },
    )
    assert record_response.status_code == 201
    body = record_response.json()
    assert body["total"] == 2
    assert [change["path"] for change in body["changes"]] == ["src/app.ts", "src/api.ts"]

    list_response = await client.get(
        f"/sessions/{session_id}/file-changes",
        headers=headers,
    )
    assert list_response.status_code == 200
    listed = list_response.json()
    assert listed["total"] == 2
    assert listed["changes"][0]["lines_added"] == 12
    assert listed["changes"][0]["lines_deleted"] == 3

    session_response = await client.get(f"/sessions/{session_id}", headers=headers)
    assert session_response.status_code == 200
    session_body = session_response.json()
    assert session_body["lines_added"] == 16
    assert session_body["lines_deleted"] == 3


async def test_file_changes_require_session_ownership(client, free_user, pro_user):
    free_token = make_jwt_for_user(free_user)
    pro_token = make_jwt_for_user(pro_user)

    create_response = await client.post(
        "/sessions",
        headers={"Authorization": f"Bearer {free_token}"},
        json={"title": "private session", "model_id": "test-model"},
    )
    assert create_response.status_code == 201
    session_id = create_response.json()["id"]

    response = await client.get(
        f"/sessions/{session_id}/file-changes",
        headers={"Authorization": f"Bearer {pro_token}"},
    )
    assert response.status_code == 404
