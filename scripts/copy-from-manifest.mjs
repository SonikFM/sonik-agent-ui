#!/usr/bin/env node
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

function usage() {
	console.error("Usage: copy-from-manifest.mjs <manifest.json>");
	process.exit(2);
}

const manifestPath = process.argv[2];
if (!manifestPath) usage();

const repoRoot = process.cwd();
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const upstreamRoot = manifest.upstream?.repoPath
	? path.resolve(expandEnv(manifest.upstream.repoPath))
	: repoRoot;


function expandEnv(value) {
	return value.replace(/\$\{([A-Z0-9_]+)(?::-(.*?))?\}/gi, (_, name, fallback) => {
		const fromEnv = process.env[name];
		if (fromEnv && fromEnv.trim()) return fromEnv;
		if (fallback !== undefined) return fallback;
		throw new Error(`Environment variable ${name} is required by manifest`);
	});
}

function resolveSource(entry) {
	return path.isAbsolute(entry.source)
		? entry.source
		: path.resolve(upstreamRoot, entry.source);
}

function resolveDestination(entry) {
	if (path.isAbsolute(entry.destination)) {
		throw new Error(`destination must be repo-relative: ${entry.destination}`);
	}
	const destination = path.resolve(repoRoot, entry.destination);
	if (!destination.startsWith(repoRoot + path.sep)) {
		throw new Error(`destination escapes repo: ${entry.destination}`);
	}
	return destination;
}

for (const entry of manifest.entries ?? []) {
	const source = resolveSource(entry);
	const destination = resolveDestination(entry);
	await stat(source);
	await mkdir(path.dirname(destination), { recursive: true });
	await rm(destination, { recursive: true, force: true });
	await cp(source, destination, {
		recursive: true,
		filter: (candidate) => {
			const relative = path.relative(source, candidate);
			return !(entry.ignore ?? []).some((pattern) => {
				const normalized = pattern.replaceAll("**/", "");
				return relative === normalized || relative.includes(normalized);
			});
		},
	});
	console.log(`[copy-retrofit] copied ${source} -> ${entry.destination}`);
}
