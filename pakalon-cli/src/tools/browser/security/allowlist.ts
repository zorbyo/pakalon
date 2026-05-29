/**
 * Security configuration for browser domain checks.
 */
export interface SecurityConfig {
  /** Allowed domains, supports exact matches and wildcards like `*.example.com`. */
  allowedDomains?: string[];
  /** Blocked domains, supports exact matches and wildcards like `*.example.com`. */
  blockedDomains?: string[];
}

function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

function parseHost(url: string): string | null {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

function matchesRule(host: string, rule: string): boolean {
  const normalizedRule = normalizeDomain(rule);

  if (!normalizedRule) {
    return false;
  }

  if (normalizedRule.startsWith("*.") ) {
    const suffix = normalizedRule.slice(2);
    return host !== suffix && host.endsWith(`.${suffix}`);
  }

  return host === normalizedRule;
}

/**
 * Determines whether a URL is allowed by the provided domain policy.
 *
 * Rules:
 * - If no policy is configured, allow the URL.
 * - Block rules always win over allow rules.
 * - Allow rules can use exact matches or wildcard subdomains.
 */
export function isDomainAllowed(url: string, config: SecurityConfig): boolean {
  const host = parseHost(url);
  if (!host) {
    return false;
  }

  const blockedDomains = (config.blockedDomains ?? []).filter(Boolean);
  if (blockedDomains.some((rule) => matchesRule(host, rule))) {
    return false;
  }

  const allowedDomains = (config.allowedDomains ?? []).filter(Boolean);
  if (allowedDomains.length === 0) {
    return true;
  }

  return allowedDomains.some((rule) => matchesRule(host, rule));
}
