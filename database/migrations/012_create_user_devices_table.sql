-- Migration 012: Create user_devices table for FCM push notifications
-- Character set: utf8mb4, Collation: utf8mb4_unicode_ci, Engine: InnoDB

CREATE TABLE IF NOT EXISTS `user_devices` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT NOT NULL,
  `fcm_token` VARCHAR(500) NOT NULL UNIQUE,
  `device_id` VARCHAR(150) NULL,
  `platform` ENUM('android', 'ios', 'web') NOT NULL DEFAULT 'android',
  `app_version` VARCHAR(50) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `last_seen_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_user_devices_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  INDEX `idx_user_devices_user_id` (`user_id`),
  INDEX `idx_user_devices_device_id` (`device_id`),
  INDEX `idx_user_devices_is_active` (`is_active`),
  INDEX `idx_user_devices_platform` (`platform`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
