import { App, FileSystemAdapter, TAbstractFile, TFile } from 'obsidian';

export type FormatId =
	| 'basename'
	| 'filename'
	| 'relpath'
	| 'abspath'
	| 'fileurl'
	| 'wikilink'
	| 'mdlink'
	| 'uri';

export interface FormatContext {
	app: App;
	vaultName: string;
}

export interface FormatDef {
	id: FormatId;
	/** 菜单项与命令名里的显示名 */
	label: string;
	/** 设置面板里的说明 */
	hint: string;
	defaultEnabled: boolean;
	render: (ctx: FormatContext, file: TAbstractFile) => string;
}

/** 笔记名：md 文件去掉扩展名，文件夹用目录名 */
function displayName(file: TAbstractFile): string {
	return file instanceof TFile ? file.basename : file.name;
}

/** 双链目标：md 去掉扩展名，其他附件（图片、PDF 等）保留扩展名 */
function linkTarget(file: TAbstractFile): string {
	if (file instanceof TFile && file.extension === 'md') return file.basename;
	return file.name;
}

/**
 * 磁盘绝对路径。
 *
 * 桌面端的 adapter 是 FileSystemAdapter，能用官方的 getFullPath()；
 * 移动端不是，取不到磁盘路径时退回 vault 相对路径（而不是给出手拼的错误结果）。
 */
function absolutePath(app: App, path: string): string {
	const adapter = app.vault.adapter;
	if (adapter instanceof FileSystemAdapter) return adapter.getFullPath(path);
	return path;
}

/** 逐段编码，保留 / 分隔符，避免中文与空格在 file:// URL 里出问题。 */
function toFileUrl(absolute: string): string {
	return `file://${absolute.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * 格式注册表。**数组顺序 = 右键菜单与设置面板的显示顺序**，所以主力格式排前面。
 * 相对路径排第一：批量喂给 AI / 让子 agent 并行处理时最常用，也正好对应 vault 内定位文件的规则。
 */
export const FORMATS: FormatDef[] = [
	{
		id: 'relpath',
		label: '相对路径',
		hint: 'vault 内的相对路径',
		defaultEnabled: true,
		render: (_ctx, file) => file.path,
	},
	{
		id: 'basename',
		label: '笔记名',
		hint: '不含 .md 扩展名',
		defaultEnabled: true,
		render: (_ctx, file) => displayName(file),
	},
	{
		id: 'filename',
		label: '文件名',
		hint: '含扩展名',
		defaultEnabled: false,
		render: (_ctx, file) => file.name,
	},
	{
		id: 'abspath',
		label: '绝对路径',
		hint: '磁盘上的完整路径',
		defaultEnabled: true,
		render: (ctx, file) => absolutePath(ctx.app, file.path),
	},
	{
		id: 'fileurl',
		label: 'file:// 链接',
		hint: '可在浏览器/其他 app 里点击的本地文件 URL',
		defaultEnabled: false,
		render: (ctx, file) => toFileUrl(absolutePath(ctx.app, file.path)),
	},
	{
		id: 'wikilink',
		label: '双链',
		hint: '[[笔记名]]',
		defaultEnabled: false,
		render: (_ctx, file) => `[[${linkTarget(file)}]]`,
	},
	{
		id: 'mdlink',
		label: 'Markdown 链接',
		hint: '[笔记名](相对路径)',
		defaultEnabled: false,
		// 显示文本与双链保持一致：md 去掉扩展名，其他附件保留。
		render: (_ctx, file) => `[${linkTarget(file)}](${file.path})`,
	},
	{
		id: 'uri',
		label: 'Obsidian URI',
		hint: 'obsidian://open?vault=…&file=…',
		defaultEnabled: false,
		render: (ctx, file) =>
			`obsidian://open?vault=${encodeURIComponent(ctx.vaultName)}&file=${encodeURIComponent(file.path)}`,
	},
];

export const FORMAT_IDS: FormatId[] = FORMATS.map((format) => format.id);

export function getFormat(id: FormatId): FormatDef {
	const found = FORMATS.find((format) => format.id === id);
	if (!found) throw new Error(`[batch-copy-paths] 未知格式: ${id}`);
	return found;
}
