/**
 * Covering：全域覆盖。
 *
 * 解析的产物**不是**「提取出的内容」，而是一组带标签的区域（Region），
 * 其并集 ≡ 输入原子全集。
 *
 * 这是「阶三」安全模型的核心（见 docs/parser-first-principles.html）：
 *
 * - 公理 0（不可变基底）：Atom 只持有源节点引用，不拷贝内容。
 * - 公理 1（全域律）：唯一的构造入口 createCovering 要求**每一个原子都有归宿**。
 *   任一原子没有归宿 → **构造失败**。因此「内容静默消失」在本类型上**不可表达**。
 *   想不投影可以，但必须显式 `disposition: 'waste'` 并给出 reason —— 是分类，不是删除。
 * - 公理 2（双投影）：reportCovering 与「写笔记」是同一个 Covering 的两次投影，
 *   因此二者不可能互相说谎。
 * - 公理 4（置信度）：每个 Region 携带 confidence 与 source（对齐层级）。
 */

/** 原子：文档中不可再分的内容单元（body 的直接子节点） */
export interface Atom {
	/** 在文档中的顺序下标 */
	index: number;
	/** 源节点引用（不拷贝，公理 0） */
	node: any;
	/** 标签名（文本节点为 '#text'） */
	tag: string;
	/** 元素 id（无则 undefined） */
	id?: string;
	/** 归一化文本，用于覆盖率度量与标题文本匹配 */
	text: string;
}

/** 区域的归宿 */
export type Disposition =
	/** 参与投影（写进笔记） */
	| 'keep'
	/** 不投影，但仍登记在覆盖内（分类，不是删除） */
	| 'waste';

/** 单个原子的归类结果 */
export interface Classification {
	/** 区域标识：相邻且同 key 的原子会被合并为一个 Region */
	region: string;
	/** 默认 keep */
	disposition?: Disposition;
	/** disposition='waste' 时的理由（必填，否则构造失败） */
	reason?: string;
	/** 区域标题（一般来自目录条目） */
	label?: string;
	/** 目录层级 */
	level?: number;
	/** 置信度 0..1（公理 4） */
	confidence?: number;
	/** 溯源：如 'L0' / 'L2' / 'L3' / 'head' / 'spine' */
	source?: string;
}

export interface Region {
	key: string;
	label?: string;
	level: number;
	/** 原子区间 [atomStart, atomEnd) */
	atomStart: number;
	atomEnd: number;
	atoms: Atom[];
	disposition: Disposition;
	reason?: string;
	confidence: number;
	source?: string;
	/** 该区域的 XHTML（由原子的 outerHTML 拼接，沿用原有切分语义） */
	html: string;
	/** 该区域的纯文本长度，用于覆盖率度量 */
	textLength: number;
}

export interface Covering {
	atoms: Atom[];
	regions: Region[];
	/** 覆盖率：恒为 1（由构造保证）。保留字段便于外部断言与调试。 */
	coverage: number;
	/** 被归类为 waste 的区域数 */
	wasteRegions: number;
}

/** 构造失败：有原子没有归宿 */
export class CoveringError extends Error {
	constructor(message: string, public readonly unassigned: number[]) {
		super(message);
		this.name = 'CoveringError';
	}
}

