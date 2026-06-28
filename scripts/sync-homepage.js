const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sourceDir = path.join(root, 'homepage');
const targetFlagIndex = process.argv.indexOf('--target');
const targetDir = targetFlagIndex >= 0 && process.argv[targetFlagIndex + 1]
  ? path.resolve(process.argv[targetFlagIndex + 1])
  : path.join(root, 'homepage-dist');

if (!fs.existsSync(path.join(sourceDir, 'index.html'))) {
  throw new Error(`Homepage source not found: ${sourceDir}`);
}

fs.rmSync(targetDir, { recursive: true, force: true });
copyDir(sourceDir, targetDir);
console.log(`Synced homepage to ${targetDir}`);

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}
