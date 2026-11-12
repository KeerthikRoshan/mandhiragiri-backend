-- MariaDB dump 10.19  Distrib 10.4.32-MariaDB, for Win64 (AMD64)
--
-- Host: localhost    Database: mandhiragiri_db
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
INSERT INTO `admin_profiles` VALUES (1,'சிவஸ்ரீ சுந்தரமூர்த்தி குருக்கள்','முதன்மை நிர்வாகி (Chief Administrator)','எண். 14, மீனாட்சி சுந்தரேஸ்வரர் சன்னதி தெரு, மதுரை - 625001',NULL,NULL,NULL,NULL,'மாந்திரகிரி ஜோதிட பீடம்','காலை 09:00 – பிற்பகல் 01:00','மாலை 04:30 – இரவு 08:30','2026-11-03 14:48:30',NULL);
/*!40000 ALTER TABLE `admin_profiles` ENABLE KEYS */;
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
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `attendance_records`
--

LOCK TABLES `attendance_records` WRITE;
/*!40000 ALTER TABLE `attendance_records` DISABLE KEYS */;
INSERT INTO `attendance_records` VALUES (1,8,'2026-11-05','PRESENT',NULL,NULL,1,1,'2026-11-05 18:03:34','2026-11-05 18:03:34'),(2,3,'2026-11-05','PRESENT',NULL,NULL,1,1,'2026-11-05 18:03:36','2026-11-05 18:03:36'),(3,13,'2026-11-05','ABSENT',NULL,'வரவில்லை (Absent)',1,1,'2026-11-05 18:03:39','2026-11-05 18:03:39'),(4,13,'2026-11-04','LEAVE',NULL,'அனுமதிக்கப்பட்ட விடுப்பு (Official Leave)',1,1,'2026-11-05 18:03:48','2026-11-05 18:03:48'),(5,13,'2026-11-03','PRESENT',NULL,NULL,1,1,'2026-11-05 18:03:56','2026-11-05 18:03:56');
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
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `booking_priests`
--

LOCK TABLES `booking_priests` WRITE;
/*!40000 ALTER TABLE `booking_priests` DISABLE KEYS */;
INSERT INTO `booking_priests` VALUES (1,1,2,1,2500.00,500.00,'2026-11-06 07:17:49'),(2,2,3,1,2500.00,500.00,'2026-11-06 07:17:49'),(4,3,2,1,3000.00,1000.00,'2026-11-06 07:30:17');
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
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `booking_transactions`
--

