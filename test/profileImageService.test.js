const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectImageMimeType,
  isManagedImageUrl,
  uploadProfileImage
} = require('../src/services/profileImageService');

const makeIsoBmffImage = (majorBrand, compatibleBrands = []) => {
  const brands = [majorBrand, ...compatibleBrands];
  const buffer = Buffer.alloc(16 + compatibleBrands.length * 4);
  buffer.writeUInt32BE(buffer.length, 0);
  buffer.write('ftyp', 4);
  buffer.write(majorBrand, 8);
  brands.slice(1).forEach((brand, index) => buffer.write(brand, 16 + index * 4));
  return buffer;
};

test('detects supported image formats from their file signatures', () => {
  assert.equal(detectImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(
    detectImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/png'
  );
  assert.equal(detectImageMimeType(Buffer.from('RIFF0000WEBP')), 'image/webp');
  assert.equal(detectImageMimeType(Buffer.from('GIF89a')), 'image/gif');
  assert.equal(detectImageMimeType(Buffer.from('BM')), 'image/bmp');
  assert.equal(detectImageMimeType(Buffer.from([0x49, 0x49, 0x2a, 0x00])), 'image/tiff');
  assert.equal(detectImageMimeType(makeIsoBmffImage('avif')), 'image/avif');
  assert.equal(detectImageMimeType(makeIsoBmffImage('heic')), 'image/heic');
  assert.equal(detectImageMimeType(makeIsoBmffImage('mif1')), 'image/heif');
});

test('rejects unsupported image signatures and non-buffer input', () => {
  assert.equal(detectImageMimeType(Buffer.from('<script>alert(1)</script>')), null);
  assert.equal(detectImageMimeType(null), null);
});

test('recognizes only generated image URLs belonging to the requested folder', () => {
  const imageUrl = '/uploads/staff/123e4567-e89b-12d3-a456-426614174000.webp';
  assert.equal(isManagedImageUrl(imageUrl, 'staff'), true);
  assert.equal(isManagedImageUrl(imageUrl, 'admin'), false);
  assert.equal(
    isManagedImageUrl('/uploads/staff/123e4567-e89b-12d3-a456-426614174000.heic', 'staff'),
    true
  );
  assert.equal(isManagedImageUrl('/uploads/staff/../../secret.jpg', 'staff'), false);
});

test('rejects image content that does not match its declared format', async () => {
  await assert.rejects(
    uploadProfileImage({
      category: 'admin',
      userId: 1,
      file: { buffer: Buffer.from('not an image'), mimetype: 'image/jpeg', size: 12 }
    }),
    (error) => error.statusCode === 422
  );
});

test('rejects profile images larger than 5 MB', async () => {
  await assert.rejects(
    uploadProfileImage({
      category: 'admin',
      userId: 1,
      file: { buffer: Buffer.alloc(1), mimetype: 'image/jpeg', size: 5 * 1024 * 1024 + 1 }
    }),
    (error) => error.statusCode === 422
  );
});
