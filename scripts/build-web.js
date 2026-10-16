// Copies the static app into www/ — the folder Capacitor packages into the Android app.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
const include = ['index.html', 'manifest.webmanifest', 'sw.js', 'privacy.html', 'css', 'js', 'icons', 'assets/favicon.png', 'assets/logo-mark.png'];

fs.rmSync(out, { recursive: true, force: true });
for (const item of include) {
  const src = path.join(root, item);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(out, item), { recursive: true });
}
console.log('Built www/ with: ' + include.join(', '));
