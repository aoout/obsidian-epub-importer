/* eslint-disable no-mixed-spaces-and-tabs */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { EpubImporterModal } from "./modals/EpubImporterModal";
import { ZipExporterModal } from "./modals/ZipExporterModal";
import { ZipImporterModal } from "./modals/ZipImporterModal";
import { DEFAULT_SETTINGS, EpubImporterSettings } from "./settings/settings";
import { EpubImporterSettingsTab } from "./settings/settingsTab";
import { getNotesWithTag } from "./utils/obsidianUtils";
import AdmZip from "adm-zip";
import jetpack from "fs-jetpack";
import i18next from "i18next";
import EpubProcessor from "./lib/EpubProcessor";
import * as path from "path";
import { resources, translationLanguage } from "./i18n/i18next";



export default class EpubImporterPlugin extends Plugin {
	// Class properties
	vaultPath: string;
	settings: EpubImporterSettings;
	activeBook: string;
	activeLeaf: WorkspaceLeaf;
	detachLeaf = false;
	private epubProcessor: EpubProcessor;

	// Plugin lifecycle methods
	async onload() {
		// Initialize i18n
		i18next.init({
			lng: translationLanguage,
			fallbackLng: "en",
			resources: resources,
			returnNull: false,
		});

		// Initialize plugin
		//@ts-expect-error
		this.vaultPath = this.app.vault.adapter.basePath;
		await this.loadSettings();
		this.addSettingTab(new EpubImporterSettingsTab(this.app, this));
		this.epubProcessor = new EpubProcessor(this.app, this.settings, this.vaultPath);

		// Register commands
		this.registerCommands();

		// Register event handlers
		this.registerEventHandlers();
	}

	// Settings management
	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// Command registration
	private registerCommands() {
		// Import epub command
		this.addCommand({
			id: "import-epub",
			name: i18next.t("import-epub"),
			callback: () => {
				new EpubImporterModal(this.app, this.settings.libraries, async (result) => {
					await this.epubProcessor.importEpub(result);
				}).open();
			},
		});

		// Sync libraries command
		this.addCommand({
			id: "sync-libraries",
			name: i18next.t("sync-libraries"),
			callback: async () => {
				await this.syncLibraries();
			},
		});

		// Export zip command
		this.addCommand({
			id: "export-zip",
			name: "Export a book to the backup directory in .zip format",
			callback: () => {
				new ZipExporterModal(this.app, this.settings.tag, (bookName) => {
					this.exportBookToZip(bookName);
				}).open();
			},
		});

		// Import zip command
		this.addCommand({
			id: "import-zip",
			name: "Import a .zip book from the backup directory into the vault in .zip format",
			callback: () => {
				new ZipImporterModal(this.app, this.settings.backupPath, (zipPath) => {
					this.importBookFromZip(zipPath);
				}).open();
			},
		});
	}

	// Event handlers registration
	private registerEventHandlers() {
		// Drag and drop handler
		this.registerDomEvent(document, "drop", async (e) => {
			await this.handleDragAndDrop(e);
		});

		// File open handler
		this.registerEvent(
			this.app.workspace.on("file-open", async (file) => {
				await this.handleFileOpen(file);
			})
		);
	}

	private async syncLibraries() {
		const { libraries } = this.settings;
		if (!libraries.length) {
			new Notice(i18next.t("no libraries"));
			return;
		}

		const results = libraries
			.map((library) => jetpack.find(library, { matching: "**/**.epub" }))
			.flat();

		const bookCount = results.length;
		for (const result of results) {
			await this.epubProcessor.importEpub(jetpack.path(result));
		}

		if (bookCount === 0) {
			new Notice(i18next.t("no book in libraries"));
			console.log(i18next.t("no book in libraries"));
		} else {
			const message = i18next
				.t("translation:sync-libraries_r")
				.replace("${n}", bookCount.toString());
			new Notice(message);
			console.log(message);
		}
	}

	private exportBookToZip(bookName: string) {
		const bookPath = path.posix.join(
			this.vaultPath,
			this.settings.savePath,
			bookName
		);
		const zip = new AdmZip();
		zip.addLocalFolder(bookPath);
		const exportPath = path.posix.join(this.settings.backupPath, bookName + ".zip");
		zip.writeZip(exportPath);
	}

	private importBookFromZip(zipPath: string) {
		const bookPath = path.posix.join(
			this.vaultPath,
			this.settings.savePath,
			path.basename(zipPath).split(".zip")[0]
		);
		const zip = new AdmZip(zipPath);
		zip.extractAllTo(bookPath);
	}

	private async handleDragAndDrop(e: DragEvent) {
		if (
			this.settings.byDrag &&
			//@ts-expect-error
			e.toElement.className == "nav-files-container node-insert-event"
		) {
			const files = e.dataTransfer.files;
			if (files.length == 1 && path.extname(files[0].name) == ".epub") {
				//@ts-expect-error
				await this.epubProcessor.importEpub(files[0].path);
				jetpack
					.find(this.vaultPath, {
						matching: "**/**.epub",
					})
					.forEach(jetpack.remove);
			}
		}
	}

	private async handleFileOpen(file: TFile) {
		if (this.settings.leafID && !this.detachLeaf) {
			this.detachLeaf = true;
			this.activeLeaf = this.app.workspace.getLeafById(this.settings.leafID);
			return;
		}
		if (!this.settings.autoOpenRightPanel) return;
		if (!this.app.workspace.getActiveFile()) return;

		const mocPath = this.getMocPath(file);
		if (!mocPath && file.basename != "highlights") {
			this.activeBook = "";
			return this.activeLeaf.detach();
		}

		const bookName = this.app.vault.getAbstractFileByPath(mocPath).parent.name;
		if (this.activeBook == bookName) return;

		await this.updateActiveLeaf(mocPath, bookName);
	}

	private async updateActiveLeaf(mocPath: string, bookName: string) {
		if (this.activeLeaf) this.activeLeaf.detach();
		this.activeBook = bookName;
		this.activeLeaf = this.app.workspace.getRightLeaf(false);
		//@ts-expect-error
		this.settings.leafID = this.activeLeaf.id;
		await this.saveSettings();

		this.activeLeaf.setViewState({
			type: "markdown",
			state: {
				file: mocPath,
				mode: "preview",
				backlinks: false,
				source: false,
			},
		});
		this.activeLeaf.setPinned(true);
		this.app.workspace.revealLeaf(this.activeLeaf);
	}

	getMocPath(note: TFile): string {
		const mocFiles = getNotesWithTag(this.app, this.settings.tag);
		if (mocFiles.includes(note)) return note.path;
		else
			return mocFiles.find((n) => {
				return this.app.metadataCache
					.getCache(n.path)
					.links.some((link) => link.link + ".md" == note.path);
			})?.path;
	}
}
