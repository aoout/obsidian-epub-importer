/**
 * Writer 层：把转换后的章节写成 vault 里的 Markdown 笔记。
 *
 * 与 parser 层同样的抽象思路（FileProvider → WriteTarget）：
 * writer 不直接碰文件系统/Obsidian API，只依赖可注入的 WriteTarget，
 * 因此可用内存实现做单测，且内核无需运行时依赖 obsidian 包。
 */

import type { Diags } from '../parser/types';

/** 写入目标抽象 */
export interface WriteTarget {
	exists(path: string): Promise<boolean>;
	write(path: string, content: string): Promise<void>;
	writeBinary(path: string, data: Buffer): Promise<void>;
	createFolder(path: string): Promise<void>;
	remove(path: string): Promise<void>;
}

/**
 * Obsidian Vault 的最小结构化接口。
 * 用结构化类型而非 `import type { Vault } from 'obsidian'`，
 * 是为了让内核在 Node/测试环境下零运行时依赖。
 */
export interface ObsidianVaultLike {
	adapter: {
		exists(path: string, sensitive?: boolean): Promise<boolean>;
		write(path: string, data: string): Promise<void>;
		writeBinary(path: string, data: ArrayBuffer): Promise<void>;
		mkdir(path: string): Promise<void>;
		remove(path: string): Promise<void>;
	};
	create(path: string, data: string): Promise<unknown>;
	createFolder(path: string): Promise<unknown>;
}

export type WritePhase = 'planning' | 'assets' | 'notes' | 'moc' | 'done';

export interface WriterProgress {
	phase: WritePhase;
	current: number;
	total: number;
	message?: string;
}

/** 模板渲染时暴露给 {{var}} 的上下文 */
export interface ChapterContext {
	/** 章节标题 */
	title: string;
	/** 目录层级（0 起） */
	level: number;
	/** 序号（1 起） */
	index: number;
	/** 笔记总数 */
	total: number;
	/** 正文 Markdown */
	content: string;
	/** 上一篇笔记名（无扩展名），首篇为空串 */
	prev: string;
	/** 下一篇笔记名（无扩展名），末篇为空串 */
	next: string;
	/** 正文字符数 */
	total_chars: number;
	/** 书籍名 */
	book_name: string;
	/** 书籍元数据扁平化（title / author / language / publisher ...） */
	book: Record<string, unknown>;
	created_time: string;
}

export interface WriterOptions {
	/**
	 * 粒度：level <= granularity 的章节各自成文，更深的合并进最近的祖先。
	 * 0 = 全书合成一篇。默认 1。
	 */
	granularity?: number;
	/** vault 根相对的保存路径，默认 ''（vault 根） */
	savePath?: string;
	/**
	 * 资源目录名（**相对书目录**，默认 'assets'）。
	 * 适合「附件放书内」；要放到书外/跨书共享时用 assetsVaultPath。
	 */
	assetsPath?: string;
	/**
	 * 资源目录 —— vault 根相对**路径模板**（默认不设，此时退回 assetsPath 的书内语义）。
	 * 可用 {{savePath}} / {{bookName}} token 展开，支持 '../' 上跳；
	 * 允许把附件集中到书根之外、甚至多本书共享同一附件目录。
	 * 例：'{{savePath}}/附件库/{{bookName}}' 或 '../_assets/{{bookName}}'
	 */
	assetsVaultPath?: string;
	/** MOC（目录索引）笔记名模板，默认 '{{bookName}}' */
	mocName?: string;
	/**
	 * 笔记模板，可用 {{content}} {{chapter_name}} {{title}} {{level}} {{index}}
	 * {{prev}} {{next}} {{book_name}} {{author}} 等。留空则只输出正文。
	 */
	noteTemplate?: string;
	/** 追加到每篇笔记 frontmatter 的额外属性（与书元数据合并）；不放这里以免污染全部笔记 */
	frontmatter?: Record<string, unknown>;
	/**
	 * 只追加到 MOC 的 frontmatter（在笔记属性之上**叠加**）。
	 * 书级属性（如 tag）应放这里：只落 MOC，不污染每篇笔记。
	 */
	mocFrontmatter?: Record<string, unknown>;
	/** 目标目录已存在时的行为，默认 'abort'（记 fatal） */
	onExisting?: 'abort' | 'overwrite' | 'merge';
	/** 是否生成 MOC，默认 true */
	generateMoc?: boolean;
	/** 是否落盘图片等资源，默认 true */
	copyAssets?: boolean;
	/** 资源扩展名白名单（小写，不含点） */
	assetExtensions?: string[];
	/** 文件名最大长度（按字符计），默认 100 */
	maxNameLength?: number;
	/** 进度回调（每写入一篇/一个资源触发） */
	onProgress?: (p: WriterProgress) => void;
	/** 返回 true 则在下一个检查点中断（已写入的内容保留） */
	shouldCancel?: () => boolean;
	/** 是否输出 debug 级诊断（写入摘要等），默认关闭 */
	verbose?: boolean;
}

export interface WrittenNote {
	/** vault 内的完整路径（含 .md） */
	path: string;
	/** 笔记标题 */
	title: string;
	level: number;
	/** 该笔记合并了哪些章节（章节 id） */
	sources: string[];
}

export interface WriteResult {
	/** 书籍根目录（vault 内相对路径） */
	bookPath: string;
	notes: WrittenNote[];
	mocPath?: string;
	/** 已落盘的资源路径 */
	assets: string[];
	cancelled: boolean;
	diagnostics: Diags;
}

export const DEFAULT_WRITER_OPTIONS: Required<
	Pick<
		WriterOptions,
		| 'granularity'
		| 'savePath'
		| 'assetsPath'
		| 'mocName'
		| 'noteTemplate'
		| 'onExisting'
		| 'generateMoc'
		| 'copyAssets'
		| 'maxNameLength'
	>
> = {
	granularity: 1,
	savePath: '',
	assetsPath: 'assets',
	mocName: '{{bookName}}',
	noteTemplate: '',
	onExisting: 'abort',
	generateMoc: true,
	copyAssets: true,
	maxNameLength: 100,
};

/** 默认落盘的资源类型（原实现只覆盖 jpg/jpeg/png，漏了 gif/webp/svg 等） */
export const DEFAULT_ASSET_EXTENSIONS = [
	'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif',
];
