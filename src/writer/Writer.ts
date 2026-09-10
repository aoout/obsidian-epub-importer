/**
 * 写入执行：把规划好的笔记真正写进 WriteTarget。
 *
 * 相对原实现（src/core/EpubProcessor.ts）的改进：
 * - 不直接碰 fs-jetpack / Vault，改为注入 WriteTarget（可单测、可 dry-run）
 * - 资源落盘走 FileProvider 读二进制，扩展名白名单补上 gif/webp/svg 等（原实现只有 jpg/jpeg/png）
 * - 全程带 onProgress 进度回调与 shouldCancel 中断点（原实现无中断，大书会卡死 UI）
 * - 写入失败记 diags 而非 console.warn 后继续（原实现静默吞异常）
 */

import { parseHTML } from 'linkedom';
import type { Book, Diags, FileProvider } from '../parser/types';
import { pushDiag } from '../parser/types';
import type { TransformedChapter } from '../transform';
import { DEFAULT_ASSET_EXTENSIONS, DEFAULT_WRITER_OPTIONS } from './types';
import type { WriteResult, WriterOptions, WriteTarget, WrittenNote } from './types';
import { planNotes, rewriteLinks } from './planner';
import { buildFrontmatter, renderTemplate } from './template';
import { basenameOf, dirName, extOf, joinPath, sanitizeFileName, uniquePath } from './path';

/** MOC 中用于消歧的父目录名最大长度（超出截断加省略号） */
const MOC_ALIAS_MAX = 16;

/** 递归创建目录（Obsidian 的 createFolder 要求父目录已存在） */
export async function ensureFolder(target: WriteTarget, dir: string): Promise<void> {
	if (!dir) return;
	if (await target.exists(dir)) return;
	const parent = dirName(dir);
	if (parent && parent !== dir) await ensureFolder(target, parent);
	await target.createFolder(dir);
}

export interface AssetsLocator {
	savePath?: string;
	/** 资源目录名（相对书目录），assetsVaultPath 未设时生效 */
	assetsPath?: string;
	/** vault 根相对路径模板（{{savePath}}/{{bookName}}），可把附件放到书外/跨书共享 */
	assetsVaultPath?: string;
}

/**
 * 解析资源目录（vault 根相对）——全流水线唯一权威，保证「落盘位置 == 正文图片链接位置」。
 * - assetsVaultPath 设置时：展开 token（{{savePath}}/{{bookName}}），支持 '../' 上跳；
 *   展开后为空则退回书内 assets。
 * - 否则：书目录下相对目录名（默认 assets），兼容 CLI/既有调用。
 */
export function resolveAssetsDir(locator: AssetsLocator, bookPath: string, bookName: string): string {
	const tpl = String(locator.assetsVaultPath ?? '').trim();
	if (tpl) {
		const expanded = renderTemplate(tpl, {
			savePath: String(locator.savePath ?? ''),
			bookName,
		}).trim();
		const segs: string[] = [];
		for (const seg of expanded.split('/')) {
			if (!seg || seg === '.') continue;
			if (seg === '..') {
				if (segs.length) segs.pop();
				continue;
			}
			segs.push(seg);
		}
		return segs.length ? segs.join('/') : joinPath(bookPath, DEFAULT_WRITER_OPTIONS.assetsPath);
	}
	const name = String(locator.assetsPath ?? '').trim();
	return joinPath(bookPath, name || DEFAULT_WRITER_OPTIONS.assetsPath);
}

/**
 * 元信息日期规整：ISO 日期时间 → 仅日期部分。
 * `2013-04-08T23:00:00+00:00` → `2013-04-08`；已是纯日期/年份/空的原样返回。
 */
export function normalizeDate(raw: unknown): string {
	const s = String(raw ?? '').trim();
	const m = s.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
	return m ? m[1] : s;
}

/** 书籍元数据扁平化，供 {{var}} 模板与 frontmatter 使用 */
export function flattenBook(book: Book): Record<string, unknown> {
	const m = book?.metadata ?? ({} as Book['metadata']);
	const names = (m.creators ?? []).map((c) => c.name).filter(Boolean);
	return {
		book_title: m.title ?? '',
		book_name: m.title ?? '',
		author: names.join(', '),
		authors: names,
		language: m.language ?? '',
		publisher: m.publisher ?? '',
		date: normalizeDate(m.date),
		description: m.description ?? '',
		subjects: m.subjects ?? [],
	};
}

/** 归一化文本（含全角空格）用于标题比对 */
function norm(s: string): string {
	return String(s ?? '').replace(/[\s\u3000]+/g, ' ').trim().toLowerCase();
}

