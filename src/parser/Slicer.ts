/**
 * Slicer：按目录把章节 XHTML 切成片段 —— 基于 Covering（全域覆盖）实现。
 *
 * 与旧实现的关键差异（见 docs/parser-first-principles.html）：
 *
 * - 旧实现用 `entries.filter(e => e.fragment)` 窄化工作集，副作用是把
 *   「无锚点条目」及其代表的「文件开头内容」**静默丢弃**
 *   （《自控力》实测：10 个文件受影响、10 个条目消失、诊断数 0）。
 * - 新实现：先用**对齐阶梯**给目录条目定位，再把**全部原子**分区成互相衔接的区域。
 *   每个原子必须有归宿 —— 由 `createCovering` 保证，漏一个就**构造失败**。
 *   定位不到的**目录条目**不再静默消失，而是聚合后显式上报。
 *
 * 公理对应：
 * - 公理 0：原子只持有源节点引用（不拷贝）。
 * - 公理 1：createCovering 的全域分区 —— 「丢弃」不可表达。
 * - 公理 3：对齐是阶梯式协商（L0→L3），而非「查 id，查不到就整文件」。
 * - 公理 4：每个区域携带置信度与溯源层级。
 */

import { parseHTML } from 'linkedom';
import type { Book, ChapterContent, Diags, FileProvider, TocEntry } from './types';
import { pushDiag } from './types';
import { atomsOf, createCovering, normalizeText } from './Covering';
import { CoveringError } from './Covering';
import type { Atom, Classification } from './Covering';

export type AlignLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

/** 各对齐层级的置信度（公理 4：永不把猜测呈现为事实） */
export const LEVEL_CONFIDENCE: Record<AlignLevel, number> = {
	L0: 1, L1: 0.95, L2: 0.7, L3: 0.5, L4: 0.3,
};

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** id 归一化：去空白、URL 解码、转小写（L1） */
function normId(s: string): string {
	let out = String(s ?? '').trim();
	try {
		out = decodeURIComponent(out);
	} catch {
		/* 非法转义时沿用原值 */
	}
	return out.toLowerCase();
}

/** 标题文本相似判定（L2）：相等或互相包含 */
function textMatches(a: string, b: string): boolean {
	if (!a || !b) return false;
	return a === b || a.includes(b) || b.includes(a);
}

interface Placement {
	entry: TocEntry;
	/** 起始原子下标 */
	start: number;
	level: AlignLevel;
}

interface Span {
	key: string;
	start: number;
	/** 不含 */
	end: number;
	owner?: Placement;
}

/**
 * 给一个文件的目录条目定位（对齐阶梯）。
 * @returns placements 可定位的条目；unresolved 无法定位的条目；missingFragments 声明了锚点但找不到的数量
 */
