# Threat model for Advanced protection

**DRAFT. Not a security claim.** This document describes a design that is only partly built. No audit has been done. An independent audit comes before any public statement that Retrospend is end-to-end encrypted (spike phase 6, W2), and until that report exists nothing here may be used in marketing.

Written 2026-11-08 against base commit `d081bfc1` (the crypto foundation F1 to F3 is merged there) plus D1 (server field crypto), merged into the segment at `038d4709`, which this branch does not contain; D1 files are read from `e2ee/d1-field-crypto`. Every technical statement cites the file it comes from. Where the design in `docs/roadmap/e2ee-spike.md` (the spike) and the code disagree, section 12 says so, and the code is what this document describes.

## 1. What exists today

| Piece | State | Where |
|---|---|---|
| Primitives (XChaCha20-Poly1305, Argon2id, kdf, sealed box, BLAKE2b) over libsodium | Built, merged | `packages/crypto/src/primitives.ts`, `web.ts` |
| Sealed record format | Built, merged | `packages/crypto/src/format.ts` |
| Key hierarchy, wraps, recovery key text, fingerprint phrase | Built, merged | `packages/crypto/src/keys.ts` |
| Known-answer vectors from other implementations | Built, merged | `packages/crypto/vectors/*.json`, `src/self-test.ts` |
| Server field crypto (AES-256-GCM) and master key loading | Built, merged into the segment. No callers except the start-up key check in `src/instrumentation.ts` | `src/server/crypto/field-crypto.ts`, `master-key.ts` |
| Backups encrypted with age (optional, operator key) | Built, merged | `sidecar/tasks/backup.go`, `docs/self-hosting.md` |
| Admin access log, shown to the person | Built, merged | `prisma/schema.prisma` (`AdminAccessLog`), `src/features/settings/security/admin-access-block.tsx` |
| Nonce CSP | Built, merged. Trusted Types is report-only | `src/lib/csp.ts`, `src/proxy.ts` |
| Push text built from kind, ids and amount only | Built, merged | `src/server/services/push/message.ts` |

Nothing outside `packages/crypto` imports `@retrospend/crypto`. No user can turn Advanced protection on, no account has a key, no sealed record store exists, and `DATA_MASTER_KEY` encrypts nothing yet (`docs/self-hosting.md` says so). Everything below about flows is design. Everything below about formats and keys is code.

## 2. Two modes

**Default accounts.** The server can read the data and compute every figure. Email reset works. Goal: a stolen database or backup does not reveal text, and staff cannot browse. Plan: per-user data keys wrapped by a server master key (lane D, spike section 3 and 4.6). Amounts stay plain so SQL and the money engine keep working.

**Advanced protection.** Opt-in, per account. Personal data is sealed on the device with keys the server never holds. The server cannot compute personal figures, so the device does (lane P). Turning it on requires at least one recovery method. If a person loses the password and every recovery method, the data is gone, by design.

## 3. What Advanced protection will protect, and what it won't

It will protect, from the server and anyone who reads its storage:

- Every personal record: expense amounts, titles, notes, places, categories, recurring templates, budgets, accounts, balances, transfers, settings (spike section 2.1).
- The keys that open them. The server stores only wrapped keys.

It will not protect:

- **Shared data.** Shared expenses, splits, payments, projects, people, and budget books that have another member stay readable by the server and by everyone in them (spike section 2.3). The settings page and the shared-expense sheet must say so once.
- **Metadata.** See section 8.
- **A compromised device that is unlocked.** Keys and plaintext are in memory there.
- **A compromised web app delivery.** See section 9.
- **A weak password against a server that is hostile.** See section 5.2.
- **Availability.** The server can withhold, delete or roll back records (section 6).
- **What a person tells another person.** A member who sees a shared expense can copy it.
- **Anything before the commit step of turning protection on.** Plaintext rows and older backups exist until they are deleted and the retention period ends (spike section 5.1).

## 4. Actors

### 4.1 Curious operator

Someone who runs or administers the server and wants to look at one person's data, without attacking anything.

