/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-var-requires */

export class TocItem {
	name: string;
	url: string;
	subItems: TocItem[];

	constructor(
		name: string,
		url: string,
		subItems: TocItem[] = new Array<TocItem>()
	) {
		this.name = name;
		this.url = url;
		this.subItems = subItems;
	}

	getChapter(): string {
		const fs = require("fs");
		const chapter = fs.readFileSync(this.url.split("#")[0], "utf-8");
		return chapter;
	}

	getFileName(): string {
		const path = require("path");
		return path.basename(this.url).split("#")[0];
	}
}

export class EpubParser {
	epubPath: string;
	tmpobj: any;
	tocFile: string;
	toc: TocItem[];

	constructor(path: string) {
		this.epubPath = path;
	}

	async init() {
		const tmp = require("tmp");
		this.tmpobj = tmp.dirSync({ unsafeCleanup: true });
		const fs = require("fs");
		const unzipper = require("unzipper");
		await fs
			.createReadStream(this.epubPath)
			.pipe(unzipper.Extract({ path: this.tmpobj.name }))
			.promise();
	}

	findOpfFile() {
		const walkSync = require("./utils").walkSync;
		walkSync(this.tmpobj.name, "file",(filePath: string, stat: any) => {
			if (filePath.indexOf("toc.ncx") !== -1) {
				this.tocFile = filePath;
			}
		});
		console.log("toc file path: ", this.tocFile);
	}

	async parse() {
		const fs = require("fs");
		const xml2js = require("xml2js");
		const parser = new xml2js.Parser();
		const data = fs.readFileSync(this.tocFile, "utf-8");

		let result: any;
		await parser.parseStringPromise(data).then((result2: any) => {
			result = result2;
		});
		console.log(result);
		const navPoints = result.ncx.navMap[0].navPoint;

		const parseNavPoint = (navPoint: any) => {
			const path = require("path");
			const tocParentPath = path.dirname(this.tocFile);

			const item = new TocItem(
				navPoint.navLabel[0].text[0],
				tocParentPath + "/" + navPoint.content[0].$["src"]
			);

			const subNavPoints = navPoint["navPoint"];
			if (subNavPoints) {
				for (let i = 0; i < subNavPoints.length; i++) {
					const child = subNavPoints[i];
					item.subItems.push(parseNavPoint(child));
				}
			}
			return item;
		};
		const toc = [];
		for (let i = 0; i < navPoints.length; i++) {
			const item = navPoints[i];
			toc.push(parseNavPoint(item));
		}
		this.toc = toc;
		console.log(toc);
	}

	static async getParser(path: string) {
		const parser = new EpubParser(path);
		await parser.init();
		parser.findOpfFile();
		await parser.parse();
		return parser;
	}
}
