// Builds DataVision-Lite.html — a single-file, server-free version.
// Embeds the sample CSV so the "Try sample" button works offline too.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const tpl = fs.readFileSync(path.join(__dirname, 'lite-template.html'), 'utf8');
const csv = fs.readFileSync(path.join(root, 'sample-data', 'sample_sales_data.csv'), 'utf8');
const out = tpl.replace('"__SAMPLE_CSV__"', JSON.stringify(csv));
fs.writeFileSync(path.join(root, 'DataVision-Lite.html'), out);
console.log('Built DataVision-Lite.html (', Math.round(out.length / 1024), 'KB )');
