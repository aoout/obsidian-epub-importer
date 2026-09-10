/**
 * 与 EPUB 版本（2/3）无关的纯数据模型 + 错误分级（diags）。
 *
 * 设计来源（见 docs/epub-parser-research.md）：
 * - Diagnostic / diags 错误分级：booqs-epub 的 diags 数组范式
 * - 命名空间无关键名（title 而非 dc:title）：julien-c/epub
 * - creator 数组 / cover 双策略 / unique-identifier 双策略：booqs-epub
 */

export type DiagSeverity = 'fatal' | 'warning' | 'info' | 'debug';

export interface Diagnostic {
	severity: DiagSeverity;
	/** 人类可读信息 */
	message: string;
	/** 结构化错误码，便于上层按 code 做国际化/处理 */
	code?: string;
	/** 附加上下文，便于排查 */
	data?: unknown;
}

export type Diags = Diagnostic[];

export function pushDiag(
	diags: Diags,
	severity: DiagSeverity,
	message: string,
	opts?: { code?: string; data?: unknown },
): void {
	diags.push({ severity, message, code: opts?.code, data: opts?.data });
}

/** 解压层抽象：parser 不直接碰 zip，便于注入与单测（booqs-epub 的 FileProvider 范式） */
export interface FileProvider {
	readText(path: string, diags?: Diags): Promise<string | undefined>;
	readBinary(path: string, diags?: Diags): Promise<Buffer | undefined>;
	has(path: string): boolean;
	/** 可选能力：DRM 检测（zip 实现提供；内存实现可省略） */
	hasDrm?(): boolean;
	/** 可选能力：mimetype 入口校验（zip 实现提供） */
	validateMime?(diags?: Diags): Promise<boolean>;
}

export interface ManifestItem {
	id: string;
	/** 已归一化到 zip 根的相对路径 */
	href: string;
	mediaType: string;
	/** EPUB3 properties（如 "nav"、"cover-image"），拆成数组方便判断 */
	properties: string[];
	fallback?: string;
}

export interface Creator {
	name: string;
	fileAs?: string;
	role?: string;
}

export interface Identifier {
	scheme?: string;
	value: string;
}

export interface BookMetadata {
	title?: string;
	creators: Creator[];
	publisher?: string;
	language?: string;
	subjects: string[];
	description?: string;
	date?: string;
	identifiers: Identifier[];
	/** OPF <meta> 里收集到的其它键值对（name/content 或 property/#text） */
	meta: Record<string, string>;
}

/** 目录项：NCX 与 EPUB3 nav 统一成同一形状 */
export interface TocEntry {
	label: string;
	/** 原始 href（可能含 #fragment） */
	href: string;
	level: number;
	/** 归一化后的文件 href（不含 fragment），用于匹配 manifest */
	fileHref: string;
	/** href 里的 #fragment（锚点 id），无则为 undefined */
	fragment?: string;
	/** 匹配到的 manifest item id（解析不出则为 undefined） */
	manifestId?: string;
}

export interface SpineItem {
	idref: string;
	manifestItem?: ManifestItem;
	/** linear="no" 的文档不进入线性阅读顺序 */
	linear: boolean;
}

export interface ChapterContent {
	/** spine idref 或 nav 的 manifestId */
	id: string;
	title?: string;
	level: number;
	/** 该章节在 EPUB 内的相对路径（不含 fragment） */
	fileHref: string;
	/** 锚点 id（整文件章节为 undefined） */
	fragment?: string;
	/** 抽取出的（已按锚点切分的）XHTML 片段 */
	html: string;
}

export interface Book {
	version?: string;
	uniqueIdentifier?: string;
	metadata: BookMetadata;
	manifest: ManifestItem[];
	spine: SpineItem[];
	nav: TocEntry[];
	coverItem?: ManifestItem;
	diagnostics: Diags;
}
