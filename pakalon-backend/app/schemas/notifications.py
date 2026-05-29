"""Pydantic schemas for in-app notifications and email delivery."""

from datetime import datetime

from pydantic import BaseModel, EmailStr


class NotificationResponse(BaseModel):
    id: str
    user_id: str
    notification_type: str
    title: str
    body: str
    action_url: str | None = None
    action_label: str | None = None
    read: bool
    created_at: datetime
    expires_at: datetime | None = None

    model_config = {"from_attributes": True}


class NotificationListResponse(BaseModel):
    notifications: list[NotificationResponse]
    total: int
    unread_count: int


class NotificationCreateRequest(BaseModel):
    """Internal-use payload for creating an in-app notification programmatically."""

    user_id: str
    notification_type: (
        str  # billing_reminder | trial_expiry | context_exhausted | plan_upgrade | grace_period
    )
    title: str
    body: str
    action_url: str | None = None
    action_label: str | None = None
    expires_at: datetime | None = None


class NotificationReadResponse(BaseModel):
    id: str
    read: bool


# ── Email delivery schemas ──────────────────────────────────────

class EmailResponse(BaseModel):
    id: str
    user_id: str
    to_email: str
    subject: str
    email_type: str
    status: str
    retry_count: int
    sent_at: datetime | None = None
    error_message: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class EmailListResponse(BaseModel):
    emails: list[EmailResponse]
    total: int


class EmailDeliveryStatus(BaseModel):
    email_id: str
    status: str
    sent_at: datetime | None = None
    error_message: str | None = None
    retry_count: int


class BillingReminderRequest(BaseModel):
    user_id: str
    email: str
    display_name: str
    days_remaining: int
    plan: str = "free"
    amount_usd: float | None = None
    period_end: datetime | None = None


class TrialExpirationRequest(BaseModel):
    user_id: str
    email: str
    display_name: str
    days_remaining: int
    trial_end: datetime


class NotificationPreferences(BaseModel):
    email_billing_reminders: bool = True
    email_trial_expiration: bool = True
    email_subscription_renewal: bool = True
    in_app_notifications: bool = True
    quiet_hours_start: str | None = None
    quiet_hours_end: str | None = None


class NotificationPreferencesUpdate(BaseModel):
    email_billing_reminders: bool | None = None
    email_trial_expiration: bool | None = None
    email_subscription_renewal: bool | None = None
    in_app_notifications: bool | None = None
    quiet_hours_start: str | None = None
    quiet_hours_end: str | None = None
