import { transformHtml } from '../index';
import { collapseText } from '../HtmlToMarkdown';
import type { Diags } from '../../parser/types';

const md = (html: string, opts = {}, diags: Diags = []) => transformHtml(html, opts, diags).trim();

const codesOf = (diags: Diags) => diags.map((d) => d.code);

describe('块级元素', () => {
	it('标题与段落', () => {
		expect(md('<h1>一级</h1><p>段落一</p><h3>三级</h3><p>段落二</p>')).toBe(
			'# 一级\n\n段落一\n\n### 三级\n\n段落二',
		);
	});

	it('标题层级偏移 headingOffset', () => {
		expect(md('<h1>标题</h1>', { headingOffset: 2 })).toBe('### 标题');
	});

	it('引用块每行加 >', () => {
		expect(md('<blockquote><p>甲</p><p>乙</p></blockquote>')).toBe('> 甲\n>\n> 乙');
	});

	it('代码块保留原始文本与语言', () => {
		expect(md('<pre><code class="language-js">const a = 1;\nlet b = 2;</code></pre>')).toBe(
			'```js\nconst a = 1;\nlet b = 2;\n```',
		);
	});

	it('代码块内反引号会自动加长 fence', () => {
		const out = md('<pre><code>a ``` b</code></pre>');
		expect(out.startsWith('````')).toBe(true);
	});

	it('水平线', () => {
		expect(md('<p>上</p><hr/><p>下</p>')).toBe('上\n\n---\n\n下');
	});

	it('行内位置的块级元素（如 <span> 内嵌 <blockquote>）提升为块级渲染而非压平', () => {
		const diags: Diags = [];
		// 用 <span> 包住，确保是真正的行内上下文（<p> 会被 HTML 解析器在块级元素前自动闭合）
		const out = md('<span>前文<blockquote><p>引用内容</p></blockquote>后文</span>', {}, diags);
		// 引用格式保留（含 >），且周围的行内文字不丢
		expect(out).toContain('> 引用内容');
		expect(out).toContain('前文');
		expect(out).toContain('后文');
		// 引用被识别为独立块（前后空行分隔），不再并入门落段落
		expect(out).toBe('前文\n\n> 引用内容\n\n后文');
		// 仍记录该 anomaly（info 级，便于排查畸形 HTML）
		expect(codesOf(diags)).toContain('block-in-inline');
	});

	it('行内 <h2> 也提升为标题而非压平', () => {
		expect(md('<span>开头<h2>插曲标题</h2>结尾</span>')).toBe('开头\n\n## 插曲标题\n\n结尾');
	});
});

describe('列表', () => {
	it('无序列表 + 嵌套（续行按 marker 宽度缩进）', () => {
		expect(md('<ul><li>一</li><li>二<ul><li>二之一</li></ul></li></ul>')).toBe(
			'- 一\n- 二\n  - 二之一',
		);
	});

	it('有序列表递增编号', () => {
		expect(md('<ol><li>甲</li><li>乙</li><li>丙</li></ol>')).toBe('1. 甲\n2. 乙\n3. 丙');
	});
});

describe('表格', () => {
	it('多列表格：裸 tr 且首行全 th 时识别为表头', () => {
		expect(md('<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>')).toBe(
			'| a | b |\n| --- | --- |\n| 1 | 2 |',
		);
	});

	it('多列表格：thead/tbody 分组', () => {
		expect(
			md('<table><thead><tr><th>名</th><th>值</th></tr></thead><tbody><tr><td>甲</td><td>1</td></tr></tbody></table>'),
		).toBe('| 名 | 值 |\n| --- | --- |\n| 甲 | 1 |');
	});

	it('多列表格：单元格内竖线转义（无表头补空表头行）', () => {
		expect(md('<table><tr><td>a|b</td><td>c</td></tr></table>')).toBe(
			'|  |  |\n| --- | --- |\n| a\\|b | c |',
		);
	});

	it('单列表格视为排版壳：去表格化，内容按行上浮为段落', () => {
		const diags: Diags = [];
		expect(md('<table><tr><td>名</td></tr><tr><td>值</td></tr></table>', {}, diags)).toBe(
			'名\n\n值',
		);
		expect(codesOf(diags)).toContain('table-layout-denatured');
	});

	it('排版壳内嵌段落/<br> 行时不再产生表格与字面 <br>（本章总结框形态）', () => {
		const box =
			'<table><tr><td>本章总结</td></tr>' +
			'<tr><td><p>核心思想：意志力是三种力量的协同。</p></td></tr>' +
			'<tr><td><p><b>深入剖析：</b></p></td></tr>' +
			'<tr><td><p>· 更难的事是什么？<br>· 认清两个自我。</p></td></tr></table>';
		const out = md(box);
		expect(out).toBe(
			'本章总结\n\n核心思想：意志力是三种力量的协同。\n\n**深入剖析：**\n\n· 更难的事是什么？\n· 认清两个自我。',
		);
		expect(out).not.toContain('|');
		expect(out).not.toContain('<br>');
	});

	it('含 colspan 跨列时不再视为单列排版壳，按数据表保留', () => {
		expect(md('<table><tr><td colspan="2">宽</td></tr></table>')).toBe(
			'|  |\n| --- |\n| 宽 |',
		);
	});
});

