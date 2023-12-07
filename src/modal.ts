/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
import EpubImporterPlugin from "./main";
import { App, Notice, SuggestModal } from "obsidian";
import jetpack from "fs-jetpack";

export class EpubImporterModal extends SuggestModal<string> {
	onSubmit: (result: string) => void;
	librarys: string[];
	emptyStateText = "No .epub files found in librarys.";
	getSuggestions(query: string): string[] | Promise<string[]> {
		const result: string[] = [];
		this.librarys.forEach((lib) => {
			jetpack.find(lib,{matching:"**/**.epub"}).forEach((path=>{
				result.push(jetpack.path(path));
			}));
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
		const epubPath = path.replace(/^"(.+(?="$))"$/, "$1");
		try {
			this.onSubmit(epubPath);
			new Notice(`imported: ${epubPath}`);
			this.close();
		} catch (error) {
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
		this.librarys = plugin.settings.librarys;

		this.inputEl.addEventListener("keyup", ({ key }) => {
			if (key === "Enter" && this.inputEl.value) {
				this.trySubmit(this.inputEl.value);
			}
		});
	}
}