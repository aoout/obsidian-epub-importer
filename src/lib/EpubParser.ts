/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-var-requires */

import * as xml2js from "xml2js";
import * as path from "path";
import * as unzipper from "unzipper";
import jetpack from "fs-jetpack";

export class Chapter {
	name: string;
	url: string;
	urlHref: string;
	urlPath: string;
	subItems: Chapter[];
	html: string;

	constructor(
		name: string,
		url: string,
		subItems: Chapter[] = new Array<Chapter>()
	) {
		this.name = name;
		this.url = url;
		const [urlPath, urlHref] = url.split("#");
		this.urlHref = urlHref;
		this.urlPath = urlPath;
		this.subItems = subItems;
	}
}

export class EpubParser {
	epubPath: string;
	tmpPath: string;
	chapters: Chapter[];
	coverPath: string;
	meta:Map<string,string>;

	constructor(path: string) {
		this.epubPath = path;
	}

	async init() {
		this.tmpPath = jetpack.tmpDir().path();
		await jetpack
			.createReadStream(this.epubPath)
			.pipe(unzipper.Extract({ path: this.tmpPath }))
			.promise();
		await this.parseToc();
		await this.parseCover();
		await this.parseMeta();
	}

	async parseToc() {
		const parser = new xml2js.Parser();
		const tocFile = path.join(
			this.tmpPath,
			jetpack.cwd(this.tmpPath).find({ matching: "**/**.ncx" })[0]
		);
		const data = jetpack.read(tocFile);

		const result = await parser.parseStringPromise(data);
		const navPoints = result.ncx.navMap[0].navPoint;

		const getChapter = (navPoint: any) => 
			new Chapter(
				navPoint.navLabel[0].text[0],
				path.dirname(tocFile) + "/" + navPoint.content[0].$["src"],
				navPoint["navPoint"]?navPoint["navPoint"].map(getChapter):[]
			);

		this.chapters = navPoints.map(getChapter);

		const urlMap = new Map<string, string[]>();
		const updateUrlMap = (chapter: Chapter) => {
			if (!urlMap.has(chapter.urlPath)) {
				urlMap.set(chapter.urlPath, chapter.urlHref ? [chapter.urlHref] : []);
			} else {
				urlMap.get(chapter.urlPath).push(chapter.urlHref);
				if (urlMap.get(chapter.urlPath)[0] != "firstHref") {
					urlMap.get(chapter.urlPath).unshift("firstHref");
				}
			}
			chapter.subItems.forEach(updateUrlMap);
		};
		this.chapters.forEach(updateUrlMap);

		const htmlMap = new Map<string, string>();

		urlMap.forEach((urlHrefs, urlPath) => {
			const urlPathHtml = jetpack.read(urlPath);
			const html = urlPathHtml;
			if (urlHrefs.length) {
				const reg = new RegExp(`(?=<[^>]*id=['"](?:${urlHrefs.join("|")})['"][^>]*>[\\s\\S]*?<\\/[^>]*>)`, "g");

				const htmls = html.split(reg);
				const delta = urlHrefs[0] == "firstHref"?0:-1;
				htmls.forEach((html, index) => {
					if(index+delta>=0){
						htmlMap.set(urlPath + "#" + urlHrefs[index+delta], html);
					}
				});
			} else {
				htmlMap.set(urlPath, html);
			}
		});
		const setChapterHtml = (chapter: Chapter) => {
			if (!chapter.urlHref && urlMap.get(chapter.urlPath).length > 1) {
				chapter.urlHref = "firstHref";
				chapter.url = chapter.urlPath + "#" + chapter.urlHref;
			}
			chapter.html = htmlMap.get(chapter.url);
			chapter.subItems.forEach(setChapterHtml);
		};
		this.chapters.forEach(setChapterHtml);
	}

	async parseCover() {
		const parser = new xml2js.Parser();
		const opfFile = path.join(
			this.tmpPath,
			jetpack.cwd(this.tmpPath).find({ matching: "**/**.opf" })[0]
		);
		const data = jetpack.read(opfFile);

		const result = await parser.parseStringPromise(data);

		for (let i = 0; i < result.package.manifest[0].item.length; i++) {
			const item = result.package.manifest[0].item[i];
			if (item.$.id.indexOf("cover") !== -1) {
				const opfParentPath = path.dirname(opfFile);
				this.coverPath = path.join(opfParentPath, item.$.href);
				break;
			}
		}
	}

	async parseMeta() {
		new xml2js.Parser().parseString(
			jetpack.read(
				path.join(
					this.tmpPath,
					jetpack.cwd(this.tmpPath).find({ matching: "**/**.opf" })[0]
				)
			),(err, result) => {
				const meta = result.package.metadata[0];
				const title = meta["dc:title"];
				const author = meta["dc:creator"];
				const publisher = meta["dc:publisher"];
				const language = meta["dc:language"];
				
				this.meta = new Map<string,string>();
				this.meta.set("title",title?title[0]:"");
				this.meta.set("author",author?author[0]["_"]:"");
				this.meta.set("publisher",publisher?publisher[0]:"");
				this.meta.set("language",language?language[0]:"");
			}
		);
	}
}
