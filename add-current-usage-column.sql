-- Add current_usage column to shelves table
-- This migration adds the missing current_usage column to the shelves table

ALTER TABLE shelves ADD COLUMN current_usage INTEGER DEFAULT 0;

-- Update existing records to have default value
UPDATE shelves SET current_usage = 0 WHERE current_usage IS NULL;