LOCK TABLES `booking_transactions` WRITE;
/*!40000 ALTER TABLE `booking_transactions` DISABLE KEYS */;
INSERT INTO `booking_transactions` VALUES (1,1,NULL,'CLIENT','ADVANCE',1000.00,'cash',NULL,'Initial amount entered when booking was created.','2026-11-03 15:15:29',1,'2026-11-03 15:15:29'),(2,1,NULL,'PRIEST','ADVANCE',500.00,'cash',NULL,'Initial amount entered when booking was created.','2026-11-03 15:15:29',1,'2026-11-03 15:15:29'),(3,2,NULL,'CLIENT','ADVANCE',1000.00,'cash',NULL,'Initial amount entered when booking was created.','2026-11-03 15:17:47',1,'2026-11-03 15:17:47'),(4,2,NULL,'PRIEST','ADVANCE',500.00,'cash',NULL,'Initial amount entered when booking was created.','2026-11-03 15:17:47',1,'2026-11-03 15:17:47'),(5,2,NULL,'CLIENT','ADVANCE',4000.00,'upi','UPI12345678','Final settlement','2026-11-03 15:17:48',1,'2026-11-03 15:17:48'),(6,3,NULL,'CLIENT','ADVANCE',2000.00,'cash',NULL,'முன்பதிவு முன்பணம் (Client Advance Cash Payment)','2026-11-06 07:30:17',1,'2026-11-06 07:30:17'),(7,3,2,'PRIEST','ADVANCE',1000.00,'cash',NULL,'புரோகிதர் முன்பணம் (Priest Advance Cash Remuneration)','2026-11-06 07:30:17',1,'2026-11-06 07:30:17'),(8,3,NULL,'CLIENT','ADDITIONAL_PAYMENT',2000.00,'cash',NULL,'இரண்டாம் தவணை பணம் (Second cash installment received at temple office)','2026-11-06 07:30:17',1,'2026-11-06 07:30:17'),(9,3,NULL,'PRIEST','ADDITIONAL_PAYMENT',2000.00,'cash',NULL,'பூஜை முடிவில் முழு ஊதியம் வழங்கப்பட்டது (Final remuneration settled in cash)','2026-11-06 07:30:17',1,'2026-11-06 07:30:17'),(10,4,NULL,'CLIENT','ADVANCE',1000.00,'cash',NULL,'முன்பதிவு முன்பணம் (Client Advance Cash Payment)','2026-11-06 09:57:06',1,'2026-11-06 09:57:06'),(11,4,NULL,'PRIEST','ADVANCE',500.00,'cash',NULL,'புரோகிதர் முன்பணம் (Priest Advance Cash Remuneration)','2026-11-06 09:57:06',1,'2026-11-06 09:57:06'),(12,5,NULL,'CLIENT','ADVANCE',1000.00,'cash',NULL,'முன்பதிவு முன்பணம் (Client Advance Cash Payment)','2026-11-06 18:30:19',1,'2026-11-06 18:30:19'),(13,5,NULL,'PRIEST','ADVANCE',300.00,'cash',NULL,'புரோகிதர் முன்பணம் (Priest Advance Cash Remuneration)','2026-11-06 18:30:19',1,'2026-11-06 18:30:19'),(14,6,NULL,'CLIENT','ADVANCE',1800.00,'cash',NULL,'முன்பதிவு முன்பணம் (Client Advance Cash Payment)','2026-11-07 10:09:14',1,'2026-11-07 10:09:14'),(15,6,NULL,'PRIEST','ADVANCE',52.00,'cash',NULL,'புரோகிதர் முன்பணம் (Priest Advance Cash Remuneration)','2026-11-07 10:09:14',1,'2026-11-07 10:09:14');
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
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bookings`
--

LOCK TABLES `bookings` WRITE;
/*!40000 ALTER TABLE `bookings` DISABLE KEYS */;
INSERT INTO `bookings` VALUES (1,'MJ-2026-1793718929811-4fab61','2026-11-04','கணபதி ஹோமம்',NULL,'கல்யாணசுந்தரம்','+919840999888',NULL,'Madurai Temple Mandapam','temple','Madurai Temple Mandapam',NULL,NULL,NULL,NULL,'temple','கோவில்','09:00 AM - 10:30 AM','09:00:00','10:30:00',90,'2','Karthik Sastrigal','+919876584389','confirmed',5000.00,1000.00,1000.00,'partial',2500.00,500.00,'partial',1,'2026-11-03 15:15:29','2026-11-06 07:17:49',NULL,NULL,0,NULL),(2,'MJ-2026-1793719067987-83c1de','2026-11-04','கணபதி ஹோமம்',NULL,'கல்யாணசுந்தரம்','+919840999888',NULL,'Madurai Temple Mandapam','temple','Madurai Temple Mandapam',NULL,NULL,NULL,NULL,'temple','கோவில்','09:00 AM - 10:30 AM','09:00:00','10:30:00',90,'3','Karthik Sastrigal','+919876571818','confirmed',5000.00,1000.00,5000.00,'paid',2500.00,500.00,'partial',1,'2026-11-03 15:17:47','2026-11-06 07:17:49',NULL,NULL,0,NULL),(3,'MJ-2026-1793950217842-f1e7ec','2026-11-20','கணபதி ஹோமம் & சங்கல்ப பூஜை',2,'கல்யாணசுந்தரம்','+91 98401 22334','+91 98401 99887','Madurai North','home','12, West Masi Street','Simmakkal','625001','customer','Bring sacred brass vessels and samithu bundle.','temple','கோவில்','09:00 AM - 11:00 AM','09:00:00','11:00:00',120,'2','கார்த்திக் சாஸ்திரிகள்','+919876584389','confirmed',6000.00,2000.00,4000.00,'partial',3000.00,3000.00,'paid',1,'2026-11-06 07:30:17','2026-11-06 07:30:17',NULL,NULL,0,NULL),(4,'MJ-2026-1793959026694-f95cdb','2026-11-16','Ganapati Homam',NULL,'Keerthik காலை','8438898884','9464948848485','124, மேலப்பாளையம்','temple','124, மேலப்பாளையம்','Chengam','606701','customer','Hsudhd','temple','கோவில்','07:00 AM - 08:00 AM','07:00:00','08:00:00',60,'MJSTF00015','ரோஷன் - புரோகிதர்','6385028789','confirmed',5000.00,1000.00,1000.00,'partial',2500.00,500.00,'partial',1,'2026-11-06 09:57:06','2026-11-09 05:04:58',NULL,NULL,0,NULL),(5,'MJ-2026-1793989819632-da329e','2026-11-07','தமிழ்',NULL,'Keerthik Roshan namaste','8438898684','8438898555','Fv hjfc jjfd nhdvni gibberish\nTghgv \nகத்தி காலை namaste','temple','Fv hjfc jjfd nhdvni gibberish\nTghgv \nகத்தி காலை namaste','Chengam','606701','customer','Ghthikffcvhubswgv gdhdf\nThughdb\nGhjjhg','temple','கோவில்','04:45 AM - 07:45 AM','04:45:00','07:45:00',180,'MJSTF00003','கார்த்திக் சாஸ்திரிகள்','+919876571818','confirmed',5000.00,1000.00,1000.00,'partial',3000.00,300.00,'partial',1,'2026-11-06 18:30:19','2026-11-06 18:30:19',NULL,NULL,0,NULL),(6,'MJ-2026-1794046154181-f2b9a6','2026-11-07','Thanks',NULL,'முகமது','8438734984',NULL,'8, keyn,\nYeuej\nYsusjjs','home','8, keyn,\nYeuej\nYsusjjs','Hshehs','606701','customer','Hsgebe','temple','கோவில்','03:30 PM - 04:30 PM','15:30:00','16:30:00',60,'MJSTF00015','ரோஷன்','6385028789','confirmed',8438.00,1800.00,1800.00,'partial',5940.00,52.00,'partial',1,'2026-11-07 10:09:14','2026-11-07 10:09:14',NULL,NULL,0,NULL);
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
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `event_types`
--

LOCK TABLES `event_types` WRITE;
/*!40000 ALTER TABLE `event_types` DISABLE KEYS */;
INSERT INTO `event_types` VALUES (1,'Horoscope & Prasannam','ஜாதகம் & பிரசன்னம்','jathagam',60,1000.00,'ACTIVE','2026-11-06 07:17:49','2026-11-06 07:17:49'),(2,'Ganapathi Homam','கணபதி ஹோமம்','temple',120,5000.00,'ACTIVE','2026-11-06 07:17:49','2026-11-06 07:17:49'),(3,'Navagraha Homam','நவக்கிரக ஹோமம்','temple',120,6000.00,'ACTIVE','2026-11-06 07:17:49','2026-11-06 07:17:49'),(4,'Sudarshana Homam','சுதர்சன ஹோமம்','temple',180,7500.00,'ACTIVE','2026-11-06 07:17:49','2026-11-06 07:17:49'),(5,'Ayushya Homam','ஆயுஷ்ய ஹோமம்','temple',180,6500.00,'ACTIVE','2026-11-06 07:17:49','2026-11-06 07:17:49'),(6,'Grihapravesam & Vastu','கிரகப்பிரவேசம் & வாஸ்து','outdoor',180,8000.00,'ACTIVE','2026-11-06 07:17:49','2026-11-06 07:17:49'),(7,'Marriage Muhurtham','திருமண முகூர்த்தம்','outdoor',240,15000.00,'ACTIVE','2026-11-06 07:17:49','2026-11-06 07:17:49'),(8,'Temple Abhishekam','கோவில் அபிஷேகம் & அர்ச்சனை','temple',60,2500.00,'ACTIVE','2026-11-06 07:17:49','2026-11-06 07:17:49'),(9,'Special Outdoor Pooja','சிறப்பு வெளி நிகழ்வு பூஜை','outdoor',120,5000.00,'ACTIVE','2026-11-06 07:17:49','2026-11-06 07:17:49');
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
-- Table structure for table `notification_jobs`
--

DROP TABLE IF EXISTS `notification_jobs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `notification_jobs` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `job_type` varchar(50) NOT NULL,
  `notification_id` bigint(20) NOT NULL,
  `recipient_user_id` bigint(20) NOT NULL,
  `entity_type` varchar(50) NOT NULL,
  `entity_id` varchar(100) NOT NULL,
  `scheduled_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `status` enum('PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `attempts` int(11) NOT NULL DEFAULT 0,
  `idempotency_key` varchar(150) NOT NULL,
  `processed_at` timestamp NULL DEFAULT NULL,
  `last_error` varchar(1000) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idempotency_key` (`idempotency_key`),
  KEY `fk_notification_jobs_notification` (`notification_id`),
  KEY `idx_notification_jobs_status_scheduled` (`status`,`scheduled_at`),
  KEY `idx_notification_jobs_recipient` (`recipient_user_id`),
  KEY `idx_notification_jobs_job_status` (`job_type`,`status`),
  CONSTRAINT `fk_notification_jobs_notification` FOREIGN KEY (`notification_id`) REFERENCES `notifications` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notification_jobs_recipient` FOREIGN KEY (`recipient_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notification_jobs`
--

LOCK TABLES `notification_jobs` WRITE;
/*!40000 ALTER TABLE `notification_jobs` DISABLE KEYS */;
/*!40000 ALTER TABLE `notification_jobs` ENABLE KEYS */;
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
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notification_preferences`
--

LOCK TABLES `notification_preferences` WRITE;
/*!40000 ALTER TABLE `notification_preferences` DISABLE KEYS */;
INSERT INTO `notification_preferences` VALUES (3,1,'BOOKING_CREATED',0,1,'2026-11-11 04:09:11','2026-11-11 04:09:11');
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
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notification_recipients`
--

LOCK TABLES `notification_recipients` WRITE;
/*!40000 ALTER TABLE `notification_recipients` DISABLE KEYS */;
INSERT INTO `notification_recipients` VALUES (1,1,1,'SKIPPED','2026-11-11 04:48:11',NULL,NULL,0,1,'2026-11-11 04:41:23','2026-11-11 04:50:30'),(2,2,1,'SKIPPED','2026-11-11 04:52:09',NULL,NULL,0,1,'2026-11-11 04:42:10','2026-11-11 04:52:09');
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
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notifications`
--

LOCK TABLES `notifications` WRITE;
/*!40000 ALTER TABLE `notifications` DISABLE KEYS */;
INSERT INTO `notifications` VALUES (1,'BOOKING_CREATED','test_notif_1794372082998','New Pooja Booking Created','Devotee Ramesh has booked Ganapathi Homam for tomorrow 09:00 AM.','புதிய பூஜை முன்பதிவு','பக்தர் ரமேஷ் நாளை காலை 09:00 மணிக்கு கணபதி ஹோமம் முன்பதிவு செய்துள்ளார்.','booking','101','{\"bookingId\":101,\"bookingNumber\":\"BK-2026-001\"}','normal',NULL,'2026-11-11 04:41:23'),(2,'BOOKING_CREATED','test_event_1794372130893_gx5v5','New Pooja Booking Created','Devotee Ramesh has booked Ganapathi Homam for tomorrow 09:00 AM.','புதிய பூஜை முன்பதிவு','பக்தர் ரமேஷ் நாளை காலை 09:00 மணிக்கு கணபதி ஹோமம் முன்பதிவு செய்துள்ளார்.','booking','947','{\"bookingId\":101,\"bookingNumber\":\"BK-130893\",\"devoteeName\":\"Ramesh\",\"poojaName\":\"Ganapathi Homam\"}','normal',NULL,'2026-11-11 04:42:10');
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
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `panchangam_days`
--

