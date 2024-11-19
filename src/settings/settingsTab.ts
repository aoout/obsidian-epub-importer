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
		new Setting(containerEl).setName(i18next.t("import")).setHeading();
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
		new Setting(containerEl).setName(i18next.t("storage")).setHeading();
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
		new Setting(containerEl)
			.setName("backup directory Path")
			.setDesc("The plugin will use this directory to back up books in .zip format.")
			.addText((text) =>
				text.setValue(this.plugin.settings.backupPath).onChange(async (value) => {
					this.plugin.settings.backupPath = value;
					await this.plugin.saveSettings();
				})
			);
		new Setting(containerEl).setName(i18next.t("display")).setHeading();
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
			.setName(i18next.t("Moc fileName_o"))
			.setDesc(i18next.t("Moc fileName"))
			.addText((text) =>
				text.setValue(this.plugin.settings.mocName).onChange(async (value) => {
					this.plugin.settings.mocName = value;
					await this.plugin.saveSettings();
				})
			);
		new Setting(containerEl)
			.setName(i18next.t("notePropertysTemplate_o"))
			.setDesc(i18next.t("notePropertysTemplate"))
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.notePropertysTemplate).onChange(
					async (value) => {
						this.plugin.settings.notePropertysTemplate = value;
						await this.plugin.saveSettings();
					}
				);
			});
		new Setting(containerEl)
			.setName(i18next.t("Propertys template_o"))
			.setDesc(i18next.t("Propertys template"))
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.mocPropertysTemplate).onChange(async (value) => {
					this.plugin.settings.mocPropertysTemplate = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName(i18next.t("content")).setHeading();
		new Setting(containerEl)
			.setName(i18next.t("imageFormat_o"))
			.setDesc(i18next.t("imageFormat"))
			.addDropdown((text) =>
				text
					.addOptions({
						"![](imagePath)": "![](imagePath)",
						"![[imagePath]]": "![[imagePath]]"
					})
					.setValue(this.plugin.settings.imageFormat)
					.onChange(async (value) => {
						this.plugin.settings.imageFormat = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName(i18next.t("reformatting_o"))
			.setDesc(i18next.t("reformatting"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.reformatting).onChange(async (value) => {
					this.plugin.settings.reformatting = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName(i18next.t("helper")).setHeading();
		new Setting(containerEl)
			.setName(i18next.t("Auto open right panel_o"))
			.setDesc(i18next.t("Auto open right panel"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.autoOpenRightPanel).onChange(async (value) => {
					this.plugin.settings.autoOpenRightPanel = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl).setName(i18next.t("developing")).setHeading();
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
		new Setting(containerEl)
			.setName(i18next.t("more log_o"))
			.setDesc(i18next.t("more log"))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.moreLog)
					.onChange(async (value) => {
						this.plugin.settings.moreLog = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl).setName("Experimental").setHeading();
		new Setting(containerEl)
			.setName("Booknav integration")
			.setDesc("Insert the booknav code block at the bottom of each note.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.booknavIntegration)
					.onChange(async (value) => {
						this.plugin.settings.booknavIntegration = value;
						await this.plugin.saveSettings();
					});
			});
	}
}
