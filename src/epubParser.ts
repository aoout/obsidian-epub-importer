/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-var-requires */
export default class EpubParser {
	epubPath: string;
	tmpobj: any;
	tocFile: string;
	toc: any;

	constructor(path: string) {
		this.epubPath = path;
	}

	async init() {
		// create a temp directory
		const tmp = require("tmp");
		this.tmpobj = tmp.dirSync({ unsafeCleanup: true });
		console.log("Dir: ", this.tmpobj.name);
		// unzip the epub file to the temp directory Synchronize
		await this.unzipSync();
	}

	unzipSync() {
		const fs = require("fs");
		const unzipper = require("unzipper");
		return new Promise<void>((resolve, reject) => {
			fs.createReadStream(this.epubPath)
				.pipe(
					unzipper.Extract({
						path: this.tmpobj.name,
					})
				)
				.on("close", () => {
					console.log("stream close");
					resolve();
				})
				.on("error", (err: any) => {
					reject(err);
				});
		});
	}

	findOpfFile() {
		// recursively traverse the folder and find the path of the file named content.opf, get it's path
		const path = require("path");
		const fs = require("fs");
		const walkSync = (currentDirPath: string, callback: any) => {
			fs.readdirSync(currentDirPath).forEach(function (name: string) {
				const filePath = path.join(currentDirPath, name);
				const stat = fs.statSync(filePath);
				if (stat.isFile()) {
					callback(filePath, stat);
				} else if (stat.isDirectory()) {
					walkSync(filePath, callback);
				}
			});
		};
		walkSync(this.tmpobj.name, (filePath: string, stat: any) => {
			if (filePath.indexOf("toc.ncx") !== -1) {
				this.tocFile = filePath;
			}
		});
		console.log("toc file path: ", this.tocFile);

	}

	parse() {
		// read opf file and parse it
		const fs = require("fs");
		const xml2js = require("xml2js");
		const parser = new xml2js.Parser();
		fs.readFile(this.tocFile, (err: any, data: any) => {
			parser.parseString(data, (err: any, result: any) => {
				console.log(result);
				const navPoints = result.ncx.navMap[0].navPoint;
				console.log(navPoints);
				const toc = [];
				const parseNavPoint = (navPoint: any) => {

					interface NavPointObj {
						label: string;
						content: string;
						children: NavPointObj[];
					}
					const navPointObj: NavPointObj = {
						label: navPoint.navLabel[0].text[0],
						content:
							this.tmpobj.name +
							"/" +
							navPoint.content[0].$["src"],
						children: [],
					};
					if (navPoint["navPoint"] && navPoint["navPoint"].length > 1 ) {
						if(navPoint["navPoint"][1].content[0].$["src"].indexOf('#') != -1){
							navPointObj.children.push(parseNavPoint(navPoint["navPoint"][0]));
						}else{
							for (
								let i = 0;
								i < navPoint["navPoint"].length;
								i++
							) {
								const child = navPoint["navPoint"][i];
								navPointObj.children.push(parseNavPoint(child));
							}
						}
						
					}
					return navPointObj;
				};
				for (let i = 0; i < navPoints.length; i++) {
					const item = navPoints[i];
					toc.push(parseNavPoint(item));
				}
				this.toc = toc;
				console.log(toc);
			});
		});

	}
}
