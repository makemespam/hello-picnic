const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const standalone = path.join(root, '.next', 'standalone');
const staticDir = path.join(root, '.next', 'static');
const publicDir = path.join(root, 'public');
const desktopDist = path.join(root, 'desktop-dist');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sourcePath = path.join(src, entry.name);
    const targetPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(sourcePath, targetPath);
    else fs.copyFileSync(sourcePath, targetPath);
  }
}

if (!fs.existsSync(path.join(standalone, 'server.js'))) {
  throw new Error('Next standalone build ontbreekt. Draai eerst npm run build.');
}

fs.rmSync(desktopDist, { recursive: true, force: true });
copyDir(standalone, desktopDist);
copyDir(staticDir, path.join(desktopDist, '.next', 'static'));
copyDir(publicDir, path.join(desktopDist, 'public'));

console.log(`Prepared Electron Next server at ${desktopDist}`);
