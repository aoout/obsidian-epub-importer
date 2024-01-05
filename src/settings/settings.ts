export interface EpubImporterSettings {
	tag: string;
	libraries: string[];
	byDrag: boolean;
	savePath: string;
	assetsPath: string;
	granularity: number;
	mocName: string;
	mocPropertysTemplate: string;
	notePropertysTemplate: string;
	imageFormat: string;
	autoOpenRightPanel: boolean;
	allbooks: boolean;
	removeDuplicateFolders: boolean;
}

export const DEFAULT_SETTINGS: EpubImporterSettings = {
	tag: "book",
	libraries: [],
	byDrag: false,
	savePath: "",
	assetsPath: "{{savePath}}/{{bookName}}/images",
	granularity: 4,
	mocName: "{{bookName}}",
	mocPropertysTemplate:
		"title: {{bookName}}\nauthor: {{author}}\npublisher: {{publisher}}\nstatus: false",
	notePropertysTemplate: "",
	imageFormat: "![](imagePath)",
	autoOpenRightPanel: false,
	allbooks: false,
	removeDuplicateFolders: false,
};
