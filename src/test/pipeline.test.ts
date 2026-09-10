/**
 * 端到端流水线单测：EPUB → Book → ChapterContent[] → Markdown。
 * 验证 parse / slice / transform 三层串起来后行为正确，
 * 且「不静默丢内容」原则在整条链路上成立。
 */

import JSZip from 'jszip';
import { epubToMarkdown } from '../index';
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
    <dc:title>パイプライン本</dc:title>
    <dc:creator>著者</dc:creator>
    <dc:language>ja</dc:language>
    <dc:identifier id="bookid">urn:uuid:abcd</dc:identifier>
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
  <ul><li>一</li><li>二<ul><li>二の一</li></ul></li></ul>
</body>
</html>`;

const C2 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第2章</title></head>
<body>
  <h1 id="c2h">第2章</h1>
  <p>本文<a href="#fn1">[1]</a>と<a href="c1.xhtml">第1章</a>へのリンク。</p>
  <table><tr><th>名</th><th>値</th></tr><tr><td>a</td><td>1</td></tr></table>
  <p><img src="https://example.com/x.png" alt="遠隔"/></p>
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

const codesOf = (diags: Diagnostic[]) => diags.map((d) => d.code);

describe('epubToMarkdown 端到端', () => {
	it('解析 → 切分 → 转换，产出两章 Markdown', async () => {
		const buf = await buildEpub();
		const result = await epubToMarkdown(buf);

		expect(result.ok).toBe(true);
		expect(result.book.metadata.title).toBe('パイプライン本');
		expect(result.chapters).toHaveLength(2);
		expect(result.markdown).toHaveLength(2);
		expect(result.markdown.map((c) => c.title)).toEqual(['第1章', '第2章']);
	});

	it('ruby 注音默认转为 日本語（にほんご）', async () => {
		const buf = await buildEpub();
		const { markdown } = await epubToMarkdown(buf);
		expect(markdown[0].markdown).toContain('日本語（にほんご）');
	});

	it('rubyFormat 选项透传到转换层', async () => {
		const buf = await buildEpub();
		const { markdown } = await epubToMarkdown(buf, { transform: { rubyFormat: 'brace' } });
		expect(markdown[0].markdown).toContain('{日本語|にほんご}');
	});

	it('图片路径重写到 assets 目录', async () => {
		const buf = await buildEpub();
		const { markdown } = await epubToMarkdown(buf);
		expect(markdown[0].markdown).toContain('![図](assets/a.png)');
	});

	it('嵌套列表缩进正确', async () => {
		const buf = await buildEpub();
		const { markdown } = await epubToMarkdown(buf);
		expect(markdown[0].markdown).toContain('- 一\n- 二\n  - 二の一');
	});

	it('脚注与内部链接', async () => {
		const buf = await buildEpub();
		const { markdown } = await epubToMarkdown(buf);
		expect(markdown[1].markdown).toContain('[^1]');
		expect(markdown[1].markdown).toContain('[[c1.xhtml|第1章]]');
	});

	it('表格转 GFM', async () => {
		const buf = await buildEpub();
		const { markdown } = await epubToMarkdown(buf);
		expect(markdown[1].markdown).toContain('| 名 | 値 |');
		expect(markdown[1].markdown).toContain('| --- | --- |');
	});

	it('远程图片被丢弃并记 warning（不静默丢内容）', async () => {
		const buf = await buildEpub();
		const result = await epubToMarkdown(buf);
		expect(codesOf(result.diagnostics)).toContain('image-remote-dropped');
	});

	it('全书问题汇总在同一个 diagnostics 里', async () => {
		const buf = await buildEpub();
		const result = await epubToMarkdown(buf);
		// 解析层与转换层的诊断共用同一数组，便于一次性提示用户
		expect(result.diagnostics).toBe(result.book.diagnostics);
		expect(result.diagnostics.length).toBeGreaterThan(0);
	});
});
