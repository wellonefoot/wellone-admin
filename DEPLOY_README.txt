WellOne Admin v85 — configurable product options
- Separate deployment; index.html is at ZIP root.
- Employees is a normal Admin menu section only; it is not shown as a shortcut on the Products home screen.
- Employee list is directly below the Add/Edit Employee form.
- Passwords remain hashed in Supabase. Passwords created/reset from this Admin browser are remembered locally and displayed in the list.
- Product editor supports simple products, one custom option (size, ml, litre, pack, etc.), or colour + option.
- Every exact option keeps independent availability, stock, price and optional images; complete colours can be enabled or disabled together.
- One Products search finds name, barcode, category, subcategory or price. There is no separate barcode-search section.
- v85 uses a fresh service-worker/cache namespace and stable static-asset caching.
- Run supabase/10_v85_heavy_commerce_flow.sql once before using this build.
