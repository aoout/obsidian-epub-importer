/**
 * 路径与文件名处理。
 *
 * 改进旧 normalize() 实现（原 src/utils/utils.ts，已删除）：
 * - 原正则 `/[<>:"\\/\\|?*]+/g` 写法混乱（字符类里 `\\` 重复）且只替换成 `_`
 * - 缺长度限制、缺 Windows 保留名处理、缺空名回退、控制字符未清理
 */

import type { WriteTarget } from './types';

const ILLEGAL_CHARS = /[<>:"\\/|?*]/g;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;
/** Windows 保留设备名（作为文件名非法） */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 把任意标题变成安全的文件名 */
export function sanitizeFileName(name: string, maxLength = 100): string {
	let s = String(name ?? '');

	// 控制字符（含 NUL、换行）直接去掉
	s = s.replace(CONTROL_CHARS, '');
	// 文件系统非法字符 → 下划线
	s = s.replace(ILLEGAL_CHARS, '_');
	// 折叠空白（含全角空格）
	s = s.replace(/\s+/g, ' ').trim();
	// Windows 下不能以点或空格结尾
	s = s.replace(/[. ]+$/, '');
	// Windows 保留设备名
	if (RESERVED_NAMES.test(s)) s = `_${s}`;
	// 空名回退
	if (!s) return 'untitled';
	// 超长截断（按字符计，CJK 也按 1 计，与常见文件系统行为一致）
	if (s.length > maxLength) {
		s = s.slice(0, maxLength).replace(/[. ]+$/, '');
	}
	return s || 'untitled';
}

/** 拼接 vault 内路径，统一 posix 分隔符，自动忽略空段 */
export function joinPath(...parts: (string | undefined | null)[]): string {
	const segs = parts
		.filter((p): p is string => typeof p === 'string' && p !== '')
		.map((p) => p.replace(/^\/+|\/+$/g, ''))
		.filter((p) => p !== '');
	return segs.join('/');
}

/** 取目录部分（posix） */
export function dirName(path: string): string {
	const i = String(path ?? '').lastIndexOf('/');
	return i === -1 ? '' : path.slice(0, i);
}

/** 去掉扩展名（用于 wikilink 指向笔记本身） */
export function stripExtension(path: string): string {
	const name = String(path ?? '');
	const i = name.lastIndexOf('.');
	return i > 0 ? name.slice(0, i) : name;
}

/** 取小写扩展名（不含点） */
export function extOf(path: string): string {
	const name = String(path ?? '');
	const i = name.lastIndexOf('.');
	return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

/** 取文件名部分（同时兼容反斜杠路径） */
export function basenameOf(path: string): string {
	const s = String(path ?? '').replace(/\\/g, '/');
	const i = s.lastIndexOf('/');
	return i === -1 ? s : s.slice(i + 1);
}

/** 重名时追加 (1)(2)… ，找不到空位则退化为时间戳后缀 */
export async function uniquePath(
	target: WriteTarget,
	path: string,
	diags?: { push: (msg: string) => void },
): Promise<string> {
	if (!(await target.exists(path))) return path;

	const dot = path.lastIndexOf('.');
	const base = dot > 0 ? path.slice(0, dot) : path;
	const ext = dot > 0 ? path.slice(dot) : '';

	for (let counter = 1; counter <= 999; counter++) {
		const candidate = `${base} (${counter})${ext}`;
		if (!(await target.exists(candidate))) return candidate;
	}

	const fallback = `${base} ${Date.now()}${ext}`;
	diags?.push(`路径重名过多，已退化为时间戳后缀：${fallback}`);
	return fallback;
}
