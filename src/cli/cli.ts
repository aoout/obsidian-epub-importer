/**
 * Epub Importer 命令行入口。
 *
 * 职责边界：参数解析 → 选 WriteTarget → 调 importEpubToVault → 输出摘要。
 * 解析 / 切分 / 转换 / 写入全部复用同一内核，与 Obsidian 插件跑的是同一套代码，
 * 因此插件与 CLI 的行为天然一致，不存在两套实现漂移的风险。
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { importEpubToVault, MemoryTarget } from '../writer';
import type { ImportOptions } from '../writer';
import type { WriteTarget } from '../writer/types';
import { createFilesystemTarget, normalizeWinPath } from './fsTarget';
import { parseArgs, USAGE } from './args';
import type { CliArgs } from './args';

/** 展开输入：文件直接用；目录扫描其中所有 .epub */
export async function collectEpubs(inputs: string[]): Promise<string[]> {
	const out: string[] = [];
	for (const raw of inputs) {
		const p = normalizeWinPath(raw);
		let st;
		try {
			st = await fs.stat(p);
		} catch {
			throw new Error(`输入不存在：${raw}`);
		}
		if (st.isDirectory()) {
			for (const e of await fs.readdir(p)) {
				if (e.toLowerCase().endsWith('.epub')) out.push(path.join(p, e));
			}
		} else {
			out.push(p);
		}
	}
	return out;
}

/**
 * 取消控制器：把「收到中断信号」与「内核读取 shouldCancel」解耦，便于单测。
 * SIGINT 只负责 trigger()，内核在检查点通过 isCancelled() 感知并优雅中止。
 */
export interface CancelController {
	isCancelled(): boolean;
	trigger(): void;
}

export function createCancelController(): CancelController {
	let cancelled = false;
	return {
		isCancelled: () => cancelled,
		trigger: () => {
			cancelled = true;
		},
	};
}

/** 返回进程退出码 */
export async function main(argv: string[]): Promise<number> {
	let args: CliArgs;
	try {
		args = parseArgs(argv);
	} catch (err) {
		console.error(`用法错误：${(err as Error).message}\n`);
		console.error(USAGE);
		return 2;
	}

	if (args.command === 'help') {
		console.log(USAGE);
		return 0;
	}

	let files: string[];
	try {
		files = await collectEpubs(args.inputs);
	} catch (err) {
		console.error(`用法错误：${(err as Error).message}`);
		return 2;
	}
	if (files.length === 0) {
		console.error('用法错误：输入目录下没有 .epub 文件');
		return 2;
	}

	let template: string | undefined;
	if (args.template) {
		try {
			template = await fs.readFile(normalizeWinPath(args.template), 'utf8');
		} catch {
			console.error(`用法错误：无法读取模板文件 ${args.template}`);
			return 2;
		}
	}

	// Ctrl-C：置位后由内核在下一个检查点优雅中止（已写入内容保留）
	const cancel = createCancelController();
	const onSigint = () => {
		if (cancel.isCancelled()) process.exit(130); // 二次 Ctrl-C 立即退出
		cancel.trigger();
		if (!args.json && !args.quiet) console.error('\n正在取消（等待当前检查点）…');
	};
	process.on('SIGINT', onSigint);

	const results: unknown[] = [];
	let exitCode = 0;

	try {
		for (const file of files) {
			// dry-run 用内存 target：完整跑完流水线但不落盘
			const target: WriteTarget = args.dryRun
				? new MemoryTarget()
				: createFilesystemTarget(args.out);

			const opts: ImportOptions = {
				verbose: args.verbose,
				write: {
					granularity: args.granularity,
					savePath: args.savePath,
					assetsPath: args.assets,
					generateMoc: args.moc,
					copyAssets: args.copyAssets,
					onExisting: args.onExisting,
					noteTemplate: template,
					shouldCancel: () => cancel.isCancelled(),
					onProgress: (p) => {
						if (args.quiet || args.json) return;
						process.stderr.write(`\r  ${p.phase}: ${p.current}/${p.total}   `);
					},
				},
			};

			const quiet = args.quiet || args.json;
			if (!quiet) console.log(`导入 ${file}`);

			let result;
			try {
				result = await importEpubToVault(file, target, opts);
			} catch (err) {
				console.error(`导入异常 ${file}：${String(err)}`);
				exitCode = 1;
				continue;
			}
			if (!quiet) process.stderr.write('\n');

			const fatal = result.diagnostics.filter((d) => d.severity === 'fatal');
			const warns = result.diagnostics.filter((d) => d.severity === 'warning');
			const infos = result.diagnostics.filter((d) => d.severity === 'info');
			const debugs = result.diagnostics.filter((d) => d.severity === 'debug');

			results.push({
				file,
				title: result.book.metadata?.title ?? '',
				bookPath: result.bookPath,
				notes: result.notes.length,
				assets: result.assets.length,
				moc: result.mocPath ?? null,
				cancelled: result.cancelled,
				diagnostics: {
					fatal: fatal.length,
					warning: warns.length,
					info: infos.length,
					debug: debugs.length,
				},
				messages: [...fatal, ...warns].map((d) => `${d.severity}: ${d.message}`),
			});

			if (result.cancelled) exitCode = 130;
			else if (fatal.length) exitCode = 1;

			if (!quiet) {
				console.log(
					`  ${result.cancelled ? '已取消' : '完成'}：${result.notes.length} 篇笔记 / `
						+ `${result.assets.length} 个资源`
						+ (result.mocPath ? ` / MOC ${result.mocPath}` : '')
						+ (args.dryRun ? '（dry-run，未写盘）' : ''),
				);
				[...fatal, ...warns].slice(0, 20).forEach((d) => console.log(`  [${d.severity}] ${d.message}`));
				if (args.verbose) debugs.forEach((d) => console.log(`  [debug] ${d.message}`));
			}
		}
	} finally {
		process.off('SIGINT', onSigint);
	}

	if (args.json) console.log(JSON.stringify(results, null, 2));
	return exitCode;
}

/* istanbul ignore next -- 仅作为可执行文件直接运行时才启动 */
if (require.main === module) {
	main(process.argv.slice(2))
		.then((code) => {
			process.exitCode = code;
		})
		.catch((err) => {
			console.error(err);
			process.exitCode = 1;
		});
}
