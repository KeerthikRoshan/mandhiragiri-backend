-- ============================================================================
-- Mandhiragiri Jothidam - Complete Production Database Schema & Seed Data
-- ============================================================================
-- Target Server:   MariaDB 10.4+ / MySQL 8.0+
-- Character Set:   utf8mb4
-- Collation:       utf8mb4_unicode_ci
-- Generated At:    2026-11-14T08:05:02.704Z
--
-- Contents:
--   - 26 Table Schemas (DDL with Primary Keys, Foreign Keys, Indexes, ENUMs)
--   - Default Seed Records:
--       * 5 Roles (STAFF, SUPER_ADMIN, ADMIN, PRIEST, ASSISTANT)
--       * 9 Permissions (users:manage, admins:create, staff:create, etc.)
--       * 18 Role-Permission Mappings
--       * 9 Pooja / Event Types (with authentic Tamil Unicode names)
--       * 14 Migration Records (schema_migrations)
--       * 1 Super Admin Account (mobile: 9876543210, password: Admin@1234)
--   - 0 Operational / Test Records (Clean slate for production deployment)
--
-- Import Instructions:
--   1. Create an empty database with utf8mb4:
--      CREATE DATABASE mandhiragiri_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--   2. Import this file:
--      mysql -u <username> -p mandhiragiri_db < mandhiragiri_production_full.sql
-- ============================================================================

-- MariaDB dump 10.19  Distrib 10.4.32-MariaDB, for Win64 (AMD64)
--
-- Host: 127.0.0.1    Database: mandhiragiri_db
-- ------------------------------------------------------
-- Server version	10.4.32-MariaDB

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `admin_profiles`
--

DROP TABLE IF EXISTS `admin_profiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `admin_profiles` (
  `user_id` bigint(20) NOT NULL,
  `name_tamil` varchar(150) DEFAULT NULL,
  `title_tamil` varchar(255) DEFAULT NULL,
  `address_tamil` varchar(1000) DEFAULT NULL,
  `years_experience` varchar(80) DEFAULT NULL,
  `horoscope_count` varchar(80) DEFAULT NULL,
  `homam_count` varchar(80) DEFAULT NULL,
  `accuracy_rate` varchar(80) DEFAULT NULL,
  `peedam_name_tamil` varchar(255) DEFAULT NULL,
  `morning_hours` varchar(80) DEFAULT NULL,
  `evening_hours` varchar(80) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `avatar_url` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_admin_profile_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `admin_profiles`
--

LOCK TABLES `admin_profiles` WRITE;
/*!40000 ALTER TABLE `admin_profiles` DISABLE KEYS */;
/*!40000 ALTER TABLE `admin_profiles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `api_idempotency_records`
--

