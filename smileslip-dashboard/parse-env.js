const fs = require('fs');
const lines = fs.readFileSync('.env', 'utf8').split('\n');
const env = {};
for (const line of lines) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
}
const yaml = Object.entries(env).map(([k,v]) => k + ": '" + v.replace(/'/g, "''") + "'").join('\n');
const outPath = process.argv[2] || 'env-out.yaml';
fs.writeFileSync(outPath, yaml);
console.log('written to', outPath);
