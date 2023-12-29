import EpubImporterPlugin from "../main";
import { App, PluginSettingTab, Setting } from "obsidian";
import i18next from "i18next";

export class EpubImporterSettingsTab extends PluginSettingTab {
	plugin: EpubImporterPlugin;
	constructor(app: App, plugin: EpubImporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(i18next.t("Tag_o"))
			.setDesc(i18next.t("Tag"))
			.addText((text) =>
				text
					.setPlaceholder("book")
					.setValue(this.plugin.settings.tag)
					.onChange(async (value) => {
						this.plugin.settings.tag = value;
						await this.plugin.saveSettings();
					})
			);
		this.containerEl.createEl("h2", { text: i18next.t("import") });
		new Setting(containerEl)
			.setName(i18next.t("Library_o"))
			.setDesc(i18next.t("Library"))
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.libraries.join("\n")).onChange(async (value) => {
					this.plugin.settings.libraries = value.split("\n").map((lib) => lib.trim());
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName(i18next.t("byDrag_o"))
			.setDesc(i18next.t("byDrag"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.byDrag).onChange(async (value) => {
					this.plugin.settings.byDrag = value;
					await this.plugin.saveSettings();
				});
			});
		this.containerEl.createEl("h2", { text:i18next.t("storage") });
		new Setting(containerEl)
			.setName(i18next.t("Save path_o"))
			.setDesc(i18next.t("Save path"))
			.addText((text) =>
				text.setValue(this.plugin.settings.savePath).onChange(async (value) => {
					this.plugin.settings.savePath = value;
					await this.plugin.saveSettings();
				})
			);
		new Setting(containerEl)
			.setName(i18next.t("Assets path_o"))
			.setDesc(i18next.t("Assets path"))
			.addText((text) =>
				text.setValue(this.plugin.settings.assetsPath).onChange(async (value) => {
					this.plugin.settings.assetsPath = value;
					await this.plugin.saveSettings();
				})
			);
		this.containerEl.createEl("h2", { text: i18next.t("display") });
		new Setting(containerEl)
			.setName(i18next.t("Hierarchy depth_o"))
			.setDesc(i18next.t("Hierarchy depth"))
			.addSlider((slider) => {
				slider
					.setLimits(0, 5, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.granularity)
					.onChange(async (value) => {
						this.plugin.settings.granularity = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(containerEl)
			.setName(i18next.t("Propertys template_o"))
			.setDesc(i18next.t("Propertys template"))
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.propertysTemplate).onChange(async (value) => {
					this.plugin.settings.propertysTemplate = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName(i18next.t("Serial number_o"))
			.setDesc(i18next.t("Serial number"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.serialNumber).onChange(async (value) => {
					this.plugin.settings.serialNumber = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName(i18next.t("serialNumberDelta_o"))
			.setDesc(i18next.t("serialNumberDelta"))
			.addSlider((slider) => {
				slider
					.setLimits(0, 10, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.serialNumberDelta)
					.onChange(async (value) => {
						this.plugin.settings.serialNumberDelta = value;
						await this.plugin.saveSettings();
					});
			});
		
		this.containerEl.createEl("h2", { text: i18next.t("content") });
		new Setting(containerEl)
			.setName(i18next.t("imageFormat_o"))
			.setDesc(i18next.t("imageFormat"))
			.addDropdown((text) =>
				text
					.addOptions({
						"![](imagePath)": "![](imagePath)",
						"![[imagePath]]": "![[imagePath]]",
						"![[imagePath|caption]]": "![[imagePath|caption]]",
					})
					.setValue(this.plugin.settings.imageFormat)
					.onChange(async (value) => {
						this.plugin.settings.imageFormat = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName(i18next.t("imageResize_o"))
			.setDesc(i18next.t("imageResize"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.imageResize).onChange(async (value) => {
					this.plugin.settings.imageResize = value;
					await this.plugin.saveSettings();
				});
			});
		this.containerEl.createEl("h2", { text: i18next.t("helper") });
		new Setting(containerEl)
			.setName(i18next.t("Auto open right panel_o"))
			.setDesc(i18next.t("Auto open right panel"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.autoOpenRightPanel).onChange(async (value) => {
					this.plugin.settings.autoOpenRightPanel = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName(i18next.t("AllBooks_o"))
			.setDesc(i18next.t("AllBooks"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.allbooks).onChange(async (value) => {
					this.plugin.settings.allbooks = value;
					await this.plugin.saveSettings();
				});
			});
		this.containerEl.createEl("h2", { text: i18next.t("developing") });
		new Setting(containerEl)
			.setName(i18next.t("Remove duplicate folders_o"))
			.setDesc(i18next.t("Remove duplicate folders"))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.removeDuplicateFolders)
					.onChange(async (value) => {
						this.plugin.settings.removeDuplicateFolders = value;
						await this.plugin.saveSettings();
					});
			});
	}
}
