import EpubImporterPlugin from "../main";
import {
	App,
	PluginSettingTab,
	Setting,
	SettingDefinitionItem,
} from "obsidian";
// createFragment 为 obsidian 提供的全局辅助（declare global），无需 import
import i18next from "i18next";
import { DEFAULT_SETTINGS, DEFAULT_ASSETS_TEMPLATE } from "./settings";
import type { ImageFormat, OnExisting } from "./settings";
import { renderTemplate } from "../writer/template";
import { PromptModal } from "../modals/PromptModal";

/**
 * 设置页 —— 值全部是语义值（枚举/相对路径），展示文案来自 i18n。
 * 2026-09-09 起（新内核转正）：仅服务新内核契约；已移除旧内核时代的
 * reformatting / removeDuplicateFolders / mocPropertysTemplate（见 settings.ts）。
 *
 * Path A（官方迁移指南，minAppVersion >= 1.13.0）：完全声明式 getSettingDefinitions()。
 * Obsidian 负责渲染、进全局设置搜索、自动读写 this.plugin.settings[key] 并自动 saveData；
 * 书库目录用官方 type:'list'（增删 + 拖拽排序），模板行用 render 回调复用同一套
 * chips / 实时体检 / 样例预览。minAppVersion 已锁到 1.13.0，不再兼容旧版。
 *
 * 风格规范（官方 Settings 风格指南）：顶部不放插件名标题；只有「通用区」无组标题；
 * 每区一个 heading（sentence case，不重复 "settings"）；不在主页面堆 textarea；
 * 描述只写一句话。
 */

/** flattenBook 产生的书级元数据变量（writer/template.ts 的封闭集合） */
const META_VARS = [
	"book_title",
	"book_name",
	"author",
	"authors",
	"language",
	"publisher",
	"date",
	"description",
	"subjects",
];

/** 附件路径模板可用变量（resolveAssetsDir 只展开这两个 + '../' 上跳） */
const ASSET_VARS = ["savePath", "bookName"];

/** MOC 文件名模板可用变量（bookName + 书级元数据） */
const MOC_VARS = ["bookName", ...META_VARS];

/** 笔记模板可用变量（书级元数据 + 单篇笔记上下文，见 Writer.ts vars） */
const NOTE_VARS = [
	...META_VARS,
	"content",
	"title",
	"chapter_name",
	"level",
	"index",
	"total",
	"prev",
	"next",
	"total_chars",
	"created_time",
];

/** 模板变量完整清单（Wiki）。设置行只展示常用变量，避免过长。 */
const WIKI_TEMPLATE_VARS_URL =
	"https://github.com/aoout/obsidian-epub-importer/wiki/Template-variables";

type TemplateField = "assetsPath" | "mocName" | "noteTemplate";

/** 抽取文本里所有 {{token}}；未知 token 在渲染时会被原样输出（不改动语义，仅提示） */
function extractTokens(value: string): string[] {
	const out: string[] = [];
	const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(value)) !== null) {
		const token = m[1].trim();
		if (token) out.push(token);
	}
	return out;
}

function unknownTokens(value: string, known: string[]): string[] {
	const knownSet = new Set(known);
	return [...new Set(extractTokens(value))].filter((t) => !knownSet.has(t));
}

