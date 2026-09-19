import esbuild from 'esbuild';
import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/**
 * `npm run build` only produces main.js in the repository root, which is all the
 * community directory scanner needs.
 *
 * To also install into a vault for local testing, set VAULT:
 *   VAULT="/path/to/vault" npm run deploy
 */
const VAULT = process.env.VAULT;
const PLUGIN_ID = 'batch-copy-paths';
const PLUGIN_DIR = VAULT ? path.join(VAULT, '.obsidian', 'plugins', PLUGIN_ID) : null;

const watch = process.argv.includes('--watch');
const deploy = process.argv.includes('--deploy') || watch;

/** Only main.js and manifest.json are needed at runtime by Obsidian. */
const ASSETS = ['main.js', 'manifest.json', ...((await exists('styles.css')) ? ['styles.css'] : [])];

async function exists(file) {
	try {
		await access(file);
		return true;
	} catch {
		return false;
	}
}

async function deployToVault() {
	if (!PLUGIN_DIR) {
		throw new Error(
			'No VAULT set. Pass one to deploy, e.g.\n' +
				'  VAULT="/path/to/vault" npm run deploy',
		);
	}
	await mkdir(PLUGIN_DIR, { recursive: true });
	for (const asset of ASSETS) {
		await copyFile(asset, path.join(PLUGIN_DIR, asset));
	}
	console.log(`[deploy] ${ASSETS.join(', ')} → ${PLUGIN_DIR}`);
}

const options = {
	entryPoints: ['main.ts'],
	outfile: 'main.js',
	bundle: true,
	format: 'cjs',
	platform: 'browser',
	target: 'es2018',
	logLevel: 'info',
	// Provided by the host at runtime; neither can be bundled.
	external: ['obsidian', 'electron'],
};

if (watch) {
	const context = await esbuild.context({
		...options,
		plugins: [{ name: 'deploy-on-rebuild', setup: (build) => build.onEnd(deployToVault) }],
	});
	await context.watch();
	await deployToVault();
	console.log('[watch] watching… rebuilds deploy automatically');
} else {
	await esbuild.build(options);
	if (deploy) await deployToVault();
}
