/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("fs");
const path = require("path");
const c = require("ansi-colors");
const { execSync } = require("child_process");
const manifest = require("./manifest.json");
c.theme({
	danger: c.red,
	dark: c.dim.gray,
	disabled: c.gray,
	em: c.italic,
	heading: c.bold.underline,
	info: c.cyan,
	muted: c.dim,
	primary: c.blue,
	strong: c.bold,
	success: c.green.bold,
	underline: c.underline,
	warning: c.yellow.underline,
});
require("dotenv").config();
let vaultDev = process.env.VAULT_DEV || "";
const args = process.argv.slice(2);
if (args.length > 0 && args[0] === "--prod") {
	vaultDev = process.env.VAULT || "";
}
let msg =
	vaultDev.trim().length > 0 ? `-v ${c.underline.bold.blue(vaultDev)}` : "";
const cmd = vaultDev.trim().length > 0 ? `-v ${vaultDev}` : "";
if (vaultDev.trim().length > 0) {
	const pluginDir = path.join(
		vaultDev,
		".obsidian",
		"plugins",
		manifest.id,
		".hotreload"
	);
	if (!fs.existsSync(pluginDir)) {
		console.log(
			`${c.danger.bold("❌")} ${c.danger(
				".hotreload file not found. Creating it..."
			)}`
		);
		fs.writeFile(pluginDir, "", (err) => {
			if (err) {
				console.error(err);
			}
		});
		setTimeout(function () {}, 1000);
		console.log(`✔️ ${c.success(".hotreload file created.")}`);
		console.log();
	}
}
const styleSheet = "";
const command = `obsidian-plugin dev ${styleSheet} src/main.ts ${cmd}`;
console.log(
	c.info.italic(
		`${c.bold(">")} obsidian-plugin dev ${c.dark.underline(
			styleSheet
		)} src/main.ts ${msg}`
	)
);
execSync(command, { stdio: "inherit" });
