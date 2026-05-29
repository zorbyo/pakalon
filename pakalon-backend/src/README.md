# Pakalon Node Backend Surface

This directory contains the Python-free backend feature surface used for the missing production controls:

- `rate-limit.js` implements sliding-window request limits and standard rate-limit headers.
- `polar-webhooks.js` verifies Polar Standard Webhooks/Svix signatures before processing events.
- `telemetry.js` records in-memory telemetry and produces aggregate analytics summaries.
- `server.js` wires those modules into a minimal Node HTTP service.

Run it with:

```sh
npm run start:node
```

The existing FastAPI application is left intact for compatibility. New backend feature work in this directory uses only Node built-ins.
