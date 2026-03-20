const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  const sourceDir = path.join(
    context.packager.projectDir,
    'node_modules',
    '.prisma',
  );
  const targetDir = path.join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    '.prisma',
  );

  if (!fs.existsSync(sourceDir)) {
    return;
  }

  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
};
