'use strict';
// 生成应用/托盘图标 PNG：蓝紫渐变圆角方块 + 白色对勾（带超采样抗锯齿）
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
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
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
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- 几何辅助 ----
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
function insideRounded(x, y, s) {
  const pad = s * 0.05, radius = s * 0.235;
  const x0 = pad, y0 = pad, x1 = s - pad, y1 = s - pad;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
  const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}
// Notion 风格 "N"：左竖、右竖、左上到右下的对角，统一线宽
function insideN(x, y, s) {
  const x0 = 0.31 * s, x1 = 0.64 * s, y0 = 0.28 * s, y1 = 0.72 * s, half = 0.060 * s;
  const d = Math.min(
    distSeg(x, y, x0, y0, x0, y1),
    distSeg(x, y, x1, y0, x1, y1),
    distSeg(x, y, x0, y0, x1, y1)
  );
  return d <= half;
}
function inCircle(x, y, cx, cy, r) { const dx = x - cx, dy = y - cy; return dx * dx + dy * dy <= r * r; }
// 徽章里的小对勾
function insideBadgeCheck(x, y, s, cx, cy) {
  const half = 0.028 * s;
  const d = Math.min(
    distSeg(x, y, cx - 0.085 * s, cy + 0.004 * s, cx - 0.015 * s, cy + 0.072 * s),
    distSeg(x, y, cx - 0.015 * s, cy + 0.072 * s, cx + 0.100 * s, cy - 0.072 * s)
  );
  return d <= half;
}
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

// 单个子像素的颜色（自上而下合成）：返回 [r,g,b,a]
const TOP = [124, 92, 246];   // #7C5CF6 紫
const BOT = [56, 150, 255];   // #3896FF 蓝
const GREEN = [46, 204, 113]; // #2ECC71 对勾徽章
function shade(x, y, s) {
  if (!insideRounded(x, y, s)) return [0, 0, 0, 0];
  const pad = s * 0.05;
  const t = Math.min(1, Math.max(0, (y - pad) / (s - 2 * pad)));
  const grad = [lerp(TOP[0], BOT[0], t), lerp(TOP[1], BOT[1], t), lerp(TOP[2], BOT[2], t), 255];
  const bx = 0.70 * s, by = 0.70 * s;
  if (insideBadgeCheck(x, y, s, bx, by)) return [255, 255, 255, 255]; // 徽章对勾
  if (inCircle(x, y, bx, by, 0.190 * s)) return [GREEN[0], GREEN[1], GREEN[2], 255]; // 绿色徽章
  if (inCircle(x, y, bx, by, 0.235 * s)) return grad; // 徽章与 N 之间的间隙
  if (insideN(x, y, s)) return [255, 255, 255, 255]; // 白色 N
  return grad;
}

// 超采样渲染（SS×SS）
function render(size) {
  const SS = 4, W = size, H = size;
  const out = Buffer.alloc(W * H * 4, 0);
  const n = SS * SS;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, size);
          const af = c[3] / 255;
          r += c[0] * af; g += c[1] * af; b += c[2] * af; a += af;
        }
      }
      const i = (y * W + x) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
        out[i + 3] = Math.round((a / n) * 255);
      }
    }
  }
  return encodePNG(W, H, out);
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'tray.png'), render(32));
fs.writeFileSync(path.join(outDir, 'icon.png'), render(256));
console.log('icons written to', outDir);
