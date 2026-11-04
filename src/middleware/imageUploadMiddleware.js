const multer = require('multer');
const ApiError = require('../utils/ApiError');

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return callback(ApiError.unprocessable('Only JPEG, PNG, and WebP images are allowed.'));
    }
    return callback(null, true);
  }
});

const uploadSingleImage = (req, res, next) => {
  upload.single('image')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(ApiError.unprocessable('Image size must not exceed 5 MB.'));
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(ApiError.badRequest('Upload exactly one file using the "image" field.'));
    }
    if (error instanceof multer.MulterError) {
      return next(ApiError.badRequest('Invalid image upload.'));
    }
    return next(error);
  });
};

module.exports = { uploadSingleImage };
