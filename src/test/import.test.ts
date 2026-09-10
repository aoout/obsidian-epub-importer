/**
 * 端到端导入单测：真实 EPUB → MemoryTarget。
 *
 * 最关键的一条断言是**图片路径一致性**：正文里的图片链接
 * 必须指向真正落盘的那个文件（转换层写链接、Writer 落盘，两处规则必须一致）。
 */

import JSZip from 'jszip';
import { MemoryTarget } from '../writer/targets';
import { importEpubToVault } from '../writer/index';
import type { Diagnostic } from '../parser/types';

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>導入テスト</dc:title>
    <dc:creator>著者</dc:creator>
    <dc:language>ja</dc:language>
    <dc:identifier id="bookid">urn:uuid:1111</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
    <item id="img1" href="images/a.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`;

const C1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第1章</title></head>
<body>
  <h1 id="c1h">第1章</h1>
  <p>これは<ruby>日本語<rt>にほんご</rt></ruby>です。</p>
  <p><img src="images/a.png" alt="図"/></p>
</body>
</html>`;

const C2 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第2章</title></head>
<body>
  <h1 id="c2h">第2章</h1>
  <p>二章の本文。[[link]] ではなく <a href="c1.xhtml">第1章</a> へ。</p>
</body>
</html>`;

const NAV = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目次</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="c1.xhtml#c1h">第1章</a></li>
      <li><a href="c2.xhtml#c2h">第2章</a></li>
    </ol>
  </nav>
</body>
</html>`;

async function buildEpub(): Promise<Buffer> {
	const zip = new JSZip();
	zip.file('mimetype', 'application/epub+zip');
	zip.folder('META-INF')!.file('container.xml', CONTAINER);
	const oebps = zip.folder('OEBPS')!;
	oebps.file('content.opf', OPF);
	oebps.file('nav.xhtml', NAV);
	oebps.file('c1.xhtml', C1);
	oebps.file('c2.xhtml', C2);
	oebps.file('images/a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
	return zip.generateAsync({ type: 'nodebuffer' });
}

const codesOf = (d: Diagnostic[]) => d.map((x) => x.code);

describe('importEpubToVault 端到端', () => {
	it('写入全部笔记、MOC 与图片资源', async () => {
		const buf = await buildEpub();
		const target = new MemoryTarget();

		const result = await importEpubToVault(buf, target, {
			write: { savePath: 'Books' },
		});

		expect(result.bookPath).toBe('Books/導入テスト');
		expect(result.notes).toHaveLength(2);
		expect(result.notes.map((n) => n.path)).toEqual([
			'Books/導入テスト/第1章.md',
			'Books/導入テスト/第2章.md',
		]);
		expect(result.mocPath).toBe('Books/導入テスト/導入テスト.md');
		expect(result.assets).toEqual(['Books/導入テスト/assets/a.png']);
	});

	it('正文里的图片链接指向真正落盘的文件（路径一致性）', async () => {
		const buf = await buildEpub();
		const target = new MemoryTarget();

		const result = await importEpubToVault(buf, target, { write: { savePath: 'Books' } });
		const note = target.read('Books/導入テスト/第1章.md')!;

		const match = note.match(/\]\(([^)]+\.png)\)/);
		expect(match).toBeTruthy();

		const linkedPath = match![1];
		expect(linkedPath).toBe('Books/導入テスト/assets/a.png');
		// 链接指向的文件必须真的存在，否则笔记里就是一张坏图
		expect(target.binaries.has(linkedPath)).toBe(true);
		expect(result.assets).toContain(linkedPath);
	});

	it('savePath 为空时路径不带前缀', async () => {
		const buf = await buildEpub();
		const target = new MemoryTarget();

		const result = await importEpubToVault(buf, target);
		expect(result.notes[0].path).toBe('導入テスト/第1章.md');
		expect(result.assets).toEqual(['導入テスト/assets/a.png']);

		const note = target.read('導入テスト/第1章.md')!;
		expect(note).toContain('](導入テスト/assets/a.png)');
	});

	it('ruby 与笔记正文内容正确', async () => {
		const buf = await buildEpub();
		const target = new MemoryTarget();
		await importEpubToVault(buf, target, { write: { savePath: 'Books' } });

		const note = target.read('Books/導入テスト/第1章.md')!;
		expect(note).toContain('日本語（にほんご）');
		expect(note).toContain('# 第1章');
	});

	it('MOC 列出所有笔记', async () => {
		const buf = await buildEpub();
		const target = new MemoryTarget();
		const result = await importEpubToVault(buf, target, { write: { savePath: 'Books' } });

		const moc = target.read(result.mocPath!)!;
		expect(moc).toContain('- [[Books/導入テスト/第1章|第1章]]');
		expect(moc).toContain('- [[Books/導入テスト/第2章|第2章]]');
	});

	it('frontmatter 与笔记模板生效', async () => {
		const buf = await buildEpub();
		const target = new MemoryTarget();
		await importEpubToVault(buf, target, {
			write: {
				savePath: 'Books',
				frontmatter: { tags: ['epub'], source: 'test' },
				noteTemplate: '# {{title}}\n\n{{content}}',
			},
		});

		const note = target.read('Books/導入テスト/第2章.md')!;
		expect(note.startsWith('---\n')).toBe(true);
		expect(note).toContain('tags:\n  - epub');
		expect(note).toContain('author:\n  - 著者');
		expect(note).toContain('# 第2章');
	});

	it('granularity=0 时全书合成一篇（用书名命名，不生成 MOC）', async () => {
		const buf = await buildEpub();
		const target = new MemoryTarget();
		const result = await importEpubToVault(buf, target, {
			write: { savePath: 'Books', granularity: 0 },
		});

		expect(result.notes).toHaveLength(1);
		expect(result.notes[0].path).toBe('Books/導入テスト/導入テスト.md');
		// 全书一篇时再生成 MOC 只会指向自己，没有意义
		expect(result.mocPath).toBeUndefined();

		const note = target.read(result.notes[0].path)!;
		expect(note).toContain('第1章');
		expect(note).toContain('二章の本文');
	});

	it('进度回调覆盖全部阶段', async () => {
		const buf = await buildEpub();
		const target = new MemoryTarget();
		const phases: string[] = [];

		await importEpubToVault(buf, target, {
			write: { savePath: 'Books', onProgress: (p) => phases.push(p.phase) },
		});

		expect(phases).toContain('assets');
		expect(phases).toContain('notes');
		expect(phases).toContain('moc');
		expect(phases.at(-1)).toBe('done');
	});

	it('中断后只写入已处理的部分，并标记 cancelled', async () => {
		const buf = await buildEpub();
		const target = new MemoryTarget();

		const result = await importEpubToVault(buf, target, {
			write: { savePath: 'Books', shouldCancel: () => true },
		});

		expect(result.cancelled).toBe(true);
		expect(result.notes).toHaveLength(0);
	});
});
