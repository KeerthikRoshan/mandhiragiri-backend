-- Migration 013: Create notification system tables for Phase 2
-- Character set: utf8mb4, Collation: utf8mb4_unicode_ci, Engine: InnoDB

-- 1. notifications table
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
