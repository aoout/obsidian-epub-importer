import EpubImporterPlugin from "../main";
import { App, PluginSettingTab, Setting } from "obsidian";

export class EpubImporterSettingsTab extends PluginSettingTab{
	plugin: EpubImporterPlugin;
	constructor(app: App, plugin: EpubImporterPlugin){
		super(app, plugin);
		this.plugin = plugin;
	}

	display():void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Tag")
			.setDesc("The tag is used to identify book objects.")
			.addText(text => text
				.setPlaceholder("book")
				.setValue(this.plugin.settings.tag)
				.onChange(async (value) => {
					this.plugin.settings.tag = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Library")
			.setDesc("The plugin will search for .epub files from these paths.")
			.addTextArea((text)=>{
				text.setValue(this.plugin.settings.libratys.join("\n")).onChange(async (value)=>{
					this.plugin.settings.libratys = value.split("\n").map(lib => lib.trim());
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName("Save path")
			.setDesc("The plugin will save the imported book to this path.")
			.addText(text => text
				.setValue(this.plugin.settings.savePath)
				.onChange(async (value) => {
					this.plugin.settings.savePath = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName("Serial number")
			.setDesc("The plugin will add serial number to the imported book.")
			.addToggle((toggle)=>{
				toggle.setValue(this.plugin.settings.serialNumber).onChange(async (value)=>{
					this.plugin.settings.serialNumber = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName("Propertys template")
			.setDesc("The plugin will add these propertys to the imported book.")
			.addTextArea((text)=>{
				text.setValue(this.plugin.settings.propertysTemplate).onChange(async (value)=>{
					this.plugin.settings.propertysTemplate = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName("Auto open right panel")
			.setDesc("The plugin will open the book note on right panel when you open a book.")
			.addToggle((toggle)=>{
				toggle.setValue(this.plugin.settings.autoOpenRightPanel).onChange(async (value)=>{
					this.plugin.settings.autoOpenRightPanel = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName("AllBooks")
			.setDesc("create AllBooks.md in root folder")
			.addToggle((toggle)=>{
				toggle.setValue(this.plugin.settings.allbooks).onChange(async (value)=>{
					this.plugin.settings.allbooks = value;
					await this.plugin.saveSettings();
				});
			});
	}
}