WellOne Admin v83 — fixed/optimized
- Separate deployment; index.html is at ZIP root.
- Employees is a normal Admin menu section only; it is not shown as a shortcut on the Products home screen.
- Employee list is directly below the Add/Edit Employee form.
- Passwords remain hashed in Supabase. Passwords created/reset from this Admin browser are remembered locally and displayed in the list.
- Product editor keeps exact colour + size stock combinations and preserves existing variant IDs where possible.
- v83 uses a fresh service-worker/cache namespace and stable static-asset caching.
- No new database migration is required for this v83 performance/fix pass.
