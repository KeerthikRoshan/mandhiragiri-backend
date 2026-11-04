const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectImageMimeType,
  isManagedImageUrl,
  uploadProfileImage
} = require('../src/services/profileImageService');

test('detects supported image formats from their file signatures', () => {
  assert.equal(detectImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(
    detectImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/png'
  );
  assert.equal(detectImageMimeType(Buffer.from('RIFF0000WEBP')), 'image/webp');
});

test('rejects unsupported image signatures and non-buffer input', () => {
  assert.equal(detectImageMimeType(Buffer.from('<script>alert(1)</script>')), null);
  assert.equal(detectImageMimeType(null), null);
});

test('recognizes only generated image URLs belonging to the requested folder', () => {
  const imageUrl = '/uploads/staff/123e4567-e89b-12d3-a456-426614174000.webp';
  assert.equal(isManagedImageUrl(imageUrl, 'staff'), true);
  assert.equal(isManagedImageUrl(imageUrl, 'admin'), false);
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