- Default today: the admin pages show identity, not titles (spike section 3, "Admin"). Admin actions on an account are written to `admin_access_log` with a stable action code, and the person reads their own rows under row-level security (`prisma/migrations/20261103100000_admin_access_log/migration.sql`). The log covers actions through the app. It does not record someone reading the database or the host directly.
- Default after lane D: titles and notes are ciphertext in the database. An operator who also has the master key (environment or file on the app host, `master-key.ts`) can decrypt all of them. Lane D therefore protects against the database and backups leaving the host, and against browsing, not against the person who runs the app process.
- Advanced: the operator cannot read personal records. Shared data and metadata stay visible.
- Self-hosting: the operator and the user are the same person, so the hosted operator is out of the trust chain.

### 4.2 Compromised server

An attacker who controls the app, the database and the master key, or a malicious operator who modifies the app.

- Default: full read of everything the app can read. Out of scope for lane D.
- Advanced, passive (reads storage and traffic): sees ciphertext, wrapped keys and the metadata in section 8. Cannot open records without the password or a recovery secret.
- Advanced, active (changes responses): can
  - return weak but in-range Argon2id parameters and a chosen salt (section 5.2);
  - withhold, delete or replay old sealed records and wraps;
  - seal a substitute account key to a device or contact public key (section 5.6, open requirement);
  - serve modified web code (section 9).

  It cannot move a record to another id, entity, version, user or collection, or present a genuine wrap as another role or id, without the tag check failing (sections 5.5 and 6).

### 4.3 Compromised backup

A copy of the database dump, or of the sealed store, in someone else's hands.

- Default today: a plain `pg_dump` unless the operator sets `BACKUP_AGE_RECIPIENT`, in which case it is encrypted to a public key whose private key never lives on the server (`docs/self-hosting.md`). Retention is `BACKUP_RETENTION_DAYS`, default 30.
- Default after lane D: text fields are ciphertext, amounts and dates are not. The plan keeps data keys in a separate schema excluded from the main dump (D2, not built). Crypto-shredding on account deletion helps only for rows that were already backfilled (section 7).
- Advanced: sealed rows are ciphertext. Plain columns (ids, timestamps, sizes, shared data) are in the dump. Backups taken before the commit of turning protection on still hold personal amounts until retention ends.

### 4.4 Stolen phone

