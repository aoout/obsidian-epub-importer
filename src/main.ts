/* eslint-disable no-mixed-spaces-and-tabs */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Plugin, TFile, WorkspaceLeaf, normalizePath, stringifyYaml} from "obsidian";
import { Chapter, EpubParser } from "./lib/EpubParser";
import { EpubImporterModal } from "./modal";
import { NoteParser } from "./lib/NoteParser";
import { DEFAULT_SETTINGS, EpubImporterSettings } from "./settings/settings";
import { EpubImporterSettingsTab } from "./settings/settingsTab";

import * as path from "path";
import jetpack from "fs-jetpack";

export default class EpubImporterPlugin extends Plugin {
	vaultPath: string;
	settings: EpubImporterSettings;
	parser: EpubParser;
	BookNote: string;
	propertys: any;
	activeBook: string;
	activeLeaf: WorkspaceLeaf;
	async onload() {
		//@ts-ignore
		this.vaultPath = this.app.vault.adapter.basePath;
		await this.loadSettings();
		this.addSettingTab(new EpubImporterSettingsTab(this.app, this));
		this.addCommand({
			id: "import-epub",
			name: "Import epub to your vault",
			callback: () => {
				new EpubImporterModal(this.app, this, async (result) => {
					await this.import(result);
				}).open();
			},
		});

		this.app.workspace.on("file-open", (file) => {
			if(!this.settings.autoOpenRightPanel) return;
			if (!file) return;
			const bookNotePath = this.findBookNote(file.path);

			if (!bookNotePath) return;
			const bookName = bookNotePath.split("/")[0];
			if (this.activeBook == bookName) return;
			if (this.activeLeaf) this.activeLeaf.detach();
			this.activeBook = bookName;
			this.activeLeaf = this.app.workspace.getRightLeaf(false);
			this.activeLeaf.setViewState({
				type: "markdown",
				state: {
					file: bookNotePath,
					mode: "preview",
					backlinks: false,
					source: false,
				},
			});
			this.app.workspace.revealLeaf(this.activeLeaf);
		});

		this.app.workspace.on("file-open",(file)=>{
			const files = this.app.vault.getMarkdownFiles();
			const files_with_tag = [] as TFile [];
			files.forEach( (file) => {
				const tags = this.app.metadataCache.getFileCache(file)?.frontmatter?.tags;
				if(!tags) return;
				if (tags.includes(this.settings.tags[0])) {
					files_with_tag.push(file);
				}
			});
			const allBooks = this.app.vault.getAbstractFileByPath("AllBooks.md");
			if(allBooks && allBooks instanceof TFile){
				this.app.vault.modify(allBooks,files_with_tag.map(file => `- [[${file.path}|${file.parent?.name}]]`).join("\n"));
			}
			else{
				this.app.vault.create("AllBooks.md",files_with_tag.map(file => `[[${file.path}|${file.parent?.name}]]`).join("\n"));
			}

		});
	}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	onunload() {}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async import(epubPath: string) {
		this.parser = new EpubParser(epubPath);
		await this.parser.init();

		const epubName = path.basename(epubPath, path.extname(epubPath)).trim();
		this.propertys = {};
	 	await this.app.vault.createFolder(epubName);

		 this.parser.toc.forEach((element) => {
			this.createChapter(
				epubName,
				element,
				path.join(epubName, normalizePath(element.name))
			);
		});

		this.copyImages(epubName);
		this.propertys.tags = this.settings.tags;

		this.BookNote = "---\n"+stringifyYaml(this.propertys)+"\n---\n" + this.BookNote;
		this.app.vault.create(
			epubName + "//" + `${epubName}.md`,
			this.BookNote
		);
	}

	copyImages(epubName:string) {
		const imagesPath = path.join(this.vaultPath,epubName,"images");
		jetpack.copy(
			this.parser.tmpPath,
			imagesPath,
			{matching:["*.jpg","*.jpeg","*.png"]}
		);

		this.propertys.cover=  path.basename(this.parser.coverPath);
	}

	createChapter(epubName: string, cpt: Chapter, notePath: string) {
		const noteName = path.basename(notePath);
		const level = notePath.split(path.sep).length - 2;
		let content = NoteParser.getParseredNote(cpt.getMarkdown(), epubName);

		if (cpt.subItems.length) {
			const vaildSubItems = cpt.subItems.filter((element: Chapter) => {
				return element.getFileName() != cpt.getFileName();
			});
			if (vaildSubItems.length == 1 && cpt.subItems.length > 1) {
				content +=
					"\n" +
					NoteParser.getParseredNote(
						vaildSubItems[0].getMarkdown(),
						epubName
					);
			} else if (vaildSubItems.length != 0) {
				this.app.vault.createFolder(notePath);

				vaildSubItems.forEach((element: Chapter) => {
					this.createChapter(
						epubName,
						element,
						path.join(notePath, normalizePath(element.name))
					);
				});
				notePath = path.join(notePath, noteName);
			}
		}
		this.app.vault.create(notePath + ".md", content);
		this.BookNote += `${"\t".repeat(level)}- [[${notePath.replace(
			/\\/g,
			"/"
		)}|${noteName}]]\n`;
	}

	findBookNote(notePath: string) {
		const firstLevel = notePath.split("/")[0];
		const bookNotePath = firstLevel + "/" + firstLevel + ".md";

		const bookNote = this.app.vault.getAbstractFileByPath(bookNotePath);
		if (!bookNote) return;
		return bookNotePath;
	}
}