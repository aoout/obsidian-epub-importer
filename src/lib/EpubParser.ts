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
	toc: Chapter[];
	coverPath: string;

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
	}

	async parseToc() {
		const parser = new xml2js.Parser();
		const tocFile = path.join(
			this.tmpPath,
			jetpack.cwd(this.tmpPath).find({ matching: "**/**.ncx" })[0]
		);
		const data = jetpack.read(tocFile);

		const result = await parser.parseStringPromise(data);
		console.log(result);
		const navPoints = result.ncx.navMap[0].navPoint;

		const parseNavPoint = (navPoint: any) => {
			const tocParentPath = path.dirname(tocFile);
			const item = new Chapter(
				navPoint.navLabel[0].text[0],
				tocParentPath + "/" + navPoint.content[0].$["src"]
			);
			if (navPoint["navPoint"])
				item.subItems.push(...navPoint["navPoint"].map(parseNavPoint));
			return item;
		};

		const toc = [];
		for (let i = 0; i < navPoints.length; i++) {
			const item = navPoints[i];
			toc.push(parseNavPoint(item));
		}

		const urlMap = new Map<string, string[]>();
		const parseChapter = (chapter: Chapter) => {
			if (!urlMap.has(chapter.urlPath)) {
				urlMap.set(chapter.urlPath, chapter.urlHref ? [chapter.urlHref] : []);
			} else {
				urlMap.get(chapter.urlPath).push(chapter.urlHref);
				if (urlMap.get(chapter.urlPath)[0] != "firstHref") {
					//在最前面插入一个firstHref
					urlMap.get(chapter.urlPath).unshift("firstHref");
				}
			}
			chapter.subItems.forEach((subItem) => {
				parseChapter(subItem);
			});
		};
		toc.forEach((chapter) => {
			parseChapter(chapter);
		});

		console.log("urlMap", urlMap);
		const htmlMap = new Map<string, string>();

		urlMap.forEach((urlHrefs, urlPath) => {
			const urlPathHtml = jetpack.read(urlPath);
			const html = urlPathHtml;
			console.log("urlHref", urlHrefs);
			if (urlHrefs.length) {
				const urlHrefs2 = urlHrefs.slice(1);

				const reg = new RegExp(
					`(?<=<[^>]*id=['"])(?:${urlHrefs.join("|")})(?=['"][^>]*>)`,
					"g"
				);
				const htmls = html.split(reg);
				htmls.forEach((html, index) => {
					htmlMap.set(urlPath + "#" + urlHrefs[index], html);
				});
			} else {
				htmlMap.set(urlPath, html);
			}
		});
		// console.log("htmlMap", htmlMap);
		const parseChapterHtml = (chapter: Chapter) => {
			if (!chapter.urlHref && urlMap.get(chapter.urlPath).length > 1) {
				chapter.urlHref = "firstHref";
				chapter.url = chapter.urlPath + "#" + chapter.urlHref;
			}
			chapter.html = htmlMap.get(chapter.url);
			chapter.subItems.forEach((subItem) => {
				parseChapterHtml(subItem);
			});
		};
		toc.forEach((chapter) => {
			parseChapterHtml(chapter);
		});
		this.toc = toc;
		console.log(toc);
	}

	async parseCover() {
		const parser = new xml2js.Parser();
		const opfFile = path.join(
			this.tmpPath,
			jetpack.cwd(this.tmpPath).find({ matching: "**/**.opf" })[0]
		);
		const data = jetpack.read(opfFile);

		const result = await parser.parseStringPromise(data);
		console.log(result);

		for (let i = 0; i < result.package.manifest[0].item.length; i++) {
			const item = result.package.manifest[0].item[i];
			if (item.$.id.indexOf("cover") !== -1) {
				const opfParentPath = path.dirname(opfFile);
				this.coverPath = path.join(opfParentPath, item.$.href);
				break;
			}
		}
	}
}
