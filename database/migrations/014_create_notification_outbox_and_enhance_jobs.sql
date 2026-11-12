-- Migration 014: Transactional Outbox, Versioning, Per-Device Deliveries, and Nullable Reminder Jobs
-- Safe, repeatable migration for Phase 4 Notification Automation

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Add schedule_version to bookings independently
SET @has_sched_ver := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'bookings' AND column_name = 'schedule_version'
);
SET @sql_add_sched_ver := IF(@has_sched_ver = 0,
  'ALTER TABLE `bookings` ADD COLUMN `schedule_version` INT NOT NULL DEFAULT 1 AFTER `duration_minutes`',
  'SELECT 1'
);
PREPARE stmt_add_sched_ver FROM @sql_add_sched_ver;
EXECUTE stmt_add_sched_ver;
DEALLOCATE PREPARE stmt_add_sched_ver;

-- 2. Add decision_version to leave_requests independently
SET @has_dec_ver := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'leave_requests' AND column_name = 'decision_version'
);
SET @sql_add_dec_ver := IF(@has_dec_ver = 0,
  'ALTER TABLE `leave_requests` ADD COLUMN `decision_version` INT NOT NULL DEFAULT 0 AFTER `admin_remarks`',
  'SELECT 1'
);
PREPARE stmt_add_dec_ver FROM @sql_add_dec_ver;
EXECUTE stmt_add_dec_ver;
DEALLOCATE PREPARE stmt_add_dec_ver;

-- 3. Add schedule_version independently to notification_jobs
SET @has_job_sched_ver := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'notification_jobs' AND column_name = 'schedule_version'
);
SET @sql_add_job_sched_ver := IF(@has_job_sched_ver = 0,
  'ALTER TABLE `notification_jobs` ADD COLUMN `schedule_version` INT NOT NULL DEFAULT 1 AFTER `entity_id`',
  'SELECT 1'
);
PREPARE stmt_add_job_sched_ver FROM @sql_add_job_sched_ver;
EXECUTE stmt_add_job_sched_ver;
DEALLOCATE PREPARE stmt_add_job_sched_ver;

-- 4. Add lease_token independently to notification_jobs
SET @has_job_lease_token := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'notification_jobs' AND column_name = 'lease_token'
);
SET @sql_add_job_lease_token := IF(@has_job_lease_token = 0,
  'ALTER TABLE `notification_jobs` ADD COLUMN `lease_token` VARCHAR(64) NULL AFTER `status`',
  'SELECT 1'
);
PREPARE stmt_add_job_lease_token FROM @sql_add_job_lease_token;
EXECUTE stmt_add_job_lease_token;
DEALLOCATE PREPARE stmt_add_job_lease_token;

-- 5. Add lease_expires_at independently to notification_jobs
SET @has_job_lease_exp := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'notification_jobs' AND column_name = 'lease_expires_at'
);
SET @sql_add_job_lease_exp := IF(@has_job_lease_exp = 0,
  'ALTER TABLE `notification_jobs` ADD COLUMN `lease_expires_at` TIMESTAMP NULL AFTER `lease_token`',
  'SELECT 1'
);
PREPARE stmt_add_job_lease_exp FROM @sql_add_job_lease_exp;
EXECUTE stmt_add_job_lease_exp;
DEALLOCATE PREPARE stmt_add_job_lease_exp;

-- 6. Create notification_outbox table
CREATE TABLE IF NOT EXISTS `notification_outbox` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `event_type` VARCHAR(50) NOT NULL,
  `entity_type` VARCHAR(50) NOT NULL,
  `entity_id` VARCHAR(100) NOT NULL,
  `event_key` VARCHAR(150) NOT NULL UNIQUE,
  `payload` JSON NOT NULL,
  `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `lease_token` VARCHAR(64) NULL,
  `lease_expires_at` TIMESTAMP NULL,
  `next_attempt_at` TIMESTAMP NULL,
  `attempts` INT NOT NULL DEFAULT 0,
  `last_error` VARCHAR(1000) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `processed_at` TIMESTAMP NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_outbox_status_next` (`status`, `next_attempt_at`, `lease_expires_at`),
  INDEX `idx_outbox_entity` (`entity_type`, `entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Create api_idempotency_records table
CREATE TABLE IF NOT EXISTS `api_idempotency_records` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `idempotency_key` VARCHAR(150) NOT NULL,
  `user_id` BIGINT NOT NULL,
  `http_method` VARCHAR(10) NOT NULL,
  `request_path` VARCHAR(255) NOT NULL,
  `request_hash` VARCHAR(64) NOT NULL,
  `response_status` INT NULL,
  `response_body` JSON NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_user_idem_scope` (`user_id`, `idempotency_key`, `http_method`, `request_path`),
  INDEX `idx_api_idem_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Create notification_device_deliveries table
CREATE TABLE IF NOT EXISTS `notification_device_deliveries` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `job_id` BIGINT NOT NULL,
  `device_id` BIGINT NOT NULL,
  `fcm_token` VARCHAR(500) NOT NULL,
  `status` ENUM('PENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `attempts` INT NOT NULL DEFAULT 0,
  `last_error` VARCHAR(1000) NULL,
  `sent_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_job_device` (`job_id`, `device_id`),
  INDEX `idx_dev_deliv_job` (`job_id`, `status`),
  CONSTRAINT `fk_device_deliveries_job` FOREIGN KEY (`job_id`) REFERENCES `notification_jobs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_device_deliveries_device` FOREIGN KEY (`device_id`) REFERENCES `user_devices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Modify notification_jobs.notification_id to BIGINT NULL dynamically discovering FK name
SET @is_notif_null := (
  SELECT IS_NULLABLE FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'notification_jobs' AND column_name = 'notification_id'
);

SET @fk_notif := (
  SELECT CONSTRAINT_NAME 
  FROM information_schema.KEY_COLUMN_USAGE 
  WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'notification_jobs' 
    AND COLUMN_NAME = 'notification_id' 
    AND REFERENCED_TABLE_NAME = 'notifications'
  LIMIT 1
);

-- 9a. Drop FK if column is not yet nullable and FK exists
SET @sql_drop_fk := IF(@is_notif_null = 'NO' AND @fk_notif IS NOT NULL,
  CONCAT('ALTER TABLE `notification_jobs` DROP FOREIGN KEY `', @fk_notif, '`'),
  'SELECT 1'
);
PREPARE stmt_drop_fk FROM @sql_drop_fk;
EXECUTE stmt_drop_fk;
DEALLOCATE PREPARE stmt_drop_fk;

-- 9b. Modify column and re-add FK constraint if column is not yet nullable
SET @sql_mod_notif := IF(@is_notif_null = 'NO',
  'ALTER TABLE `notification_jobs` MODIFY COLUMN `notification_id` BIGINT NULL, ADD CONSTRAINT `fk_notification_jobs_notification` FOREIGN KEY (`notification_id`) REFERENCES `notifications` (`id`) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt_mod_notif FROM @sql_mod_notif;
EXECUTE stmt_mod_notif;
DEALLOCATE PREPARE stmt_mod_notif;

SET FOREIGN_KEY_CHECKS = 1;
