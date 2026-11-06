-- Migration 009: Add DELETED to users.status and Deactive to staff.status

ALTER TABLE users MODIFY COLUMN status ENUM('ACTIVE', 'INACTIVE', 'DELETED') NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE staff MODIFY COLUMN status ENUM('Active', 'Inactive', 'Deactive') NOT NULL DEFAULT 'Active';
