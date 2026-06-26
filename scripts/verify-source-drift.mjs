#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

function usage() {
	console.error(
		"Usage: verify-source-drift.mjs <manifest.json> [--write-integrity]",
	);
	process.exit(2);
}

const args = process.argv.slice(2);
const manifestPath = args.find((arg) => !arg.startsWith("--"));
const writeIntegrity = args.includes("--write-integrity");
if (!manifestPath) usage();

const repoRoot = process.cwd();
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const requireSource = process.env.COPY_RETROFIT_REQUIRE_SOURCE === "1";
const upstreamRoot = manifest.upstream?.repoPath
	? path.resolve(expandEnv(manifest.upstream.repoPath, { allowMissing: true }))
	: repoRoot;
const upstreamAvailable = await pathExists(upstreamRoot);
if (upstreamAvailable) {
	verifyUpstreamRevision(upstreamRoot, manifest.upstream?.revision);
} else if (requireSource) {
	throw new Error(`Upstream source is required but unavailable: ${upstreamRoot}`);
}
const allowed = new Set(
	(manifest.allowedLocalModifications ?? []).map((entry) => entry.path),
);

function expandEnv(value, options = {}) {
	return value.replace(/\$\{([A-Z0-9_]+)(?::-(.*?))?\}/gi, (_, name, fallback) => {
		const fromEnv = process.env[name];
		if (fromEnv && fromEnv.trim()) return fromEnv;
		if (fallback !== undefined) return fallback;
		if (options.allowMissing) return path.join(repoRoot, ".missing-env", name);
		throw new Error(`Environment variable ${name} is required by manifest`);
	});
}

async function pathExists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

function verifyUpstreamRevision(upstreamRoot, expectedRevision) {
	if (!expectedRevision) return;
	const actual = execFileSync("git", ["-C", upstreamRoot, "rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim();
	if (actual !== expectedRevision) {
		throw new Error(
			`Upstream revision mismatch: expected ${expectedRevision}, got ${actual}`,
		);
	}
}

function resolveSource(entry) {
	return path.isAbsolute(entry.source)
		? entry.source
		: path.resolve(upstreamRoot, entry.source);
}

function resolveDestination(entry) {
	return path.resolve(repoRoot, entry.destination);
}

function ignored(relative, patterns = []) {
	return patterns.some((pattern) => {
		const normalized = pattern.replaceAll("**/", "");
		return relative === normalized || relative.includes(normalized);
	});
}

async function listFiles(root, ignore = [], prefix = "") {
	const rootInfo = await stat(root);
	if (rootInfo.isFile()) return [""];
	const files = [];
	for (const name of await readdir(path.join(root, prefix))) {
		const relative = path.join(prefix, name);
		if (ignored(relative, ignore)) continue;
		const absolute = path.join(root, relative);
		const info = await stat(absolute);
		if (info.isDirectory()) {
			files.push(...(await listFiles(root, ignore, relative)));
		} else if (info.isFile()) {
			files.push(relative);
		}
	}
	return files.sort();
}

async function sha(file) {
	return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function hashRecords(root, files) {
	const records = [];
	for (const relative of files) {
		records.push({
			path: relative,
			sha256: await sha(relative ? path.join(root, relative) : root),
		});
	}
	return records;
}

const drift = [];
for (const entry of manifest.entries ?? []) {
	const source = resolveSource(entry);
	const destination = resolveDestination(entry);
	const destinationFiles = await listFiles(destination, entry.ignore ?? []);
	let sourceFiles = [];
	if (upstreamAvailable) {
		sourceFiles = await listFiles(source, entry.ignore ?? []);
		const all = new Set([...sourceFiles, ...destinationFiles]);
		for (const relative of [...all].sort()) {
			const manifestRelative = relative
				? path.join(entry.destination, relative)
				: entry.destination;
			if (allowed.has(manifestRelative)) continue;
			const sourceHas = sourceFiles.includes(relative);
			const destinationHas = destinationFiles.includes(relative);
			if (!sourceHas || !destinationHas) {
				drift.push(
					`${manifestRelative}: ${sourceHas ? "missing destination" : "extra destination"}`,
				);
				continue;
			}
			const [sourceHash, destinationHash] = await Promise.all([
				sha(relative ? path.join(source, relative) : source),
				sha(relative ? path.join(destination, relative) : destination),
			]);
			if (sourceHash !== destinationHash) {
				drift.push(`${manifestRelative}: content differs`);
			}
		}
	}

	if (!upstreamAvailable || writeIntegrity) {
		const integrityFiles = entry.integrity?.files ?? [];
		if (!writeIntegrity && integrityFiles.length === 0) {
			drift.push(
				`${entry.destination}: no integrity hashes and upstream unavailable`,
			);
			continue;
		}
		const expectedFiles = writeIntegrity ? destinationFiles : integrityFiles.map((item) => item.path);
		const expected = writeIntegrity
			? await hashRecords(destination, destinationFiles)
			: integrityFiles;
		const expectedByPath = new Map(
			expected.map((item) => [item.path, item.sha256]),
		);
		const all = new Set([...expectedFiles, ...destinationFiles]);
		for (const relative of [...all].sort()) {
			const manifestRelative = relative
				? path.join(entry.destination, relative)
				: entry.destination;
			if (allowed.has(manifestRelative)) continue;
			const destinationHas = destinationFiles.includes(relative);
			const expectedHash = expectedByPath.get(relative);
			if (!expectedHash || !destinationHas) {
				drift.push(
					`${manifestRelative}: ${expectedHash ? "missing destination" : "missing integrity hash"}`,
				);
				continue;
			}
			const destinationHash = await sha(
				relative ? path.join(destination, relative) : destination,
			);
			if (destinationHash !== expectedHash) {
				drift.push(`${manifestRelative}: integrity differs`);
			}
		}
		if (writeIntegrity) entry.integrity = { files: expected };
	}
}

if (drift.length) {
	console.error(`[copy-retrofit] drift detected (${drift.length})`);
	for (const item of drift) console.error(`- ${item}`);
	process.exit(1);
}

if (writeIntegrity) {
	await writeFile(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, "\t")}\n`);
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
}

const sourceNote = upstreamAvailable
	? "copied source matches manifest"
	: "copied source matches manifest integrity";
console.log(`[copy-retrofit] ${sourceNote}`);
