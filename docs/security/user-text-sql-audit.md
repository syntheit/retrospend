# User text in SQL: audit for field encryption (lane D10)

Lane D11 encrypts the columns in `USER_TEXT_FIELDS`
(`packages/api-contract/src/common/user-text.ts`) with a server key. After
that, a column holds ciphertext (`"\u0001k1:" + base64`, with a random nonce
per write), so Postgres can no longer match, sort, group or compare it, and a
raw SQL result is not decrypted by the Prisma client extension. This audit
finds every reader of those columns and says what each one needs. D11 starts
from section 8.

Audit base: `d8327c4e` (main with D1 to D8 merged). Done on branch
`e2ee/d10-raw-sql-audit`, which also moves the readers marked "moved in D10".
Two tests keep section 3 true, in `src`, `scripts` and `packages`, outside
tests:

- `src/test/userTextRawSql.test.ts`: a tagged `$queryRaw`, `$executeRaw` or
  `Prisma.sql` template that names a user-text column word may only sit in the
  three files audited in 3B. It does not see SQL passed as a plain string (B12)
  or Go (section 3D is by hand).
- `src/test/userTextModelQueries.test.ts`: the argument of `where`, `orderBy`,
  `having`, `cursor`, `distinct` or `by` (and an object assigned to a variable
  named like `...where...`) may not name a column word as a key, a shorthand
  key or, in `by` and `distinct`, a quoted string, except in the explicit
  allow list, each with a reason: the kept SQL paths of A18 to A22 and token
  `identifier` filters (section 11). It is a word match, not a type check. A
  filter built under another name, or a `select`/`data` use, is not seen. Its
  own tests show it catches the shapes of A1 to A17 (`orderBy name`, `contains`
  with `mode: "insensitive"`, `equals`, plain equality, `groupBy`).

## 1. Method

The columns are the 38 table.column pairs in `USER_TEXT_COLUMNS`
(`scripts/scan-control-chars.ts`), which cover every declared field
(`src/test/migrations/user-text-capacity.pg.test.ts` maps field to column).
Searched, outside test files:

- Every `$queryRaw`, `$executeRaw`, `Prisma.sql` and `sql` template in `src`,
  `scripts` and `packages` (180 templates and fragments; 26 name a text column, all in three files), and every
  Unsafe call (none outside tests, `rawSqlScan.test.ts`).
- Every Prisma model query whose `where`, `orderBy`, `groupBy`, `distinct`,
  `having` or `cursor` names one of those columns, found with a syntax tree
  walk over `src`, `scripts`, `packages` and `apps`, plus `contains`,
  `equals`, `startsWith`, `in` and sort filters on a text column anywhere.
- Every SQL function, trigger, constraint, index, default and policy in
  `prisma/migrations`, `prisma/grants`, `prisma/bootstrap`, `prisma/rollback`
  and `prisma/deferred`.
- All SQL in the Go sidecar (`sidecar/tasks`, `sidecar/db`, `sidecar/config`;
  the importer does not touch the database).
- Scripts in `scripts/` and `prisma/scripts/`.

Not found: views, materialized views, text search indexes, `string_agg`,
`LIKE`/`ILIKE` on a column outside the search code, `lower()` outside it, or
an RLS policy that reads text (policies read ids, roles and statuses).

## 2. Classes

- **(a) Pass through.** The column is returned or copied and nothing computes
  on it. Safe if the reader decrypts. Prisma model reads decrypt in D11's
  client extension. Raw SQL results do not, and a SQL copy between rows moves
  ciphertext that is bound to its row, so each raw one is listed.
- **(b) Computes in SQL.** Sorts, filters, groups, compares or transforms the
  text. Must move to the app layer, or be dropped.
- **(c) Shared data that stays plaintext.** Owner decision: shared text is
  sealed with an instance-wide key, so it is encrypted. Nothing in this audit
  is treated as plaintext. One reader that had assumed it was found and moved
  (A20). Section 6 lists the shared columns.

"Moved" means the reader now gives the same answer on plaintext as the old
SQL, shown by a pg test that runs the old SQL as the oracle. "Kept" means a
SQL path remains for a database without field encryption and the app-layer
path (picked by `searchesInApp(keyring)`) is already there; D11 must pass the
keyring (section 8).