- The device key pair and any stored secrets would sit in the Keychain or Keystore via `expo-secure-store` with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (`apps/mobile/src/lib/secure-store.ts`). That class is readable while the phone is locked but after its first unlock since boot, so background sync works. It is not copied to backups or other devices.
- Today the mobile cache is an unencrypted SQLite key-value file (`apps/mobile/src/data/sqlite-store.ts`). The plan for protected accounts is SQLCipher with a random database key in the Keychain or Keystore (L1, not built, needs the owner's OK on build config).
- Revocation: a lost device's wrap can be revoked from another device or by a new password, and rotating the account key makes every old wrap useless (spike section 4.6). None of this is built.
- A thief who has the unlocked phone has what the app has.

### 4.5 Malicious shared-project member

- Sees everything shared in the project, by design. The server does not hide it from them and neither can the app.
- Cannot see another member's sealed personal data. A protected person's categories are sealed, so shared views show a neutral fallback instead of the category name (spike section 2.3, K7, not built).
- Cannot make a protected person's device trust a wrong key if the fingerprint phrase is compared (section 5.8).
- As a trusted contact: the contact must have Advanced protection on, or their private key would be server-recoverable and so would the user's data (spike section 4.7). Nothing enforces this yet. The contact can request access only after the waiting period the user chose, but a malicious server that colludes with the contact could skip the wait (spike section 4.7). Say this to users.
- People without accounts (shadow people, guests) have no keys, so what they see stays server-readable.

### 4.6 Network attacker

- TLS and HSTS protect the transport. A network attacker who breaks TLS sees ciphertext and metadata for protected accounts, and everything for default accounts.
- Push services (APNs, FCM, UnifiedPush) and the mail provider see what push and email carry (section 8).
- The prelogin route must return deterministic fake parameters for unknown emails so it cannot be used to discover accounts (F8a, not built).

## 5. Key hierarchy as built

All of this is in `packages/crypto/src/keys.ts` and `primitives.ts`. Nothing there stores, sends or logs a key. Errors are `CryptoError` with one of two fixed messages (`errors.ts`).

### 5.1 Primitives

| Job | Primitive | Notes |
|---|---|---|
| Data | XChaCha20-Poly1305-IETF, 24-byte random nonce | `aeadEncrypt` takes the caller's nonce, so never reusing one is a rule, not enforced. Only `sealRecord` and `wrapKey` draw a random nonce, and the nonce-taking variants (for vectors) are left out of the package index |
| Password to key | Argon2id v1.3 (`crypto_pwhash`) | libsodium fixes parallelism at 1 |
| Subkeys | `crypto_kdf_derive_from_key` (keyed BLAKE2b) | 8-character ASCII context, id below 2^31 |
| Public-key wrap | X25519 sealed box (`crypto_box_seal`) | Anonymous sender |
| Blind index, binding | BLAKE2b, optionally keyed | |

libsodium comes from `libsodium-wrappers-sumo` 0.8.4 on web and Node, and `react-native-libsodium` 1.7.0 on mobile (`packages/crypto/package.json`, `apps/mobile/package.json`). Because the native build takes additional data only as a string, every AAD is printable ASCII and ids are limited to `[A-Za-z0-9_-]{1,64}`. The native build also lacks `crypto_kx`, `crypto_scalarmult` and `memzero`, so `wipe` is a best-effort `fill(0)` that JavaScript does not guarantee reaches every copy.

### 5.2 Password key

1. The password is normalized with NFKC and encoded as UTF-8 by hand, so every runtime gives the same bytes. An empty password is refused.
2. The salt is 16 bytes. Argon2id runs with the salt and the parameters to give the master key (MK, 32 bytes, never stored).
3. Parameters: default 64 MiB and 3 passes. **Floor** 46 MiB and 1 pass (OWASP's alternative). **Ceiling** 256 MiB and 10 passes. `deriveMasterKey` checks the range before doing any work and refuses anything outside it, because the parameters come from the server (`ARGON2_DEFAULT`, `ARGON2_FLOOR`, `ARGON2_CEILING`, `checkArgon2Params`).

What this does and does not buy:

- A hostile server cannot make a phone allocate or spin without bound, and cannot pick parameters below the floor.
- A hostile server can still choose the floor. Against that server, password guessing costs one 46 MiB, 1-pass Argon2id per guess. The password strength is then the only defense. The same holds for anyone who steals the database: the stored password-wrapped account key and the server's hash of the auth key are both offline guessing targets with the stored parameters.
- The floor is not yet proven on target devices. The device benchmark (F4) has not run, so the default is an estimate (spike section 4.3).

### 5.3 Subkeys and contexts

| Source | Context | Id | Result |
|---|---|---|---|
| MK | `rs.mk.v1` | 1 | auth key, sent to better-auth as the password |
| MK | `rs.mk.v1` | 2 | password wrapping key |
| Recovery key | `rs.rk.v1` | 1 | recovery wrapping key |
| Account key | `rs.ak.v1` | | reserved, unused |

The auth key and the wrapping key are independent outputs of one keyed hash, so the server learning the auth key (it receives it at every sign-in) does not give it the wrapping key. better-auth is to hash the auth key again before storing it (spike section 4.4). None of the sign-in wiring is built (F8a, F8b).

### 5.4 Account key and collection keys

- **Account key (AK):** 32 random bytes. Wrapped separately by the password wrapping key, the recovery wrapping key, and (sealed boxes) each device and each trusted contact.
- **Account key pair:** an X25519 key pair. The private key is wrapped by AK. `keyPairMatches` seals a random probe to the public key and opens it with the private key, to catch a server that swapped the stored public key after the private key is unwrapped.
- **Collection key:** 32 random bytes plus a random 16-byte key id, one per collection and key version (`generateCollectionKey`). Wrapped by AK. Personal data uses one collection. A project key is later work.
- There are no per-record keys.

### 5.5 Wraps and role-bound AAD

Symmetric wrap (raw bytes, callers encode with base64url):

```
01 01 | nonce (24) | XChaCha20-Poly1305(wrapping key, plaintext = the 32-byte key)
AAD   "rs.wrap.v1|0101|<role>|<id>"
```

Roles: `ak-password`, `ak-recovery`, `collection-key`, `private-key`. The id names which key it is: the user id for AK and the private key, the key id in hex for a collection key.

Public-key wrap:

```
01 02 | sealed box(plaintext = 32-byte key | BLAKE2b-16 of the AAD text)
AAD   "rs.wrap.v1|0102|<role>|<id>"
```

Roles: `ak-device`, `ak-contact`. The id is the device or contact id. The AAD text is hashed into the plaintext because a sealed box has no associated data of its own.

Effect: the server can store, withhold and replay wraps, but a genuine wrap cannot be presented as a different role or id. Unwrap checks the version and algorithm bytes (`invalid_input` if unknown), the exact length, and then the tag (`decrypt_failed`). A failure never says which part failed.

### 5.6 Public-key wraps do not authenticate the account key

A sealed box has no sender. Anyone who has a device's or contact's public key, the server included, can seal any 32 bytes for that role and id, and the BLAKE2b binding inside is computable by the same party. A server can therefore build a substitute account key, wrap its own private key and collection keys under it, and seal that account key to the device. The device has no cryptographic way to tell the keyset from its own.

A consequence (our reading, not in the code comments): a device that accepts the substitute would write new records under keys the server holds. Existing records would fail to open, which a client could notice but no code defines a response to.

This is an open requirement (section 11, item 1). The code comment in `keys.ts` and the spike require one of two fixes before device approval or trusted-contact recovery ships: the device pins a commitment to AK when it is approved (for example BLAKE2b of AK in secure storage, checked on every unwrap), or the approving device authenticates the wrap with `crypto_box` using its static key pair, checked against a fingerprint the user confirmed. Password and recovery-key unlock are not affected, because the server does not know those wrapping keys.

### 5.7 Recovery key

- 32 random bytes plus a 4-bit version (1) make 260 bits. They are written as 52 symbols of the Crockford base32 alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, most significant bit first, followed by two check symbols: 54 symbols in nine groups of six joined by `-`.
- The check symbols are over GF(32) with polynomial x^5 + x^2 + 1. Check 1 is the sum of the data symbols. Check 2 is the sum of a^i times data symbol i. Every single wrong symbol and every swap of two adjacent different symbols is caught. A random multi-symbol error passes both checks with probability about 1 in 1,024. The checks guard against typing mistakes, not attackers, and they add no strength to the key.
- Input is read case-insensitively, ignoring spaces and `-`, with O read as 0 and I and L as 1. A wrong length, a stray character, a failed check or a version other than 1 is `invalid_input`.
- The recovery key is the whole account in one string. Anyone who has it and the server's recovery wrap (the server has the wrap) can open everything. Unlocking with it requires setting a new password (spike section 4.7).
- The spike section 4.7 text says 13 groups of 4. The code and the 2026-11-08 requirement say 9 groups of 6 with two checks. The owner has not yet confirmed (section 11, item 2).

### 5.8 Fingerprint phrase

`fingerprintPhrase` takes one or more public keys in an order both sides agree on and returns six proquint words (Wilkerson 2009), which are the first 12 bytes of BLAKE2b with a 16-byte output over `rs.fp.v1` followed by the keys. That is 96 bits. Two people compare it aloud to confirm they hold the same public key (trusted contact) or the same pair of keys (device approval).

Open design question (our analysis, not in the spike):

- **One key fixed** (trusted contact: the user compares the phrase of the contact's real key). To pass a substitute key the attacker needs a second preimage, about 2^96 work.
- **Both keys of a pair controlled by the relaying party** (device approval, where the server relays both public keys). The two sides see different hashes, so the attacker needs only a collision between two lists it grinds itself, about 2^48 work. Keys are cheap to grind, so this is feasible for a well-resourced attacker, not for a casual one. Only the party that relays both keys, in practice the server, can do it. The work is online: the new device's ephemeral key is fresh for each session, so the grinding has to finish inside the approval window.
- **Length is not the right fix.** 128-bit second-preimage resistance would need 8 proquint words, and 128-bit collision resistance 16, which no one will read aloud.
- **Ordering is.** Commit to one key before the other exists, as Bluetooth Secure Simple Pairing and ZRTP do: the new device's code, typed into the existing device, commits to the new device's ephemeral key before any phrase is shown. The attacker then has to find a second preimage against a fixed commitment instead of a free collision. This is a protocol step, not a primitive, and it is not built (section 11, item 7).

## 6. Record format

`packages/crypto/src/format.ts`. One record, one encrypted payload.

```
byte 0        format version (1)
byte 1        algorithm (1 = XChaCha20-Poly1305-IETF)
bytes 2..17   key id (16 bytes, names the collection key version)
bytes 18..41  nonce (24 random bytes)
bytes 42..    ciphertext, then the 16-byte tag
plaintext     schema version (u16 big endian) | canonical JSON | padding
AAD           "rs.v1|<bytes 0..17 as 36 hex characters>|userId|collectionId|entity|recordId|version"
```

- **The header is authenticated.** Its first 18 bytes are in the AAD, so a rewritten key id, version or algorithm fails to open. An unknown version or algorithm is refused as `invalid_input` before any decryption, so a client can tell the user to update.
- **The record is bound to its place.** Moving a sealed record to another user, collection, entity, id or version fails the tag check. Ids are limited to `[A-Za-z0-9_-]{1,64}`, the entity to 0 to 65535, so `|` cannot appear inside a field and two different inputs never give the same AAD.
- **Padding** hides length: ISO/IEC 7816-4 style (`0x80`, then zeros) up to the next multiple of 64 bytes, always at least the one marker byte. Length is hidden only within a 64-byte bucket. Canonical JSON writes every character above `0x7e` as a `\u` escape, so any such character grows (an e with an acute accent becomes a 6-byte escape, and a character outside the Basic Multilingual Plane 12 bytes). Bucket size therefore leaks a little about which characters a record holds, not only its length. The ceiling is 1 MiB of plaintext.
- **Canonical JSON** is deterministic and pure ASCII (keys sorted, no spaces) so every platform produces the same bytes without a UTF-8 codec, and the golden vectors can pin them. Non-finite numbers, holes in arrays, class instances and nesting beyond 32 levels are refused.
- **Failure is uniform.** A wrong key, a key id that names no key, a wrong place, changed bytes, bad padding and non-ASCII plaintext all return `decrypt_failed`.
- **What the format does not do.** The server can still store, withhold and delete records. Rolling a record back to an older version of itself opens fine (it carries its own older version in the AAD), so it has to be caught by a per-record high-water mark kept on the device. That mark is not built, and it cannot detect a record the server never sent. The per-user change sequence in the spike (section 2.2) has no code yet either.

## 7. Server field crypto for default users (D1)

Merged into the segment at `038d4709`. A helper exists. Nothing calls it except the start-up key check in `src/instrumentation.ts`. No data keys, no Prisma extension, no backfill, no flag.

- **Cipher:** AES-256-GCM through `node:crypto`, 12-byte random nonce from the operating system for every call, never derived and never supplied by a caller. NIST SP 800-38D limits random 96-bit nonces to about 2^32 encryptions per key, so the design needs per-user data keys (D2) before D11. A single key over every field of the database would approach that bound far sooner.
- **Wire form:** `"\u0001k1:"` followed by base64 of `key id (u32 big endian) | nonce (12) | ciphertext | tag (16)`. The colon ends the version number so a later `k10:` cannot be read as `k1:`. A value that starts with U+0001 is ciphertext. An unknown version is an error, never plaintext.
- **AAD:** `"rs.k1"`, the key id (u32), then table, column and row id, each as a 4-byte length and UTF-8. Moving a ciphertext to another table, column or row, or relabeling its key id, fails the tag check. Every copy of an encrypted value between rows (recurring template to expense, import queue to expense, duplicate) must therefore be decrypted and encrypted again. Tables with composite keys need a defined row id.
- **Key ids and the keyring:** a keyring holds keys by id. The first entry is current and seals, the others only open. Keys are held as `KeyObject`s in private state, so logging a keyring shows no bytes.
- **Master key:** `DATA_MASTER_KEY` or the file `DATA_MASTER_KEY_FILE` names (a Docker or Kubernetes secret). Entries are `<id>:<64 hex>` separated by commas or whitespace, or a single bare key that is id 1. A key that is set but malformed, unreadable, all zero, repeated, or set both ways stops the server at start (`assertMasterKeyConfig`, called from `src/instrumentation.ts`). With neither set the key is absent and nothing is encrypted. Rotation: put the new key first with the next id, keep the old one, run the rewrap job (D12), then drop the old entry. The master key is meant to wrap per-user data keys (D2), and it is held outside the database.
- **Mixed mode:** `readField` returns plaintext as it is and decrypts ciphertext, so the database can hold both forms until the D12 backfill finishes. During that window anyone with database write access can substitute plaintext for a row and the reader accepts it. A plaintext value that starts with U+0001 would be read as ciphertext and fail. `userText()` now rejects control characters other than tab, line feed and carriage return, and lone surrogates (`packages/api-contract/src/common/user-text.ts`), and `Category.name` goes through it. Many contract fields are declared through `userText` (expense title in the contract, account and envelope names, income rule names and match text, fix requests). What still accepts any string are the tRPC routers (for example `src/server/api/routers/expense.ts:23`, `import-queue.ts:20`) and the other write paths (shared transaction description, people, recurring, settlement, guest, imports, the sidecar).
- **Crypto-shredding:** destroying a user's data key makes their ciphertext unreadable, but destroys nothing for rows that are still plaintext. The guarantee starts after D12, or has to be described with that limit.
- **Errors** carry a stable code and a fixed message, never a key, a key id, a plaintext or a ciphertext.

What this does not give: protection against whoever holds the running server and its master key, any protection for amounts, and any tamper detection on rows that are still plaintext.

## 8. What the server still sees

**Advanced accounts** (spike section 2.4, and what the record format leaves in the clear):

- That the account is protected, its email, name, avatar, time zone, locale, 2FA state, sessions, devices and IP addresses.
- For each sealed record: id, owner, collection, entity type, version, change sequence, key id, created, updated and deleted times, and the padded size (section 6).
- How many records of each type exist and when each was written or changed. That reveals activity patterns without content.
- Everything shared: amounts, titles, shares, notes, project names, who is in which project and who shares with whom. Balances between people.
- Which exchange rates the device downloads (mitigated by fetching the whole daily table).
- Wrapped keys, public keys, key ids, the number of devices and contacts, and Argon2id parameters and the salt.
- That a recovery or device-approval request happened, and when.

**Default accounts:** everything above, plus all personal amounts, dates and structure. Text fields become ciphertext after lane D, which the server decrypts for any caller with a valid token (the API, webhooks and integrations work as today).

**Notifications, push, email and webhooks:**

- Push text is made in one place from a kind, ids and an amount. It carries no title, note or name (`src/server/services/push/message.ts`; strings in `packages/i18n/messages/en/push.json`). Push services see the device token, timing, kind, and the amount when the kind has one.
- In-app notices and the emails made from them name the other person by display name and may carry an amount (`packages/i18n/messages/en/notificationText.json`, `resolveParticipantName` in `src/server/services/notifications.ts`). Their body never carries a title. They exist only for shared events.
- Event and webhook payloads keep ids, types and `Money` only: a walker drops every string unless its key says id and it has the shape of one (`src/server/services/events/data.ts`).
- For protected personal events the plan is ids and kind only, with `vault.changed` and a sequence number for sync (spike section 3). Not built.

## 9. The web limitation

Whoever serves the web app can change it to capture the password or keys. A compromised server, or a malicious operator, can do this without any cryptographic break. Bitwarden and Proton have the same limit. What is in place and what is planned:

- Built: a per-request nonce script policy with `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'` and `form-action 'self'` (`src/lib/csp.ts`). Styles still allow `unsafe-inline`.
- Built, not enforcing: Trusted Types is a report-only policy. The spike lists it as part of the page policy. It must be enforced before protection ships, after a pass over every screen shows no violation (`csp.ts`).
- Planned: keys and plaintext live in a Web Worker, never in page globals; the web does not remember the key by default and locks after inactivity (L5, not built).
- libsodium keys on the web sit in WebAssembly memory, not as non-extractable `CryptoKey`s. That matters only once script runs in the page, which already defeats web end-to-end encryption.
- Native apps from signed store builds are stronger, because the code does not change on every visit. Self-hosting removes the hosted operator from the trust chain.

## 10. Recovery paths and their trade-offs

Turning protection on requires at least one. Recommended order in the UI: recovery key first, the others on the same screen (spike section 4.7). Nothing here is built beyond the primitives in section 5.

| Path | How | Trade-off |
|---|---|---|
| Recovery key | 54-character text, saved or printed, confirmed by typing groups back. Unlock needs a new password | A bearer secret for the whole account. If it is lost with the password, the data is gone. If it leaks, so does the data |
| Second device | Each device has an X25519 key pair. The server stores AK sealed to each public key. A signed-in device can also set a new password after a fresh 2FA check and an email confirmation | Needs a second device. **Not safe until the AK-substitution requirement is closed** (section 5.6). The email and 2FA step trusts the server to enforce it for a device that is still signed in |
| New-device approval | A new device shows a code, an existing device seals AK to its ephemeral key, both show the same phrase | Needs the other device online. The pairing phrase needs a commitment step (section 5.8). `crypto_kx` is not available in the native build, so the handshake in the spike needs redesign |
| Trusted contact | The user's app seals AK to the contact's public key after both see the phrase. The server releases it only after the waiting period (1, 3, 7 or 14 days) without a refusal, with email and push at each step | The contact must have Advanced protection on. A server colluding with the contact can skip the wait. **Not safe until section 5.6 is closed** |
| Reset account | Deletes sealed data and keys, keeps the account, shared data and identity | Loses personal data. The only thing an email password reset does for a protected account |
| Turn off while unlocked | Client decrypts and posts plain rows through the normal services, then deletes the sealed records | Data becomes recoverable by the server again. Backups hold ciphertext only for the sealed period |

Passkey PRF unlock is a possible later convenience, never the only way in, because a de-Googled Android phone may have no PRF provider.

## 11. Open requirements before ship

From the spike sections added on 2026-11-08, plus things this draft found. An item is closed only when the code and a test exist.

From the F3 review:

1. **Account key substitution through public-key wraps.** Pin a commitment to AK on the device, or authenticate the wrap with the approving device's static key. Must be built with device approval or trusted-contact recovery, whichever comes first. See section 5.6.
2. **Recovery key text.** Owner confirms 9 groups of 6 with two GF(32) check symbols, replacing 13 groups of 4. See section 5.7.

From the D1 review:

3. **Move every write path of an encrypted field to `userText()`** and run a pre-backfill scan that fails if any existing row in those columns starts with U+0001, before D11 backfills or reads through `readField`. Otherwise a stored plaintext starting with U+0001 breaks reads for every member who can see the row. See section 7.
4. **AAD binds table, column and row id, not the user.** Update spike section 4.5 and D11. Every copy of an encrypted value between rows must decrypt and encrypt again, and tables with composite keys need a defined row id. Safe with per-user data keys (D2).
5. **Mixed mode accepts substituted plaintext until D12 finishes.** Anyone with database write access can do it until then. D3 crypto-shredding destroys nothing for rows not yet backfilled: order its guarantee after D12, or tell users so.

Found while writing this draft, not in the 2026-11-08 sections:

6. **Per-record high-water mark and omission.** Nothing detects a rolled-back or withheld record yet (section 6). Needs the mark, the change sequence, and a decision on whether a missing record can be detected at all.
7. **Design device approval with a commitment step** (section 5.8): the new device's code commits to its ephemeral key before the phrase is shown, so a relaying server cannot grind both halves. Design it together with item 1, because the same flow carries the approval that must authenticate or pin the account key.
8. **Trusted Types enforcement** and the worker for keys (section 9).
9. **Device benchmark (F4).** The Argon2id default and floor are estimates until measured (section 5.2).
10. **Plaintext deletion at commit and backup retention wording.** The owner signs off on the exact text and number of days before K11 merges (spike section 5.3 and 9, item 6). Backups hold personal amounts for up to `BACKUP_RETENTION_DAYS` after the commit.
11. **Wiring checks:** `auth key` hashing and prelogin (F8), the `protected_account` guard (F5), and the sidecar skipping protected users (F9) do not exist. Until they do, no server path is known to be safe for a protected account.

## 12. Where the spike and the code disagree

The code is what this document describes.

| Spike | Code |
|---|---|
| 4.5 record AAD is `rs.v1 \| userId \| collectionId \| entity \| recordId \| version` | The AAD also includes the header (version, algorithm, key id) as 36 hex characters (`format.ts`, `recordAad`) |
| 4.5 default-user AAD binds the user; wire form `\u0001k1` | AAD binds table, column, row id and key id. Wire form is `\u0001k1:` (`field-crypto.ts`). The 2026-11-08 note already says so; the section 4.5 text is old |
| 4.4 subkey contexts named "auth" and "wrap" | Contexts `rs.mk.v1` (ids 1 and 2) and `rs.rk.v1` (id 1), 8 ASCII characters each (`keys.ts`) |
| 4.7 recovery key is 13 groups of 4 | 9 groups of 6, 54 symbols, two GF(32) checks (the 2026-11-08 note already says so; owner has not confirmed) |
| 4.3 floor 46 MiB and 1 pass, default 64 MiB and 3 passes | Same, plus a ceiling of 256 MiB and 10 passes that the spike does not mention |
| 4.2 device approval uses `crypto_kx` | The native libsodium build has no `crypto_kx` (`primitives.ts`), so the handshake must use boxes or sealed boxes |
| 4.8 strict nonce CSP and Trusted Types on every page | Nonce CSP is enforced. Trusted Types is report-only (`csp.ts`) |
| 3 notifications are "generic text from ids, types and amounts" | Push is. In-app and email notices include the other person's display name (`notificationText.json`) |
| 2.4 "the device keeps a high-water mark per record" | No code. The format cannot do it alone (section 6) |
| 4.4 `MK ──kdf "auth"──> auth key` is sent to better-auth | F8 is not built. `src/server/better-auth/config.ts` has no auth-key wiring |
| 4.7 trusted contact "must have Advanced protection on" | No code enforces it, and no flow exists |

Everything else in spike section 4 that is built (XChaCha20-Poly1305, Argon2id, sealed boxes, 64-byte padding, role-bound wraps, 24-byte nonces, AES-256-GCM with 12-byte nonces, master key from file or environment with key ids) matches.

## 13. Audit and claims

An independent firm reviews the design and the code before any public claim (spike phase 6, W2). The audit package should include this document, `packages/crypto`, the vectors and their generators (`packages/crypto/scripts`), and `src/server/crypto`. The known-answer vectors were produced by implementations other than libsodium (`vectors/primitives.vectors.json`, `keys.vectors.json`), which is what lets them catch a wrong build. Questions to hand the auditor: section 5.2 (hostile parameters), 5.6 (account key substitution), 5.8 (the commitment step for device approval), 6 (rollback and omission), 7 (mixed mode), 9 (web delivery).

Until that report exists, wording stays at what is true today: no user's data is end-to-end encrypted, and none of it is encrypted with a server data key yet.
