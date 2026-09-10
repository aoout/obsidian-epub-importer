/**
 * Covering 内核单测。
 *
 * 这些用例不是「测功能」，而是把 docs/parser-first-principles.html 里的公理
 * 变成可执行断言：
 * - 公理 1（全域律）：漏一个原子就构造失败 —— 「丢失」不可表达。
 * - 公理 2（双投影）：reportCovering 与 regions 同源，不可能互相说谎。
 * - 公理 4（置信度）：猜测必须携带置信度，且能被报告出来。
 */

import { parseHTML } from 'linkedom';
import {
	atomsOf,
	createCovering,
	CoveringError,
	normalizeText,
	reportCovering,
	verifyCovering,
} from '../Covering';
import type { Atom, Classification } from '../Covering';

const HTML = `<html><body>
<h1 id="h1">第一章</h1>
<p>导语内容XYZ。</p>
<h2 id="sec1">第一节</h2>
<p>第一节正文。</p>
<h2 id="sec2">第二节</h2>
<p>第二节正文。</p>
</body></html>`;

function atoms(): Atom[] {
	const { document } = parseHTML(HTML);
	return atomsOf(document.body);
}

describe('atomsOf（公理 0：只持引用，不拷贝）', () => {
	it('只取 body 直接子节点，空白文本不产生原子', () => {
		const a = atoms();
		// 6 个元素，缩进空白不计数
		expect(a).toHaveLength(6);
		expect(a.map((x) => x.tag)).toEqual(['h1', 'p', 'h2', 'p', 'h2', 'p']);
		expect(a[0].id).toBe('h1');
		expect(a[2].id).toBe('sec1');
		expect(a[0].text).toBe('第一章');
	});

	it('原子持有源节点引用（修改源会反映到原子，证明未拷贝）', () => {
		const a = atoms();
		const node = a[1].node;
		node.textContent = '被改写了';
		expect(a[1].node.textContent).toBe('被改写了');
	});

	it('★ 纯空壳不是内容单元：无文本、无子元素的空元素不产生原子', () => {
		const { document } = parseHTML(
			`<html><body>
<p></p>
<div class="spacer">   </div>
<h1>标题</h1>
<p>正文</p>
</body></html>`,
		);
		const a = atomsOf(document.body);
		expect(a.map((x) => x.tag)).toEqual(['h1', 'p']);
		expect(a.map((x) => x.index)).toEqual([0, 1]); // 下标连续，空壳不占位
	});

	it('img 等 void 元素没有文本但承载内容，必须保留（asset 提取依赖它）', () => {
		const { document } = parseHTML(
			`<html><body>
<img src="cover.jpg" alt="封面"/>
<hr/>
<div><img src="a.png"/></div>
</body></html>`,
		);
		const a = atomsOf(document.body);
		const tags = a.map((x) => x.tag);
		expect(tags).toEqual(['img', 'hr', 'div']);
		expect(a[0].node.getAttribute('src')).toBe('cover.jpg');
	});
});

