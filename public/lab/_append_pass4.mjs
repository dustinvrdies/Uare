import { readFileSync, writeFileSync, statSync } from 'fs';
const base = 'C:/Users/quant/OneDrive/UARE_enterprise_extracted/custom_backend/public/lab';
const pass4 = readFileSync(base + '/_pass4_content.js', 'utf8');
const current = readFileSync(base + '/cad-engine.js', 'utf8');
// Only append if not already appended
if (current.includes('END OF PASS 4')) {
  console.log('Pass 4 already appended.');
} else {
  writeFileSync(base + '/cad-engine.js', current + '\n' + pass4, 'utf8');
  const sz = statSync(base + '/cad-engine.js').size;
  console.log('✓ Pass 4 appended. cad-engine.js =', Math.round(sz/1024) + 'KB');
}
