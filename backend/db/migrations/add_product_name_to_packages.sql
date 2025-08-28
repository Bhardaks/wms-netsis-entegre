-- Migration: Add product_name and product_name_en to product_packages table
-- Date: 2025-08-25

BEGIN TRANSACTION;

-- Add new columns if they don't exist
ALTER TABLE product_packages ADD COLUMN product_name TEXT;
ALTER TABLE product_packages ADD COLUMN product_name_en TEXT;

COMMIT;