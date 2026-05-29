/**
 * notifications/index.ts — Public API for the email notification system.
 * Re-exports all notification modules for convenient importing.
 */

export * from "./types.js";
export * from "./emailTemplates.js";
export {
  fetchEmailHistory,
  fetchEmailStatus,
  requestBillingReminder,
  requestTrialExpirationNotification,
  fetchNotificationPreferences as fetchEmailPreferences,
  updateNotificationPreferences as updateEmailPreferences,
  retryFailedEmail,
  isWithinQuietHours,
} from "./emailService.js";
export * from "./billingReminders.js";
export * from "./trialExpiration.js";
export {
  getNotificationRecords,
  saveNotificationRecord,
  markNotificationRead,
  markNotificationDismissed,
  getUnreadNotifications,
  getUnreadBillingReminders,
  getUnreadTrialNotifications,
  clearOldNotifications,
  getNotificationCount,
  loadNotificationPreferences,
  saveNotificationPreferences,
  updateNotificationPreferences,
} from "./storage.js";
