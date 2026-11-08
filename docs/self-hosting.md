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
| `BACKUP_AGE_RECIPIENT` | No | | One or more [age](https://age-encryption.org) public keys (`age1...`, comma-separated). When set, backups are encrypted to them and written as `.dump.age` (see [Encrypted backups](#encrypted-backups)) |
| `TRUSTED_ORIGINS` | No | | Extra allowed CORS/auth origins (comma-separated) |
| `VAPID_PRIVATE_KEY` | No | | Turns on push to Android phones through UnifiedPush (see [Push notifications](#push-notifications)) |
| `VAPID_PUBLIC_KEY` | No | derived | The matching public key, checked against the private one |
| `VAPID_SUBJECT` | No | `PUBLIC_URL` if https | `mailto:` or `https:` contact sent to push services |
| `PUSH_ENDPOINT_ALLOW_HOSTS` | No | | Hosts (names or IPs, comma-separated) that may receive push although they are on a private network, such as a LAN ntfy server. The admin setting Allow private webhook targets also allows private UnifiedPush endpoints |
| `DATABASE_OWNER_PASSWORD` | No | derived | A secret of your own for the `retrospend_owner` database role, in place of the one derived from `POSTGRES_PASSWORD`. Set the same value on the app and the sidecar, or on neither (see [Database access](#database-access)) |
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

## Database access

Retrospend does not run as the database superuser. The app and the sidecar connect as `retrospend_owner`, a role that owns the tables, can sign in, and is not a superuser: it cannot create roles or databases, and it never holds `CREATE` on the database. Inside it, the app switches to a narrower role, `retrospend_app`, for work done on behalf of a signed-in person. The superuser (`POSTGRES_USER`) is used only while the app container starts, to create these roles and hand the tables over. The app and the sidecar processes never see its password.

Rows of other people are protected by row-level security and by the narrow grants of `retrospend_app`. That guards against mistakes in the app's own queries. It is not a boundary against someone who can run arbitrary SQL, and the owner role can read every row. The details are in the database access section of the [threat model](security/threat-model.md).

### The password

You do not set one. The password of `retrospend_owner` is the hex of HMAC-SHA256 with `POSTGRES_PASSWORD` as the key over the text `retrospend_owner`. Both containers work it out from the `DATABASE_URL` they are given, so nothing else goes in `.env`. It reveals nothing about `POSTGRES_PASSWORD`, and it changes when `POSTGRES_PASSWORD` does: the next start of the app sets it on the role, and the sidecar signs in again when it restarts.

To pick your own instead, set `DATABASE_OWNER_PASSWORD` (printable characters, no spaces). Give the same value to the app and the sidecar, or to neither. If only one has it, the other works out a different password, cannot sign in, and stops after waiting a few minutes with a message that says so. The compose files pass the variable to both services. A value of your own is also how you get the switch when the database user has no password (see below).

### First start and upgrades

On the first start after you update, the app container creates the roles, gives the existing tables, sequences, functions and types to `retrospend_owner` (a few seconds), runs the migrations as that role, applies the grants of `retrospend_app`, and only then starts the app. The sidecar waits for the role to exist, which on the same first start can take a moment, and then connects as it too. You change nothing. Later starts find everything in place and write nothing.

A brand-new install is migrated by a one-shot role that holds `CREATE` on the database for that long and is removed afterwards, even when a migration fails. An upgrade never gives anyone `CREATE`.

If `DATABASE_URL` names a user that is not a superuser (a managed Postgres, or a setup you made by hand), nothing is created or changed and the app connects as that user. Keeping its ownership and grants right is then up to you.

### Password-less superuser connections

If the superuser has no password (Postgres started with `POSTGRES_HOST_AUTH_METHOD=trust`, or a `DATABASE_URL` without one), a derived password would be guessable. The app logs a warning and keeps connecting as the superuser, with none of the protection above. Give the database user a password, or set `DATABASE_OWNER_PASSWORD` on the app and the sidecar. Do not publish the Postgres port beyond the machine either way: the sample compose file binds it to `127.0.0.1` or leaves it unpublished.

### A first start that fails

If the very first migration of a new install fails (a full disk, an out-of-memory kill), the database is left half built and the next start refuses to retry, because an upgrade is not allowed to create schemas. On an install with no data yet, drop the database and create it empty, then start again. Use your own database name:

```sh
docker compose stop retrospend sidecar
docker exec retrospend-postgres psql -U postgres -d postgres -c 'DROP DATABASE retrospend' -c 'CREATE DATABASE retrospend'
docker compose up -d
```

Never do this on a database that holds your data. Restore a backup instead (below).

### pgweb

The `pgweb` service in `docker-compose.yml` is a web console that signs in as the superuser. Anyone who can open it can read, change and delete everything, and can run code on the database server. It is off unless you ask for it, and it listens on `127.0.0.1` only:

```sh
docker compose --profile tools up -d pgweb
docker compose --profile tools stop pgweb
```

Stop it when you are done. Never put it behind a public address, and never publish its port on another interface. The sample file `docker-compose.example.yml` does not include it.

## Backups

The sidecar service handles scheduled database backups on the schedule set by `BACKUP_CRON` (default: daily at 3 AM UTC). Retention is controlled by `BACKUP_RETENTION_DAYS` (default: 30).

Backup files are written inside the sidecar container. They go to `BACKUP_DIR` (default `/backups`), which the example compose file mounts as the `backup_data` volume.

### Encrypted backups

Set `BACKUP_AGE_RECIPIENT` to an age public key and the sidecar encrypts every backup to it. The dump is streamed through age inside the sidecar, so the unencrypted file never touches the disk. Only you hold the matching private key; the server cannot read its own backups.

1. Make a key pair on a machine you trust: `age-keygen -o retrospend-backup.key`. It prints the public key (`age1...`). Keep the key file somewhere safe and off the server. Without it the backups cannot be opened.
2. Set `BACKUP_AGE_RECIPIENT` to the public key and restart the sidecar.
3. If the key is malformed, the sidecar refuses to start, and a backup that cannot be encrypted fails. It never falls back to writing a plain file.

The sidecar has no restore command and never sees the private key. To restore, decrypt on a machine that has the `age` command and your key file, then restore as described in [Restoring a backup](#restoring-a-backup):

```sh
age --decrypt -i retrospend-backup.key retrospend-20260101-030000.dump.age > restore.dump
```

Backups made before you set the key stay unencrypted until they age out.

### Restoring a backup

The dumps carry no owners and no privileges, so a restored database has tables with the wrong owner (the user that ran the restore) and no grants for the app's roles. Restart the app after every restore: on each start it hands every object to `retrospend_owner` and applies `prisma/grants/app-role.sql`, which gives the roles back exactly what they need. Until you restart, signed-in requests fail.

1. On a brand-new server, start the app once (`docker compose up -d`) so it creates the roles and the schema, then stop it. On an existing install skip this.
2. Stop the app and the sidecar: `docker compose stop retrospend sidecar`.
3. Copy the dump out of the `backup_data` volume (or decrypt it, see above) to the machine you restore from.
4. Restore the main dump as `retrospend_owner`. A restore as the superuser loads rows into tables the owner role owns, and a trigger on such a table then runs with the superuser's rights. The Postgres image trusts connections made inside its own container, so no password is needed there:

   ```sh
   docker exec -i retrospend-postgres pg_restore --clean --if-exists --no-owner -U retrospend_owner -d retrospend < restore.dump
   ```

   Exactly two errors are expected, both about the `unaccent` extension: `must be owner of extension unaccent`, once on `DROP EXTENSION` and once on `COMMENT`. The extension belongs to the superuser and stays as it is. Because of them `pg_restore` exits with status 1, but the rest of the restore is complete. Confirm it with a row count, for example:

   ```sh
   docker exec retrospend-postgres psql -U retrospend_owner -d retrospend -c 'SELECT count(*) FROM "user"'
   ```

   Any other error is a real failure. From anywhere but inside the container, set `PGPASSWORD` to the derived password, which `printf %s retrospend_owner | openssl dgst -sha256 -hmac "$POSTGRES_PASSWORD" | awk '{print $NF}'` prints, or use your `DATABASE_OWNER_PASSWORD`.
5. Start again with `docker compose up -d`.

### Data key backups

Per-user data keys live in their own database schema, `keystore`. The sidecar leaves that schema out of the main dump and writes it on its own as `keystore-<time>.dump` (or `.dump.age` when `BACKUP_AGE_RECIPIENT` is set), right after the main backup. These files are kept for `BACKUP_RETENTION_DAYS`, like the main backups, and a failed dump removes nothing, so the last good key backup lasts as long as the last good main backup. Deleting an account destroys its key in the live database at once, but a copy stays in every key backup made before the deletion until that backup ages out, so lower `BACKUP_RETENTION_DAYS` if that window is too long for you. If dumps keep failing, nothing is pruned, so old key backups (and the keys of deleted accounts in them) stay past the retention time. Check that `keystore-*.dump` files are being replaced. Nothing is sealed with these keys yet, so destroying one erases nothing today. The keys inside are sealed with `DATA_MASTER_KEY`, so a keystore backup is useless without it: keep the master key with your backups, apart from the files.

To restore, restore the main dump as above, then replace the contents of the key table with the keystore dump. The app must have started at least once, so that `retrospend_owner` owns the `keystore` schema and the table exists. With the app and the sidecar stopped:

```sh
docker exec retrospend-postgres psql -U retrospend_owner -d retrospend -c 'TRUNCATE keystore.user_data_key'
docker exec -i retrospend-postgres pg_restore --data-only --no-owner -U retrospend_owner -d retrospend < keystore-20260101-030000.dump
docker exec retrospend-postgres psql -U retrospend_owner -d retrospend -c 'DELETE FROM keystore.user_data_key k WHERE NOT EXISTS (SELECT 1 FROM public."user" u WHERE u.id = k."userId")'
docker compose up -d
```

Never restore the keystore dump as the owner with `--clean`. It drops the `keystore` schema and the owner cannot create it again, which leaves the database with no key store. The superuser is not needed for any of these steps. The app's grants on the key table are applied on start.

The delete removes keys of accounts that were deleted after the keystore dump was made, so a restore never brings a deleted account's key back. If you restore a keystore dump that is older than the main one, accounts created in between have no key yet; the server makes one on first use.

If you restore a main dump into a new database and have no keystore dump (it is older than `BACKUP_RETENTION_DAYS`, or was lost), the database lists the keystore migration as applied but the schema is missing, and the server reports that the key store is missing. Make an empty one and restart:

```sh
docker exec retrospend-postgres psql -U retrospend_owner -d retrospend -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261109100000_keystore'"
```

The migration runs again on start and is safe to repeat. An empty key store means every user gets a new key, so anything already sealed with the lost keys can no longer be read.

## Updating

1. Back up the database and the `uploads` volume.
2. Pull the new images: `docker compose pull`.
3. Restart: `docker compose up -d`. Migrations run on start.

Release notes for each version are on [GitHub Releases](https://github.com/syntheit/retrospend/releases).
