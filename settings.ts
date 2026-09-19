import { App, PluginSettingTab, Setting } from 'obsidian';
import { FORMATS, FORMAT_IDS, type FormatId } from './formats';
import type BatchCopyPlugin from './main';

export type MenuMode = 'flat' | 'submenu';
export type SeparatorPreset = 'newline' | 'dunhao' | 'comma' | 'space' | 'custom';
export type SortBy = 'selection' | 'name' | 'path';

export interface BatchCopySettings {
	/** flat = 直接平铺在主菜单；submenu = 收进「批量复制」子菜单 */
	menuMode: MenuMode;
	/** 出现在菜单里的格式（命令面板不受此限制，总是全部可用） */
	enabledFormats: FormatId[];
	separatorPreset: SeparatorPreset;
	separatorCustom: string;
	sortBy: SortBy;
	/** 统一成 NFC，规避 macOS 中文路径的 NFD 编码差异 */
	normalizeNFC: boolean;
	/** 多项时在菜单标题里显示数量 */
	showCount: boolean;
	/** 复制成功后弹提示 */
	notify: boolean;
	/** 跳过文件夹，只处理文件 */
	skipFolders: boolean;
}

export const DEFAULT_SETTINGS: BatchCopySettings = {
	// 默认平铺：格式少时更直观，也避开了未公开的子菜单 API
	menuMode: 'flat',
	enabledFormats: FORMATS.filter((format) => format.defaultEnabled).map((format) => format.id),
	separatorPreset: 'newline',
	separatorCustom: '',
	sortBy: 'selection',
	normalizeNFC: true,
	showCount: true,
	notify: true,
	// 默认只复制文件：混选里出现文件夹时静默跳过，避免粘贴结果里混进目录路径
	skipFolders: true,
};

export function resolveSeparator(settings: BatchCopySettings): string {
	switch (settings.separatorPreset) {
		case 'newline':
			return '\n';
		case 'dunhao':
			return '、';
		case 'comma':
			return ', ';
		case 'space':
			return ' ';
		case 'custom':
			return settings.separatorCustom;
	}
}

/** 从磁盘数据合并出合法设置：过滤掉已不存在的格式 id，防止旧配置残留。 */
export function normalizeSettings(raw: unknown): BatchCopySettings {
	const merged = Object.assign({}, DEFAULT_SETTINGS, (raw ?? {}) as Partial<BatchCopySettings>);
	const enabled = Array.isArray(merged.enabledFormats) ? merged.enabledFormats : [];
	merged.enabledFormats = FORMAT_IDS.filter((id) => enabled.includes(id));
	return merged;
}

export class BatchCopySettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: BatchCopyPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('菜单形态').setHeading();

		new Setting(containerEl)
			.setName('菜单展示方式')
			.setDesc('格式较多时建议收进子菜单，避免右键菜单过长。')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('flat', '平铺（每项一个菜单条目）')
					.addOption('submenu', '收进「批量复制」子菜单')
					.setValue(this.plugin.settings.menuMode)
					.onChange(async (value) => {
						this.plugin.settings.menuMode = value as MenuMode;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('显示数量')
			.setDesc('多选时在菜单标题后显示「（N 项）」。')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showCount).onChange(async (value) => {
					this.plugin.settings.showCount = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName('显示的格式').setHeading();

		for (const format of FORMATS) {
			new Setting(containerEl)
				.setName(format.label)
				.setDesc(format.hint)
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.enabledFormats.includes(format.id)).onChange(async (value) => {
						const enabled = new Set(this.plugin.settings.enabledFormats);
						if (value) enabled.add(format.id);
						else enabled.delete(format.id);
						this.plugin.settings.enabledFormats = FORMAT_IDS.filter((id) => enabled.has(id));
						await this.plugin.saveSettings();
					}),
				);
		}

		new Setting(containerEl).setName('输出').setHeading();

		const customSeparatorRow: { setting: Setting | null } = { setting: null };

		new Setting(containerEl)
			.setName('分隔符')
			.setDesc('多项之间的连接符。')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('newline', '换行（每项一行）')
					.addOption('dunhao', '顿号（、）')
					.addOption('comma', '逗号加空格（, ）')
					.addOption('space', '空格')
					.addOption('custom', '自定义')
					.setValue(this.plugin.settings.separatorPreset)
					.onChange(async (value) => {
						this.plugin.settings.separatorPreset = value as SeparatorPreset;
						await this.plugin.saveSettings();
						customSeparatorRow.setting?.settingEl.toggle(value === 'custom');
					}),
			);

		customSeparatorRow.setting = new Setting(containerEl)
			.setName('自定义分隔符')
			.setDesc('支持 \\n \\t 转义。')
			.addText((text) =>
				text.setValue(this.plugin.settings.separatorCustom).onChange(async (value) => {
					this.plugin.settings.separatorCustom = value.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
					await this.plugin.saveSettings();
				}),
			);
		customSeparatorRow.setting.settingEl.toggle(this.plugin.settings.separatorPreset === 'custom');

		new Setting(containerEl)
			.setName('排序')
			.setDesc('「按选中顺序」保持文件列表给出的顺序。')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('selection', '按选中顺序')
					.addOption('name', '按名称')
					.addOption('path', '按路径')
					.setValue(this.plugin.settings.sortBy)
					.onChange(async (value) => {
						this.plugin.settings.sortBy = value as SortBy;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('跳过文件夹')
			.setDesc('多选里混有文件夹时，忽略文件夹只复制文件。单独右键文件夹本来就不会出现这些选项。')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.skipFolders).onChange(async (value) => {
					this.plugin.settings.skipFolders = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('路径 NFC 规范化')
			.setDesc('规避 macOS 中文文件名的 NFD 编码差异，一般保持开启。')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.normalizeNFC).onChange(async (value) => {
					this.plugin.settings.normalizeNFC = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('复制后提示')
			.setDesc('在右上角弹出「已复制 N 项」。')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.notify).onChange(async (value) => {
					this.plugin.settings.notify = value;
					await this.plugin.saveSettings();
				}),
			);
	}
}
