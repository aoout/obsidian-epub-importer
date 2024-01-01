/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-var-requires */

import * as xml2js from "xml2js";
import * as path from "path";
import * as unzipper from "unzipper";
import jetpack from "fs-jetpack";
import { Path, convertToValidFilename } from "../utils/path";

export class Chapter {
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
	chapters: Chapter[];
	coverPath: string;
	meta: Map<string, string>;

	constructor(path: string) {
		this.epubPath = path;
	}

	async init() {
		this.tmpPath = jetpack.tmpDir().path();
		try {
			if(new Path(this.epubPath).suffix == "epub"){
				await jetpack
					.createReadStream(this.epubPath)
					.pipe(unzipper.Extract({ path: this.tmpPath }))
					.promise();
			}else{
				jetpack.copy(this.epubPath,this.tmpPath);
			}
			await this.parseToc();
			await this.parseCover();
			await this.parseMeta();
		} catch (err) {
			throw new Error(`Parsing failed for epub from ${this.epubPath}`);
		}
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
				navPoint["navPoint"] ? navPoint["navPoint"].map(getChapter) : []
			);

		this.chapters = navPoints.map(getChapter);

		const url2href = new Map<string, string[]>();
		const url2name = new Map<string, string>();
		const initMap = (chapter: Chapter) => {
			if (!url2href.has(chapter.urlPath)) {
				url2href.set(chapter.urlPath, chapter.urlHref ? [chapter.urlHref] : []);
			} else {
				url2href.get(chapter.urlPath).push(chapter.urlHref);
				if (url2href.get(chapter.urlPath)[0] != "firstHref") {
					url2href.get(chapter.urlPath).unshift("firstHref");
				}
			}
			url2name.set(chapter.urlPath, convertToValidFilename(chapter.name));
			chapter.subItems.forEach(initMap);
		};
		this.chapters.forEach(initMap);

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
							url = url.replace(path.dirname(tocFile) + "/", "");
							if(html) html = html.replaceAll(url, name);
						});
						url2html.set(urlPath + "#" + hrefs[index + delta], html);
					}
				});
			} else {
				url2name.forEach((name, url) => {
					url = url.replace(path.dirname(tocFile) + "/", "");
					if(html) html = html.replaceAll(url, name);
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
		this.chapters.forEach(setHtml);
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
