# butter-marketplace

## Tests

`npm test` checks schema integrity: that `ensureSchema()` still runs, and
still leaves the index's query working, against a database holding the kinds
of rows the seller app writes.

It needs a real Postgres, and it drops the public schema between cases, so it
refuses any `DATABASE_URL` whose database is not named like a test one:

```sh
createdb salt_test
DATABASE_URL=postgresql://localhost:5432/salt_test npm test
```

CI runs the same thing against a throwaway Postgres on every pull request,
along with `tsc --noEmit` and a production build.

### Why this is worth a service container

`ensureSchema()` runs on every render of the marketplace index, not at
startup, so a statement it rejects is a 500 on the buyer-facing page rather
than a failed deploy. It also runs against a database shared with the seller
app, which owns most of these tables and changes them on its own schedule.
That has taken production down once already: the seller app made
`providers.email` nullable for phone sign-in, and the personal-org backfill
was naming each org after the email local part into a NOT NULL column.

None of that reproduces without a real database, which is why the tests want
one rather than a mock.
