/* eslint-disable no-mixed-spaces-and-tabs */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Notice, Plugin, TFile, WorkspaceLeaf, parseYaml } from "obsidian";
import { Chapter, EpubParser } from "./lib/EpubParser";
import { create } from "./lib/TurndownService";
import { EpubImporterModal } from "./modals/EpubImporterModal";
import { ZipExporterModal } from "./modals/ZipExporterModal";
import { ZipImporterModal } from "./modals/ZipImporterModal";
import { DEFAULT_SETTINGS, EpubImporterSettings } from "./settings/settings";
import { EpubImporterSettingsTab } from "./settings/settingsTab";
import { getNotesWithTag, tFrontmatter, templateWithVariables } from "./utils/obsidianUtils";
import { normalize } from "./utils/utils";

import AdmZip from "adm-zip";
import jetpack from "fs-jetpack";
import i18next from "i18next";
import beautify from "js-beautify";
import * as path from "path";
import { resources, translationLanguage } from "./i18n/i18next";

export default class EpubImporterPlugin extends Plugin {
	// Class properties
	vaultPath: string;
	settings: EpubImporterSettings;
	parser: EpubParser;
	BookNote: string;
	assetsPath: string;
	properties: any;
	activeBook: string;
	activeLeaf: WorkspaceLeaf;
	detachLeaf = false;

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
					await this.importEpub(result);
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

