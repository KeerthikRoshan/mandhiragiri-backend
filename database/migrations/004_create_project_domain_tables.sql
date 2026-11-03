ALTER TABLE `bookings`
  ADD COLUMN `completion_notes` TEXT NULL,
  ADD COLUMN `completed_at` TIMESTAMP NULL;

CREATE TABLE IF NOT EXISTS `booking_transactions` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `booking_id` BIGINT NOT NULL,
  `party` ENUM('CLIENT', 'PRIEST') NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `payment_method` VARCHAR(40) NOT NULL DEFAULT 'cash',
  `reference` VARCHAR(150) NULL,
  `notes` VARCHAR(500) NULL,
  `paid_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` BIGINT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_booking_transactions_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_booking_transactions_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  INDEX `idx_booking_transactions_booking_party` (`booking_id`, `party`, `paid_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `attendance_records` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `staff_id` BIGINT NOT NULL,
  `date_key` DATE NOT NULL,
  `status` ENUM('PRESENT', 'ABSENT') NOT NULL,
  `submission_time` TIME NULL,
  `remarks` VARCHAR(500) NULL,
  `is_sealed` TINYINT(1) NOT NULL DEFAULT 1,
  `updated_by` BIGINT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_attendance_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_attendance_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  UNIQUE KEY `uq_attendance_staff_date` (`staff_id`, `date_key`),
  INDEX `idx_attendance_date_status` (`date_key`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `leave_requests` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `staff_id` BIGINT NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `leave_type` VARCHAR(40) NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `admin_remarks` VARCHAR(1000) NULL,
  `decided_by` BIGINT NULL,
  `decided_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_leave_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_leave_decider` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  INDEX `idx_leave_status_start` (`status`, `start_date`),
  INDEX `idx_leave_staff_dates` (`staff_id`, `start_date`, `end_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `panchangam_days` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `date_key` DATE NOT NULL,
  `location` VARCHAR(100) NOT NULL,
  `gregorian_badge` VARCHAR(80) NULL,
  `tamil_date_badge` VARCHAR(80) NULL,
  `tithi_title_tamil` VARCHAR(150) NULL,
  `tithi_title_english` VARCHAR(150) NULL,
  `tithi_end_time` VARCHAR(80) NULL,
  `nakshatra_title_tamil` VARCHAR(150) NULL,
  `nakshatra_title_english` VARCHAR(150) NULL,
  `nakshatra_end_time` VARCHAR(80) NULL,
  `nalla_neram_morning` VARCHAR(80) NULL,
  `nalla_neram_evening` VARCHAR(80) NULL,
  `rahu_kalam_time` VARCHAR(80) NULL,
  `rahu_kalam_period` VARCHAR(80) NULL,
  `updated_by` BIGINT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_panchangam_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  UNIQUE KEY `uq_panchangam_date_location` (`date_key`, `location`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_profiles` (
  `user_id` BIGINT PRIMARY KEY,
  `name_tamil` VARCHAR(150) NULL,
  `title_tamil` VARCHAR(255) NULL,
  `address_tamil` VARCHAR(1000) NULL,
  `years_experience` VARCHAR(80) NULL,
  `horoscope_count` VARCHAR(80) NULL,
  `homam_count` VARCHAR(80) NULL,
  `accuracy_rate` VARCHAR(80) NULL,
  `peedam_name_tamil` VARCHAR(255) NULL,
  `morning_hours` VARCHAR(80) NULL,
  `evening_hours` VARCHAR(80) NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_admin_profile_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `message` VARCHAR(1000) NULL,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_notifications_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  INDEX `idx_notifications_user_read` (`user_id`, `is_read`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `staff_reminders` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `staff_id` BIGINT NOT NULL,
  `date_key` DATE NOT NULL,
  `title_tamil` VARCHAR(255) NOT NULL,
  `description_tamil` VARCHAR(1000) NULL,
  `reminder_time` VARCHAR(40) NULL,
  `status` ENUM('PENDING', 'DONE') NOT NULL DEFAULT 'PENDING',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_staff_reminders_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
  INDEX `idx_staff_reminders_staff_date` (`staff_id`, `date_key`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `calendar_day_settings` (
  `date_key` DATE PRIMARY KEY,
  `is_muhurtham` TINYINT(1) NOT NULL DEFAULT 0,
  `is_blocked` TINYINT(1) NOT NULL DEFAULT 0,
  `updated_by` BIGINT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_calendar_settings_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;