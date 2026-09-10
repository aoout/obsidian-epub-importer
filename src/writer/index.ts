/**
 * Writer 层对外入口，以及「解析 → 切分 → 转换 → 写入」的完整编排。
 */

import { ZipArchiveReader, hasFatal, parseEpubFromProvider, sliceBook } from '../parser';
import { transformChapters } from '../transform';
import { writeBook, resolveAssetsDir } from './Writer';
import { joinPath, sanitizeFileName } from './path';
import type { ParseOptions } from '../parser';
import type { TransformOptions, TransformedChapter } from '../transform';
import type { Book, Diags } from '../parser/types';
import type { ArchiveInput } from '../parser/ArchiveReader';
import type { WriteResult, WriterOptions, WriteTarget } from './types';

export * from './types';
export * from './Writer';
export * from './targets';
export * from './planner';
export * from './template';
export * from './path';

export interface ImportOptions {
	parse?: ParseOptions;
	transform?: TransformOptions;
	write?: WriterOptions;
	/** 顶层 verbose：同时为 parse / transform / write 点亮 debug 级诊断（默认关闭） */
	verbose?: boolean;
}

export interface ImportResult extends WriteResult {
	book: Book;
	chapters: TransformedChapter[];
}

/**
 * 一次跑完：解析 EPUB → 切分 → 转 Markdown → 写入目标（含资源落盘）。
 * 全程复用同一个 reader（只解压一次）与同一个 diags 数组。
 */
export async function importEpubToVault(
	input: ArchiveInput,
	target: WriteTarget,
	opts: ImportOptions = {},
): Promise<ImportResult> {
	const reader = new ZipArchiveReader(input);
	await reader.open();

	// 顶层 verbose 同时点亮 parse / transform / write 的 debug 级诊断；
	// 各子选项里的 verbose 优先（若各自显式设置）。
	const verbose = opts.verbose ?? false;
	const parseOpts: ParseOptions = { ...(opts.parse ?? {}), verbose: opts.parse?.verbose ?? verbose };
	const transformOpts: TransformOptions = { ...(opts.transform ?? {}), verbose: opts.transform?.verbose ?? verbose };

	const book = await parseEpubFromProvider(reader, parseOpts);
	const diags: Diags = book.diagnostics;

	const emptyResult = (): WriteResult => ({
		bookPath: '',
		notes: [],
		assets: [],
		cancelled: false,
		diagnostics: diags,
	});

	if (hasFatal(diags)) {
		return { book, chapters: [], ...emptyResult() };
	}

	const chapters = await sliceBook(book, reader, diags);

	// 关键：正文里的图片链接必须是 **vault 根相对的完整路径**（Books/书名/assets/x.png），
	// 否则 Obsidian 会按笔记所在目录去解析，嵌套目录下必然找不到图。
	// 因此这里先算出与 writeBook 内部一致的 bookPath，再拼出 assets 的完整路径。
	const writeOpts: WriterOptions = { ...(opts.write ?? {}), verbose: opts.write?.verbose ?? verbose };
	const savePath = writeOpts.savePath ?? '';
	const maxNameLength = writeOpts.maxNameLength ?? 100;
	const bookName = sanitizeFileName(book.metadata?.title || 'book', maxNameLength);
	const bookPath = joinPath(savePath, bookName);
	// 资产目录统一走 resolveAssetsDir（与 writeBook 内部同一权威）：
	// assetsVaultPath 模板可把附件放到书外/跨书共享；落盘位置 == 图片链接位置。
	const assetsFull = resolveAssetsDir(writeOpts, bookPath, bookName);

	const markdown = transformChapters(
		chapters,
		{ ...transformOpts, assetsPath: assetsFull },
		diags,
	);

	const written = await writeBook({
		target,
		book,
		chapters: markdown,
		provider: reader,
		opts: writeOpts,
		diags,
	});

	return { book, chapters: markdown, ...written };
}
