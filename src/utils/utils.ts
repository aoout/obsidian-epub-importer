export function normalize(filename: string): string {
	const invalidChars = /[<>:"\\/\\|?*]+/g;
	return filename.replace(invalidChars, "_");
}
