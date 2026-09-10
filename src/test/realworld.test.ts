/**
 * 真实 EPUB 端到端冒烟测试：用 MemoryTarget 跑完整流水线（解析→切分→转换→写入），
 * 不依赖 Obsidian。目的：在合成 fixture 之外，验证新流水线对真实书籍（含中文/CJK、
 * 期刊结构）能产出合理的 Markdown，并暴露潜在 bug。
 *
 * 这是“冒烟/校验”性质：核心断言保证不崩溃、有产出、无 fatal；同时打印摘要供人工检视。
 */

import * as fs from 'fs';
import * as path from 'path';
import { MemoryTarget, importEpubToVault } from '../writer';
import type { ImportOptions } from '../writer';

const EPUB_DIR = path.resolve(__dirname, 'epubs');

const CASES: Array<{ file: string; granularity: number }> = [
	{ file: '自控力.epub', granularity: 3 },
	{ file: 'TheEconomist.2024.07.06.epub', granularity: 4 },
	{ file: '资治通鉴全译本.epub', granularity: 2 },
];

describe('real-world epub smoke', () => {
	const opts: ImportOptions = {
		write: { savePath: '', assetsPath: 'assets', generateMoc: true },
		transform: { imageFormat: 'markdown' },
	};

	for (const c of CASES) {
		it(
			`imports ${c.file}`,
			async () => {
				const epubPath = path.join(EPUB_DIR, c.file);
				expect(fs.existsSync(epubPath)).toBe(true);

				const buf = fs.readFileSync(epubPath);
				const target = new MemoryTarget();

				const started = Date.now();
				const result = await importEpubToVault(buf, target, {
					...opts,
					write: { ...opts.write, granularity: c.granularity },
				});
				const elapsed = Date.now() - started;

				// ---- 核心断言：不崩溃、有产出、无 fatal ----
				const fatal = result.diagnostics.filter((d) => d.severity === 'fatal');
				expect(fatal).toHaveLength(0);
				expect(result.notes.length).toBeGreaterThan(0);

				// ---- 摘要（人工检视） ----
				const meta = result.book.metadata;
				console.log(`\n===== ${c.file} (granularity=${c.granularity}) =====`);
				console.log(`title      : ${meta?.title}`);
				console.log(`creator    : ${meta?.creators?.map((c) => c.name).join(', ')}`);
				console.log(`language   : ${meta?.language}`);
				console.log(`spine nav  : ${result.book.spine.length} / ${result.book.nav.length}`);
				console.log(`notes      : ${result.notes.length}  assets: ${result.assets.length}`);
				console.log(`mocPath    : ${result.mocPath}`);
				console.log(`elapsed    : ${elapsed} ms`);

				const warns = result.diagnostics.filter((d) => d.severity === 'warning');
				if (warns.length) {
					console.log(`warnings(${warns.length}):`);
					for (const w of warns.slice(0, 8)) {
						console.log(`  - [${w.code ?? '?'}] ${w.message}`);
					}
				} else {
					console.log('warnings   : none');
				}

				// 列出产出文件（前 20 个），确认目录层级 / 命名
				console.log('files (first 20):');
				for (const f of target.listFiles().slice(0, 20)) {
					console.log(`  ${f}  (${target.read(f)?.length ?? 0} chars)`);
				}

				// 抽一篇正文笔记，检视图片链接与内链格式
				const bodyNote = result.notes.find((n) => n.path !== result.mocPath);
				const content = bodyNote ? target.read(bodyNote.path) ?? '' : '';
				if (bodyNote) {
					const sample = content.slice(0, 2500);
					console.log(`\nsample note: ${bodyNote.path}`);
					console.log('--- head ---');
					console.log(sample);
					const imgLinks = [...sample.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
					if (imgLinks.length) {
						console.log('image links:', imgLinks.slice(0, 5));
					}
					const wikiLinks = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
					if (wikiLinks.length) {
						console.log('wikilinks  :', wikiLinks.slice(0, 5));
					}
				}

				// 全局扫描：wikilink 数 / 图片链接数 / 指向未落盘资源的悬空图片链接数
				let wikiCount = 0;
				let imgCount = 0;
				let danglingImg = 0;
				let rawHtmlTags = 0;
				for (const f of target.listFiles()) {
					const c = target.read(f) ?? '';
					wikiCount += (c.match(/\[\[/g) || []).length;
					for (const m of c.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
						imgCount++;
						// 链接里的 %XX 是 Markdown 目的地编码，先解码回真实路径再比对存储键
						let p = m[1].replace(/^\//, '');
						try {
							p = decodeURIComponent(p);
						} catch {
							/* 保留原文，交给下面的 has() 判定 */
						}
						if (!target.files.has(p) && !target.binaries.has(p)) danglingImg++;
					}
					rawHtmlTags += (c.match(/<\/?[a-zA-Z][^>]*>/g) || []).length;
				}
				// 质量门禁：转换器不得向最终 Markdown 泄漏裸 HTML 标签
				// （含曾大量出现的排版表格内字面 <br>）。注：<pre> 等「保留原文」
				// 通道若含代码示例中的尖括号，会在此显式放开，不允许静默例外。
				expect(rawHtmlTags).toBe(0);
				console.log(
					`GLOBAL: wikilinks=${wikiCount} images=${imgCount} danglingImages=${danglingImg} rawHtmlTags=${rawHtmlTags}`,
				);
				console.log('========================================\n');
			},
			180_000,
		);
	}
});
