/**
 * Transformer 核心：XHTML 片段 → Obsidian 友好的 Markdown。
 *
 * 选型说明（见 docs/epub-parser-research.md §6）：
 * 文档原计划用 unified 管道，但 unified 10/11 均为纯 ESM（"type": "module"），
 * 引入会把内核整体拖入 ESM 模式，重演并放大 linkedom 已踩过的 ESM 坑。
 * 因此改用已有依赖 linkedom 自建转换器：零新增依赖、完全可控、
 * 且能把「不静默丢内容」的 diags 原则贯穿到转换层。
 *
 * 行为规范继承并修正旧实现（src/core/TurndownService.ts）：
 * - ruby → 可配置（paren/brace/html/strip），原版硬编码 {漢字|かんじ}
 * - 图片 → 路径重写到 assets 目录；远程图片默认丢弃但**记 warning**（原版静默 return ""）
 * - 脚注 → [1] 形链接转 [^1]
 * - 内链 → [[href|text]]（Obsidian wikilink）
 * - 新增：CJK 文本中的换行**不加空格**（原版会在中文字间塞入空格）
 */

import { parseHTML } from 'linkedom';
import type { Diags } from '../parser/types';
import { pushDiag } from '../parser/types';
import { resolveOptions } from './types';
import type { TransformOptions } from './types';

/** 块级元素：会产生独立的 Markdown 块 */
const BLOCK_TAGS = new Set([
	'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt',
	'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
	'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li', 'main', 'nav', 'ol',
	'p', 'pre', 'section', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul',
]);

/** 非内容元素：静默跳过，不记 diag */
const SKIP_TAGS = new Set([
	'script', 'style', 'head', 'meta', 'link', 'title', 'noscript', 'template', 'base',
]);

/** 无法用 Markdown 表达的元素：保留其文本并记 warning（绝不静默丢内容） */
const UNSUPPORTED_TAGS = new Set([
	'svg', 'iframe', 'object', 'embed', 'canvas', 'audio', 'video', 'source',
	'track', 'input', 'button', 'select', 'textarea', 'map', 'area', 'param',
	'applet', 'frame', 'frameset', 'math',
]);

/** CJK 字符范围（中日韩 + 全角符号 + 假名） */
const CJK = '\\u2e80-\\u9fff\\u3000-\\u303f\\uf900-\\ufaff\\uff00-\\uffef';
const CJK_SPACE_RE = new RegExp(`(?<=[${CJK}]) (?=[${CJK}])`, 'g');

/** 递归深度上限，防御病态嵌套 */
const MAX_DEPTH = 32;

/**
 * 折叠空白。
 * 关键细节：CJK 字符之间的空白直接删除——中文/日文不用空格分词，
 * HTML 源码换行若折叠成空格，会在字与字之间塞入多余空格（旧实现的问题）。
 */
export function collapseText(s: string): string {
	let out = String(s ?? '').replace(/\s+/g, ' ');
	out = out.replace(CJK_SPACE_RE, '');
	return out;
}

