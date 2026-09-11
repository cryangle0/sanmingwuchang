const sharp = require('sharp');
(async () => {
  const file = process.argv[2];
  const meta = await sharp(file).metadata();
  const buf = await sharp(file).raw().toBuffer();
  let count = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, sr = 0, sg = 0, sb = 0;
  for (let y = 0; y < meta.height; y += 1) {
    for (let x = 0; x < meta.width; x += 1) {
      const i = (y * meta.width + x) * 3;
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      if (r > 105 && b > 105 && Math.abs(r - b) < 28 && g < r - 4 && g > 80) {
        count += 1;
        sr += r; sg += g; sb += b;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  console.log(file.split('/').slice(-2).join('/'));
  console.log('  pale pixels', count, 'avg', count ? `${Math.round(sr / count)},${Math.round(sg / count)},${Math.round(sb / count)}` : '-');
  console.log('  bbox x', minX, '-', maxX, ' y', minY, '-', maxY);
})();
