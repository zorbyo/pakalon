# Security Policy

## Supported Versions

We currently only support the latest version of Pakalon. Please ensure you are running the most recent release before reporting a security issue.

| Version | Supported          |
| ------- | ------------------ |
| Latest  | Yes |
| < Latest| No  |

## Reporting a Vulnerability

If you discover a security vulnerability, please do not open a public issue. Instead, send an email to security@pakalon.com with a detailed description of the bug and steps to reproduce it.

### Response Timeline

We aim to acknowledge all security reports within 48 hours. For critical vulnerabilities, we strive to provide a fix within 14 days.

### Disclosure Policy

We follow a coordinated disclosure process. We ask that you do not disclose the vulnerability publicly until a fix is available. We will publish a security advisory and credit the researcher after the fix is released. If a fix is not released within 90 days of the initial report, you may disclose the vulnerability publicly.

## Security Best Practices for Self-Hosted Users

Pakalon features a dual-mode architecture. In self-hosted mode, the application runs on localhost and does not include authentication. This design assumes a trusted local environment.

To keep your installation secure:

1. Limit network exposure. Do not expose the self-hosted backend or frontend to the public internet.
2. Keep your local LLM providers updated. Regularly update Ollama, LM Studio, or any other local model servers you use.
3. Use a firewall. Ensure your system firewall blocks unauthorized access to the ports used by Pakalon.
4. Run with minimal privileges. Avoid running the Pakalon services as a root or administrator user.
