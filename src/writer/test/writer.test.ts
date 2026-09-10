/**
 * Writer 层单测：纯函数部分 + 用 MemoryTarget 的写入集成测试。
 * 不依赖真实 EPUB（端到端见 src/test/import.test.ts）。
 */

import { MemoryTarget } from '../targets';
import { writeBook, normalizeDate, ensureNoteHeading } from '../Writer';
import { planNotes, normalizeHeadings, normalizeHref, rewriteLinks } from '../planner';
import { buildFrontmatter, renderTemplate, toYaml } from '../template';
import { basenameOf, extOf, joinPath, sanitizeFileName, uniquePath } from '../path';
import type { Book, Diagnostic, FileProvider } from '../../parser/types';
import type { TransformedChapter } from '../../transform';
import { transformChapters } from '../../transform';

const testBook = (): Book => ({
	version: '3.0',
	metadata: {
		title: '测试书',
		creators: [{ name: '作者A' }, { name: '作者B' }],
		language: 'ja',
		publisher: '某出版社',
		subjects: ['标签1'],
		description: '简介',
		date: '2026',
		identifiers: [],
		meta: {},
	},
	manifest: [
		{ id: 'c1', href: 'OEBPS/c1.xhtml', mediaType: 'application/xhtml+xml', properties: [] },
		{ id: 'img1', href: 'OEBPS/images/a.png', mediaType: 'image/png', properties: [] },
		{ id: 'img2', href: 'OEBPS/images/b.gif', mediaType: 'image/gif', properties: [] },
		{ id: 'css1', href: 'OEBPS/style.css', mediaType: 'text/css', properties: [] },
	],
	spine: [],
	nav: [],
	diagnostics: [],
});

const chapter = (
	id: string,
	title: string,
	level: number,
	markdown: string,
	fileHref = 'OEBPS/c1.xhtml',
): TransformedChapter => ({ id, title, level, fileHref, markdown });

/** 假 FileProvider：所有二进制请求返回一个固定字节串 */
const fakeProvider = (): FileProvider => ({
	has: () => true,
	readText: async () => undefined,
	readBinary: async () => Buffer.from([0x89, 0x50]),
});

