import { App, Modal, Setting } from "obsidian";

interface PromptModalOpts {
	title: string;
	desc?: string;
	placeholder?: string;
	onSubmit: (value: string) => void | Promise<void>;
}

/**
 * 最小文本输入弹窗。
 *
 * 官方风格规范：设置页每一行只放一个控件；需要确认/多步输入的条目
 * 收进 Modal 处理（tab 只存结果）。本弹窗即该模式的通用载体。
 */
export class PromptModal extends Modal {
	constructor(
		app: App,
		private readonly opts: PromptModalOpts
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.opts.title);
		if (this.opts.desc) this.contentEl.createEl("p", { text: this.opts.desc });

		let inputEl!: HTMLInputElement;
		new Setting(this.contentEl)
			.addText((text) => {
				text.setPlaceholder(this.opts.placeholder ?? "");
				inputEl = text.inputEl;
				inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						void this.submit(inputEl.value);
					}
				});
			})
			.addButton((btn) =>
				btn
					.setButtonText(this.opts.title)
					.setCta()
					.onClick(() => void this.submit(inputEl.value))
			);
	}

	private async submit(value: string): Promise<void> {
		const trimmed = value.trim();
		this.close();
		await this.opts.onSubmit(trimmed);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
