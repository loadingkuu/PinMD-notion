'use strict';
// 将 assets/icon.png 包装为 assets/icon.ico（Vista+ ICO 支持直接内嵌 PNG）
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const png = fs.readFileSync(path.join(root, 'assets', 'icon.png'));
const w = png.readUInt32BE(16);
const h = png.readUInt32BE(20);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);      // reserved
header.writeUInt16LE(1, 2);      // type: 1 = icon
header.writeUInt16LE(1, 4);      // image count

const entry = Buffer.alloc(16);
entry.writeUInt8(w >= 256 ? 0 : w, 0);   // width  (0 = 256)
entry.writeUInt8(h >= 256 ? 0 : h, 1);   // height (0 = 256)
entry.writeUInt8(0, 2);                  // palette
entry.writeUInt8(0, 3);                  // reserved
entry.writeUInt16LE(1, 4);               // color planes
entry.writeUInt16LE(32, 6);              // bits per pixel
entry.writeUInt32LE(png.length, 8);      // image data size
entry.writeUInt32LE(6 + 16, 12);         // offset to image data

const ico = Buffer.concat([header, entry, png]);
fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), ico);
console.log('Wrote assets/icon.ico', ico.length, 'bytes');