/** 行内文本转义：避免文本被误解析成 Markdown 语法 */
export function escapeInline(text: string): string {
	return String(text ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/([`*_[\]])/g, '\\$1')
		// 行首的标题/列表/引用标记
		.replace(/^(\s*)(#{1,6})(\s|$)/gm, '$1\\$2$3')
		.replace(/^(\s*)([-+*])(\s+)/gm, '$1\\$2$3')
		.replace(/^(\s*)(\d+)\.(\s+)/gm, '$1$2\\.$3')
		.replace(/^(\s*)(>)(\s*)/gm, '$1\\>$3');
}

function tagOf(node: any): string {
	return String(node?.nodeName ?? '').toLowerCase();
}

function childNodesOf(node: any): any[] {
	return Array.from(node?.childNodes ?? []) as any[];
}

function childElementsOf(node: any): any[] {
	return Array.from(node?.children ?? []) as any[];
}

export class HtmlToMarkdown {
	private readonly opts: Required<TransformOptions>;
	private readonly diags: Diags;
	private depth = 0;

	constructor(opts: TransformOptions = {}, diags: Diags = []) {
		this.opts = resolveOptions(opts);
		this.diags = diags;
	}

	/** 把一个 XHTML 片段（章节 html）转成 Markdown */
	convert(html: string): string {
		const { document } = parseHTML(`<!doctype html><html><body>${html ?? ''}</body></html>`);
		const root = document.body ?? document.documentElement;
		this.depth = 0;
		const blocks = this.blocks(root);
		const md = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
		return md ? `${md}\n` : '';
	}

	// ---------------------------------------------------------------- 块级

	/** 遍历子节点，产出连续的块；行内节点会被合并成段落 */
	private blocks(parent: any): string[] {
		if (this.depth++ > MAX_DEPTH) {
			pushDiag(this.diags, 'warning', 'HTML 嵌套过深，已降级为纯文本', { code: 'html-too-deep' });
			const t = collapseText(parent?.textContent ?? '');
			return t.trim() ? [escapeInline(t.trim())] : [];
		}
		try {
			const out: string[] = [];
			let inlineBuf: string[] = [];
			const flushInline = () => {
				const joined = inlineBuf.join('');
				inlineBuf = [];
				const t = joined.trim();
				if (t) out.push(t);
			};

			for (const node of childNodesOf(parent)) {
				const type = node.nodeType;
				// 注释 / 处理指令：跳过
				if (type === 8 || type === 7) continue;
				if (type === 3) {
					const t = collapseText(node.nodeValue ?? '');
					if (t.trim()) inlineBuf.push(escapeInline(t));
					continue;
				}
				if (type !== 1) continue;

				const tag = tagOf(node);
				if (SKIP_TAGS.has(tag)) continue;

				if (BLOCK_TAGS.has(tag) || UNSUPPORTED_TAGS.has(tag)) {
					flushInline();
					for (const b of this.block(node)) if (b) out.push(b);
				} else {
					const s = this.inline(node);
					if (s) inlineBuf.push(s);
				}
			}
			flushInline();
			return out;
		} finally {
			this.depth--;
		}
	}

	/** 单个块级元素 → 0..n 个 Markdown 块 */
	private block(node: any): string[] {
		const tag = tagOf(node);

		if (UNSUPPORTED_TAGS.has(tag)) {
			pushDiag(this.diags, 'warning', `不支持的元素 <${tag}>，已降级为纯文本`, {
				code: 'unsupported-element',
				data: tag,
			});
			const t = collapseText(node.textContent ?? '').trim();
			return t ? [escapeInline(t)] : [];
		}

		switch (tag) {
			case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
				const n = Number(tag.slice(1));
				const level = Math.min(6, Math.max(1, n + this.opts.headingOffset));
				const text = this.inlineChildren(node).trim();
				return text ? [`${'#'.repeat(level)} ${text}`] : [];
			}
			case 'p': {
				const text = this.inlineChildren(node).trim();
				return text ? [text] : [];
			}
			case 'blockquote': {
				const inner = this.blocks(node).join('\n\n');
				if (!inner.trim()) return [];
				return [inner.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')];
			}
			case 'hr':
				return ['---'];
			case 'ul': case 'ol':
				return [this.list(node)];
			case 'pre':
				return [this.pre(node)];
			case 'table':
				return this.table(node);
			case 'dl':
				return this.definitionList(node);
			case 'figcaption': {
				const text = this.inlineChildren(node).trim();
				return text ? [`*${text}*`] : [];
			}
			default: {
				// div / section / figure / article 等容器：透传子块
				return this.blocks(node);
			}
		}
	}

	private list(node: any): string {
		const ordered = tagOf(node) === 'ol';
		const lines: string[] = [];
		let index = 1;

		for (const li of childElementsOf(node)) {
			if (tagOf(li) !== 'li') {
				// 非 li 内容（畸形 HTML）：并入当前项或忽略
				this.depthGuardWarn('list-non-li-child', `<${tagOf(li)}> 出现在 <${tagOf(node)}> 中`);
				continue;
			}
			const parts = this.blocks(li);
			const marker = ordered ? `${index++}. ` : '- ';
			const contIndent = ' '.repeat(marker.length);

			if (parts.length === 0) {
				lines.push(ordered ? `${index++}.` : '-');
				continue;
			}
			lines.push(marker + parts[0]);
			for (const rest of parts.slice(1)) {
				// 续行（含嵌套列表）按 marker 宽度缩进，保证渲染为同一项的子内容
				lines.push(contIndent + rest);
			}
		}
		return lines.join('\n');
	}

	private pre(node: any): string {
		// 优先取 <code> 子元素的原始文本（不折叠、不转义）
		const codeEl = childElementsOf(node).find((c) => tagOf(c) === 'code');
		let code = codeEl ? (codeEl.textContent ?? '') : (node.textContent ?? '');
		code = code.replace(/\n+$/, '');

		let lang = '';
		if (codeEl) {
			const cls = String(codeEl.getAttribute?.('class') ?? '');
			const m = cls.match(/(?:language|lang)-([a-zA-Z0-9+#-]+)/);
			if (m) lang = m[1];
		}
		// fence 长度需大于内容中最长的连续反引号
		const longest = (code.match(/`{3,}/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
		const fence = '`'.repeat(Math.max(3, longest + 1));
		return `${fence}${lang}\n${code}\n${fence}`;
	}

	/**
	 * 表格在 HTML 中有两种本体，必须先区分再决定渲染：
	 * 1. 数据表 —— 单元格是原子值，多列横向关系承载信息 → GFM 表格；
	 * 2. 排版壳 —— 单元格里装的是「流内容」（段落/换行分隔的行…），表格只是视觉容器
	 *    （epub2 书籍常用单列表格做边框/底色卡片，如各章「本章总结」框）。
	 *
	 * 判定：单列表（每一行都恰好一个单元格）无法表达任何横向数据关系，
	 * 视为排版壳 → 去壳：表格外壳消失，内容按阅读顺序原样上浮为块。
	 * 壳不是内容本体，去掉壳后内容零损失（与 Covering 的守恒律一致）；
	 * 若强行按数据表渲染，只会把流内容压扁成单元格内的一串字面 <br>。
	 */
	private table(node: any): string[] {
		// ---- 第一遍：按文档顺序收集行（thead / tbody / tfoot / 裸 tr），保留单元格元素 ----
		const rows: { cellEls: any[]; inHead: boolean }[] = [];
		const collectTr = (tr: any, fromThead: boolean) => {
			const cellEls = childElementsOf(tr).filter((c) => tagOf(c) === 'td' || tagOf(c) === 'th');
			if (!cellEls.length) return;
			const allTh = cellEls.every((c) => tagOf(c) === 'th');
			rows.push({ cellEls, inHead: fromThead || allTh });
		};
		for (const child of childElementsOf(node)) {
			const t = tagOf(child);
			if (t === 'thead') {
				for (const tr of childElementsOf(child)) if (tagOf(tr) === 'tr') collectTr(tr, true);
			} else if (t === 'tbody' || t === 'tfoot') {
				for (const tr of childElementsOf(child)) if (tagOf(tr) === 'tr') collectTr(tr, false);
			} else if (t === 'tr') {
				collectTr(child, false);
			}
		}

		if (rows.length === 0) {
			pushDiag(this.diags, 'warning', '空表格，已跳过', { code: 'table-empty' });
			return [];
		}

		const colCount = (els: any[]) =>
			els.reduce((s, c) => s + Math.max(1, Number(c.getAttribute?.('colspan') ?? '1')), 0);

		// ---- 排版壳：单列表 → 去壳上浮 ----
		if (rows.every((r) => colCount(r.cellEls) === 1)) {
			pushDiag(this.diags, 'info', '单列表格视为排版壳，已去表格化并按行上浮为段落', {
				code: 'table-layout-denatured',
				data: `${rows.length}x1`,
			});
			const out: string[] = [];
			for (const r of rows) {
				for (const cell of r.cellEls) out.push(...this.blocks(cell));
			}
			return out;
		}

		// ---- 数据表：GFM ----
		const width = rows.reduce((m, r) => Math.max(m, r.cellEls.length), 0);
		if (width === 0) return [];

		const renderRow = (els: any[]) => {
			const cells = els.slice(0, width).map((cell) => {
				const span = Number(cell.getAttribute?.('colspan') ?? '1');
				if (span > 1) {
					pushDiag(this.diags, 'info', '表格含 colspan，已忽略合并（按普通单元格输出）', {
						code: 'table-colspan',
					});
				}
				// 单元格内换行用 <br> 表达（GFM 单元格不能含真实换行）；竖线需转义，否则撑破表格
				return this.inlineChildren(cell)
					.replace(/\n/g, '<br>')
					.replace(/\|/g, '\\|')
					.trim();
			});
			while (cells.length < width) cells.push('');
			return `| ${cells.join(' | ')} |`;
		};

		const out: string[] = [];
		if (rows[0].inHead) {
			out.push(renderRow(rows[0].cellEls));
			out.push(`| ${Array(width).fill('---').join(' | ')} |`);
			for (const r of rows.slice(1)) out.push(renderRow(r.cellEls));
		} else {
			// 无表头：补一行空表头，保证 GFM 表格合法
			out.push(`| ${Array(width).fill('').join(' | ')} |`);
			out.push(`| ${Array(width).fill('---').join(' | ')} |`);
			for (const r of rows) out.push(renderRow(r.cellEls));
		}
		return [out.join('\n')];
	}

	private definitionList(node: any): string[] {
		const out: string[] = [];
		for (const child of childElementsOf(node)) {
			const t = tagOf(child);
			const text = this.inlineChildren(child).trim();
			if (!text) continue;
			if (t === 'dt') out.push(`**${text}**`);
			else if (t === 'dd') out.push(`  ${text}`);
			else out.push(text);
		}
		return out;
	}

	private depthGuardWarn(code: string, message: string): void {
		pushDiag(this.diags, 'info', message, { code });
	}

	// ---------------------------------------------------------------- 行内

	private inlineChildren(node: any): string {
		let out = '';
		for (const child of childNodesOf(node)) {
			const type = child.nodeType;
			if (type === 8 || type === 7) continue;
			if (type === 3) {
				out += escapeInline(collapseText(child.nodeValue ?? ''));
				continue;
			}
			if (type !== 1) continue;
			out += this.inline(child);
		}
		return out;
	}

	private inline(node: any): string {
		// 文本节点：必须先单独处理，否则会落到 default 分支返回空串（丢内容）
		if (node.nodeType === 3) return escapeInline(collapseText(node.nodeValue ?? ''));
		// 注释 / CDATA / 其它非元素节点
		if (node.nodeType !== 1) return '';

		const tag = tagOf(node);

		if (SKIP_TAGS.has(tag)) return '';

		if (UNSUPPORTED_TAGS.has(tag)) {
			pushDiag(this.diags, 'warning', `行内不支持的元素 <${tag}>，已降级为纯文本`, {
				code: 'unsupported-inline-element',
				data: tag,
			});
			return escapeInline(collapseText(node.textContent ?? ''));
		}

		// 块级元素误出现在行内上下文（畸形 HTML 常见，如 <p> 内嵌 <blockquote>）：
		// 提升为正确的块级渲染，而非压平成纯文本（避免丢失引用/标题等格式）。
		// 用空行包裹，确保它在行内流里被正确识别为独立块，而不是并入门落段落。
		if (BLOCK_TAGS.has(tag)) {
			pushDiag(this.diags, 'info', `块级元素 <${tag}> 出现在行内位置，已提升为块级渲染`, {
				code: 'block-in-inline',
				data: tag,
			});
			const rendered = this.block(node).join('\n\n').trim();
			return rendered ? `\n\n${rendered}\n\n` : '';
		}

		switch (tag) {
			case 'br':
				return '\n';
			case 'strong': case 'b': {
				const inner = this.inlineChildren(node).trim();
				return inner ? `**${inner}**` : '';
			}
			case 'em': case 'i': {
				const inner = this.inlineChildren(node).trim();
				return inner ? `*${inner}*` : '';
			}
			case 'del': case 's': case 'strike': {
				const inner = this.inlineChildren(node).trim();
				return inner ? `~~${inner}~~` : '';
			}
			case 'mark': {
				const inner = this.inlineChildren(node).trim();
				return inner ? `==${inner}==` : '';
			}
			case 'sup': {
				const inner = this.inlineChildren(node).trim();
				return inner ? `^${inner}^` : '';
			}
			case 'sub': {
				const inner = this.inlineChildren(node).trim();
				return inner ? `~${inner}~` : '';
			}
			case 'code': case 'kbd': case 'samp': case 'tt': {
				const text = node.textContent ?? '';
				if (!text) return '';
				// 内容含反引号时用更长的定界符
				const longest = (text.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
				const fence = '`'.repeat(Math.max(1, longest + 1));
				const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
				return `${fence}${pad}${text}${pad}${fence}`;
			}
			case 'q': {
				const inner = this.inlineChildren(node).trim();
				return inner ? `"${inner}"` : '';
			}
			case 'a':
				return this.link(node);
			case 'img':
				return this.image(node);
			case 'ruby':
				return this.ruby(node);
			case 'rt':
				// 游离的 rt（不在 ruby 内）：保留文字，避免丢注音
				return escapeInline(collapseText(node.textContent ?? ''));
			case 'rp':
				// rp 是给不支持 ruby 的浏览器用的括号，Markdown 里无意义
				return '';
			default:
				// span / small / font / abbr / cite / time / label / rb / big 等：透传
				return this.inlineChildren(node);
		}
	}

	private link(node: any): string {
		const href = String(node.getAttribute?.('href') ?? '');
		const text = this.inlineChildren(node).trim();
		// 脚注判定必须用**未转义**的原始文本：inlineChildren 已把 [1] 转成 \[1\]
		const raw = String(node.textContent ?? '').trim();

		// 脚注：形如 [1] / 1 的链接（含 <sup>1</sup> 这类包裹）
		if (this.opts.footnotes && /^\[?\d+\]?$/.test(raw)) {
			return `[^${raw.replace(/[[\]]/g, '')}]`;
		}

		if (!href) return text;

		// 纯锚点（#xxx）：切分后锚点已失效，只保留文字
		if (href.startsWith('#')) {
			pushDiag(this.diags, 'info', `忽略纯锚点链接 ${href}（切分后锚点失效）`, {
				code: 'link-anchor-only',
				data: href,
			});
			return text;
		}

		const isExternal = /^(https?:|mailto:|tel:)/i.test(href) || href.startsWith('//');
		if (isExternal) return `[${text}](${href})`;

		switch (this.opts.linkFormat) {
			case 'wikilink':
				return text && text !== href ? `[[${href}|${text}]]` : `[[${href}]]`;
			case 'markdown':
				return `[${text}](${href})`;
			case 'text':
				return text;
			default:
				return `[${text}](${href})`;
		}
	}

	private image(node: any): string {
		const src = String(node.getAttribute?.('src') ?? '');
		const alt = String(node.getAttribute?.('alt') ?? '');

		if (!src) {
			pushDiag(this.diags, 'warning', '图片缺少 src，已丢弃', { code: 'image-no-src' });
			return '';
		}

		const isRemote = /^https?:\/\//i.test(src) || src.startsWith('data:');
		let target: string;

		if (isRemote) {
			if (!this.opts.keepRemoteImages) {
				// 旧实现静默 return ""；这里改为记 warning，让上层可提示用户
				pushDiag(this.diags, 'warning', `丢弃无法落盘的图片：${src.slice(0, 80)}`, {
					code: 'image-remote-dropped',
					data: src,
				});
				return '';
			}
			target = src;
		} else {
			const fileName = src.split('/').pop() ?? src;
			target = [this.opts.assetsPath, fileName].filter(Boolean).join('/');
		}

		if (this.opts.imageFormat === 'wikilink') {
			// wikilink 目标按字面解析，路径里的空格/括号都不需要编码
			return `![[${target}]]`;
		}
		// Markdown 链接目的地里，空格与括号必须编码：括号未编码会截断 ![](...) 的解析
		// （真实书名如 "自控力(elib.cc)" 会让整条图片链接断裂）。存储侧保持真实文件名，
		// 编码只发生在链接层，Obsidian 解析时会解码回真实路径。
		const encoded = target.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
		return `![${alt}](${encoded})`;
	}

	private ruby(node: any): string {
		let base = '';
		let reading = '';

		for (const child of childNodesOf(node)) {
			if (child.nodeType === 1) {
				const t = tagOf(child);
				if (t === 'rt') {
					reading += child.textContent ?? '';
					continue;
				}
				if (t === 'rp') continue;
			}
			base += this.inline(child);
		}

		base = base.trim();
		reading = collapseText(reading).trim();

		if (!base && !reading) return '';

		switch (this.opts.rubyFormat) {
			case 'paren':
				return reading ? `${base}（${reading}）` : base;
			case 'brace':
				return reading ? `{${base}|${reading}}` : base;
			case 'html':
				return reading ? `<ruby>${base}<rt>${reading}</rt></ruby>` : base;
			case 'strip':
				return base;
			default:
				return reading ? `${base}（${reading}）` : base;
		}
	}
}
