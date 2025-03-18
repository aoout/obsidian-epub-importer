#!/usr/bin/env ts-node

import { execSync } from "child_process";
import fs from "fs";

// 获取命令行参数
const args = process.argv.slice(2);
const releaseType = args[0] as "major" | "minor" | "patch";
const dryRun = args.includes("--dry-run");

if (!["major", "minor", "patch"].includes(releaseType)) {
	console.error("请指定版本更新类型：major | minor | patch");
	process.exit(1);
}

// 需要更新的文件路径
const packageJsonPath = "package.json";
const packageLockPath = "package-lock.json";
const manifestJsonPath = "manifest.json"; // 新增 manifest.json 处理

function readJson(filePath: string) {
	if (!fs.existsSync(filePath)) return null; // 文件不存在则返回 null
	const content = fs.readFileSync(filePath, "utf-8");
	return JSON.parse(content);
}

function writeJson(filePath: string, data: any) {
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

const pkg = readJson(packageJsonPath);
const lock = readJson(packageLockPath);
const manifest = readJson(manifestJsonPath);

// 获取当前版本号
const versionParts = pkg.version.split(".").map(Number);
if (releaseType === "major") versionParts[0]++, versionParts[1] = 0, versionParts[2] = 0;
if (releaseType === "minor") versionParts[1]++, versionParts[2] = 0;
if (releaseType === "patch") versionParts[2]++;
const newVersion = versionParts.join(".");

console.log(`即将把版本号从 ${pkg.version} 更新为 ${newVersion}`);

if (!dryRun) {
	// 更新 package.json 和 package-lock.json
	pkg.version = newVersion;
	writeJson(packageJsonPath, pkg);
	if (lock) {
		lock.version = newVersion;
		writeJson(packageLockPath, lock);
	}

	// 更新 manifest.json（如果存在）
	if (manifest && manifest.version) {
		manifest.version = newVersion;
		writeJson(manifestJsonPath, manifest);
	}

	// Git 提交 & 打标签
	execSync(`git add package.json ${lock ? "package-lock.json" : ""} ${manifest ? "manifest.json" : ""}`);
	execSync(`git commit -m "chore: bump version to ${newVersion}"`);
	execSync(`git tag ${newVersion}`);

	console.log(`✅ 版本更新成功，已创建 Git 标签 ${newVersion}`);
} else {
	console.log("🟡 预览模式：未实际修改文件");
}
