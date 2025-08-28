-- Migration: Add detailed package fields
-- Date: 2025-08-25

-- Add new columns to product_packages table
ALTER TABLE product_packages ADD COLUMN package_number TEXT;
ALTER TABLE product_packages ADD COLUMN width REAL DEFAULT 0;
ALTER TABLE product_packages ADD COLUMN length REAL DEFAULT 0;
ALTER TABLE product_packages ADD COLUMN height REAL DEFAULT 0;
ALTER TABLE product_packages ADD COLUMN weight_kg REAL DEFAULT 0;
ALTER TABLE product_packages ADD COLUMN volume_m3 REAL DEFAULT 0;
ALTER TABLE product_packages ADD COLUMN contents TEXT;