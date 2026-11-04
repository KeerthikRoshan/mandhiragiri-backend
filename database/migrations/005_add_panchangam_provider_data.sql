ALTER TABLE `panchangam_days`
  ADD COLUMN `provider_data` JSON NULL,
  ADD COLUMN `data_source` VARCHAR(40) NULL;
