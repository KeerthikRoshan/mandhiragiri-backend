-- 011_enhance_booking_management.sql
-- Complete Dynamic Booking Management Schema Enhancements

-- 1. Create Pooja / Event Types Table
CREATE TABLE IF NOT EXISTS `event_types` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `name_english` VARCHAR(150) NOT NULL,
  `name_tamil` VARCHAR(150) NOT NULL,
  `category` ENUM('jathagam', 'temple', 'outdoor') NOT NULL DEFAULT 'outdoor',
  `default_duration_minutes` INT NOT NULL DEFAULT 120,
  `base_price` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_event_types_status_category` (`status`, `category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Default Pooja / Event Types if empty
INSERT INTO `event_types` (`id`, `name_english`, `name_tamil`, `category`, `default_duration_minutes`, `base_price`, `status`)
SELECT 1, 'Horoscope & Prasannam', 'ஜாதகம் & பிரசன்னம்', 'jathagam', 60, 1000.00, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM `event_types` WHERE `id` = 1);

INSERT INTO `event_types` (`id`, `name_english`, `name_tamil`, `category`, `default_duration_minutes`, `base_price`, `status`)
SELECT 2, 'Ganapathi Homam', 'கணபதி ஹோமம்', 'temple', 120, 5000.00, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM `event_types` WHERE `id` = 2);

INSERT INTO `event_types` (`id`, `name_english`, `name_tamil`, `category`, `default_duration_minutes`, `base_price`, `status`)
SELECT 3, 'Navagraha Homam', 'நவக்கிரக ஹோமம்', 'temple', 120, 6000.00, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM `event_types` WHERE `id` = 3);

INSERT INTO `event_types` (`id`, `name_english`, `name_tamil`, `category`, `default_duration_minutes`, `base_price`, `status`)
SELECT 4, 'Sudarshana Homam', 'சுதர்சன ஹோமம்', 'temple', 180, 7500.00, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM `event_types` WHERE `id` = 4);

INSERT INTO `event_types` (`id`, `name_english`, `name_tamil`, `category`, `default_duration_minutes`, `base_price`, `status`)
SELECT 5, 'Ayushya Homam', 'ஆயுஷ்ய ஹோமம்', 'temple', 180, 6500.00, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM `event_types` WHERE `id` = 5);

INSERT INTO `event_types` (`id`, `name_english`, `name_tamil`, `category`, `default_duration_minutes`, `base_price`, `status`)
SELECT 6, 'Grihapravesam & Vastu', 'கிரகப்பிரவேசம் & வாஸ்து', 'outdoor', 180, 8000.00, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM `event_types` WHERE `id` = 6);

INSERT INTO `event_types` (`id`, `name_english`, `name_tamil`, `category`, `default_duration_minutes`, `base_price`, `status`)
SELECT 7, 'Marriage Muhurtham', 'திருமண முகூர்த்தம்', 'outdoor', 240, 15000.00, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM `event_types` WHERE `id` = 7);

INSERT INTO `event_types` (`id`, `name_english`, `name_tamil`, `category`, `default_duration_minutes`, `base_price`, `status`)
SELECT 8, 'Temple Abhishekam', 'கோவில் அபிஷேகம் & அர்ச்சனை', 'temple', 60, 2500.00, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM `event_types` WHERE `id` = 8);

INSERT INTO `event_types` (`id`, `name_english`, `name_tamil`, `category`, `default_duration_minutes`, `base_price`, `status`)
SELECT 9, 'Special Outdoor Pooja', 'சிறப்பு வெளி நிகழ்வு பூஜை', 'outdoor', 120, 5000.00, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM `event_types` WHERE `id` = 9);

