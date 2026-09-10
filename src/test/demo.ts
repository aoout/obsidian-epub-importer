/**
 * 无头演示：脱离 Obsidian，用同一套流水线跑真实 EPUB，把"解析输出"打印出来。
 * 运行：npx ts-node src/test/demo.ts [epub路径] [granularity]
 */
import * as path from 'path';
import { importEpubToVault, MemoryTarget } from '../writer';

const epubDir = path.resolve(__dirname, 'epubs');
const epub = process.argv[2] || path.join(epubDir, '自控力.epub');
const granularity = Number(process.argv[3] ?? 3);

(async () => {
	const target = new MemoryTarget();
	const t0 = Date.now();
	const result = await importEpubToVault(epub, target, {
		verbose: true,
		write: { granularity },
	});
	const ms = Date.now() - t0;

	const m = result.book.metadata;
	console.log('================ 解析输出 ================');
	console.log('文件      :', path.basename(epub));
	console.log('标题      :', m?.title);
	console.log('作者      :', (m?.creators ?? []).map((c) => c.name).join(', '));
	console.log('语言      :', m?.language);
	console.log('spine     :', result.book.spine.length, '  nav:', result.book.nav.length);
	console.log('笔记数    :', result.notes.length, '  资源数:', result.assets.length);
	console.log('MOC       :', result.mocPath ?? '(无)');
	console.log('耗时      :', ms, 'ms');
	console.log('------------------------------------------');
	const sample = result.notes.find((n) => n.path !== result.mocPath);
	if (sample) {
		console.log('示例笔记  :', sample.path, '(level', sample.level + ')');
		const content = target.read(sample.path) ?? '';
		console.log('--- 笔记内容（前 700 字）---');
		console.log(content.slice(0, 700));
	}
	console.log('------------------------------------------');
	console.log('诊断(' + result.diagnostics.length + '):');
	for (const d of result.diagnostics) {
		console.log(`  [${d.severity}] ${d.code ?? '-'}  ${d.message}`);
	}
})().catch((e) => {
	console.error('运行失败:', e);
	process.exit(1);
});
