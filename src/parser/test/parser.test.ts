/**
 * 新解析器骨架的 fixture 单测。
 * 不依赖任何现成 EPUB 样本：用 jszip 在内存里构造一本含日语 Ruby 注音的 EPUB，
 * 验证 parseEpub + sliceBook 正确产出 Book，且锚点切分不静默丢内容（issue #170）。
 */

import JSZip from 'jszip';
import { parseEpub, sliceBook } from '../index';
import { ZipArchiveReader } from '../ArchiveReader';

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>日本語テスト小説</dc:title>
    <dc:creator opf:file-as="作者A" opf:role="aut">作者A</dc:creator>
    <dc:creator opf:file-as="作者B">作者B</dc:creator>
    <dc:language>ja</dc:language>
    <dc:identifier id="bookid">urn:uuid:1234</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chap2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>
  </manifest>
  <spine>
    <itemref idref="chap1"/>
    <itemref idref="chap2"/>
  </spine>
</package>`;

const CHAP1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第1章</title></head>
<body>
  <h1>第1章 始まり</h1>
  <p>これは<ruby>日本語<rt>にほんご</rt></ruby>のテストです。</p>
  <p>本文その一。</p>
</body>
</html>`;

const CHAP2 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第2章</title></head>
<body>
  <h1 id="sec2">第2章 展開</h1>
  <p>二章の内容A。</p>
  <h2 id="sec3">2.2 節</h2>
  <p>二章の内容B。これも落としてはいけない。</p>
</body>
</html>`;

const NAV_GOOD = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目次</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="chap1.xhtml">第1章</a></li>
      <li><a href="chap2.xhtml#sec2">第2章</a>
        <ol><li><a href="chap2.xhtml#sec3">2.2 節</a></li></ol>
      </li>
    </ol>
  </nav>
</body>
</html>`;

const NAV_BAD = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目次</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="chap1.xhtml">第1章</a></li>
      <li><a href="chap2.xhtml#nope">第2章</a>
        <ol><li><a href="chap2.xhtml#sec3">2.2 節</a></li></ol>
      </li>
    </ol>
  </nav>
</body>
</html>`;

/**
 * 混合条目：同一个文件既有「无锚点」条目（第一章），又有「带锚点」条目（第一节/第二节）。
 * 这正是《自控力》实测丢失 10 个目录条目的真实形态 ——
 * 旧实现的 `entries.filter(e => e.fragment)` 会把「第一章」连同它代表的开头内容一起丢弃，
 * 而且**诊断数为 0**（静默）。
 */
const CHAP_MIXED = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第3章</title></head>
<body>
  <p>开头导语内容XYZ。</p>
  <h2 id="sec1">第一节</h2>
  <p>第一节正文。</p>
  <h2 id="sec2">第二节</h2>
  <p>第二节正文。</p>
</body>
</html>`;

const NAV_MIXED = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目次</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="chap3.xhtml">第3章</a>
        <ol>
          <li><a href="chap3.xhtml#sec1">第一节</a></li>
          <li><a href="chap3.xhtml#sec2">第二节</a></li>
        </ol>
      </li>
    </ol>
  </nav>
</body>
</html>`;

const OPF_MIXED = OPF.replace(
	'<item id="cover"',
	'<item id="chap3" href="chap3.xhtml" media-type="application/xhtml+xml"/>\n    <item id="cover"',
).replace('<itemref idref="chap2"/>', '<itemref idref="chap2"/>\n    <itemref idref="chap3"/>');

/**
 * 无主开头导语：目录锚到正文内部的两个标题，文件开头有一段真实文本
 * （如 The Economist 每个版块首页的眉题 "The world this week"）没有任何条目认领。
 */
const CHAP_PRE = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>章</title></head>
<body>
  <p>The world this week。</p>
  <h1 id="top">Politics</h1>
  <p>正文内容A。</p>
  <h2 id="sub">Subsection</h2>
  <p>正文内容B。</p>
</body>
</html>`;

const NAV_PRE = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目次</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="chap4.xhtml#top">Politics</a></li>
      <li><a href="chap4.xhtml#sub">Subsection</a></li>
    </ol>
  </nav>
