# Security policy

RingLife handles health data. Please report security problems privately.

## Reporting a vulnerability

- Use GitHub's private vulnerability reporting: the **Security** tab of this repository, then **Report a vulnerability**.
- Do not open a public issue for a vulnerability.
- Describe the problem and how to reproduce it with synthetic data. **Never attach real health data, database files, Bluetooth captures, tokens, pairing secrets or addresses of your network.**

You will get an answer as soon as possible. This is a personal project: there is no bounty and no guaranteed response time.

## Scope

- The server (`backend/`, `ha-app/`): pairing and device tokens, the HTTP API, MQTT publishing, data at rest in `/data`.
- The app (`mobile/`): storage of the device token in the system keychain, the local queue of unsent data, network settings.

## Design assumptions

- The server is reachable only from the home network and through Tailscale. It must never be exposed to the internet (no port forwarding, no Tailscale Funnel).
- Device tokens are stored on the server only as hashes and can be revoked.
- Plain HTTP is allowed only towards private home-network addresses, as a fallback when HTTPS does not answer.
- Home Assistant backups contain the app's `/data`: keep them encrypted and limit their retention.
