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
	parseYaml,
	stringifyYaml,
} from "obsidian";
import { Chapter, EpubParser } from "./lib/EpubParser";
import { EpubImporterModal } from "./modal";
import { NoteParser } from "./lib/NoteParser";
import { DEFAULT_SETTINGS, EpubImporterSettings } from "./settings/settings";
import { EpubImporterSettingsTab } from "./settings/settingsTab";

import * as path from "path";
import jetpack from "fs-jetpack";
import { getNotesWithTag } from "./utils";

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
			const files_with_tag = getNotesWithTag(this.app,this.settings.tag);
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
		this.BookNote = "";

		const epubName = path.basename(epubPath, path.extname(epubPath)).trim();
		let defaultPropertys = this.settings.propertysTemplate.replace("{{bookName}}",epubName);

		this.parser.meta.forEach((value,key)=>{
			defaultPropertys = defaultPropertys.replace("{{"+key+"}}",value);
		});

		this.propertys = parseYaml(defaultPropertys);

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
		this.propertys.tags = (this.propertys.tags?this.propertys.tags:[]).concat([this.settings.tag]);
		console.log(this.propertys);
		this.BookNote = "---\n" + stringifyYaml(this.propertys) + "\n---\n" + this.BookNote;
		this.app.vault.create(this.settings.savePath +  "/"+epubName + "//" + `${epubName}.md`, this.BookNote);
		jetpack.remove(this.parser.tmpPath);
	}

	copyImages(epubName: string) {
		const imagesPath = path.join(this.vaultPath, this.settings.savePath, epubName, "images");
		jetpack.find(
			this.parser.tmpPath,
			{matching: ["*.jpg", "*.jpeg", "*.png"]}
		).forEach((file)=>{
			jetpack.copy(file,path.join(imagesPath,path.basename(file)));
		});
		this.propertys.cover = path.join(epubName,"images",path.basename(this.parser.coverPath));
	}

	createChapter(epubName: string, cpt: Chapter, notePath: string, serialNumber:number[]) {
		console.log(cpt);
		const noteName = path.basename(notePath);
		const level = serialNumber.length - 1;
		if(cpt.subItems.length){
			notePath = path.join(notePath, noteName);
		}
		if (this.settings.serialNumber) {
			notePath = path.dirname(notePath)+"/"+ serialNumber.join(".")+" " +noteName;
		}
		this.BookNote += `${"\t".repeat(level)}- [[${notePath.replace(
			/\\/g,
			"/"
		)}|${noteName}]]\n`;
		const content = NoteParser.getParseredNote(
			htmlToMarkdown(cpt.html?cpt.html:""),
			epubName
		);

		if (cpt.subItems.length) {
			this.app.vault.createFolder(path.join(this.settings.savePath,notePath));

			cpt.subItems.forEach((element: Chapter,index) => {
				this.createChapter(
					epubName,
					element,
					path.join(notePath, normalizePath(element.name.replace("/", "&"))),
					serialNumber.concat([index+1])
				);
			});
			
		}
		
		this.app.vault.create( this.settings.savePath +  "/"+notePath + ".md", content);
		
	}

	findBookNote(notePath: string):string {
		const epubName = notePath.replace(this.settings.savePath+"/", "").split("/")[0];
		const bookNotePath =path.join(this.settings.savePath,epubName,epubName+".md");
		const bookNote = this.app.vault.getAbstractFileByPath(bookNotePath);
		if (!bookNote) return;
		return bookNotePath;
	}
}
