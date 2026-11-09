const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { testConnection } = require('./config/database');
const authRoutes = require('./routes/authRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const projectRoutes = require('./routes/projectRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorMiddleware');
const { sendSuccess } = require('./utils/response');

const app = express();
const uploadsDirectory = path.resolve(__dirname, '..', 'uploads');

// 1. Security HTTP Headers
app.use(helmet());

// 2. CORS configuration
const allowedOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*';
app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  })
);

// 3. Request Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// 4. Request Body Parsers
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(uploadsDirectory, {
  dotfiles: 'deny',
  index: false,
  maxAge: '1d'
}));

// 5. Health Check Handlers
const healthCheckHandler = async (req, res) => {
  const isDbConnected = await testConnection();
  const uptimeSeconds = Math.floor(process.uptime());

  const healthData = {
    status: isDbConnected ? 'UP' : 'DEGRADED',
    uptimeSeconds,
    timestamp: new Date().toISOString(),
    database: isDbConnected ? 'CONNECTED' : 'DISCONNECTED',
    environment: process.env.NODE_ENV || 'development'
  };

  const statusCode = isDbConnected ? 200 : 503;
  return sendSuccess(res, 'Health status check', healthData, statusCode);
};

// Required Health Endpoints
app.get('/health', healthCheckHandler);
app.get('/api/v1/health', healthCheckHandler);

// 6. API Version 1 Routes
const apiV1Router = express.Router();
apiV1Router.use('/auth', authRoutes);
apiV1Router.use('/bookings', bookingRoutes);
apiV1Router.use('/devices', deviceRoutes);
apiV1Router.use('/notifications', notificationRoutes);
apiV1Router.use('/', projectRoutes);

app.use('/api/v1', apiV1Router);

// 7. Undefined Route 404 Handler
app.use(notFoundHandler);

// 8. Centralized Global Error Handler
app.use(errorHandler);

module.exports = app;
