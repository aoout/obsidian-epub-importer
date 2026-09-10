/**
 * OpfParser：解析 OPF 包文档，产出 metadata / manifest / spine / cover / unique-identifier。
 *
 * 来源：
 * - 命名空间无关键名（title 而非 dc:title）：julien-c/epub
 * - manifest href 归一化到 zip 根（而非正则推导 OPS root）：julien-c/epub 的 _parseManifest
 * - 多作者 / file-as / subjects 数组 / UUID：julien-c/epub 的 _parseMetadata
 * - cover 双策略（EPUB3 properties=cover-image → EPUB2 meta name=cover）：booqs-epub 的 extractCoverItem
 * - unique-identifier 双策略（EPUB3 @unique-identifier → EPUB2 meta dtb:id）：booqs-epub 的 extractUniqueIdentifier
 */

import type { BookMetadata, Creator, Diags, Identifier, ManifestItem, SpineItem } from './types';
import { pushDiag } from './types';
import { asArray, attrOf, getBasePath, parseXml, resolveHref, textOf } from './xml';

export interface OpfResult {
	version?: string;
	uniqueIdentifier?: string;
	metadata: BookMetadata;
	manifest: ManifestItem[];
	manifestById: Map<string, ManifestItem>;
	spine: SpineItem[];
	/** EPUB2 时 spine 上的 toc 属性指向的 NCX manifest id */
	tocId?: string;
	coverItem?: ManifestItem;
}

export function parseOpf(xml: string, opfPath: string, diags?: Diags): OpfResult {
	const d = diags ?? [];
	const parsed = parseXml(xml, d);
	const pkg = asArray<any>(parsed?.package)[0] ?? {};
	const base = getBasePath(opfPath);

	// ---- metadata ----
	const metaEl = asArray<any>(pkg.metadata)[0] ?? {};
	const metadata: BookMetadata = {
		title: textOf(metaEl.title) || undefined,
		creators: [],
		subjects: [],
		identifiers: [],
		meta: {},
	};
	for (const c of asArray<any>(metaEl.creator)) {
		const a = attrOf(c);
		const name = textOf(c);
		if (name) metadata.creators.push({ name, fileAs: a['file-as'], role: a['role'] });
	}
	if (metadata.creators.length === 0) {
		pushDiag(d, 'warning', 'OPF 缺少 dc:creator（作者）', { code: 'no-creator' });
	}
	metadata.publisher = textOf(metaEl.publisher) || undefined;
	const lang = textOf(metaEl.language);
	metadata.language = lang ? lang.toLowerCase() : undefined;
	metadata.description = textOf(metaEl.description) || undefined;
	metadata.date = textOf(metaEl.date) || undefined;
	for (const s of asArray<any>(metaEl.subject)) {
		const t = textOf(s);
		if (t) metadata.subjects.push(t);
	}
	for (const id of asArray<any>(metaEl.identifier)) {
		const a = attrOf(id);
		const value = textOf(id);
		if (value) metadata.identifiers.push({ scheme: a['scheme'], value });
	}
	for (const m of asArray<any>(metaEl.meta)) {
		const a = attrOf(m);
		if (a['name']) metadata.meta[a['name']] = a['content'] ?? textOf(m);
		else if (a['property']) metadata.meta[a['property']] = textOf(m);
	}

	// ---- unique-identifier（双策略）----
	let uniqueIdentifier: string | undefined;
	const uidAttr = pkg['@unique-identifier'] as string | undefined;
	if (uidAttr) {
		const idEls = asArray<any>(metaEl.identifier);
		const matched = idEls.find((x) => attrOf(x)['id'] === uidAttr);
		if (matched) uniqueIdentifier = textOf(matched);
		else pushDiag(d, 'warning', `unique-identifier 指向的 identifier 不存在：${uidAttr}`, { code: 'uid-missing' });
	} else {
		const dtb = asArray<any>(metaEl.meta).find((m) => attrOf(m)['name'] === 'dtb:id');
		if (dtb) uniqueIdentifier = attrOf(dtb)['content'];
	}

	// ---- manifest ----
	const manifest: ManifestItem[] = [];
	const manifestById = new Map<string, ManifestItem>();
	for (const item of asArray<any>(pkg.manifest?.[0]?.item)) {
		const a = attrOf(item);
		if (!a['id'] || !a['href']) {
			pushDiag(d, 'warning', 'manifest item 缺少 id 或 href，已跳过', { code: 'manifest-malformed', data: a });
			continue;
		}
		const mi: ManifestItem = {
			id: a['id'],
			href: resolveHref(base, a['href']),
			mediaType: a['media-type'] ?? 'application/octet-stream',
			properties: (a['properties'] ?? '').split(/\s+/).filter(Boolean),
			fallback: a['fallback'],
		};
		manifest.push(mi);
		manifestById.set(mi.id, mi);
	}
	if (manifest.length === 0) {
		pushDiag(d, 'fatal', 'manifest 为空，无法继续', { code: 'no-manifest' });
	}

	// ---- cover（双策略）----
	let coverItem: ManifestItem | undefined;
	const coverImage = manifest.find((m) => m.properties.includes('cover-image'));
	if (coverImage) {
		coverItem = coverImage;
	} else {
		const coverMeta = asArray<any>(metaEl.meta).find((m) => attrOf(m)['name'] === 'cover');
		if (coverMeta) {
			const idref = attrOf(coverMeta)['content'];
			coverItem = idref ? manifestById.get(idref) : undefined;
			if (!coverItem) pushDiag(d, 'warning', `cover meta 指向的 manifest item 不存在：${idref}`, { code: 'cover-missing' });
		} else {
			pushDiag(d, 'info', '未声明封面（EPUB3 cover-image / EPUB2 meta cover 均无）', { code: 'no-cover' });
		}
	}

	// ---- spine ----
	const spineEl = asArray<any>(pkg.spine)[0] ?? {};
	const tocId = spineEl['@toc'] as string | undefined;
	const spine: SpineItem[] = [];
	for (const ir of asArray<any>(spineEl.itemref)) {
		const a = attrOf(ir);
		if (!a['idref']) {
			pushDiag(d, 'warning', 'spine itemref 缺少 idref，已跳过', { code: 'spine-malformed' });
			continue;
		}
		spine.push({
			idref: a['idref'],
			manifestItem: manifestById.get(a['idref']),
			linear: a['linear'] !== 'no',
		});
	}
	if (spine.length === 0) {
		pushDiag(d, 'fatal', 'spine 为空，无法继续', { code: 'no-spine' });
	}

	return {
		version: pkg['@version'] || '2.0',
		uniqueIdentifier,
		metadata,
		manifest,
		manifestById,
		spine,
		tocId,
		coverItem,
	};
}
