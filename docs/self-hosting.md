# Self-hosting

Run Retrospend on your own hardware with Docker Compose. You get the web app, the API for the mobile apps, scheduled jobs and backups. For running from source instead, see [development.md](development.md).

## Quick start

1. Get the config files:

   ```bash
   cp docker-compose.example.yml docker-compose.yml
   cp .env.example .env
   ```

2. Edit `.env` and set the required variables (table below).

3. Start the services:

   ```bash
   docker compose up -d
   ```

The app is available on port `1997`. Migrations run automatically on startup.

### First run

- The first user to sign up becomes admin. You can restrict further signups to invite-only in the admin panel.
- If using Ollama for AI import, pull the model after first start:
  ```bash
  docker exec local-ollama ollama pull qwen2.5:7b
  ```
- AI import is opt-in per person: each user turns it on in Settings, and until then no file goes to Ollama or OpenRouter. The import screen names the provider and model that will read the file. On upgrade, accounts that used AI import are turned on; anyone who only ever used local reading before March 2026 is off and turns it on once in Settings.
- The `ollama` service is optional. Remove it if you don't use bank statement import, or set `OPENROUTER_API_KEY` to use a cloud model instead. Keep the `sidecar`: it also runs exchange rates, recurring expenses and backups.

## Settings

Set these in `.env`. Runtime settings are read at start; nothing is baked into the image.

