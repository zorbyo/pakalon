#!/bin/sh
# pakalon-sandbox entrypoint
#
# Runs the generated project's dev/start command inside the sandbox.
# Pakalon's Phase 4 orchestrator passes the command as the first arg.
set -e

CMD="$1"
if [ -z "$CMD" ]; then
    echo "pakalon-sandbox: waiting for command on stdin"
    exec sleep infinity
fi

echo "pakalon-sandbox: executing '$CMD'"
cd /src
exec sh -c "$CMD"
