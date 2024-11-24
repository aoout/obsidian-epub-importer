/* eslint-disable @typescript-eslint/no-explicit-any */

import extract from "extract-zip";
import jetpack from "fs-jetpack";
import * as path from "path";
import * as xml2js from "xml2js";
import { Chapter, Section } from "./types";
import { OPFParser } from "./OPFParser";
import { NCXParser } from "./NCXParser";
import { ContentSplitter } from "./ContentSplitter";

export class EpubParser {
	epubPath: string;
	tmpPath: string;
	opfFilePath: string;
	ncxFilePath: string;
	coverPath: string;

	opfParser: OPFParser;
	ncxParser: NCXParser;
	meta: object;

	toc: Chapter[] = [];
	chapters: Chapter[] = [];
	sections: Section[];

	moreLog: boolean;

	constructor(path: string, moreLog: boolean) {
		this.epubPath = path;
		this.moreLog = moreLog;
	}

	async init() {
		try {
			await this.extractEpub();
			await this.parseOPFandNCX();
			await this.parseContent();
		} catch (e) {
			console.log(e);
			throw new Error("failed to parse the .epub file");
		}
	}

	private async extractEpub() {
		this.tmpPath = jetpack.tmpDir().path();
		if (this.moreLog) console.log("tmp folder path is: ", this.tmpPath);

		if (path.extname(this.epubPath) != "") {
			await extract(this.epubPath, { dir: this.tmpPath });
		} else {
			jetpack.copy(this.epubPath, this.tmpPath, { overwrite: true });
		}
	}

	private async parseOPFandNCX() {
		const parser = new xml2js.Parser();

		const opfFile = jetpack.find(this.tmpPath, { matching: "**/*.opf" })[0];
		const opfData = jetpack.read(opfFile);
		const opfContent = await parser.parseStringPromise(opfData);
		this.opfFilePath = opfFile;
		this.opfParser = new OPFParser(opfFile, opfContent);

		try {
			const ncxFile = jetpack.find(this.tmpPath, { matching: "**/*.ncx" })[0];
			const ncxData = jetpack.read(ncxFile);
			const ncxContent = await parser.parseStringPromise(ncxData);
			this.ncxFilePath = ncxFile;
			this.ncxParser = new NCXParser(ncxFile, ncxContent);
		} catch (error) {
			console.log(
				"This epub does not have a .ncx file, parsing will be based on the .opf file content."
			);
		}
	}

	private async parseContent() {
		await this.parseToc();
		await this.parseCover();
		await this.parseMeta();
	}

	private async parseToc() {
		this.initializeToc();
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const urls = [...new Set(this.sections.map((st) => st.urlPath))];
		const contentSplitter = new ContentSplitter(this.sections);
		await contentSplitter.extractSectionContent();
	}

	private initializeToc() {
		if (this.ncxParser) {
			this.toc = this.ncxParser.getToc();
			this.updateChaptersByToc();
		}

		const hrefs = this.opfParser.getHtmlFiles();
		this.processUnmappedFiles(hrefs);

		this.updateChaptersByToc();
		this.sections = this.chapters.flatMap((cpt) => cpt.sections);
	}

	private updateChaptersByToc() {
		this.chapters = [];
		const getChapters = (chapter: Chapter) => {
			this.chapters.push(chapter);
			chapter.subItems.forEach(getChapters, chapter);
		};
		this.toc.forEach(getChapters);
	}

	private getMappedFileIndexs(hrefs: string[]): number[] {
		const indexs = [];
		this.chapters.forEach((cpt) => {
			indexs.push(hrefs.indexOf(cpt.sections[0].urlPath));
		});
		return indexs;
	}

	private processUnmappedFiles(hrefs: string[]) {
		const indexs = this.getMappedFileIndexs(hrefs);
		let k = 0;

		hrefs.forEach((href, hrefIndex) => {
			if (!indexs.includes(hrefIndex)) {
				this.processOneUnmappedFile(href, indexs, k++);
			}
		});
	}

	private processOneUnmappedFile(href: string, indexs: number[], k: number) {
		const hrefs = this.opfParser.getHtmlFiles();
		const hrefIndex = hrefs.indexOf(href);
		const parentIndex = indexs.findIndex(idx => idx < hrefIndex);

		if (parentIndex >= 0) {
			this.chapters[parentIndex].sections.push(new Section(null, href));
		} else {
			const html = jetpack.read(href);
			const title = new DOMParser()
				.parseFromString(html, "text/html")
				.title || path.basename(href, path.extname(href));

			this.toc.splice(k, 0, new Chapter(title, href));
		}
	}

	private async parseCover() {
		this.coverPath = this.opfParser.getCoverPath();
	}

	private async parseMeta() {
		this.meta = {
			...this.opfParser.getMeta(),
			bookName: path.basename(this.epubPath, path.extname(this.epubPath)),
		};
	}
}
export { Chapter };