export function normalizeText(s: string): string {
	return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** HTML void 元素：没有文本也不含子元素，但承载内容（如 <img>），必须保留 */
const VOID_TAGS = new Set([
	'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
	'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * 从 body 提取原子（公理 0：只持引用，不拷贝）。
 *
 * 「内容单元」的定义刻意收紧：**纯空壳元素不是原子**。
 * 一个元素如果既没有文本、也没有元素子节点、又不是 void 元素
 * （如 `<p></p>`、`<div class="spacer"></div>`），它不承载任何内容 ——
 * 把它排除在原子集之外，就不会被迫为它寻找「归宿」、
 * 也就不会产出「空的开头笔记」。这符合公理 1 的精神：
 * 守恒只约束**内容**，不含内容的壳不在守恒范围内。
 */
export function atomsOf(body: any): Atom[] {
	const out: Atom[] = [];
	let i = 0;
	for (const node of Array.from(body?.childNodes ?? []) as any[]) {
		if (node.nodeType === 1) {
			const tag = String(node.nodeName ?? '').toLowerCase();
			const text = normalizeText(node.textContent ?? '');
			const hasElementChild = Array.from(node.childNodes ?? []).some(
				(n: any) => n.nodeType === 1,
			);
			// 纯空壳（无文本、无元素子节点、非 void）→ 不是内容单元
			if (!text && !hasElementChild && !VOID_TAGS.has(tag)) continue;
			out.push({
				index: i++,
				node,
				tag,
				id: node.getAttribute?.('id') ?? undefined,
				text,
			});
		} else if (node.nodeType === 3) {
			const t = normalizeText(node.nodeValue ?? '');
			if (t) out.push({ index: i++, node, tag: '#text', text: t });
		}
	}
	return out;
}

/**
 * 构造覆盖。唯一的构造入口。
 *
 * @param atoms 原子全集
 * @param classify 为**每个**原子返回归宿；返回 undefined 的原子会导致构造失败。
 * @throws {CoveringError} 任一原子没有归宿，或 waste 缺少理由
 */
export function createCovering(
	atoms: Atom[],
	classify: (atom: Atom, index: number) => Classification | undefined,
): Covering {
	const unassigned: number[] = [];
	const regions: Region[] = [];
	let cur: { key: string; cls: Classification; items: Atom[] } | null = null;

	const flush = () => {
		if (!cur) return;
		const { key, cls, items } = cur;
		if (cls.disposition === 'waste' && !cls.reason) {
			throw new CoveringError(`区域 ${key} 标记为 waste 但缺少理由（分类必须说明理由）`, []);
		}
		regions.push({
			key,
			label: cls.label,
			level: cls.level ?? 0,
			atomStart: items[0].index,
			atomEnd: items[items.length - 1].index + 1,
			atoms: items,
			disposition: cls.disposition ?? 'keep',
			reason: cls.reason,
			confidence: cls.confidence ?? 1,
			source: cls.source,
			html: items.map((a) => (a.node.outerHTML ?? a.node.nodeValue ?? '')).join('\n'),
			textLength: items.reduce((s, a) => s + a.text.length, 0),
		});
		cur = null;
	};

	for (const atom of atoms) {
		const cls = classify(atom, atom.index);
		if (!cls || !cls.region) {
			unassigned.push(atom.index);
			continue;
		}
		if (!cur || cur.key !== cls.region) {
			flush();
			cur = { key: cls.region, cls, items: [] };
		}
		cur.items.push(atom);
	}
	flush();

	if (unassigned.length > 0) {
		const shown = unassigned.slice(0, 20).join(', ');
		throw new CoveringError(
			`全域律被违反：${unassigned.length} 个原子没有归宿（下标 ${shown}${unassigned.length > 20 ? '…' : ''}）。`
				+ ' 覆盖要求每个原子都被归类 —— 若确实不需要，请显式标记 disposition: "waste" 并给出理由。',
			unassigned,
		);
	}

	return {
		atoms,
		regions,
		coverage: 1,
		wasteRegions: regions.filter((r) => r.disposition === 'waste').length,
	};
}

export interface CoveringViolation {
	type: 'gap' | 'overlap' | 'empty' | 'waste-no-reason' | 'coverage';
	detail: string;
}

/** 独立校验（用于测试与防御）：覆盖必须严丝合缝地平铺 [0, n) */
export function verifyCovering(cov: Covering): CoveringViolation[] {
	const v: CoveringViolation[] = [];
	const total = cov.atoms.length;
	let cursor = 0;

	for (const r of cov.regions) {
		if (r.atomStart !== cursor) {
			v.push({ type: 'gap', detail: `区域 ${r.key} 起点 ${r.atomStart}，期望 ${cursor}` });
		}
		if (r.atomEnd <= r.atomStart) {
			v.push({ type: 'empty', detail: `区域 ${r.key} 是空区间` });
		}
		if (r.atomEnd > total) {
			v.push({ type: 'overlap', detail: `区域 ${r.key} 越界 ${r.atomEnd} > ${total}` });
		}
		if (r.disposition === 'waste' && !r.reason) {
			v.push({ type: 'waste-no-reason', detail: `区域 ${r.key} 缺理由` });
		}
		cursor = Math.max(cursor, r.atomEnd);
	}
	if (cursor !== total) {
		v.push({ type: 'coverage', detail: `仅覆盖到 ${cursor}，共 ${total}` });
	}
	return v;
}

/** 覆盖报告：与「写笔记」同源的另一次投影（公理 2） */
export interface CoveringReport {
	atoms: number;
	regions: number;
	keepRegions: number;
	wasteRegions: number;
	coverage: number;
	/** 按文本长度加权的最低/平均置信度（公理 4） */
	minConfidence: number;
	avgConfidence: number;
	/** 溯源层级分布，如 { L0: 12, L2: 3 } */
	bySource: Record<string, number>;
}

export function reportCovering(cov: Covering): CoveringReport {
	const bySource: Record<string, number> = {};
	let weighted = 0;
	let weight = 0;
	let min = 1;

	for (const r of cov.regions) {
		const key = r.source ?? 'unknown';
		bySource[key] = (bySource[key] ?? 0) + 1;
		weighted += r.confidence * r.textLength;
		weight += r.textLength;
		min = Math.min(min, r.confidence);
	}

	return {
		atoms: cov.atoms.length,
		regions: cov.regions.length,
		keepRegions: cov.regions.filter((r) => r.disposition === 'keep').length,
		wasteRegions: cov.wasteRegions,
		coverage: cov.coverage,
		minConfidence: cov.regions.length ? min : 1,
		avgConfidence: weight > 0 ? weighted / weight : 1,
		bySource,
	};
}
