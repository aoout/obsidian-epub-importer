/**
 * 新内核与 Obsidian 插件的集成层。
 *
 * 2026-09-09 起（新内核转正，旧内核删除）：设置存储的就是内核语义（枚举/相对路径），
 * 这里不再做「翻译/猜测」，只做字段直通 + 进度通知 + 打开 MOC。
 * tag 是书级标记：经 mocFrontmatter 只写入 MOC，不污染每篇笔记。
 */

import { App, Notice, TFile } from "obsidian";
import { createObsidianTarget, importEpubToVault } from "./writer";
import type { ImportOptions } from "./writer";
import type { EpubImporterSettings } from "./settings/settings";

/** 设置已是内核语义，直接映射（无字符串手术/正则猜测） */
function mapSettings(s: EpubImporterSettings): ImportOptions {
	return {
		verbose: s.moreLog,
		write: {
			granularity: s.granularity,
			savePath: s.savePath,
			// assetsPath 是 vault 相对路径模板（可书外/跨书共享）→ assetsVaultPath
			...(s.assetsPath && s.assetsPath.trim()
				? { assetsVaultPath: s.assetsPath }
				: {}),
			mocName: s.mocName,
			noteTemplate: s.noteTemplate,
			onExisting: s.onExisting,
			// tag 只落在 MOC（书级），见 writer 的 frontmatter 域语义
			...(s.tag ? { mocFrontmatter: { tags: [s.tag] } } : {}),
		},
		transform: {
			imageFormat: s.imageFormat,
		},
	};
}

export interface ImportNextHooks {
	/** 批量/拖拽等场景不弹 Notice、不开 MOC（默认 false） */
	silent?: boolean;
}

/**
 * 用新内核导入一本 EPUB。
 * @param epubPath 文件系统绝对路径（由 EpubImporterModal / 拖拽 / 库同步提供）
 */
export async function runImportNext(
	app: App,
	epubPath: string,
	settings: EpubImporterSettings,
	hooks: ImportNextHooks = {},
): Promise<void> {
	const target = createObsidianTarget(app.vault);
	const opts = mapSettings(settings);
	const silent = hooks.silent ?? false;
	let cancelled = false;

	const notice = silent
		? null
		: new Notice("导入中…（可点击「取消」中止）", 0);
	if (notice) {
		const cancelBtn = notice.noticeEl.createEl("button", { text: "取消" });
		cancelBtn.addEventListener("click", () => {
			if (cancelled) return;
			cancelled = true;
			cancelBtn.disabled = true;
			cancelBtn.textContent = "取消中…";
			notice.setMessage("正在取消导入…");
		});
	}

	try {
		const result = await importEpubToVault(epubPath, target, {
			...opts,
			write: {
				...opts.write,
				shouldCancel: () => cancelled,
				onProgress: (p) => {
					if (notice) notice.setMessage(`导入中（${p.phase}）：${p.current}/${p.total}`);
				},
			},
		});

		const fatal = result.diagnostics.find((d) => d.severity === "fatal");
		if (result.cancelled) {
			notice?.setMessage("已取消导入");
		} else if (fatal) {
			if (notice) notice.setMessage(`导入失败：${fatal.message}`);
			new Notice(`导入失败：${fatal.message}`);
			console.error("[epub-importer] fatal:", fatal);
		} else {
			const warns = result.diagnostics.filter((d) => d.severity === "warning");
			if (notice) {
				const msg =
					`导入完成：${result.notes.length} 篇笔记` +
					(warns.length ? `（${warns.length} 条警告，见控制台）` : "");
				notice.setMessage(msg);
			}
			warns.forEach((w) => console.warn("[epub-importer]", w.message, w.data ?? ""));

			// 单本导入完成后打开 MOC；批量(silent)不跳转
			if (!silent && result.mocPath) {
				const moc = app.vault.getAbstractFileByPath(result.mocPath);
				if (moc instanceof TFile) await app.workspace.openLinkText(result.mocPath, "");
			}
		}

		if (settings.moreLog) {
			result.diagnostics
				.filter((d) => d.severity === "debug")
				.forEach((d) => console.log("[epub-importer]", d.message, d.data ?? ""));
		}
	} catch (e) {
		notice?.setMessage(`导入异常：${String(e)}`);
		console.error("[epub-importer] error:", e);
	} finally {
		if (notice) window.setTimeout(() => notice.hide(), 4000);
	}
}
