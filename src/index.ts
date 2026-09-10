/**
 * 内核顶层入口：EPUB → Markdown 的完整流水线（不含写盘，写盘是 Writer 层的事）。
 *
 * 编排：ArchiveReader → OpfParser → NavParser → BookAssembler → Slicer → Transformer
 * 全程复用同一个 FileProvider（只解压一次）与同一个 diags 数组（问题清单一次拿全）。
 */

import { ZipArchiveReader, parseEpubFromProvider, sliceBook, hasFatal } from './parser';
import { transformChapters } from './transform';
import type { ParseOptions } from './parser';
import type { TransformOptions, TransformedChapter } from './transform';
import type { Book, ChapterContent, Diags } from './parser/types';
import type { ArchiveInput } from './parser/ArchiveReader';

export * from './parser';
export * from './transform';
export * from './writer';

export interface PipelineOptions {
	parse?: ParseOptions;
	transform?: TransformOptions;
}

export interface PipelineResult {
	book: Book;
	chapters: ChapterContent[];
	markdown: TransformedChapter[];
	diagnostics: Diags;
	/** 是否无 fatal 级错误 */
	ok: boolean;
}

/**
 * 一次跑完：解析结构 → 按目录锚点切分 → 转成 Markdown。
 * 有 fatal（如加密书、mimetype 非法）时直接返回，不做无谓的切分与转换。
 */
export async function epubToMarkdown(
	input: ArchiveInput,
	opts: PipelineOptions = {},
): Promise<PipelineResult> {
	const reader = new ZipArchiveReader(input);
	await reader.open();

	const book = await parseEpubFromProvider(reader, opts.parse);
	const diags = book.diagnostics;

	if (hasFatal(diags)) {
		return { book, chapters: [], markdown: [], diagnostics: diags, ok: false };
	}

	const chapters = await sliceBook(book, reader, diags);
	const markdown = transformChapters(chapters, opts.transform, diags);

	return { book, chapters, markdown, diagnostics: diags, ok: true };
}
