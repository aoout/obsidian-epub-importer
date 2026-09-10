/**
 * 命令行用的「写真实磁盘」WriteTarget。
 *
 * 与 MemoryTarget（测试/dry-run）、createObsidianTarget（插件）并列，
 * 让同一套 writer 内核无需改动即可写本地文件系统。
 *
 * 注意：本文件只在 CLI 里被 import，插件入口（src/main.ts）不会引入它，
 * 因此不会影响 Obsidian 插件的打包产物。
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { WriteTarget } from '../writer/types';

/**
 * 纠正 Git Bash 风格路径：/d/foo 在 Node(Windows) 下会被当成当前盘符根下的 /d/foo，
 * 这里还原成 D:/foo。
 */
export function normalizeWinPath(p: string): string {
	if (!p) return p;
	const m = /^\/([a-zA-Z])\/(.*)$/.exec(p);
	return m ? `${m[1].toUpperCase()}:/${m[2]}` : p;
}

export function createFilesystemTarget(root: string): WriteTarget {
	const rootAbs = path.resolve(normalizeWinPath(root));

	/** vault 内相对路径 → 磁盘绝对路径；阻止 `..` 越出输出根目录 */
	const resolveSafe = (p: string): string => {
		const full = path.resolve(rootAbs, p);
		const rel = path.relative(rootAbs, full);
		if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
			throw new Error(`路径越出输出根目录：${p}`);
		}
		return full;
	};

	return {
		async exists(p: string): Promise<boolean> {
			try {
				await fs.access(resolveSafe(p));
				return true;
			} catch {
				return false;
			}
		},

		async write(p: string, content: string): Promise<void> {
			const full = resolveSafe(p);
			await fs.mkdir(path.dirname(full), { recursive: true });
			await fs.writeFile(full, content, 'utf8');
		},

		async writeBinary(p: string, data: Buffer): Promise<void> {
			const full = resolveSafe(p);
			await fs.mkdir(path.dirname(full), { recursive: true });
			await fs.writeFile(full, data);
		},

		async createFolder(p: string): Promise<void> {
			await fs.mkdir(resolveSafe(p), { recursive: true });
		},

		async remove(p: string): Promise<void> {
			await fs.rm(resolveSafe(p), { recursive: true, force: true });
		},
	};
}
