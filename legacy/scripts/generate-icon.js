const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default ?? pngToIcoModule;

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build');
const svgPath = path.join(buildDir, 'icon.svg');
const pngPath = path.join(buildDir, 'icon.png');
const icoPath = path.join(buildDir, 'icon.ico');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="112" fill="#fff7ed"/>
  <circle cx="130" cy="134" r="28" fill="#f97316"/>
  <path d="M102 150h55l42 180h173c16 0 30-10 35-25l42-122H183" fill="none" stroke="#57534e" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M208 220h214M225 270h178M245 320h127" stroke="#a8a29e" stroke-width="20" stroke-linecap="round"/>
  <path d="M251 183l34 146M337 183l-18 146" stroke="#a8a29e" stroke-width="18" stroke-linecap="round"/>
  <circle cx="227" cy="385" r="30" fill="#57534e"/>
  <circle cx="365" cy="385" r="30" fill="#57534e"/>
  <circle cx="227" cy="385" r="12" fill="#f97316"/>
  <circle cx="365" cy="385" r="12" fill="#f97316"/>
  <path d="M112 150c-10-42-23-62-53-62" fill="none" stroke="#57534e" stroke-width="28" stroke-linecap="round"/>
</svg>`;

async function main() {
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(svgPath, svg, 'utf8');

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const size of sizes) {
    const file = path.join(buildDir, `icon-${size}.png`);
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(file);
    pngs.push(file);
  }

  await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(pngPath);
  const ico = await pngToIco(pngs);
  fs.writeFileSync(icoPath, ico);
  console.log(`Generated ${icoPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
