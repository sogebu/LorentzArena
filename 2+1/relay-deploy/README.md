# WS Relay deploy (WSS on 443)

This folder provides a minimal deployment for the 2+1 WebSocket relay.

## Why this exists

Strict university/corporate networks often block WebRTC P2P and non-443 ports.
Serving relay over `wss://<domain>:443` usually works better.

## Prerequisites

- Public domain name that points to your server
- Docker + Docker Compose
- Ports 80 and 443 open

## Deploy

1. Create env file:

```bash
cp .env.example .env
```

2. Edit `.env` and set `DOMAIN`.

3. Start services:

```bash
docker compose up -d --build
```

4. Confirm relay URL:

```bash
wss://<DOMAIN>
```

## Client config (`2+1/.env.local`)

```bash
VITE_NETWORK_TRANSPORT=auto
VITE_WS_RELAY_URL=wss://<DOMAIN>
```

Use `wsrelay` instead of `auto` if you want to force relay mode.
