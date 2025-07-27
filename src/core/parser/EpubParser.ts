/* eslint-disable @typescript-eslint/no-non-null-assertion */
import extract from "extract-zip";
import jetpack from "fs-jetpack";
import * as path from "path";
import * as xml2js from "xml2js";
import { Chapter, Section } from "./types";
import { OPFParser } from "./OPFParser";
import { NCXParser } from "./NCXParser";
import { ContentSplitter } from "./ContentSplitter";

export class EpubParser {
  readonly tmpPath = jetpack.tmpDir().path();
  private readonly parser = new xml2js.Parser();
  private opfParser!: OPFParser;
  private ncxParser?: NCXParser;
  
  toc: Chapter[] = [];
  chapters: Chapter[] = [];
  sections: Section[] = [];
  meta: object = {};
  coverPath = "";
  
  private existingTitles = new Set<string>();

  constructor(private readonly epubPath: string, private readonly moreLog = false) {
    this.log("Initializing with path:", epubPath);
  }

  async init() {
    return this.tryCatch(async () => {
      this.log("Starting parsing...");
      await this.extractEpub();
      await this.parseFiles();
      await this.parseContent();
      this.log("Parsing completed");
    }, "Failed to parse .epub file");
  }

  private async extractEpub() {
    this.log("Extracting to:", this.tmpPath);
    const isZip = path.extname(this.epubPath) !== "";
    await (isZip 
      ? extract(this.epubPath, { dir: this.tmpPath })
      : jetpack.copyAsync(this.epubPath, this.tmpPath, { overwrite: true }));
  }

  private async parseFiles() {
    this.log("Parsing OPF and NCX...");
    const [opfFile] = jetpack.find(this.tmpPath, { matching: "**/*.opf" });
    const opfContent = await this.parseXml(jetpack.read(opfFile)!);
    this.opfParser = new OPFParser(opfFile, opfContent);

    try {
      const [ncxFile] = jetpack.find(this.tmpPath, { matching: "**/*.ncx" });
      const ncxContent = await this.parseXml(jetpack.read(ncxFile)!);
      this.toc = new NCXParser(ncxFile, ncxContent).getToc();
    } catch {
      this.log("No NCX found, using OPF only");
    }
  }

  private async parseContent() {
    this.log("Parsing content...");
    await Promise.all([
      this.parseToc(),
      this.coverPath = this.opfParser.getCoverPath(),
      this.meta = { ...this.opfParser.getMeta(), bookName: path.basename(this.epubPath, path.extname(this.epubPath)) }
    ]);
  }

  private async parseToc() {
    this.log("Parsing TOC...");
    this.updateChapters();
    const hrefs = this.opfParser.getHtmlFiles();
    this.processUnmappedFiles(hrefs);
    this.updateChapters();
    this.sections = this.chapters.flatMap(ch => ch.sections);
    await new ContentSplitter(this.sections).extractSectionContent();
  }

  private updateChapters() {
    this.chapters = [];
    const collectChapters = (chapter: Chapter) => {
      this.chapters.push(chapter);
      chapter.subItems.forEach(collectChapters);
    };
    this.toc.forEach(collectChapters);
  }

  private processUnmappedFiles(hrefs: string[]) {
    const mappedIndexes = this.chapters.map(ch => hrefs.indexOf(ch.sections[0].urlPath));
    hrefs.forEach((href, i) => {
      if (!mappedIndexes.includes(i)) {
        const parentIdx = mappedIndexes.findLastIndex(idx => idx < i);
        parentIdx >= 0
          ? this.chapters[parentIdx].sections.push(new Section(null, href))
          : this.toc.push(this.createChapter(href));
      }
    });
  }

  private createChapter(href: string): Chapter {
    const html = jetpack.read(href)!;
    let title = new DOMParser().parseFromString(html, "text/html").title || path.basename(href, path.extname(href));
    title = this.ensureUniqueTitle(title);
    this.existingTitles.add(title);
    return new Chapter(title, href);
  }

  private ensureUniqueTitle(title: string): string {
    let newTitle = title;
    let suffix = 1;
    while (this.existingTitles.has(newTitle)) {
      newTitle = `${title} (${suffix++})`;
    }
    return newTitle;
  }

  private async parseXml(data: string) {
    return this.parser.parseStringPromise(data);
  }

  private log(...args: unknown[]) {
    this.moreLog && console.log(...args);
  }

  private async tryCatch<T>(fn: () => Promise<T>, errorMsg: string): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      console.log(e);
      throw new Error(errorMsg);
    }
  }
}

export { Chapter };