LOCK TABLES `panchangam_days` WRITE;
/*!40000 ALTER TABLE `panchangam_days` DISABLE KEYS */;
INSERT INTO `panchangam_days` VALUES (1,'2026-11-03','Madurai','Postman test date','சோதனை நாள்','சோதனை திதி','Test Tithi','02:00 PM','சோதனை நட்சத்திரம்','Test Nakshatra','04:00 PM','09:00 AM - 10:00 AM','04:00 PM - 05:00 PM','07:30 AM - 09:00 AM','காலை',1,'2026-11-03 12:00:44','2026-11-03 12:00:44',NULL,NULL);
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
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `permissions`
--

LOCK TABLES `permissions` WRITE;
/*!40000 ALTER TABLE `permissions` DISABLE KEYS */;
INSERT INTO `permissions` VALUES (1,'users:manage','USERS','Create and manage all users','2026-11-03 10:47:19','2026-11-03 10:47:19'),(2,'admins:create','USERS','Create Admin accounts','2026-11-03 10:47:19','2026-11-03 10:47:19'),(3,'staff:create','USERS','Create Priest and Assistant accounts','2026-11-03 10:47:19','2026-11-03 10:47:19'),(4,'users:read','USERS','View user profiles','2026-11-03 10:47:19','2026-11-03 10:47:19'),(5,'bookings:manage','BOOKINGS','Create, update, and cancel bookings','2026-11-03 10:47:19','2026-11-03 10:47:19'),(6,'bookings:read','BOOKINGS','View bookings and appointments','2026-11-03 10:47:19','2026-11-03 10:47:19'),(7,'panchangam:manage','PANCHANGAM','Manage Panchangam and calendar','2026-11-03 10:47:19','2026-11-03 10:47:19'),(8,'panchangam:read','PANCHANGAM','Read Panchangam data','2026-11-03 10:47:19','2026-11-03 10:47:19'),(9,'reports:view','REPORTS','View system and revenue reports','2026-11-03 10:47:19','2026-11-03 10:47:19');
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
INSERT INTO `role_permissions` VALUES (1,1,'2026-11-03 10:47:19'),(1,2,'2026-11-03 10:47:19'),(1,3,'2026-11-03 10:47:19'),(1,4,'2026-11-03 10:47:19'),(1,5,'2026-11-03 10:47:19'),(1,6,'2026-11-03 10:47:19'),(1,7,'2026-11-03 10:47:19'),(1,8,'2026-11-03 10:47:19'),(1,9,'2026-11-03 10:47:19'),(2,3,'2026-11-03 10:47:19'),(2,4,'2026-11-03 10:47:19'),(2,5,'2026-11-03 10:47:19'),(2,6,'2026-11-03 10:47:19'),(2,8,'2026-11-03 10:47:19'),(2,9,'2026-11-03 10:47:19'),(3,6,'2026-11-03 10:47:19'),(3,8,'2026-11-03 10:47:19'),(4,6,'2026-11-03 10:47:19');
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
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `roles`
--

LOCK TABLES `roles` WRITE;
/*!40000 ALTER TABLE `roles` DISABLE KEYS */;
INSERT INTO `roles` VALUES (1,'SUPER_ADMIN','Full system access and administrator management','2026-11-03 10:47:19','2026-11-03 10:47:19'),(2,'ADMIN','Temple management, staff supervision, and bookings','2026-11-03 10:47:19','2026-11-03 10:47:19'),(3,'PRIEST','Astrology consultations, poojas, and temple rituals','2026-11-03 10:47:19','2026-11-03 10:47:19'),(4,'ASSISTANT','Ritual assistance, queue logistics, and schedule support','2026-11-03 10:47:19','2026-11-03 10:47:19'),(5,'STAFF','Temple staff including Priests and Assistants','2026-11-04 18:18:04','2026-11-04 18:18:04');
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
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `schema_migrations`
--

LOCK TABLES `schema_migrations` WRITE;
/*!40000 ALTER TABLE `schema_migrations` DISABLE KEYS */;
INSERT INTO `schema_migrations` VALUES (1,'001_create_auth_tables.sql','2026-11-03 10:24:51'),(2,'002_create_bookings_table.sql','2026-11-03 10:24:51'),(3,'003_create_staff_table.sql','2026-11-03 10:46:54'),(4,'004_create_project_domain_tables.sql','2026-11-03 10:46:54'),(5,'005_correct_staff_table_structure.sql','2026-11-04 09:09:45'),(6,'005_add_panchangam_provider_data.sql','2026-11-04 15:05:14'),(7,'006_add_admin_avatar_url.sql','2026-11-04 15:05:14'),(8,'007_correct_staff_table_structure.sql','2026-11-04 15:06:53'),(9,'008_add_staff_role.sql','2026-11-05 15:58:57'),(10,'009_update_user_and_staff_status_enums.sql','2026-11-05 15:58:57'),(11,'010_update_staff_attendance_and_audit.sql','2026-11-05 15:58:57'),(12,'011_enhance_booking_management.sql','2026-11-06 07:17:49'),(13,'012_create_user_devices_table.sql','2026-11-10 03:44:30'),(14,'013_create_notification_system_tables.sql','2026-11-10 03:44:30');
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
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `staff`
--

LOCK TABLES `staff` WRITE;
/*!40000 ALTER TABLE `staff` DISABLE KEYS */;
INSERT INTO `staff` VALUES (1,2,'MJSTF00001','Karthik Sastrigal','கார்த்திக் சாஸ்திரிகள்','Priest','Chief Priest','+919876527881','Vaikhanasa Agama','Maha Kumbhabhishekam','Vedanta Siromani','Tamil, Sanskrit, Telugu, Hindi',NULL,'Inactive','2026-11-03 15:14:08','2026-11-05 06:24:52'),(2,3,'MJSTF00002','Karthik Sastrigal','கார்த்திக் சாஸ்திரிகள்','Priest','Chief Priest','+919876584389','வேத ஆகமம்','விவாஹம் & கணபதி ஹோமம்','ஆகம குரு','தமிழ், சமஸ்கிருதம்',NULL,'Inactive','2026-11-03 15:15:29','2026-11-05 06:24:57'),(3,4,'MJSTF00003','Karthik Sastrigal','கார்த்திக் சாஸ்திரிகள்','Priest','Chief Priest','+919876571818','வேத ஆகமம்','விவாஹம் & கணபதி ஹோமம்','ஆகம குரு','தமிழ், சமஸ்கிருதம்',NULL,'Active','2026-11-03 15:17:47','2026-11-05 06:51:56'),(8,9,'MJSTF00008','Hhuyh','Hjhjggg','Priest','புரோகிதர்','8955558899','வேத சைவ ஆகமம்','ஹோமம் & சிறப்பு பூஜை','அங்கீகரிக்கப்பட்ட கள குரு','தமிழ் & சமஸ்கிருதம்','file:///data/user/0/com.mandhragirijothidam/cache/rn_image_picker_lib_temp_75d64b1e-e166-4f67-8ad4-f9446eeb913a.png','Active','2026-11-04 17:53:35','2026-11-04 17:53:35'),(13,14,'MJSTF00013','Keerthik Roshan','கீர்த்திக் ரோஷன்','Priest','மசழச','8438898684','வேத சைவ ஆகமம்','ஹோமம் & சிறப்பு பூஜை','அங்கீகரிக்கப்பட்ட கள குரு','தமிழ் & சமஸ்கிருதம்',NULL,'Active','2026-11-04 18:29:47','2026-11-05 06:54:26'),(14,15,'MJSTF00014','Akash','ஆகாஷ்','Priest','புரோகிதர்','7094621556','வேத சைவ ஆகமம்','ஹோமம் & சிறப்பு பூஜை','அங்கீகரிக்கப்பட்ட கள குரு','தமிழ் & சமஸ்கிருதம்','file:///data/user/0/com.mandhragirijothidam/cache/rn_image_picker_lib_temp_34b78415-e26e-4f38-a0f7-da4ba7a59b59.jpg','Active','2026-11-05 04:27:36','2026-11-06 05:54:38'),(15,16,'MJSTF00015','Roshan The Stun','ரோஷன்','Priest','புரோகிதர்','6385028789','வேத சைவ ஆகமம்','ஹோமம் & சிறப்பு பூஜை','அங்கீகரிக்கப்பட்ட கள குரு','தமிழ் & சமஸ்கிருதம்','file:///data/user/0/com.mandhragirijothidam/cache/rn_image_picker_lib_temp_2600f126-d2f1-4547-9b04-96995fde29da.jpg','Active','2026-11-06 05:54:04','2026-11-06 05:54:04');
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
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `staff_attendance_audit`
--

