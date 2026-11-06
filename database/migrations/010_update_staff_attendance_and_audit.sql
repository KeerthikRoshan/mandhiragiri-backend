-- Migration: 010_update_staff_attendance_and_audit.sql
-- Purpose: Add LEAVE to attendance_records.status enum and create staff_attendance_audit table.

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Extend attendance_records status enum to include LEAVE
ALTER TABLE `attendance_records` 
  MODIFY COLUMN `status` ENUM('PRESENT', 'ABSENT', 'LEAVE') NOT NULL;

-- 2. Create staff_attendance_audit table for revision history
CREATE TABLE IF NOT EXISTS `staff_attendance_audit` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `attendance_record_id` BIGINT NULL,
  `staff_id` BIGINT NOT NULL,
  `date_key` DATE NOT NULL,
  `previous_status` ENUM('PRESENT', 'ABSENT', 'LEAVE', 'NOT_MARKED') NULL,
  `new_status` ENUM('PRESENT', 'ABSENT', 'LEAVE') NOT NULL,
  `previous_remarks` VARCHAR(500) NULL,
  `new_remarks` VARCHAR(500) NULL,
  `action_type` ENUM('INITIAL_MARK', 'ADMIN_OVERRIDE', 'LEAVE_APPROVAL') NOT NULL DEFAULT 'ADMIN_OVERRIDE',
  `changed_by` BIGINT NOT NULL,
  `changed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_audit_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_audit_changed_by` FOREIGN KEY (`changed_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  INDEX `idx_audit_staff_date` (`staff_id`, `date_key`),
  INDEX `idx_audit_changed_at` (`changed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
