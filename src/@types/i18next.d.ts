import { resources } from "../i18n/i18next";
declare module "i18next" {
	interface CustomTypeOptions {
		resources: (typeof resources)["en"];
		returnNull: false;
	}
}