## 3. Readers

### A. Prisma model queries (and constraints that read a column)

Lines are at the audit base unless the status says "kept", then they are the
current lines.

| # | file:line | What it reads | Class | Action |
|---|---|---|---|---|
| A1 | `src/server/services/category.service.ts:37-39` | `category` list ordered by usage, then `name` | b | Moved in D10: usage in SQL, name sorted in the app |
| A2 | `category.service.ts:51-63` | v1 category page: `name` keyset and `orderBy name` | b | Moved in D10: all of a user's categories read, sorted and cut in the app |
| A3 | `src/server/services/entry/catalog.ts:85-87` | categories by usage then `name` | b | Moved in D10 |
| A4 | `entry/catalog.ts:98-104` | accounts by `type` then `name` | b | Moved in D10: `type` (an enum, so declaration order) stays in SQL, name sorted in the app |
| A5 | `src/server/services/envelope/bank.ts:67-69` | accounts by `name` | b | Moved in D10 |
| A6 | `src/server/services/envelope/book.service.ts:54-56` | expense categories by `name` | b | Moved in D10 |
| A7 | `src/server/services/envelope/legacy-migrate.service.ts:243-245` | expense categories by `name`, `id` | b | Moved in D10 |
| A8 | `src/server/services/expense.service.ts:461-464` | filter options: categories by `name` | b | Moved in D10 |
| A9 | `src/server/services/export/account-zip.ts:84-86` | categories by `name` | b | Moved in D10 |
| A10 | `src/server/services/money-in.service.ts:40-42` | income categories by `name` | b | Moved in D10 |
| A11 | `src/server/services/claim.service.ts:341-344` | project people by `name` | b | Moved in D10 |
| A12 | `scripts/sync-default-categories.ts:50-53` | sample print ordered by `name` | b | Moved in D10 |
| A13 | `scripts/verify-categories.ts:38-41` | sample print ordered by `name` | b | Moved in D10 |
| A14 | `src/server/api/routers/people.ts:39-44` | ghost search: `name contains` | b | Moved in D10: the newest 20,000 visible ghosts read (RLS scopes them), matched in the app |
| A15 | `people.ts:96-102` | contact search: `name`, `email`, `username contains` | b | Moved in D10 (`ilikeContains`, so `%` and `_` act as before) |
| A16 | `src/server/services/envelope/debt-payment.service.ts:51-54` | the Fees category found by `name` | b | Moved in D10. It now filters by the caller's `userId`, and so does the `given` branch at `:50-53` (behavior change, section 9) |
| A17 | `src/server/services/accounts/manage.ts:415` | account import finds an open account by `name` | b | Moved in D10: open accounts read once, matched in a map, one made for a row is found by a later row of the same name |
| A18 | `src/server/services/title-suggestions.service.ts:111-118` | personal titles: `groupBy title`, `contains`, `orderBy _count title` | b | Moved in D6 (`personalInApp`), SQL path kept |
| A19 | `title-suggestions.service.ts:122-134` | last use: `title in`, `distinct title` | b | Moved in D6, SQL path kept |
| A20 | `title-suggestions.service.ts:243-262` | shared descriptions: `groupBy description`, `contains` | b | The file said "shared data, stays in SQL". Moved in D10 (`sharedInApp`), SQL path kept |
| A21 | `src/server/services/expense-duplicate.ts:70-76` | duplicate check: `title equals` | b | Moved in D7, SQL path kept |
| A22 | `src/server/services/import/review.ts:150-158` | import review: `groupBy title`, `title equals` | b | Moved in D8, SQL path kept |
| A23 | `src/server/services/envelope/rule-store.ts:30` | rule `matchTitle`, matched in the app | b | Moved in D8 (reads through `readUserText`) |
| A24 | `src/server/services/recurring-delete.mutation.ts:148-168` | same-name template check | b | Moved in D8 (always in the app) |
| A25 | `src/server/services/import/match.ts:44,101,210` | import match compares titles | b | Moved in D8 (app only, titles opened first) |
| A26 | `prisma/schema.prisma` (`@@unique([name, userId])` on `category`), `20251226151141_initial_schema/migration.sql:384` | the unique key on `name` | b | Handled by D9 (merged): `nameIndex`, a keyed hash with its own unique index. The old unique drops with `prisma/deferred/D9_drop_category_name_unique`. Callers that lean on the old key until then: `money-in.service.ts` and `scripts/sync-default-categories.ts` (`createMany` with `skipDuplicates`), `better-auth/config.ts` (default categories). `category.service.ts` `assertNameFree` compares by index when both indexes were made with the same key and falls back to the trimmed name for an unindexed or stale row (a deliberate transition path until D11, so it reads `name` in the app, not in SQL), and `scripts/backfill-category-name-index.ts` reads only `nameIndex` and ids |
| A27 | `prisma/schema.prisma:264`, `20251226151141_initial_schema/migration.sql:382` | index `[userId, date, title, amount, currency]` | b | D7 added `[userId, date, amount, currency]` (`schema.prisma:262`). The old index drops with `prisma/deferred/D7_drop_duplicate_title_index` |

