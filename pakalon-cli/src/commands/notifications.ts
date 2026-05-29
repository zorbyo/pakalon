/**
 * notifications.ts — System notifications for Pakalon CLI.
 * 
 * Sends OS-level notifications when:
 * - Tasks are completed
 * - Permissions are requested
 * - Errors occur
 * - Long-running operations finish
 */

import { execSync } from "child_process";
import path from "path";
import fs from "fs";

export interface NotificationOptions {
  title: string;
  message: string;
  type?: "info" | "success" | "warning" | "error";
  sound?: boolean;
  icon?: string;
  timeout?: number; // seconds
  actions?: string[]; // For interactive notifications
}

// Platform detection
function getPlatform(): "windows" | "macos" | "linux" {
  const platform = process.platform;
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return "linux";
}

/**
 * Check if notifications are enabled in settings
 */
function areNotificationsEnabled(): boolean {
  try {
    const settingsPath = path.join(process.cwd(), ".pakalon", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      return settings.notifications?.enabled !== false;
    }
  } catch {
    // Default to enabled if settings can't be read
  }
  return true;
}

/**
 * Send a notification using platform-specific methods
 */
export function sendNotification(options: NotificationOptions): boolean {
  if (!areNotificationsEnabled()) {
    return false;
  }

  const platform = getPlatform();
  const { title, message, type = "info", sound = true, timeout = 5 } = options;

  // Escape special characters for shell
  const escapedTitle = title.replace(/"/g, '\\"').replace(/'/g, "\\'");
  const escapedMessage = message.replace(/"/g, '\\"').replace(/'/g, "\\'");

  try {
    switch (platform) {
      case "windows":
        return sendWindowsNotification(escapedTitle, escapedMessage, type, sound, timeout);
      
      case "macos":
        return sendMacNotification(escapedTitle, escapedMessage, type, sound);
      
      case "linux":
        return sendLinuxNotification(escapedTitle, escapedMessage, type, sound, timeout);
      
      default:
        console.log(`[${type.toUpperCase()}] ${title}: ${message}`);
        return false;
    }
  } catch (error) {
    // Fallback to console output
    console.log(`[${type.toUpperCase()}] ${title}: ${message}`);
    return false;
  }
}

/**
 * Windows notifications using PowerShell
 */
