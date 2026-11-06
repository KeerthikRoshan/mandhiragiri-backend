-- Migration 008: Add STAFF role to roles table and update existing staff users

-- 1. Ensure STAFF role exists in roles table
INSERT INTO roles (name, description)
VALUES ('STAFF', 'Temple staff including Priests and Assistants')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- 2. Update existing staff users to point to the STAFF role
UPDATE users 
SET role_id = (SELECT id FROM roles WHERE name = 'STAFF' LIMIT 1)
WHERE role_id IN (SELECT id FROM roles WHERE name IN ('PRIEST', 'ASSISTANT'));
