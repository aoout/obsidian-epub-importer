/**
 * Transformer 层的可配置项。
 *
 * 与解析层（parser）解耦：parser 只产出结构化的 ChapterContent（XHTML 片段），
 * 转换层负责把它变成 Obsidian 友好的 Markdown。
 *
 * 设计原则（贯穿全层）：**绝不静默丢内容**。
 * 任何「丢弃」（如远程图片、不支持的节点）都必须记 diagnostic，而不是像
 * 旧实现（src/core/TurndownService.ts）那样直接 `return ""`。
 */

/** ruby 注音的输出格式 */
export type RubyFormat =
	/** 日本語（にほんご）—— 通用、无插件依赖 */
	| 'paren'
	/** {日本語|にほんご} —— obsidian-ruby 插件格式 */
	| 'brace'
	/** 原样保留 <ruby> 标签 */
	| 'html'
	/** 只保留基础文字，丢弃注音 */
	| 'strip';

/** 图片的输出语法 */
export type ImageFormat =
	/** ![alt](path) */
	| 'markdown'
	/** ![[path]] —— Obsidian 内链语法 */
	| 'wikilink';

/** 内部链接（EPUB 内跨文件/跨章节跳转）的输出语法 */
export type LinkFormat =
	/** [[href|text]] */
	| 'wikilink'
	/** [text](href) */
	| 'markdown'
	/** 只保留链接文字 */
	| 'text';

export interface TransformOptions {
	/** ruby 注音输出格式，默认 'paren' */
	rubyFormat?: RubyFormat;
	/** 图片语法，默认 'markdown' */
	imageFormat?: ImageFormat;
	/**
	 * 资源目录前缀。图片 src 会被重写到该目录下（只取文件名）。
	 * 例：assetsPath='assets' + src='images/fig1.png' → 'assets/fig1.png'
	 */
	assetsPath?: string;
	/** 内部链接语法，默认 'wikilink' */
	linkFormat?: LinkFormat;
	/** 远程（http/https）图片是否保留；false 时丢弃并记 warning，默认 false */
	keepRemoteImages?: boolean;
	/** 是否把形如 `[1]` 的链接转成 Markdown 脚注 `[^1]`，默认 true */
	footnotes?: boolean;
	/** 标题层级偏移：章节标题已被外部渲染时可用，默认 0 */
	headingOffset?: number;
	/** 是否输出 debug 级诊断（转换摘要等），默认关闭 */
	verbose?: boolean;
}

export const DEFAULT_TRANSFORM_OPTIONS: Required<TransformOptions> = {
	rubyFormat: 'paren',
	imageFormat: 'markdown',
	assetsPath: 'assets',
	linkFormat: 'wikilink',
	keepRemoteImages: false,
	footnotes: true,
	headingOffset: 0,
	verbose: false,
};

/** 把用户传入的部分选项与默认值合并 */
export function resolveOptions(opts: TransformOptions = {}): Required<TransformOptions> {
	return { ...DEFAULT_TRANSFORM_OPTIONS, ...opts };
}