### B. Raw SQL in the app and scripts

| # | file:line | What it reads | Class | Action |
|---|---|---|---|---|
| B1 | `src/server/services/search.service.ts:194-220` (base) | v1 people search: `immutable_unaccent(name) ILIKE`, `UNION`, `ORDER BY name` | b | Moved in D10 (`searchPeople`): SQL picks the ids of people the caller shares with, names come from model reads |
| B2 | `search.service.ts:243-256` (base) | v1 project search: `name`, `description ILIKE`, `ORDER BY name` | b | Moved in D10 (`searchProjects`) |
| B3 | `search.service.ts:274-282` (base) | v1 category search: `name ILIKE`, `ORDER BY name` | b | Moved in D10 (`searchCategories`) |
| B4 | `src/server/services/search.service.ts:87-118` | v1 expense search, SQL path: `title`, `description`, `location` | b | Moved in D5 (`searchExpensesInApp`), SQL path kept |
| B5 | `search.service.ts:120-170` | v1 expense search, app path: reads `title`, `description`, `location` | a | Raw columns opened by `readUserText`. Never runs without a keyring when D11 is on |
| B6 | `src/server/services/expense-list/query-parts.ts:52,161-163` | Activity search over personal `title`, `description`, `location` (`lower(translate())`) | b | Moved in D5, SQL path kept |
| B7 | `query-parts.ts:211` | Activity search over shared `description`, `notes` | b | Moved in D5, SQL path kept |
| B8 | `query-parts.ts:253` | Activity search over payment `note`, `paymentMethod` (concatenated) | b | Moved in D5, SQL path kept |
| B9 | `src/server/services/expense-list/search-scan.ts:99-101` | candidates: `ARRAY[title, description, location]` | a | Opened by `readUserText` in the same file |
| B10 | `search-scan.ts:106-107` | candidates: `ARRAY[description, notes]` of shared rows | a | Same |
| B11 | `search-scan.ts:114-123` | candidates: `array_agg(note)`, `min(paymentMethod)` of payment groups | a | Same |
| B12 | `scripts/scan-control-chars.ts:105-109` | counts rows with control characters, a leading U+0001 and U+FFFD, per column | b | Intended: it runs before D11 and D12. After the backfill every row starts with U+0001, so its count then means "sealed". Document in the D12 runbook |
| B13 | `src/server/better-auth/config.ts:168` (adapter) | better-auth reads and writes `user.name` through the global client | a | D11 must apply the extension to that client too (section 8) |

### C. Database functions, triggers, defaults and policies

Migration files are in `prisma/migrations/`.

