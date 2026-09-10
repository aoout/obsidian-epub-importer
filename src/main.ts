import jetpack from "fs-jetpack";
import i18next from "i18next";
import { ConfirmationModal, Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import * as path from "path";
import { resources, translationLanguage } from "./i18n/i18next";
import { EpubImporterModal } from "./modals/EpubImporterModal";
import { runImportNext } from "./nextIntegration";
import { DEFAULT_SETTINGS, migrateSettings, EpubImporterSettings } from "./settings/settings";
import { EpubImporterSettingsTab } from "./settings/settingsTab";
import { getNotesWithTag } from "./utils/obsidianUtils";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { OpenBookModal } from "./modals/OpenBookModal";
import { ReadProgressManager } from "./modules/ReadProgressManager";

interface CommandConfig {
	id: string;
	name: string;
	callback: () => void;
}

export default class EpubImporterPlugin extends Plugin {
	settings: EpubImporterSettings = { ...DEFAULT_SETTINGS };
	// @ts-ignore
	private vaultPath: string = this.app.vault.adapter.basePath;
	private activeBook = "";
	private activeLeaf?: WorkspaceLeaf;
	private detachLeaf = false;
	private progressManager?: ReadProgressManager;

	async onload() {
		await this.loadSettings();
		await Promise.all([this.initI18n(), this.setupReadProgressManager()]);

		this.addSettingTab(new EpubImporterSettingsTab(this.app, this));
		this.registerCommands(this.getCommands());
		this.registerEventHandlers();
	}

	private async setupReadProgressManager() {
		if(!this.settings.enableReadProgressManager) return;
		this.progressManager = new ReadProgressManager(this.app);
		await this.progressManager.initialize();

		this.registerEvent(
			this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) =>
				this.progressManager.renameFile(oldPath, file.path)
			)
		);
		this.registerEvent(
			this.app.workspace.on("file-open", (file: TFile | null) =>
				this.progressManager.restoreState(file.path)
			)
		);
		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) =>
				this.progressManager.deleteFile(file.path)
			)
		);
		this.registerInterval(
			window.setInterval(() => {
				const file = this.app.workspace.getActiveFile();
				if (file) {
					const state = this.progressManager.getCurrentState();
					if (state) {
						this.progressManager.saveState(file.path, state);
					}
				}
			}, 100)
		);
		this.registerInterval(window.setInterval(() => this.progressManager.saveDatabase(), 500));
		this.registerEvent(
			this.app.workspace.on("quit", () => this.progressManager.saveDatabase())
		);
	}

	private async initI18n() {
		await i18next.init({
			lng: translationLanguage,
			fallbackLng: "en",
			resources,
			returnNull: false,
		});
	}

	private loadSettings = async () => {
		const raw = (await this.loadData()) as Record<string, unknown> | null;
		this.settings = migrateSettings(raw);
		// 迁移若改变了结构（v1 → v2），立即回写固化；键序无关比较
		const keys = [
			...new Set([...(raw ? Object.keys(raw) : []), ...Object.keys(this.settings)]),
		].sort();
		const changed = JSON.stringify(raw ?? null, keys) !== JSON.stringify(this.settings, keys);
		if (changed) await this.saveData(this.settings);
	};

	saveSettings = () => this.saveData(this.settings);

	private getCommands(): CommandConfig[] {
		return [
			{
				id: "import-epub",
				name: i18next.t("translation:import-epub"),
				callback: () =>
					this.createModal(EpubImporterModal, this.settings.libraries, (result) =>
						runImportNext(this.app, result as string, this.settings)
					),
			},
			{
				id: "sync-libraries",
				name: i18next.t("translation:sync-libraries"),
				callback: () => this.syncLibraries(),
			},
			{
				id: "open-book",
				name: i18next.t("translation:open-book"),
				callback: () =>
					this.createModal(
						OpenBookModal,
						getNotesWithTag(this.app, this.settings.tag),
						this.continueBook.bind(this)
					),
			},
		];
	}

	private async continueBook(result: TFile) {
		const links = this.app.metadataCache.getCache(result.path)?.links || [];
		const notes = links
			.map((link) => this.app.vault.getAbstractFileByPath(link.link + ".md"))
			.filter((file): file is TFile => file instanceof TFile);

		// 空书（仅 MOC、无章节链接）：直接打开 MOC 本身
		if (notes.length === 0) {
			await this.app.workspace.openLinkText(result.path, "");
			return;
		}

		// 阅读进度管理未开启（默认配置）：无时间戳可比对，按章节顺序打开首篇
		const manager = this.progressManager;
		if (!manager) {
			await this.app.workspace.openLinkText(notes[0].path, "");
			return;
		}

		const latestNoteByTimestamp = notes.reduce((prev, current) => {
			const prevState = manager.getNoteState(prev.path)?.timestamp || 0;
			const currentState = manager.getNoteState(current.path)?.timestamp || 0;

			return prevState >= currentState ? prev : current;
		});

		await this.app.workspace.openLinkText(latestNoteByTimestamp.path, "");
	}

	private registerCommands(commands: CommandConfig[]) {
		commands.forEach((cmd) => this.addCommand(cmd));
	}

	private registerEventHandlers() {
		this.registerDomEvent(document, "drop", this.handleDragAndDrop);
		this.registerEvent(this.app.workspace.on("file-open", this.handleFileOpen));
	}

	private createModal<T>(
		ModalClass: new (...args: unknown[]) => T,
		param: unknown,
		callback: (result: unknown) => void
	) {
		// @ts-ignore
		new ModalClass(this.app, param, callback).open();
	}

	private async syncLibraries() {
		const { libraries } = this.settings;
		if (!libraries.length) return this.showNotice(i18next.t("translation:no libraries"));

		const epubs = libraries.flatMap((lib) => jetpack.find(lib, { matching: "**/**.epub" }));
		await this.importEpubsWithConcurrency(epubs);

		this.showSyncResult(epubs.length);
	}

	private getSyncImportConcurrency() {
		const raw = Math.floor(this.settings.syncImportConcurrency ?? 3);
		return Math.max(1, raw);
	}

	private async importEpubsWithConcurrency(epubs: string[]) {
		if (!epubs.length) return;
		const concurrency = Math.min(this.getSyncImportConcurrency(), epubs.length);
		let index = 0;
		const worker = async () => {
			while (index < epubs.length) {
				const epub = epubs[index++];
				// 批量同步：静默模式（不弹逐本 Notice、不逐个打开 MOC）
				await runImportNext(this.app, jetpack.path(epub), this.settings, { silent: true });
			}
		};
		await Promise.all(Array.from({ length: concurrency }, worker));
	}

	private showSyncResult(count: number) {
		const message =
			count === 0
				? i18next.t("translation:no book in libraries")
				: i18next.t("translation:sync-libraries_r", { n: count.toString() });
		new Notice(message);
		console.log(message);
	}

	private handleDragAndDrop = async (e: DragEvent) => {
		if (!this.settings.byDrag || !this.isDropTarget(e)) return;

		const file = e.dataTransfer?.files[0];
		if (file && path.extname(file.name) === ".epub") {
			// @ts-ignore - 拖入文件的本地绝对路径，Electron 下存在
			const epubPath = file.path as string;
			if (!epubPath) return;
			await runImportNext(this.app, epubPath, this.settings);
			await this.trashSourceEpub(epubPath);
		}
	};

	private handleFileOpen = async (file: TFile | null) => {
		if (!file || !this.shouldHandleFileOpen()) return;

		const mocPath = this.getMocPath(file);
		if (!mocPath && file.basename !== "highlights") {
			this.activeBook = "";
			return this.activeLeaf?.detach();
		}

		const bookName = this.app.vault.getAbstractFileByPath(mocPath)?.parent.name;
		if (bookName && bookName !== this.activeBook) {
			await this.updateActiveLeaf(mocPath, bookName);
		}
	};

	private isDropTarget(e: DragEvent) {
		return (e.target as HTMLElement)?.className === "nav-files-container node-insert-event";
	}

	private shouldHandleFileOpen() {
		if (this.settings.leafID && !this.detachLeaf) {
			this.detachLeaf = true;
			this.activeLeaf = this.app.workspace.getLeafById(this.settings.leafID);
			return false;
		}
		return this.settings.autoOpenRightPanel;
	}

	/**
	 * byDrag 导入后删除「源文件」（插件既定行为）。
	 * 关键修复：只删除本次拖入的那一个文件 —— 不再像旧版那样扫描整个 vault 删除所有 epub。
	 *  - 源文件位于 vault 内：优先 Vault.trash（进 Obsidian 回收站，可恢复）。
	 *  - 源文件在 vault 外（拖入的外部文件系统路径，常见情形）：无回收站可用，
	 *    硬删除不可逆，删除前用 ConfirmationModal 二次确认。
	 */
	private async trashSourceEpub(epubPath: string) {
		if (!epubPath.toLowerCase().endsWith(".epub")) return;

		// 归一化分隔符再比对：Windows 上拖入路径是反斜杠，vaultPath 是正斜杠
		const norm = (p: string) => p.replace(/\\/g, "/");
		const inVault = norm(epubPath).startsWith(norm(this.vaultPath));
		if (inVault) {
			const relPath = path.relative(this.vaultPath, epubPath).split(path.sep).join("/");
			const file = this.app.vault.getAbstractFileByPath(relPath);
			if (file instanceof TFile) {
				await this.app.vault.trash(file, true);
				return;
			}
		}

		// vault 外：硬删除不可逆，二次确认
		if (!jetpack.exists(epubPath)) return;
		const confirmed = await this.confirmSourceDeletion(path.basename(epubPath));
		if (confirmed) jetpack.remove(epubPath);
	}

	/** 删除源文件前的二次确认（外部文件硬删除不可逆，必须显式确认） */
	private confirmSourceDeletion(fileName: string): Promise<boolean> {
		return new Promise((resolve) => {
			let confirmed = false;
			const modal = new ConfirmationModal(this.app);
			modal.setTitle(i18next.t("translation:confirm_delete_source_title"));
			modal.setContent(
				i18next.t("translation:confirm_delete_source_desc", { file: fileName })
			);
			modal.addButton((btn) =>
				btn
					.setButtonText(i18next.t("translation:confirm_delete_source_btn"))
					.setWarning()
					.setCta()
					.onClick(() => {
						confirmed = true;
						modal.close();
					})
			);
			modal.addCancelButton(i18next.t("translation:cancel"));
			modal.onClose = () => resolve(confirmed);
			modal.open();
		});
	}

	private async updateActiveLeaf(mocPath: string, bookName: string) {
		this.activeLeaf?.detach();
		this.activeBook = bookName;
		this.activeLeaf = this.app.workspace.getRightLeaf(false);
		// @ts-ignore
		this.settings.leafID = this.activeLeaf.id;
		await this.saveSettings();

		await this.activeLeaf.setViewState({
			type: "markdown",
			state: { file: mocPath, mode: "preview" },
		});
		this.activeLeaf.setPinned(true);
		this.app.workspace.revealLeaf(this.activeLeaf);
	}

	private getMocPath(note: TFile): string | undefined {
		const mocFiles = getNotesWithTag(this.app, this.settings.tag);
		return mocFiles.includes(note)
			? note.path
			: mocFiles.find((n) => this.hasLinkTo(note, n))?.path;
	}

	private hasLinkTo(note: TFile, moc: TFile) {
		return (
			this.app.metadataCache
				.getCache(moc.path)
				?.links.some((link) => link.link + ".md" === note.path) ?? false
		);
	}

	private showNotice(message: string) {
		new Notice(message);
	}
}
