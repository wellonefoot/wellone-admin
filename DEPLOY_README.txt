WellOne Admin v82
- Separate deployment; index.html is at ZIP root.
- Employees is visible in the main Admin navigation and as a Products-page shortcut.
- Create/edit/disable employee username/password accounts here.
- Product editor supports exact Colour + Size stock. Quick add: Blue + 5,6,7,8.
- Existing variant IDs are preserved during edits to reduce stale selections and improve sync safety.
- Run supabase/09_realtime_exact_variant_sync.sql after the v80/v81 database migration.
