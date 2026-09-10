/**
 * XML / 路径 / 编码 的低层工具。
 *
 * 来源：
 * - fast-xml-parser 配置（removeNSPrefix / alwaysCreateTextNode / isArray）：booqs-epub/dist/xml.js
 * - 命名空间无关键名访问（title 而非 dc:title）：julien-c/epub 的 key = fullKey.split(":").pop()
 * - 编码嗅探（XML prolog 的 encoding + BOM + iconv-lite 转码）：本仓库差异化点（三家源码均默认 UTF-8）
 */

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import iconv from 'iconv-lite';
import type { Diags } from './types';
import { pushDiag } from './types';

const parser = new XMLParser({
	removeNSPrefix: true,
	ignoreDeclaration: true,
	ignoreAttributes: false,
	attributeNamePrefix: '@',
	alwaysCreateTextNode: true,
	parseAttributeValue: false,
	parseTagValue: false,
	isArray: (_name, _jpath, _isLeaf, isAttribute) => !isAttribute,
});

/** 解析 XML 字符串；校验失败返回 undefined 并记 diag（julien-c 的 XMLValidator 思路） */
export function parseXml(xml: string, diags?: Diags): any {
	if (xml === undefined || xml === null) {
		pushDiag(diags ?? [], 'warning', 'XML 内容为空', { code: 'xml-empty' });
		return undefined;
	}
	const validation = XMLValidator.validate(xml);
	if (validation !== true) {
		const e = (validation as { err: { msg: string; line: number; col: number } }).err;
		pushDiag(diags ?? [], 'warning', `XML 校验失败：${e.msg} (行 ${e.line}:${e.col})`, {
			code: 'xml-invalid',
		});
		// 仍尝试解析，尽量多取数据
	}
	try {
		return parser.parse(xml);
	} catch (err) {
		pushDiag(diags ?? [], 'warning', `XML 解析失败：${(err as Error).message}`, {
			code: 'xml-parse-error',
		});
		return undefined;
	}
}

/** 取元素文本：支持 string / { "#text": "..." } / 数组 */
export function textOf(val: unknown): string {
	if (val == null) return '';
	if (typeof val === 'string') return val.trim();
	if (typeof val === 'number') return String(val);
	if (typeof val === 'object') {
		const o = val as Record<string, unknown>;
		if ('#text' in o) return String(o['#text'] ?? '').trim();
		// 数组时取第一个有文本的成员
		if (Array.isArray(val)) return textOf((val as unknown[])[0]);
	}
	return '';
}

/** 把 @ 前缀的属性收成干净对象（去掉前缀） */
export function attrOf(obj: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const key of Object.keys(obj)) {
		if (key.startsWith('@')) out[key.slice(1)] = String(obj[key]);
	}
	return out;
}

export function asArray<T>(val: T | T[] | undefined): T[] {
	if (val == null) return [];
	return Array.isArray(val) ? val : [val];
}

/** 由 OPF 全路径算 OPS 基目录（zip 根相对） */
export function getBasePath(fullPath: string): string {
	const parts = fullPath.split('/');
	parts.pop();
	return parts.join('/');
}

/** 把相对 href 解析到 zip 根；href 已带基目录则原样返回 */
export function resolveHref(base: string, href: string): string {
	if (!href) return href;
	const cleanBase = base && !base.endsWith('/') ? base + '/' : base;
	if (href.startsWith(cleanBase)) return href;
	return cleanBase + href;
}

/**
 * 从 XML/XHTML 头部扫描声明编码（<?xml ... encoding="..."?>）。
 * 许多 CJK 脏书在此声明 Shift_JIS / GBK，而三家 parser 都忽略它。
 */
export function detectDeclaredCharset(head: string): string | undefined {
	const m = head.match(/encoding\s*=\s*["']([^"']+)["']/i);
	return m ? m[1] : undefined;
}

function normalizeCharset(cs: string): string | undefined {
	const c = cs.trim().toLowerCase().replace(/['"]/g, '');
	if (c === 'utf-8' || c === 'utf8') return 'utf-8';
	// iconv-lite 接受的别名
	if (iconv.encodingExists(c)) return c;
	// 常见别名兜底
	const aliases: Record<string, string> = {
		'gbk': 'gbk',
		'gb2312': 'gb2312',
		'gb18030': 'gb18030',
		'shift_jis': 'shift_jis',
		'shift-jis': 'shift_jis',
		'sjis': 'shift_jis',
		'euc-jp': 'euc-jp',
		'big5': 'big5',
	};
	return aliases[c];
}

export interface DecodeResult {
	text: string;
	charset: string;
	/** 是否做了非 UTF-8 转码（用于记 info diag） */
	transcoded: boolean;
}

/**
 * 把二进制解码成文本：优先 BOM，其次 XML prolog 声明的编码，最后回退 UTF-8。
 * 非 UTF-8 时经 iconv-lite 转码，并返回 transcoded=true（调用方据此记 info diag）。
 */
export function decodeBuffer(buf: Buffer, declaredCharset?: string): DecodeResult {
	if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
		return { text: buf.slice(3).toString('utf-8'), charset: 'utf-8', transcoded: false };
	}
	if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
		return { text: buf.slice(2).toString('utf-16le'), charset: 'utf-16le', transcoded: false };
	}
	if (declaredCharset) {
		const c = normalizeCharset(declaredCharset);
		if (c && c !== 'utf-8' && iconv.encodingExists(c)) {
			return { text: iconv.decode(buf, c), charset: c, transcoded: true };
		}
	}
	return { text: buf.toString('utf-8'), charset: 'utf-8', transcoded: false };
}