describe('ruby 注音', () => {
	const ruby = '<p><ruby>日本語<rt>にほんご</rt></ruby>です。</p>';

	it('paren（默认）：日本語（にほんご）', () => {
		expect(md(ruby)).toBe('日本語（にほんご）です。');
	});

	it('brace：{日本語|にほんご}（obsidian-ruby 格式）', () => {
		expect(md(ruby, { rubyFormat: 'brace' })).toBe('{日本語|にほんご}です。');
	});

	it('html：原样保留标签', () => {
		expect(md(ruby, { rubyFormat: 'html' })).toBe('<ruby>日本語<rt>にほんご</rt></ruby>です。');
	});

	it('strip：只留基础文字', () => {
		expect(md(ruby, { rubyFormat: 'strip' })).toBe('日本語です。');
	});

	it('忽略 <rp> 括号（只用于不支持 ruby 的浏览器）', () => {
		expect(md('<p><ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby></p>')).toBe('漢字（かんじ）');
	});

	it('无 rt 时只输出基础文字', () => {
		expect(md('<p><ruby>無音</ruby></p>')).toBe('無音');
	});
});

describe('图片', () => {
	it('重写到 assets 目录并编码空格', () => {
		expect(md('<p><img src="images/fig 1.png" alt="图1"/></p>')).toBe('![图1](assets/fig%201.png)');
	});

	it('wikilink 格式', () => {
		expect(md('<p><img src="images/a.png" alt="A"/></p>', { imageFormat: 'wikilink' })).toBe(
			'![[assets/a.png]]',
		);
	});

	it('自定义 assetsPath', () => {
		expect(md('<p><img src="img/a.png"/></p>', { assetsPath: '_resources' })).toBe(
			'![](_resources/a.png)',
		);
	});

	it('路径含括号（如书名 "自控力(elib.cc)"）时 markdown 目的地编码括号，wikilink 不编码', () => {
		const html = '<p><img src="img/fig(1).png"/></p>';
		expect(md(html, { assetsPath: '自控力(elib.cc)/assets' })).toBe(
			'![](自控力%28elib.cc%29/assets/fig%281%29.png)',
		);
		expect(md(html, { assetsPath: '自控力(elib.cc)/assets', imageFormat: 'wikilink' })).toBe(
			'![[自控力(elib.cc)/assets/fig(1).png]]',
		);
	});

	it('远程图片默认丢弃，但**记 warning** 而非静默丢内容', () => {
		const diags: Diags = [];
		expect(md('<p>前<img src="https://x.com/a.png" alt="A"/>后</p>', {}, diags)).toBe('前后');
		expect(codesOf(diags)).toContain('image-remote-dropped');
	});

	it('keepRemoteImages 可保留远程图片', () => {
		expect(md('<p><img src="https://x.com/a.png" alt="A"/></p>', { keepRemoteImages: true })).toBe(
			'![A](https://x.com/a.png)',
		);
	});

	it('缺 src 时记 warning', () => {
		const diags: Diags = [];
		md('<p><img alt="A"/></p>', {}, diags);
		expect(codesOf(diags)).toContain('image-no-src');
	});
});

describe('链接与脚注', () => {
	it('内部链接转 Obsidian wikilink', () => {
		expect(md('<p><a href="chap02.xhtml">第二章</a></p>')).toBe('[[chap02.xhtml|第二章]]');
	});

	it('linkFormat=markdown 输出标准链接', () => {
		expect(md('<p><a href="chap02.xhtml">第二章</a></p>', { linkFormat: 'markdown' })).toBe(
			'[第二章](chap02.xhtml)',
		);
	});

	it('外部链接保持 Markdown 语法', () => {
		expect(md('<p><a href="https://example.com">站点</a></p>')).toBe('[站点](https://example.com)');
	});

	it('形如 [1] 的链接转 Markdown 脚注', () => {
		expect(md('<p>正文<a href="#fn1">[1]</a></p>')).toBe('正文[^1]');
	});

	it('footnotes=false 时按普通文本保留（且被转义）', () => {
		expect(md('<p>正文<a href="#fn1">[1]</a></p>', { footnotes: false })).toBe('正文\\[1\\]');
	});

	it('纯锚点链接只保留文字并记 info（切分后锚点失效）', () => {
		const diags: Diags = [];
		expect(md('<p><a href="#top">回顶</a></p>', {}, diags)).toBe('回顶');
		expect(codesOf(diags)).toContain('link-anchor-only');
	});
});

describe('CJK 空白处理（相对旧实现的关键改进）', () => {
	it('中文之间的源码换行不产生空格', () => {
		expect(md('<p>日本語\nのテスト</p>')).toBe('日本語のテスト');
	});

	it('英文之间的换行折叠为一个空格', () => {
		expect(md('<p>hello\nworld</p>')).toBe('hello world');
	});

	it('collapseText 直接对 CJK 生效', () => {
		expect(collapseText('中 文')).toBe('中文');
		expect(collapseText('中 a')).toBe('中 a');
	});
});

describe('绝不静默丢内容', () => {
	it('不支持的元素降级为纯文本并记 warning', () => {
		const diags: Diags = [];
		expect(md('<p>前<svg><text>矢量</text></svg>后</p>', {}, diags)).toBe('前矢量后');
		expect(codesOf(diags)).toContain('unsupported-inline-element');
	});

	it('script/style 静默跳过', () => {
		const diags: Diags = [];
		expect(md('<p>正文</p><script>var a=1;</script><style>p{color:red}</style>')).toBe('正文');
		expect(diags).toHaveLength(0);
	});

	it('行内标签混排时文本不丢', () => {
		expect(md('<p><strong>粗</strong><em>斜</em><code>码</code><sup>上</sup></p>')).toBe(
			'**粗***斜*`码`^上^',
		);
	});
});

describe('转义', () => {
	it('文本里的 Markdown 元字符被转义', () => {
		expect(md('<p>a *b* [c]</p>')).toBe('a \\*b\\* \\[c\\]');
	});

	it('行首的列表/标题标记被转义', () => {
		expect(md('<p>- 不是列表</p>')).toBe('\\- 不是列表');
		expect(md('<p># 不是标题</p>')).toBe('\\# 不是标题');
	});
});
