/**
 * 无头体检：跑真实 EPUB，扫描"问题 + 可优化点"。
 * 运行：npx ts-node src/test/analyze.ts <epub路径> [granularity]
 */
import * as path from 'path';
import { importEpubToVault, MemoryTarget } from '../writer';

const epub = process.argv[2] || 'D:/aoout/Documents/Epubs/自控力.epub';
const granularity = Number(process.argv[3] ?? 3);

/** 去掉 frontmatter，返回正文 */
function bodyOf(md: string): string {
	let s = md;
	if (s.startsWith('---\n')) {
		const i = s.indexOf('\n---', 3);
		if (i >= 0) s = s.slice(i + 4);
	}
	return s.replace(/^\n+/, '');
}

/** 粗略抽取笔记里的图片链接目标（basename） */
function imageTargets(md: string): string[] {
	const out: string[] = [];
	const re = /!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(([^)]+)\)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(md))) {
		const raw = (m[1] ?? m[2] ?? '').split('|')[0].trim();
		out.push(raw.split('/').pop() ?? raw);
	}
	return out;
}

/** 抽取 wikilink 目标（笔记名，去 | 后段） */
function wikilinkTargets(md: string): string[] {
	const out: string[] = [];
	const re = /\[\[([^\]]+)\]\]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(md))) {
		out.push(m[1].split('|')[0].split('#')[0].trim());
	}
	return out;
}

(async () => {
	const target = new MemoryTarget();
	const result = await importEpubToVault(epub, target, {
		verbose: true,
		write: { granularity, copyAssets: true },
	});

	const m = result.book.metadata;
	const notes = result.notes;
	const assetSet = new Set(result.assets.map((a) => a.split('/').pop() ?? a));
	const bodies = notes.map((n) => ({ n, raw: target.read(n.path) ?? '', body: bodyOf(target.read(n.path) ?? '') }));

	console.log('================ 体检：' + path.basename(epub) + ' ================');
	console.log('【元信息】');
	console.log('  title   :', JSON.stringify(m?.title));
	console.log('  author  :', JSON.stringify((m?.creators ?? []).map((c) => c.name)));
	console.log('  language:', m?.language, ' publisher:', m?.publisher, ' date:', m?.date);
	console.log('  spine:', result.book.spine.length, ' nav:', result.book.nav.length);

	console.log('【诊断分级】');
	const bySev: Record<string, number> = {};
	for (const d of result.diagnostics) bySev[d.severity] = (bySev[d.severity] ?? 0) + 1;
	console.log('  ', bySev);
	for (const d of result.diagnostics.filter((x) => x.severity !== 'debug')) {
		console.log('   [' + d.severity + ']', d.code, '-', d.message);
	}

	console.log('【笔记】 总数', notes.length, ' MOC', result.mocPath ?? '(无)');
	const empty = bodies.filter((b) => b.body.trim().length === 0);
	const tiny = bodies.filter((b) => b.body.trim().length > 0 && b.body.trim().length < 50);
	console.log('  空正文笔记:', empty.length, ' 极短(<50字):', tiny.length);
	empty.forEach((b) => console.log('    ⚠ 空:', b.n.path));
	// 重复标题
	const titleCount = new Map<string, number>();
	for (const n of notes) titleCount.set(n.title, (titleCount.get(n.title) ?? 0) + 1);
	const dups = [...titleCount.entries()].filter(([, c]) => c > 1);
	console.log('  重复标题数:', dups.length);
	dups.slice(0, 10).forEach(([t, c]) => console.log('    ⚠ 重名', c, '次:', t));

	console.log('【资源/图片】 资源', result.assets.length);
	let dangling = 0;
	const danglingList: string[] = [];
	for (const b of bodies) {
		for (const t of imageTargets(b.raw)) {
			if (!assetSet.has(t)) {
				dangling++;
				if (danglingList.length < 15) danglingList.push(b.n.path + ' -> ' + t);
			}
		}
	}
	console.log('  悬空图片链接:', dangling);
	danglingList.forEach((s) => console.log('    ⚠', s));

	console.log('【内链】 wikilink 总数', bodies.reduce((s, b) => s + wikilinkTargets(b.raw).length, 0));

	console.log('【块引用保真】');
	const bqNotes = bodies.filter((b) => b.body.split('\n').some((l) => /^>\s/.test(l)));
	console.log('  含正确 `> ` 引用格式的笔记:', bqNotes.length, ' / 共', bodies.length);
	console.log('  block-in-inline 诊断数:', result.diagnostics.filter((d) => d.code === 'block-in-inline').length,
		'(畸形 HTML 仍记录；现已提升为块级渲染，保留 `>` 格式)');

	if (result.mocPath) {
		const moc = target.read(result.mocPath) ?? '';
		const lines = moc.split('\n').filter((l) => l.trim());
		console.log('【MOC 抽样】前 10 条');
		lines.slice(0, 10).forEach((l) => console.log('  ' + l));
		const aliased = lines.filter((l) => /\[\[[^\]]+\|[^\]]+\]\]/.test(l));
		console.log('  含消歧别名的条目数:', aliased.length);
		aliased.slice(0, 5).forEach((l) => console.log('    例:', l.trim()));
	}

	console.log('【正文抽样】');
	const picks = [0, Math.floor(bodies.length / 2), bodies.length - 1].filter((i, idx, a) => a.indexOf(i) === idx);
	for (const i of picks) {
		const b = bodies[i];
		console.log('  ----- ' + b.n.path + ' (level ' + b.n.level + ', ' + b.body.length + ' 字) -----');
		console.log(b.body.slice(0, 500));
	}
})().catch((e) => {
	console.error('运行失败:', e);
	process.exit(1);
});
