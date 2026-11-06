# butter-marketplace

## Database

This app owns three tables — `buyer_interest`, `buyers` and `buyer_sessions`.
It also reads `providers`, `provider_sessions` and `listings`, which belong to
the seller app and share the same Postgres; that app creates and migrates
them, and nothing here writes to them.

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
