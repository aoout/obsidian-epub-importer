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
	existingTitles: Set<string> = new Set();

	moreLog: boolean;

	constructor(path: string, moreLog: boolean) {
		this.epubPath = path;
		this.moreLog = moreLog;
		if (this.moreLog) console.log("Initializing EpubParser with path:", path);
	}

	async init() {
		try {
			if (this.moreLog) console.log("Starting epub parsing process...");
			await this.extractEpub();
			await this.parseOPFandNCX();
			await this.parseContent();
			if (this.moreLog) console.log("Epub parsing completed successfully");
		} catch (e) {
			console.log(e);
			throw new Error("failed to parse the .epub file");
		}
	}

	private async extractEpub() {
		this.tmpPath = jetpack.tmpDir().path();
		if (this.moreLog) {
			console.log("Creating temporary directory at:", this.tmpPath);
			console.log("Starting epub extraction...");
		}

		if (path.extname(this.epubPath) != "") {
			if (this.moreLog) console.log("Extracting epub file to temporary directory");
			await extract(this.epubPath, { dir: this.tmpPath });
		} else {
			if (this.moreLog) console.log("Copying unzipped epub folder to temporary directory");
			jetpack.copy(this.epubPath, this.tmpPath, { overwrite: true });
		}
		if (this.moreLog) console.log("Epub extraction completed");
	}

	private async parseOPFandNCX() {
		if (this.moreLog) console.log("Starting OPF and NCX parsing...");
		const parser = new xml2js.Parser();

		const opfFile = jetpack.find(this.tmpPath, { matching: "**/*.opf" })[0];
		if (this.moreLog) console.log("Found OPF file at:", opfFile);
		const opfData = jetpack.read(opfFile);
		const opfContent = await parser.parseStringPromise(opfData);
		this.opfFilePath = opfFile;
		this.opfParser = new OPFParser(opfFile, opfContent);
		if (this.moreLog) console.log("OPF parsing completed");

		try {
			const ncxFile = jetpack.find(this.tmpPath, { matching: "**/*.ncx" })[0];
			if (this.moreLog) console.log("Found NCX file at:", ncxFile);
			const ncxData = jetpack.read(ncxFile);
			const ncxContent = await parser.parseStringPromise(ncxData);
			this.ncxFilePath = ncxFile;
			this.ncxParser = new NCXParser(ncxFile, ncxContent);
			if (this.moreLog) console.log("NCX parsing completed");
		} catch (error) {
			if (this.moreLog) console.log("No NCX file found, will use OPF for content structure");
			console.log(
				"This epub does not have a .ncx file, parsing will be based on the .opf file content."
			);
		}
	}

	private async parseContent() {
		if (this.moreLog) console.log("Starting content parsing...");
		await this.parseToc();
		await this.parseCover();
		await this.parseMeta();
		if (this.moreLog) console.log("Content parsing completed");
	}

	private async parseToc() {
		if (this.moreLog) console.log("Initializing table of contents...");
		this.initializeToc();
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const urls = [...new Set(this.sections.map((st) => st.urlPath))];
		if (this.moreLog) console.log("Found unique section URLs:", urls);
		const contentSplitter = new ContentSplitter(this.sections);
		await contentSplitter.extractSectionContent();
		if (this.moreLog) console.log("Table of contents parsing completed");
	}

	private initializeToc() {
		if (this.ncxParser) {
			if (this.moreLog) console.log("Getting TOC from NCX parser");
			this.toc = this.ncxParser.getToc();
			if (this.moreLog) console.log("TOC from NCX parser:", this.toc);
			this.updateChaptersByToc();
		}

		const hrefs = this.opfParser.getHtmlFiles();
		if (this.moreLog) console.log("Processing unmapped files from OPF:", hrefs);
		this.processUnmappedFiles(hrefs);

		this.updateChaptersByToc();
		this.sections = this.chapters.flatMap((cpt) => cpt.sections);
		if (this.moreLog) console.log("Total sections found:", this.sections.length);
	}

	private updateChaptersByToc() {
		if (this.moreLog) console.log("Updating chapters from TOC");
		this.chapters = [];
		const getChapters = (chapter: Chapter) => {
			this.chapters.push(chapter);
			chapter.subItems.forEach(getChapters, chapter);
		};
		this.toc.forEach(getChapters);
		if (this.moreLog) console.log("Total chapters found:", this.chapters.length);
	}

	private getMappedFileIndexs(hrefs: string[]): number[] {
		const indexs = [];
		this.chapters.forEach((cpt) => {
			indexs.push(hrefs.indexOf(cpt.sections[0].urlPath));
		});
		if (this.moreLog) console.log("Mapped file indexes:", indexs);
		return indexs;
	}

	private processUnmappedFiles(hrefs: string[]) {
		if (this.moreLog) console.log("Processing unmapped files...");
		const indexs = this.getMappedFileIndexs(hrefs);
		let k = 0;

		hrefs.forEach((href, hrefIndex) => {
			if (!indexs.includes(hrefIndex)) {
				if (this.moreLog) console.log("Processing unmapped file:", href);
				this.processOneUnmappedFile(href, indexs, k++);
			}
		});
	}

	/**
	 * Process a single unmapped file and either add it to an existing chapter or create a new chapter for it
	 * @param href - The path/URL of the unmapped HTML file to process
	 * @param indexs - Array of indexes of files that are already mapped to chapters
	 * @param k - Position where to insert the new chapter if one needs to be created
	 */
	private processOneUnmappedFile(href: string, indexs: number[], k: number) {
		const hrefs = this.opfParser.getHtmlFiles();
		const hrefIndex = hrefs.indexOf(href);
		console.log("indexs:",indexs);
		const parentIndex = indexs.findLastIndex(idx => idx < hrefIndex);

		if (parentIndex >= 0) {
			if (this.moreLog) console.log("Adding unmapped file to existing chapter:", this.chapters[parentIndex].sections[0].urlPath);
			this.chapters[parentIndex].sections.push(new Section(null, href));
		} else {
			if (this.moreLog) console.log("Creating new chapter for unmapped file:", href);
			const html = jetpack.read(href);
			let title = new DOMParser()
				.parseFromString(html, "text/html")
				.title || path.basename(href, path.extname(href));

	
			let suffix = 1;
			let originalTitle = title;
			while (this.existingTitles.has(title)) {
				title = `${originalTitle} (${suffix})`;
				suffix++;
			}
			this.existingTitles.add(title);

			this.toc.splice(k, 0, new Chapter(title, href));
		}
	}

	private async parseCover() {
		if (this.moreLog) console.log("Parsing cover...");
		this.coverPath = this.opfParser.getCoverPath();
		if (this.moreLog) console.log("Cover path:", this.coverPath);
	}

	private async parseMeta() {
		if (this.moreLog) console.log("Parsing metadata...");
		this.meta = {
			...this.opfParser.getMeta(),
			bookName: path.basename(this.epubPath, path.extname(this.epubPath)),
		};
		if (this.moreLog) console.log("Metadata:", this.meta);
	}
}
export { Chapter };