	// Core functionality methods
	async importEpub(epubPath: string) {
		const epubName = normalize(path.basename(epubPath, path.extname(epubPath)).trim());
		const folderPath = this.setupFolderPath(epubName);
		if (!folderPath) return;

		await this.initializeParser(epubPath, epubName);
		await this.createBookFolder(folderPath);

		this.copyImages();

		if (this.settings.oneNote) {
			await this.createSingleNote(epubName, folderPath);
		} else {
			await this.createChapterNotes(folderPath, epubName);
		}
		
		jetpack.remove(this.parser.tmpPath);
		this.showSuccessNotice(epubName);
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
			await this.importEpub(jetpack.path(result));
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
				await this.importEpub(files[0].path);
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

	// Helper methods
	private setupFolderPath(epubName: string): string | null {
		const folderPath = path.posix.join(this.settings.savePath, normalize(epubName));
		
		if (jetpack.exists(path.posix.join(this.vaultPath, folderPath))) {
			if (this.settings.removeDuplicateFolders) {
				jetpack.remove(path.posix.join(this.vaultPath, folderPath));
			} else {
				new Notice("Duplicate folder already exists.");
				return null;
			}
		}
		return folderPath;
	}

	private async createBookFolder(folderPath: string) {
		await this.app.vault.createFolder(folderPath);
	}

	private async initializeParser(epubPath: string, epubName: string) {
		this.assetsPath = templateWithVariables(this.settings.assetsPath, {
			bookName: epubName,
			savePath: this.settings.savePath,
		});

		this.parser = new EpubParser(epubPath, this.settings.moreLog);
		await this.parser.init();
		if (this.settings.moreLog) console.log("toc is: ", this.parser.toc);

		this.properties = parseYaml(templateWithVariables(this.settings.mocPropertysTemplate, this.parser.meta));
		this.properties.tags = (this.properties.tags ?? []).concat([this.settings.tag]);
		this.BookNote = "";
	}

	private async createSingleNote(epubName: string, folderPath: string) {
		this.mergeChapters();
		const content = this.generateSingleNoteContent();
		
		const notePath = this.settings.oneFolder ? 
			path.posix.join(folderPath, epubName) : 
			folderPath;
			
		await this.app.vault.create(
			notePath + ".md",
			tFrontmatter(this.properties) + "\n" + content
		);
	}

	private mergeChapters() {
		[...this.parser.chapters]
			.filter(cpt => cpt.level != 0)
			.sort((a, b) => b.level - a.level)
			.forEach(cpt => cpt.parent.sections.push(...cpt.sections));
	}

	private generateSingleNoteContent(): string {
		return this.parser.chapters
			.filter(cpt => cpt.level == 0)
			.map(cpt => cpt.sections.map(st => this.htmlToMD(st.html)).join("\n\n"))
			.join("\n\n");
	}

	private async createChapterNotes(folderPath: string, epubName: string) {
		this.mergeChaptersByGranularity();
		const filteredChapters = this.parser.chapters.filter(cpt => cpt.level <= this.settings.granularity);

		for (const [index, chapter] of filteredChapters.entries()) {
			const notePath = await this.createChapterNote(chapter, folderPath, index, filteredChapters);
			this.BookNote += `${"\t".repeat(chapter.level)}- [[${notePath}|${chapter.name}]]\n`;
		}

		await this.createMocFile(folderPath, epubName);
	}

	private mergeChaptersByGranularity() {
		[...this.parser.chapters]
			.filter(cpt => cpt.level > this.settings.granularity)
			.sort((a, b) => b.level - a.level)
			.forEach(cpt => cpt.parent.sections.push(...cpt.sections));
	}

	private async createChapterNote(chapter: Chapter, folderPath: string, index: number, allChapters: Chapter[]): Promise<string> {
		if (chapter.name.startsWith("... ")) {
			chapter.sections[0].name = chapter.name.replace("... ", "");
		}

		const paths = this.getChapterPaths(chapter);
		const notePath = path.posix.join(folderPath, ...paths.map(normalize));
		
		await this.app.vault.createFolder(path.dirname(notePath)).catch(() => {/**/});

		const content = this.generateChapterContent(chapter, index, allChapters);
		
		try {
			await this.app.vault.create(notePath + ".md", content);
		} catch (error) {
			console.warn(`Failed to create file at ${notePath}.md: ${error}`);
			console.warn(
				"If such errors are few in this parsing process, it could be because the epub contains some repeated or wrong navPoints. If this is the case, it will not cause any damage to the content of the book."
			);
		}

		return notePath;
	}

	private getChapterPaths(chapter: Chapter): string[] {
		const paths = [chapter.name];
		const getPaths = (cpt: Chapter) => {
			if (cpt.parent) {
				paths.unshift(cpt.parent.name);
				getPaths(cpt.parent);
			}
		};
		getPaths(chapter);
		
		if (chapter.level < this.settings.granularity && chapter.subItems.length != 0) {
			paths.push(normalize(chapter.name));
		}
		return paths;
	}

	private generateChapterContent(chapter: Chapter, index: number, allChapters: Chapter[]): string {
		let content = "";
		
		if (this.settings.notePropertysTemplate) {
			const template = templateWithVariables(this.settings.notePropertysTemplate, {
				created_time: Date.now().toString(),
			});
			content += tFrontmatter(parseYaml(template)) + "\n";
		}

		content += chapter.sections.map(st => this.htmlToMD(st.html)).join("\n\n");

		if (this.settings.booknavIntegration) {
			content += this.generateBookNav(index, allChapters);
		}

		return content;
	}

	private generateBookNav(index: number, chapters: Chapter[]): string {
		let nav = "\n\n```booknav\n";
		if (index > 0) {
			nav += `[[${chapters[index - 1].name}|prev]]\n`;
		}
		if (index < chapters.length - 1) {
			nav += `[[${chapters[index + 1].name}|next]]\n`;
		}
		nav += "```";
		return nav;
	}

	private async createMocFile(folderPath: string, epubName: string) {
		const mocPath = path.posix.join(
			folderPath,
			templateWithVariables(this.settings.mocName, { bookName: epubName })
		) + ".md";
		
		await this.app.vault.create(
			mocPath,
			tFrontmatter(this.properties) + "\n" + this.BookNote
		);
	}

	private showSuccessNotice(epubName: string) {
		console.log(`Successfully imported ${epubName}`);
		new Notice(`Successfully imported ${epubName}`);
	}

	copyImages() {
		const imagesPath = path.posix.join(this.vaultPath, this.assetsPath);
		const imageFiles = jetpack.find(this.parser.tmpPath, { 
			matching: ["*.jpg", "*.jpeg", "*.png"] 
		});

		imageFiles.forEach(file => {
			const destPath = path.posix.join(imagesPath, path.basename(file));
			jetpack.copy(file, destPath, { overwrite: true });
		});

		if (this.parser.coverPath) {
			this.properties.cover = path.posix.join(
				this.assetsPath, 
				path.basename(this.parser.coverPath)
			);
		}
	}

	htmlToMD(htmlString: string): string {
		if (this.settings.reformatting) {
			htmlString = beautify.html(htmlString, { indent_size: 0 });
		}

		// Remove empty tables
		const doc = new DOMParser().parseFromString(htmlString, "text/html");
		doc.querySelectorAll("table").forEach(table => {
			const isEmpty = !Array.from(table.children).some(child => child.childElementCount > 0);
			if (isEmpty) table.remove();
		});

		// Convert to markdown
		const turndownService = create(this.assetsPath, this.settings.imageFormat);
		let markdown = turndownService.turndown(htmlString) || htmlString.replace(/<[^>]+>/g, "");

		// Normalize heading levels
		const hasH1 = /^# [^\n]+/m.test(markdown);
		if (!hasH1) {
			const headingMatch = markdown.match(/^(#{1,6}) [^\n]+/m);
			if (headingMatch) {
				const levelDiff = headingMatch[1].length - 1;
				markdown = markdown.replace(
					/^(#{1,6}) /gm,
					(_, hashes) => '#'.repeat(Math.max(1, hashes.length - levelDiff)) + ' '
				);
			}
		}

		return markdown;
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