describe('sanitizeFileName', () => {
	it('替换文件系统非法字符', () => {
		expect(sanitizeFileName('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i');
	});

	it('去掉结尾的点与空格（Windows 不允许）', () => {
		expect(sanitizeFileName('章节.')).toBe('章节');
		expect(sanitizeFileName('章节 ')).toBe('章节');
	});

	it('清理控制字符', () => {
		expect(sanitizeFileName('a\nb\tc')).toBe('abc');
	});

	it('处理 Windows 保留设备名', () => {
		expect(sanitizeFileName('CON')).toBe('_CON');
		expect(sanitizeFileName('nul')).toBe('_nul');
	});

	it('空名回退为 untitled（原实现会返回空串）', () => {
		expect(sanitizeFileName('')).toBe('untitled');
		expect(sanitizeFileName('...')).toBe('untitled');
	});

	it('超长截断', () => {
		expect(sanitizeFileName('あ'.repeat(200), 100)).toHaveLength(100);
	});

	it('保留 CJK', () => {
		expect(sanitizeFileName('日本語 の本')).toBe('日本語 の本');
	});
});

describe('toYaml / buildFrontmatter', () => {
	it('标量', () => {
		expect(toYaml({ a: 1, b: 'x', c: true })).toBe('a: 1\nb: x\nc: true');
	});

	it('数组用 block 风格', () => {
		expect(toYaml({ tags: ['a', 'b'] })).toBe('tags:\n  - a\n  - b');
	});

	it('嵌套对象', () => {
		expect(toYaml({ a: { b: 1 } })).toBe('a:\n  b: 1');
	});

	it('需要引号的字符串加引号（含冒号空格 / 纯数字 / 布尔样）', () => {
		expect(toYaml({ a: 'x: y' })).toBe('a: "x: y"');
		expect(toYaml({ a: '123' })).toBe('a: "123"');
		expect(toYaml({ a: 'true' })).toBe('a: "true"');
	});

	it('frontmatter 包裹 ---', () => {
		expect(buildFrontmatter({ a: 1 })).toBe('---\na: 1\n---');
	});

	it('无有效属性时不产生空 frontmatter', () => {
		expect(buildFrontmatter({})).toBe('');
		expect(buildFrontmatter(undefined)).toBe('');
		expect(buildFrontmatter({ a: undefined, b: '' })).toBe('');
	});
});

describe('renderTemplate', () => {
	it('替换 {{var}}', () => {
		expect(renderTemplate('{{a}}-{{b}}', { a: '1', b: '2' })).toBe('1-2');
	});

	it('未定义变量原样保留', () => {
		expect(renderTemplate('{{x}}', {})).toBe('{{x}}');
	});
});

describe('normalizeHeadings / normalizeHref', () => {
	it('把最浅标题对齐到 #', () => {
		expect(normalizeHeadings('### a\n#### b')).toBe('# a\n## b');
	});

	it('已有 # 时不变', () => {
		expect(normalizeHeadings('# a\n## b')).toBe('# a\n## b');
	});

	it('归一化 href 去掉 ./ 与 ../', () => {
		expect(normalizeHref('../OEBPS/./c1.xhtml')).toBe('OEBPS/c1.xhtml');
		expect(normalizeHref('a/b/../c.xhtml')).toBe('a/c.xhtml');
	});
});

describe('rewriteLinks', () => {
	// planNotes 的真实形态：同时登记完整路径与 basename
	const linkMap = new Map([
		['OEBPS/c1.xhtml', '书/第一章'],
		['c1.xhtml', '书/第一章'],
	]);

	it('完整 href 命中', () => {
		expect(rewriteLinks('见 [[OEBPS/c1.xhtml|第一章]]', linkMap)).toBe('见 [[书/第一章|第一章]]');
	});

	it('basename 命中（正文里常见相对 href）', () => {
		expect(rewriteLinks('见 [[c1.xhtml]]', linkMap)).toBe('见 [[书/第一章]]');
	});

	it('fragment 精确命中对应笔记，无 fragment 时回退到文件首章', () => {
		const map = new Map([
			['OEBPS/c1.xhtml', '书/第一章'],
			['OEBPS/c1.xhtml#sec2', '书/第二章'],
		]);
		expect(rewriteLinks('[[OEBPS/c1.xhtml#sec2|第二节]]', map)).toBe('[[书/第二章|第二节]]');
		expect(rewriteLinks('[[OEBPS/c1.xhtml|整章]]', map)).toBe('[[书/第一章|整章]]');
	});

	it('找不到映射时原样保留（不丢链接）', () => {
		expect(rewriteLinks('见 [[unknown.xhtml|a]]', linkMap)).toBe('见 [[unknown.xhtml|a]]');
	});

	it('非文档链接（普通笔记）不动', () => {
		expect(rewriteLinks('见 [[普通笔记]]', linkMap)).toBe('见 [[普通笔记]]');
	});
});

describe('planNotes 粒度合并', () => {
	const chapters = [
		chapter('a', 'A', 0, 'A正文'),
		chapter('b', 'B', 1, 'B正文'),
		chapter('c', 'C', 2, 'C正文'),
		chapter('d', 'D', 1, 'D正文'),
	];

	it('granularity=1：level<=1 各自成文，level 2 合并进前一个', () => {
		const { notes } = planNotes(testBook(), chapters, { granularity: 1 });
		expect(notes.map((n) => n.sources.map((s) => s.id))).toEqual([['a'], ['b', 'c'], ['d']]);
	});

	it('granularity=0：全书合成一篇（与原实现一致的特例）', () => {
		const { notes } = planNotes(testBook(), chapters, { granularity: 0 });
		expect(notes).toHaveLength(1);
		expect(notes[0].sources.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
		// 单篇时用书名作笔记名
		expect(notes[0].title).toBe('测试书');
	});

	it('granularity=2：全部各自成文', () => {
		const { notes } = planNotes(testBook(), chapters, { granularity: 2 });
		expect(notes).toHaveLength(4);
	});

	it('浅层笔记成为其下深层笔记的目录', () => {
		const { notes } = planNotes(testBook(), chapters, { granularity: 1 });
		expect(notes[0].relPath).toBe('测试书/A');
		expect(notes[1].relPath).toBe('测试书/A/B');
		expect(notes[2].relPath).toBe('测试书/A/D');
	});

	it('建立 href → 笔记 的链接映射', () => {
		const { linkMap } = planNotes(testBook(), chapters, { granularity: 1 });
		expect(linkMap.get('OEBPS/c1.xhtml')).toBe('测试书/A');
		expect(linkMap.get('c1.xhtml')).toBe('测试书/A');
	});
});

describe('ensureNoteHeading 标题注入', () => {
	it('正文完全无标题时注入 # 标题，并剥离正文首段里重复的标题文本', () => {
		// 畸形书的典型形态：标题是裸段落（甚至分两行），不是 <h1>
		const body = '01\n我要做，我不要，我想要：什么是意志力？\n\n如果叫你说出…正文开始。';
		const out = ensureNoteHeading('01 我要做，我不要，我想要：什么是意志力？', body);
		expect(out.startsWith('# 01 我要做，我不要，我想要：什么是意志力？\n\n')).toBe(true);
		expect(out).not.toContain('\n01\n我要做'); // 标题段被剥离，不重复
		expect(out).toContain('正文开始。');
	});

	it('处理全角空格差异（导　言）', () => {
		const out = ensureNoteHeading('导　言 欢迎阅读意志力入门', '导 言 欢迎阅读意志力入门\n\n内容。');
		expect(out.startsWith('# 导　言 欢迎阅读意志力入门\n\n内容。')).toBe(true);
	});

	it('正文已有 markdown 标题 → 原样返回（规整书零影响）', () => {
		const body = '## 第2章 展开\n\n正文。';
		expect(ensureNoteHeading('第2章', body)).toBe(body);
	});

	it('首段不是标题（正常开头段落）→ 只注入不剥离', () => {
		const body = '这是第一章的开头叙述，不是标题。\n\n继续。';
		const out = ensureNoteHeading('第一章', body);
		expect(out).toContain('# 第一章\n\n这是第一章的开头叙述');
	});
});

describe('writeBook 写入执行', () => {
	it('写入笔记与 MOC', async () => {
		const target = new MemoryTarget();
		const chapters = [chapter('a', '第一章', 0, '# 第一章\n\n正文')];

		const result = await writeBook({
			target,
			book: testBook(),
			chapters,
			provider: fakeProvider(),
		});

		expect(result.notes).toHaveLength(1);
		expect(result.notes[0].path).toBe('测试书/第一章.md');
		expect(result.mocPath).toBe('测试书/测试书.md');
		expect(target.read('测试书/第一章.md')).toContain('正文');
	});

	it('MOC 对同名笔记用父目录名做消歧', async () => {
		const target = new MemoryTarget();
		const result = await writeBook({
			target,
			book: testBook(),
			chapters: [
				chapter('a', '第一章', 0, 'A'),
				chapter('b', '本章总结', 1, 'B'),
				chapter('c', '第二章', 0, 'C'),
				chapter('d', '本章总结', 1, 'D'),
			],
			provider: fakeProvider(),
		});
		const moc = target.read(result.mocPath!)!;

		// 两个「本章总结」在不同目录下，别名用父目录名区分
		expect(moc).toContain('[[测试书/第一章/本章总结|第一章 / 本章总结]]');
		expect(moc).toContain('[[测试书/第二章/本章总结|第二章 / 本章总结]]');
		// 不重名的：目标保持完整路径，但展示别名是短名（用户感知不到路径）
		expect(moc).toContain('- [[测试书/第一章|第一章]]');
		expect(moc).toContain('- [[测试书/第二章|第二章]]');
	});

	it('MOC 按层级缩进，指向各笔记', async () => {
		const target = new MemoryTarget();
		const chapters = [
			chapter('a', 'A', 0, 'A'),
			chapter('b', 'B', 1, 'B'),
		];

		const result = await writeBook({ target, book: testBook(), chapters, provider: fakeProvider() });
		const moc = target.read(result.mocPath!)!;

		expect(moc).toContain('- [[测试书/A|A]]');
		expect(moc).toContain('  - [[测试书/A/B|B]]');
	});

	it('落盘图片资源（含 gif，原实现只支持 jpg/jpeg/png）', async () => {
		const target = new MemoryTarget();
		const result = await writeBook({
			target,
			book: testBook(),
			chapters: [chapter('a', '第一章', 0, '正文')],
			provider: fakeProvider(),
		});

		expect(result.assets).toContain('测试书/assets/a.png');
		expect(result.assets).toContain('测试书/assets/b.gif');
		// css 不属于资源白名单
		expect(result.assets.some((a) => a.endsWith('.css'))).toBe(false);
	});

	it('assetsVaultPath 模板可把附件放到书根之外（含 {{bookName}} 展开）', async () => {
		const target = new MemoryTarget();
		const result = await writeBook({
			target,
			book: testBook(),
			chapters: [chapter('a', '第一章', 0, '正文')],
			provider: fakeProvider(),
			opts: { assetsVaultPath: '{{savePath}}/附件库/{{bookName}}' },
		});

		expect(result.assets).toContain('附件库/测试书/a.png');
		expect(target.binaries.has('附件库/测试书/a.png')).toBe(true);
		expect(target.binaries.has('测试书/assets/a.png')).toBe(false);
	});

	it('assetsVaultPath 支持 {{savePath}}/../ 上跳（离开书所在子目录、共享同级附件目录）', async () => {
		const target = new MemoryTarget();
		const result = await writeBook({
			target,
			book: testBook(),
			chapters: [chapter('a', '第一章', 0, '正文')],
			provider: fakeProvider(),
			opts: { savePath: 'Books/甲', assetsVaultPath: '{{savePath}}/../_附件/{{bookName}}' },
		});

		expect(result.assets).toContain('Books/_附件/测试书/a.png');
		expect(target.binaries.has('Books/_附件/测试书/a.png')).toBe(true);
	});

	it('copyAssets=false 时不落盘', async () => {
		const target = new MemoryTarget();
		const result = await writeBook({
			target,
			book: testBook(),
			chapters: [chapter('a', '第一章', 0, '正文')],
			provider: fakeProvider(),
			opts: { copyAssets: false },
		});
		expect(result.assets).toHaveLength(0);
	});

	it('写入 frontmatter', async () => {
		const target = new MemoryTarget();
		await writeBook({
			target,
			book: testBook(),
			chapters: [chapter('a', '第一章', 0, '正文')],
			provider: fakeProvider(),
			opts: { frontmatter: { tags: ['epub', 'book'] } },
		});

		const content = target.read('测试书/第一章.md')!;
		expect(content.startsWith('---\n')).toBe(true);
		expect(content).toContain('tags:\n  - epub\n  - book');
		// 自动带上书籍元信息
		expect(content).toContain('title: 测试书');
		expect(content).toContain('author:\n  - 作者A\n  - 作者B');
	});

	it('书级属性 mocFrontmatter 只落在 MOC 上，不污染每篇笔记', async () => {
		const target = new MemoryTarget();
		const result = await writeBook({
			target,
			book: testBook(),
			chapters: [chapter('a', '第一章', 0, '正文')],
			provider: fakeProvider(),
			opts: { mocFrontmatter: { tags: ['book'] } },
		});

		const note = target.read('测试书/第一章.md')!;
		expect(note).toContain('title: 测试书');
		expect(note).not.toContain('tags:');

		const moc = target.read(result.mocPath!)!;
		expect(moc).toContain('tags:\n  - book');
		expect(moc).toContain('title: 测试书');
	});

	it('笔记模板可引用 {{content}} {{title}} {{prev}} {{next}}', async () => {
		const target = new MemoryTarget();
		await writeBook({
			target,
			book: testBook(),
			chapters: [chapter('a', '第一章', 0, '正文A'), chapter('b', '第二章', 0, '正文B')],
			provider: fakeProvider(),
			opts: { noteTemplate: '# {{title}}\n\n{{content}}\n\n上一章: {{prev}} / 下一章: {{next}}' },
		});

		const first = target.read('测试书/第一章.md')!;
		expect(first).toContain('# 第一章');
		expect(first).toContain('正文A');
		expect(first).toContain('下一章: 第二章');
	});

	it('重名自动加 (1)', async () => {
		const target = new MemoryTarget();
		await writeBook({
			target,
			book: testBook(),
			chapters: [chapter('a', '同名', 0, '一'), chapter('b', '同名', 0, '二')],
			provider: fakeProvider(),
		});

		expect(target.read('测试书/同名.md')).toContain('一');
		expect(target.read('测试书/同名 (1).md')).toContain('二');
	});

	it('目录已存在且 onExisting=abort 时记 fatal 并中止', async () => {
		const target = new MemoryTarget();
		await target.createFolder('测试书');
		const diags = testBook().diagnostics;

		const result = await writeBook({
			target,
			book: testBook(),
			chapters: [chapter('a', '第一章', 0, '正文')],
			provider: fakeProvider(),
			diags,
		});

		expect(result.notes).toHaveLength(0);
		expect(diags.some((d) => d.code === 'write-folder-exists' && d.severity === 'fatal')).toBe(true);
	});

	it('onExisting=overwrite 时先清空再写', async () => {
		const target = new MemoryTarget();
		await target.write('测试书/旧文件.md', '旧内容');

		const result = await writeBook({
			target,
			book: testBook(),
			chapters: [chapter('a', '第一章', 0, '正文')],
			provider: fakeProvider(),
			opts: { onExisting: 'overwrite' },
		});

		expect(target.read('测试书/旧文件.md')).toBeUndefined();
		expect(result.notes).toHaveLength(1);
	});

	it('shouldCancel 中断后保留已写入内容', async () => {
		const target = new MemoryTarget();
		const result = await writeBook({
			target,
			book: testBook(),
			chapters: [
				chapter('a', 'A', 0, 'A'),
				chapter('b', 'B', 0, 'B'),
				chapter('c', 'C', 0, 'C'),
			],
			provider: fakeProvider(),
		opts: { shouldCancel: () => true },
	});

	expect(result.cancelled).toBe(true);
	expect(result.notes).toHaveLength(0);
	});

	it('正文引用但 manifest 未声明的图片也会落盘（封面兜底）', async () => {
		const target = new MemoryTarget();
		const book = testBook();
		book.manifest = []; // 清空 manifest：模拟封面只在 HTML <img>，OPF 漏声明
		const result = await writeBook({
			target,
			book,
			// markdown 含 ![](...) 才触发兜底扫描；链接目标本身不影响落地
			chapters: [chapter('a', '第一章', 0, '![封面](测试书/assets/cover.jpg)')],
			provider: {
				has: () => true,
				readText: async (href) =>
					href === 'OEBPS/c1.xhtml' ? '<img src="../images/cover.jpg">' : undefined,
				readBinary: async (href) =>
					href === 'images/cover.jpg' ? Buffer.from([1, 2, 3]) : undefined,
			},
			opts: { onExisting: 'overwrite' },
		});

		// 落地文件名必须与转换层一致：取 src 最后一段
		expect(result.assets).toContain('测试书/assets/cover.jpg');
		expect(target.binaries.get('测试书/assets/cover.jpg')).toBeDefined();
	});

	it('onProgress 按阶段回调', async () => {
		const target = new MemoryTarget();
		const phases: string[] = [];
		await writeBook({
			target,
			book: testBook(),
			chapters: [chapter('a', '第一章', 0, '正文')],
			provider: fakeProvider(),
			opts: { onProgress: (p) => phases.push(p.phase) },
		});

		expect(phases).toContain('assets');
		expect(phases).toContain('notes');
		expect(phases).toContain('moc');
		expect(phases.at(-1)).toBe('done');
	});

	it('正文里的 EPUB 内链被重写为笔记链接', async () => {
		const target = new MemoryTarget();
		await writeBook({
			target,
			book: testBook(),
			chapters: [
				chapter('a', '第一章', 0, '见第一章'),
				chapter('b', '第二章', 0, '回看 [[OEBPS/c1.xhtml|第一章]]'),
			],
			provider: fakeProvider(),
		});

		expect(target.read('测试书/第二章.md')).toContain('[[测试书/第一章|第一章]]');
	});

	it('verbose=true 时输出 debug 级诊断（plan-summary / write-summary）', async () => {
		const target = new MemoryTarget();
		const diags: Diagnostic[] = [];
		const result = await writeBook({
			target,
			book: testBook(),
			chapters: [chapter('a', '第一章', 0, '正文')],
			provider: fakeProvider(),
			opts: { verbose: true },
			diags,
		});

		expect(result.diagnostics).toBe(diags);
		expect(diags.some((d) => d.code === 'plan-summary' && d.severity === 'debug')).toBe(true);
		expect(diags.some((d) => d.code === 'write-summary' && d.severity === 'debug')).toBe(true);
	});

	it('verbose=false 时不输出任何 debug 级诊断', async () => {
		const target = new MemoryTarget();
		const diags: Diagnostic[] = [];
		await writeBook({
			target,
			book: testBook(),
			chapters: [chapter('a', '第一章', 0, '正文')],
			provider: fakeProvider(),
			opts: { verbose: false },
			diags,
		});

		expect(diags.some((d) => d.severity === 'debug')).toBe(false);
	});
});

describe('transformChapters verbose', () => {
	it('verbose=true 时输出 transform-summary debug 诊断', () => {
		const diags: Diagnostic[] = [];
		transformChapters(
			[{ id: 'a', title: '第一章', level: 0, fileHref: 'OEBPS/c1.xhtml', html: '<p>正文</p>' }],
			{ verbose: true },
			diags,
		);
		expect(diags.some((d) => d.code === 'transform-summary' && d.severity === 'debug')).toBe(true);
	});

	it('verbose=false 时不输出任何 debug 级诊断', () => {
		const diags: Diagnostic[] = [];
		transformChapters(
			[{ id: 'a', title: '第一章', level: 0, fileHref: 'OEBPS/c1.xhtml', html: '<p>正文</p>' }],
			{ verbose: false },
			diags,
		);
		expect(diags.some((d) => d.severity === 'debug')).toBe(false);
	});
});

describe('路径工具', () => {
	it('joinPath 忽略空段并统一分隔符', () => {
		expect(joinPath('a/', '/b', '', 'c')).toBe('a/b/c');
		expect(joinPath('', 'a')).toBe('a');
		expect(joinPath()).toBe('');
	});

	it('extOf / basenameOf', () => {
		expect(extOf('a/b.PNG')).toBe('png');
		expect(basenameOf('a\\b/c.png')).toBe('c.png');
	});

	it('uniquePath 跳过已占用的名字', async () => {
		const target = new MemoryTarget();
		await target.write('a.md', 'x');
		expect(await uniquePath(target, 'a.md')).toBe('a (1).md');
	});
});

describe('normalizeDate', () => {
	it('ISO 日期时间规整为仅日期部分', () => {
		expect(normalizeDate('2013-04-08T23:00:00+00:00')).toBe('2013-04-08');
		expect(normalizeDate('2013-04-08 23:00:00')).toBe('2013-04-08');
	});

	it('纯日期 / 年份 / 空值原样返回', () => {
		expect(normalizeDate('2013-04-08')).toBe('2013-04-08');
		expect(normalizeDate('2013')).toBe('2013');
		expect(normalizeDate('')).toBe('');
		expect(normalizeDate(undefined)).toBe('');
	});
});
