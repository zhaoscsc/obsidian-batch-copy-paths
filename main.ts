import { App, Menu, MenuItem, Notice, Plugin, TAbstractFile, TFile, View } from 'obsidian';
import { FORMATS, type FormatContext, type FormatDef } from './formats';
import {
	BatchCopySettingTab,
	DEFAULT_SETTINGS,
	normalizeSettings,
	resolveSeparator,
	type BatchCopySettings,
} from './settings';

/** electron 模块在 Obsidian 桌面端通过 CommonJS require 取得。 */
declare function require(module: string): unknown;

/** 文件列表右键菜单的 source 标记（Obsidian 内部约定值）。 */
const EXPLORER_SOURCE = 'file-explorer-context-menu';
const SUBMENU_ICON = 'lucide-clipboard-copy';

/* ---------------------------------------------------------------------------
 * 未公开 API 的类型声明。
 *
 * Obsidian 的 obsidian.d.ts 没有描述下列内部结构，这里只声明真正用到的部分，
 * 并用窄类型代替 any —— 否则 any 会顺着调用链扩散，导致下游每次访问都变成
 * “unsafe member access”。未公开的东西集中收敛在这一个区域里。
 * ------------------------------------------------------------------------- */

/** 文件列表条目（内部 FileExplorerItem 的最小可用子集） */
interface ExplorerItem {
	file?: TAbstractFile;
}

/** 文件列表的树（内部 FileExplorerTree 的最小可用子集） */
interface ExplorerTree {
	selectedDoms?: Set<ExplorerItem>;
}

/**
 * 文件列表视图。继承公开的 View，既能直接承接 getLeavesOfType() 的返回值，
 * 又避开了 TS 的弱类型检查（纯可选字段的接口与 View 无共同属性会报 TS2559）。
 */
interface ExplorerView extends View {
	tree?: ExplorerTree;
}

/** 菜单项的内部能力：setSubmenu（自定义子菜单）、dom（失败时清掉死条目） */
interface SubmenuCapableMenuItem extends MenuItem {
	setSubmenu?: () => Menu;
	dom?: HTMLElement;
}

interface ElectronClipboard {
	writeText(data: string): void;
}

interface ElectronModule {
	clipboard?: ElectronClipboard;
}

/** 取 Electron 剪贴板；非桌面环境或 require 不可用时返回 undefined。 */
function getElectronClipboard(): ElectronClipboard | undefined {
	try {
		return (require('electron') as ElectronModule | null)?.clipboard;
	} catch {
		return undefined;
	}
}

