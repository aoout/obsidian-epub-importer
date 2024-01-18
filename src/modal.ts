import EpubImporterPlugin from "./main";
import { App, Notice, SuggestModal } from "obsidian";
import jetpack from "fs-jetpack";

export class EpubImporterModal extends SuggestModal<string> {
	onSubmit: (result: string) => void;
	libraries: string[];
	emptyStateText = "No .epub files found in libraries.";

	getSuggestions(query: string): string[] | Promise<string[]> {
		const result: string[] = [];
		this.libraries.forEach((lib) => {
			jetpack.find(lib, { matching: "**/**.epub" }).forEach((path) => {
				result.push(jetpack.path(path));
			});
		});
		return result.filter((path) => path.includes(query));
	}

	renderSuggestion(value: string, el: HTMLElement) {
		el.createEl("div", { text: value });
	}

	onChooseSuggestion(item: string) {
		this.trySubmit(item);
	}

	trySubmit(path: string) {
		const epubPath = path.replace(/^"(.+(?="$))"$/, "$1");
		try {
			this.onSubmit(epubPath);
			this.close();
		} catch (error) {
			new Notice("Invalid path.");
		}
	}

	listenfromFile() {
		this.inputEl.addEventListener("paste", (data) => {
			if (data.clipboardData.files.length == 1) {
				//@ts-ignore
				const path = data.clipboardData.files[0].path;
				this.inputEl.value = path;
			}
		});
	}

	listenfromEnter(func: () => void) {
		this.inputEl.addEventListener("keyup", ({ key }) => {
			if (key === "Enter") {
				func();
			}
		});
	}

	constructor(app: App, plugin: EpubImporterPlugin, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
		this.libraries = plugin.settings.libraries;
		this.listenfromFile();
		this.listenfromEnter(() => {
			if (this.inputEl.value) this.trySubmit(this.inputEl.value);
		});
	}
}
