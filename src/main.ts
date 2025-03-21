import AdmZip from "adm-zip";
import jetpack from "fs-jetpack";
import i18next from "i18next";
import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import * as path from "path";
import EpubProcessor from "./core/EpubProcessor";
import { resources, translationLanguage } from "./i18n/i18next";
import { EpubImporterModal } from "./modals/EpubImporterModal";
import { ZipExporterModal } from "./modals/ZipExporterModal";
import { ZipImporterModal } from "./modals/ZipImporterModal";
import { DEFAULT_SETTINGS, EpubImporterSettings } from "./settings/settings";
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
	settings: EpubImporterSettings = DEFAULT_SETTINGS;
	// @ts-ignore
	private vaultPath: string = this.app.vault.adapter.basePath;
	private epubProcessor: EpubProcessor;
	private activeBook = "";
	private activeLeaf?: WorkspaceLeaf;
	private detachLeaf = false;
	private progressManager: ReadProgressManager;

	async onload() {
		await this.loadSettings();
		await Promise.all([
			this.initI18n(),
			this.loadSettings().then(() => {
				this.epubProcessor = new EpubProcessor(this.app, this.settings, this.vaultPath);
			}),
			this.setupReadProgressManager()
		]);

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

	private loadSettings = async () => Object.assign(this.settings, await this.loadData());

	saveSettings = () => this.saveData(this.settings);

	private getCommands(): CommandConfig[] {
		return [
			{
				id: "import-epub",
				name: i18next.t("translation:import-epub"),
				callback: () =>
					this.createModal(EpubImporterModal, this.settings.libraries, (result) =>
						this.epubProcessor.importEpub(result as string)
					),
			},
			{
				id: "sync-libraries",
				name: i18next.t("translation:sync-libraries"),
				callback: () => this.syncLibraries(),
			},
			{
				id: "open-book",
				name: "Open the book",
				callback: () =>
					this.createModal(
						OpenBookModal,
						getNotesWithTag(this.app, this.settings.tag),
						this.continueBook.bind(this)
					),
			},
			{
				id: "export-zip",
				name: "Export a book to the backup directory in .zip format",
				callback: () =>
					this.createModal(ZipExporterModal, this.settings.tag, (bookName) =>
						this.exportBookToZip(bookName as string)
					),
			},
			{
				id: "import-zip",
				name: "Import a .zip book from the backup directory into the vault in .zip format",
				callback: () =>
					this.createModal(ZipImporterModal, this.settings.backupPath, (zipPath) =>
						this.importBookFromZip(zipPath as string)
					),
			},
		];
	}

	private async continueBook(result: TFile) {
		const links = this.app.metadataCache.getCache(result.path)?.links || [];
		const notes = links
			.map((link) => this.app.vault.getAbstractFileByPath(link.link + ".md"))
			.filter((file): file is TFile => file instanceof TFile);

		const latestNoteByTimestamp = notes.reduce((prev, current) => {
			const prevState = this.progressManager.getNoteState(prev.path)?.timestamp || 0;
			const currentState = this.progressManager.getNoteState(current.path)?.timestamp || 0;

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

		await Promise.all(epubs.map((epub) => this.epubProcessor.importEpub(jetpack.path(epub))));

		this.showSyncResult(epubs.length);
	}

	private showSyncResult(count: number) {
		const message =
			count === 0
				? i18next.t("translation:no book in libraries")
				: i18next.t("translation:sync-libraries_r", { n: count.toString() });
		new Notice(message);
		console.log(message);
	}

	private exportBookToZip(bookName: string) {
		const bookPath = this.getPath(this.settings.savePath, bookName);
		const zip = new AdmZip();
		zip.addLocalFolder(bookPath);
		zip.writeZip(this.getPath(this.settings.backupPath, `${bookName}.zip`));
	}

	private importBookFromZip(zipPath: string) {
		const bookName = path.basename(zipPath, ".zip");
		new AdmZip(zipPath).extractAllTo(this.getPath(this.settings.savePath, bookName));
	}

	private handleDragAndDrop = async (e: DragEvent) => {
		if (!this.settings.byDrag || !this.isDropTarget(e)) return;

		const file = e.dataTransfer?.files[0];
		if (file && path.extname(file.name) === ".epub") {
			// @ts-ignore
			await this.epubProcessor.importEpub(file.path);
			this.cleanEpubFiles();
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

	private getPath(...segments: string[]) {
		return path.posix.join(this.vaultPath, ...segments);
	}

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

	private cleanEpubFiles() {
		jetpack.find(this.vaultPath, { matching: "**/**.epub" }).forEach(jetpack.remove);
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
