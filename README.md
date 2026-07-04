# Chat X

Chat X is a private self-hosted messaging platform inspired by modern secure messengers. It includes a Node.js API, React web client, PostgreSQL database, encrypted media storage, Docker deployment, invitation-only registration, admin controls, WebSockets, and English/Portuguese/French UI translations.

This project uses the Signal ecosystem as a technical reference, especially the public Signal organization and libsignal direction:

- https://github.com/signalapp
- https://github.com/signalapp/libsignal

No Signal source code is copied into this project. Signal server and client repositories are AGPL-licensed; this repository is MIT-licensed and only references public protocol and architecture ideas. Real Signal Protocol support is planned for a later phase.

## Current Privacy Model

Phase 1 implements browser-side encrypted message payloads and browser-side encrypted private message media:

- The browser generates an RSA-OAEP identity key pair.
- The public key is stored on the server.
- The private key is encrypted in the browser with a password-derived AES-GCM key before being uploaded.
- Each chat gets an AES-GCM chat key.
- The chat key is wrapped to each member public key and stored as an encrypted key envelope.
- Text payloads are compressed in the browser when supported, then encrypted with AES-GCM before upload.
- Message media is compressed in the browser for images where possible, encrypted with the chat key, then uploaded.
- Media files are also encrypted at rest by the server before being written to disk.
- Media is served only through authenticated temporary signed URLs.

The server stores encrypted message envelopes, encrypted chat key envelopes, metadata, accounts, sessions, chat membership, media metadata, and audit logs.

## Important Limitations

This is not Signal-grade E2EE yet.

- It does not implement libsignal sessions, Double Ratchet, X3DH/PQXDH, sender keys, sealed sender, safety numbers, or forward secrecy.
- A malicious or compromised server that serves modified frontend JavaScript could attack future browser sessions. Use HTTPS, restrict admin access, and review deployments.
- Metadata remains visible to the server: users, chat membership, timestamps, media sizes, message counts, and IP-layer access through infrastructure logs.
- Server-side trusted media processing is disabled by default because FFmpeg compression requires plaintext media before encrypted-at-rest storage.
- Avatars are treated as profile media, not private chat media.
- Reloading the web app may require logging in again to unlock the encrypted private key in the browser session.

Phase 2 should replace the Phase 1 chat-key model with a maintained Signal Protocol implementation such as current libsignal TypeScript bindings where feasible.

## Features

- Default first admin bootstrap: `admin` / `admin`.
- Forced first admin username and password change before app access.
- Bcrypt password hashing.
- Opaque database-backed sessions.
- Admin console for users, bans, disablement, promotion/demotion, invites, stats, and audit logs.
- First admin protection against accidental removal.
- Invitation links with expiration, maximum uses, active/expired listing, and revocation.
- Direct chats and group chats.
- Group admins, group names, disappearing timers, and pinned message metadata.
- Group leave flow, group image uploads, group permissions, admin promotion/demotion, and member removal.
- Message replies, edits, delete for me, and delete for everyone.
- Real-time online, last-seen, and typing presence over WebSockets with privacy enforcement.
- Read receipts, online visibility, last-seen visibility, and typing status privacy controls.
- Encrypted image, video, audio, and file message uploads.
- Authenticated temporary media URLs.
- Telegram-style contact/group info panels with shared Media, Files, Links, and GIFs tabs. Message bodies remain encrypted; link discovery is client-side after decryption.
- QR login approval from an already logged-in device.
- One-to-one WebRTC video calls with configurable STUN/TURN signaling.
- Browser notification controls and light/dark/system theme selection.
- Expired disappearing-message cleanup.
- Orphan media cleanup.
- User settings for display name, avatar, language, privacy toggles, default disappearing timer, password change, and account deletion.
- Responsive UI for desktop and mobile.
- UI translations: English, Portuguese, and French.

## Requirements

- Docker and Docker Compose.
- For local non-Docker development: Node.js 18.19+ and PostgreSQL 16+.

## Local Docker Setup

