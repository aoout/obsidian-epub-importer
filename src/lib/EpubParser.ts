/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-var-requires */

import * as xml2js from "xml2js";
import * as path from "path";
import * as unzipper from "unzipper";
import jetpack from "fs-jetpack";
import { Path, convertToValidFilename } from "../utils/path";

export class Chapter {
	parent: Chapter;
	name: string;
	url: string;
	urlHref: string;
	urlPath: string;
	subItems: Chapter[];
	html: string;

	constructor(name: string, url: string, subItems: Chapter[] = new Array<Chapter>()) {
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
	toc: Chapter[];
	chapters: Chapter[];
	opfFilePath: string;
	opfContent: any;
	ncxFilePath: string;
	ncxContent: any;
	coverPath: string;
	meta: Map<string, string>;

	constructor(path: string) {
		this.epubPath = path;
	}

	async init() {
		this.tmpPath = jetpack.tmpDir().path();
		if (new Path(this.epubPath).suffix != "") {
			await jetpack
				.createReadStream(this.epubPath)
				.pipe(unzipper.Extract({ path: this.tmpPath }))
				.promise();
		} else {
			jetpack.copy(this.epubPath, this.tmpPath);
		}
		[this.opfFilePath, this.opfContent] = await this.parseBySuffix("opf");
		[this.ncxFilePath, this.ncxContent] = await this.parseBySuffix("ncx");
		await this.parseToc();
		await this.parseCover();
		await this.parseMeta();
	}

	async parseBySuffix(suffix: string): Promise<[string, any]> {
		const parser = new xml2js.Parser();
		const file = path.join(
			this.tmpPath,
			jetpack.cwd(this.tmpPath).find({ matching: `**/**.${suffix}` })[0]
		);
		const data = jetpack.read(file);

		return [file, await parser.parseStringPromise(data)] as const;
	}

	generateToc() {
		const navPoints = this.ncxContent.ncx.navMap[0].navPoint;

		const getToc = (navPoint: any) =>
			new Chapter(
				navPoint.navLabel[0].text[0],
				path.dirname(this.ncxFilePath) + "/" + navPoint.content[0].$["src"],
				navPoint["navPoint"] ? navPoint["navPoint"].map(getToc) : []
			);

		this.toc = navPoints.map(getToc);
		this.chapters = [];
		const getChapters = (chapter: Chapter, parent: null) => {
			chapter.parent = parent;
			this.chapters.push(chapter);
			chapter.subItems.forEach(getChapters, chapter);
		};
		this.toc.forEach(getChapters);

		const hrefs = [];
		const items = this.opfContent.package.manifest[0].item;
		items.forEach((item: any) => {
			const href = item.$.href as string;
			if (href.includes(".html") || href.includes(".xhtml")) {
				hrefs.push(href);
			}
		});

		let k = 0;
		this.chapters.push(new Chapter("9898989898","8989988"));
		for (let [i, j] = [0, 0]; i < this.chapters.length && j < hrefs.length; ) {
			if (
				this.chapters[i].url.replace(path.dirname(this.ncxFilePath) + "/", "") == hrefs[j]
			) {
				i++;
				j++;
			} else {
				i--;
				if (i >= 0) {
					this.chapters[i].subItems.push(new Chapter("", path.dirname(this.opfFilePath) + "/" + hrefs[j]));
				} else {
					this.toc.splice(k, 0, new Chapter("", path.dirname(this.opfFilePath) + "/"+hrefs[j]));
					k++;
				}
				j++;
				i++;
			}
		}
		console.log(this.toc);
	}

	async parseToc() {
		this.generateToc();
		const url2href = new Map<string, string[]>();
		const url2name = new Map<string, string>();
		const initMaps = (chapter: Chapter) => {
			if (!url2href.has(chapter.urlPath)) {
				url2href.set(chapter.urlPath, chapter.urlHref ? [chapter.urlHref] : []);
			} else {
				url2href.get(chapter.urlPath).push(chapter.urlHref);
				if (url2href.get(chapter.urlPath)[0] != "firstHref") {
					url2href.get(chapter.urlPath).unshift("firstHref");
				}
			}
			url2name.set(chapter.urlPath, convertToValidFilename(chapter.name));
			chapter.subItems.forEach(initMaps);
		};
		this.toc.forEach(initMaps);

		const url2html = new Map<string, string>();
		url2href.forEach((hrefs, urlPath) => {
			let html = jetpack.read(urlPath);
			if (hrefs.length) {
				const reg = new RegExp(
					`(?=<[^>]*id=['"](?:${hrefs.join("|")})['"][^>]*>[\\s\\S]*?<\\/[^>]*>)`,
					"g"
				);
				const htmls = html.split(reg);
				const delta = hrefs[0] == "firstHref" ? 0 : -1;
				htmls.forEach((html, index) => {
					if (index + delta >= 0) {
						url2name.forEach((name, url) => {
							url = url.replace(path.dirname(this.ncxFilePath) + "/", "");
							if (html) html = html.replaceAll(url, name);
						});
						url2html.set(urlPath + "#" + hrefs[index + delta], html);
					}
				});
			} else {
				url2name.forEach((name, url) => {
					url = url.replace(path.dirname(this.ncxFilePath) + "/", "");
					if (html) html = html.replaceAll(url, name);
				});
				url2html.set(urlPath, html);
			}
		});
		const setHtml = (chapter: Chapter) => {
			if (!chapter.urlHref && url2href.get(chapter.urlPath).length > 1) {
				chapter.urlHref = "firstHref";
				chapter.url = chapter.urlPath + "#" + chapter.urlHref;
			}
			chapter.html = url2html.get(chapter.url);
			chapter.subItems.forEach(setHtml);
		};
		this.toc.forEach(setHtml);
	}

	async parseCover() {
		for (let i = 0; i < this.opfContent.package.manifest[0].item.length; i++) {
			const item = this.opfContent.package.manifest[0].item[i];
			if (item.$.id.indexOf("cover") !== -1) {
				const opfParentPath = path.dirname(this.opfFilePath);
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
			),
			(err, result) => {
				const meta = result.package.metadata[0];
				const title = meta["dc:title"];
				const author = meta["dc:creator"];
				const publisher = meta["dc:publisher"];
				const language = meta["dc:language"];

				this.meta = new Map<string, string>();
				this.meta.set("title", title ? title[0] : "");
				this.meta.set("author", author ? author[0]["_"] : "");
				this.meta.set("publisher", publisher ? publisher[0] : "");
				this.meta.set("language", language ? language[0] : "");

				this.meta.set("bookName", new Path(this.epubPath).stem);
			}
		);
	}
}