| Variable | Required | Default | Description |
|---|---|---|---|
| `AUTH_SECRET` | **Yes** | | 32+ char secret: `openssl rand -base64 32` |
| `PUBLIC_URL` | **Yes** | | Your public URL (e.g. `https://app.yourdomain.com`) |
| `POSTGRES_USER` | **Yes** | `postgres` | Database username |
| `POSTGRES_PASSWORD` | **Yes** | | Database password |
| `POSTGRES_DB_NAME` | **Yes** | `retrospend` | Database name |
| `DATABASE_URL` | **Yes** | | Full PostgreSQL connection string |
| `WORKER_API_KEY` | **Yes** | | Shared secret between app, worker, and importer: `openssl rand -base64 32` |
| `SHOW_LANDING_PAGE` | No | `false` | Show public landing page at `/` |
| `DEFAULT_TIME_ZONE` | No | `America/Argentina/Buenos_Aires` | IANA zone for people with no saved zone. Set it on both the app and the sidecar, so recurring dates agree |
| `ENABLE_LEGAL_PAGES` | No | `true` | Show `/privacy` and `/terms` |
| `UNSUBSCRIBE_SECRET` | No | | Secret for signed one-click unsubscribe links in emails |
| `SMTP_HOST` | No | | SMTP server hostname |
| `SMTP_PORT` | No | | SMTP port (e.g. `587`) |
| `SMTP_USER` | No | | SMTP username |
| `SMTP_PASSWORD` | No | | SMTP password |
| `EMAIL_FROM` | No | | Sender address (e.g. `Retrospend <noreply@example.com>`) |
| `OPENROUTER_API_KEY` | No | | Cloud LLM for bank statement import (alternative to Ollama) |
| `OPENROUTER_MODEL` | No | `qwen/qwen-2.5-7b-instruct` | OpenRouter model |
| `LLM_MODEL` | No | `qwen2.5:7b` | Ollama model |
| `BACKUP_CRON` | No | `0 3 * * *` | Backup schedule (cron syntax) |
| `BACKUP_RETENTION_DAYS` | No | `30` | Days to keep backup files |
| `KEYSTORE_BACKUP_RETENTION_DAYS` | No | `7` | Days to keep the separate data key backups (`keystore-*.dump`), kept short on purpose (see [Data key backups](#data-key-backups)) |
| `BACKUP_AGE_RECIPIENT` | No | | One or more [age](https://age-encryption.org) public keys (`age1...`, comma-separated). When set, backups are encrypted to them and written as `.dump.age` (see [Encrypted backups](#encrypted-backups)) |
| `TRUSTED_ORIGINS` | No | | Extra allowed CORS/auth origins (comma-separated) |
| `VAPID_PRIVATE_KEY` | No | | Turns on push to Android phones through UnifiedPush (see [Push notifications](#push-notifications)) |
| `VAPID_PUBLIC_KEY` | No | derived | The matching public key, checked against the private one |
| `VAPID_SUBJECT` | No | `PUBLIC_URL` if https | `mailto:` or `https:` contact sent to push services |
| `PUSH_ENDPOINT_ALLOW_HOSTS` | No | | Hosts (names or IPs, comma-separated) that may receive push although they are on a private network, such as a LAN ntfy server. The admin setting Allow private webhook targets also allows private UnifiedPush endpoints |
| `DATA_MASTER_KEY` or `DATA_MASTER_KEY_FILE` | No | | Master key for server-side data encryption: 64 hex characters (`openssl rand -hex 32`) or a file path; the server will not start if it is malformed. Nothing is encrypted with it yet; keep a copy with your backups |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` | No | | Apple push (iPhone and iPad); all four APNs settings are needed |
| `APNS_KEY` or `APNS_KEY_FILE` | No | | The APNs auth key (`.p8`) as text (newlines written `\n`) or as a file path |
| `ANDROID_APP_CERT_SHA256` | No | | More SHA-256 fingerprint(s), comma-separated, of Android app signing certificates, besides the release key. Served in `/.well-known/assetlinks.json` for app links and password manager autofill |
| `SECURITY_CONTACT` | No | project's GitHub report form | Where to report a vulnerability, as comma-separated `mailto:` or `https:` links. Served with `PUBLIC_URL` as the canonical address in `/.well-known/security.txt`; set it to your own address |
| `FCM_SERVICE_ACCOUNT` or `FCM_SERVICE_ACCOUNT_FILE` | No | | Firebase service account key (JSON or file path) for Android phones with Google Play services |
| `FCM_PROJECT_ID` | No | from the key | Firebase project, if it differs from the key's |

## Mobile apps

The iPhone, iPad and Android apps connect to retrospend.app by default. To use your server, tap **Self-hosted** on the connect screen and enter your `PUBLIC_URL`. The apps use `/api/v1` on the same server, so no extra service is needed. Serve the app over HTTPS: plain HTTP works but the app warns about it.

## Push notifications

Optional. Without any of these settings the server sends no push and the apps check for changes when they open. Each sender below turns on by itself once all of its settings are present; a sender with a missing or unreadable setting stays off and says which setting it did not like in the server log.

A push says what happened and carries ids and an amount. It never carries an expense title, a note or a person's name, so nothing a push service relays can be read from it. Android pushes are also encrypted for the phone (RFC 8291).

- **Android without Google (UnifiedPush).** Install a distributor such as ntfy on the phone, then create a VAPID key pair once and set `VAPID_PRIVATE_KEY` (the command is in `.env.example`). Keep the key: a new one makes every phone register again. The phone gives the server an endpoint on its distributor; the server will not connect to an endpoint on a private network (a phone on your LAN pointing at `192.168.x.x`, `localhost`, a name that resolves to one) unless you list its host in `PUSH_ENDPOINT_ALLOW_HOSTS` or an admin allows private targets for webhooks.
- **iPhone and iPad (APNs).** Create an APNs auth key in your Apple developer account and set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` and `APNS_KEY`. Builds signed for development use Apple's sandbox without a setting.
- **Android with Google Play services (FCM).** Set `FCM_SERVICE_ACCOUNT` to a Firebase service account key. Phones without Play services use UnifiedPush or check for changes themselves.

What is pushed: a shared expense added or changed on a split you are on, a payment recorded, confirmed, marked not received or waiting for your confirmation, a request to fix an expense, and a recurring expense or income that is due. A notification type you turned off in Settings (in-app) is not pushed either. A person gets at most 60 different pushes an hour.

## Files and volumes

- Uploaded files (avatars, project images) live in the `uploads` volume and finished exports in the `exports` volume. Back up `uploads` alongside your database.
- Use strong, unique values for `AUTH_SECRET` and `WORKER_API_KEY`.
- Put the app behind a reverse proxy or tunnel that terminates HTTPS, and set `PUBLIC_URL` to the public address.

## Backups

The sidecar service handles scheduled database backups on the schedule set by `BACKUP_CRON` (default: daily at 3 AM UTC). Retention is controlled by `BACKUP_RETENTION_DAYS` (default: 30).

Backup files are written inside the sidecar container. They go to `BACKUP_DIR` (default `/backups`), which the example compose file mounts as the `backup_data` volume.

### Encrypted backups

Set `BACKUP_AGE_RECIPIENT` to an age public key and the sidecar encrypts every backup to it. The dump is streamed through age inside the sidecar, so the unencrypted file never touches the disk. Only you hold the matching private key; the server cannot read its own backups.

1. Make a key pair on a machine you trust: `age-keygen -o retrospend-backup.key`. It prints the public key (`age1...`). Keep the key file somewhere safe and off the server. Without it the backups cannot be opened.
2. Set `BACKUP_AGE_RECIPIENT` to the public key and restart the sidecar.
3. If the key is malformed, the sidecar refuses to start, and a backup that cannot be encrypted fails. It never falls back to writing a plain file.

The sidecar has no restore command and never sees the private key. To restore, decrypt on a machine that has the `age` command and your key file, then restore as usual:

```sh
age --decrypt -i retrospend-backup.key retrospend-20260101-030000.dump.age > restore.dump
pg_restore --clean --if-exists --no-owner -d retrospend restore.dump
```

Backups made before you set the key stay unencrypted until they age out.

### Data key backups

Per-user data keys live in their own database schema, `keystore`. The sidecar leaves that schema out of the main dump and writes it on its own as `keystore-<time>.dump` (or `.dump.age` when `BACKUP_AGE_RECIPIENT` is set), right after the main backup. These files are kept for `KEYSTORE_BACKUP_RETENTION_DAYS` (default 7), much shorter than the main backups, so the key of a deleted account does not outlive them for long. The keys inside are sealed with `DATA_MASTER_KEY`, so a keystore backup is useless without it: keep the master key with your backups, apart from the files.

To restore, restore the main dump as usual, then the keystore dump. Do not pass `--schema`: the dump has to create the schema itself.

```sh
pg_restore --clean --if-exists --no-owner -d retrospend retrospend-20260101-030000.dump
pg_restore --clean --if-exists --no-owner -d retrospend keystore-20260101-030000.dump
psql -d retrospend -c 'DELETE FROM keystore.user_data_key k WHERE NOT EXISTS (SELECT 1 FROM public."user" u WHERE u.id = k."userId")'
```

The last command removes keys of accounts that were deleted after the keystore dump was made, so a restore never brings a deleted account's key back. If you restore a keystore dump that is older than the main one, accounts created in between have no key yet; the server makes one on first use.

If you restore a main dump into a new database and have no keystore dump (it is older than `KEYSTORE_BACKUP_RETENTION_DAYS`, or was lost), the database lists the keystore migration as applied but the schema is missing, and the server reports that the key store is missing. Make an empty one and restart:

```sh
psql -d retrospend -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261109100000_keystore'"
```

The migration runs again on start and is safe to repeat. An empty key store means every user gets a new key, so anything already sealed with the lost keys can no longer be read.

## Updating

1. Back up the database and the `uploads` volume.
2. Pull the new images: `docker compose pull`.
3. Restart: `docker compose up -d`. Migrations run on start.

Release notes for each version are on [GitHub Releases](https://github.com/syntheit/retrospend/releases).
