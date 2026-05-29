const EMAIL_REGEX = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const PHONE_REGEX = /(?<!\d)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)/g;
const COMMON_TOKEN_REGEX = /\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})\b/g;
const LABELLED_SECRET_REGEX = /\b(api[_-]?key|token|secret|password|bearer)\b\s*[:=]\s*([^\s'"`]+)\b/gi;
const CREDIT_CARD_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function luhnCheck(value: string): boolean {
  let sum = 0;
  let shouldDouble = false;

  for (let index = value.length - 1; index >= 0; index -= 1) {
    const digit = Number(value[index]);
    if (!Number.isFinite(digit)) {
      return false;
    }

    let current = digit;
    if (shouldDouble) {
      current *= 2;
      if (current > 9) {
        current -= 9;
      }
    }

    sum += current;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function redactCreditCards(content: string): string {
  return content.replace(CREDIT_CARD_REGEX, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhnCheck(digits) ? "[REDACTED_CARD]" : match;
  });
}

/**
 * Redacts sensitive data from content before sending it to an LLM.
 * Preserves structure while anonymizing PII and common secret formats.
 */
export function filterContentForLLM(content: string): string {
  let sanitized = normalizeWhitespace(content);

  sanitized = sanitized.replace(EMAIL_REGEX, "[REDACTED_EMAIL]");
  sanitized = sanitized.replace(SSN_REGEX, "[REDACTED_SSN]");
  sanitized = sanitized.replace(PHONE_REGEX, "[REDACTED_PHONE]");
  sanitized = redactCreditCards(sanitized);
  sanitized = sanitized.replace(COMMON_TOKEN_REGEX, "[REDACTED_TOKEN]");
  sanitized = sanitized.replace(LABELLED_SECRET_REGEX, (_match, label: string) => `${label}: [REDACTED]`);

  return sanitized;
}
