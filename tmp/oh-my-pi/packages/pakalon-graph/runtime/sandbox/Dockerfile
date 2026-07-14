# sandbox-runner image
#
# Used by Pakalon's Phase 4 to spin up an isolated environment for the
# first test run of generated code. Promotion to local/prod only happens
# after the security subagents report "no critical/high findings".
#
# Build: docker build -t pakalon-sandbox-runner:latest \
#          -f packages/pakalon-graph/runtime/sandbox/Dockerfile .
# Run (from inside the project dir):
#   docker run --rm -v $(pwd):/src:rw -p 3000:3000 \
#     pakalon-sandbox-runner:latest

FROM oven/bun:1.3.14

# Native system libs commonly needed by generated Node/Next/Python apps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git openssh-client tini su-exec \
    build-essential python3 python3-pip python3-venv \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
    libasound2 libxshmfence1 libdrm2 libxfixes3 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Chromium for the headless browser tool (sandbox, browser-driven tests)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-liberation libnss3 libxss1 libasound2 \
    && rm -rf /var/lib/apt/lists/*

ENV CI=true \
    NODE_ENV=production \
    PAKALON_SANDBOX=1 \
    PAKALON_SANDBOX_PORT=3000 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /src

# Default entrypoint runs whatever the project provides. The Pakalon
# orchestrator overrides this with the project's dev/start command.
COPY entrypoint.sh /usr/local/bin/pakalon-sandbox-entrypoint
RUN chmod +x /usr/local/bin/pakalon-sandbox-entrypoint

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/pakalon-sandbox-entrypoint"]
CMD ["sh", "-c", "echo 'pakalon-sandbox: no command provided'; sleep infinity"]
