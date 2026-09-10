/**
 * parseEpub：新解析器的唯一对外入口。
 * 编排：ArchiveReader → OPF → Nav → BookAssembler。
 *
 * 仅依赖三个通用、非 EPUB 专用的包：fast-xml-parser / linkedom / jszip（+ iconv-lite 编码嗅探）。
 * 不依赖任何 EPUB parser 包（见 docs/epub-parser-research.md）。
 */

import { ZipArchiveReader } from './ArchiveReader';
import { parseOpf } from './OpfParser';
import type { OpfResult } from './OpfParser';
import { parseNav } from './NavParser';
import { assembleBook, hasFatal } from './BookAssembler';
import { normalizeTocLevels } from './tocNormalize';
import { parseXml, asArray } from './xml';
import { pushDiag } from './types';
import type { Book, Diags, FileProvider } from './types';
import type { ArchiveInput } from './ArchiveReader';

export * from './types';
export { ZipArchiveReader } from './ArchiveReader';
export { sliceBook } from './Slicer';
export { parseOpf } from './OpfParser';
export { parseNav } from './NavParser';
export { assembleBook, hasFatal } from './BookAssembler';
export { normalizeTocLevels } from './tocNormalize';

function emptyOpf(): OpfResult {
	return {
		manifest: [],
		manifestById: new Map(),
		spine: [],
		metadata: { creators: [], subjects: [], identifiers: [], meta: {} },
	};
}

/** 从 container.xml 定位 OPF 全路径（大小写不敏感 + media-type 匹配）：julien-c/epub 的 _getRootFiles */
function locateOpfPath(containerXml: string, diags: Diags): string | undefined {
	const parsed = parseXml(containerXml, diags);
	const rootfiles = asArray<any>(parsed?.container?.[0]?.rootfiles?.[0]?.rootfile);
	for (const rf of rootfiles) {
		if (String(rf['@media-type']).toLowerCase() === 'application/oebps-package+xml' && rf['@full-path']) {
			return rf['@full-path'] as string;
		}
	}
	pushDiag(diags, 'fatal', 'container.xml 中找不到 OPF rootfile', { code: 'opf-not-found' });
	return undefined;
}

export interface ParseOptions {
	/** 是否校验 mimetype（默认 true） */
	validateMime?: boolean;
	/** 是否输出 debug 级诊断（解析摘要等），默认关闭 */
	verbose?: boolean;
	/**
	 * 是否启用目录层级归一化（退化根提升，默认 true）。
	 * 仅当顶层目录条目恰有 1 个时可能触发；正常书零影响；可显式关闭。
	 */
	normalizeToc?: boolean;
}

export async function parseEpub(input: ArchiveInput, opts: ParseOptions = {}): Promise<Book> {
	const reader = new ZipArchiveReader(input);
	await reader.open();
	return parseEpubFromProvider(reader, opts);
}

/**
 * 用已有的 FileProvider 解析（不负责打开/关闭归档）。
 * 供上层流水线复用同一个 reader 继续做切分（sliceBook），避免重复解压。
 */
export async function parseEpubFromProvider(
	provider: FileProvider,
	opts: ParseOptions = {},
): Promise<Book> {
	const diags: Diags = [];

	if (provider.hasDrm?.()) {
		pushDiag(diags, 'fatal', '检测到 META-INF/encryption.xml，该书已加密，无法导入', { code: 'drm' });
	}

	if (opts.validateMime !== false && provider.validateMime) {
		const ok = await provider.validateMime(diags);
		if (!ok) return assembleBook(emptyOpf(), [], diags);
	}

	const containerXml = await provider.readText('META-INF/container.xml', diags);
	if (containerXml === undefined) {
		pushDiag(diags, 'fatal', '找不到 META-INF/container.xml', { code: 'no-container' });
		return assembleBook(emptyOpf(), [], diags);
	}
	const opfPath = locateOpfPath(containerXml, diags);
	if (!opfPath) return assembleBook(emptyOpf(), [], diags);

	const opfXml = await provider.readText(opfPath, diags);
	if (opfXml === undefined) {
		pushDiag(diags, 'fatal', `无法读取 OPF：${opfPath}`, { code: 'opf-read-failed' });
		return assembleBook(emptyOpf(), [], diags);
	}

	const opf = parseOpf(opfXml, opfPath, diags);
	const nav = await parseNav(opf, opfPath, provider, diags);
	if (opts.verbose) {
		pushDiag(diags, 'debug', `解析完成：manifest ${opf.manifest.length} / nav ${nav.length}`, {
			code: 'parse-summary',
		});
	}
	const book = assembleBook(opf, nav, diags);
	// 目录层级归一化（退化根提升）：见 tocNormalize.ts —— 正常书零影响
	if (opts.normalizeToc !== false) {
		normalizeTocLevels(book.nav, book.diagnostics);
	}
	return book;
}
