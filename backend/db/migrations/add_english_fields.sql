-- Migration: Add English fields to product_packages
-- Date: 2025-08-25

-- Add English name and contents columns
ALTER TABLE product_packages ADD COLUMN package_name_en TEXT;
ALTER TABLE product_packages ADD COLUMN contents_en TEXT;