| # | file:line | What it reads | Class | Action |
|---|---|---|---|---|
| C1 | `20261030300000_settlement_followups/migration.sql:639` | `settled_entry_ok`: audit entry `previous.paymentMethod` must equal the header's stored `paymentMethod` | b | **Blocker for D11.** See section 7 |
| C2 | `20261030300000_settlement_followups/migration.sql:719` | `claim_header_back_ok`: same equality on the undo | b | **Blocker for D11.** See section 7 |
| C3 | `20261030300000_settlement_followups/migration.sql:715` | `claim_header_back_ok`: the header minus `status`, `note`, `updatedAt` equals the old header (includes `paymentMethod`) | b | Holds only if the undo writes back the stored value unchanged. Section 7 |
| C4 | `20261030300000_settlement_followups/migration.sql:735-756` (`payment_guard_update`) | whole-row compare with `note` free and `paymentMethod` moved; a rejection keeps `paymentMethod` equal | a | Safe while an update that does not mean to change a text column does not re-seal it. D11 test |
| C5 | `20261029100000_settlement_write_rls/migration.sql:318-320,366,379` (`settlement_guard_update`) | `paymentMethod`, `note` free; `rejectedReason` must stay equal on finalize and put-back | a | Same condition as C4 |
| C6 | `20261026950000_split_write_rls/migration.sql:222-226` (`split_participant_guard_update`) | `rejectionReason` is in the review set, so excluded from the compare | a | No change |
| C7 | `20261030300000_settlement_followups/migration.sql:96-140` (`settlement_note_claim`, `payment_note_header`) | `to_jsonb(OLD)` of a settlement row and a header into `payment_tx_note.data`, which only definer functions read and the transaction end sweeps | a | No change; it copies stored values |
| C8 | `20261024200001_search_unaccent/migration.sql:39` (`immutable_unaccent`) | the function the SQL search paths call | b | Stays while a SQL search path stays; delete with them |
| C9 | `20261024000000_envelope_books/migration.sql:69` | `budget_book.name DEFAULT 'Personal'` | a | Plaintext default in a column D11 may map; reads as plaintext in mixed mode |
| C10 | `prisma/grants/app-role.sql:136,167` | column grants naming `name` | a | Grants only, no read |
| C11 | `20261027100000_co_participant_reads`, `20261030100000_s3_followups`, `20260305000005_fix_rls_recursion`, the category RLS fixes, budget dirty triggers | helper functions and policies | none | Checked: they read ids, roles and statuses, never text |

### D. Go sidecar

| # | file:line | What it reads | Class | Action |
|---|---|---|---|---|
| D1 | `sidecar/tasks/recurring.go:113` | `SELECT t.name` of due templates | a | Raw, so ciphertext. See D2 |
| D2 | `sidecar/tasks/recurring.go:196-205` | inserts `usertext.StripControls(template.Name)` as `expense.title` | b | **Blocker for D11.** `StripControls` removes U+0001, so it would corrupt a ciphertext name. The ciphertext also binds to its row (AAD), so a verbatim copy to a new expense row does not open. The job needs either Go field crypto (decrypt the name, strip, seal for the new id) or to move recurring posting into the app, which already does it through the extension (`recurringEntryData`, `money-in.service.ts`). The spike table's "copies ciphertext verbatim" predates the AAD change |
| D3 | `sidecar/tasks/cleanup.go:125-255` | guest anonymization rewrites participant ids to a sentinel | none | Checked: no text read. `guest_session.name` is deleted with the row |
| D4 | `sidecar/tasks/settlement_autofinalize.go:22` (deleted) | `UPDATE "Settlement"` with status columns | none | No text. The job never ran (wrong table name). Removed: the app now finalizes stale payments in `src/server/services/payments/auto-finalize.ts`, through the confirm core |

## 4. Collation

The ordering readers (A1 to A13, B1 to B3) sorted with the database's default
collation. The supported image is `postgres:16-alpine` (compose files, CI),
whose databases report `en_US.utf8` but sort by bytes, because musl has no
locale collation. For UTF-8 that is code point order: uppercase before
lowercase, "Zebra" before "apple", "apple" before "Ärger", no accent folding.
`compareText` (`src/server/services/text-order.ts`) compares by code point, so
plaintext lists come back in exactly the old order on that image.

Two differences, both tested or documented:

- JavaScript's `<` compares UTF-16 units, which orders an emoji before a
  character in U+E000 to U+FFFF. `compareText` compares code points, so it does
  not. `text-order.pg.test.ts` checks it against `ORDER BY ... COLLATE "C"` on
  400 random strings over six ranges plus a fixed set.
