import { SuggestModal, Notice, App } from "obsidian";

export abstract class BaseInputModal extends SuggestModal<string> {
	constructor(app: App, private onSubmit: (result: string) => void, enablePaste = false) {
		super(app);
		this.onSubmit = onSubmit;
		if (enablePaste) {
			this.listenForPaste();
		}
	}

	listenForPaste() {
		this.inputEl.addEventListener("paste", (event) => {
			const clipboardData = event.clipboardData;
			if (clipboardData.files.length === 1) {
				//@ts-expect-error
				const path = clipboardData.files[0].path;
				this.inputEl.value = path;
			}
		});
	}

	listenForEnter(validate: (value: string) => boolean = () => true) {
		this.inputEl.addEventListener("keyup", (event) => {
			if (event.key === "Enter" && this.inputEl.value) {
				this.trySubmit(this.inputEl.value, validate);
			}
		});
	}

	trySubmit(value: string, validate: (value: string) => boolean = () => true) {
		if (validate(value)) {
			this.onSubmit(value);
			this.close();
		} else {
			new Notice("Invalid value.");
		}
	}
}
