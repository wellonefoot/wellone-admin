# WellOne Admin v74 — Manual Barcode, Inventory & Offers

## One-time Supabase step
Run `supabase/05_inventory_barcode_offers.sql` in **Supabase Dashboard → SQL Editor** before deploying this admin build.

## Added
- Optional barcode identification per product.
- Manual barcode lookup only. Type a barcode and choose **Check barcode**: an existing barcode opens the product for editing; an unknown barcode opens a new product form with that code assigned.
- Optional quantity-based stock tracking.
- Product quantity for products without variants.
- Quantity for each individual size/option/colour variant.
- Quantity `0` automatically marks that variant out of stock.
- Product stock quantity is calculated from all variant quantities and the product becomes out of stock when no tracked variant is available.
- Separate promotional **Offer Items** manager with product link, offer price, optional discount percentage, optional validity, and active/hidden status.
- Separate **Sliding Offer Banners** remain available inside the same Offers section.

## Customer storefront integration
This admin build writes the new fields/tables and broadcasts store-change events. The customer storefront should read:
- `products.track_inventory`, `products.stock_quantity`, `products.stock_status`
- `product_variants.stock`, `product_variants.stock_status`
- active rows from `offer_items`

If the customer storefront code is provided, it can be updated to display exact remaining quantity, variant-level out-of-stock states, and the new offer-items section.

## v74 barcode change
- Removed camera barcode scanning, BarcodeDetector usage, scanner popup, and scan buttons.
- Barcode assignment and lookup are manual text entry only.

## Offer permission hotfix
If the Offers page shows `permission denied for table offer_items`, run `supabase/06_offer_items_permissions.sql` once in Supabase SQL Editor. The original v74 migration now also includes the required PostgREST grants.