/** 把 unknown 的 catch 值转成可读文本，避免未知值直接流进日志。 */
function describeError(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** 取文件列表视图，收敛成上面声明的窄类型。 */
function getExplorerView(app: App): ExplorerView | undefined {
	const view = app.workspace.getLeavesOfType('file-explorer')[0]?.view;
	if (!view || typeof view !== 'object') return undefined;
	// ExplorerView 的字段全是可选的，object 本来就满足它，无需断言。
	return view;
}

export default class BatchCopyPlugin extends Plugin {
	settings: BatchCopySettings = { ...DEFAULT_SETTINGS };

	private vaultName = '';

	/** null = 尚未探测。子菜单是未公开 API，先探测再决定菜单结构。 */
	private submenuSupported: boolean | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.vaultName = this.app.vault.getName();

		// ① 主路径：文件列表多选后右键。Obsidian >= 1.4.10 触发 files-menu，
		//    回调里直接带着完整选中集，最可靠。
		this.registerEvent(
			this.app.workspace.on('files-menu', (menu, files, source) => {
				if (!this.isFileExplorer(source)) return;
				if (!files || files.length < 2) return;
				this.buildMenu(menu, files);
			}),
		);

		// ② 兜底：单选右键，以及「右键的那个文件不在选中集内」时 Obsidian 退回的 file-menu。
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file, source) => {
				if (!this.isFileExplorer(source)) return;
				if (!file) return;
				const selection = this.getExplorerSelection();
				const clickedInsideSelection = selection.some((item) => item.path === file.path);
				const files =
					selection.length > 1 && clickedInsideSelection ? selection : [file];
				this.buildMenu(menu, files);
			}),
		);

		this.addSettingTab(new BatchCopySettingTab(this.app, this));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async loadSettings(): Promise<void> {
		// loadData() 的类型是 any；显式收成 unknown 再交给 normalizeSettings。
		this.settings = normalizeSettings((await this.loadData()) as unknown);
	}

	/**
	 * source 缺失时不做拦截：宁可多显示一个菜单项，也不要因为版本差异让菜单整体消失。
	 */
	private isFileExplorer(source: string | undefined): boolean {
		return !source || source === EXPLORER_SOURCE;
	}

	/**
	 * 读取文件列表当前选中集。
	 *
	 * 优先用内部 tree.selectedDoms：它是权威源，包含滚出视口、不在 DOM 里的行
	 * （本库 4 万文件，文件列表有虚拟滚动，DOM 查询可能漏行）。
	 * 该 API 未公开在 obsidian.d.ts 中，所以整体包 try/catch 并保留 DOM 兜底。
	 */
	private getExplorerSelection(): TAbstractFile[] {
		try {
			const view = getExplorerView(this.app);
			const doms = view?.tree?.selectedDoms;
			if (doms && doms.size > 0) {
				const files = Array.from(doms)
					.map((dom) => dom.file)
					.filter((file): file is TAbstractFile => !!file);
				if (files.length > 0) return files;
			}
		} catch (error: unknown) {
			console.warn(
				'[batch-copy-paths] 读取 tree.selectedDoms 失败，回退 DOM 查询',
				describeError(error),
			);
		}

		// DOM 兜底：只扫已渲染的行，成本与视口大小相关，与库大小无关。
		const files: TAbstractFile[] = [];
		document
			.querySelectorAll('.nav-file-title.is-selected, .nav-folder-title.is-selected')
			.forEach((el) => {
				const path = el.getAttribute('data-path');
				const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
				if (file) files.push(file);
			});
		return files;
	}

	/** 应用「跳过文件夹」与排序设置。 */
	private prepare(files: TAbstractFile[]): TAbstractFile[] {
		let out = files;
		if (this.settings.skipFolders) out = out.filter((file) => file instanceof TFile);
		if (this.settings.sortBy === 'name') {
			out = [...out].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
		} else if (this.settings.sortBy === 'path') {
			out = [...out].sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'));
		}
		return out;
	}

	private activeFormats(): FormatDef[] {
		const enabled = this.settings.enabledFormats;
		return FORMATS.filter((format) => enabled.includes(format.id));
	}

	private itemTitle(label: string, count: number): string {
		return this.settings.showCount && count > 1 ? `${label}（${count} 项）` : label;
	}

	private buildMenu(menu: Menu, rawFiles: TAbstractFile[]): void {
		// 只认文件：文件夹不挂这些选项。
		// 单选文件夹、或整个选中集都是文件夹时，直接不出菜单。
		if (!rawFiles.some((file) => file instanceof TFile)) return;

		const files = this.prepare(rawFiles);
		const formats = this.activeFormats();
		if (files.length === 0 || formats.length === 0) return;

		menu.addSeparator();

		if (this.settings.menuMode === 'submenu' && this.detectSubmenuSupport()) {
			const submenu = this.addSubmenu(menu, this.itemTitle('批量复制', files.length));
			if (submenu) {
				for (const format of formats) this.addCopyItem(submenu, format, files);
				return;
			}
			// 子菜单建不起来：退回平铺，不能留下点不动的死条目。
			this.submenuSupported = false;
		}

		for (const format of formats) this.addCopyItem(menu, format, files);
	}

	/**
	 * 挂一个「批量复制」父条目并返回其子菜单。
	 *
	 * setSubmenu 是未公开 API，失败时把父条目的 DOM 摘掉再返回 null，
	 * 由调用方退回平铺菜单。
	 */
	private addSubmenu(menu: Menu, title: string): Menu | null {
		const holder: { item?: SubmenuCapableMenuItem } = {};
		menu.addItem((menuItem) => {
			// SubmenuCapableMenuItem 的额外字段都是可选的，MenuItem 本来就能赋给它。
			holder.item = menuItem;
			menuItem.setSection('info.copy').setTitle(title).setIcon(SUBMENU_ICON);
		});

		// addItem 的回调是同步执行的；这里读一次局部变量，绕开 TS 对闭包赋值的窄化。
		const parent: SubmenuCapableMenuItem | undefined = holder.item;
		const setSubmenu = parent?.setSubmenu;
		if (!parent || typeof setSubmenu !== 'function') return null;

		try {
			return setSubmenu.call(parent);
		} catch (error: unknown) {
			console.warn('[batch-copy-paths] 创建子菜单失败，退回平铺菜单', describeError(error));
			try {
				parent.dom?.remove?.();
			} catch {
				// 清理失败不影响平铺菜单可用
			}
			return null;
		}
	}

	private addCopyItem(container: Menu, format: FormatDef, files: TAbstractFile[]): void {
		container.addItem((item) => {
			item
				// info.copy 是文件列表原生菜单里预留的空槽位，放这里能和系统项排在一起。
				.setSection('info.copy')
				.setTitle(this.itemTitle(format.label, files.length))
				.setIcon(SUBMENU_ICON)
				.onClick(() => this.copy(files, format));
		});
	}

	/**
	 * 用一个丢弃掉的 Menu 探测 setSubmenu 是否存在，避免在真实菜单上留下坏条目。
	 */
	private detectSubmenuSupport(): boolean {
		if (this.submenuSupported !== null) return this.submenuSupported;
		try {
			const probe = new Menu();
			const holder: { item?: SubmenuCapableMenuItem } = {};
			probe.addItem((item) => {
				holder.item = item;
			});
			const probeItem: SubmenuCapableMenuItem | undefined = holder.item;
			this.submenuSupported = typeof probeItem?.setSubmenu === 'function';
		} catch (error: unknown) {
			console.warn('[batch-copy-paths] 子菜单能力探测失败', describeError(error));
			this.submenuSupported = false;
		}
		return this.submenuSupported;
	}

	private copy(files: TAbstractFile[], format: FormatDef): void {
		const ctx: FormatContext = { app: this.app, vaultName: this.vaultName };
		const separator = resolveSeparator(this.settings);

		const lines = files
			.map((file) => format.render(ctx, file))
			.filter((value) => value.length > 0)
			// macOS 中文路径可能是 NFD，统一成 NFC 再进剪贴板，避免粘出去看着一样却不相等。
			.map((value) => (this.settings.normalizeNFC ? value.normalize('NFC') : value));

		if (lines.length === 0) {
			new Notice('没有可复制的内容');
			return;
		}

		void this.writeClipboard(lines.join(separator)).then(
			() => {
				if (this.settings.notify) new Notice(`已复制${format.label}：${lines.length} 项`, 2000);
			},
			(error) => {
				console.error('[batch-copy-paths] 写入剪贴板失败', error);
				new Notice('复制失败，详见控制台');
			},
		);
	}

	private async writeClipboard(text: string): Promise<void> {
		const clipboard = getElectronClipboard();
		if (clipboard) {
			// Electron 剪贴板：不受窗口焦点影响，比 navigator.clipboard 稳。
			clipboard.writeText(text);
			return;
		}
		await navigator.clipboard.writeText(text);
	}
}
