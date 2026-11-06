# butter-marketplace

## Buyer portal

A signed-in buyer gets `/portal`: every assignment collecting for them, the
site each is recorded at, and the footage that has landed so far.

`assignments.buyer_id` is the whole link, and the chain from there is one step
at a time — buyer → assignment → episode (one recording session) → file (the
video, its motion and pose logs, the manifest). `lib/footage.ts` holds every
query, and puts `a.buyer_id = ...` in each one, so a page that forgets cannot
leak. An assignment with a null `buyer_id` was recorded on the workspace's own
account to list later and belongs to no buyer.

Two rules sit in front of the bucket, both in `getBuyerFootageObject`:

- the file has to hang off an assignment collecting for this buyer, and
- the seller app's malware sweep has to have passed it (`scan_status` is
  `clean`). Anything else is reported as missing, so a file still being
  checked and another buyer's recording look the same from outside.

`/portal/footage/[fileId]` redirects to a bucket URL signed for fifteen
minutes rather than proxying the bytes: a recording runs to gigabytes, and a
proxy would hold a connection open for the length of the video and break
seeking. The signed URL never reaches the HTML, so what is in the markup is a
path that re-checks the session on every hit.

### Buyer accounts

An account signs in with a user id or a work email — one field, because
nobody should have to say which kind of credential they hold. `username` is
for accounts held by a team rather than a person, where the login is handed
over with the role; `email` is nullable for that reason.

## Database

This app owns three tables — `buyer_interest`, `buyers` and `buyer_sessions`.
It also reads `providers`, `provider_sessions`, `listings`, and the footage
tables (`organizations`, `sites`, `assignments`, `data_episodes`,
`data_files`, `asset_consents`), which belong to the seller app and share the
same Postgres; that app creates and migrates them, and nothing here writes to
them. `test/fixtures/external-tables.sql` writes down the subset this app
depends on, so the dependency is recorded rather than implicit.

`buyers` is the one table both apps write. A buyer is one company to each of
them, so there is one row per company and each app owns a half of it: the
seller app adds `name`, `code` and `next_kit_number` and points assignments
at the row; this app adds the login. Neither assumes which reached the table
first — the seller app's `upgradeOldBuyersTable` adopts the columns declared
in `0002`, and `0004` adds its own with `IF NOT EXISTS`.

Schema changes go in `migrations/` as numbered `.sql` files. `npm run migrate`
applies the ones that have not run yet, recording each in `schema_migrations`
and holding an advisory lock so two instances deploying together queue instead
of racing. Railway runs it as the pre-deploy command (`railway.json`), so a
migration that fails fails the deploy and the running version keeps serving.

Nothing creates or alters anything at request time, and a test enforces that.
It used to: an `ensureSchema()` ran on every render of the index, which is how
a `NOT NULL` violation became a public 500 rather than a red deploy.

## Tests

`npm test` applies the migrations to a throwaway database, checks the app's
queries still run against the result, and checks no DDL has crept back into
the request path.

It needs a real Postgres, and it drops the public schema between cases, so it
refuses any `DATABASE_URL` whose database is not named like a test one:

```sh
createdb salt_test
DATABASE_URL=postgresql://localhost:5432/salt_test npm test
```

CI runs the same thing against a throwaway Postgres on every pull request,
along with `tsc --noEmit` and a production build.

The portal's queries are written out in the test rather than imported —
`lib/footage.ts` pulls in `server-only`, which Next resolves through its
bundler and plain Node cannot load. They mirror that file, so change both
together or the test stops proving anything about the real query.

## Footage storage

The five `S3_*` variables in `.env.example` are read access to the bucket the
seller app uploads to. A read-only key is enough; nothing here writes. Left
blank, the portal still lists everything that was collected and the players
and download links say footage can't be opened — which is what local
development looks like.
