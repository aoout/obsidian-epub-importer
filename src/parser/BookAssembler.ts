/**
 * BookAssembler：把 OpfResult + Nav 归一化成与版本无关的 Book 模型。
 *
 * 来源：
 * - diags 错误分级收口（fatal 优先）：booqs-epub 的 diags 范式
 */

import type { Book, Diags, TocEntry } from './types';
import type { OpfResult } from './OpfParser';

export function assembleBook(opf: OpfResult, nav: TocEntry[], diags: Diags): Book {
	return {
		version: opf.version,
		uniqueIdentifier: opf.uniqueIdentifier,
		metadata: opf.metadata,
		manifest: opf.manifest,
		spine: opf.spine,
		nav,
		coverItem: opf.coverItem,
		diagnostics: diags,
	};
}

/** 是否存在致命诊断（调用方据此决定是否中止整本书） */
export function hasFatal(diags: Diags): boolean {
	return diags.some((x) => x.severity === 'fatal');
}
