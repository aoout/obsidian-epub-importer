/**
 * 设置模型 —— 只描述「语义值」，展示与存储格式不再混入。
 *
 * 2026-09-09 起（新内核转正）：
 * - imageFormat 存枚举 'markdown' | 'wikilink'，不再存展示文本 "![](imagePath)"
 * - assetsPath 是 vault 相对**路径模板**（{{savePath}}/{{bookName}} 可展开，从 vault 根目录起算），
 *   默认空 = 书内 assets（内核默认，与 {{savePath}}/{{bookName}}/assets 等价）；不写 {{savePath}} 即从 vault 根开始、可跨书共享附件目录。
 *   映射到内核 assetsVaultPath，落盘位置与正文图片链接位置由内核同一权威解析保证一致。
 * - removeDuplicateFolders(boolean) 升格为 onExisting 三态（abort/overwrite/merge）
 * - reformatting / mocPropertysTemplate 已删除（新内核无需旧 Turndown 补偿；MOC 属性见 mocFrontmatter）
 * - tag 是书级标记：只写入 MOC frontmatter（mocFrontmatter），不污染每篇笔记
 * - mocName 默认改为空（与 noteTemplate 同构）：留空 = {{bookName}}，内核兜底书名；
 *   迁移时旧默认值 {{bookName}} 规范化为空串（等价值迁移）
 * - schemaVersion 用于一次性迁移（load 时归一化旧 data.json 并回写）
 */

export type ImageFormat = "markdown" | "wikilink";
export type OnExisting = "abort" | "overwrite" | "merge";

/** 附件路径的历史默认模板（{{savePath}}/{{bookName}}/assets）。留空时内核默认与其展开结果等价。 */
export const DEFAULT_ASSETS_TEMPLATE = "{{savePath}}/{{bookName}}/assets";

export interface EpubImporterSettings {
	/** 设置结构版本；load 时用于旧数据迁移 */
	schemaVersion: number;
	/** 书级标签：落在 MOC frontmatter 的 tags（open-book 按它找书） */
	tag: string;
	/** 库目录列表：文件选择弹窗的搜索范围 */
	libraries: string[];
	/** 允许拖拽 .epub 导入 */
	byDrag: boolean;
	/** 库同步的并发导入数 */
	syncImportConcurrency: number;
	/** 保存根路径（vault 内，空 = 库根） */
	savePath: string;
	/**
	 * 资源目录 —— vault 相对**路径模板**，从 vault 根目录起算（{{savePath}}/{{bookName}} 可展开）。
	 * 空 = 书内 assets（内核默认，与历史默认模板展开结果等价）；不写 {{savePath}} 即从 vault 根开始。
	 */
	assetsPath: string;
	/** 切分粒度：level <= granularity 的章节各自成文，更深的并入最近祖先；0 = 全书一篇 */
	granularity: number;
	/** MOC（目录索引）笔记名模板；空 = {{bookName}}（书名，内核兜底） */
	mocName: string;
	/** 笔记正文模板（{{content}} 等）；空 = 只输出正文 */
	noteTemplate: string;
	/** 图片链接语法 */
	imageFormat: ImageFormat;
	/** 目标书目录已存在时的处置 */
	onExisting: OnExisting;
	/** 打开笔记时自动在右侧栏显示所在书（阅读面板） */
	autoOpenRightPanel: boolean;
	/** 输出 debug 级诊断到控制台 */
	moreLog: boolean;
	/** 阅读进度管理 */
	enableReadProgressManager: boolean;
	/** @internal 运行时写回的右栏 leaf id（设置页不展示；用户勿改） */
	leafID: string;
}

export const DEFAULT_SETTINGS: EpubImporterSettings = {
	schemaVersion: 2,
	tag: "book",
	libraries: [],
	byDrag: false,
	syncImportConcurrency: 3,
	savePath: "",
	assetsPath: "",
	granularity: 1,
	mocName: "",
	noteTemplate: "",
	imageFormat: "markdown",
	onExisting: "abort",
	autoOpenRightPanel: false,
	moreLog: false,
	enableReadProgressManager: false,
	leafID: ""
};

/**
 * 旧版本值域迁移（v1 → v2）+ 白名单吸收：
 * - 只吸收 DEFAULT_SETTINGS 里已知的键；历史残留（backupPath / mocPropertysTemplate /
 *   reformatting / removeDuplicateFolders 等）在迁移时自然被丢弃，load 后回写即固化清除。
 * - imageFormat "![](imagePath)"/"![[imagePath]]"（或任意自定义格式串）→ 枚举
 * - assetsPath：模板语义，**原样保留**；仅空值回退默认模板
 * - removeDuplicateFolders true/false → onExisting overwrite/abort（读 raw，吸收前已处理）
 */
export function migrateSettings(raw: unknown): EpubImporterSettings {
	const src = (raw ?? {}) as Record<string, unknown>;
	const out: EpubImporterSettings = { ...DEFAULT_SETTINGS };

	// 1) 白名单吸收：只读已知键，丢弃一切未知残留
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof EpubImporterSettings)[]) {
		if (key in src) {
			(out as unknown as Record<string, unknown>)[key] = src[key];
		}
	}

	// 2) libraries 类型守卫：非数组一律回退空数组
	if (!Array.isArray(out.libraries)) out.libraries = [];

	// 3) imageFormat：非枚举值按旧展示文本推断，兜底 markdown
	if (typeof src.imageFormat === "string") {
		const v = (src.imageFormat as string).trim();
		if (v !== "markdown" && v !== "wikilink") {
			out.imageFormat = /!\[\[/.test(v) ? "wikilink" : "markdown";
		}
	}

	// 4) assetsPath：空默认（留空 = 书内 assets，内核兜底）；类型守卫 + 旧默认值规范化为空串
	if (typeof src.assetsPath !== "string") {
		out.assetsPath = "";
	} else if (out.assetsPath === DEFAULT_ASSETS_TEMPLATE) {
		out.assetsPath = "";
	}

	// 5) removeDuplicateFolders → onExisting（读 raw，不依赖已吸收的键）
	if (typeof src.removeDuplicateFolders === "boolean") {
		out.onExisting = (src.removeDuplicateFolders as boolean) ? "overwrite" : "abort";
	}

	// 6) mocName 旧默认值规范化：{{bookName}} 与「留空」（内核兜底书名）完全等价，
	//    统一归为空串，让老用户也进入「空输入框 + 灰显 {{bookName}}」的默认交互
	if (out.mocName === "{{bookName}}") out.mocName = "";

	out.schemaVersion = 2;
	return out;
}
