/**
 * 把 CLI 打包成单文件 bin/epub-importer.js。
 *
 * 用 esbuild 的 JS API 而不是命令行，是为了绕开 npm script 里
 * `--banner='#!/usr/bin/env node'` 这种带空格的参数在 Windows cmd.exe 下被拆成多个参数的问题。
 *
 * 用法：npm run build:cli
 */

const fs = require('fs');
const path = require('path');
const { buildSync } = require('esbuild');

const OUT = path.join('bin', 'epub-importer.js');

fs.mkdirSync('bin', { recursive: true });

buildSync({
	entryPoints: ['src/cli/cli.ts'],
	bundle: true,
	platform: 'node',
	target: 'node18',
	outfile: OUT,
	logLevel: 'warning',
});

// shebang：让产物可以直接执行，且 npm link 后能当命令用
const body = fs.readFileSync(OUT, 'utf8');
if (!body.startsWith('#!')) {
	fs.writeFileSync(OUT, `#!/usr/bin/env node\n${body}`);
}

// POSIX 下给可执行位；Windows 忽略
try {
	fs.chmodSync(OUT, 0o755);
} catch {
	/* Windows 无需 */
}

const { size } = fs.statSync(OUT);
console.log(`built ${OUT} (${(size / 1024).toFixed(0)} KB)`);
