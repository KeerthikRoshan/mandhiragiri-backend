-- Migration 013: Create notification system tables for Phase 2
-- Character set: utf8mb4, Collation: utf8mb4_unicode_ci, Engine: InnoDB

SET FOREIGN_KEY_CHECKS = 0;

-- 1. notifications table
-- Create table if it does not exist
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `event_type` VARCHAR(50) NOT NULL,
  `idempotency_key` VARCHAR(150) NULL UNIQUE,
  `title_en` VARCHAR(255) NOT NULL,
  `body_en` TEXT NOT NULL,
  `title_ta` VARCHAR(255) NOT NULL,
  `body_ta` TEXT NOT NULL,
  `entity_type` VARCHAR(50) NOT NULL,
  `entity_id` VARCHAR(100) NULL,
  `data` JSON NULL,
  `priority` ENUM('low', 'normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
  `created_by` BIGINT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_notifications_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  INDEX `idx_notifications_event_type` (`event_type`),
  INDEX `idx_notifications_entity` (`entity_type`, `entity_id`),
  INDEX `idx_notifications_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Handle legacy stub from migration 004 (if table existed with legacy user_id column):
SET @has_legacy_user := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'notifications'
    AND column_name = 'user_id'
);

-- Drop legacy foreign key if present
SET @has_legacy_fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'notifications'
    AND constraint_name = 'fk_notifications_user'
    AND constraint_type = 'FOREIGN KEY'
);
SET @sql_drop_fk := IF(@has_legacy_user > 0 AND @has_legacy_fk > 0,
  'ALTER TABLE `notifications` DROP FOREIGN KEY `fk_notifications_user`',
  'SELECT 1'
);
PREPARE stmt_drop_fk FROM @sql_drop_fk;
EXECUTE stmt_drop_fk;
DEALLOCATE PREPARE stmt_drop_fk;

-- Drop legacy index if present
SET @has_legacy_idx := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'notifications'
    AND index_name = 'idx_notifications_user_read'
);
SET @sql_drop_idx := IF(@has_legacy_user > 0 AND @has_legacy_idx > 0,
  'ALTER TABLE `notifications` DROP INDEX `idx_notifications_user_read`',
  'SELECT 1'
);
PREPARE stmt_drop_idx FROM @sql_drop_idx;
EXECUTE stmt_drop_idx;
DEALLOCATE PREPARE stmt_drop_idx;

-- Upgrade table schema in-place if legacy columns exist
SET @sql_upgrade_notifications := IF(@has_legacy_user > 0,
  'ALTER TABLE `notifications`
    DROP COLUMN `user_id`,
    DROP COLUMN `title`,
    DROP COLUMN `message`,
    DROP COLUMN `is_read`,
    ADD COLUMN `event_type` VARCHAR(50) NOT NULL AFTER `id`,
    ADD COLUMN `idempotency_key` VARCHAR(150) NULL UNIQUE AFTER `event_type`,
    ADD COLUMN `title_en` VARCHAR(255) NOT NULL AFTER `idempotency_key`,
    ADD COLUMN `body_en` TEXT NOT NULL AFTER `title_en`,
    ADD COLUMN `title_ta` VARCHAR(255) NOT NULL AFTER `body_en`,
    ADD COLUMN `body_ta` TEXT NOT NULL AFTER `title_ta`,
    ADD COLUMN `entity_type` VARCHAR(50) NOT NULL AFTER `body_ta`,
    ADD COLUMN `entity_id` VARCHAR(100) NULL AFTER `entity_type`,
    ADD COLUMN `data` JSON NULL AFTER `entity_id`,
    ADD COLUMN `priority` ENUM(''low'', ''normal'', ''high'', ''urgent'') NOT NULL DEFAULT ''normal'' AFTER `data`,
    ADD COLUMN `created_by` BIGINT NULL AFTER `priority`,
    ADD CONSTRAINT `fk_notifications_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    ADD INDEX `idx_notifications_event_type` (`event_type`),
    ADD INDEX `idx_notifications_entity` (`entity_type`, `entity_id`),
    ADD INDEX `idx_notifications_created_at` (`created_at`)',
  'SELECT 1'
);
PREPARE stmt_upgrade FROM @sql_upgrade_notifications;
EXECUTE stmt_upgrade;
DEALLOCATE PREPARE stmt_upgrade;

-- 2. notification_recipients table
CREATE TABLE IF NOT EXISTS `notification_recipients` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `notification_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `delivery_status` ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
  `read_at` TIMESTAMP NULL,
  `push_sent_at` TIMESTAMP NULL,
  `delivery_error` VARCHAR(500) NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `in_app_visible` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_notification_recipients_notification` FOREIGN KEY (`notification_id`) REFERENCES `notifications` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notification_recipients_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  UNIQUE KEY `uq_notification_recipient` (`notification_id`, `user_id`),
  INDEX `idx_recipients_user_inapp_unread` (`user_id`, `is_deleted`, `in_app_visible`, `read_at`, `created_at`),
  INDEX `idx_recipients_user_inapp_created` (`user_id`, `is_deleted`, `in_app_visible`, `created_at`),
  INDEX `idx_recipients_delivery_status` (`delivery_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. notification_preferences table
CREATE TABLE IF NOT EXISTS `notification_preferences` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT NOT NULL,
  `event_type` VARCHAR(50) NOT NULL,
  `push_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `in_app_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_notification_preferences_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  UNIQUE KEY `uq_user_preference_event` (`user_id`, `event_type`),
  INDEX `idx_preferences_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. notification_jobs table
CREATE TABLE IF NOT EXISTS `notification_jobs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `job_type` VARCHAR(50) NOT NULL,
  `notification_id` BIGINT NOT NULL,
  `recipient_user_id` BIGINT NOT NULL,
  `entity_type` VARCHAR(50) NOT NULL,
  `entity_id` VARCHAR(100) NOT NULL,
  `scheduled_at` TIMESTAMP NOT NULL,
  `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `attempts` INT NOT NULL DEFAULT 0,
  `idempotency_key` VARCHAR(150) NOT NULL UNIQUE,
  `processed_at` TIMESTAMP NULL,
  `last_error` VARCHAR(1000) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_notification_jobs_notification` FOREIGN KEY (`notification_id`) REFERENCES `notifications` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notification_jobs_recipient` FOREIGN KEY (`recipient_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  INDEX `idx_notification_jobs_status_scheduled` (`status`, `scheduled_at`),
  INDEX `idx_notification_jobs_recipient` (`recipient_user_id`),
  INDEX `idx_notification_jobs_job_status` (`job_type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