describe('createCovering（公理 1：全域律）', () => {
	it('每个原子都有归宿时构造成功，并平铺 [0, n)', () => {
		const a = atoms();
		const cov = createCovering(a, (atom) => ({
			region: atom.index < 2 ? 'A' : 'B',
			label: atom.index < 2 ? '第一章' : '其余',
		}));
		expect(cov.coverage).toBe(1);
		expect(cov.regions).toHaveLength(2);
		expect(verifyCovering(cov)).toEqual([]);
		expect(cov.regions[0].atomStart).toBe(0);
		expect(cov.regions[0].atomEnd).toBe(2);
		expect(cov.regions[1].atomEnd).toBe(a.length);
	});

	it('★ 漏掉任何一个原子都构造失败 —— 丢失不可表达', () => {
		const a = atoms();
		// 模拟旧实现的思维：只给「我关心的」原子归宿，其余返回 undefined
		expect(() =>
			createCovering(a, (atom) => (atom.index === 0 ? { region: 'A' } : undefined)),
		).toThrow(CoveringError);
	});

	it('失败时指出具体是哪些原子没有归宿', () => {
		const a = atoms();
		try {
			createCovering(a, (atom) => (atom.index < 3 ? { region: 'A' } : undefined));
			throw new Error('应当抛错');
		} catch (err) {
			const e = err as CoveringError;
			expect(e.name).toBe('CoveringError');
			expect(e.unassigned).toEqual([3, 4, 5]);
			expect(e.message).toContain('全域律被违反');
		}
	});

	it('★ 想不投影可以，但必须显式 waste + 理由（分类不是删除）', () => {
		const a = atoms();
		const cov = createCovering(a, (atom) =>
			atom.index === 0
				? { region: 'nav', disposition: 'waste' as const, reason: '目录重复块' }
				: { region: 'body' },
		);
		// waste 仍在覆盖内 —— 它没有被删除
		expect(cov.regions).toHaveLength(2);
		expect(cov.wasteRegions).toBe(1);
		expect(verifyCovering(cov)).toEqual([]);
		expect(cov.regions[0].atoms).toHaveLength(1);
		expect(cov.regions[0].reason).toBe('目录重复块');
	});

	it('waste 缺理由 → 构造失败（不允许无理由地不投影）', () => {
		const a = atoms();
		expect(() =>
			createCovering(a, (atom) =>
				atom.index === 0 ? { region: 'nav', disposition: 'waste' as const } : { region: 'body' },
			),
		).toThrow(/缺少理由/);
	});

	it('相邻同 key 原子合并为一个区域，互不相邻则分成两个', () => {
		const a = atoms();
		const cov = createCovering(a, (atom) => ({
			region: atom.index === 0 || atom.index === 5 ? 'X' : 'Y',
		}));
		expect(cov.regions.map((r) => r.key)).toEqual(['X', 'Y', 'X']);
		expect(verifyCovering(cov)).toEqual([]);
	});
});

describe('verifyCovering（独立校验）', () => {
	it('手造一个有缺口的覆盖会被查出来', () => {
		const a = atoms();
		const cov = createCovering(a, () => ({ region: 'A' }));
		// 人为破坏：丢掉尾部
		cov.regions[0].atomEnd = 3;
		expect(verifyCovering(cov).some((v) => v.type === 'coverage')).toBe(true);
	});
});

describe('reportCovering（公理 2：双投影 + 公理 4：置信度）', () => {
	it('报告与区域同源 —— 数字必然自洽', () => {
		const a = atoms();
		const cov = createCovering(a, (atom) =>
			atom.index < 2
				? { region: 'A', source: 'L0', confidence: 1 }
				: { region: 'B', source: 'L3', confidence: 0.5 },
		);
		const rep = reportCovering(cov);
		expect(rep.atoms).toBe(a.length);
		expect(rep.regions).toBe(cov.regions.length);
		expect(rep.coverage).toBe(1);
		expect(rep.bySource).toEqual({ L0: 1, L3: 1 });
		// 只要存在 L3 猜测，最低置信度就必须如实反映出来（永不把猜测呈现为事实）
		expect(rep.minConfidence).toBe(0.5);
		expect(rep.avgConfidence).toBeLessThan(1);
	});

	it('空覆盖不崩', () => {
		const cov = createCovering([], () => ({ region: 'A' }));
		const rep = reportCovering(cov);
		expect(rep.atoms).toBe(0);
		expect(rep.minConfidence).toBe(1);
	});
});

describe('normalizeText', () => {
	it('折叠空白并去首尾', () => {
		expect(normalizeText('  第  一 \n 章  ')).toBe('第 一 章');
		expect(normalizeText(undefined as unknown as string)).toBe('');
	});
});

/** 供 Slicer 回归用例复用的类型守卫 */
export function isClass(x: unknown): x is Classification {
	return typeof x === 'object' && x !== null && 'region' in x;
}
