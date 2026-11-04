const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const projectModel = require('../models/projectModel');
const ApiError = require('../utils/ApiError');

const uploadsRoot = path.resolve(__dirname, '..', '..', 'uploads');
const maxFileSize = 5 * 1024 * 1024;
const mimeExtensions = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);

const detectImageMimeType = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
};

const isManagedImageUrl = (imageUrl, category) => {
  if (typeof imageUrl !== 'string') return false;
  const prefix = `/uploads/${category}/`;
  if (!imageUrl.startsWith(prefix)) return false;
  const filename = imageUrl.slice(prefix.length);
  return /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(filename);
};

const removeManagedImage = async (imageUrl, category) => {
  if (!isManagedImageUrl(imageUrl, category)) return;
  const filename = imageUrl.slice(`/uploads/${category}/`.length);
  await fs.unlink(path.join(uploadsRoot, category, filename)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
};

const uploadProfileImage = async ({ category, userId, staffId, file }) => {
  if (!file) throw ApiError.badRequest('An image file is required in the "image" field.');
  if (file.size > maxFileSize || file.buffer?.length > maxFileSize) {
    throw ApiError.unprocessable('Image size must not exceed 5 MB.');
  }
  const detectedMimeType = detectImageMimeType(file.buffer);
  if (!detectedMimeType || detectedMimeType !== file.mimetype) {
    throw ApiError.unprocessable('The uploaded file content does not match a supported image format.');
  }

  const extension = mimeExtensions.get(detectedMimeType);
  const filename = `${crypto.randomUUID()}.${extension}`;
  const imageUrl = `/uploads/${category}/${filename}`;
  const directory = path.join(uploadsRoot, category);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, filename), file.buffer, { flag: 'wx' });

  let result;
  try {
    result = category === 'admin'
      ? await projectModel.updateAdminAvatar(userId, imageUrl)
      : await projectModel.updateStaffAvatar(staffId, imageUrl);
    if (result.notFound) throw ApiError.notFound('Staff profile not found.');
  } catch (error) {
    try {
      await removeManagedImage(imageUrl, category);
    } catch (cleanupError) {
      console.error(`[Image Upload] Could not remove failed ${category} image upload:`, cleanupError);
    }
    throw error;
  }

  try {
    await removeManagedImage(result.previousImageUrl, category);
  } catch (error) {
    console.error(`[Image Upload] Could not remove replaced ${category} image:`, error);
  }
  return { imageUrl: result.imageUrl, category };
};

module.exports = {
  detectImageMimeType,
  isManagedImageUrl,
  uploadProfileImage
};
