# `/logout` — Clear credentials and stop tunnels

Sign the user out from the CLI and tear down any active tunnels
(Telegram, web companion).

## Steps

1. Delete `~/.pakalon/auth.json` and `~/.pakalon/auth-codes.json`.
2. POST `/auth/logout` to the backend to invalidate the JWT server-side.
3. If a Telegram tunnel is active, run `/connect-end`.
4. If the web companion is open, close the in-app session.
5. Print "Signed out. Run `pakalon` to sign in again."
