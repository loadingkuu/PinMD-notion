'use strict';
// 打包后瘦身：删掉用不到的语言包（locales/*.pak），只保留中英文
const fs = require('fs');
const path = require('path');

const KEEP = new Set(['en-US.pak', 'zh-CN.pak']);
const out = path.join(__dirname, '..', 'dist', 'Notion-Float-win32-x64');
const locales = path.join(out, 'locales');

let removed = 0, freed = 0;
try {
  for (const f of fs.readdirSync(locales)) {
    if (f.endsWith('.pak') && !KEEP.has(f)) {
      const p = path.join(locales, f);
      freed += fs.statSync(p).size;
      fs.unlinkSync(p);
      removed++;
    }
  }
  console.log(`Pruned ${removed} locale files, freed ${(freed / 1048576).toFixed(1)} MB`);
} catch (e) {
  console.warn('prune skipped:', e.message);
}
