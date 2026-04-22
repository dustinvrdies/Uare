const fs = require('fs');
const base = 'C:/Users/quant/OneDrive/UARE_enterprise_extracted/custom_backend/public/lab/';
const files = ['cad-engine.js', 'sim-engine.js', 'enki.js'];
let allOk = true;
files.forEach(f => {
  try {
    const code = fs.readFileSync(base + f, 'utf8');
    new Function(code);
    const kb = Math.round(fs.statSync(base + f).size / 1024);
    console.log('  OK  ' + f + '  (' + kb + 'KB)');
  } catch(e) {
    allOk = false;
    const line = e.message || '';
    console.error('  ERR ' + f + ': ' + line.split('\n')[0]);
  }
});
if (allOk) console.log('\nAll files syntax OK!');
else console.log('\nErrors found — fix before testing.');
