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
			.setName(i18next.t("translation:Tag_o"))
			.setDesc(i18next.t("translation:Tag"))
			.addText((text) =>
				text
					.setPlaceholder("book")
					.setValue(this.plugin.settings.tag)
					.onChange(async (value) => {
						this.plugin.settings.tag = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl).setName(i18next.t("translation:import")).setHeading();
		new Setting(containerEl)
			.setName(i18next.t("translation:Library_o"))
			.setDesc(i18next.t("translation:Library"))
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.libraries.join("\n")).onChange(async (value) => {
					this.plugin.settings.libraries = value.split("\n").map((lib) => lib.trim());
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName(i18next.t("translation:byDrag_o"))
			.setDesc(i18next.t("translation:byDrag"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.byDrag).onChange(async (value) => {
					this.plugin.settings.byDrag = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl).setName(i18next.t("translation:storage")).setHeading();
		new Setting(containerEl)
			.setName(i18next.t("translation:Save_path_o"))
			.setDesc(i18next.t("translation:Save_path"))
			.addText((text) =>
				text.setValue(this.plugin.settings.savePath).onChange(async (value) => {
					this.plugin.settings.savePath = value;
					await this.plugin.saveSettings();
				})
			);
		new Setting(containerEl)
			.setName(i18next.t("translation:Assets_path_o"))
			.setDesc(i18next.t("translation:Assets_path"))
			.addText((text) =>
				text.setValue(this.plugin.settings.assetsPath).onChange(async (value) => {
					this.plugin.settings.assetsPath = value;
					await this.plugin.saveSettings();
				})
			);
		new Setting(containerEl)
			.setName(i18next.t("translation:backup_directory_Path_o"))
			.setDesc(i18next.t("translation:backup_directory_Path"))
			.addText((text) =>
				text.setValue(this.plugin.settings.backupPath).onChange(async (value) => {
					this.plugin.settings.backupPath = value;
					await this.plugin.saveSettings();
				})
			);
		new Setting(containerEl).setName(i18next.t("translation:display")).setHeading();
		new Setting(containerEl)
			.setName(i18next.t("translation:Hierarchy_depth_o"))
			.setDesc(i18next.t("translation:Hierarchy_depth"))
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
			.setName(i18next.t("translation:Moc_fileName_o"))
			.setDesc(i18next.t("translation:Moc_fileName"))
			.addText((text) =>
				text.setValue(this.plugin.settings.mocName).onChange(async (value) => {
					this.plugin.settings.mocName = value;
					await this.plugin.saveSettings();
				})
			);
		new Setting(containerEl)
			.setName(i18next.t("translation:noteTemplate_o"))
			.setDesc(i18next.t("translation:noteTemplate"))
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.noteTemplate).onChange(async (value) => {
					this.plugin.settings.noteTemplate = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName(i18next.t("translation:Propertys template_o"))
			.setDesc(i18next.t("translation:Propertys template"))
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.mocPropertysTemplate).onChange(async (value) => {
					this.plugin.settings.mocPropertysTemplate = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName(i18next.t("translation:content")).setHeading();
		new Setting(containerEl)
			.setName(i18next.t("translation:imageFormat_o"))
			.setDesc(i18next.t("translation:imageFormat"))
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
			.setName(i18next.t("translation:reformatting_o"))
			.setDesc(i18next.t("translation:reformatting"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.reformatting).onChange(async (value) => {
					this.plugin.settings.reformatting = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName(i18next.t("translation:helper")).setHeading();
		new Setting(containerEl)
			.setName(i18next.t("translation:Auto_open_right_panel_o"))
			.setDesc(i18next.t("translation:Auto_open_right_panel"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.autoOpenRightPanel).onChange(async (value) => {
					this.plugin.settings.autoOpenRightPanel = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl).setName(i18next.t("translation:developing")).setHeading();
		new Setting(containerEl)
			.setName(i18next.t("translation:Remove_duplicate_folders_o"))
			.setDesc(i18next.t("translation:Remove_duplicate_folders"))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.removeDuplicateFolders)
					.onChange(async (value) => {
						this.plugin.settings.removeDuplicateFolders = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(containerEl)
			.setName(i18next.t("translation:more_log_o"))
			.setDesc(i18next.t("translation:more_log"))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.moreLog)
					.onChange(async (value) => {
						this.plugin.settings.moreLog = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(containerEl)
			.setName(i18next.t("translation:Enable_Read_Progress_Manager_o"))
			.setDesc(i18next.t("translation:Enable_Read_Progress_Manager"))
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.enableReadProgressManager)
					.onChange(async (value) => {
						this.plugin.settings.enableReadProgressManager = value;
						await this.plugin.saveSettings();
					});
			});
	}
}
