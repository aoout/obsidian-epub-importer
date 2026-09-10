/**
 * 模板与 frontmatter。
 *
 * 沿用原实现（src/utils/obsidianUtils.ts）的 `{{var}}` 简单替换语义，
 * 但自己实现 YAML 序列化，避免 writer 层在 Node/测试环境下依赖 obsidian 的 stringifyYaml。
 */

/** YAML 标量在什么情况下可以裸写（不需要引号） */
function isBareSafe(s: string): boolean {
	if (s === '') return false;
	if (/^\s|\s$/.test(s)) return false;
	if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return false;
	if (/:\s|\s#/.test(s)) return false;
	if (/^(true|false|null|~|yes|no|on|off)$/i.test(s)) return false;
	// 看起来像数字/日期时加引号，避免被解析成非字符串
	if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return false;
	if (/^\d{4}-\d{2}-\d{2}/.test(s)) return false;
	if (/[\n\r"']/.test(s)) return false;
	return true;
}

function scalar(value: unknown): string {
	if (value === null || value === undefined) return 'null';
	if (typeof value === 'boolean' || typeof value === 'number') return String(value);
	const s = String(value);
	return isBareSafe(s) ? s : JSON.stringify(s);
}

function keyOf(k: string): string {
	return /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(k) ? k : JSON.stringify(k);
}

/**
 * 极简 YAML 序列化：覆盖 frontmatter 常见形态
 * （标量 / 一维数组 / 嵌套对象）。复杂结构退化成 JSON 字符串，不会报错。
 */
export function toYaml(obj: Record<string, unknown>, indent = 0): string {
	const pad = '  '.repeat(indent);
	const lines: string[] = [];

	for (const [rawKey, value] of Object.entries(obj ?? {})) {
		if (value === undefined) continue;
		const key = keyOf(rawKey);

		if (Array.isArray(value)) {
			if (value.length === 0) {
				lines.push(`${pad}${key}: []`);
				continue;
			}
			lines.push(`${pad}${key}:`);
			for (const item of value) {
				if (item !== null && typeof item === 'object') {
					const sub = toYaml(item as Record<string, unknown>, indent + 2).split('\n');
					lines.push(`${pad}  - ${sub[0].trimStart()}`);
					for (const l of sub.slice(1)) lines.push(l);
				} else {
					lines.push(`${pad}  - ${scalar(item)}`);
				}
			}
			continue;
		}

		if (value !== null && typeof value === 'object') {
			const sub = toYaml(value as Record<string, unknown>, indent + 1);
			if (!sub.trim()) {
				lines.push(`${pad}${key}: {}`);
			} else {
				lines.push(`${pad}${key}:`);
				lines.push(sub);
			}
			continue;
		}

		lines.push(`${pad}${key}: ${scalar(value)}`);
	}

	return lines.join('\n');
}

/** 生成 `---\n...\n---`；无有效属性时返回空串（不产生空 frontmatter） */
export function buildFrontmatter(props: Record<string, unknown> | undefined): string {
	if (!props) return '';
	const entries = Object.entries(props).filter(([, v]) => v !== undefined && v !== null && v !== '');
	if (entries.length === 0) return '';
	return `---\n${toYaml(Object.fromEntries(entries))}\n---`;
}

/** `{{key}}` 替换；未定义的变量原样保留（与原实现一致） */
export function renderTemplate(tpl: string, vars: Record<string, unknown>): string {
	if (!tpl) return '';
	return Object.entries(vars ?? {}).reduce(
		(acc, [k, v]) => acc.replaceAll(`{{${k}}}`, String(v ?? '')),
		tpl,
	);
}
