/**
 * CLI 单测：文件系统 target、参数解析、输入收集。
 * 端到端导入由 src/test/realworld.test.ts 覆盖（同一内核，无需重复）。
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFilesystemTarget, normalizeWinPath } from '../fsTarget';
import { parseArgs, defaultArgs } from '../args';
import { collectEpubs, main, createCancelController } from '../cli';

let tmpRoot: string;

beforeEach(async () => {
	tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'epub-cli-'));
});

afterEach(async () => {
	await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('normalizeWinPath', () => {
	it('把 Git Bash 风格的 /d/foo 还原成 D:/foo', () => {
		expect(normalizeWinPath('/d/aoout/x.epub')).toBe('D:/aoout/x.epub');
		expect(normalizeWinPath('/E/books/a.epub')).toBe('E:/books/a.epub');
	});

	it('其它路径原样返回', () => {
		expect(normalizeWinPath('D:/a/b.epub')).toBe('D:/a/b.epub');
		expect(normalizeWinPath('src/test/epubs')).toBe('src/test/epubs');
		expect(normalizeWinPath('')).toBe('');
	});
});

describe('createFilesystemTarget', () => {
	it('写文本与二进制，并真实落盘', async () => {
		const target = createFilesystemTarget(tmpRoot);
		await target.write('书/第一章.md', '# 第一章');
		await target.writeBinary('书/assets/a.png', Buffer.from([1, 2, 3]));

		expect(await target.exists('书/第一章.md')).toBe(true);
		expect(await fs.readFile(path.join(tmpRoot, '书/第一章.md'), 'utf8')).toBe('# 第一章');
		expect((await fs.readFile(path.join(tmpRoot, '书/assets/a.png')))[0]).toBe(1);
	});

	it('createFolder 递归建目录，remove 删目录', async () => {
		const target = createFilesystemTarget(tmpRoot);
		await target.createFolder('a/b/c');
		expect(await target.exists('a/b/c')).toBe(true);

		await target.remove('a');
		expect(await target.exists('a')).toBe(false);
	});

	it('不存在的路径 exists 返回 false', async () => {
		const target = createFilesystemTarget(tmpRoot);
		expect(await target.exists('nope.md')).toBe(false);
	});

	it('拒绝越出输出根目录的路径（防 ../ 逃逸）', async () => {
		const target = createFilesystemTarget(tmpRoot);
		await expect(target.write('../escape.md', 'x')).rejects.toThrow(/越出输出根目录/);
	});
});

describe('parseArgs', () => {
	it('默认值', () => {
		const a = parseArgs(['import', 'book.epub']);
		expect(a.command).toBe('import');
		expect(a.inputs).toEqual(['book.epub']);
		expect(a.out).toBe('out');
		expect(a.granularity).toBe(1);
		expect(a.assets).toBe('assets');
		expect(a.onExisting).toBe('abort');
		expect(a.moc).toBe(true);
		expect(a.copyAssets).toBe(true);
	});

	it('解析常用选项（--opt value）', () => {
		const a = parseArgs([
			'import', 'book.epub', '--out', './o', '--granularity', '3',
			'--assets', 'img', '--on-existing', 'merge', '--verbose',
		]);
		expect(a.out).toBe('./o');
		expect(a.granularity).toBe(3);
		expect(a.assets).toBe('img');
		expect(a.onExisting).toBe('merge');
		expect(a.verbose).toBe(true);
	});

	it('支持 --opt=value 写法', () => {
		const a = parseArgs(['import', 'b.epub', '--out=./x', '--granularity=0']);
		expect(a.out).toBe('./x');
		expect(a.granularity).toBe(0);
	});

	it('--no-moc / --no-assets 反转布尔开关', () => {
		const a = parseArgs(['import', 'b.epub', '--no-moc', '--no-assets']);
		expect(a.moc).toBe(false);
		expect(a.copyAssets).toBe(false);
	});

	it('help 子命令与 -h', () => {
		expect(parseArgs(['--help']).command).toBe('help');
		expect(parseArgs(['-h']).command).toBe('help');
	});

	it('错误：未知选项 / 缺子命令 / 缺输入 / 非法取值', () => {
		expect(() => parseArgs(['import', 'b.epub', '--bogus'])).toThrow(/未知选项/);
		expect(() => parseArgs([])).toThrow(/缺少子命令/);
		expect(() => parseArgs(['import'])).toThrow(/缺少输入/);
		expect(() => parseArgs(['frobnicate', 'x'])).toThrow(/未知子命令/);
		expect(() => parseArgs(['import', 'b.epub', '--on-existing', 'nope'])).toThrow(/--on-existing/);
		expect(() => parseArgs(['import', 'b.epub', '--granularity', 'abc'])).toThrow(/--granularity/);
		expect(() => parseArgs(['import', 'b.epub', '--out'])).toThrow(/缺少取值/);
	});

	it('默认参数对象可独立获取（便于调用方定制）', () => {
		expect(defaultArgs().granularity).toBe(1);
	});
});

describe('collectEpubs', () => {
	it('目录只收 .epub（大小写不敏感），文件直接收', async () => {
		await fs.writeFile(path.join(tmpRoot, 'a.epub'), '');
		await fs.writeFile(path.join(tmpRoot, 'B.EPUB'), '');
		await fs.writeFile(path.join(tmpRoot, 'note.txt'), '');

		const got = await collectEpubs([tmpRoot]);
		expect(got).toHaveLength(2);
		expect(got.some((p) => p.endsWith('a.epub'))).toBe(true);
		expect(got.some((p) => p.endsWith('B.EPUB'))).toBe(true);
	});

	it('不存在的输入抛错', async () => {
		await expect(collectEpubs([path.join(tmpRoot, 'missing.epub')])).rejects.toThrow(/输入不存在/);
	});
});

describe('createCancelController', () => {
	it('trigger 前未取消，trigger 后 isCancelled 为 true', () => {
		const c = createCancelController();
		expect(c.isCancelled()).toBe(false);
		c.trigger();
		expect(c.isCancelled()).toBe(true);
	});

	it('可重复 trigger（幂等，供二次 Ctrl-C 判定）', () => {
		const c = createCancelController();
		c.trigger();
		c.trigger();
		expect(c.isCancelled()).toBe(true);
	});
});

describe('main 退出码', () => {
	it('help 返回 0，用法错误返回 2', async () => {
		const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
		const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			expect(await main(['--help'])).toBe(0);
			expect(await main([])).toBe(2);
			expect(await main(['import', 'x.epub', '--nope'])).toBe(2);
		} finally {
			logSpy.mockRestore();
			errSpy.mockRestore();
		}
	});
});
