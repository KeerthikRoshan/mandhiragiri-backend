-- Migration: 015_create_daily_panchangam_table.sql
-- Description: Create daily_panchangam temporary cache table for OneBhakthi daily Panchangam

CREATE TABLE IF NOT EXISTS `daily_panchangam` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `region_code` VARCHAR(50) NOT NULL DEFAULT 'TIRUPPUR',
  `panchangam_date` DATE NOT NULL,
  `provider_name` VARCHAR(50) NOT NULL DEFAULT 'ONEBHAKTHI',
  `calculation_system` VARCHAR(50) NOT NULL DEFAULT 'DRIK_LAHIRI',
  `panchangam_json` JSON NOT NULL,
  `fetched_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_daily_panchangam_region_date` (`region_code`, `panchangam_date`),
  INDEX `idx_daily_panchangam_expiry` (`panchangam_date`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
