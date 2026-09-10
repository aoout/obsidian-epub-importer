/**
 * Transformer 层对外入口：XHTML 片段 → Markdown。
 *
 * 与 parser 层解耦：只吃 ChapterContent（parser 的产物），只吐 Markdown 字符串。
 */

import { HtmlToMarkdown } from './HtmlToMarkdown';
import type { TransformOptions } from './types';
import type { ChapterContent, Diags } from '../parser/types';
import { pushDiag } from '../parser/types';

export * from './types';
export { HtmlToMarkdown, collapseText, escapeInline } from './HtmlToMarkdown';

/** 转换单个 HTML 片段 */
export function transformHtml(html: string, opts: TransformOptions = {}, diags: Diags = []): string {
	return new HtmlToMarkdown(opts, diags).convert(html);
}

/** 转换单个章节（标题不注入，交给上层 Writer 决定排版） */
export function transformChapter(
	chapter: ChapterContent,
	opts: TransformOptions = {},
	diags: Diags = [],
): string {
	return transformHtml(chapter.html, opts, diags);
}

export interface TransformedChapter {
	id: string;
	title?: string;
	level: number;
	fileHref: string;
	fragment?: string;
	markdown: string;
}

/**
 * 批量转换章节。
 * 注意：每章复用同一个 diags 数组，便于调用方一次性拿到全书的问题清单。
 */
export function transformChapters(
	chapters: ChapterContent[],
	opts: TransformOptions = {},
	diags: Diags = [],
): TransformedChapter[] {
	const converter = new HtmlToMarkdown(opts, diags);
	const result = chapters.map((c) => ({
		id: c.id,
		title: c.title,
		level: c.level,
		fileHref: c.fileHref,
		fragment: c.fragment,
		markdown: converter.convert(c.html),
	}));
	if (opts.verbose) {
		pushDiag(diags, 'debug', `转换完成：${chapters.length} 个章节 → ${result.length} 个 Markdown 片段`, {
			code: 'transform-summary',
		});
	}
	return result;
}