LOCK TABLES `staff_attendance_audit` WRITE;
/*!40000 ALTER TABLE `staff_attendance_audit` DISABLE KEYS */;
INSERT INTO `staff_attendance_audit` VALUES (1,1,8,'2026-11-05','NOT_MARKED','PRESENT',NULL,NULL,'ADMIN_OVERRIDE',1,'2026-11-05 18:03:34'),(2,2,3,'2026-11-05','NOT_MARKED','PRESENT',NULL,NULL,'ADMIN_OVERRIDE',1,'2026-11-05 18:03:36'),(3,3,13,'2026-11-05','NOT_MARKED','ABSENT',NULL,'வரவில்லை (Absent)','ADMIN_OVERRIDE',1,'2026-11-05 18:03:39'),(4,4,13,'2026-11-04','NOT_MARKED','LEAVE',NULL,'அனுமதிக்கப்பட்ட விடுப்பு (Official Leave)','ADMIN_OVERRIDE',1,'2026-11-05 18:03:48'),(5,5,13,'2026-11-03','NOT_MARKED','PRESENT',NULL,NULL,'ADMIN_OVERRIDE',1,'2026-11-05 18:03:56');
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
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_devices`
--

LOCK TABLES `user_devices` WRITE;
/*!40000 ALTER TABLE `user_devices` DISABLE KEYS */;
INSERT INTO `user_devices` VALUES (1,1,'cKyXRVWJRzyme67PE6GCGl:APA91bGzVlSAbrc6wmpsAkdYmj8DDzhOWwIuav1YcTeJ1JFTRjU8eU8VyLSYXGc0yBmxQdQBygAZ3XpzhPZ96NDVSybsNuDdiNdF2_nUV5uDTOm6V4S8k-0','dev_1794382631127_0roi0ta3','android','0.0.1',0,'2026-11-11 07:38:04','2026-11-11 07:37:11','2026-11-11 07:38:04');
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
) ENGINE=InnoDB AUTO_INCREMENT=131 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_sessions`
--

