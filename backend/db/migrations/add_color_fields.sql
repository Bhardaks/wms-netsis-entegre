-- Add color fields to product_packages table
ALTER TABLE product_packages ADD COLUMN package_name_en TEXT;
ALTER TABLE product_packages ADD COLUMN color TEXT;
ALTER TABLE product_packages ADD COLUMN color_en TEXT;
ALTER TABLE product_packages ADD COLUMN contents_en TEXT;