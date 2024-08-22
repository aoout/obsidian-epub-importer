export interface EpubImporterSettings {
	tag: string;
	libraries: string[];
	byDrag: boolean;
	savePath: string;
	assetsPath: string;
	granularity: number;
	mocName: string;
	notePropertysTemplate: string;
	oneNote: boolean;
	oneFolder: boolean;
	mocPropertysTemplate: string;
	imageFormat: string;
	reformatting: boolean;
	autoOpenRightPanel: boolean;
	removeDuplicateFolders: boolean;
	moreLog: boolean;
	leafID: string;
}

export const DEFAULT_SETTINGS: EpubImporterSettings = {
	tag: "book",
	libraries: [],
	byDrag: false,
	savePath: "",
	assetsPath: "{{savePath}}/{{bookName}}/images",
	granularity: 4,
	mocName: "{{bookName}}",
	notePropertysTemplate: "",
	oneNote: false,
	oneFolder: true,
	mocPropertysTemplate:
		"title: {{bookName}}\nauthor: {{author}}\npublisher: {{publisher}}\nstatus: false",
	imageFormat: "![](imagePath)",
	reformatting: false,
	autoOpenRightPanel: false,
	removeDuplicateFolders: false,
	moreLog: false,
	leafID: ""
};
