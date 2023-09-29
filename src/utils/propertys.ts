export class Propertys {
	data: Map<string, string | string[]>;
	constructor() {
		this.data = new Map();
	}
	add(key: string, value: string | string[]) {
		this.data.set(key, value);
	}
	toString() {
		let str = "---\n";
		this.data.forEach((value, key) => {
			if (Array.isArray(value)) {
				str += `${key}: \n`;
				value.forEach((element) => {
					str += `  - ${element}\n`;
				});
			} else {
				str += `${key}: ${value}\n`;
			}
		});
		str += "---\n";
		return str;
	}
}
