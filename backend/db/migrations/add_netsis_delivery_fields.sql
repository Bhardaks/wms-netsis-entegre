-- Add Netsis delivery note fields to orders table
ALTER TABLE orders ADD COLUMN netsis_delivery_note_id TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN netsis_delivery_status TEXT DEFAULT NULL;  
ALTER TABLE orders ADD COLUMN netsis_delivery_data TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN netsis_delivery_error TEXT DEFAULT NULL;