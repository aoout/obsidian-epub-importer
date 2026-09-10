/**
 * WriteTarget 的两个实现。
 */

import type { ObsidianVaultLike, WriteTarget } from './types';
import { dirName } from './path';

/**
 * 内存实现：单测与 dry-run 用。
 * 额外提供 read/list/clear 等只读辅助方法便于断言。
 */
export class MemoryTarget implements WriteTarget {
	readonly files = new Map<string, string>();
	readonly binaries = new Map<string, Buffer>();
	readonly folders = new Set<string>();

	async exists(path: string): Promise<boolean> {
		if (this.files.has(path) || this.binaries.has(path) || this.folders.has(path)) return true;
		// 隐式目录：只要路径下有内容，该目录就视为存在
		// （真实文件系统/Obsidian 写入 a/b.md 后，a 目录即存在）
		const prefix = `${path}/`;
		if ([...this.files.keys()].some((k) => k.startsWith(prefix))) return true;
		if ([...this.binaries.keys()].some((k) => k.startsWith(prefix))) return true;
		if ([...this.folders].some((k) => k.startsWith(prefix))) return true;
		return false;
	}

	async write(path: string, content: string): Promise<void> {
		this.files.set(path, content);
	}

	async writeBinary(path: string, data: Buffer): Promise<void> {
		this.binaries.set(path, data);
	}

	async createFolder(path: string): Promise<void> {
		this.folders.add(path);
	}

	async remove(path: string): Promise<void> {
		if (this.files.has(path) || this.binaries.has(path)) {
			this.files.delete(path);
			this.binaries.delete(path);
			return;
		}
		// 目录：连带其下所有内容
		const prefix = `${path}/`;
		for (const key of [...this.files.keys()]) {
			if (key === path || key.startsWith(prefix)) this.files.delete(key);
		}
		for (const key of [...this.binaries.keys()]) {
			if (key === path || key.startsWith(prefix)) this.binaries.delete(key);
		}
		for (const key of [...this.folders]) {
			if (key === path || key.startsWith(prefix)) this.folders.delete(key);
		}
	}

	// ---- 只读辅助（测试用） ----
	read(path: string): string | undefined {
		return this.files.get(path);
	}

	listFiles(): string[] {
		return [...this.files.keys()].sort();
	}

	listBinaries(): string[] {
		return [...this.binaries.keys()].sort();
	}

	clear(): void {
		this.files.clear();
		this.binaries.clear();
		this.folders.clear();
	}
}

/**
 * 把 Obsidian Vault 适配成 WriteTarget。
 * 用结构化类型接收，避免内核在 Node/测试环境 import obsidian 包。
 */
export function createObsidianTarget(vault: ObsidianVaultLike): WriteTarget {
	const adapter = vault.adapter;

	return {
		async exists(path: string): Promise<boolean> {
			return adapter.exists(path);
		},

		async write(path: string, content: string): Promise<void> {
			// 已存在时 adapter.write 覆盖；不存在时 vault.create 会注册进 Obsidian 索引
			if (await adapter.exists(path)) await adapter.write(path, content);
			else await vault.create(path, content);
		},

		async writeBinary(path: string, data: Buffer): Promise<void> {
			// 转成独立 ArrayBuffer，避免写入底层 Buffer 的整个内存池
			const ab = data.buffer.slice(
				data.byteOffset,
				data.byteOffset + data.byteLength,
			) as ArrayBuffer;
			await adapter.writeBinary(path, ab);
		},

		async createFolder(path: string): Promise<void> {
			if (!(await adapter.exists(path))) await vault.createFolder(path);
		},

		async remove(path: string): Promise<void> {
			// 目录优先用 rmdir(recursive)，文件则用 remove
			const rmdir = (adapter as { rmdir?: (p: string, recursive: boolean) => Promise<void> }).rmdir;
			if (typeof rmdir === 'function') {
				try {
					await rmdir.call(adapter, path, true);
					return;
				} catch {
					// 不是目录，落到下面的 remove
				}
			}
			await adapter.remove(path);
		},
	};
}
