# WellOne Admin v75 — Offer Page Integration

## Important one-time Supabase step
If `05_inventory_barcode_offers.sql` and `06_offer_items_permissions.sql` were already run before this version, run:

`supabase/07_offer_expiry_visibility.sql`

This changes only storefront read visibility for active offers. Expired active offers stay readable so the customer site can show an **Offer expired** warning and use the product's current regular price.

## Offer product items
- Add a product URL.
- Set the promotional offer price.
- Optional discount percentage.
- Optional expiry date/time.
- Active/hidden control.
- Live offers open the product with the promotional price.
- Expired offers remain visible on the customer Offers page and open the normal product price.
- Hidden offers are not shown to customers.

## Sliding banners
The home sliding banners can redirect anywhere.

Use `offers.html` as the redirect link when you want a banner to open the complete customer Offers page.

## Inventory and manual barcode
All existing v74 inventory and manual-barcode features are preserved.
