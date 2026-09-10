/**
 * CLI 参数解析。
 * 刻意手写而不用 commander：它只是 devDependency（打包进运行时产物不合适），
 * 且本 CLI 参数面很小，手写对老版本 esbuild 打包也更可控。
 */

export interface CliArgs {
	/** 子命令：import / help */
	command: string;
	/** 输入：.epub 文件或目录（目录会扫描其中所有 .epub） */
	inputs: string[];
	out: string;
	granularity: number;
	assets: string;
	savePath: string;
	/** 笔记模板文件路径 */
	template?: string;
	onExisting: 'abort' | 'overwrite' | 'merge';
	moc: boolean;
	copyAssets: boolean;
	verbose: boolean;
	dryRun: boolean;
	json: boolean;
	quiet: boolean;
}

export const USAGE = `Epub Importer — 命令行版（复用同一内核）

用法:
  epub-importer import <文件|目录> [选项]

选项:
  --out <dir>            输出根目录（默认 out）
  --granularity <n>      切分粒度，0=全书一篇（默认 1）
  --assets <name>        资源目录名，相对书籍目录（默认 assets）
  --save-path <p>        输出根目录下的额外保存路径
  --template <file>      笔记模板文件（内容作为 noteTemplate）
  --on-existing <mode>   目标已存在时：abort|overwrite|merge（默认 abort）
  --no-moc               不生成 MOC
  --no-assets            不落盘图片等资源
  --verbose              输出 debug 级诊断（解析/转换/写入摘要）
  --dry-run              只解析规划，不写磁盘
  --json                 以 JSON 输出结果，便于脚本化
  --quiet                不打印进度
  -h, --help             显示帮助

退出码:
  0 成功   1 出现 fatal（导入失败）   2 用法错误   130 被中断（Ctrl-C）

示例:
  epub-importer import book.epub --out ./out --granularity 3
  epub-importer import ./books --dry-run --verbose
  epub-importer import book.epub --json --out ./out
`;

export function defaultArgs(): CliArgs {
	return {
		command: '',
		inputs: [],
		out: 'out',
		granularity: 1,
		assets: 'assets',
		savePath: '',
		onExisting: 'abort',
		moc: true,
		copyAssets: true,
		verbose: false,
		dryRun: false,
		json: false,
		quiet: false,
	};
}

/** 抛出 Error 时由调用方按「用法错误(退出码 2)」处理 */
export function parseArgs(argv: string[]): CliArgs {
	const args = defaultArgs();
	let i = 0;

	while (i < argv.length) {
		const a = argv[i];

		if (a === '-h' || a === '--help') {
			args.command = 'help';
			return args;
		}

		// 位置参数：第一个是子命令，其余是输入
		if (!a.startsWith('-')) {
			if (!args.command) args.command = a;
			else args.inputs.push(a);
			i++;
			continue;
		}

		// 支持 --opt=value 与 --opt value 两种写法
		const eq = a.indexOf('=');
		const name = eq > 0 ? a.slice(0, eq) : a;
		const take = (): string => {
			if (eq > 0) return a.slice(eq + 1);
			const v = argv[i + 1];
			if (v === undefined || v.startsWith('-')) throw new Error(`选项 ${name} 缺少取值`);
			i++;
			return v;
		};

		switch (name) {
			case '--out': args.out = take(); break;
			case '--granularity': {
				const n = Number(take());
				if (!Number.isFinite(n) || n < 0) throw new Error(`--granularity 必须是非负数字：${a}`);
				args.granularity = Math.floor(n);
				break;
			}
			case '--assets': args.assets = take(); break;
			case '--save-path': args.savePath = take(); break;
			case '--template': args.template = take(); break;
			case '--on-existing': {
				const v = take();
				if (v !== 'abort' && v !== 'overwrite' && v !== 'merge') {
					throw new Error(`--on-existing 只能是 abort|overwrite|merge：${v}`);
				}
				args.onExisting = v;
				break;
			}
			case '--no-moc': args.moc = false; break;
			case '--no-assets': args.copyAssets = false; break;
			case '--verbose': args.verbose = true; break;
			case '--dry-run': args.dryRun = true; break;
			case '--json': args.json = true; break;
			case '--quiet': args.quiet = true; break;
			default:
				throw new Error(`未知选项：${name}`);
		}
		i++;
	}

	if (args.command === 'help') return args;
	if (!args.command) throw new Error('缺少子命令（用 -h 查看帮助）');
	if (args.command !== 'import') throw new Error(`未知子命令：${args.command}`);
	if (args.inputs.length === 0) throw new Error('缺少输入文件或目录');

	return args;
}
