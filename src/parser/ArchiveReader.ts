/**
 * ArchiveReader：把 zip 解压 + 编码嗅探封装成 FileProvider。
 *
 * 来源：
 * - FileProvider 接口（parser 不直接碰 zip，可注入/可单测）：booqs-epub
 * - jszip 解压（替换 @gxl 的 node-zip 死库）
 * - MIME 入口校验（application/epub+zip）：julien-c/epub 的 _checkMimeType
 * - 编码嗅探（iconv-lite + BOM + XML prolog）：本仓库差异化点
 */

import JSZip from 'jszip';
import type { Diags, FileProvider } from './types';
import { pushDiag } from './types';
import { decodeBuffer, detectDeclaredCharset } from './xml';

export type ArchiveInput = Buffer | ArrayBuffer | Uint8Array | string;

export class ZipArchiveReader implements FileProvider {
	private zip!: JSZip;
	private files: Record<string, JSZip.JSZipObject>;

	constructor(private input: ArchiveInput) {
		this.files = {};
	}

	async open(): Promise<void> {
		let buf: Buffer;
		if (typeof this.input === 'string') {
			const fs = await import('fs/promises');
			buf = await fs.readFile(this.input);
		} else if (this.input instanceof ArrayBuffer) {
			buf = Buffer.from(this.input);
		} else {
			buf = Buffer.from(this.input as Uint8Array);
		}
		this.zip = await JSZip.loadAsync(buf);
		this.files = this.zip.files;
	}

	has(path: string): boolean {
		return !!this.files[path] || !!this.files[path.toLowerCase()];
	}

	private lookup(path: string): JSZip.JSZipObject | undefined {
		return this.files[path] ?? this.files[path.toLowerCase()];
	}

	/** 读取原始二进制（不解码） */
	async readRaw(path: string): Promise<Buffer | undefined> {
		const file = this.lookup(path);
		if (!file) return undefined;
		return file.async('nodebuffer');
	}

	async readBinary(path: string, diags?: Diags): Promise<Buffer | undefined> {
		if (!this.has(path)) {
			pushDiag(diags ?? [], 'warning', `找不到归档条目：${path}`, { code: 'entry-not-found', data: path });
			return undefined;
		}
		return this.readRaw(path);
	}

	async readText(path: string, diags?: Diags): Promise<string | undefined> {
		const raw = await this.readRaw(path);
		if (raw === undefined) {
			pushDiag(diags ?? [], 'warning', `找不到归档条目：${path}`, { code: 'entry-not-found', data: path });
			return undefined;
		}
		const head = raw.slice(0, 200).toString('latin1');
		const declared = detectDeclaredCharset(head);
		const { text, charset, transcoded } = decodeBuffer(raw, declared);
		if (transcoded) {
			pushDiag(diags ?? [], 'info', `文件 ${path} 为非 UTF-8 编码（${charset}），已自动转码`, {
				code: 'non-utf8-transcoded',
				data: { path, charset },
			});
		}
		return text;
	}

	/** 校验 mimetype 入口是否为合法 EPUB（julien-c 的 _checkMimeType） */
	async validateMime(diags?: Diags): Promise<boolean> {
		const file = this.lookup('mimetype');
		if (!file) {
			pushDiag(diags ?? [], 'fatal', '归档缺少 mimetype 入口，不是合法 EPUB', { code: 'no-mimetype' });
			return false;
		}
		const txt = (await file.async('string')).trim().toLowerCase();
		if (txt !== 'application/epub+zip') {
			pushDiag(diags ?? [], 'fatal', `mimetype 不是 application/epub+zip（实际：${txt}）`, {
				code: 'bad-mimetype',
				data: txt,
			});
			return false;
		}
		return true;
	}

	/** 检测 DRM（META-INF/encryption.xml 存在） */
	hasDrm(): boolean {
		return this.has('META-INF/encryption.xml');
	}
}
