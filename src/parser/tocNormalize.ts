/**
 * tocNormalize：目录层级归一化（退化根提升）。
 *
 * 为什么存在（框架反思，见 docs/epub-parser-research.md）：
 * nav 的**层级**和锚点一样，是「作者的声明」而非事实 —— 转换工具可能把它写坏。
 * 实测（《自控力》某版）：navPoint 深度 D0=1 / D1=13 / D2=51，即全书 65 条目录里
 * 只有 1 个顶层「导言」，01~10 章、结语、鸣谢全部被降级成它的子级
 * （对照同书另一版目录：这些本应是导言的平级兄弟）。
 *
 * 处理原则（与对齐阶梯同一套心智，不打补丁）：
 * - 证据触发：仅当「顶层恰有 1 项」—— 几十条目录只有 1 个顶层，现实几乎不可能是有意的；
 *   正常书（多顶层）**零影响**。
 * - 保守 reparent：不做内容移动、不删条目；只把「首个带子树的 D1 起」的**连续后缀**提升一层。
 *   理由：D1 里带子树者必是独立章节（引言节极少自带多级小节）；
 *   而紧随其后的无子树项（结语/鸣谢）属于被降级的兄弟带，一并提升。
 *   前缀中无子树的 D1（引言自己的节）留在根下 —— 恰是它们的正确归属。
 * - 不静默：任何提升都上报 `toc-normalized`（info，含 before/after 形状与提升名单）。
 * - 可退：`parseEpub(buf, { normalizeToc: false })` 关闭。
 */

import { pushDiag } from './types';
import type { Diags, TocEntry } from './types';

/** 是否有子树：nav 是前序展平数组，下一项层级更深即「有孩子」 */
function hasSubtree(nav: TocEntry[], i: number): boolean {
	return i + 1 < nav.length && nav[i + 1].level > nav[i].level;
}

function levelHist(nav: TocEntry[]): Record<number, number> {
	const h: Record<number, number> = {};
	for (const e of nav) h[e.level] = (h[e.level] ?? 0) + 1;
	return h;
}

/**
 * 若目录是「退化根」（顶层仅一项且其下有带子树的兄弟带），把该后缀提升为顶层。
 * 就地修改 nav 条目的 level；有修复时向 diags 上报 info。返回是否修复。
 */
export function normalizeTocLevels(nav: TocEntry[], diags?: Diags): boolean {
	if (nav.length < 4) return false;

	// 顶层必须恰有 1 项，且确实有更深层级
	const top = nav.filter((e) => e.level === 0);
	if (top.length !== 1) return false;
	if (nav[0].level !== 0) return false;
	const maxLevel = Math.max(...nav.map((e) => e.level));
	if (maxLevel < 1) return false;

	// 找首个「带子树」的 D1：从此处起的连续后缀都是被降级的兄弟
	const p = nav.findIndex((e, i) => e.level === 1 && hasSubtree(nav, i));
	if (p < 0) return false;
	// 至少提升 2 项才算「一批兄弟」，避免把孤例单节点误抬
	if (nav.length - p < 2) return false;

	const before = levelHist(nav);
	const promotedLabels: string[] = [];
	for (let i = p; i < nav.length; i++) {
		nav[i].level -= 1;
		promotedLabels.push(nav[i].label);
	}
	const after = levelHist(nav);

	const shown = promotedLabels
		.slice(0, 12)
		.map((l) => String(l).slice(0, 20))
		.join('、');
	pushDiag(
		diags ?? [],
		'info',
		`目录层级异常（顶层仅 1 项）：已将后 ${promotedLabels.length} 项提升为顶层（${shown}${promotedLabels.length > 12 ? '…' : ''}）`,
		{
			code: 'toc-normalized',
			data: { before, after, promoted: promotedLabels.length },
		},
	);
	return true;
}
