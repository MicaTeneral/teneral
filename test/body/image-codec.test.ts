import { expect, test } from 'bun:test';
import { fitImage } from '../../body/image-codec';

const ONE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test('small static images, animated GIFs, APNG and undecodable header-only files keep their bytes', async () => {
  expect(await fitImage(ONE)).toEqual(ONE);
  const gif = Buffer.from('GIF89a\x00\x20\x00\x20', 'latin1');
  expect(await fitImage(gif)).toEqual(gif);
  const apng = Buffer.alloc(33);
  Buffer.from('\x89PNG\r\n\x1a\n', 'latin1').copy(apng);
  apng.writeUInt32BE(8, 8);
  apng.write('acTL', 12, 'latin1');
  expect(await fitImage(apng)).toEqual(apng);
  const header = Buffer.alloc(33);
  Buffer.from('\x89PNG\r\n\x1a\n', 'latin1').copy(header);
  header.writeUInt32BE(5000, 16);
  header.writeUInt32BE(4000, 20);
  expect(await fitImage(header)).toEqual(header);
});

test('a large static PNG is resized with its aspect ratio, without enlargement', async () => {
  const original = await new Bun.Image(ONE).resize(2000, 1000).png().bytes();
  const fitted = await fitImage(original);
  expect(await new Bun.Image(fitted).metadata()).toMatchObject({ width: 1568, height: 784, format: 'png' });
  expect(Buffer.from(fitted).equals(Buffer.from(original))).toBe(false);
});
