# WellOne Admin v79 — Order Receiving + Employees

## Required before deployment
1. In Supabase SQL Editor, run `supabase/08_orders_employees_variants.sql` once.
2. Deploy this admin folder together with the matching customer v79 folder.

## Added
- Orders page with live incoming orders.
- Status controls: Confirmed, Packed, Out for delivery, Delivered, Cancelled.
- Admin payment status control.
- Employee account management: username + password, edit, enable/disable. Passwords are hashed in Supabase.
- Separate `employee.html` stock desk for mobile use.
- Employee barcode lookup shows exact colour, size and available quantity.
- Employee can choose exact variant and mark sold quantity (default 1).
- Employee sales update customer/admin inventory through the WellOne live store-change channel.
- Product editor now saves separate Colour and Size fields for each exact stock variant.

## Inventory model
Use one row for each exact stock combination, for example:
- Black + Size 8 = 3
- Black + Size 9 = 5
- White + Size 8 = 2

This lets customer orders and employee sales deduct only the selected combination.
