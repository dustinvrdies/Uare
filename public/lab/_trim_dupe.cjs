const fs = require('fs');
const p = 'C:/Users/quant/OneDrive/UARE_enterprise_extracted/custom_backend/public/lab/cad-engine.js';
const c = fs.readFileSync(p, 'utf8');
const lines = c.split('\n');
console.log('Total lines before trim:', lines.length);
// Duplicate starts at line index 5381 (line number 5382)
const trimmed = lines.slice(0, 5381).join('\n');
fs.writeFileSync(p, trimmed, 'utf8');
const sz = fs.statSync(p).size;
console.log('Trimmed to', lines.slice(0,5381).length, 'lines,', Math.round(sz/1024) + 'KB');
