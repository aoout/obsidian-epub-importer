/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
import EpubImporterPlugin from "./main";
import { App, Notice, SuggestModal } from "obsidian";
import { walk } from "./utils/walker";


function toValidEpubPath(string: string) {
	try {
		// if there is " char at the beginning ,try to delete the " chat at the beginning and end
		if (string.startsWith("\"")) {
			string = string.slice(1, string.length - 1);
		}
		const terms = string.split(".");
		if (terms[terms.length - 1] == "epub") {
			return string;
		} else {
			return false;
		}
	} catch (e) {
		return false;
	}
}

export class EpubImporterModal extends SuggestModal<string> {
	onSubmit: (result: string) => void;
	librarys: string[];

	getSuggestions(query: string): string[] | Promise<string[]> {
		const result: string[] = [];
		this.librarys.forEach((lib) => {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			walk(lib, "file", (filePath: string, stat: any) => {
				if (filePath.indexOf(".epub") !== -1) {
					result.push(filePath);
				}
			});
		});
		return result.filter((path) => path.indexOf(query) !== -1);
	}
	renderSuggestion(value: string, el: HTMLElement) {
		el.createEl("div", { text: value });
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	onChooseSuggestion(item: string, evt: MouseEvent | KeyboardEvent) {
		this.trySubmit(item);
	}
	trySubmit(path: string) {
		const epubPath = toValidEpubPath(path);
		if (epubPath) {
			this.onSubmit(epubPath);
			new Notice(`imported: ${epubPath}`);
			this.close();
		} else {
			new Notice("Invalid path.");
		}
	}

	constructor(
		app: App,
		plugin: EpubImporterPlugin,
		onSubmit: (result: string) => void
	) {
		super(app);

		this.onSubmit = onSubmit;
		console.log(plugin.settings);
		this.librarys = plugin.settings.libratys;

		this.inputEl.addEventListener("keyup", ({ key }) => {
			if (key === "Enter" && this.inputEl.value) {
				this.trySubmit(this.inputEl.value);
			}
		});
	}
}