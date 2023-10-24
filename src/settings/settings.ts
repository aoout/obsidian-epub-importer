export interface EpubImporterSettings {
    tags:string[],
    libratys:string[],
    savePath:string,
    serialNumber:boolean,
    autoOpenRightPanel:boolean,
    allbooks:boolean
}

export const DEFAULT_SETTINGS: EpubImporterSettings = {
	tags: ["book"],
	libratys: [],
	savePath: "",
	serialNumber: false,
	autoOpenRightPanel: false,
	allbooks:false
};