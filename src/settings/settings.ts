export interface EpubImporterSettings {
	tag: string;
	libraries: string[];
	byDrag: boolean;
	savePath: string;
	assetsPath: string;
	granularity: number;
	propertysTemplate: string;
	serialNumber: boolean;
	serialNumberDelta: number;
	imageFormat: string;
	imageResize: boolean;
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
	propertysTemplate:
		"title: {{bookName}}\nauthor: {{author}}\npublisher: {{publisher}}\nstatus: false",
	serialNumber: false,
	serialNumberDelta: 0,
	imageFormat: "![](imagePath)",
	imageResize: false,
	autoOpenRightPanel: false,
	allbooks: false,
	removeDuplicateFolders: false,
};
