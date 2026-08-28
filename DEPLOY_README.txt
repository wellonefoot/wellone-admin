WellOne Admin v88 — stable login + 20-product infinite loading

DATABASE
- v88 performance/login changes require NO new SQL.
- Existing commerce features still require migrations 10 and 11 if they were never installed.

DEPLOY
- Deploy the CONTENTS of this folder to the admin site root.

V88 PERFORMANCE / RELIABILITY
- Restored the proven v81 admin login approach: login screen opens immediately and email/password sign-in is not wrapped in an artificial timeout.
- Admin authorization is cached for the signed-in session instead of checked before every query.
- Products load 20 at a time. Near the end of the current list, the next 20 load automatically. The Load More button remains as a fallback.
- Product search still covers product name, barcode, category, subcategory, price, colour, size and custom option values.
- Realtime stock/product updates patch an already-loaded product when possible instead of resetting/reloading the whole product list.
- Old v86/v87 PWA code caches are removed by the v88 service worker.

COMMERCE FEATURES RETAINED
- Simple/manual availability products.
- Option products such as 50 ml / 100 ml / packs.
- Exact Colour + Size combinations with independent availability/quantity.
- 41,42,43 bulk input is saved as independent exact option rows.
