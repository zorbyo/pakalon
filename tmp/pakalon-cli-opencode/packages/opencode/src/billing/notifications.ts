import { Log } from "../util/log"

const log = Log.create({ service: "billing:notifications" })

export interface BillingNotification {
  type: "usage_warning" | "invoice_due" | "payment_received" | "plan_upgrade"
  email: string
  subject: string
  body: string
  scheduledAt?: number
  sentAt?: number
}

export namespace Notifications {
  const queue: BillingNotification[] = []

  export function scheduleUsageWarning(email: string, usagePct: number): BillingNotification {
    const notif: BillingNotification = {
      type: "usage_warning",
      email,
      subject: "Pakalon Usage Warning",
      body: `You have used ${usagePct}% of your current billing period allocation.`,
      scheduledAt: Date.now(),
    }
    queue.push(notif)
    log.info("scheduled usage warning", { email, pct: usagePct })
    return notif
  }

  export function scheduleInvoiceReminder(email: string, dueDate: number, amount: number): BillingNotification {
    const notif: BillingNotification = {
      type: "invoice_due",
      email,
      subject: "Pakalon Invoice Due Soon",
      body: `Your invoice of $${amount.toFixed(2)} is due on ${new Date(dueDate).toLocaleDateString()}.`,
      scheduledAt: dueDate - 7 * 24 * 60 * 60 * 1000,
    }
    queue.push(notif)
    log.info("scheduled invoice reminder", { email, dueDate })
    return notif
  }

  export function notifyPlanUpgrade(email: string): BillingNotification {
    const notif: BillingNotification = {
      type: "plan_upgrade",
      email,
      subject: "Welcome to Pakalon Pro!",
      body: "Your account has been upgraded to Pro. You now have access to all models.",
      sentAt: Date.now(),
    }
    log.info("notified plan upgrade", { email })
    return notif
  }

  export function pending(): BillingNotification[] {
    return queue.filter((n) => !n.sentAt)
  }

  export function markSent(email: string, type: BillingNotification["type"]): void {
    const notif = queue.find((n) => n.email === email && n.type === type && !n.sentAt)
    if (notif) notif.sentAt = Date.now()
  }
}
