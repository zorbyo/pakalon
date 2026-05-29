/**
 * /billing command — view and manage billing information
 */
import type { CommandContext, CommandResult } from "../types.js";
import {
  initializeBilling,
  getBillingInfo,
  getUsageStats,
  getUsageHistory,
  upgradePlan,
  trackUsage,
} from "@/billing/billing.js";

export const billingCommand = {
  name: "billing",
  aliases: ["bill", "subscription"],
  description: "View billing information and usage statistics",
  usage: "/billing [usage|upgrade <plan>|history]",
  category: "account" as const,

  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const subCommand = args[0]?.toLowerCase() ?? "usage";

    // Ensure billing is initialized
    if (!getBillingInfo()) {
      initializeBilling();
    }

    switch (subCommand) {
      case "usage":
      case "stats":
        return cmdShowUsage();

      case "upgrade":
      case "plan": {
        const planId = args[1];
        if (!planId) {
          return {
            success: false,
            message: "Usage: /billing upgrade <plan>\n\nAvailable plans: free, pro, team, enterprise",
          };
        }
        return cmdUpgradePlan(planId);
      }

      case "history":
      case "usage-history": {
        const limit = parseInt(args[1], 10) || 20;
        return cmdShowHistory(limit);
      }

      case "help":
      case "--help":
      case "-h":
        return {
          success: true,
          message: getHelpText(),
        };

      default:
        return {
          success: false,
          message: `Unknown sub-command: ${subCommand}\n\n${getHelpText()}`,
        };
    }
  },
};

function cmdShowUsage(): CommandResult {
  const stats = getUsageStats();
  const billing = getBillingInfo();

  if (!stats || !billing) {
    return { success: false, message: "Billing not initialized" };
  }

  const { tokens, requests, tokenPercent, requestPercent, periodEnd } = stats;
  const plan = billing.plan;

  return {
    success: true,
    message: `
Plan: ${plan.name} ($${plan.price}/month)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tokens:    ${tokens.toLocaleString()} / ${plan.tokenLimit.toLocaleString()} (${tokenPercent.toFixed(1)}%)
Requests:  ${requests.toLocaleString()} / ${(plan.requestLimit ?? "∞").toLocaleString()} (${requestPercent.toFixed(1)}%)
Period ends: ${periodEnd.toLocaleDateString()}

Usage tracking: ${billing.nextBillingDate ? "Active" : "Inactive"}
`.trim(),
  };
}

function cmdUpgradePlan(planId: string): CommandResult {
  const validPlans = ["free", "pro", "team", "enterprise"];

  if (!validPlans.includes(planId)) {
    return {
      success: false,
      message: `Invalid plan: ${planId}\n\nAvailable plans: ${validPlans.join(", ")}`,
    };
  }

  const billing = upgradePlan(planId);

  return {
    success: true,
    message: `Upgraded to ${billing.plan.name} plan ($${billing.plan.price}/month)\n\nFeatures: ${billing.plan.features.join(", ")}`,
  };
}

function cmdShowHistory(limit: number): CommandResult {
  const history = getUsageHistory(limit);

  if (history.length === 0) {
    return { success: true, message: "No usage history yet" };
  }

  const lines = history.slice(0, limit).map((record) => {
    const date = new Date(record.timestamp).toLocaleString();
    return `${date}: ${record.tokens} tokens, ${record.requests} requests`;
  });

  return {
    success: true,
    message: `Recent usage (${history.length} entries):\n\n${lines.join("\n")}`,
  };
}

function getHelpText(): string {
  return `
Billing Command
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/billing usage           Show current usage statistics
/billing upgrade <plan>  Upgrade to a different plan
/billing history [n]     Show recent usage history (default: 20)
/billing help            Show this help

Available Plans:
  free        - 100K tokens, 100 requests
  pro         - 1M tokens, 1000 requests ($20/month)
  team        - 5M tokens, 5000 requests ($40/month)
  enterprise  - Custom pricing
`.trim();
}

export default billingCommand;