export interface EpubImporterSettings {
    tag:string,
    libratys:string[],
    savePath:string,
    assetsPath:string,
    serialNumber:boolean,
    propertysTemplate:string,
    granularity: number
    autoOpenRightPanel:boolean,
    allbooks:boolean
}

export const DEFAULT_SETTINGS: EpubImporterSettings = {
	tag: "book",
	libratys: [],
	savePath: "",
	assetsPath: "{savePath}/{bookName}/images",
	serialNumber: false,
	propertysTemplate: "",
	granularity: 4,
	autoOpenRightPanel: false,
	allbooks:false
};