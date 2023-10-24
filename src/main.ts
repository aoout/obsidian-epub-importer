/* eslint-disable no-mixed-spaces-and-tabs */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
	Plugin,
	TFile,
	WorkspaceLeaf,
	htmlToMarkdown,
	normalizePath,
	stringifyYaml,
} from "obsidian";
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
			if (!this.settings.autoOpenRightPanel) return;
			if (!file) return;
			const bookNotePath = this.findBookNote(file.path);
			if (!bookNotePath) return;
			const bookName = bookNotePath.split("/")[bookNotePath.split("/").length -2];
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

		this.app.workspace.on("file-open", (file) => {
			if (!this.settings.allbooks) return;
			const files = this.app.vault.getMarkdownFiles();
			const files_with_tag = [] as TFile[];
			files.forEach((file) => {
				const tags =
          this.app.metadataCache.getFileCache(file)?.frontmatter?.tags;
				if (!tags) return;
				if (tags.includes(this.settings.tags[0])) {
					files_with_tag.push(file);
				}
			});
			const allBooks = this.app.vault.getAbstractFileByPath("AllBooks.md");
			if (allBooks && allBooks instanceof TFile) {
				this.app.vault.modify(
					allBooks,
					files_with_tag
						.map((file) => `- [[${file.path}|${file.parent?.name}]]`)
						.join("\n")
				);
			} else {
				this.app.vault.create(
					"AllBooks.md",
					files_with_tag
						.map((file) => `[[${file.path}|${file.parent?.name}]]`)
						.join("\n")
				);
			}
		});
	}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	onunload() {}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async import(epubPath: string) {
		this.parser = new EpubParser(epubPath);
		await this.parser.init();

		const epubName = path.basename(epubPath, path.extname(epubPath)).trim();
		this.propertys = {};
		await this.app.vault.createFolder(this.settings.savePath +  "/"+epubName);
		this.parser.chapters.forEach((element,index) => {
			this.createChapter(
				epubName,
				element,
				path.join(epubName, normalizePath(element.name.replace("/", "&"))),
				[index+1]
			);
		});

		this.copyImages(epubName);
		this.propertys.tags = this.settings.tags;

		this.BookNote =
      "---\n" + stringifyYaml(this.propertys) + "\n---\n" + this.BookNote;
		this.app.vault.create(this.settings.savePath +  "/"+epubName + "//" + `${epubName}.md`, this.BookNote);
	}

	copyImages(epubName: string) {
		const imagesPath = path.join(this.vaultPath, this.settings.savePath,epubName, "images");
		jetpack.copy(this.parser.tmpPath, imagesPath, {
			matching: ["*.jpg", "*.jpeg", "*.png"],
		});
		jetpack.find(imagesPath, {
			matching: ["*.jpg", "*.jpeg", "*.png"],
		}).forEach((file) => {
			const fileName = path.basename(file);
			const newPath = path.join(imagesPath, fileName);
			if (file!=newPath) jetpack.move(file, newPath);
		});
		const folders = jetpack.find(imagesPath, {
			matching: ["*"],
			directories: true,
			files: false,
		});
		folders.forEach((folder) => {
			jetpack.remove(folder);
		});
		jetpack.remove(this.parser.tmpPath);

		this.propertys.cover = epubName + "/" + "images" +"/" +  path.basename(this.parser.coverPath);
	}

	createChapter(epubName: string, cpt: Chapter, notePath: string, serialNumber:number[]) {
		const noteName = path.basename(notePath);
		const level = notePath.split(path.sep).length - 2;
		console.log("cpt",cpt);
		const content = NoteParser.getParseredNote(
			htmlToMarkdown(cpt.html?cpt.html:""),
			epubName
		);

		if (cpt.subItems.length) {
			this.app.vault.createFolder(this.settings.savePath +  "/"+notePath);

			cpt.subItems.forEach((element: Chapter,index) => {
				this.createChapter(
					epubName,
					element,
					path.join(notePath, normalizePath(element.name.replace("/", "&"))),
					serialNumber.concat([index+1])
				);
			});
			notePath = path.join(notePath, noteName);
		}
		if (this.settings.serialNumber) {
			notePath = path.dirname(notePath)+"/"+ serialNumber.join(".")+" " +noteName;
		}
		this.app.vault.create( this.settings.savePath +  "/"+notePath + ".md", content);
		this.BookNote += `${"\t".repeat(level)}- [[${notePath.replace(
			/\\/g,
			"/"
		)}|${noteName}]]\n`;
	}

	findBookNote(notePath: string) {
		const firstLevel = notePath.replace(this.settings.savePath+"/", "").split("/")[0];
		console.log("!",firstLevel);
		const bookNotePath = this.settings.savePath+"/" + firstLevel + "/" + firstLevel + ".md";
		const bookNote = this.app.vault.getAbstractFileByPath(bookNotePath);
		if (!bookNote) return;
		return bookNotePath;
	}
}
