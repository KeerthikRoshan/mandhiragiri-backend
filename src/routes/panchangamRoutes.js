/**
 * Daily Panchangam Routes
 * Route: GET /api/v1/panchangam/daily
 */

const express = require('express');
const router = express.Router();
const panchangamController = require('../controllers/panchangamController');

// GET /api/v1/panchangam/daily
router.get('/daily', panchangamController.getDailyPanchangam);

module.exports = router;
