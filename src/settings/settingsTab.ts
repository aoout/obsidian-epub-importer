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
			.setName("Tags")
			.setDesc("The tags that will be added to the imported books.")
			.addText(text => text
				.setPlaceholder("book")
				.setValue(this.plugin.settings.tags.join(", "))
				.onChange(async (value) => {
					this.plugin.settings.tags = value.split(",").map(tag => tag.trim());
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
			.setName("Auto open right panel")
			.setDesc("The plugin will open the book note on right panel when you open a book.")
			.addToggle((toggle)=>{
				toggle.setValue(this.plugin.settings.autoOpenRightPanel).onChange(async (value)=>{
					this.plugin.settings.autoOpenRightPanel = value;
					await this.plugin.saveSettings();
				});
			});
	}
}