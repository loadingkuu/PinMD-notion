'use strict';
// 生成简单的应用/托盘图标 PNG（便签风格：琥珀色圆角方块 + 三条白色横线）
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crcTable() {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function draw(size) {
  const w = size, h = size;
  const buf = Buffer.alloc(w * h * 4, 0);
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  const pad = Math.round(size * 0.08);
  const radius = Math.round(size * 0.22);
  const inRounded = (x, y) => {
    const x0 = pad, y0 = pad, x1 = w - pad - 1, y1 = h - pad - 1;
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
    const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };
  // 背景：琥珀色
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (inRounded(x, y)) set(x, y, 0xf0, 0xa0, 0x20, 0xff);
  // 三条白色横线（便签/清单）
  const lineH = Math.max(2, Math.round(size * 0.09));
  const lx0 = Math.round(size * 0.30), lx1 = Math.round(size * 0.70);
  [0.36, 0.52, 0.68].forEach((fy) => {
    const y0 = Math.round(size * fy);
    for (let y = y0; y < y0 + lineH; y++)
      for (let x = lx0; x <= lx1; x++) if (inRounded(x, y)) set(x, y, 255, 255, 255, 255);
  });
  return encodePNG(w, h, buf);
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'tray.png'), draw(32));
fs.writeFileSync(path.join(outDir, 'icon.png'), draw(256));
console.log('icons written to', outDir);
