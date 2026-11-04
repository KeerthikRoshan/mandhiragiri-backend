-- Migration: 007_correct_staff_table_structure.sql
-- Purpose: Redesign staff table to match Add New Priest registration form
-- Retains bilingual staff name (name_english, name_tamil), unifies user-entered fields,
-- and adds automatic Staff ID tracking (MJSTF00001, etc.).

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Add new columns if not present
ALTER TABLE `staff`
  ADD COLUMN IF NOT EXISTS `staff_id` VARCHAR(20) NULL AFTER `user_id`,
  ADD COLUMN IF NOT EXISTS `staff_role` ENUM('Priest', 'Assistant') NOT NULL DEFAULT 'Priest' AFTER `name_tamil`,
  ADD COLUMN IF NOT EXISTS `designation` VARCHAR(150) NULL AFTER `staff_role`,
  ADD COLUMN IF NOT EXISTS `tradition` VARCHAR(255) NULL AFTER `phone`,
  ADD COLUMN IF NOT EXISTS `expertise` VARCHAR(255) NULL AFTER `tradition`,
  ADD COLUMN IF NOT EXISTS `certification` VARCHAR(255) NULL AFTER `expertise`,
  ADD COLUMN IF NOT EXISTS `languages_spoken` VARCHAR(255) NULL AFTER `certification`;

-- 2. Populate staff_id from existing id
UPDATE `staff`
SET `staff_id` = CONCAT('MJSTF', LPAD(`id`, 5, '0'))
WHERE `staff_id` IS NULL OR `staff_id` = '';

UPDATE `staff`
SET `designation` = 'Chief Priest'
WHERE `designation` IS NULL OR `designation` = '';

-- Backfill from legacy columns if they still exist in the table
SET @has_old_cols := (
  SELECT COUNT(*) FROM information_schema.columns 
  WHERE table_schema = DATABASE() 
    AND table_name = 'staff' 
    AND column_name = 'role_category'
);

SET @backfill_sql := IF(@has_old_cols > 0, '
  UPDATE `staff`
  SET `staff_role` = CASE 
    WHEN UPPER(COALESCE(`role_category`, '''')) LIKE ''%ASSISTANT%'' THEN ''Assistant'' 
    ELSE ''Priest'' 
  END,
  `designation` = COALESCE(`designation_english`, `designation_tamil`, ''Chief Priest''),
  `tradition` = COALESCE(`tradition`, `tradition_tamil`),
  `expertise` = COALESCE(`expertise`, `expertise_tamil`),
  `certification` = COALESCE(`certification`, `certification_tamil`),
  `languages_spoken` = COALESCE(`languages_spoken`, `languages_tamil`);
', 'SELECT ''Old columns already removed'';');

PREPARE stmt_bf FROM @backfill_sql;
EXECUTE stmt_bf;
DEALLOCATE PREPARE stmt_bf;

UPDATE `staff`
SET `status` = CASE 
  WHEN UPPER(`status`) = 'INACTIVE' THEN 'Inactive' 
  ELSE 'Active' 
END;

-- 3. Modify columns to strict constraints
ALTER TABLE `staff`
  MODIFY COLUMN `staff_id` VARCHAR(20) NOT NULL,
  MODIFY COLUMN `designation` VARCHAR(150) NOT NULL,
  MODIFY COLUMN `status` ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active';

-- Add unique constraint for staff_id if not already present
SET @exist := (
  SELECT COUNT(*) FROM information_schema.statistics 
  WHERE table_schema = DATABASE() 
    AND table_name = 'staff' 
    AND index_name = 'uq_staff_staff_id'
);
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `staff` ADD UNIQUE KEY `uq_staff_staff_id` (`staff_id`);', 'SELECT ''Index already exists'';');
PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. Drop obsolete duplicate language and category columns
ALTER TABLE `staff`
  DROP COLUMN IF EXISTS `designation_tamil`,
  DROP COLUMN IF EXISTS `designation_english`,
  DROP COLUMN IF EXISTS `role_badge`,
  DROP COLUMN IF EXISTS `role_category`,
  DROP COLUMN IF EXISTS `tradition_tamil`,
  DROP COLUMN IF EXISTS `certification_tamil`,
  DROP COLUMN IF EXISTS `expertise_tamil`,
  DROP COLUMN IF EXISTS `languages_tamil`;

SET FOREIGN_KEY_CHECKS = 1;