/** 多行内容压成一行并截断，避免样例预览把 desc 撑爆 */
function toOneLine(text: string, max = 160): string {
	const oneLine = text.replace(/\s*\r?\n\s*/g, " ").trim();
	return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

/**
 * 样例变量集：与生产侧变量集同构的虚构书籍数据（文案来自 i18n，跟随用户语言）。
 * 用于设置页的实时样例预览 —— 对齐官方「日记」插件的
 * 「这是当前所用格式的样例: …」模式。
 */
function sampleVars(field: TemplateField): Record<string, unknown> {
	const bookName = i18next.t("translation:sample_book");
	const base: Record<string, unknown> = {
		bookName,
		book_title: bookName,
		author: i18next.t("translation:sample_author"),
		authors: [i18next.t("translation:sample_author")],
		language: i18next.t("translation:sample_language"),
		publisher: i18next.t("translation:sample_publisher"),
		date: "2026-09-09",
		description: i18next.t("translation:sample_body"),
		subjects: [i18next.t("translation:sample_subject")],
		savePath: "Books",
	};
	if (field !== "assetsPath") {
		Object.assign(base, {
			content: i18next.t("translation:sample_body"),
			title: i18next.t("translation:sample_chapter"),
			chapter_name: i18next.t("translation:sample_chapter"),
			level: 2,
			index: 3,
			total: 12,
			prev: "[[上一章]]",
			next: "[[下一章]]",
			total_chars: 8421,
			created_time: "2026-09-09 15:28",
		});
	}
	return base;
}

/**
 * 计算某模板字段在样例变量下的渲染结果（与生产 renderTemplate 同一权威实现）。
 * assetsPath 额外把 '//' 归一成 '/'，与内核 resolveAssetsDir 的行为保持一致。
 */
function renderSample(field: TemplateField, rawValue: string, fallback?: string): string {
	const value = rawValue || fallback || DEFAULT_SETTINGS[field];
	const rendered = renderTemplate(value, sampleVars(field));
	const normalized = field === "assetsPath" ? rendered.replaceAll("//", "/") : rendered;
	return toOneLine(normalized);
}

interface TemplateSettingOpts {
	field: TemplateField;
	label: string;
	desc: string;
	placeholder: string;
	/** 设置行中展示的「常用变量」（精选子集；完整清单见 Wiki） */
	chips: string[];
	/** 模板支持的变量全集（封闭集合，来自内核展开代码），用于未知变量体检 */
	known: string[];
	multiline?: boolean;
	/** 留空时样例预览的回退模板（须与内核「留空」行为一致；未设则回退 DEFAULT_SETTINGS） */
	sampleFallback?: string;
}

/** 一个能打字、能输入的输入框的最小结构（TextComponent / TextAreaComponent 都满足） */
interface TextLike {
	setPlaceholder(p: string): unknown;
	setValue(v: string): unknown;
	onChange(cb: (value: string) => unknown): unknown;
}

export class EpubImporterSettingsTab extends PluginSettingTab {
	plugin: EpubImporterPlugin;
	constructor(app: App, plugin: EpubImporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// ===================================================================
	// Path A：声明式设置（minAppVersion >= 1.13.0）。Obsidian 渲染、索引搜索、
	// 读写 this.plugin.settings[key] 并自动 saveData。display() 已移除。
	// ===================================================================
	getSettingDefinitions(): SettingDefinitionItem[] {
		const s = this.plugin.settings;
		return [
			// 通用区：无组标题（官方风格指南）
			{
				name: i18next.t("translation:Tag_o"),
				desc: i18next.t("translation:Tag"),
				control: { type: "text", key: "tag", placeholder: "book" },
			},

			// 书库目录：官方 type:'list'（增删 + 拖拽排序），替代主页面 textarea
			{
				type: "list",
				heading: i18next.t("translation:Library_o"),
				emptyState: i18next.t("translation:Library_empty"),
				addItem: {
					name: i18next.t("translation:Library_add"),
					action: () => this.openAddLibraryModal(),
				},
				onReorder: (oldIndex, newIndex) => void this.reorderLibraries(oldIndex, newIndex),
				onDelete: (index) => void this.deleteLibrary(index),
				items: s.libraries.map((path) => ({ name: path, searchable: false })),
			},

			{
				type: "group",
				heading: i18next.t("translation:import"),
				items: [
					{
						name: i18next.t("translation:byDrag_o"),
						desc: i18next.t("translation:byDrag"),
						control: { type: "toggle", key: "byDrag" },
					},
					{
						name: i18next.t("translation:Sync_import_concurrency_o"),
						desc: i18next.t("translation:Sync_import_concurrency"),
						control: { type: "slider", key: "syncImportConcurrency", min: 1, max: 10, step: 1 },
					},
					{
						name: i18next.t("translation:onExisting_o"),
						desc: i18next.t("translation:onExisting"),
						control: {
							type: "dropdown",
							key: "onExisting",
							defaultValue: "abort",
							options: this.onExistingOptions(),
						},
					},
				],
			},

			{
				type: "group",
				heading: i18next.t("translation:storage"),
				items: [
					{
						name: i18next.t("translation:Save_path_o"),
						desc: i18next.t("translation:Save_path"),
						control: {
							type: "text",
							key: "savePath",
							placeholder: i18next.t("translation:save_path_placeholder"),
						},
					},
					{
						name: i18next.t("translation:Assets_path_o"),
						desc: i18next.t("translation:Assets_path"),
						render: (setting) => this.renderTemplateRow(setting, this.templateOpts("assetsPath")),
					},
				],
			},

			{
				type: "group",
				heading: i18next.t("translation:generation"),
				items: [
					{
						name: i18next.t("translation:Hierarchy_depth_o"),
						desc: i18next.t("translation:Hierarchy_depth"),
						control: { type: "slider", key: "granularity", min: 0, max: 5, step: 1 },
					},
					{
						name: i18next.t("translation:Moc_fileName_o"),
						desc: i18next.t("translation:Moc_fileName"),
						render: (setting) => this.renderTemplateRow(setting, this.templateOpts("mocName")),
					},
					{
						name: i18next.t("translation:noteTemplate_o"),
						desc: i18next.t("translation:noteTemplate"),
						render: (setting) =>
							this.renderTemplateRow(setting, this.templateOpts("noteTemplate", true)),
					},
					{
						name: i18next.t("translation:imageFormat_o"),
						desc: i18next.t("translation:imageFormat"),
						control: {
							type: "dropdown",
							key: "imageFormat",
							defaultValue: "markdown",
							options: this.imageFormatOptions(),
						},
					},
				],
			},

			{
				type: "group",
				heading: i18next.t("translation:helper"),
				items: [
					{
						name: i18next.t("translation:Auto_open_right_panel_o"),
						desc: i18next.t("translation:Auto_open_right_panel"),
						control: { type: "toggle", key: "autoOpenRightPanel" },
					},
					{
						name: i18next.t("translation:Enable_Read_Progress_Manager_o"),
						desc: i18next.t("translation:Enable_Read_Progress_Manager"),
						control: { type: "toggle", key: "enableReadProgressManager" },
					},
				],
			},

			{
				type: "group",
				heading: i18next.t("translation:developing"),
				items: [
					{
						name: i18next.t("translation:more_log_o"),
						desc: i18next.t("translation:more_log"),
						control: { type: "toggle", key: "moreLog" },
					},
				],
			},
		];
	}

	// ===================================================================
	// 共享：模板行渲染 / 选项构造 / 书库列表 CRUD
	// ===================================================================

	/** 构造某模板字段的行配置（声明式 render 回调复用，保证与生产侧一致） */
	private templateOpts(field: TemplateField, multiline = false): TemplateSettingOpts {
		switch (field) {
			case "assetsPath":
				return {
					field,
					label: i18next.t("translation:Assets_path_o"),
					desc: i18next.t("translation:Assets_path"),
				placeholder: DEFAULT_ASSETS_TEMPLATE,
				sampleFallback: DEFAULT_ASSETS_TEMPLATE,
				chips: ["savePath", "bookName"],
				known: ASSET_VARS,
				};
			case "mocName":
				return {
					field,
					label: i18next.t("translation:Moc_fileName_o"),
					desc: i18next.t("translation:Moc_fileName"),
					// 默认值为空（与 noteTemplate 同构）：留空由内核兜底为书名
					placeholder: "{{bookName}}",
					sampleFallback: "{{bookName}}",
					chips: ["bookName", "author"],
					known: MOC_VARS,
				};
			case "noteTemplate":
				return {
					field,
					label: i18next.t("translation:noteTemplate_o"),
					desc: i18next.t("translation:noteTemplate"),
					placeholder: "{{content}}",
					sampleFallback: "{{content}}",
					chips: ["content", "title", "chapter_name", "prev", "next"],
					known: NOTE_VARS,
					multiline,
				};
		}
	}

	private onExistingOptions(): Record<string, string> {
		return {
			abort: i18next.t("translation:onExisting_abort"),
			overwrite: i18next.t("translation:onExisting_overwrite"),
			merge: i18next.t("translation:onExisting_merge"),
		};
	}

	private imageFormatOptions(): Record<string, string> {
		return {
			markdown: i18next.t("translation:imageFormat_markdown"),
			wikilink: i18next.t("translation:imageFormat_wikilink"),
		};
	}

	/** 打开「添加书库目录」弹窗（官方风格：多步/需确认的输入收进 Modal） */
	private openAddLibraryModal(): void {
		new PromptModal(this.app, {
			title: i18next.t("translation:Library_add"),
			desc: i18next.t("translation:Library_modal_desc"),
			placeholder: "D:\\Books",
			onSubmit: async (value) => {
				if (!value) return;
				const libs = this.plugin.settings.libraries;
				if (libs.includes(value)) return;
				libs.push(value);
				await this.plugin.saveSettings();
				this.update();
			},
		}).open();
	}

	private async reorderLibraries(oldIndex: number, newIndex: number): Promise<void> {
		const libs = this.plugin.settings.libraries;
		const [moved] = libs.splice(oldIndex, 1);
		libs.splice(newIndex, 0, moved);
		await this.plugin.saveSettings();
		this.update();
	}

	private async deleteLibrary(index: number): Promise<void> {
		this.plugin.settings.libraries.splice(index, 1);
		await this.plugin.saveSettings();
		this.update();
	}

	/**
	 * 模板输入行（声明式 render 回调）：desc 由「说明 + 常用变量 chips +
	 * 校验错误 + 实时样例」组成；输入实时体检未知 {{变量}}（红色、不阻断保存）并同步刷新样例。
	 * 三个模板字段留空即回默认行为（assetsPath 自动回默认模板 / mocName、noteTemplate 内核兜底），
	 * 因此无需 reset 按钮。render 回调不自动保存，需手动 saveSettings。
	 */
	private renderTemplateRow(setting: Setting, opts: TemplateSettingOpts) {
		const { field } = opts;
		const s = this.plugin.settings;
		let errEl!: HTMLElement;
		let previewValueEl!: HTMLElement;

		setting.setName(opts.label).setDesc(
			createFragment((frag) => {
				frag.createSpan({ text: opts.desc });
				const chipsLine = frag.createDiv();
				chipsLine.style.marginTop = "4px";
			chipsLine.createSpan({ text: i18next.t("translation:template_vars") });
			opts.chips.forEach((token) => {
				const chip = chipsLine.createSpan({ text: `{{${token}}}` });
				chip.style.fontFamily = "var(--font-mono)";
				chip.style.color = "var(--text-muted)";
				chip.style.background = "var(--background-modifier-border)";
				chip.style.borderRadius = "4px";
				chip.style.padding = "0 4px";
				chip.style.marginLeft = "4px";
			});
			// 设置行只放常用变量；完整清单指向 Wiki（句式对齐官方「更多语法，请参阅: …」）
			const wikiLine = frag.createDiv();
			wikiLine.style.marginTop = "4px";
			wikiLine.createSpan({ text: i18next.t("translation:template_vars_more") });
			const wikiLink = wikiLine.createEl("a", {
				text: i18next.t("translation:template_vars_doc"),
				href: WIKI_TEMPLATE_VARS_URL,
			});
			wikiLink.setAttr("target", "_blank");
			wikiLink.setAttr("rel", "noopener noreferrer");
				errEl = frag.createDiv();
				errEl.style.color = "var(--text-error)";
				errEl.style.marginTop = "4px";
				errEl.hidden = true;
				// 实时样例预览（对齐官方「日记」的「这是当前所用格式的样例: …」）
				const previewEl = frag.createDiv();
				previewEl.style.marginTop = "4px";
				previewEl.createSpan({ text: i18next.t("translation:template_sample") });
				previewValueEl = previewEl.createSpan();
				previewValueEl.style.fontFamily = "var(--font-mono)";
				previewValueEl.style.color = "var(--text-muted)";
			})
		);

		const bind = (t: TextLike) => {
			t.setPlaceholder(opts.placeholder);
			t.setValue(String(s[field] ?? ""));
			t.onChange((value) => this.onTemplateChange(opts, value, errEl, previewValueEl));
		};
		if (opts.multiline) setting.addTextArea(bind);
		else setting.addText(bind);

		this.refreshRow(opts, String(s[field] ?? ""), errEl, previewValueEl);
	}

	private async onTemplateChange(
		opts: TemplateSettingOpts,
		value: string,
		errEl: HTMLElement,
		previewValueEl: HTMLElement
	) {
		const s = this.plugin.settings;
		// 三个模板字段同构：留空即默认行为（assetsPath / mocName / noteTemplate 由内核兜底）
		s[opts.field] = value;
		this.refreshRow(opts, value, errEl, previewValueEl);
		await this.plugin.saveSettings();
	}

	/** 一次刷新 = 未知变量体检（红色提示）+ 实时样例预览 */
	private refreshRow(
		opts: TemplateSettingOpts,
		value: string,
		errEl: HTMLElement,
		previewValueEl: HTMLElement
	) {
		const unknown = unknownTokens(value, opts.known);
		errEl.hidden = unknown.length === 0;
		errEl.textContent = unknown.length
			? i18next.t("translation:template_var_unknown", { var: unknown.join(", ") })
			: "";
		previewValueEl.textContent = renderSample(opts.field, value, opts.sampleFallback);
	}
}