function sendWindowsNotification(
  title: string,
  message: string,
  type: string,
  sound: boolean,
  timeout: number
): boolean {
  try {
    // Use PowerShell to show Windows toast notification
    const icon = type === "error" ? "Error" : type === "warning" ? "Warning" : "Information";
    const psScript = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
      
      $template = @"
<toast duration="short">
  <visual>
    <binding template="ToastGeneric">
      <text>${title}</text>
      <text>${message}</text>
    </binding>
  </visual>
</toast>
"@
      
      $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
      $xml.LoadXml($template)
      $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Pakalon").Show($toast)
    `;

    execSync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`, {
      stdio: "ignore",
      timeout: timeout * 1000,
    });

    return true;
  } catch {
    // Fallback: Try using msg command
    try {
      execSync(`msg "%username%" "${title}: ${message}"`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * macOS notifications using osascript
 */
function sendMacNotification(
  title: string,
  message: string,
  type: string,
  sound: boolean
): boolean {
  try {
    const soundArg = sound ? 'sound name "default"' : '';
    const script = `display notification "${message}" with title "${title}" ${soundArg}`;
    execSync(`osascript -e '${script}'`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Linux notifications using notify-send
 */
function sendLinuxNotification(
  title: string,
  message: string,
  type: string,
  sound: boolean,
  timeout: number
): boolean {
  try {
    const icon = type === "error" ? "dialog-error" : 
                 type === "warning" ? "dialog-warning" : 
                 "dialog-information";
    const urgency = type === "error" ? "critical" : 
                    type === "warning" ? "normal" : "low";
    
    execSync(
      `notify-send -i ${icon} -u ${urgency} -t ${timeout * 1000} "${title}" "${message}"`,
      { stdio: "ignore" }
    );
    return true;
  } catch {
    // Fallback to console
    console.log(`[${type.toUpperCase()}] ${title}: ${message}`);
    return false;
  }
}

/**
 * Notification for task completion
 */
export function notifyTaskComplete(taskName: string, details?: string): void {
  sendNotification({
    title: "Pakalon - Task Complete",
    message: `${taskName} has been completed.${details ? ` ${details}` : ""}`,
    type: "success",
    sound: true,
  });
}

/**
 * Notification for permission request
 */
export function notifyPermissionRequest(
  permission: string,
  description: string
): void {
  sendNotification({
    title: "Pakalon - Permission Required",
    message: `${permission}: ${description}`,
    type: "warning",
    sound: true,
  });
}

/**
 * Notification for errors
 */
export function notifyError(error: string, context?: string): void {
  sendNotification({
    title: "Pakalon - Error",
    message: `${error}${context ? ` (${context})` : ""}`,
    type: "error",
    sound: true,
  });
}

/**
 * Notification for long-running operation completion
 */
export function notifyOperationComplete(
  operation: string,
  duration: number, // seconds
  summary?: string
): void {
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60);
  const durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  sendNotification({
    title: "Pakalon - Operation Complete",
    message: `${operation} finished in ${durationStr}.${summary ? ` ${summary}` : ""}`,
    type: "info",
    sound: false,
  });
}

/**
 * Notification for build completion
 */
export function notifyBuildComplete(
  projectName: string,
  success: boolean,
  errors?: number
): void {
  const type = success ? "success" : "error";
  const message = success
    ? `${projectName} built successfully!`
    : `${projectName} build failed${errors ? ` with ${errors} error(s)` : ""}`;

  sendNotification({
    title: "Pakalon - Build Complete",
    message,
    type,
    sound: success,
  });
}

/**
 * Notification for test completion
 */
export function notifyTestComplete(
  projectName: string,
  passed: number,
  failed: number
): void {
  const type = failed > 0 ? "warning" : "success";
  const message = failed > 0
    ? `${projectName}: ${passed} passed, ${failed} failed`
    : `${projectName}: All ${passed} tests passed!`;

  sendNotification({
    title: "Pakalon - Tests Complete",
    message,
    type,
    sound: failed > 0,
  });
}

/**
 * Notification for agent waiting for input
 */
export function notifyWaitingForInput(agentName: string, question: string): void {
  sendNotification({
    title: `Pakalon - ${agentName} Needs Input`,
    message: question.slice(0, 100) + (question.length > 100 ? "..." : ""),
    type: "warning",
    sound: true,
  });
}

/**
 * Notification for code changes
 */
export function notifyCodeChanges(
  filesChanged: number,
  linesAdded: number,
  linesDeleted: number
): void {
  sendNotification({
    title: "Pakalon - Code Changes",
    message: `${filesChanged} file(s) changed: +${linesAdded} / -${linesDeleted} lines`,
    type: "info",
    sound: false,
  });
}

/**
 * Interactive notification with actions (platform-dependent)
 */
export function sendInteractiveNotification(
  title: string,
  message: string,
  actions: string[]
): string | null {
  const platform = getPlatform();

  if (platform === "macos") {
    try {
      const actionList = actions.map(a => `"${a}"`).join(", ");
      const script = `display dialog "${message}" with title "${title}" buttons {${actionList}} default button 1`;
      const result = execSync(`osascript -e '${script}'`, { encoding: "utf-8" });
      return result.trim().replace("button returned:", "");
    } catch {
      return null;
    }
  }

  // For other platforms, fall back to console
  console.log(`\n[Bell] ${title}`);
  console.log(message);
  actions.forEach((action, i) => console.log(`  ${i + 1}. ${action}`));
  
  return null; // Would need stdin reading for actual interactivity
}

/**
 * Enable/disable notifications in settings
 */
export function setNotificationsEnabled(enabled: boolean): void {
  try {
    const settingsPath = path.join(process.cwd(), ".pakalon", "settings.json");
    let settings: Record<string, unknown> = {};
    
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    }

    settings.notifications = { enabled };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error("Failed to update notification settings:", error);
  }
}

// Export command handler for slash commands
export async function handleNotificationsCommand(args: string[]): Promise<{ ok: boolean; output: string }> {
  const [subCommand] = args;

  switch (subCommand) {
    case "on":
      setNotificationsEnabled(true);
      return { ok: true, output: "Notifications enabled." };

    case "off":
      setNotificationsEnabled(false);
      return { ok: true, output: "Notifications disabled." };

    case "test":
      sendNotification({
        title: "Pakalon Test",
        message: "This is a test notification from Pakalon CLI.",
        type: "info",
      });
      return { ok: true, output: "Test notification sent." };

    case "status":
      const enabled = areNotificationsEnabled();
      return { 
        ok: true, 
        output: `Notifications are ${enabled ? "enabled" : "disabled"}.` 
      };

    default:
      return {
        ok: true,
        output: [
          "Notification commands:",
          "  /notifications on      — Enable notifications",
          "  /notifications off     — Disable notifications",
          "  /notifications test    — Send a test notification",
          "  /notifications status  — Check notification status",
        ].join("\n"),
      };
  }
}
