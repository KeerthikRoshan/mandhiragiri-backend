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
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/bmp', 'bmp'],
  ['image/tiff', 'tiff'],
  ['image/avif', 'avif'],
  ['image/heic', 'heic'],
  ['image/heif', 'heif']
]);
const mimeAliases = new Map([
  ['image/pjpeg', 'image/jpeg'],
  ['image/x-ms-bmp', 'image/bmp'],
  ['image/x-tiff', 'image/tiff']
]);

const normalizeImageMimeType = (mimeType) => mimeAliases.get(mimeType) || mimeType;

const detectIsoBmffImageMimeType = (buffer) => {
  if (buffer.length < 16 || buffer.toString('ascii', 4, 8) !== 'ftyp') return null;

  const boxSize = buffer.readUInt32BE(0);
  if (boxSize < 16 || boxSize > buffer.length) return null;

  const brands = [buffer.toString('ascii', 8, 12)];
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
    brands.push(buffer.toString('ascii', offset, offset + 4));
  }

  if (brands.some((brand) => brand === 'avif' || brand === 'avis')) return 'image/avif';
  if (brands.some((brand) => ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand))) {
    return 'image/heic';
  }
  if (brands.some((brand) => ['heif', 'mif1', 'msf1'].includes(brand))) return 'image/heif';
  return null;
};

const detectImageMimeType = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) {
    return 'image/gif';
  }
  if (buffer.length >= 2 && buffer.toString('ascii', 0, 2) === 'BM') return 'image/bmp';
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 4 &&
    (
      (
        buffer[0] === 0x49 &&
        buffer[1] === 0x49 &&
        (buffer[2] === 0x2a || buffer[2] === 0x2b) &&
        buffer[3] === 0x00
      ) ||
      (
        buffer[0] === 0x4d &&
        buffer[1] === 0x4d &&
        buffer[2] === 0x00 &&
        (buffer[3] === 0x2a || buffer[3] === 0x2b)
      )
    )
  ) {
    return 'image/tiff';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return detectIsoBmffImageMimeType(buffer);
};

const isManagedImageUrl = (imageUrl, category) => {
  if (typeof imageUrl !== 'string') return false;
  const prefix = `/uploads/${category}/`;
  if (!imageUrl.startsWith(prefix)) return false;
  const filename = imageUrl.slice(prefix.length);
  return /^[0-9a-f-]{36}\.(jpg|png|webp|gif|bmp|tiff|avif|heic|heif)$/.test(filename);
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
  if (!detectedMimeType || detectedMimeType !== normalizeImageMimeType(file.mimetype)) {
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
