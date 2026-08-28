WellOne Admin v86 — unified product and inventory control

DATABASE FIRST
- If migration 10 is not already installed, run supabase/10_v85_heavy_commerce_flow.sql.
- Then run supabase/11_v86_exact_options_manual_stock_live.sql.

DEPLOY
- Deploy the contents of this folder to the admin site root.

V86
- Product editor supports Simple, custom option, and Colour + option products.
- 41,42,43 entered in one option field is normalized to exact independent variant rows.
- Every exact option can keep its own availability; tracked products also keep independent quantity.
- One Products search covers name, barcode, category, subcategory, price, size/option and colour.
- Login/session restore has bounded network waits instead of hanging indefinitely.
- JS/CSS revalidate instead of using a year-long immutable cache.