LOCK TABLES `user_sessions` WRITE;
/*!40000 ALTER TABLE `user_sessions` DISABLE KEYS */;
INSERT INTO `user_sessions` VALUES (1,1,'3a2cecc400451b296071563fc736ced89c2a1ec9157d81c110872277444ec4f3','::1','PostmanRuntime/2.14.0',0,'2026-11-10 11:54:04','2026-11-03 11:54:04','2026-11-03 11:54:04'),(2,1,'4c746b36d5333dce9967ec73b9e1578fd0b1f5785b61d9956ec3f051e600f5c2','::ffff:127.0.0.1',NULL,0,'2026-11-10 15:02:06','2026-11-03 15:02:06','2026-11-03 15:02:06'),(3,1,'ffafbf66fdf8d590c432ac5ccf715b055a185266d6a0addc0ad404aea0687043','::ffff:127.0.0.1',NULL,0,'2026-11-10 15:13:22','2026-11-03 15:13:22','2026-11-03 15:13:22'),(4,1,'2e8bb2123da9fdc1abd49c294490383214eeafab784dd998ecd722bcb04ba9eb','::ffff:127.0.0.1',NULL,0,'2026-11-10 15:14:08','2026-11-03 15:14:08','2026-11-03 15:14:08'),(5,1,'9cce4a785e2e66395ad96ba10b11b0cd6ad2c134ecfb683e627c14dd1a3f77e4','::ffff:127.0.0.1',NULL,0,'2026-11-10 15:15:29','2026-11-03 15:15:29','2026-11-03 15:15:29'),(6,3,'df9b2a376f5f54a720bfb2699936c4c178bc1bc8a455a949c976cef955ed394c','::ffff:127.0.0.1',NULL,0,'2026-11-10 15:15:29','2026-11-03 15:15:29','2026-11-03 15:15:29'),(7,1,'a56e6f15ff91a141190ee5c07725af2e8e3c5a7e300b8e403d9356f111eb4761','::ffff:127.0.0.1',NULL,0,'2026-11-10 15:17:47','2026-11-03 15:17:47','2026-11-03 15:17:47'),(8,4,'fafa3b1a68be1e48a142390b4bc07bd609d2d011a7e1e368c43be2799bca9bcc','::ffff:127.0.0.1',NULL,0,'2026-11-10 15:17:47','2026-11-03 15:17:47','2026-11-03 15:17:47'),(9,1,'8fc3ae5824044d5294b1dd21f080bb7eaa08ee8b17dff04a79bec55663f8ca2e','::ffff:127.0.0.1',NULL,0,'2026-11-11 09:24:20','2026-11-04 09:24:20','2026-11-04 09:24:20'),(10,1,'7d3525a3edaac579cb7dd46e65744f0648e56675106abe0963f80c3ef9bce324','::ffff:127.0.0.1',NULL,0,'2026-11-11 09:25:49','2026-11-04 09:25:49','2026-11-04 09:25:49'),(13,1,'55da2d3f475225a94ea63a434419b2bdb434d7e93eae8367aa3415f8f142087a','::1','PostmanRuntime/2.14.0',0,'2026-11-11 12:07:42','2026-11-04 12:07:42','2026-11-04 12:07:42'),(14,1,'d1bff368d3ff1362786a5744860d3b52393fbb4866d82bcfa1c062a197f16b0b','::ffff:127.0.0.1',NULL,0,'2026-11-11 14:30:20','2026-11-04 14:30:20','2026-11-04 14:30:20'),(15,1,'d6558bfb4cb4b8b658b68d3d661e037dfa44d7847d849a3c93a164f39cac4476','::ffff:127.0.0.1',NULL,0,'2026-11-11 15:16:18','2026-11-04 15:16:18','2026-11-04 15:16:18'),(16,1,'97885f4ae6de83cb2bb8f2775ebf9d8c2727889b4c241aecf4c064b8d88012aa','::ffff:127.0.0.1',NULL,0,'2026-11-11 15:20:08','2026-11-04 15:20:08','2026-11-04 15:20:08'),(17,1,'049a9869742f1a4525407f3f5a572e711e647f854f5ca78984d0955c99344a77','::ffff:127.0.0.1',NULL,0,'2026-11-11 15:21:58','2026-11-04 15:21:58','2026-11-04 15:21:58'),(18,1,'143a737372e2c0d3aed385b5820b9d794eae2576098798bc801d7365f0653da4','::ffff:127.0.0.1',NULL,0,'2026-11-11 15:22:17','2026-11-04 15:22:17','2026-11-04 15:22:17'),(19,1,'6eccff47b497c1c1b1003fef1aaba28795fe4a04e72431f4e13d3e22b5d1f27d','::ffff:127.0.0.1',NULL,0,'2026-11-11 15:23:37','2026-11-04 15:23:37','2026-11-04 15:23:37'),(20,1,'c83be3bf65453e9e6359da9f918ef6ff1acbcf488d80d90793b3e9d84c0dffea','::ffff:127.0.0.1',NULL,0,'2026-11-11 15:27:18','2026-11-04 15:27:18','2026-11-04 15:27:18'),(23,1,'f7a694dbdffb6dcd0ef7bdfec7610636bc6075569eb18103a61af19f857af18d','::ffff:127.0.0.1',NULL,0,'2026-11-11 15:29:08','2026-11-04 15:29:08','2026-11-04 15:29:08'),(26,1,'d9b6748b84e9e3d8307df17ed9c5220395f5dcc1e42d73aeba55843ea5c6ab45','::1','PostmanRuntime/2.14.0',0,'2026-11-11 16:32:29','2026-11-04 16:32:29','2026-11-04 16:32:29'),(27,1,'1184d694824559a9a3fb1de5e3cf15a794fb10c7f214bd02bea618cd28945a1d','::1','PostmanRuntime/2.14.0',0,'2026-11-11 17:30:57','2026-11-04 17:30:57','2026-11-04 17:30:57'),(28,1,'539f1176e31c89a45e0d630303a2eeff3dec2d11fb05ca62cc3455359f7a7d87','::ffff:10.199.88.220','okhttp/4.12.0',1,'2026-11-04 17:53:34','2026-11-04 17:34:07','2026-11-04 17:53:34'),(29,1,'c99deb9e3c824c6f9ca4ccdae763da06c32ee0046f8f662f128e798b94ba42eb','::ffff:10.199.88.220','okhttp/4.12.0',1,'2026-11-04 17:55:29','2026-11-04 17:53:34','2026-11-04 17:55:29'),(30,1,'bf6222ada8ecc072ce483a50ec683c14f1da1bc59200f2d73c6b88f4c9255920','::ffff:10.199.88.220','okhttp/4.12.0',1,'2026-11-04 18:29:08','2026-11-04 17:56:22','2026-11-04 18:29:08'),(31,1,'69ccff32058bf9bcf2c26171704cb82e0f3849abefab6c8729e1b7dc3c26277e','127.0.0.1',NULL,0,'2026-11-11 18:26:26','2026-11-04 18:26:26','2026-11-04 18:26:26'),(32,1,'a53c89e6d693a63e71c101ed58f026508e9eebdbb0130d7f5ee913e7b53bc193','::ffff:10.199.88.220','okhttp/4.12.0',0,'2026-11-11 18:29:08','2026-11-04 18:29:08','2026-11-04 18:29:08'),(33,1,'17a386bed898297279a1fb0d0d831b9ab91c8ae4e779d18a802da46ae7b5b5d0','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 03:32:59','2026-11-05 03:05:12','2026-11-05 03:32:59'),(34,1,'152ca496c20ea0bc64cce0b9cf0e49034c733b5aa41abdf1d72bd953c93bef2d','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 03:55:44','2026-11-05 03:32:59','2026-11-05 03:55:44'),(35,1,'e518d000e00a07e02599e8495a6632711a9e8a31fd2efa12c7d94bf76b5ab03a','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 04:14:55','2026-11-05 03:55:45','2026-11-05 04:14:55'),(36,1,'bd9d97acc875b97a4d6dd4ca985c24917e25483c4e9361a1c354227624283a02','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 04:28:28','2026-11-05 04:14:55','2026-11-05 04:28:28'),(37,14,'26187e518be69ad9535594797242d7a5f8ff33e4571640de6905c1c02f056819','::ffff:10.32.251.220','okhttp/4.12.0',0,'2026-11-12 04:28:49','2026-11-05 04:28:49','2026-11-05 04:28:49'),(38,1,'2c59eb84ab1c08846edaa3b252b92caf5290ea94f12c8914102e5d560a3d6b59','::ffff:10.32.251.220','okhttp/4.12.0',0,'2026-11-12 04:29:51','2026-11-05 04:29:51','2026-11-05 04:29:51'),(39,1,'0d6375c5268b19bea1501ffcef1b581a7eec068318ef3c7e52da5754f6b58c3b','127.0.0.1',NULL,0,'2026-11-12 05:50:19','2026-11-05 05:50:19','2026-11-05 05:50:19'),(40,1,'969d22dc79c9e55c90306a4898513834ca07d2b0fa8ba9219625cca6eeb671f2','::ffff:192.168.43.196','okhttp/4.12.0',0,'2026-11-12 06:06:06','2026-11-05 06:06:06','2026-11-05 06:06:06'),(41,1,'3b5054c1fb17748214d744b551d9ca19e637e7384caee112f1509f29ec43cb65','::ffff:192.168.43.196','okhttp/4.12.0',1,'2026-11-05 06:50:54','2026-11-05 06:24:14','2026-11-05 06:50:54'),(42,1,'a929e6134f84c3c5e8de536ab78d60d4fb347aaadd9621ca683466c2c3550983','::ffff:192.168.43.196','okhttp/4.12.0',1,'2026-11-05 07:16:12','2026-11-05 06:50:54','2026-11-05 07:16:12'),(43,1,'a6556aede91ec268d665a8f63deebdc501099ff8cfd6447b03e41b5584712014','::ffff:192.168.43.196','okhttp/4.12.0',0,'2026-11-12 07:16:12','2026-11-05 07:16:12','2026-11-05 07:16:12'),(44,1,'81e82d9b4a71ff3755187fb85403bc441d0501d74dcbe58da91b112a7d28b471','::ffff:192.168.43.196','okhttp/4.12.0',1,'2026-11-05 08:05:22','2026-11-05 07:34:37','2026-11-05 08:05:22'),(45,1,'8886ffa1b32db31709a91b56e29bb1a21b228c8c98c9a76e40174366c85f0fb8','::ffff:192.168.43.196','okhttp/4.12.0',1,'2026-11-05 08:24:12','2026-11-05 08:05:22','2026-11-05 08:24:12'),(46,1,'53a36c147bc34184ac4412d132915734a01ba45f5f34c34efe957ffa2cdaa84f','::ffff:192.168.43.196','okhttp/4.12.0',0,'2026-11-12 08:24:12','2026-11-05 08:24:12','2026-11-05 08:24:12'),(47,1,'0daa8dc6a351160188f902e18e935dfeaf81317cc8694c58525e8c93b44f9e94','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 10:14:37','2026-11-05 09:12:21','2026-11-05 10:14:37'),(48,1,'bdc88e6a8ed502a6e95a96b998752cc84e653bcfe73f44f1ea5c0acb54d81db4','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 10:49:16','2026-11-05 10:14:37','2026-11-05 10:49:16'),(49,1,'81cb8b54d7b3d168e3c4c5f37131b68fff38609f6a9771e9776fefd63396a877','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 11:18:45','2026-11-05 10:49:16','2026-11-05 11:18:45'),(50,1,'8f4104a66f90f5764d39a38bbf4cd15628b7d4c3155bed57513642ee6d8e4b00','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 11:39:19','2026-11-05 11:18:45','2026-11-05 11:39:19'),(51,1,'031f9dc9f9dc23e87ceee3b2dd275130e96979a31937f552c77c2879ab86dd2e','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 12:10:37','2026-11-05 11:39:19','2026-11-05 12:10:37'),(52,1,'95dea572c77ee3aa3f5ea9dff4340d83f7aac1714a19324c6dad2ae99bff9a8f','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 13:59:13','2026-11-05 12:10:37','2026-11-05 13:59:13'),(53,1,'c6d580222cb4a32c6ae64b72acec60be7b9ac24d4cb640102c003ca5d5badf48','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 14:20:08','2026-11-05 13:59:13','2026-11-05 14:20:08'),(54,1,'89603501ba933f3602a142826c3617aeac9f93d364e0c336b98dafb2b5702460','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 14:35:10','2026-11-05 14:20:08','2026-11-05 14:35:10'),(55,1,'e401bc26d075b0d7b11b551322add1db44ae7e58ac2083b021908acc29825a90','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 14:54:22','2026-11-05 14:35:10','2026-11-05 14:54:22'),(56,1,'585f5a3abd5c75e22fed8f9056206c8b2f2ae239727bf2397bc8c37c98232e7c','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 16:16:41','2026-11-05 14:54:22','2026-11-05 16:16:41'),(57,1,'fce039d8f4f3a8db1645ca3d6bb4b3e1210d8c9611109d4ba359d859d352924e','127.0.0.1',NULL,0,'2026-11-12 16:12:12','2026-11-05 16:12:12','2026-11-05 16:12:12'),(58,1,'3dddd99498b62b84f8236aa87772bb44b13605daf6045737abbfc74dd572ccc5','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 16:31:41','2026-11-05 16:16:41','2026-11-05 16:31:41'),(59,1,'940d09246c4b1f949cb412908bb7223e1f14d32e9f619e042ea109570d66fb95','127.0.0.1',NULL,0,'2026-11-12 16:26:18','2026-11-05 16:26:18','2026-11-05 16:26:18'),(60,1,'f2d075cef0ac4085742d060f46af6aef6c931599b45441daa27c67a40874950b','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 16:49:56','2026-11-05 16:31:41','2026-11-05 16:49:56'),(61,1,'9102af28ab01862d8eee84958e1f850d40b171faf2f24bfc235f741b2ad75d94','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 17:05:16','2026-11-05 16:49:56','2026-11-05 17:05:16'),(62,1,'a1b82d839692909b46fdc534c6a279a307b65b8cf853357ef719a353ba7d8e65','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 17:20:19','2026-11-05 17:05:16','2026-11-05 17:20:19'),(63,1,'ac18bc06dd3e176c7411c2c611271e650b88d8cc284f12aa06fd826c594c5bfe','::ffff:10.32.251.220','okhttp/4.12.0',1,'2026-11-05 17:39:56','2026-11-05 17:20:19','2026-11-05 17:39:56'),(64,1,'a31093a90c0e237907859126289896b5addd2f79571c4367d96c959eb7ec0a9d','::ffff:10.32.251.220','okhttp/4.12.0',0,'2026-11-12 17:39:56','2026-11-05 17:39:56','2026-11-05 17:39:56'),(65,1,'7d5b1a46e2671fb4ed1f004abe68d1d606005a3970702e9856ff8788b8c84e29','127.0.0.1',NULL,0,'2026-11-12 17:57:35','2026-11-05 17:57:35','2026-11-05 17:57:35'),(66,1,'65c7b9e50574447e1616cd06e2da1c01ee6d62db4f54da5eed1e70dae0816405','::ffff:10.32.251.220','okhttp/4.12.0',0,'2026-11-12 18:03:09','2026-11-05 18:03:09','2026-11-05 18:03:09'),(67,1,'e709ac31f7c59a2c4dccf0a678d9a5d2055a1b8fd5676b2bf6c79e9d9f5d802a','::ffff:192.168.43.196','okhttp/4.12.0',1,'2026-11-06 06:25:06','2026-11-06 05:48:32','2026-11-06 06:25:06'),(68,1,'f52b306ed94c13ef2d8598ed83500f8e2b989ded748b59bbbf31c612861b6710','::ffff:192.168.43.196','okhttp/4.12.0',1,'2026-11-06 06:57:21','2026-11-06 06:25:06','2026-11-06 06:57:21'),(69,1,'d893cdef61f90a7d1a08860e29bad24edd88bc5b30be1caa241aa90b973cbfd8','::ffff:192.168.43.196','okhttp/4.12.0',1,'2026-11-06 07:30:42','2026-11-06 06:57:21','2026-11-06 07:30:42'),(70,1,'e1ba5697ca6614778fcf2c0223f811bb8ecc0f9ecdca34b952960feeefdd019b','127.0.0.1',NULL,0,'2026-11-13 07:30:17','2026-11-06 07:30:17','2026-11-06 07:30:17'),(71,1,'9d88bf415ff8537511ffe538517e21ca493c97b2bd6f408e6bb35bf978de28c6','::ffff:192.168.43.196','okhttp/4.12.0',0,'2026-11-13 07:30:42','2026-11-06 07:30:42','2026-11-06 07:30:42'),(72,1,'a91ee931b8e43825122b59ef3b2ceb5b9697c10644aa1b8f9165160408368704','::ffff:192.168.43.196','okhttp/4.12.0',0,'2026-11-13 07:50:20','2026-11-06 07:50:20','2026-11-06 07:50:20'),(73,1,'f8fc72fa27c1264bafe91caca154fce738524cefd613e4e0cce21094b955d8ea','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-06 10:25:26','2026-11-06 09:53:34','2026-11-06 10:25:26'),(74,1,'49c735345438b5d1f80f35748f58ea397e0bee8dd02127b9b0d19a8329120419','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-06 10:40:48','2026-11-06 10:25:26','2026-11-06 10:40:48'),(75,1,'429c1dd898b7b73b5349f334818eb552a3ee091966bb319654b8a2cba5ad3a06','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-06 10:55:55','2026-11-06 10:40:48','2026-11-06 10:55:55'),(76,1,'c2abce7b4cdaefcb4c442fdc86a584ed85d4aa151d6e56f1069d0fc6b7bdcf2b','::ffff:10.216.197.220','okhttp/4.12.0',0,'2026-11-13 10:55:55','2026-11-06 10:55:55','2026-11-06 10:55:55'),(77,1,'4cbd7ac73cbbeaae601f92a7dfbc2daa80539266a86ca89251b470a36b1e06a5','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-06 11:15:34','2026-11-06 11:00:31','2026-11-06 11:15:34'),(78,1,'01e0e078b24631eab14eb095a0b14338b3414f9212e314841c376bb02a67b443','::ffff:10.216.197.220','okhttp/4.12.0',0,'2026-11-13 11:15:34','2026-11-06 11:15:34','2026-11-06 11:15:34'),(79,1,'921e038953f6d38cc35f73208530c0af932883c12cf5b688fd881c69a94c6b9a','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-06 14:48:19','2026-11-06 13:48:29','2026-11-06 14:48:19'),(80,1,'a0751cc5d87119ac65a563b46d77d0a5627ca31a09c2f225eb6bbf618634566d','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-06 15:21:40','2026-11-06 14:48:19','2026-11-06 15:21:40'),(81,1,'7737d7a8fbf0a488b62e65eb7cfd66d70079e55edfd6bb762a51fe74f4b4f19a','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-06 15:48:28','2026-11-06 15:21:40','2026-11-06 15:48:28'),(82,1,'b364ccb1cf21138aeba1977938f76bcbe8d736b0b47170523ec4f22c9b014699','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-06 16:51:40','2026-11-06 15:48:28','2026-11-06 16:51:40'),(83,1,'4c220a2e5a0fb3df36086c12a67ca265702f5b6d534f29ea3b9f0cd2e65dfe96','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-06 17:06:59','2026-11-06 16:51:40','2026-11-06 17:06:59'),(84,1,'fb1d7b25c36f184599d593ebeacd7335cc06ca20d457e940167bb729813cccd8','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-06 17:31:59','2026-11-06 17:06:59','2026-11-06 17:31:59'),(85,1,'4f8ec80831147178c81e9ad2ccc2cca538c97d54e918f1c1803d2717d25e53c4','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-06 17:47:19','2026-11-06 17:31:59','2026-11-06 17:47:19'),(86,1,'d79ac115ed766479b39c3407d6049274d878caee45726b73b6abbb0917cb02f0','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-06 18:06:47','2026-11-06 17:47:19','2026-11-06 18:06:47'),(87,1,'d9617aebfddbfda274cb187bd13a50f9e9d47a82bcd0eb79fba9bbcd0edf5ce8','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-06 18:23:52','2026-11-06 18:06:47','2026-11-06 18:23:52'),(88,1,'dbe6d1cdb5297f851842a89f5f9c6303ab8a989b30c45ca579259c7741077994','::ffff:10.216.197.220','okhttp/4.12.0',0,'2026-11-13 18:23:52','2026-11-06 18:23:52','2026-11-06 18:23:52'),(89,1,'7780eb2a6707e1c38791455ab36580d8439f09c76becf9f399866062f6c14706','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-07 08:49:04','2026-11-07 08:18:55','2026-11-07 08:49:04'),(90,1,'b756464c396a54c884f6a9c2c122f6c3daaf20f36fa6850eed850d5febae87ba','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-07 09:04:54','2026-11-07 08:49:04','2026-11-07 09:04:54'),(91,1,'85bb80012b4d3fdebd3135d768c32639c0b817201ee9f439b52bdccf38a0c2e2','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-07 09:56:43','2026-11-07 09:04:54','2026-11-07 09:56:43'),(92,1,'0e56bb811b08da41a904c4796d50cb8894038ca778239c6da19351b78ce0f155','::ffff:10.216.197.220','okhttp/4.12.0',1,'2026-11-07 10:48:40','2026-11-07 09:56:43','2026-11-07 10:48:40'),(93,1,'5eb5a6d11eee95800181a62381528eb07fe5635453ecc70e40db2d0fd3af2794','::ffff:10.216.197.220','okhttp/4.12.0',0,'2026-11-14 10:48:40','2026-11-07 10:48:40','2026-11-07 10:48:40'),(94,1,'cab24fc2b6142986a6abcf063015ce983987483ad487cdbf4413f69ca33a1d2e','::ffff:10.22.230.220','okhttp/4.12.0',1,'2026-11-07 12:59:01','2026-11-07 12:34:50','2026-11-07 12:59:01'),(95,1,'cdd7ceadfeef88a4fed95a3906f44759000f0433ff8a3f9b9049acf2c66ce270','::ffff:10.22.230.220','okhttp/4.12.0',1,'2026-11-07 13:31:45','2026-11-07 12:59:01','2026-11-07 13:31:45'),(96,1,'353fcd5b9e4cc96aba324610b6a91d39504a575e659e9b392c3bb5759d0053e3','::ffff:10.22.230.220','okhttp/4.12.0',1,'2026-11-07 15:19:10','2026-11-07 13:31:45','2026-11-07 15:19:10'),(97,1,'1109da2fd5735a5066e2fa57d02cb667fd3037e0fcf1b4af00c162f4018b2bdb','::ffff:10.22.230.220','okhttp/4.12.0',1,'2026-11-07 15:34:11','2026-11-07 15:19:10','2026-11-07 15:34:11'),(98,1,'859ef9c7db9cdeb5b57f9dd2337c9266015709728de262b502729251edae7f34','::ffff:10.22.230.220','okhttp/4.12.0',1,'2026-11-07 15:54:56','2026-11-07 15:34:11','2026-11-07 15:54:56'),(99,1,'5fb156910383246445c9cc926742f667c7402b60c355c5c4ce57b4e22a74b0d5','::ffff:10.22.230.220','okhttp/4.12.0',0,'2026-11-14 15:54:56','2026-11-07 15:54:56','2026-11-07 15:54:56'),(100,1,'f2a02c908d58b39f190b6c3a24604dece5180176c20e2e99e2e8f77fbb7718dd','::ffff:172.21.167.220','okhttp/4.12.0',1,'2026-11-08 13:44:53','2026-11-08 07:18:14','2026-11-08 13:44:53'),(101,1,'e6c062cf670692e4a6bf81a36d139fb466f8bea81a3422adde87b399061dfb10','::ffff:172.21.167.220','okhttp/4.12.0',1,'2026-11-08 14:44:03','2026-11-08 13:44:53','2026-11-08 14:44:03'),(102,1,'d0723a789b742d9b0fe64d365bef670981d6253d6dace81a8db0da77b38d5b83','::ffff:127.0.0.1','Mozilla/5.0 (Windows NT; Windows NT 10.0; en-IN) WindowsPowerShell/5.1.26100.9711',0,'2026-11-15 14:33:29','2026-11-08 14:33:29','2026-11-08 14:33:29'),(103,1,'a5fdb49b91741bf112f8c4e6c315b0252e97beb6cd9eb1a9b5620899142f7be0','::ffff:127.0.0.1','Mozilla/5.0 (Windows NT; Windows NT 10.0; en-IN) WindowsPowerShell/5.1.26100.9711',0,'2026-11-15 14:33:49','2026-11-08 14:33:49','2026-11-08 14:33:49'),(104,1,'0e2340cb1e93882e70f167a27269ff259885337fbb151c3cce83a3284a3a1183','::ffff:127.0.0.1','Mozilla/5.0 (Windows NT; Windows NT 10.0; en-IN) WindowsPowerShell/5.1.26100.9711',0,'2026-11-15 14:34:43','2026-11-08 14:34:43','2026-11-08 14:34:43'),(105,1,'b1efa669aa919693286b419158b03e36a236a6920a22ab6084b5a781e948dbe4','::ffff:127.0.0.1','Mozilla/5.0 (Windows NT; Windows NT 10.0; en-IN) WindowsPowerShell/5.1.26100.9711',0,'2026-11-15 14:35:11','2026-11-08 14:35:11','2026-11-08 14:35:11'),(106,1,'e52a0dd38c168585f52c9ba290165ee2ecf4a37f36c592659c056742ab99dcf6','::ffff:127.0.0.1','Mozilla/5.0 (Windows NT; Windows NT 10.0; en-IN) WindowsPowerShell/5.1.26100.9711',0,'2026-11-15 14:37:54','2026-11-08 14:37:54','2026-11-08 14:37:54'),(107,1,'ef9be63d7306754f5a80d058e7d512b0d0da9c95be56e4848527f737f68ea304','::ffff:127.0.0.1','Mozilla/5.0 (Windows NT; Windows NT 10.0; en-IN) WindowsPowerShell/5.1.26100.9711',0,'2026-11-15 14:38:03','2026-11-08 14:38:03','2026-11-08 14:38:03'),(108,1,'15d348aeae51636d63aa83790de42944a002fe9820edcd2f68c4fe87f05ce276','::ffff:172.21.167.220','okhttp/4.12.0',0,'2026-11-15 14:44:03','2026-11-08 14:44:03','2026-11-08 14:44:03'),(109,1,'edc23a8095b3bd8d15bc4d8d122362c0c862fccc744726f749fe8702246dd82b','::ffff:172.21.167.220','okhttp/4.12.0',0,'2026-11-15 17:00:48','2026-11-08 17:00:48','2026-11-08 17:00:48'),(110,1,'9768f7fd07502eb83f39af1b2802dd361b48f585417a9a7f4febe20db6c7ce1c','::ffff:172.21.167.220','okhttp/4.12.0',1,'2026-11-09 03:46:02','2026-11-09 03:30:48','2026-11-09 03:46:02'),(111,1,'22315b450f887dac7f09e0f41723e067c6af9c20baf9c98bd286490ccb63b057','::ffff:172.21.167.220','okhttp/4.12.0',0,'2026-11-16 03:46:02','2026-11-09 03:46:02','2026-11-09 03:46:02'),(112,1,'dd2e95ed44845ef1801f422ce4dd03bf5379c251553b497fba06744bc56f3361','::ffff:172.21.167.220','okhttp/4.12.0',1,'2026-11-09 05:24:19','2026-11-09 05:04:17','2026-11-09 05:24:19'),(113,1,'04bbcba0345abb4bb60f9879e07420bff8df12f2105ecc0aeb20ed64afb196cf','::ffff:172.21.167.220','okhttp/4.12.0',0,'2026-11-16 05:24:19','2026-11-09 05:24:19','2026-11-09 05:24:19'),(114,1,'c22695de549a50c6f5938454aba5bf386ab0b7fa5e6430b0aa2f0622f7f279e4','::ffff:10.18.29.220','okhttp/4.12.0',0,'2026-11-16 07:14:25','2026-11-09 07:14:25','2026-11-09 07:14:25'),(115,1,'9181f64d433e2958774ce2c07dd990e46207adac35625a1baff3a58256384cce','::1','PostmanRuntime/2.14.0',0,'2026-11-18 03:45:53','2026-11-11 03:45:53','2026-11-11 03:45:53'),(116,1,'7651797b3202e84a67a6e6c6b08e6e874be278797f43dce2786c3b6ad4b1052a','::1','PostmanRuntime/2.14.0',0,'2026-11-18 03:47:43','2026-11-11 03:47:43','2026-11-11 03:47:43'),(117,1,'3b41697b99427ccda4b09c981093db1b7d0c0d1fc7aad8a0a2181e464d15d326','::1','PostmanRuntime/2.14.0',0,'2026-11-18 03:48:03','2026-11-11 03:48:03','2026-11-11 03:48:03'),(118,1,'95676fe128a5324df0da75ef29124dfd00209c135923ad913cdb0b64db477b8b','::1','PostmanRuntime/2.14.0',0,'2026-11-18 04:05:14','2026-11-11 04:05:14','2026-11-11 04:05:14'),(119,1,'05141c66c428175a4a0d06689e4a97225f84bda1d8974f8abdb550b612d84433','::1','PostmanRuntime/2.14.0',0,'2026-11-18 04:30:06','2026-11-11 04:30:06','2026-11-11 04:30:06'),(120,1,'10f9beb1dd7103482e78f28996ad12bfb7984ae16c34ce2d3e42a1d00f818af0','::1','PostmanRuntime/2.14.0',0,'2026-11-18 04:45:35','2026-11-11 04:45:35','2026-11-11 04:45:35'),(121,1,'cc2147bcbfea9e8cac1479b77d8fb302d992a31a302fd09e3f4d01b05db5551b','::ffff:192.168.43.196','okhttp/4.12.0',1,'2026-11-11 07:38:04','2026-11-11 07:36:53','2026-11-11 07:38:04'),(122,14,'cdfe013513090a30805d54d48d76440933c8819649f5866f768e099cc5fbd908','::ffff:192.168.43.196','okhttp/4.12.0',0,'2026-11-18 07:38:24','2026-11-11 07:38:24','2026-11-11 07:38:24'),(123,1,'19715844478fc60a756f05b5345807edf6e2585ee0926cce1f9376f9916368a6','::ffff:192.168.43.196','okhttp/4.12.0',1,'2026-11-11 07:43:05','2026-11-11 07:40:11','2026-11-11 07:43:05'),(124,1,'0f47ecca1fc99009cdea32d222521b4d1f541b81f7df5cddbc9107836783948b','::ffff:192.168.43.196','okhttp/4.12.0',1,'2026-11-11 07:43:30','2026-11-11 07:43:23','2026-11-11 07:43:30'),(125,14,'df3e6efa376942e997247c22d02e01c21181ebb8acca777cbdaef979bbab53ca','::ffff:192.168.43.196','okhttp/4.12.0',0,'2026-11-18 07:43:59','2026-11-11 07:43:59','2026-11-11 07:43:59'),(126,1,'b3dd51d4e983ae6acc1b853f7c99a51cbaba370872f048fb297dece8f97da966','::ffff:192.168.43.196','okhttp/4.12.0',0,'2026-11-18 07:47:01','2026-11-11 07:47:01','2026-11-11 07:47:01'),(127,1,'67c0d96e780ace378a3b1b3c95aa858ca0b3b7fed71242da1e7544a935a3d469','::1','PostmanRuntime/2.14.0',0,'2026-11-18 07:47:45','2026-11-11 07:47:45','2026-11-11 07:47:45'),(128,1,'7456fc5852787766ee206f39ccf9a1061232a6e7063de1da07bfef164a06d0e1','::ffff:192.168.43.196','okhttp/4.12.0',1,'2026-11-11 08:28:24','2026-11-11 08:10:37','2026-11-11 08:28:24'),(129,1,'e6ffd58e61fab3a3156d11cfbacf4ab9507e6e3887930fca62eeebb729dfb1c1','::ffff:192.168.43.196','okhttp/4.12.0',1,'2026-11-11 08:54:46','2026-11-11 08:28:24','2026-11-11 08:54:46'),(130,1,'db3318eb6cad577e7b0bdcd54f44c56bdcbb4b559793ddade14f851cd17ba898','::ffff:192.168.43.196','okhttp/4.12.0',0,'2026-11-18 08:54:46','2026-11-11 08:54:46','2026-11-11 08:54:46');
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
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,1,'9876543210','$2b$12$uSYR3kzKOlfXQ1Ut/aCUBO4A3AiMpJRlmy9xup20YJkiTihOycQSq','Super Admin','admin@mandhiragiri.com','ACTIVE',0,NULL,NULL,'2026-11-03 10:47:20','2026-11-03 14:48:30'),(2,5,'+919876527881','$2b$12$Yv1oO5iO84yFaecWvgJ3KOQI4.8TIsfrNKyr4ZcwjGQxyfafEDZPy','Karthik Sastrigal','priest_1793718848248@example.com','DELETED',1,NULL,NULL,'2026-11-03 15:14:08','2026-11-05 06:24:52'),(3,5,'+919876584389','$2b$12$JmzeLp8bF/PZZLpS4zYcCO3ihvUnoF/F4VmyNA/40ICnVVYNjS0p.','Karthik Sastrigal','priest_1793718929266@example.com','DELETED',1,NULL,NULL,'2026-11-03 15:15:29','2026-11-05 06:24:57'),(4,5,'+919876571818','$2b$12$/5q0KN049kWrJcHPVZzaBOt9wttdTPOTqFpw/8LvsILwFA4gLlWgq','Karthik Sastrigal','priest_1793719067234@example.com','ACTIVE',1,NULL,NULL,'2026-11-03 15:17:47','2026-11-05 06:51:56'),(9,5,'8955558899','$2b$12$JW47DGNUhruUl0a5bibCNeE5tgLTloTG.77Fh2MgXzcTiZZylT.Im','Hhuyh',NULL,'ACTIVE',0,NULL,NULL,'2026-11-04 17:53:35','2026-11-04 18:18:04'),(14,5,'8438898684','$2b$12$GHskljm5EwI1/iUxbMMNn.sRmvCUSRyxjo8vIorRDFdwwEFPM.K0C','Keerthik Roshan',NULL,'ACTIVE',0,NULL,NULL,'2026-11-04 18:29:47','2026-11-05 06:54:26'),(15,5,'7094621556','$2b$12$HzJ/4oQAsov/XuL8iJX//.fQAdlevsH8ULEcx65YZtkVSOXUqUl3q','Akash',NULL,'ACTIVE',0,NULL,NULL,'2026-11-05 04:27:36','2026-11-06 05:54:38'),(16,5,'6385028789','$2b$12$0AoT.IQQAaj6VsvBen8C2.W8s.CVaVUhs5xwSD4cyPKLa3R872iX.','Roshan The Stun','mkroshan46@gmail.com','ACTIVE',0,NULL,NULL,'2026-11-06 05:54:04','2026-11-06 05:54:04');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-11 20:02:50