/**
 * 保证正文有 markdown 标题（修复「书内标题不是 <h1..h6>」的解析质量问题，
 * 实测《自控力》：67/67 篇正文首行是裸段落标题，Obsidian 里无大纲）。
 *
 * 规则（只在「正文完全没有标题」时介入，避免与真标题重复）：
 * 1. 正文已含 `#` 标题 → 原样返回（资治通鉴 / Economist / 规整书零影响）。
 * 2. 否则把**首个段落**与笔记标题比对：归一化后相等或互相包含（含「01\n我要做…」
 *    这类换行标题、全角空格差异），匹配则剥掉该段 —— 它只是正文里重复的标题文本。
 * 3. 在正文前注入 `# {{title}}`。
 */
export function ensureNoteHeading(title: string, body: string): string {
	if (/^#{1,6}\s/m.test(body)) return body;
	const titleNorm = norm(title);
	const paraEnd = body.search(/\n\s*\n/);
	const firstPara = (paraEnd === -1 ? body : body.slice(0, paraEnd)).trim();
	const firstNorm = norm(firstPara);
	// 只允许**归一化后全等**才剥离：覆盖「01\n我要做…」换行标题与全角空格差异；
	// 不能用「包含」匹配 —— 否则正常开头段「这是第一章的开头…」会被误删。
	const matched = titleNorm.length >= 2 && firstNorm.length >= 2 && firstNorm === titleNorm;
	const cleaned = matched ? body.slice(paraEnd === -1 ? body.length : paraEnd).replace(/^\s+/, '') : body;
	return `# ${title}\n\n${cleaned}`;
}

export interface WriteBookContext {
	target: WriteTarget;
	book: Book;
	chapters: TransformedChapter[];
	/** 用于读取 EPUB 内资源二进制（图片落盘） */
	provider: FileProvider;
	opts?: WriterOptions;
	diags?: Diags;
}

/**
 * 从章节 HTML 抽取图片引用（<img src> 与 SVG <image href/xlink:href>）。
 * 返回 epub 内相对路径，可能与章节同目录或含 `../`。
 */
function extractImageHrefs(html: string): string[] {
	const { document } = parseHTML(html);
	const out: string[] = [];
	document.querySelectorAll('img').forEach((el: any) => {
		const s = el.getAttribute('src');
		if (s) out.push(s);
	});
	document.querySelectorAll('image').forEach((el: any) => {
		const h = el.getAttribute('href') ?? el.getAttribute('xlink:href');
		if (h) out.push(h);
	});
	return out;
}

/** 把相对 src 解析为 epub 内归一化绝对路径（处理 `..`） */
function resolveRelative(baseHref: string, src: string): string {
	const baseDir = dirName(baseHref);
	const parts = `${baseDir}/${src}`.split('/');
	const stack: string[] = [];
	for (const p of parts) {
		if (p === '' || p === '.') continue;
		if (p === '..') stack.pop();
		else stack.push(p);
	}
	return stack.join('/');
}

export async function writeBook(ctx: WriteBookContext): Promise<WriteResult> {
	const { target, book, chapters, provider } = ctx;
	const diags: Diags = ctx.diags ?? book?.diagnostics ?? [];
	const opts = ctx.opts ?? {};

	const granularity = opts.granularity ?? DEFAULT_WRITER_OPTIONS.granularity;
	const savePath = opts.savePath ?? DEFAULT_WRITER_OPTIONS.savePath;
	const assetsPath = opts.assetsPath ?? DEFAULT_WRITER_OPTIONS.assetsPath;
	const maxNameLength = opts.maxNameLength ?? DEFAULT_WRITER_OPTIONS.maxNameLength;
	const copyAssets = opts.copyAssets ?? DEFAULT_WRITER_OPTIONS.copyAssets;
	const onExisting = opts.onExisting ?? DEFAULT_WRITER_OPTIONS.onExisting;
	// granularity=0 是「全书一篇」，此时没有目录结构可言，不生成 MOC（与原实现一致）
	const generateMoc = (opts.generateMoc ?? DEFAULT_WRITER_OPTIONS.generateMoc) && granularity > 0;
	const verbose = opts.verbose ?? false;

	const bookFlat = flattenBook(book);
	const bookName = sanitizeFileName(bookFlat.book_name as string || 'book', maxNameLength);

	const { notes: planned, linkMap, bookPath } = planNotes(book, chapters, {
		granularity,
		savePath,
		maxNameLength,
		bookName: bookFlat.book_name as string,
	});

	if (verbose) {
		pushDiag(diags, 'debug', `规划完成：bookPath=${bookPath} 计划 ${planned.length} 篇笔记`, {
			code: 'plan-summary',
		});
	}

	const result: WriteResult = {
		bookPath,
		notes: [],
		mocPath: undefined,
		assets: [],
		cancelled: false,
		diagnostics: diags,
	};

	// ---- 目标目录已存在的处理 ----
	if (await target.exists(bookPath)) {
		if (onExisting === 'abort') {
			pushDiag(diags, 'fatal', `目标目录已存在：${bookPath}（可用 onExisting: 'overwrite' 覆盖）`, {
				code: 'write-folder-exists',
				data: bookPath,
			});
			return result;
		}
		if (onExisting === 'overwrite') {
			await target.remove(bookPath);
		}
		// 'merge'：直接继续，重名文件会自动加 (1)
	}

	await ensureFolder(target, bookPath);

	// ---- 资源落盘 ----
	if (copyAssets) {
		const allowed = new Set(
			(opts.assetExtensions ?? DEFAULT_ASSET_EXTENSIONS).map((e) => String(e).toLowerCase()),
		);
		const assetItems = (book.manifest ?? []).filter((m) => allowed.has(extOf(m.href)));
		const assetsDir = resolveAssetsDir({ assetsPath, assetsVaultPath: opts.assetsVaultPath, savePath }, bookPath, bookName);

		opts.onProgress?.({ phase: 'assets', current: 0, total: assetItems.length });

		for (const [i, item] of assetItems.entries()) {
			if (opts.shouldCancel?.()) {
				result.cancelled = true;
				return result;
			}
			const data = await provider.readBinary(item.href, diags);
			if (!data) {
				pushDiag(diags, 'warning', `资源读取失败，已跳过：${item.href}`, {
					code: 'asset-read-failed',
					data: item.href,
				});
				continue;
			}
			// 注意：文件名必须与转换层 image() 的重写规则一致（都是 basename），
			// 否则正文里的图片链接会指向不存在的文件。
			const dest = joinPath(assetsDir, basenameOf(item.href));
			try {
				await ensureFolder(target, assetsDir);
				await target.writeBinary(dest, data);
				result.assets.push(dest);
			} catch (err) {
				pushDiag(diags, 'warning', `资源写入失败：${dest}`, {
					code: 'asset-write-failed',
					data: { dest, error: String(err) },
				});
			}
			opts.onProgress?.({ phase: 'assets', current: i + 1, total: assetItems.length, message: dest });
		}
	}

	// ---- 资源兜底：正文引用但未在 manifest 声明的图片 ----
	// 常见于封面图（仅在 HTML 里 <img>，OPF manifest 漏声明）。不补会导致正文图片链接悬空。
	if (copyAssets) {
		const assetsDir = resolveAssetsDir({ assetsPath, assetsVaultPath: opts.assetsVaultPath, savePath }, bookPath, bookName);
		const landingSeen = new Set(result.assets.map((a) => basenameOf(a)));
		for (const ch of chapters) {
			if (opts.shouldCancel?.()) {
				result.cancelled = true;
				return result;
			}
			if (!ch.markdown.includes('![')) continue;
			const html = await provider.readText(ch.fileHref, diags);
			if (!html) continue;
			for (const rawSrc of extractImageHrefs(html)) {
				if (/^https?:\/\//i.test(rawSrc) || rawSrc.startsWith('data:')) continue;
				// 落地文件名必须与转换层 image() 规则一致：取 src 最后一段
				const fileName = rawSrc.split('/').pop() ?? rawSrc;
				if (landingSeen.has(fileName)) continue;
				const epubPath = resolveRelative(ch.fileHref, rawSrc);
				const data = await provider.readBinary(epubPath, diags);
				if (!data) continue;
				// 落盘用真实文件名（raw）；%20 等编码只出现在链接层（见 transform 的 image()），
				// 这里若编码会导致存储键与解码后的链接不一致。
				const dest = joinPath(assetsDir, fileName);
				try {
					await ensureFolder(target, assetsDir);
					await target.writeBinary(dest, data);
					result.assets.push(dest);
					landingSeen.add(fileName);
				} catch (err) {
					pushDiag(diags, 'warning', `资源写入失败：${dest}`, {
						code: 'asset-write-failed',
						data: { dest, error: String(err) },
					});
				}
			}
		}
	}

	// ---- 笔记写入 ----
	// frontmatter 域语义：
	// - 每篇笔记 = 书元数据(title/author…) ∪ opts.frontmatter
	// - MOC     = 笔记属性 ∪ opts.mocFrontmatter（叠加而非替换）
	// 因此「书级」属性（如 tag）应放 mocFrontmatter，只会落在 MOC 上，不会平铺污染每篇笔记。
	const baseFrontmatter: Record<string, unknown> = {
		title: bookFlat.book_title,
		author: bookFlat.authors,
		...(opts.frontmatter ?? {}),
	};

	const written: WrittenNote[] = [];

	for (const [i, note] of planned.entries()) {
		if (opts.shouldCancel?.()) {
			result.cancelled = true;
			break;
		}

		const prevName = i > 0 ? planned[i - 1].title : '';
		const nextName = i < planned.length - 1 ? planned[i + 1].title : '';
		// 标题注入：正文完全没有标题的畸形书（标题是裸段落）补 `# 标题`
		const body = ensureNoteHeading(note.title, rewriteLinks(note.content, linkMap));

		const vars: Record<string, unknown> = {
			...bookFlat,
			content: body,
			title: note.title,
			chapter_name: note.title,
			book_name: bookName,
			level: note.level,
			index: i + 1,
			total: planned.length,
			prev: prevName,
			next: nextName,
			total_chars: body.length,
			created_time: String(Date.now()),
		};

		const rendered = opts.noteTemplate
			? renderTemplate(opts.noteTemplate, vars)
			: body;

		const fm = buildFrontmatter(baseFrontmatter);
		const finalContent = fm ? `${fm}\n\n${rendered}\n` : `${rendered}\n`;

		let path = `${note.relPath}.md`;
		try {
			path = await uniquePath(target, path);
			await ensureFolder(target, dirName(path));
			await target.write(path, finalContent);
		} catch (err) {
			pushDiag(diags, 'warning', `笔记写入失败：${path}`, {
				code: 'note-write-failed',
				data: { path, error: String(err) },
			});
			continue;
		}

		written.push({ path, title: note.title, level: note.level, sources: note.sources.map((s) => s.id) });
		opts.onProgress?.({ phase: 'notes', current: i + 1, total: planned.length, message: note.title });
	}

	result.notes = written;

	// ---- MOC ----
	if (generateMoc && planned.length > 0 && !result.cancelled) {
		// 链接目标始终是**完整路径**（Obsidian 从库根解析，保证绝不歧义/断链），
		// 展示别名则永远用**短名**（wikilink 的 [[目标|备注]] 语法）——
		// 用户感知到的只有短路径；原始路径只在悬停/跳转时起作用。
		// 同书内重名（如多个「本章总结」）时别名再加父目录名做区分。
		const leafCount = new Map<string, number>();
		for (const n of written) {
			const leaf = basenameOf(n.path).replace(/\.md$/, '');
			leafCount.set(leaf, (leafCount.get(leaf) ?? 0) + 1);
		}

		const mocBody = written
			.map((n) => {
				const link = n.path.replace(/\.md$/, '');
				const leaf = basenameOf(n.path).replace(/\.md$/, '');
				const duplicated = (leafCount.get(leaf) ?? 0) > 1;
				const parent = basenameOf(dirName(n.path));
				// 父目录名可能是整句章节标题，截断以免 MOC 别名过长
				const shortParent = parent.length > MOC_ALIAS_MAX ? `${parent.slice(0, MOC_ALIAS_MAX)}…` : parent;
				const alias = duplicated && parent ? `${shortParent} / ${leaf}` : leaf;
				return `${'  '.repeat(n.level)}- [[${link}|${alias}]]`;
			})
			.join('\n');
		const mocName = sanitizeFileName(
			renderTemplate(opts.mocName ?? DEFAULT_WRITER_OPTIONS.mocName, { bookName, ...bookFlat }) || bookName,
			maxNameLength,
		);
		// mocFrontmatter 在笔记属性之上**叠加**（书级专属属性，如 tag），不替换
		const mocFm = buildFrontmatter({ ...baseFrontmatter, ...(opts.mocFrontmatter ?? {}) });
		const mocContent = mocFm ? `${mocFm}\n\n${mocBody}\n` : `${mocBody}\n`;

		let mocPath = joinPath(bookPath, `${mocName}.md`);
		try {
			mocPath = await uniquePath(target, mocPath);
			await target.write(mocPath, mocContent);
			result.mocPath = mocPath;
		} catch (err) {
			pushDiag(diags, 'warning', `MOC 写入失败：${mocPath}`, {
				code: 'moc-write-failed',
				data: { mocPath, error: String(err) },
			});
		}
		opts.onProgress?.({ phase: 'moc', current: 1, total: 1, message: mocPath });
	}

	opts.onProgress?.({ phase: 'done', current: written.length, total: planned.length });

	if (verbose) {
		pushDiag(diags, 'debug',
			`写入完成：notes=${written.length} assets=${result.assets.length} moc=${result.mocPath ?? '无'}`
				+ `${result.cancelled ? '（已中断）' : ''}`,
			{ code: 'write-summary' });
	}
	return result;
}
