import {
	App,
	PluginSettingTab,
	Setting,
	type SettingDefinitionControl,
	type SettingDefinitionItem,
} from 'obsidian';
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

/* ---------------------------------------------------------------------------
 * 设置行描述：两条渲染路径的唯一数据源。
 *
 * - Obsidian < 1.13.0：走 display()，用经典的 Setting API 渲染。
 * - Obsidian >= 1.13.0：走 getSettingDefinitions()，Obsidian 负责渲染、
 *   搜索索引与持久化，display() 会被跳过。
 *
 * 两条路都从下面这份描述生成，避免出现「设置面板改了一处、设置搜索里还是旧的」
 * 这种漂移。
 * ------------------------------------------------------------------------- */

/** 直接映射到 settings 字段的键 */
type PlainKey =
	| 'menuMode'
	| 'showCount'
	| 'separatorPreset'
	| 'separatorCustom'
	| 'sortBy'
	| 'skipFolders'
	| 'normalizeNFC'
	| 'notify';

/**
 * 格式开关是虚拟键：注册表里的格式是个数组，无法直接绑到数组元素上，
 * 因此用 `format.<id>` 作键，由下面的 readValue/writeValue 映射进 enabledFormats。
 */
type FormatKey = `format.${FormatId}`;
type SettingsKey = PlainKey | FormatKey;

const FORMAT_KEY_PREFIX = 'format.';

interface RowBase {
	name: string;
	desc?: string;
}

type SettingRow =
	| ({ kind: 'toggle'; key: SettingsKey } & RowBase)
	| ({ kind: 'dropdown'; key: SettingsKey; options: Record<string, string> } & RowBase)
	| ({
			kind: 'text';
			key: SettingsKey;
			placeholder?: string;
			/** 仅在满足条件时显示该行（两条路径都会用到） */
			visibleWhen?: () => boolean;
	  } & RowBase);

interface SettingGroup {
	heading: string;
	rows: SettingRow[];
}

const MENU_MODE_OPTIONS: Record<string, string> = {
	flat: '平铺（每项一个菜单条目）',
	submenu: '收进「批量复制」子菜单',
};

const SEPARATOR_OPTIONS: Record<string, string> = {
	newline: '换行（每项一行）',
	dunhao: '顿号（、）',
	comma: '逗号加空格（, ）',
	space: '空格',
	custom: '自定义',
};

const SORT_OPTIONS: Record<string, string> = {
	selection: '按选中顺序',
	name: '按名称',
	path: '按路径',
};

function isFormatKey(key: SettingsKey): key is FormatKey {
	return key.startsWith(FORMAT_KEY_PREFIX);
}

function formatIdOf(key: FormatKey): FormatId {
	return key.slice(FORMAT_KEY_PREFIX.length) as FormatId;
}

const formatKey = (id: FormatId): FormatKey => `${FORMAT_KEY_PREFIX}${id}`;

