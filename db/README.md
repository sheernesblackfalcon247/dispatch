# Database

## Standing up a NEW instance

On a brand-new, empty Supabase project, run these in the SQL editor **in order**:

1. `00_schema.sql` — types, tables, keys, indexes, helper and trigger functions
2. `01_functions.sql` — pricing, booking, tracking, cash, reporting; triggers; row-level security
3. `2026-09-15_external_bookings.sql` — adds `create_external_booking()`
4. `02_seed.sql` — car classes, distance bands, surcharges, default settings

That's it. `00` and `01` are a full snapshot of the database as it stood on
2026-09-23, so the other dated files below are already folded into them — you do
not need to run them on a fresh project (they are idempotent, so running them
does no harm either).

Then two things `02_seed.sql` deliberately leaves out, because they belong to
whoever runs this particular instance:

- **The first admin.** Sign the user up through Supabase Auth, then
  `insert into profiles (id, full_name, email, role) values ('<auth user id>', 'Admin', 'you@example.com', 'admin');`
- **A website row.** `insert into websites (name, slug) values ('Main Website', 'main');`
  then read back its generated `api_key` and put it in `WIDGET_API_KEY`.

Car classes, pricing and settings all arrive with the seed, so the widget can
quote a fare as soon as those two rows exist.

## Why 00_schema.sql exists

The repo only ever carried incremental changes, so the actual shape of the
database lived nowhere but inside one Supabase project. Spinning up a second
instance was impossible from the repo alone. These two files fix that.

Regenerate them if the schema drifts a long way from what is here.

## Dated migrations

Applied to the original project in this order. Kept for history; already
included in `00`/`01` except where noted.

| File | What it did |
|---|---|
| `2026-09-05_pricing_base_plus_bands.sql` | Base fare + tapered distance bands; dropped per-minute and minimum fare |
| `2026-09-12_stripe_hardening.sql` | `payments` review columns, unique index on `stripe_payment_intent_id`, `stripe_events` |
| `2026-09-12_external_driver.sql` | Hand one ride to an outside driver, with their car |
| `2026-09-12_stripe_checkout.sql` | `checkout_drafts` — trips parked while the customer pays on Stripe |
| `2026-09-15_external_bookings.sql` | Off-platform bookings — **also defines `create_external_booking()`, so run this one** |
| `2026-09-28_distance_bands_add_up.sql` | "Add up distance bands" switch in Admin → Pricing. Already in `01`/`02` for new instances; **run it on every instance created before 2026-09-28** |