DROP TABLE IF EXISTS `api_idempotency_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `api_idempotency_records` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `idempotency_key` varchar(150) NOT NULL,
  `user_id` bigint(20) NOT NULL,
  `http_method` varchar(10) NOT NULL,
  `request_path` varchar(255) NOT NULL,
  `request_hash` varchar(64) NOT NULL,
  `response_status` int(11) DEFAULT NULL,
  `response_body` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`response_body`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_idem_scope` (`user_id`,`idempotency_key`,`http_method`,`request_path`),
  KEY `idx_api_idem_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `api_idempotency_records`
--

LOCK TABLES `api_idempotency_records` WRITE;
/*!40000 ALTER TABLE `api_idempotency_records` DISABLE KEYS */;
/*!40000 ALTER TABLE `api_idempotency_records` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `attendance_records`
--

DROP TABLE IF EXISTS `attendance_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `attendance_records` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `staff_id` bigint(20) NOT NULL,
  `date_key` date NOT NULL,
  `status` enum('PRESENT','ABSENT','LEAVE') NOT NULL,
  `submission_time` time DEFAULT NULL,
  `remarks` varchar(500) DEFAULT NULL,
  `is_sealed` tinyint(1) NOT NULL DEFAULT 1,
  `updated_by` bigint(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_staff_date` (`staff_id`,`date_key`),
  KEY `fk_attendance_updated_by` (`updated_by`),
  KEY `idx_attendance_date_status` (`date_key`,`status`),
  CONSTRAINT `fk_attendance_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_attendance_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `attendance_records`
--

LOCK TABLES `attendance_records` WRITE;
/*!40000 ALTER TABLE `attendance_records` DISABLE KEYS */;
/*!40000 ALTER TABLE `attendance_records` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `booking_priests`
--

DROP TABLE IF EXISTS `booking_priests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `booking_priests` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `booking_id` bigint(20) NOT NULL,
  `staff_id` bigint(20) NOT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT 1,
  `priest_pay` decimal(12,2) NOT NULL DEFAULT 0.00,
  `advance_paid` decimal(12,2) NOT NULL DEFAULT 0.00,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_booking_priests_booking` (`booking_id`),
  KEY `idx_booking_priests_staff_booking` (`staff_id`,`booking_id`),
  CONSTRAINT `fk_booking_priests_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_booking_priests_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `booking_priests`
--

LOCK TABLES `booking_priests` WRITE;
/*!40000 ALTER TABLE `booking_priests` DISABLE KEYS */;
/*!40000 ALTER TABLE `booking_priests` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `booking_transactions`
--

DROP TABLE IF EXISTS `booking_transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `booking_transactions` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `booking_id` bigint(20) NOT NULL,
  `staff_id` bigint(20) DEFAULT NULL,
  `party` enum('CLIENT','PRIEST') NOT NULL,
  `transaction_type` enum('ADVANCE','ADDITIONAL_PAYMENT') NOT NULL DEFAULT 'ADVANCE',
  `amount` decimal(12,2) NOT NULL,
  `payment_method` varchar(40) NOT NULL DEFAULT 'cash',
  `reference` varchar(150) DEFAULT NULL,
  `notes` varchar(500) DEFAULT NULL,
  `paid_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `created_by` bigint(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_booking_transactions_creator` (`created_by`),
  KEY `idx_booking_transactions_booking_party` (`booking_id`,`party`,`paid_at`),
  KEY `idx_booking_transactions_staff` (`staff_id`),
  CONSTRAINT `fk_booking_transactions_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_booking_transactions_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_booking_transactions_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `booking_transactions`
--

LOCK TABLES `booking_transactions` WRITE;
/*!40000 ALTER TABLE `booking_transactions` DISABLE KEYS */;
/*!40000 ALTER TABLE `booking_transactions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bookings`
--

DROP TABLE IF EXISTS `bookings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `bookings` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `booking_number` varchar(50) NOT NULL,
  `date_key` date NOT NULL,
  `title` varchar(255) NOT NULL,
  `event_type_id` bigint(20) DEFAULT NULL,
  `client_name` varchar(150) NOT NULL,
  `client_phone` varchar(30) NOT NULL,
  `alternate_phone` varchar(30) DEFAULT NULL,
  `location` varchar(255) NOT NULL,
  `venue_type` enum('home','temple','hall','other') NOT NULL DEFAULT 'home',
  `address` text DEFAULT NULL,
  `area` varchar(150) DEFAULT NULL,
  `pincode` varchar(10) DEFAULT NULL,
  `samagri_by` enum('customer','priest') DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `category` enum('jathagam','temple','outdoor') NOT NULL,
  `category_label_tamil` varchar(100) NOT NULL,
  `time_slot` varchar(80) NOT NULL,
  `start_time` time DEFAULT NULL,
  `end_time` time DEFAULT NULL,
  `duration_minutes` int(11) NOT NULL DEFAULT 60,
  `schedule_version` int(11) NOT NULL DEFAULT 1,
  `priest_id` varchar(100) NOT NULL,
  `priest_name` varchar(150) NOT NULL,
  `priest_phone` varchar(30) DEFAULT NULL,
  `status` enum('confirmed','pending','completed','cancelled') NOT NULL DEFAULT 'confirmed',
  `total_event_charge` decimal(12,2) NOT NULL DEFAULT 0.00,
  `client_advance_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `client_total_received` decimal(12,2) NOT NULL DEFAULT 0.00,
  `client_payment_status` enum('pending','partial','paid') NOT NULL DEFAULT 'pending',
  `priest_total_pay` decimal(12,2) NOT NULL DEFAULT 0.00,
  `priest_advance_paid` decimal(12,2) NOT NULL DEFAULT 0.00,
  `priest_payment_status` enum('pending','partial','paid') NOT NULL DEFAULT 'pending',
  `created_by` bigint(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `completion_notes` text DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `booking_number` (`booking_number`),
  KEY `idx_bookings_date_status` (`date_key`,`status`),
  KEY `idx_bookings_priest_date` (`priest_id`,`date_key`),
  KEY `idx_bookings_client_phone` (`client_phone`),
  KEY `idx_bookings_date_time_conflict` (`date_key`,`start_time`,`end_time`,`status`,`is_deleted`),
  KEY `fk_bookings_event_type` (`event_type_id`),
  CONSTRAINT `fk_bookings_event_type` FOREIGN KEY (`event_type_id`) REFERENCES `event_types` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bookings`
--

LOCK TABLES `bookings` WRITE;
/*!40000 ALTER TABLE `bookings` DISABLE KEYS */;
/*!40000 ALTER TABLE `bookings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `calendar_day_settings`
--

DROP TABLE IF EXISTS `calendar_day_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `calendar_day_settings` (
  `date_key` date NOT NULL,
  `is_muhurtham` tinyint(1) NOT NULL DEFAULT 0,
  `is_blocked` tinyint(1) NOT NULL DEFAULT 0,
  `updated_by` bigint(20) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`date_key`),
  KEY `fk_calendar_settings_user` (`updated_by`),
  CONSTRAINT `fk_calendar_settings_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `calendar_day_settings`
--

LOCK TABLES `calendar_day_settings` WRITE;
/*!40000 ALTER TABLE `calendar_day_settings` DISABLE KEYS */;
/*!40000 ALTER TABLE `calendar_day_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `event_types`
--

DROP TABLE IF EXISTS `event_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `event_types` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `name_english` varchar(150) NOT NULL,
  `name_tamil` varchar(150) NOT NULL,
  `category` enum('jathagam','temple','outdoor') NOT NULL DEFAULT 'outdoor',
  `default_duration_minutes` int(11) NOT NULL DEFAULT 120,
  `base_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `status` enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_event_types_status_category` (`status`,`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `event_types`
--

LOCK TABLES `event_types` WRITE;
/*!40000 ALTER TABLE `event_types` DISABLE KEYS */;
INSERT INTO `event_types` VALUES (1,'Horoscope & Prasannam','ஜாதகம் & பிரசன்னம்','jathagam',60,1000.00,'ACTIVE','2026-11-14 06:13:11','2026-11-14 06:13:11'),(2,'Ganapathi Homam','கணபதி ஹோமம்','temple',120,5000.00,'ACTIVE','2026-11-14 06:13:11','2026-11-14 06:13:11'),(3,'Navagraha Homam','நவக்கிரக ஹோமம்','temple',120,6000.00,'ACTIVE','2026-11-14 06:13:11','2026-11-14 06:13:11'),(4,'Sudarshana Homam','சுதர்சன ஹோமம்','temple',180,7500.00,'ACTIVE','2026-11-14 06:13:11','2026-11-14 06:13:11'),(5,'Ayushya Homam','ஆயுஷ்ய ஹோமம்','temple',180,6500.00,'ACTIVE','2026-11-14 06:13:11','2026-11-14 06:13:11'),(6,'Grihapravesam & Vastu','கிரகப்பிரவேசம் & வாஸ்து','outdoor',180,8000.00,'ACTIVE','2026-11-14 06:13:11','2026-11-14 06:13:11'),(7,'Marriage Muhurtham','திருமண முகூர்த்தம்','outdoor',240,15000.00,'ACTIVE','2026-11-14 06:13:11','2026-11-14 06:13:11'),(8,'Temple Abhishekam','கோவில் அபிஷேகம் & அர்ச்சனை','temple',60,2500.00,'ACTIVE','2026-11-14 06:13:11','2026-11-14 06:13:11'),(9,'Special Outdoor Pooja','சிறப்பு வெளி நிகழ்வு பூஜை','outdoor',120,5000.00,'ACTIVE','2026-11-14 06:13:11','2026-11-14 06:13:11');
/*!40000 ALTER TABLE `event_types` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `leave_requests`
--

DROP TABLE IF EXISTS `leave_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `leave_requests` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `staff_id` bigint(20) NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `leave_type` varchar(40) NOT NULL,
  `reason` varchar(1000) NOT NULL,
  `status` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `admin_remarks` varchar(1000) DEFAULT NULL,
  `decision_version` int(11) NOT NULL DEFAULT 0,
  `decided_by` bigint(20) DEFAULT NULL,
  `decided_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_leave_decider` (`decided_by`),
  KEY `idx_leave_status_start` (`status`,`start_date`),
  KEY `idx_leave_staff_dates` (`staff_id`,`start_date`,`end_date`),
  CONSTRAINT `fk_leave_decider` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_leave_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `leave_requests`
--

LOCK TABLES `leave_requests` WRITE;
/*!40000 ALTER TABLE `leave_requests` DISABLE KEYS */;
/*!40000 ALTER TABLE `leave_requests` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notification_device_deliveries`
--

DROP TABLE IF EXISTS `notification_device_deliveries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `notification_device_deliveries` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `job_id` bigint(20) NOT NULL,
  `device_id` bigint(20) NOT NULL,
  `fcm_token` varchar(500) NOT NULL,
  `status` enum('PENDING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
  `attempts` int(11) NOT NULL DEFAULT 0,
  `last_error` varchar(1000) DEFAULT NULL,
  `sent_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_job_device` (`job_id`,`device_id`),
  KEY `idx_dev_deliv_job` (`job_id`,`status`),
  KEY `fk_device_deliveries_device` (`device_id`),
  CONSTRAINT `fk_device_deliveries_device` FOREIGN KEY (`device_id`) REFERENCES `user_devices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_device_deliveries_job` FOREIGN KEY (`job_id`) REFERENCES `notification_jobs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notification_device_deliveries`
--

LOCK TABLES `notification_device_deliveries` WRITE;
/*!40000 ALTER TABLE `notification_device_deliveries` DISABLE KEYS */;
/*!40000 ALTER TABLE `notification_device_deliveries` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notification_jobs`
--

DROP TABLE IF EXISTS `notification_jobs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `notification_jobs` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `job_type` varchar(50) NOT NULL,
  `notification_id` bigint(20) DEFAULT NULL,
  `recipient_user_id` bigint(20) NOT NULL,
  `entity_type` varchar(50) NOT NULL,
  `entity_id` varchar(100) NOT NULL,
  `schedule_version` int(11) NOT NULL DEFAULT 1,
  `scheduled_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `status` enum('PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `lease_token` varchar(64) DEFAULT NULL,
  `lease_expires_at` timestamp NULL DEFAULT NULL,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `idempotency_key` varchar(150) NOT NULL,
  `processed_at` timestamp NULL DEFAULT NULL,
  `last_error` varchar(1000) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idempotency_key` (`idempotency_key`),
  KEY `idx_notification_jobs_status_scheduled` (`status`,`scheduled_at`),
  KEY `idx_notification_jobs_recipient` (`recipient_user_id`),
  KEY `idx_notification_jobs_job_status` (`job_type`,`status`),
  KEY `fk_notification_jobs_notification` (`notification_id`),
  CONSTRAINT `fk_notification_jobs_notification` FOREIGN KEY (`notification_id`) REFERENCES `notifications` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notification_jobs_recipient` FOREIGN KEY (`recipient_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notification_jobs`
--

LOCK TABLES `notification_jobs` WRITE;
/*!40000 ALTER TABLE `notification_jobs` DISABLE KEYS */;
/*!40000 ALTER TABLE `notification_jobs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notification_outbox`
--

DROP TABLE IF EXISTS `notification_outbox`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `notification_outbox` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `event_type` varchar(50) NOT NULL,
  `entity_type` varchar(50) NOT NULL,
  `entity_id` varchar(100) NOT NULL,
  `event_key` varchar(150) NOT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`payload`)),
  `status` enum('PENDING','PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
  `lease_token` varchar(64) DEFAULT NULL,
  `lease_expires_at` timestamp NULL DEFAULT NULL,
  `next_attempt_at` timestamp NULL DEFAULT NULL,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `last_error` varchar(1000) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `processed_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `event_key` (`event_key`),
  KEY `idx_outbox_status_next` (`status`,`next_attempt_at`,`lease_expires_at`),
  KEY `idx_outbox_entity` (`entity_type`,`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notification_outbox`
--

LOCK TABLES `notification_outbox` WRITE;
/*!40000 ALTER TABLE `notification_outbox` DISABLE KEYS */;
/*!40000 ALTER TABLE `notification_outbox` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notification_preferences`
--

DROP TABLE IF EXISTS `notification_preferences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `notification_preferences` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) NOT NULL,
  `event_type` varchar(50) NOT NULL,
  `push_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `in_app_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_preference_event` (`user_id`,`event_type`),
  KEY `idx_preferences_user` (`user_id`),
  CONSTRAINT `fk_notification_preferences_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notification_preferences`
--

LOCK TABLES `notification_preferences` WRITE;
/*!40000 ALTER TABLE `notification_preferences` DISABLE KEYS */;
/*!40000 ALTER TABLE `notification_preferences` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notification_recipients`
--

DROP TABLE IF EXISTS `notification_recipients`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `notification_recipients` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `notification_id` bigint(20) NOT NULL,
  `user_id` bigint(20) NOT NULL,
  `delivery_status` enum('PENDING','SENT','FAILED','SKIPPED') NOT NULL DEFAULT 'PENDING',
  `read_at` timestamp NULL DEFAULT NULL,
  `push_sent_at` timestamp NULL DEFAULT NULL,
  `delivery_error` varchar(500) DEFAULT NULL,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `in_app_visible` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notification_recipient` (`notification_id`,`user_id`),
  KEY `idx_recipients_user_inapp_unread` (`user_id`,`is_deleted`,`in_app_visible`,`read_at`,`created_at`),
  KEY `idx_recipients_user_inapp_created` (`user_id`,`is_deleted`,`in_app_visible`,`created_at`),
  KEY `idx_recipients_delivery_status` (`delivery_status`),
  CONSTRAINT `fk_notification_recipients_notification` FOREIGN KEY (`notification_id`) REFERENCES `notifications` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notification_recipients_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notification_recipients`
--

LOCK TABLES `notification_recipients` WRITE;
/*!40000 ALTER TABLE `notification_recipients` DISABLE KEYS */;
/*!40000 ALTER TABLE `notification_recipients` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `notifications` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `event_type` varchar(50) NOT NULL,
  `idempotency_key` varchar(150) DEFAULT NULL,
  `title_en` varchar(255) NOT NULL,
  `body_en` text NOT NULL,
  `title_ta` varchar(255) NOT NULL,
  `body_ta` text NOT NULL,
  `entity_type` varchar(50) NOT NULL,
  `entity_id` varchar(100) DEFAULT NULL,
  `data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`data`)),
  `priority` enum('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  `created_by` bigint(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idempotency_key` (`idempotency_key`),
  KEY `fk_notifications_created_by` (`created_by`),
  KEY `idx_notifications_event_type` (`event_type`),
  KEY `idx_notifications_entity` (`entity_type`,`entity_id`),
  KEY `idx_notifications_created_at` (`created_at`),
  CONSTRAINT `fk_notifications_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notifications`
--

LOCK TABLES `notifications` WRITE;
/*!40000 ALTER TABLE `notifications` DISABLE KEYS */;
/*!40000 ALTER TABLE `notifications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `panchangam_days`
--

DROP TABLE IF EXISTS `panchangam_days`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `panchangam_days` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `date_key` date NOT NULL,
  `location` varchar(100) NOT NULL,
  `gregorian_badge` varchar(80) DEFAULT NULL,
  `tamil_date_badge` varchar(80) DEFAULT NULL,
  `tithi_title_tamil` varchar(150) DEFAULT NULL,
  `tithi_title_english` varchar(150) DEFAULT NULL,
  `tithi_end_time` varchar(80) DEFAULT NULL,
  `nakshatra_title_tamil` varchar(150) DEFAULT NULL,
  `nakshatra_title_english` varchar(150) DEFAULT NULL,
  `nakshatra_end_time` varchar(80) DEFAULT NULL,
  `nalla_neram_morning` varchar(80) DEFAULT NULL,
  `nalla_neram_evening` varchar(80) DEFAULT NULL,
  `rahu_kalam_time` varchar(80) DEFAULT NULL,
  `rahu_kalam_period` varchar(80) DEFAULT NULL,
  `updated_by` bigint(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `provider_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`provider_data`)),
  `data_source` varchar(40) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_panchangam_date_location` (`date_key`,`location`),
  KEY `fk_panchangam_updated_by` (`updated_by`),
  CONSTRAINT `fk_panchangam_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `panchangam_days`
--

LOCK TABLES `panchangam_days` WRITE;
/*!40000 ALTER TABLE `panchangam_days` DISABLE KEYS */;
/*!40000 ALTER TABLE `panchangam_days` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `permissions`
--

DROP TABLE IF EXISTS `permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `permissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `module` varchar(50) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `permissions`
--

LOCK TABLES `permissions` WRITE;
/*!40000 ALTER TABLE `permissions` DISABLE KEYS */;
INSERT INTO `permissions` VALUES (1,'users:manage','USERS','Create and manage all users','2026-11-14 06:15:32','2026-11-14 06:15:32'),(2,'admins:create','USERS','Create Admin accounts','2026-11-14 06:15:32','2026-11-14 06:15:32'),(3,'staff:create','USERS','Create Priest and Assistant accounts','2026-11-14 06:15:32','2026-11-14 06:15:32'),(4,'users:read','USERS','View user profiles','2026-11-14 06:15:32','2026-11-14 06:15:32'),(5,'bookings:manage','BOOKINGS','Create, update, and cancel bookings','2026-11-14 06:15:32','2026-11-14 06:15:32'),(6,'bookings:read','BOOKINGS','View bookings and appointments','2026-11-14 06:15:32','2026-11-14 06:15:32'),(7,'panchangam:manage','PANCHANGAM','Manage Panchangam and calendar','2026-11-14 06:15:32','2026-11-14 06:15:32'),(8,'panchangam:read','PANCHANGAM','Read Panchangam data','2026-11-14 06:15:32','2026-11-14 06:15:32'),(9,'reports:view','REPORTS','View system and revenue reports','2026-11-14 06:15:32','2026-11-14 06:15:32');
/*!40000 ALTER TABLE `permissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `role_permissions`
--

DROP TABLE IF EXISTS `role_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `role_permissions` (
  `role_id` int(11) NOT NULL,
  `permission_id` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`role_id`,`permission_id`),
  KEY `idx_role_permissions_permission` (`permission_id`),
  CONSTRAINT `fk_role_permissions_permission` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_role_permissions_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `role_permissions`
--

LOCK TABLES `role_permissions` WRITE;
/*!40000 ALTER TABLE `role_permissions` DISABLE KEYS */;
INSERT INTO `role_permissions` VALUES (2,1,'2026-11-14 06:15:32'),(2,2,'2026-11-14 06:15:32'),(2,3,'2026-11-14 06:15:32'),(2,4,'2026-11-14 06:15:32'),(2,5,'2026-11-14 06:15:32'),(2,6,'2026-11-14 06:15:32'),(2,7,'2026-11-14 06:15:32'),(2,8,'2026-11-14 06:15:32'),(2,9,'2026-11-14 06:15:32'),(3,3,'2026-11-14 06:15:32'),(3,4,'2026-11-14 06:15:32'),(3,5,'2026-11-14 06:15:32'),(3,6,'2026-11-14 06:15:32'),(3,8,'2026-11-14 06:15:32'),(3,9,'2026-11-14 06:15:32'),(4,6,'2026-11-14 06:15:32'),(4,8,'2026-11-14 06:15:32'),(5,6,'2026-11-14 06:15:32');
/*!40000 ALTER TABLE `role_permissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `roles`
--

DROP TABLE IF EXISTS `roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `roles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `roles`
--

LOCK TABLES `roles` WRITE;
/*!40000 ALTER TABLE `roles` DISABLE KEYS */;
INSERT INTO `roles` VALUES (1,'STAFF','Temple staff including Priests and Assistants','2026-11-14 06:13:11','2026-11-14 06:13:11'),(2,'SUPER_ADMIN','Full system access and administrator management','2026-11-14 06:15:32','2026-11-14 06:15:32'),(3,'ADMIN','Temple management, staff supervision, and bookings','2026-11-14 06:15:32','2026-11-14 06:15:32'),(4,'PRIEST','Astrology consultations, poojas, and temple rituals','2026-11-14 06:15:32','2026-11-14 06:15:32'),(5,'ASSISTANT','Ritual assistance, queue logistics, and schedule support','2026-11-14 06:15:32','2026-11-14 06:15:32');
/*!40000 ALTER TABLE `roles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `schema_migrations`
--

DROP TABLE IF EXISTS `schema_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `schema_migrations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `applied_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `schema_migrations`
--

LOCK TABLES `schema_migrations` WRITE;
/*!40000 ALTER TABLE `schema_migrations` DISABLE KEYS */;
INSERT INTO `schema_migrations` VALUES (1,'001_create_auth_tables.sql','2026-11-14 06:13:10'),(2,'002_create_bookings_table.sql','2026-11-14 06:13:10'),(3,'003_create_staff_table.sql','2026-11-14 06:13:10'),(4,'004_create_project_domain_tables.sql','2026-11-14 06:13:11'),(5,'005_add_panchangam_provider_data.sql','2026-11-14 06:13:11'),(6,'006_add_admin_avatar_url.sql','2026-11-14 06:13:11'),(7,'007_correct_staff_table_structure.sql','2026-11-14 06:13:11'),(8,'008_add_staff_role.sql','2026-11-14 06:13:11'),(9,'009_update_user_and_staff_status_enums.sql','2026-11-14 06:13:11'),(10,'010_update_staff_attendance_and_audit.sql','2026-11-14 06:13:11'),(11,'011_enhance_booking_management.sql','2026-11-14 06:13:11'),(12,'012_create_user_devices_table.sql','2026-11-14 06:13:11'),(13,'013_create_notification_system_tables.sql','2026-11-14 06:13:11'),(14,'014_create_notification_outbox_and_enhance_jobs.sql','2026-11-14 06:13:11');
/*!40000 ALTER TABLE `schema_migrations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `staff`
--

DROP TABLE IF EXISTS `staff`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `staff` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) NOT NULL,
  `staff_id` varchar(20) NOT NULL,
  `name_english` varchar(150) NOT NULL,
  `name_tamil` varchar(150) DEFAULT NULL,
  `staff_role` enum('Priest','Assistant') NOT NULL DEFAULT 'Priest',
  `designation` varchar(150) NOT NULL,
  `phone` varchar(30) NOT NULL,
  `tradition` varchar(255) DEFAULT NULL,
  `expertise` varchar(255) DEFAULT NULL,
  `certification` varchar(255) DEFAULT NULL,
  `languages_spoken` varchar(255) DEFAULT NULL,
  `avatar_url` varchar(500) DEFAULT NULL,
  `status` enum('Active','Inactive','Deactive') NOT NULL DEFAULT 'Active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  UNIQUE KEY `phone` (`phone`),
  UNIQUE KEY `uq_staff_staff_id` (`staff_id`),
  KEY `idx_staff_role_status` (`status`),
  CONSTRAINT `fk_staff_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `staff`
--

LOCK TABLES `staff` WRITE;
/*!40000 ALTER TABLE `staff` DISABLE KEYS */;
/*!40000 ALTER TABLE `staff` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `staff_attendance_audit`
--

DROP TABLE IF EXISTS `staff_attendance_audit`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `staff_attendance_audit` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `attendance_record_id` bigint(20) DEFAULT NULL,
  `staff_id` bigint(20) NOT NULL,
  `date_key` date NOT NULL,
  `previous_status` enum('PRESENT','ABSENT','LEAVE','NOT_MARKED') DEFAULT NULL,
  `new_status` enum('PRESENT','ABSENT','LEAVE') NOT NULL,
  `previous_remarks` varchar(500) DEFAULT NULL,
  `new_remarks` varchar(500) DEFAULT NULL,
  `action_type` enum('INITIAL_MARK','ADMIN_OVERRIDE','LEAVE_APPROVAL') NOT NULL DEFAULT 'ADMIN_OVERRIDE',
  `changed_by` bigint(20) NOT NULL,
  `changed_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_audit_changed_by` (`changed_by`),
  KEY `idx_audit_staff_date` (`staff_id`,`date_key`),
  KEY `idx_audit_changed_at` (`changed_at`),
  CONSTRAINT `fk_audit_changed_by` FOREIGN KEY (`changed_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_audit_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `staff_attendance_audit`
--

LOCK TABLES `staff_attendance_audit` WRITE;
/*!40000 ALTER TABLE `staff_attendance_audit` DISABLE KEYS */;
/*!40000 ALTER TABLE `staff_attendance_audit` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `staff_reminders`
--

DROP TABLE IF EXISTS `staff_reminders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `staff_reminders` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `staff_id` bigint(20) NOT NULL,
  `date_key` date NOT NULL,
  `title_tamil` varchar(255) NOT NULL,
  `description_tamil` varchar(1000) DEFAULT NULL,
  `reminder_time` varchar(40) DEFAULT NULL,
  `status` enum('PENDING','DONE') NOT NULL DEFAULT 'PENDING',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_staff_reminders_staff_date` (`staff_id`,`date_key`,`status`),
  CONSTRAINT `fk_staff_reminders_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `staff_reminders`
--

LOCK TABLES `staff_reminders` WRITE;
/*!40000 ALTER TABLE `staff_reminders` DISABLE KEYS */;
/*!40000 ALTER TABLE `staff_reminders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_devices`
--

DROP TABLE IF EXISTS `user_devices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user_devices` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) NOT NULL,
  `fcm_token` varchar(500) NOT NULL,
  `device_id` varchar(150) DEFAULT NULL,
  `platform` enum('android','ios','web') NOT NULL DEFAULT 'android',
  `app_version` varchar(50) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `last_seen_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `fcm_token` (`fcm_token`),
  KEY `idx_user_devices_user_id` (`user_id`),
  KEY `idx_user_devices_device_id` (`device_id`),
  KEY `idx_user_devices_is_active` (`is_active`),
  KEY `idx_user_devices_platform` (`platform`),
  CONSTRAINT `fk_user_devices_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_devices`
--

LOCK TABLES `user_devices` WRITE;
/*!40000 ALTER TABLE `user_devices` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_devices` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_sessions`
--

DROP TABLE IF EXISTS `user_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user_sessions` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) NOT NULL,
  `token_hash` varchar(64) NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` varchar(500) DEFAULT NULL,
  `is_revoked` tinyint(1) NOT NULL DEFAULT 0,
  `expires_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `idx_sessions_token_hash` (`token_hash`),
  KEY `idx_sessions_user_id` (`user_id`),
  KEY `idx_sessions_is_revoked` (`is_revoked`),
  KEY `idx_sessions_expires_at` (`expires_at`),
  CONSTRAINT `fk_user_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_sessions`
--

LOCK TABLES `user_sessions` WRITE;
/*!40000 ALTER TABLE `user_sessions` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_sessions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `users` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `role_id` int(11) NOT NULL,
  `mobile` varchar(15) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `name` varchar(150) NOT NULL,
  `email` varchar(150) DEFAULT NULL,
  `status` enum('ACTIVE','INACTIVE','DELETED') NOT NULL DEFAULT 'ACTIVE',
  `must_change_password` tinyint(1) NOT NULL DEFAULT 0,
  `created_by` bigint(20) DEFAULT NULL,
  `last_login_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `mobile` (`mobile`),
  UNIQUE KEY `email` (`email`),
  KEY `fk_users_creator` (`created_by`),
  KEY `idx_users_mobile` (`mobile`),
  KEY `idx_users_status` (`status`),
  KEY `idx_users_role_id` (`role_id`),
  CONSTRAINT `fk_users_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,2,'9876543210','$2b$12$MDtojck7uQB3DQnEubsVyunp..z6BCSJP9IBWAcNDqJ6xDNLF7TvS','Super Admin','admin@mandhiragiri.com','ACTIVE',0,NULL,NULL,'2026-11-14 06:15:32','2026-11-14 06:15:32');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping routines for database 'mandhiragiri_db'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-14 13:33:08
