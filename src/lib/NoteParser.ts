/* eslint-disable @typescript-eslint/no-unused-vars */
export class NoteParser {
	content: string;
	epubName: string;
	imageFormat: string;
	static getParseredNote(originNote: string, epubName: string,assetsPath:string, imageFormat:string) {
		const parser = new NoteParser(originNote, epubName, imageFormat);
		parser.parseImagePath(assetsPath);
		parser.parseFontNote();
		return parser.content;
	}

	constructor(originNote: string, epubName: string, imageFormat:string) {
		this.content = originNote;
		this.epubName = epubName;
		this.imageFormat = imageFormat;
	}

	parseImagePath(assetsPath:string) {
		// TODO: Avoid accidentally damaging the text content
		this.content = this.content
			.replace(/Images/g, "images")
			.replace(/\.\.\/images/g, "images")
			.replace(/Image/g, "images/Image")
			.replace(/images/g, assetsPath);
		if(this.imageFormat == "![[imagePath]]"){
			this.content = this.content
				.replace(/!\[\]\((.*images.*)\)/g,"![[$1]]");
		}
		if(this.imageFormat == "![[imagePath||caption]]"){
			this.content = this.content
				.replace(/!\[\]\((.*images.*)\)\n+(\**图.*)\n/g,"![[$1|$2]]\n");
		}
	}

	parseFontNote() {
		// example: [[2]](ab0c_defg.html#hi_j0kl) -> [^2]
		this.content = this.content.replace(/\[\[(\d+)\]\]\(.*\)/g, "[^$1]");

		// example: [2](ab0c_defg.html#hi_j0kl) -> [^2]
		this.content = this.content.replace(/\[(\d+)\]\(.*\)/g, "[^$1]");

		// example: [^2]something is good.00264qed你说对吧 -> [^2]: something is good.00264qed你说对吧
		// and, the string is from the begging of the line
		this.content = this.content.replace(/^(\[\^\d+\])(.*)$/gm, "$1: $2");
	}
}