function resolvePlacements(
	document: any,
	atoms: Atom[],
	entries: TocEntry[],
): { placements: Placement[]; unresolved: TocEntry[]; missingFragments: number } {
	// 元素 → 原子下标（锚点可能嵌在原子内部，需向上找到所属原子）
	const nodeIndex = new Map<any, number>();
	for (const a of atoms) nodeIndex.set(a.node, a.index);
	const atomIndexOf = (el: any): number => {
		let n = el;
		while (n) {
			if (nodeIndex.has(n)) return nodeIndex.get(n) as number;
			n = n.parentNode;
		}
		return -1;
	};

	// L1 索引：归一化 id → 原子下标
	const idIndex = new Map<string, number>();
	for (const a of atoms) {
		if (a.id) {
			const k = normId(a.id);
			if (!idIndex.has(k)) idIndex.set(k, a.index);
		}
	}

	const placements: Placement[] = [];
	const pending: TocEntry[] = [];
	let missingFragments = 0;

	for (const e of entries) {
		if (e.fragment) {
			// L0：精确 id
			const el = document.getElementById(e.fragment);
			if (el) {
				const idx = atomIndexOf(el);
				if (idx >= 0) {
					placements.push({ entry: e, start: idx, level: 'L0' });
					continue;
				}
			}
			// L1：归一化 id
			const k = normId(e.fragment);
			if (idIndex.has(k)) {
				placements.push({ entry: e, start: idIndex.get(k) as number, level: 'L1' });
				continue;
			}
			missingFragments++;
		}
		pending.push(e);
	}

	const used = new Set(placements.map((p) => p.start));

	// L2：标题文本匹配（未被占用的标题原子）
	const headings = atoms.filter((a) => HEADING_TAGS.has(a.tag) && !used.has(a.index));
	const stillPending: TocEntry[] = [];
	for (const e of pending) {
		const label = normalizeText(e.label);
		const hit = headings.find((h) => !used.has(h.index) && textMatches(h.text, label));
		if (hit) {
			used.add(hit.index);
			placements.push({ entry: e, start: hit.index, level: 'L2' });
		} else {
			stillPending.push(e);
		}
	}

	// L3：保序分配 —— 剩余条目按目录顺序 ↔ 剩余标题原子按文档顺序（单调）
	const remaining = headings.filter((h) => !used.has(h.index));
	const unresolved: TocEntry[] = [];
	let hi = 0;
	for (const e of stillPending) {
		if (hi < remaining.length) {
			placements.push({ entry: e, start: remaining[hi++].index, level: 'L3' });
		} else {
			unresolved.push(e);
		}
	}

	return { placements, unresolved, missingFragments };
}

/** 由定位结果构造互相衔接的区间（保证平铺 [0, n)，从而满足全域律） */
function buildSpans(atoms: Atom[], placements: Placement[]): Span[] {
	const sorted = [...placements].sort((a, b) => a.start - b.start);
	const seen = new Set<number>();
	const owners: Placement[] = [];
	for (const p of sorted) {
		if (seen.has(p.start)) continue; // 同一位置的后续条目不单独成区（内容已被前一段覆盖）
		seen.add(p.start);
		owners.push(p);
	}

	const spans: Span[] = [];
	if (owners.length === 0) {
		spans.push({ key: 'whole', start: 0, end: atoms.length });
		return spans;
	}
	if (owners[0].start > 0) {
		spans.push({ key: 'head', start: 0, end: owners[0].start });
	}
	for (let i = 0; i < owners.length; i++) {
		const start = owners[i].start;
		const end = i + 1 < owners.length ? owners[i + 1].start : atoms.length;
		spans.push({ key: `s${start}`, start, end, owner: owners[i] });
	}
	return spans;
}

