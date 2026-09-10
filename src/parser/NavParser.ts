/**
 * NavParser：解析目录（TOC），统一 EPUB2 NCX 与 EPUB3 nav。
 *
 * 来源：
 * - EPUB3 nav 解析（nav[epub:type="toc"] ol/li/a 递归）：@gxl/epub-parser 的 _genStructureForHTML_v3（改用 linkedom）
 * - EPUB2 NCX 解析（navMap/navPoint 递归）：julien-c/epub 的 walkNavMap / booqs-epub 的 navPointsIterator
 * - 递归层级封顶（level > 7 停止）：julien-c/epub 的 walkNavMap
 * - TOC 链接按文件名匹配 manifest id：@gxl/epub-parser 的 _resolveIdFromLink
 * - 缺字段则记 diag 并 continue（而非静默吞 / 一错就抛）：booqs-epub 的 diags 范式
 */

import { parseHTML } from 'linkedom';
import type { Diags, FileProvider, ManifestItem, TocEntry } from './types';
import { pushDiag } from './types';
import { asArray, attrOf, getBasePath, parseXml, resolveHref } from './xml';
import type { OpfResult } from './OpfParser';

const MAX_LEVEL = 7;

interface BuildCtx {
	base: string;
	manifestByHref: Map<string, ManifestItem>;
	diags: Diags;
}

function buildEntry(ctx: BuildCtx, href: string, label: string, level: number): TocEntry {
	const [filePart, fragment] = href.split('#');
	const fileHref = resolveHref(ctx.base, filePart);
	const manifestItem = ctx.manifestByHref.get(fileHref);
	return {
		label: label || '(无标题)',
		href,
		level,
		fileHref,
		fragment: fragment || undefined,
		manifestId: manifestItem?.id,
	};
}

/** EPUB3：解析 nav.xhtml（用 linkedom，替代 @gxl 的 jsdom） */
function parseNavXhtml(xhtml: string, ctx: BuildCtx): TocEntry[] {
	const { document } = parseHTML(xhtml);
	const navs = Array.from(document.querySelectorAll('nav')) as any[];
	const tocNav = navs.find((n) => n.getAttribute('epub:type') === 'toc');
	if (!tocNav) {
		pushDiag(ctx.diags, 'warning', '未找到 epub:type="toc" 的 nav 元素', { code: 'nav-toc-missing' });
		return [];
	}
	const ol = tocNav.querySelector('ol');
	if (!ol) {
		pushDiag(ctx.diags, 'warning', 'toc nav 缺少 ol', { code: 'nav-ol-missing' });
		return [];
	}
	return walkOl(ol, 0, ctx);
}

function walkOl(ol: any, level: number, ctx: BuildCtx): TocEntry[] {
	const out: TocEntry[] = [];
	for (const li of Array.from(ol.children) as any[]) {
		if (li.nodeName?.toLowerCase() !== 'li') continue;
		const a = li.querySelector('a');
		if (!a) {
			pushDiag(ctx.diags, 'warning', 'nav li 缺少 a 锚点，已跳过', { code: 'nav-li-no-a' });
			continue;
		}
		const href = a.getAttribute('href') || '';
		const label = (a.textContent || '').trim();
		if (!href) {
			pushDiag(ctx.diags, 'warning', 'nav a 缺少 href，已跳过', { code: 'nav-a-no-href' });
			continue;
		}
		out.push(buildEntry(ctx, href, label, level));
		let childOl: any = null;
		for (const child of Array.from(li.children) as any[]) {
			if (child.nodeName?.toLowerCase() === 'ol') {
				childOl = child;
				break;
			}
		}
		if (childOl && level < MAX_LEVEL) out.push(...walkOl(childOl, level + 1, ctx));
	}
	return out;
}

/** EPUB2：解析 NCX（XML 树遍历） */
function parseNcx(ncxXml: string, ctx: BuildCtx): TocEntry[] {
	const parsed = parseXml(ncxXml, ctx.diags);
	const navMap = asArray<any>(parsed?.ncx?.[0]?.navMap)[0];
	if (!navMap) {
		pushDiag(ctx.diags, 'warning', 'NCX 缺少 navMap', { code: 'ncx-no-navmap' });
		return [];
	}
	return walkNcx(asArray<any>(navMap.navPoint), 0, ctx);
}

function walkNcx(navPoints: any[], level: number, ctx: BuildCtx): TocEntry[] {
	const out: TocEntry[] = [];
	for (const np of navPoints) {
		const label = textOfNav(np);
		const src = attrOf(asArray<any>(np.content)[0] ?? {})['src'];
		if (!label) {
			pushDiag(ctx.diags, 'warning', 'navPoint 缺少 label，已跳过', { code: 'ncx-no-label' });
			continue;
		}
		if (!src) {
			pushDiag(ctx.diags, 'warning', 'navPoint 缺少 content src，已跳过', { code: 'ncx-no-src' });
			continue;
		}
		out.push(buildEntry(ctx, src, label, level));
		const children = asArray<any>(np.navPoint);
		if (children.length && level < MAX_LEVEL) out.push(...walkNcx(children, level + 1, ctx));
	}
	return out;
}

function textOfNav(np: any): string {
	const text0 = asArray<any>(np.navLabel)[0]?.text;
	if (Array.isArray(text0)) return String(text0[0]?.['#text'] ?? '').trim();
	if (text0 && typeof text0 === 'object') return String((text0 as any)['#text'] ?? '').trim();
	return String(text0 ?? '').trim();
}

export async function parseNav(
	opf: OpfResult,
	opfPath: string,
	fileProvider: FileProvider,
	diags?: Diags,
): Promise<TocEntry[]> {
	const d = diags ?? [];
	const base = getBasePath(opfPath);
	const manifestByHref = new Map<string, ManifestItem>();
	for (const m of opf.manifest) manifestByHref.set(m.href, m);
	const ctx: BuildCtx = { base, manifestByHref, diags: d };

	// EPUB3：优先 nav
	const navItem = opf.manifest.find((m) => m.properties.includes('nav'));
	if (navItem) {
		const xhtml = await fileProvider.readText(navItem.href, d);
		if (xhtml === undefined) {
			pushDiag(d, 'warning', `无法读取 nav 文档：${navItem.href}`, { code: 'nav-read-failed' });
		} else {
			const entries = parseNavXhtml(xhtml, ctx);
			if (entries.length > 0) return entries;
		}
	}

	// EPUB2：回退到 NCX（spine 的 toc 属性指向的 manifest id）
	if (opf.tocId) {
		const ncxItem = opf.manifestById.get(opf.tocId);
		if (ncxItem) {
			const ncxXml = await fileProvider.readText(ncxItem.href, d);
			if (ncxXml === undefined) {
				pushDiag(d, 'warning', `无法读取 NCX 文档：${ncxItem.href}`, { code: 'ncx-read-failed' });
			} else {
				return parseNcx(ncxXml, ctx);
			}
		} else {
			pushDiag(d, 'warning', `spine toc 指向的 manifest item 不存在：${opf.tocId}`, { code: 'toc-id-missing' });
		}
	}

	pushDiag(d, 'info', '未解析出目录（既无 nav 也无可用 NCX）', { code: 'no-toc' });
	return [];
}
