/**
 * 笔记规划：把章节流按 granularity 合并成笔记，规划路径，并建立内链重写表。
 *
 * 三个职责：
 * 1. 粒度合并（granularity）—— 层级深的章节合并进最近的浅层祖先，对应原实现 mergeChapters
 * 2. 路径规划 —— 浅层笔记成为其下深层笔记的目录（对应原实现 getChapterPaths 的嵌套目录）
 * 3. 链接重写表 —— 把 `[[chap.xhtml|第1章]]` 这类 EPUB 内链映射到实际笔记
 */

import type { TransformedChapter } from '../transform';
import type { Book } from '../parser/types';
import { basenameOf, joinPath, sanitizeFileName } from './path';

export interface PlannedNote {
	title: string;
	level: number;
	/** vault 内相对路径（不含 .md） */
	relPath: string;
	/** 合并进来的章节 */
	sources: TransformedChapter[];
	/** 合并并规范化后的正文 */
	content: string;
}

export interface PlanResult {
	/** 书籍根目录（vault 内相对路径） */
	bookPath: string;
	notes: PlannedNote[];
	/** href（归一化后或 basename）→ 笔记 wikilink 目标（不含 .md） */
	linkMap: Map<string, string>;
}

/**
 * 按 granularity 分组。
 *
 * 注意 granularity=0 是**特例**：表示「全书合成一篇」，而不是「只有 level 0 的章节成文」。
 * 这与原实现一致——原实现在 granularity===0 时走 `createFile(epubName, 全部内容)` 分支，
 * 完全不进入逐章成文的 processChapters。
 */
function groupChapters(chapters: TransformedChapter[], granularity: number): TransformedChapter[][] {
	if (granularity <= 0) return chapters.length ? [chapters] : [];

	const groups: TransformedChapter[][] = [];
	for (const c of chapters) {
		if (groups.length === 0 || c.level <= granularity) groups.push([c]);
		else groups[groups.length - 1].push(c);
	}
	return groups;
}

/** 把最浅的标题层级对齐到 `#`，避免全书一篇时通篇都是 `###` */
export function normalizeHeadings(markdown: string): string {
	const matches = markdown.match(/^(#{1,6}) /gm);
	if (!matches) return markdown;
	const minLevel = Math.min(...matches.map((m) => m.trim().length));
	if (minLevel <= 1) return markdown;
	const diff = minLevel - 1;
	return markdown.replace(/^(\s*)(#{1,6}) /gm, (_, lead: string, hashes: string) => {
		return `${lead}${'#'.repeat(Math.max(1, hashes.length - diff))} `;
	});
}

/** 归一化 href：去掉空段、`.`、`../` */
export function normalizeHref(href: string): string {
	const segs: string[] = [];
	for (const seg of String(href ?? '').trim().split('/')) {
		if (seg === '' || seg === '.') continue;
		if (seg === '..') {
			segs.pop();
			continue;
		}
		segs.push(seg);
	}
	return segs.join('/');
}

/** 判断一个链接目标是否指向 EPUB 文档（而非普通笔记或图片） */
function isDocumentHref(href: string): boolean {
	return /\.(x?html?|xml)$/i.test(href);
}

/**
 * 把 `[[chap.xhtml|显示名]]` 重写为 `[[实际笔记路径|显示名]]`。
 * 找不到映射时**原样保留**（绝不以丢链接的方式丢内容）。
 */
export function rewriteLinks(markdown: string, linkMap: Map<string, string>): string {
	return markdown.replace(/\[\[([^[\]]+?)\]\]/g, (match, inner: string) => {
		const barIdx = inner.indexOf('|');
		const linkPart = barIdx === -1 ? inner : inner.slice(0, barIdx);
		const display = barIdx === -1 ? '' : inner.slice(barIdx + 1);

		const hashIdx = linkPart.indexOf('#');
		const base = hashIdx === -1 ? linkPart : linkPart.slice(0, hashIdx);
		const fragment = hashIdx === -1 ? '' : linkPart.slice(hashIdx + 1);
		if (!base || !isDocumentHref(base)) return match;

		const norm = normalizeHref(base);

		// 优先按 fragment 精确命中（同一文件被切成多章时才能指对笔记）
		if (fragment) {
			const exact = linkMap.get(`${norm}#${fragment}`);
			if (exact) return `[[${exact}${display ? `|${display}` : ''}]]`;
		}

		const target = linkMap.get(norm) ?? linkMap.get(basenameOf(norm)) ?? linkMap.get(base);
		if (!target) return match;

		return `[[${target}${display ? `|${display}` : ''}]]`;
	});
}

export interface PlanOptions {
	granularity?: number;
	savePath?: string;
	maxNameLength?: number;
	/** 书籍目录名（已安全化前），默认取书名或 'book' */
	bookName?: string;
}

export function planNotes(
	book: Book,
	chapters: TransformedChapter[],
	opts: PlanOptions = {},
): PlanResult {
	const granularity = opts.granularity ?? 1;
	const maxNameLength = opts.maxNameLength ?? 100;
	const rawBookName = opts.bookName || book.metadata?.title || 'book';
	const bookName = sanitizeFileName(rawBookName, maxNameLength);
	const bookPath = joinPath(opts.savePath ?? '', bookName);

	const single = granularity <= 0;
	const groups = groupChapters(chapters, granularity);
	const notes: PlannedNote[] = [];
	const linkMap = new Map<string, string>();

	// 层级栈：浅层笔记会成为其下深层笔记的目录名
	const stack: { level: number; name: string }[] = [];

	for (const group of groups) {
		const head = group[0];
		// 全书一篇时用书名作文件名（原实现在此分支也是用 epubName 建单个文件）
		const title = single
			? bookName
			: sanitizeFileName(head.title || `chapter ${notes.length + 1}`, maxNameLength);

		while (stack.length && stack[stack.length - 1].level >= head.level) stack.pop();
		const dirSegs = stack.map((s) => s.name);
		const relPath = joinPath(bookPath, ...dirSegs, title);

		const content = normalizeHeadings(group.map((c) => c.markdown.trim()).filter(Boolean).join('\n\n'));

		notes.push({ title, level: head.level, relPath, sources: group, content });

		// 该笔记覆盖了这些章节，把它们的可寻址 href 都指向本笔记。
		// 注意：同一个文件常被切成多章（不同锚点），因此
		// - 文件级映射只设**第一次**，避免被后段覆盖成错误的笔记
		// - 带 fragment 的映射是精确的，单独登记，优先命中
		for (const c of group) {
			if (!c.fileHref) continue;
			const norm = normalizeHref(c.fileHref);
			if (c.fragment) linkMap.set(`${norm}#${c.fragment}`, relPath);
			if (!linkMap.has(norm)) linkMap.set(norm, relPath);
			const bn = basenameOf(c.fileHref);
			if (bn && !linkMap.has(bn)) linkMap.set(bn, relPath);
		}

		stack.push({ level: head.level, name: title });
	}

	return { bookPath, notes, linkMap };
}