-- 2. Enhance bookings Table
ALTER TABLE `bookings`
  ADD COLUMN `start_time` TIME NULL AFTER `time_slot`,
  ADD COLUMN `end_time` TIME NULL AFTER `start_time`,
  ADD COLUMN `duration_minutes` INT NOT NULL DEFAULT 60 AFTER `end_time`,
  ADD COLUMN `alternate_phone` VARCHAR(30) NULL AFTER `client_phone`,
  ADD COLUMN `event_type_id` BIGINT NULL AFTER `title`,
  ADD COLUMN `venue_type` ENUM('home', 'temple', 'hall', 'other') NOT NULL DEFAULT 'home' AFTER `location`,
  ADD COLUMN `address` TEXT NULL AFTER `venue_type`,
  ADD COLUMN `area` VARCHAR(150) NULL AFTER `address`,
  ADD COLUMN `pincode` VARCHAR(10) NULL AFTER `area`,
  ADD COLUMN `samagri_by` ENUM('customer', 'priest') NULL AFTER `pincode`,
  ADD COLUMN `notes` TEXT NULL AFTER `samagri_by`,
  ADD COLUMN `client_payment_status` ENUM('pending', 'partial', 'paid') NOT NULL DEFAULT 'pending' AFTER `client_total_received`,
  ADD COLUMN `priest_payment_status` ENUM('pending', 'partial', 'paid') NOT NULL DEFAULT 'pending' AFTER `priest_advance_paid`,
  ADD COLUMN `is_deleted` TINYINT(1) NOT NULL DEFAULT 0 AFTER `completed_at`,
  ADD COLUMN `deleted_at` TIMESTAMP NULL AFTER `is_deleted`,
  ADD INDEX `idx_bookings_date_time_conflict` (`date_key`, `start_time`, `end_time`, `status`, `is_deleted`),
  ADD CONSTRAINT `fk_bookings_event_type` FOREIGN KEY (`event_type_id`) REFERENCES `event_types` (`id`) ON DELETE SET NULL;

-- Backfill timing and payment statuses for existing bookings
UPDATE `bookings`
SET
  `start_time` = '09:00:00',
  `end_time` = '10:30:00',
  `duration_minutes` = 90,
  `venue_type` = 'temple',
  `address` = `location`,
  `client_payment_status` = CASE
    WHEN `client_total_received` >= `total_event_charge` AND `total_event_charge` > 0 THEN 'paid'
    WHEN `client_total_received` > 0 THEN 'partial'
    ELSE 'pending'
  END,
  `priest_payment_status` = CASE
    WHEN `priest_advance_paid` >= `priest_total_pay` AND `priest_total_pay` > 0 THEN 'paid'
    WHEN `priest_advance_paid` > 0 THEN 'partial'
    ELSE 'pending'
  END
WHERE `start_time` IS NULL;

-- 3. Create Booking Priests Mapping Table
CREATE TABLE IF NOT EXISTS `booking_priests` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `booking_id` BIGINT NOT NULL,
  `staff_id` BIGINT NOT NULL,
  `is_primary` TINYINT(1) NOT NULL DEFAULT 1,
  `priest_pay` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `advance_paid` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_booking_priests_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_booking_priests_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
  INDEX `idx_booking_priests_staff_booking` (`staff_id`, `booking_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill existing booking_priests mappings
INSERT INTO `booking_priests` (`booking_id`, `staff_id`, `is_primary`, `priest_pay`, `advance_paid`)
SELECT
  b.`id`,
  CAST(b.`priest_id` AS UNSIGNED),
  1,
  b.`priest_total_pay`,
  b.`priest_advance_paid`
FROM `bookings` b
JOIN `staff` s ON s.`id` = CAST(b.`priest_id` AS UNSIGNED)
WHERE b.`priest_id` REGEXP '^[0-9]+$'
  AND NOT EXISTS (
    SELECT 1 FROM `booking_priests` bp WHERE bp.`booking_id` = b.`id` AND bp.`staff_id` = CAST(b.`priest_id` AS UNSIGNED)
  );

-- 4. Enhance booking_transactions Table
ALTER TABLE `booking_transactions`
  ADD COLUMN `staff_id` BIGINT NULL AFTER `booking_id`,
  ADD COLUMN `transaction_type` ENUM('ADVANCE', 'ADDITIONAL_PAYMENT') NOT NULL DEFAULT 'ADVANCE' AFTER `party`,
  ADD CONSTRAINT `fk_booking_transactions_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE SET NULL,
  ADD INDEX `idx_booking_transactions_staff` (`staff_id`);