export async function sliceBook(
	book: Book,
	fileProvider: FileProvider,
	diags?: Diags,
): Promise<ChapterContent[]> {
	const d = diags ?? book.diagnostics;
	const out: ChapterContent[] = [];

	// 按文件分组目录项
	const byFile = new Map<string, TocEntry[]>();
	for (const e of book.nav) {
		const list = byFile.get(e.fileHref) ?? [];
		list.push(e);
		byFile.set(e.fileHref, list);
	}

	// 全书聚合统计（避免逐文件刷屏）
	let missingFragments = 0;
	let unresolvedEntries = 0;
	let headPreamble = 0;
	const levelCounts: Record<string, number> = {};
	const bump = (k: string) => {
		levelCounts[k] = (levelCounts[k] ?? 0) + 1;
	};

	const docCache = new Map<string, { document: any }>();
	async function getDoc(href: string) {
		const cached = docCache.get(href);
		if (cached) return cached;
		const xhtml = await fileProvider.readText(href, d);
		if (xhtml === undefined) return undefined;
		const parsed = parseHTML(xhtml);
		const entryDoc = { document: parsed.document };
		docCache.set(href, entryDoc);
		return entryDoc;
	}

	// ---- 无目录：退化为按 spine 整文件（保证所有文档都被产出） ----
	if (byFile.size === 0) {
		pushDiag(d, 'info', '无目录，按 spine 整文件切分', { code: 'slice-spine-fallback' });
		for (const sp of book.spine) {
			if (!sp.manifestItem) continue;
			const href = sp.manifestItem.href;
			const doc = await getDoc(href);
			if (!doc) continue;
			const body = doc.document.body ?? doc.document.documentElement;
			const atoms = atomsOf(body);
			bump('spine');
			const covering = createCovering(atoms, () => ({
				region: 'spine',
				label: sp.idref,
				level: 0,
				confidence: 1,
				source: 'spine',
			}));
			out.push({
				id: sp.idref,
				level: 0,
				fileHref: href,
				html: covering.regions[0]?.html ?? body.innerHTML,
			});
		}
		return out;
	}

	// ---- 有目录：以 spine 阅读序为主循环 ----
	// 框架边界（反思结论）：守恒的「域」是 spine 全集 —— spine 才是阅读本体，
	// nav 只是标注层，且可能残缺、写坏（如本书把 10 章全嵌在「导言」之下、
	// 每章正文页完全不入目录）。文件级原子覆盖只对「进入本循环的文档」成立；
	// 若以 nav 划界，未被 nav 引用的 spine 文档会整体逸出守恒域、静默丢失
	// （实测《自控力》：9 章开篇导语 + 整篇结语约 8 千字，诊断数 0）。
	// 因此按 spine 顺序迭代：被引用的文档照常切片；未被引用的文档（孤儿）
	// 按阅读位置并入前一章节（顺序保持）或成为独立卷首笔记 —— 绝不静默。
	const spineHrefs = (book.spine ?? []).map((s) => s.manifestItem?.href).filter(Boolean);
	// nav 引用了但不在 spine 里的文档（异常目录指向额外文件）按 nav 出现序补在末尾
	const order = [...new Set([...spineHrefs, ...byFile.keys()])];
	const seenDocs = new Set<string>();
	const front: ChapterContent[] = [];
	const orphanStats = { merged: 0, front: 0, empty: 0 };
	const orphanMergedHrefs: string[] = [];
	const orphanFrontHrefs: string[] = [];

	/** 为卷首孤儿文档推断一个可读标题（内容线索 → 兜底取首段） */
	const inferOrphanTitle = (doc: any): string => {
		const raw = doc?.document?.body?.textContent ?? '';
		const t = normalizeText(raw);
		const bookTitle = normalizeText(String(book.metadata?.title ?? ''));
		const html = doc?.document?.body?.innerHTML ?? '';
		if (t && bookTitle && t === bookTitle) return '书名页';
		if (/版权|CIP|ISBN|图书在版编目|版权所有/.test(t)) return '版权页';
		if (/目\s*录/.test(t) && (html.match(/<a\b/g) ?? []).length >= 2) return '目录';
		// 无文本的视觉页：按载体命名，而不是含糊的「未收录页」
		if (!t && /<svg\b/i.test(html)) return '书名页';
		if (!t && /<img\b/i.test(html)) return '封面';
		const firstPara = t.split(/(?<=[。！？!?])|\n/).map((s) => s.trim()).find((s) => s.length > 0) ?? t;
		return firstPara.length > 40 ? `${firstPara.slice(0, 40)}…` : (firstPara || '未收录页');
	};

	for (const file of order) {
		if (seenDocs.has(file)) continue;
		seenDocs.add(file);

		const entries = byFile.get(file);
		if (!entries) {
			// —— spine 孤儿文档：在阅读序中、却没有任何目录条目 ——
			const doc = await getDoc(file);
			if (!doc) continue;
			const body = doc.document.body ?? doc.document.documentElement;
			const atoms = atomsOf(body);
			if (atoms.length === 0) {
				orphanStats.empty++;
				continue;
			}
			const bodyHtml = atoms.map((a) => a.node.outerHTML ?? a.node.nodeValue ?? '').join('\n');
			if (out.length === 0) {
				// 阅读序最前部（书名页/版权页/目录页…）：独立成顶层笔记
				front.push({
					id: file,
					title: inferOrphanTitle(doc),
					level: 0,
					fileHref: file,
					html: bodyHtml,
				});
				orphanStats.front++;
				orphanFrontHrefs.push(file);
			} else {
				// 中/后部：紧跟其前的章节（spine 顺序即阅读顺序）→ 并入该章节内容
				const last = out[out.length - 1];
				last.html = `${last.html}\n${bodyHtml}`;
				orphanStats.merged++;
				orphanMergedHrefs.push(file);
			}
			continue;
		}

		// 首个被引用文档出现前积累的卷首孤儿 → 先落盘，保持阅读序
		if (front.length > 0) {
			out.push(...front);
			front.length = 0;
		}

		const doc = await getDoc(file);
		if (!doc) {
			pushDiag(d, 'warning', `切分时找不到文件：${file}`, { code: 'slice-file-missing', data: file });
			continue;
		}
		const body = doc.document.body ?? doc.document.documentElement;
		const atoms = atomsOf(body);
		if (atoms.length === 0) continue;

		// 单条目文件：整文件即该条目的内容。
		// 关键：不要用标题去「猜」切分 —— 那会把「整章」误拆成多篇
		// （如《资治通鉴》290 个文件与目录 1:1，逐个文件都只有一个条目）。
		if (entries.length === 1) {
			const e0 = entries[0];
			// 仍统计「声明了锚点但找不到」，保留该书的诊断信号
			if (e0.fragment) {
				const el = doc.document.getElementById(e0.fragment);
				const key = normId(e0.fragment);
				const hasId = atoms.some((a) => a.id && normId(a.id) === key);
				if (!el && !hasId) missingFragments++;
			}
			bump('whole');
			const covering = createCovering(atoms, () => ({
				region: 'whole',
				label: e0.label,
				level: e0.level,
				confidence: 1,
				source: 'whole',
			}));
			for (const r of covering.regions) {
				out.push({
					id: e0.manifestId ?? e0.href,
					title: r.label,
					level: r.level,
					fileHref: file,
					fragment: e0.fragment,
					html: r.html,
				});
			}
			continue;
		}

		const { placements, unresolved, missingFragments: mf } = resolvePlacements(doc.document, atoms, entries);
		missingFragments += mf;

		const spans = buildSpans(atoms, placements);

		// 文件开头那一段：优先交给「无锚点」的条目（现实中它往往就是章节标题本身）
		const headSpan = spans.find((s) => s.key === 'head');
		if (headSpan) {
			const candIdx = unresolved.findIndex((e) => !e.fragment);
			if (candIdx >= 0) {
				const cand = unresolved.splice(candIdx, 1)[0];
				headSpan.owner = { entry: cand, start: headSpan.start, level: 'L3' };
			} else if (unresolved.length > 0) {
				const cand = unresolved.shift() as TocEntry;
				headSpan.owner = { entry: cand, start: headSpan.start, level: 'L3' };
			}
		}
		// 头部仍无归属（所有条目都已定位到正文内部）→ 头部是「无主内容」：
		//   携带真实文本时，作为首章前言并入第一个区域（不产出一篇标题为
		//   「(文件开头)」的孤岛笔记）；只有空壳/void 时并入同样安全 ——
		//   没有内容可失去，只是区域边界上移。两种并入都以 info 溯源。
		if (headSpan && !headSpan.owner) {
			const first = spans.find((s) => s.owner);
			if (first) {
				const headText = atoms
					.slice(headSpan.start, headSpan.end)
					.reduce((s, a) => s + a.text.length, 0);
				if (headText > 0) headPreamble += 1;
				first.start = headSpan.start;
				spans.splice(spans.indexOf(headSpan), 1);
			}
		}
		// 剩下仍无归属的条目：内容已被相邻区域覆盖，但条目本身必须显式登记
		unresolvedEntries += unresolved.length;

		// 原子 → 区间（平铺，故每个原子必有归宿）
		const atomToSpan = new Map<number, Span>();
		for (const s of spans) {
			for (let i = s.start; i < s.end; i++) atomToSpan.set(i, s);
		}

		const classify = (a: Atom): Classification | undefined => {
			const s = atomToSpan.get(a.index);
			if (!s) return undefined; // 不可达：一旦发生，createCovering 会抛错
			const owner = s.owner;
			// 无归属区域只剩「全部条目都定位失败」的整文件兜底（上述合并已把其余
			// 无主头部并入首章）：此时用该文件第一个目录条目的标题命名，
			// 而不是占位符「(文件开头)」——否则库里会出现一篇无法识别的笔记。
			return {
				region: s.key,
				label: owner ? owner.entry.label : (entries[0]?.label ?? '(整文件)'),
				level: owner ? owner.entry.level : (entries[0]?.level ?? 0),
				confidence: owner ? LEVEL_CONFIDENCE[owner.level] : LEVEL_CONFIDENCE.L4,
				source: owner ? owner.level : (s.key === 'whole' ? 'whole' : 'head'),
			};
		};

		let covering;
		try {
			covering = createCovering(atoms, classify);
		} catch (err) {
			// 理论上不可达。若真发生：显式报 fatal，同时整文件兜底（绝不丢内容）
			pushDiag(d, 'fatal', `覆盖构造失败（${file}）：${(err as Error).message}`, {
				code: 'covering-incomplete',
				data: file,
			});
			out.push({
				id: entries[0]?.manifestId ?? entries[0]?.href ?? file,
				title: entries[0]?.label,
				level: entries[0]?.level ?? 0,
				fileHref: file,
				html: body.innerHTML,
			});
			continue;
		}

		for (const r of covering.regions) {
			bump(r.source ?? 'unknown');
			const span = spans.find((s) => s.key === r.key);
			const owner = span?.owner;
			out.push({
				id: owner
					? (owner.entry.manifestId ?? owner.entry.href)
					: (entries[0]?.manifestId ?? entries[0]?.href ?? file),
				title: r.label,
				level: r.level,
				fileHref: file,
				fragment: owner?.entry.fragment,
				html: r.html,
			});
		}
	}

	// ---- 聚合上报 ----
	if (orphanStats.merged > 0) {
		pushDiag(
			d,
			'info',
			`${orphanStats.merged} 个未入目录的 spine 文档已按阅读序并入前一章节（内容未丢）：${orphanMergedHrefs.join(', ')}`,
			{ code: 'spine-orphan-merged', data: { count: orphanStats.merged, files: orphanMergedHrefs } },
		);
	}
	if (orphanStats.front > 0) {
		pushDiag(
			d,
			'info',
			`${orphanStats.front} 个卷首文档（无目录条目）已作为独立笔记产出：${orphanFrontHrefs.join(', ')}`,
			{ code: 'spine-orphan-front', data: { count: orphanStats.front, files: orphanFrontHrefs } },
		);
	}
	if (orphanStats.empty > 0) {
		pushDiag(d, 'info', `${orphanStats.empty} 个 spine 文档为空（无可并入内容）`, {
			code: 'spine-orphan-empty',
			data: { count: orphanStats.empty },
		});
	}
	if (missingFragments > 0) {
		pushDiag(
			d,
			'warning',
			`${missingFragments} 个目录锚点在正文中不存在（内容已由相邻区域覆盖，未丢失）`,
			{ code: 'anchor-missing-fallback', data: { missing: missingFragments } },
		);
	}
	if (unresolvedEntries > 0) {
		pushDiag(
			d,
			'warning',
			`${unresolvedEntries} 个目录条目无法定位（内容已被相邻区域覆盖，未丢失）`,
			{ code: 'entry-unassigned', data: { entries: unresolvedEntries } },
		);
	}
	if (headPreamble > 0) {
		pushDiag(d, 'info', `${headPreamble} 个文件的开头导语无对应目录条目，已并入首章`, {
			code: 'head-preamble',
			data: { files: headPreamble },
		});
	}
	const dist = Object.entries(levelCounts)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${k}×${v}`)
		.join(' ');
	if (dist) {
		pushDiag(d, 'info', `对齐层级分布：${dist}`, { code: 'align-summary', data: levelCounts });
	}

	return out;
}