- A self-hoster on a locale-aware Postgres image (Debian, `en_US.UTF-8`) used to
  get "apple" before "Zebra". They now get the alpine order. A locale-aware
  sort (`Intl.Collator`) would be a product decision for every list at once;
  it is not made here. `text-order.pg.test.ts` fails if the test image stops
  sorting by bytes, so the change is noticed.

Ties sort by `id`. The old `ORDER BY name` left ties to the database, and
`name` is unique per user for categories, so only accounts and people could tie.

## 5. Counts

55 rows in sections 3A to 3D.

| Class | Rows | Moved in D10 | Moved earlier (D5 to D8) | Left |
|---|---|---|---|---|
| (a) pass through | 12 | 0 | 0 | 12, for D11 (section 8) |
| (b) computes in SQL | 40 | 21 | 11 | 8 |
| (c) shared, treated as plaintext | 0 | 0 | 0 | 0 |
| Checked, nothing to do | 3 | | | C11, D3, D4 |

- (a): B5, B9, B10, B11, B13, C4, C5, C6, C7, C9, C10, D1. B5, B9, B10 and B11
  are raw columns that `readUserText` already opens.
- (b) moved in D10 (21): A1 to A17, A20, B1, B2, B3.
- (b) moved in D5 to D8 (11): A18, A19, A21, A22, A23, A24, A25, B4, B6, B7, B8.
  Their SQL path is kept for a database without field encryption.
- (b) left (8): A26 and A27 (D9 and the D7 index drop), B12 (by design), C1, C2
  and C3 (settlement undo, blocker), C8 (`immutable_unaccent`, goes with the
  SQL search paths) and D2 (sidecar recurring, blocker).

## 6. Shared columns (class c)

These columns are read by people other than the writer. They are encrypted too
(instance-wide key, owner decision), so none of them may be matched in SQL:

`shared_transaction.description`, `shared_transaction.notes`,
`split_participant.rejectionReason`, `settlement.note`,
`settlement.paymentMethod`, `settlement.rejectedReason`, `payment.note`,
`payment.paymentMethod`, `project.name`, `project.description`,
`billing_period.label`, `shadow_profile.name`, `user.name`,
`fix_request.message`, `fix_request.reply`, and `category.name` (readable by
project participants through the category RLS fixes).

Each reader of them in section 3 is in the table above (A11, A14, A15, A20,
B1, B2, B7, B8, B10, B11, C1 to C5). The D11 key choice per table (user key
for personal rows, instance key for these) belongs in D11's field map.

## 7. Blockers for D11

### 7.1 Confirm and undo compare `paymentMethod` in SQL (C1, C2, C3)

`payments/confirm-restore.ts:71-83` (`previousOf`) puts `header.paymentMethod`
into the SETTLED audit entry's `previous`. `settled_entry_ok` (C1) requires
that value to equal the header column the database saw before the transaction
touched it, and `claim_header_back_ok` (C2) requires the undo to put the same
value back. After D11, `header.paymentMethod` read through the extension is
plaintext while the stored column is ciphertext, so every confirm would be
refused (the audit insert policy calls `settled_entry_ok`).

Also, `snapshotRow` (`confirm-restore.ts:36-48`) copies every settlement row
column into the audit entry, including `note`, `paymentMethod` and
`rejectedReason` as plaintext.