</body>
</html>`;

const OPF_PRE = OPF_MIXED.replace(/chap3/g, 'chap4');

/** 两个条目都指向不存在的锚点 —— 触发「全部定位失败」的整文件兜底 */
const NAV_DEAD = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目次</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="chap4.xhtml#zzz">假标题A</a></li>
      <li><a href="chap4.xhtml#yyy">假标题B</a></li>
    </ol>
  </nav>
</body>
</html>`;

/**
 * 没有任何标题的正文：死锚点条目连 L3（保序配标题）都无从谈起，
 * 才会真正落入「全部定位失败 → 整文件兜底」分支。
 */
const CHAP_PLAIN = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>章</title></head>
<body>
  <p>正文甲。导语也在这里。</p>
  <p>正文乙。</p>
</body>
</html>`;

async function buildEpub(
	navXml: string,
	extra?: { opf?: string; files?: Record<string, string> },
): Promise<Buffer> {
	const zip = new JSZip();
	zip.file('mimetype', 'application/epub+zip');
	zip.folder('META-INF')!.file('container.xml', CONTAINER);
	const oebps = zip.folder('OEBPS')!;
	oebps.file('content.opf', extra?.opf ?? OPF);
	oebps.file('nav.xhtml', navXml);
	oebps.file('chap1.xhtml', CHAP1);
	oebps.file('chap2.xhtml', CHAP2);
	for (const [name, content] of Object.entries(extra?.files ?? {})) {
		oebps.file(name, content);
	}
	oebps.file('cover.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
	return zip.generateAsync({ type: 'nodebuffer' });
}

describe('parseEpub 结构解析', () => {
	it('正确解析 OPF 元数据 / manifest / spine / nav（含多作者与 cover 双策略）', async () => {
		const buf = await buildEpub(NAV_GOOD);
		const book = await parseEpub(buf);

		expect(book.version).toBe('3.0');
		expect(book.metadata.title).toBe('日本語テスト小説');
		expect(book.metadata.creators).toHaveLength(2);
		expect(book.metadata.creators[0]).toMatchObject({ name: '作者A', fileAs: '作者A', role: 'aut' });
		expect(book.metadata.creators[1].name).toBe('作者B');
		expect(book.metadata.language).toBe('ja');
		expect(book.uniqueIdentifier).toBe('urn:uuid:1234');

		const ids = book.manifest.map((m) => m.id).sort();
		expect(ids).toEqual(['chap1', 'chap2', 'cover', 'nav']);
		expect(book.coverItem?.id).toBe('cover');
		expect(book.spine.map((s) => s.idref)).toEqual(['chap1', 'chap2']);

		expect(book.nav).toHaveLength(3);
		expect(book.nav[0]).toMatchObject({ label: '第1章', level: 0, fileHref: 'OEBPS/chap1.xhtml', manifestId: 'chap1' });
		expect(book.nav[1]).toMatchObject({ label: '第2章', level: 0, fileHref: 'OEBPS/chap2.xhtml', fragment: 'sec2', manifestId: 'chap2' });
		expect(book.nav[2]).toMatchObject({ label: '2.2 節', level: 1, fileHref: 'OEBPS/chap2.xhtml', fragment: 'sec3', manifestId: 'chap2' });

		expect(book.diagnostics.filter((d) => d.severity === 'fatal')).toHaveLength(0);
	});
});

describe('tocNormalize 退化根提升', () => {
	// 目录顶层只有一个「导言」，把整本书都嵌在它下面（转换工具的经典写坏模式）
	const NAV_BADROOT = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目次</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="d0.xhtml">导言</a>
        <ol>
          <li><a href="d1a.xhtml">引语节一</a></li>
          <li><a href="d1b.xhtml">引语节二</a></li>
          <li><a href="ch1.xhtml">第1章</a>
            <ol>
              <li><a href="c1s1.xhtml">1.1</a></li>
              <li><a href="c1s2.xhtml">1.2</a></li>
            </ol>
          </li>
          <li><a href="ch2.xhtml">第2章</a>
            <ol><li><a href="c2s1.xhtml">2.1</a></li></ol>
          </li>
          <li><a href="end.xhtml">结语</a></li>
          <li><a href="ack.xhtml">鸣谢</a></li>
        </ol>
      </li>
    </ol>
  </nav>
</body>
</html>`;

	const mkOpf = (items: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>导言测试书</dc:title>
    <dc:language>ja</dc:language>
    <dc:identifier id="bookid">urn:uuid:tocroot</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${items.map((id) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine>
    <itemref idref="${items[0]}"/>
  </spine>
</package>`;

	it('★ 退化根（顶层仅 1 项）：把首个带子树的 D1 起的后缀提升为顶层', async () => {
		const buf = await buildEpub(NAV_BADROOT, {
			opf: mkOpf(['d0', 'd1a', 'd1b', 'ch1', 'c1s1', 'c1s2', 'ch2', 'c2s1', 'end', 'ack']),
		});
		const book = await parseEpub(buf);

		// 修复前应是 [0,1,1,1,2,2,1,2,1,1]（全书嵌在导言下）
		// 修复后：导言的引语节(1)仍留在其下；第1章起(含子树)的连续后缀提升为顶层
		const levels = book.nav.map((e) => e.level);
		expect(levels).toEqual([0, 1, 1, 0, 1, 1, 0, 1, 0, 0]);
		// 提升名单里应有章节与结语/鸣谢
		const labels = book.nav.slice(3).map((e) => e.label);
		expect(labels[0]).toBe('第1章');
		expect(labels).toContain('结语');
		expect(labels).toContain('鸣谢');
		// 不静默：显式诊断
		const diag = book.diagnostics.find((d) => d.code === 'toc-normalized');
		expect(diag).toBeDefined();
		expect(diag?.data).toMatchObject({ before: { 0: 1, 1: 6, 2: 3 }, after: { 0: 5, 1: 5 } });
	});

	it('正常目录（多顶层）零影响，且可显式关闭', async () => {
		// NAV_GOOD：第1章、第2章都是顶层 → 不触发
		const good = await parseEpub(await buildEpub(NAV_GOOD));
		expect(good.nav.map((e) => e.level)).toEqual([0, 0, 1]);
		expect(good.diagnostics.some((d) => d.code === 'toc-normalized')).toBe(false);

		// 畸形书显式关闭 → 保持原样
		const raw = await parseEpub(await buildEpub(NAV_BADROOT, {
			opf: mkOpf(['d0', 'd1a', 'd1b', 'ch1', 'c1s1', 'c1s2', 'ch2', 'c2s1', 'end', 'ack']),
		}), { normalizeToc: false });
		expect(raw.nav.map((e) => e.level)).toEqual([0, 1, 1, 1, 2, 2, 1, 2, 1, 1]);
		expect(raw.diagnostics.some((d) => d.code === 'toc-normalized')).toBe(false);
	});
});

describe('sliceBook 锚点切分', () => {
	it('按锚点切分且不静默丢内容（回归 issue #170）', async () => {
		const buf = await buildEpub(NAV_GOOD);
		const book = await parseEpub(buf);
		const reader = new ZipArchiveReader(buf);
		await reader.open();
		const chapters = await sliceBook(book, reader);

		// chap1 整文件 + chap2 两段 = 3 章
		expect(chapters).toHaveLength(3);

		const chap1 = chapters.find((c) => c.fileHref === 'OEBPS/chap1.xhtml');
		expect(chap1?.html).toContain('にほんご'); // 日语 Ruby 注音被保留

		const sec2 = chapters.find((c) => c.fragment === 'sec2');
		const sec3 = chapters.find((c) => c.fragment === 'sec3');
		expect(sec2?.html).toContain('二章の内容A。'); // 锚点之间的内容不丢
		expect(sec3?.html).toContain('これも落としてはいけない。'); // 末段内容不丢
		// 没有任何锚点片段是空的
		for (const c of chapters) {
			if (c.fragment) expect(c.html.trim().length).toBeGreaterThan(0);
		}
	});

	it('锚点不存在时显式上报，且内容守恒（不塌缩、不静默丢弃）', async () => {
		const buf = await buildEpub(NAV_BAD);
		const book = await parseEpub(buf);
		const reader = new ZipArchiveReader(buf);
		await reader.open();
		const chapters = await sliceBook(book, reader);

		// 新实现不再「整文件回退」，而是用 L2 标题匹配恢复出「第2章」——
		// 因此 chap2 产出 2 段。这里断言的**不是段数**，而是守恒：
		// chap2 的所有片段拼起来必须覆盖正文里的每一个关键内容。
		const chap2 = chapters.filter((c) => c.fileHref === 'OEBPS/chap2.xhtml');
		expect(chap2.length).toBeGreaterThan(0);
		const joined = chap2.map((c) => c.html).join('\n');
		for (const needle of ['第2章 展開', '二章の内容A。', '2.2 節', 'これも落としてはいけない。']) {
			expect(joined).toContain(needle); // 内容未丢（守恒）
		}
		// 任何片段都不能是空的
		for (const c of chap2) expect(c.html.trim().length).toBeGreaterThan(0);

		// 「声明了锚点但找不到」必须显式上报，不能静默
		expect(book.diagnostics.some((d) => d.code === 'anchor-missing-fallback')).toBe(true);
	});

	it('★ 混合条目（无锚点 + 锚点）：开头内容不丢，无锚点条目不静默消失', async () => {
		const buf = await buildEpub(NAV_MIXED, {
			opf: OPF_MIXED,
			files: { 'chap3.xhtml': CHAP_MIXED },
		});
		const book = await parseEpub(buf);
		const reader = new ZipArchiveReader(buf);
		await reader.open();
		const chapters = await sliceBook(book, reader);

		const parts = chapters.filter((c) => c.fileHref === 'OEBPS/chap3.xhtml');
		const joined = parts.map((c) => c.html).join('\n');

		// 1) 守恒：开头那句「导语」必须还在（旧实现会把它丢掉）
		expect(joined).toContain('开头导语内容XYZ。');
		// 2) 全部正文都在
		for (const needle of ['第一节', '第一节正文。', '第二节', '第二节正文。']) {
			expect(joined).toContain(needle);
		}
		// 3) 无锚点的「第3章」必须作为一篇产出，而不是凭空消失
		expect(parts.some((c) => c.title === '第3章')).toBe(true);
		// 4) 三个条目 → 三段，且每段非空
		expect(parts).toHaveLength(3);
		for (const c of parts) expect(c.html.trim().length).toBeGreaterThan(0);
	});

	it('★ 无主开头导语并入首章：不产孤岛笔记，内容守恒', async () => {
		const buf = await buildEpub(NAV_PRE, {
			opf: OPF_PRE,
			files: { 'chap4.xhtml': CHAP_PRE },
		});
		const book = await parseEpub(buf);
		const reader = new ZipArchiveReader(buf);
		await reader.open();
		const chapters = await sliceBook(book, reader);

		const parts = chapters.filter((c) => c.fileHref === 'OEBPS/chap4.xhtml');
		// 1) 两条目 → 两篇，没有标题为「(文件开头)」的孤岛笔记
		expect(parts).toHaveLength(2);
		expect(parts[0].title).toBe('Politics');
		expect(chapters.some((c) => c.title === '(文件开头)')).toBe(false);
		// 2) 导语并入首章 —— 内容守恒且可见
		expect(parts[0].html).toContain('The world this week。');
		expect(parts[0].html).toContain('正文内容A。');
		expect(parts[1].html).toContain('正文内容B。');
		// 3) 并入动作不是静默的：以 info 溯源
		expect(book.diagnostics.some((d) => d.code === 'head-preamble')).toBe(true);
	});

	it('★ 全部条目定位失败：整文件兜底但标题用首个条目命名，而非占位符', async () => {
		const buf = await buildEpub(NAV_DEAD, {
			opf: OPF_PRE,
			files: { 'chap4.xhtml': CHAP_PLAIN },
		});
		const book = await parseEpub(buf);
		const reader = new ZipArchiveReader(buf);
		await reader.open();
		const chapters = await sliceBook(book, reader);

		const parts = chapters.filter((c) => c.fileHref === 'OEBPS/chap4.xhtml');
		// 无标题正文里两个死锚点无从恢复 → 整文件一篇；标题用第一个目录条目
		expect(parts).toHaveLength(1);
		expect(parts[0].title).toBe('假标题A');
		expect(chapters.some((c) => c.title === '(文件开头)' || c.title === '(整文件)')).toBe(false);
		// 内容守恒
		for (const needle of ['正文甲。导语也在这里。', '正文乙。']) {
			expect(parts[0].html).toContain(needle);
		}
		// 定位失败必须显式上报，绝不静默
		expect(book.diagnostics.some((d) => d.code === 'entry-unassigned')).toBe(true);
		expect(book.diagnostics.some((d) => d.code === 'anchor-missing-fallback')).toBe(true);
	});

	it('★ spine 孤儿文档：未入目录的正文并入前一章节，卷首孤儿独立产出，绝不静默', async () => {
		// 模拟真实书（《自控力》实测）的结构：
		//   书名页(孤儿) → 章A 标题页(被目录引用) → 章A 正文页(孤儿!) → 章B(被引用)
		// 旧框架：spine 里未被 nav 引用的 章A正文页 整体静默丢失（约 8 千字/10 处）。
		const OPF_ORPHAN = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>示例书</dc:title>
    <dc:language>ja</dc:language>
    <dc:identifier id="bookid">urn:uuid:orphan</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="coverx" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch0" href="ch0.xhtml" media-type="application/xhtml+xml"/>
    <item id="chm" href="chm.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="coverx"/>
    <itemref idref="ch0"/>
    <itemref idref="chm"/>
    <itemref idref="ch1"/>
  </spine>
</package>`;
		const NAV_ORPHAN = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目次</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="ch0.xhtml">章A</a></li>
      <li><a href="ch1.xhtml">章B</a></li>
    </ol>
  </nav>
</body>
</html>`;
		const files = {
			'cover.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>示例书</p></body></html>`,
			'ch0.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><h1 id="a">章A</h1><p>章A的标题页正文。</p></body></html>`,
			// 孤儿：真实正文在「标题页」的下一个文件，目录根本没指向它
			'chm.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>★章A的开篇正文，未入目录，绝不能丢。</p></body></html>`,
			'ch1.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><h1 id="b">章B</h1><p>章B正文。</p></body></html>`,
		};
		const buf = await buildEpub(NAV_ORPHAN, { opf: OPF_ORPHAN, files });
		const book = await parseEpub(buf);
		const reader = new ZipArchiveReader(buf);
		await reader.open();
		const chapters = await sliceBook(book, reader);

		// 1) 卷首孤儿（书名页）→ 独立顶层笔记
		const cover = chapters.find((c) => c.fileHref === 'OEBPS/cover.xhtml');
		expect(cover).toBeDefined();
		expect(cover?.title).toBe('书名页');
		expect(cover?.level).toBe(0);
		// 2) 中段孤儿正文并入前一章节（章A），阅读顺序保持：先标题页正文，后开篇正文
		const chA = chapters.find((c) => c.fileHref === 'OEBPS/ch0.xhtml');
		expect(chA?.html).toContain('章A的标题页正文。');
		expect(chA?.html).toContain('★章A的开篇正文，未入目录，绝不能丢。');
		expect(chA?.html.indexOf('章A的标题页正文')).toBeLessThan(
			chA!.html.indexOf('★章A的开篇正文'),
		);
		// 3) 章B 不受污染
		const chB = chapters.find((c) => c.fileHref === 'OEBPS/ch1.xhtml');
		expect(chB?.html).toContain('章B正文。');
		expect(chB?.html).not.toContain('★章A的开篇正文');
		// 4) 并入/独立都不静默：显式诊断
		expect(book.diagnostics.some((d) => d.code === 'spine-orphan-merged')).toBe(true);
		expect(book.diagnostics.some((d) => d.code === 'spine-orphan-front')).toBe(true);
	});
});