export class BatchCopySettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: BatchCopyPlugin,
	) {
		super(app, plugin);
	}

	/* ---------------------------- 值的读写 ---------------------------- */

	/** 1.13.0+ 由 Obsidian 调用；默认实现读 this.plugin.settings，我们接管虚拟键。 */
	getControlValue(key: string): unknown {
		return this.readValue(key as SettingsKey);
	}

	/** 覆盖后自动 saveData() 会被取消，所以这里必须自己持久化。 */
	async setControlValue(key: string, value: unknown): Promise<void> {
		await this.writeValue(key as SettingsKey, value);
	}

	private readValue(key: SettingsKey): unknown {
		if (isFormatKey(key)) {
			return this.plugin.settings.enabledFormats.includes(formatIdOf(key));
		}
		return this.plugin.settings[key];
	}

	private async writeValue(key: SettingsKey, value: unknown): Promise<void> {
		if (isFormatKey(key)) {
			const id = formatIdOf(key);
			const enabled = new Set(this.plugin.settings.enabledFormats);
			if (value === true) enabled.add(id);
			else enabled.delete(id);
			// 保持 FORMAT_IDS 的既定顺序，菜单顺序才不会随手点一下开关就乱掉
			this.plugin.settings.enabledFormats = FORMAT_IDS.filter((each) => enabled.has(each));
		} else if (key === 'separatorCustom') {
			const raw = typeof value === 'string' ? value : '';
			this.plugin.settings.separatorCustom = raw.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
		} else {
			(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		}
		await this.plugin.saveSettings();
	}

	/** 设置行的分组与顺序。必须保持廉价：注册时和每次刷新都会被调用。 */
	private groups(): SettingGroup[] {
		return [
			{
				heading: '菜单形态',
				rows: [
					{
						kind: 'dropdown',
						key: 'menuMode',
						name: '菜单展示方式',
						desc: '格式较多时建议收进子菜单，避免右键菜单过长。',
						options: MENU_MODE_OPTIONS,
					},
					{
						kind: 'toggle',
						key: 'showCount',
						name: '显示数量',
						desc: '多选时在菜单标题后显示「（N 项）」。',
					},
				],
			},
			{
				heading: '显示的格式',
				rows: FORMATS.map((format) => ({
					kind: 'toggle' as const,
					key: formatKey(format.id),
					name: format.label,
					desc: format.hint,
				})),
			},
			{
				heading: '输出',
				rows: [
					{
						kind: 'dropdown',
						key: 'separatorPreset',
						name: '分隔符',
						desc: '多项之间的连接符。',
						options: SEPARATOR_OPTIONS,
					},
					{
						kind: 'text',
						key: 'separatorCustom',
						name: '自定义分隔符',
						desc: '支持 \\n \\t 转义。',
						visibleWhen: () => this.plugin.settings.separatorPreset === 'custom',
					},
					{
						kind: 'dropdown',
						key: 'sortBy',
						name: '排序',
						desc: '「按选中顺序」保持文件列表给出的顺序。',
						options: SORT_OPTIONS,
					},
					{
						kind: 'toggle',
						key: 'skipFolders',
						name: '跳过文件夹',
						desc: '多选里混有文件夹时，忽略文件夹只复制文件。单独右键文件夹本来就不会出现这些选项。',
					},
					{
						kind: 'toggle',
						key: 'normalizeNFC',
						name: '路径 NFC 规范化',
						desc: '规避 macOS 中文文件名的 NFD 编码差异，一般保持开启。',
					},
					{
						kind: 'toggle',
						key: 'notify',
						name: '复制后提示',
						desc: '在右上角弹出「已复制 N 项」。',
					},
				],
			},
		];
	}

	/* ------------------- 路径一：Obsidian 1.13.0+ ------------------- */

	getSettingDefinitions(): SettingDefinitionItem[] {
		return this.groups().map((group) => ({
			type: 'group' as const,
			heading: group.heading,
			items: group.rows.map((row) => this.toDefinition(row)),
		}));
	}

	// 只返回带 control 的定义：SettingDefinitionGroup.items 不接受嵌套分组。
	private toDefinition(row: SettingRow): SettingDefinitionControl {
		const visible = 'visibleWhen' in row && row.visibleWhen ? { visible: row.visibleWhen } : {};
		switch (row.kind) {
			case 'toggle':
				return { name: row.name, desc: row.desc, ...visible, control: { type: 'toggle', key: row.key } };
			case 'dropdown':
				return {
					name: row.name,
					desc: row.desc,
					...visible,
					control: { type: 'dropdown', key: row.key, options: row.options },
				};
			case 'text':
				return {
					name: row.name,
					desc: row.desc,
					...visible,
					control: { type: 'text', key: row.key, placeholder: row.placeholder },
				};
		}
	}

	/* -------------------- 路径二：Obsidian < 1.13.0 -------------------- */

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// 条件可见的行要在任何一次写入之后重算：改分隔符会立刻影响「自定义分隔符」那一行。
		const conditional: { setting: Setting; row: SettingRow }[] = [];
		const refreshVisibility = (): void => {
			for (const { setting, row } of conditional) {
				const show = !('visibleWhen' in row) || !row.visibleWhen || row.visibleWhen();
				setting.settingEl.toggle(show);
			}
		};

		for (const group of this.groups()) {
			new Setting(containerEl).setName(group.heading).setHeading();

			for (const row of group.rows) {
				const setting = new Setting(containerEl).setName(row.name);
				if (row.desc) setting.setDesc(row.desc);

				const write = async (value: unknown): Promise<void> => {
					await this.writeValue(row.key, value);
					refreshVisibility();
				};

				switch (row.kind) {
					case 'toggle':
						setting.addToggle((toggle) =>
							toggle.setValue(this.readValue(row.key) === true).onChange(write),
						);
						break;
					case 'dropdown':
						setting.addDropdown((dropdown) => {
							for (const [value, label] of Object.entries(row.options)) {
								dropdown.addOption(value, label);
							}
							dropdown.setValue(String(this.readValue(row.key) ?? '')).onChange(write);
						});
						break;
					case 'text':
						setting.addText((text) => {
							if (row.placeholder) text.setPlaceholder(row.placeholder);
							text.setValue(String(this.readValue(row.key) ?? '')).onChange(write);
						});
						break;
				}

				conditional.push({ setting, row });
			}
		}

		refreshVisibility();
	}
}