Recommended fix, no migration: the confirm builds `previous` from the stored
values (raw, so `paymentMethod` and the rows' text stay ciphertext) and the
undo writes them back verbatim. D11's write path must then accept a value that
is already a valid ciphertext for the same table, column and row id. The AAD
binds the row id and the restore targets the same rows, so it opens. That also
keeps plaintext text out of the audit log. If the verbatim write is not wanted,
the alternative is a migration that drops `paymentMethod` from C1, C2 and C3 and
keeps the method only in the audit entry as ciphertext; that edits settlement
write RLS and needs the High tier review. Either way, C4 and C5 need a test
that a status change does not re-seal `paymentMethod`, `note` or
`rejectedReason`.

### 7.2 The sidecar recurring job (D1, D2)

See D2. It is the only writer that copies a text column between rows in SQL.
Choose between Go field crypto and posting in the app before D11.

### 7.3 Pass the keyring (kept SQL paths)

`searchesInApp(keyring)` picks the app path. Nothing supplies a keyring yet. D11
must pass the user's keyring wherever the callers below read text, or they run
the SQL path over ciphertext and find nothing:

- The `searchExpenses` caller in `api-v1/search.ts`. `searchPeople`,
  `searchProjects` and `searchCategories` need no keyring: they read text
  through model reads, which the extension decrypts.
- `listActivity` and `searchKeys` in `expense-list/` (`index.ts`, `query.ts`).
- `titleSuggestions` (personal and shared).
- `findDuplicateExpense`, `importReview`, `import/match.ts`,
  `import/commit.mutation.ts`.
- `recurring-delete.mutation.ts` (`actor.keyring`), `envelope/rule.service.ts`,
  `rule-crud.service.ts`, `plan.mutation.ts`, `rule-store.ts` (`matchOf`),
  `preview/index.ts`.

After D12 finishes the backfill, the SQL paths are dead code. Delete them with
`immutable_unaccent`'s callers, and drop the `AUDITED` entries in
`userTextRawSql.test.ts` that no longer hold.

The app-layer search reads a bounded window (`APP_LAYER_WINDOW`, 20,000 newest
rows per source). On an account with more, older rows are not found. That limit
is a product call for D11, not changed here.

## 8. D11 checklist

1. Apply the extension to every client that touches these tables: the
   scoped client, the global client, the better-auth adapter (B13) and the
   sidecar (D1, D2).
2. Raw SQL results are not decrypted. Open B5, B9, B10, B11 with `readUserText`
   (they do) and keep any new raw reader on that rule.
3. Fix section 7.1 before turning on writes for `settlement` and `payment`.
4. Decide D2 (sidecar recurring).
5. Pass the keyring to the callers in 7.3.
6. A copy of a value between rows must decrypt and seal again for the new row.
   App copies that do (through the extension): recurring template to expense
   (`money-in.service.ts`), import queue to expense, duplicate. The only SQL copy
   is D2.
7. Never re-seal a column an update does not change (C4, C5), or the guards see
   a change.
8. Mixed mode: plaintext rows stay readable. `readUserText` already returns
   plaintext as is.
9. Unique and indexed text: `category.name` (A26, D9) and the title index (A27,
   D7 drop). Category creation depends on the unique key in three callers (A26).
10. The pre-backfill scan is B12. Run it before D12, then expect every row to
    start with U+0001.

## 9. Notes and one behavior change

- A16: `interestCategory` used `findFirst({ where: { name: "Fees", kind } })`
  with no user id, relying on RLS. RLS lets a project participant read another
  member's categories (the category RLS fixes), so the old query could return
  someone else's Fees category. It now reads the caller's own categories and
  matches the name in the app. The `given` branch (an interest category the
  caller passes) had the same hole: `category.count({ id, kind })` accepted
  another member's category. It now requires the caller's own, so a request
  that named someone else's category is refused with "pick one of your
  spending categories" where it used to book the interest to it. These are the
  only changes in what a query can return, and both are money writes; the pg
  tests in `envelope/debts.pg.test.ts` cover a visible foreign Fees, no own
  Fees, and the given branch.
- A14: the old ghost query cut candidates at 50 rows before the privacy
  filter; it now reads the newest `APP_LAYER_WINDOW` (20,000) visible ghosts,
  cuts to 50 after the name or email filter, and still answers at most 10. With
  more than 50 matches the old answer was an arbitrary subset. A ghost older
  than the newest 20,000 visible ones is not found. Ghost matching stays a
  literal, case-insensitive substring and does not use `ilikeContains`: the
  old query only prefiltered with ILIKE and a literal check after it decided,
  so `%` and `_` were never wildcards for ghosts (a test covers `_` and `%`).
- A15: contacts are matched with `ilikeContains`, so `%` and `_` in the query
  still act as pattern characters, as `contains` did, because that query had
  no second check. Read newest first, at most `APP_LAYER_WINDOW` contacts.
  `people-search-cap.pg.test.ts` shows the cut with a window of 3.
- A2: the v1 category page reads all of a user's categories each page. A user
  has dozens, so this is one small query.
- B1: the people search reads the newest `window` (default `APP_LAYER_WINDOW`,
  20,000) users the caller shares an expense or a project with (by account
  creation) and the newest `window` ghosts RLS lets them see, then filters.
  Other project members can add ghosts and join projects, so the set can grow
  without the caller acting. A person beyond the window is not found by
  search; lists and pickers are not affected. `search-names.pg.test.ts` checks
  the cut with a window of 2. Projects and categories are the caller's own and
  are read whole.

## 10. Copies of user text outside the declared columns

Not SQL readers, but plaintext copies that D11's field map will not seal. Each
needs an owner decision (seal, strip or accept) before the whitepaper says
"titles are encrypted".

| Where | What it holds | Source |
|---|---|---|
| `audit_log_entry.changes` | SETTLED entry: `previous.paymentMethod` and every settlement row column (`note`, `paymentMethod`, `rejectedReason`) | `payments/confirm-restore.ts:36-83`; fix in 7.1 |
| `audit_log_entry.changes` | project name on create and rename | `project/project-write.service.ts:120,242` |
| Idempotency records keyed `undo-stash:` | before-images of deleted or changed rows, so titles and notes | `entry/undo-stash.ts:18` |
| `envelope_change.previousName`, `envelope_change.before` | envelope and group names, before-images | `envelope/envelope-change.ts:102`, `crud.service.ts:185`, `combine.service.ts:345` |
| `import_job.fileData`, `import_job.fileName` | the uploaded file, which is all user text | `prisma/schema.prisma` `ImportJob` |
| `expense.importFingerprint` | SHA-256 of day, currency, amount, kind and the normalized title: unkeyed, so guessable for common merchant names | `import/match.ts:93-102`, `commit.mutation.ts:200` |
| `notification.title`, `notification.body` | generic text from lane A4 | `notification-text.ts` |
| `payment_tx_note.data` | row snapshots, one transaction, owner-only | C7 |

Text columns that exist but are not declared through `userText()`, so the field
map built from `USER_TEXT_FIELDS` will miss them: `budget_book.name`,
`budget_movement.note`, `wealth_transfer.note` (these three are in
`USER_TEXT_COLUMNS` of the control character scan, so they are scanned but not
declared), `envelope_change.previousName`, `import_job.fileName`,
`push_device.deviceName`, `error_report.message`, `error_report.stack`,
`apikey.metadata`, `feedback.pageUrl`. Declare the ones that hold what a
person typed (the first three, `previousName`, `deviceName`) before D11, or
record why each stays plain.

## 11. Checked and not user text

Searches on `email`, `username`, token `identifier` and `previousUsername` stay
in SQL: `people.ts:120-121`, `profile.ts:58,82`,
`shadow-profile.service.ts:111`, the `/u/` and `/pay/` username lookups, and the
token deletes in `auth.ts`, `guest.ts` and `account-security.service.ts`. These
are identifiers, not declared user text.

## 12. What D10 changed

Commits on `e2ee/d10-raw-sql-audit`:

1. `text-order.ts`, and the ordering moves A1 to A13 (`text-order.pg.test.ts`).
2. People, project and category search, B1 to B3 (`search-names.pg.test.ts`).
3. People router search, A14 and A15 (`people-search.pg.test.ts`).
4. Fees category and account import, A16 and A17 (`accounts/import.pg.test.ts`).
5. Shared descriptions in title suggestions, A20 (cases added to
   `title-suggestions.pg.test.ts`).
6. This document and `userTextRawSql.test.ts`.
7. Review fixes: the interest category is the caller's own, given or default
   (`envelope/debts.pg.test.ts`); a bounded window for people search
   (`people-search-cap.pg.test.ts`, `search-names.pg.test.ts`); the model query
   guard (`userTextModelQueries.test.ts`) and the wider raw SQL guard.

Each move has a pg test that runs the old query as the oracle on mixed names
(accents, case, `%`, `_`, backslash, emoji, U+E000), page by page for the
cursor lists.