From the project root:

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:3000
```

If ports `3000` or `4000` are already used on your host:

```bash
WEB_PORT=3001 API_PORT=4001 APP_PUBLIC_URL=http://localhost:3001 API_PUBLIC_URL=http://localhost:3001 ALLOWED_ORIGINS=http://localhost:3001,http://127.0.0.1:3001 docker compose up -d --build
```

Default first login:

```text
username: admin
password: admin
```

The app blocks access until this first admin changes both username and password.

## Environment Variables

Copy `.env.example` to `.env` for production or customized deployments:

```bash
cp .env.example .env
```

Important variables:

- `APP_PUBLIC_URL`: external app URL used as the fallback for invite links and generated public URLs.
- `API_PUBLIC_URL`: external API URL. Use the same value as `APP_PUBLIC_URL` when the API is served under `/api` on the same origin.
- `ALLOWED_ORIGINS`: comma-separated browser origins allowed by the API and WebSocket server.
- `ALLOW_CLOUDFLARE_TEMP_TUNNELS`: set to `true` to allow `https://*.trycloudflare.com` origins for temporary tunnel testing.
- `TRUST_PROXY`: set to `true` when running behind Docker nginx, Cloudflare Tunnel, Caddy, Traefik, Nginx Proxy Manager, or another reverse proxy.
- `COOKIE_SECURE_AUTO`: automatically treats proxied HTTPS requests as secure for future cookie-based auth.
- `COOKIE_SAMESITE`: SameSite policy for future cookie-based auth. Default is `lax`.
- `VITE_API_BASE_URL`: optional frontend API override. Leave empty for Docker/reverse proxy deployments so the browser uses relative `/api` and `/socket.io` paths.
- `PUBLIC_APP_URL` and `CORS_ORIGIN`: legacy names still accepted for older deployments.
- `DATABASE_URL`: PostgreSQL connection string.
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`: Compose database settings.
- `SESSION_TTL_HOURS`: opaque session lifetime.
- `BCRYPT_COST`: password hashing cost.
- `MEDIA_ROOT`: media storage path inside the server container.
- `MEDIA_SIGNING_SECRET`: HMAC secret for temporary media URLs.
- `MEDIA_ENCRYPTION_KEY_BASE64`: base64-encoded 32-byte AES key for server-side encrypted-at-rest media.
- `MAX_UPLOAD_BYTES`: maximum upload size.
- `SIGNED_MEDIA_URL_TTL_SECONDS`: temporary media URL lifetime.
- `VIDEO_COMPRESSION_CRF`: FFmpeg CRF when trusted processing is enabled.
- `ALLOW_TRUSTED_MEDIA_PROCESSING`: opt-in server-side plaintext media compression before encrypted-at-rest storage.
- `QR_LOGIN_TTL_SECONDS`: short QR login request lifetime.
- `STUN_URLS`: comma-separated STUN server URLs for WebRTC calls.
- `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`: optional TURN settings for production WebRTC reliability.
- `HTTPS_ONLY`: deployment flag for documentation and reverse-proxy hardening.

Generate production secrets:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

Do not commit `.env`.

## Updating

```bash
git pull
docker compose up -d --build
```

Migrations run automatically on API startup.

## Backup And Restore

Back up PostgreSQL and media together. Database rows reference media IDs and storage paths.

Backup:

```bash
docker compose exec db pg_dump -U chat_x chat_x > backup.sql
docker run --rm -v chat-x_media_data:/media -v "$PWD":/backup alpine tar czf /backup/media.tar.gz /media
```

Restore:

```bash
docker compose up -d db
cat backup.sql | docker compose exec -T db psql -U chat_x chat_x
docker run --rm -v chat-x_media_data:/media -v "$PWD":/backup alpine sh -c "rm -rf /media/* && tar xzf /backup/media.tar.gz -C /"
docker compose up -d --build
```

Keep `MEDIA_ENCRYPTION_KEY_BASE64` with your backups. Losing it makes stored media unreadable.

## Media Storage And Cleanup

Private message media is encrypted in the browser before upload. The server then applies an additional encrypted-at-rest layer and stores metadata in PostgreSQL.

Media download flow:

1. Authenticated user requests `/api/media/:id/link`.
2. Server checks chat membership or media permission.
3. Server returns a short-lived signed URL.
4. Authenticated browser fetches the URL.
5. Server verifies the signature and session, decrypts only the server storage layer, and returns the encrypted client blob.
6. Browser decrypts the message-media layer with the chat key.

Cleanup jobs run inside the API process:

- Remove expired disappearing-message payloads and linked media references.
- Delete orphaned unreferenced message media after the configured retention window.
- Delete expired sessions.

Deleted media files are removed from disk with path checks that prevent deleting outside `MEDIA_ROOT`.

## Trusted Media Processing

By default, message media must be client-encrypted before upload. That means the server cannot compress videos, because compression must happen before encryption.

If you accept the privacy tradeoff, set:

```env
ALLOW_TRUSTED_MEDIA_PROCESSING=true
```

Then the API can accept plaintext message media, compress images with Sharp and videos with FFmpeg, and encrypt the processed result at rest. This mode is not end-to-end encrypted for those uploads and is not used by the default web client.

## Security Recommendations

- Change all `.env` secrets before production.
- Put the app behind HTTPS.
- Use a reverse proxy with HSTS and modern TLS.
- Restrict admin access to trusted networks where possible.
- Keep Docker images updated.
- Back up PostgreSQL, media, and media encryption keys.
- Do not enable trusted media processing unless you accept server-side plaintext handling.
- Do not claim Signal-level security for this deployment.
- Review logs and audit logs regularly. Audit logs intentionally do not include plaintext private messages.

## Reverse Proxy Example

Caddy example:

```caddyfile
chat.example.com {
  reverse_proxy /api/* localhost:4000
  reverse_proxy /socket.io/* localhost:4000
  reverse_proxy localhost:3000
}
```

Set:

```env
APP_PUBLIC_URL=https://chat.example.com
API_PUBLIC_URL=https://chat.example.com
ALLOWED_ORIGINS=https://chat.example.com
TRUST_PROXY=true
VITE_API_BASE_URL=
HTTPS_ONLY=true
```

## DuckDNS Guide

1. Create an account at https://www.duckdns.org.
2. Create a subdomain, for example `mychat.duckdns.org`.
3. Point it to your server public IP in the DuckDNS dashboard.
4. Keep the DuckDNS updater running on your server if your IP changes.
5. Set:

```env
APP_PUBLIC_URL=https://mychat.duckdns.org
API_PUBLIC_URL=https://mychat.duckdns.org
ALLOWED_ORIGINS=https://mychat.duckdns.org
TRUST_PROXY=true
VITE_API_BASE_URL=
```

Run the app behind Caddy, Nginx Proxy Manager, or Traefik and enable HTTPS. With Caddy, point the Caddyfile host to `mychat.duckdns.org` and proxy to the Compose ports.

Common DuckDNS issues:

- Wrong public IP: update the DuckDNS record.
- Router not forwarding ports 80/443: add port forwarding to the server.
- HTTPS certificate failure: verify DNS resolves publicly before starting the proxy.

## Cloudflare Temporary Tunnel

Temporary tunnels are useful for testing from outside your LAN. They are not guaranteed stable and should not be treated as production hostnames.

Start Chat X:

```bash
docker compose up -d --build
```

Start the temporary tunnel against the public web port:

```bash
cloudflared tunnel --url http://localhost:3000
```

Copy the generated URL, for example `https://something.trycloudflare.com`. For the safest temporary testing setup, add it to `.env`:

```env
APP_PUBLIC_URL=https://something.trycloudflare.com
API_PUBLIC_URL=https://something.trycloudflare.com
ALLOWED_ORIGINS=https://something.trycloudflare.com
TRUST_PROXY=true
VITE_API_BASE_URL=
```

Then restart:

```bash
docker compose up -d --build
```

For a more automatic temporary testing setup, allow all Cloudflare temporary tunnel hostnames:

```env
ALLOW_CLOUDFLARE_TEMP_TUNNELS=true
TRUST_PROXY=true
VITE_API_BASE_URL=
```

Do not use `ALLOW_CLOUDFLARE_TEMP_TUNNELS=true` as your only production origin policy. Use a named tunnel with a stable hostname for production.

## Cloudflare Tunnel With Custom Domain

Install `cloudflared` using Cloudflare's official package instructions for your OS.

Create and route a named tunnel:

```bash
cloudflared tunnel login
cloudflared tunnel create chat-x
cloudflared tunnel route dns chat-x chat.example.com
```

Create a config file such as `/etc/cloudflared/config.yml`:

```yaml
tunnel: chat-x
credentials-file: /root/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: chat.example.com
    service: http://localhost:3000
  - service: http_status:404
```

Run as a service:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Set:

```env
APP_PUBLIC_URL=https://chat.example.com
API_PUBLIC_URL=https://chat.example.com
ALLOWED_ORIGINS=https://chat.example.com
TRUST_PROXY=true
VITE_API_BASE_URL=
HTTPS_ONLY=true
```

## Custom Domain Guide

DNS options:

- Use an `A` record for `chat.example.com` pointing to your server IP.
- Use a `CNAME` if pointing to another hostname managed by your provider or tunnel.

Reverse proxy:

- Proxy `/api/*` and `/socket.io/*` to the API on port `4000`.
- Proxy all other paths to the web client on port `3000`.
- Enable WebSocket support.

HTTPS:

- Use Caddy automatic HTTPS, Nginx Proxy Manager Let's Encrypt, Traefik ACME, or Cloudflare Tunnel.
- Set `APP_PUBLIC_URL`, `API_PUBLIC_URL`, and `ALLOWED_ORIGINS` to the HTTPS origin.
- Leave `VITE_API_BASE_URL` empty when the frontend and API are available on the same public origin.

Common errors:

- `Something went wrong` or `Cannot connect to the server`: verify `/api/health` loads from the same public URL as the app.
- `CORS` errors: `ALLOWED_ORIGINS` does not include the browser URL, or `ALLOW_CLOUDFLARE_TEMP_TUNNELS=true` is missing for a temporary `trycloudflare.com` URL.
- Cookies not saving or login works locally but not through HTTPS proxy: set `TRUST_PROXY=true` and keep `COOKIE_SECURE_AUTO=true`.
- Invite links use localhost: `APP_PUBLIC_URL` is wrong, or the current public origin is not allowed.
- WebSocket fails: reverse proxy is not forwarding `/socket.io/*`.
- Media or avatars do not load: reverse proxy is not forwarding `/api/media/*`, or the signed media URL expired and should be requested again.
- QR login is not working: verify `/api/auth/qr/*` and `/socket.io/*` are reachable through the public URL.
- Media downloads fail after a few minutes: signed URLs are intentionally short lived.

## Development Commands

Install dependencies:

```bash
npm install
```

Run API locally:

```bash
npm --workspace server run dev
```

Run web client locally:

```bash
npm --workspace web run dev
```

Run all checks:

```bash
npm run lint
npm run test
npm run build
npm run check:deployment
npm audit --omit=dev
```

## Test Commands

Server tests:

```bash
npm --workspace server run test
```

Web tests:

```bash
npm --workspace web run test
```

Current tests cover password policy, storage encryption helpers, opaque token generation, origin allow-list handling, Cloudflare temporary tunnel opt-in, proxy-aware secure cookie detection, public invite/media URL generation, the health endpoint, frontend API/WebSocket URL generation, and translation completeness. Browser E2E tests should be added before high-trust production use.

## GitHub Repository

If GitHub authentication is available, this project can be created as:

```bash
gh repo create CHAT-X --private --source=. --remote=origin --push
```

Manual fallback:

```bash
git init
git add .
git commit -m "Initial self-hosted messenger implementation"
git branch -M main
git remote add origin https://github.com/<your-user>/CHAT-X.git
git push -u origin main
```

## Troubleshooting

Check container status:

```bash
docker compose ps
```

Read API logs:

```bash
docker compose logs -f server
```

Reset local development data:

```bash
docker compose down -v
docker compose up -d --build
```

If default admin is not created, verify the database volume is empty. The default admin is only created when the users table has zero users.

If login works but chats cannot decrypt after a browser reload, log in again so the browser can unlock the encrypted private key bundle.

## License Notes

This project is MIT-licensed. It does not copy Signal source code or assets. Signal repositories such as Signal-Server, Signal-Desktop, Signal-Android, Signal-iOS, and libsignal use their own licenses, often AGPL-3.0. Review upstream licenses before reusing any code.
