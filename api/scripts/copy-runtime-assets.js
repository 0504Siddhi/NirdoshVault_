const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
const distDir = path.join(__dirname, '..', 'dist');

function copyNonTsFiles(currentSrc, currentDist) {
  if (!fs.existsSync(currentSrc)) return;
  const entries = fs.readdirSync(currentSrc, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(currentSrc, entry.name);
    const distPath = path.join(currentDist, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(distPath, { recursive: true });
      copyNonTsFiles(srcPath, distPath);
    } else if (entry.isFile()) {
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.ts.map')) {
        fs.mkdirSync(path.dirname(distPath), { recursive: true });
        fs.copyFileSync(srcPath, distPath);
        const relPath = path.relative(path.join(__dirname, '..'), distPath);
        console.log(`[copy-runtime-assets] Copied: ${relPath}`);
      }
    }
  }
}

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

console.log('[copy-runtime-assets] Copying runtime non-TS assets to dist...');
copyNonTsFiles(srcDir, distDir);
console.log('[copy-runtime-assets] Runtime assets copied successfully.');
