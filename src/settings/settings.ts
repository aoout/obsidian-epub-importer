export interface EpubImporterSettings {
    tags:string[],
    libratys:string[],
    savePath:string,
    autoOpenRightPanel:boolean,
    allbooks:boolean
}

export const DEFAULT_SETTINGS: EpubImporterSettings = {
	tags: ["book"],
	libratys: [],
	savePath: "",
	autoOpenRightPanel: false,
	allbooks:false
};