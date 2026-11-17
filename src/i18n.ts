import { getLanguage, requireApiVersion } from "obsidian";

export type Locale = "en" | "zh";

export function getLocale(): Locale {
	let lang = "";
	try {
		if (requireApiVersion("1.8.7") && typeof getLanguage === "function") {
			lang = getLanguage();
		}
	} catch {
		lang = "";
	}
	if (!lang) {
		lang =
			window.localStorage.getItem("language") ||
			navigator.language ||
			"en";
	}
	return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

type ViewTypeKey = "modal" | "sidebar" | "split" | "tab" | "window";

const VIEW_TYPE_EN: Record<ViewTypeKey, string> = {
	modal: "Modal",
	split: "Split",
	tab: "Tab",
	window: "Window",
	sidebar: "Sidebar",
};

const VIEW_TYPE_ZH: Record<ViewTypeKey, string> = {
	modal: "弹窗",
	split: "分栏",
	tab: "标签页",
	window: "窗口",
	sidebar: "侧边栏",
};

export interface Strings {
	pluginIntro: string;
	settingsTitle: string;
	tabGeneral: string;
	tabQuickSearch: string;
	tabQuickCreate: string;
	quickSearchTrigger: string;
	quickSearchTriggerDesc: string;
	doubleTapInterval: string;
	doubleTapIntervalDesc: string;
	quickCreateHeading: string;
	enableQuickCreate: string;
	enableQuickCreateDesc: string;
	quickCreateFolder: string;
	quickCreateFolderDesc: string;
	quickCreateFolderPlaceholder: string;
	titleFormat: string;
	titleFormatDesc: string;
	triggerShift: string;
	triggerControl: string;
	triggerAlt: string;
	triggerMeta: string;
	triggerNone: string;
	showFilePath: string;
	showInstructions: string;
	defaultViewType: string;
	viewType: Record<ViewTypeKey, string>;
	viewTypeMenu: (type: string) => string;
	switchToFileView: string;
	ribbonSearch: (type: ViewTypeKey | string) => string;
	cmdSearchGlobally: string;
	cmdSearchGloballyState: string;
	cmdSearchCurrentFile: string;
	cmdSearchBacklink: string;
	cmdShowHideFilePath: string;
	cmdOpenSearchView: (type: string) => string;
	cmdSearchFile: string;
	cmdSearchPath: string;
	cmdSearchContent: string;
	cmdSearchMatchCase: string;
	cmdSearchIgnoreCase: string;
	cmdSearchTag: string;
	cmdSearchLine: string;
	cmdSearchBlock: string;
	cmdSearchSection: string;
	cmdSearchTask: string;
	cmdSearchTaskTodo: string;
	cmdSearchTaskDone: string;
	cmdSearchProperty: string;
	menuSearchInFloat: (query: string) => string;
	menuOpenInFloatPreview: string;
	instrNavigate: string;
	instrCollapse: string;
	instrOpenBackground: string;
	instrOpenAndClose: string;
	instrCreateIfMissing: string;
	instrPreview: string;
	instrSwitchView: string;
	instrAltClick: string;
	cmdkPlaceholder: string;
	cmdkNavigate: string;
	cmdkOpen: string;
	cmdkNewTab: string;
	cmdkClose: string;
	cmdkCreateNote: string;
	filterBases: string;
	filterCanvas: string;
	filterAll: string;
	filterStarredOnly: string;
	filterMatchCase: string;
	filterRegex: string;
}

const EN: Strings = {
	pluginIntro:
		"Use Obsidian's built-in search in a floating modal, split, tab, or independent window.",
	settingsTitle: "Float Search Window",
	tabGeneral: "General",
	tabQuickSearch: "Quick Search",
	tabQuickCreate: "Quick Create",
	quickSearchTrigger: "Quick search trigger",
	quickSearchTriggerDesc:
		"Double-tap this key to open the quick search modal (CMDK).",
	doubleTapInterval: "Double-tap interval (ms)",
	doubleTapIntervalDesc:
		"Maximum time between two key presses to trigger quick search. Default: 300ms.",
	quickCreateHeading: "Quick Create",
	enableQuickCreate: "Enable quick create",
	enableQuickCreateDesc:
		"When no exact match is found in quick search, show an option to create a new note with the search text as content.",
	quickCreateFolder: "Quick create folder",
	quickCreateFolderDesc:
		"Folder to create new notes in. Leave empty for vault root.",
	quickCreateFolderPlaceholder: "e.g. Inbox",
	titleFormat: "Title format",
	titleFormatDesc:
		"Moment.js format for the note title, e.g. YYYYMMDDHHmmss. Wrap literal text in [brackets].",
	triggerShift: "Double Shift",
	triggerControl: "Double Ctrl",
	triggerAlt: "Double Alt",
	triggerMeta: "Double Meta (Cmd/Win)",
	triggerNone: "Disabled",
	showFilePath: "Show file path",
	showInstructions: "Show instructions",
	defaultViewType: "Default view type",
	viewType: VIEW_TYPE_EN,
	viewTypeMenu: (type) => {
		const label = VIEW_TYPE_EN[type as ViewTypeKey] ?? type;
		return `${label} view`;
	},
	switchToFileView: "Switch to File View",
	ribbonSearch: (type) => `Search obsidian in ${type} view`,
	cmdSearchGlobally: "Search obsidian globally",
	cmdSearchGloballyState: "Search Obsidian Globally (With Last State)",
	cmdSearchCurrentFile: "Search in current file",
	cmdSearchBacklink: "Search in backlink Of current file",
	cmdShowHideFilePath: "Show/hide file path",
	cmdOpenSearchView: (type) => `Open search view (${type})`,
	cmdSearchFile: "Search: file: (Find text in filename)",
	cmdSearchPath: "Search: path: (Find text in file path)",
	cmdSearchContent: "Search: content: (Find text in file content)",
	cmdSearchMatchCase: "Search: match-case: (Case-sensitive match)",
	cmdSearchIgnoreCase: "Search: ignore-case: (Case-insensitive match)",
	cmdSearchTag: "Search: tag: (Find tag)",
	cmdSearchLine: "Search: line: (Find files with matching line)",
	cmdSearchBlock: "Search: block: (Find matches in the same block)",
	cmdSearchSection: "Search: section: (Find matches in the same section)",
	cmdSearchTask: "Search: task: (Find matches in a task)",
	cmdSearchTaskTodo: "Search: task-todo: (Find matches in uncompleted tasks)",
	cmdSearchTaskDone: "Search: task-done: (Find matches in completed tasks)",
	cmdSearchProperty: "Search: [property] or [property:value]",
	menuSearchInFloat: (query) => `Search "${query}" in Float Search`,
	menuOpenInFloatPreview: "Open in Float Preview",
	instrNavigate: "Navigate",
	instrCollapse: "Collapse/Expand",
	instrOpenBackground: "Open in background",
	instrOpenAndClose: "Open File and Close",
	instrCreateIfMissing: "Create File When Not Exist",
	instrPreview: "Preview/Close Preview",
	instrSwitchView: "Switch Between Search and File View",
	instrAltClick: "Close Modal While In File View",
	cmdkPlaceholder: "Search files and content...",
	cmdkNavigate: "Navigate",
	cmdkOpen: "Open",
	cmdkNewTab: "New tab",
	cmdkClose: "Close",
	cmdkCreateNote: "Create new note",
	filterBases: "Bases",
	filterCanvas: "Canvas",
	filterAll: "All",
	filterStarredOnly: "Starred only",
	filterMatchCase: "Match case",
	filterRegex: "Use regular expression",
};

const ZH: Strings = {
	pluginIntro:
		"把Obsidian自带搜索放到浮动弹窗、分栏、标签页或独立窗口里用。",
	settingsTitle: "Float Search Window",
	tabGeneral: "常规",
	tabQuickSearch: "快速搜索",
	tabQuickCreate: "快速新建",
	quickSearchTrigger: "快速搜索快捷键",
	quickSearchTriggerDesc: "双击此键打开快速搜索（CMDK）。",
	doubleTapInterval: "双击间隔（毫秒）",
	doubleTapIntervalDesc:
		"两次按键之间的最长时间，超时则不触发快速搜索。默认 300 毫秒。",
	quickCreateHeading: "快速新建",
	enableQuickCreate: "启用快速新建",
	enableQuickCreateDesc:
		"快速搜索没有精确匹配时，显示用搜索词作为内容新建笔记的选项。",
	quickCreateFolder: "新建笔记目录",
	quickCreateFolderDesc: "新笔记所在文件夹。留空则放在库根目录。",
	quickCreateFolderPlaceholder: "例如 Inbox",
	titleFormat: "标题格式",
	titleFormatDesc:
		"笔记标题的 Moment.js 格式，例如 YYYYMMDDHHmmss。字面文字请用 [方括号] 包裹。",
	triggerShift: "双击 Shift",
	triggerControl: "双击 Ctrl",
	triggerAlt: "双击 Alt",
	triggerMeta: "双击 Meta（Cmd/Win）",
	triggerNone: "关闭",
	showFilePath: "显示文件路径",
	showInstructions: "显示按键说明",
	defaultViewType: "默认视图",
	viewType: VIEW_TYPE_ZH,
	viewTypeMenu: (type) => {
		const label = VIEW_TYPE_ZH[type as ViewTypeKey] ?? type;
		return `${label}视图`;
	},
	switchToFileView: "切换到文件视图",
	ribbonSearch: (type) => {
		const label = VIEW_TYPE_ZH[type as ViewTypeKey] ?? type;
		return `在${label}中搜索`;
	},
	cmdSearchGlobally: "全局搜索",
	cmdSearchGloballyState: "全局搜索（保留上次关键字）",
	cmdSearchCurrentFile: "在当前文件中搜索",
	cmdSearchBacklink: "搜索当前文件的反向链接",
	cmdShowHideFilePath: "显示/隐藏文件路径",
	cmdOpenSearchView: (type) => {
		const label = VIEW_TYPE_ZH[type as ViewTypeKey] ?? type;
		return `打开搜索视图（${label}）`;
	},
	cmdSearchFile: "搜索：file:（在文件名中查找）",
	cmdSearchPath: "搜索：path:（在路径中查找）",
	cmdSearchContent: "搜索：content:（在正文中查找）",
	cmdSearchMatchCase: "搜索：match-case:（区分大小写）",
	cmdSearchIgnoreCase: "搜索：ignore-case:（不区分大小写）",
	cmdSearchTag: "搜索：tag:（查找标签）",
	cmdSearchLine: "搜索：line:（按行匹配）",
	cmdSearchBlock: "搜索：block:（同一块中匹配）",
	cmdSearchSection: "搜索：section:（同一节中匹配）",
	cmdSearchTask: "搜索：task:（在任务中匹配）",
	cmdSearchTaskTodo: "搜索：task-todo:（未完成任务）",
	cmdSearchTaskDone: "搜索：task-done:（已完成任务）",
	cmdSearchProperty: "搜索：[属性] 或 [属性:值]",
	menuSearchInFloat: (query) => `用浮动搜索查找「${query}」`,
	menuOpenInFloatPreview: "在浮动预览中打开",
	instrNavigate: "切换结果",
	instrCollapse: "折叠/展开",
	instrOpenBackground: "后台打开",
	instrOpenAndClose: "打开并关闭弹窗",
	instrCreateIfMissing: "文件不存在时新建",
	instrPreview: "预览/关闭预览",
	instrSwitchView: "在搜索和预览间切换",
	instrAltClick: "预览时关闭弹窗",
	cmdkPlaceholder: "搜索文件和正文…",
	cmdkNavigate: "切换",
	cmdkOpen: "打开",
	cmdkNewTab: "新标签打开",
	cmdkClose: "关闭",
	cmdkCreateNote: "新建笔记",
	filterBases: "数据库",
	filterCanvas: "白板",
	filterAll: "全部",
	filterStarredOnly: "只看收藏",
	filterMatchCase: "区分大小写",
	filterRegex: "使用正则表达式",
};

export function strings(): Strings {
	return getLocale() === "zh" ? ZH : EN;
}

const dict: Record<string, { en: string; zh: string }> = {
	// Settings tab
	tabFilters: { en: "Filters", zh: "筛选" },
	settingsTitle: {
		en: "Float Search Settings",
		zh: "浮窗搜索设置",
	},
	quickSearchTrigger: {
		en: "Quick search trigger",
		zh: "极速搜索触发键",
	},
	quickSearchTriggerDesc: {
		en: "Double-tap this key to open the quick search modal (CMDK).",
		zh: "双击此按键打开极速搜索弹窗（CMDK）。",
	},
	doubleTapInterval: {
		en: "Double-tap interval (ms)",
		zh: "双击间隔（毫秒）",
	},
	doubleTapIntervalDesc: {
		en: "Maximum time between two key presses to trigger quick search. Default: 300ms.",
		zh: "两次按键之间触发极速搜索的最大间隔，默认 300 毫秒。",
	},
	quickCreate: { en: "Quick Create", zh: "快速创建" },
	enableQuickCreate: { en: "Enable quick create", zh: "启用快速创建" },
	enableQuickCreateDesc: {
		en: "When no exact match is found in quick search, show an option to create a new note with the search text as content.",
		zh: "极速搜索无精确匹配时，显示用搜索文本作为内容创建新笔记的选项。",
	},
	quickCreateFolder: {
		en: "Quick create folder",
		zh: "快速创建文件夹",
	},
	quickCreateFolderDesc: {
		en: "Folder to create new notes in. Leave empty for vault root.",
		zh: "新建笔记所在的文件夹，留空则为仓库根目录。",
	},
	titleFormat: { en: "Title format", zh: "标题格式" },
	titleFormatDesc: {
		en: "Moment.js format for the note title, e.g. YYYYMMDDHHmmss. Wrap literal text in [brackets].",
		zh: "笔记标题的 Moment.js 格式，例如 YYYYMMDDHHmmss。字面文字请用 [方括号] 包裹。",
	},
	exclusions: { en: "Exclusions", zh: "排除项" },
	excludeFolders: { en: "Exclude folders", zh: "排除文件夹" },
	excludeFoldersDesc: {
		en: "Folders to skip in CMDK and main search. Pick a folder from the list; click a pill to remove.",
		zh: "在 CMDK 与主搜索中跳过的文件夹。从列表中选择，点击胶囊可删除。",
	},
	excludeFiles: { en: "Exclude files", zh: "排除文件" },
	excludeFilesDesc: {
		en: "Specific files to skip. Pick a file from the list; click a pill to remove.",
		zh: "需跳过的指定文件。从列表中选择，点击胶囊可删除。",
	},
	savedSearches: { en: "Saved searches", zh: "预设搜索" },
	addSavedSearch: { en: "Add saved search", zh: "添加预设搜索" },
	addSavedSearchDesc: {
		en: "Save a query as a preset. It appears as a chip above the CMDK results — click it to filter the list inline (no jump to the native search). Also runs from the command palette.",
		zh: "保存一个查询作为预设。它会以芯片形式出现在 CMDK 结果上方——点击即在原列表内筛选（不再跳转到原生搜索）。也可通过命令面板运行。",
	},
	namePlaceholder: {
		en: "Name (e.g. Current project)",
		zh: "名称（如：当前项目）",
	},
	queryPlaceholder: {
		en: "Query (e.g. tag:#project)",
		zh: "查询（如：tag:#项目）",
	},
	add: { en: "Add", zh: "添加" },
	edit: { en: "Edit", zh: "编辑" },
	delete: { en: "Delete", zh: "删除" },
	noSavedSearches: {
		en: "No saved searches yet.",
		zh: "暂无预设搜索。",
	},

	// Pills
	clickToRemove: { en: "Click to remove", zh: "点击删除" },

	// Name prompt modal
	saveAsPreset: { en: "Save search as preset", zh: "保存为预设搜索" },
	presetName: { en: "Preset name", zh: "预设名称" },
	save: { en: "Save", zh: "保存" },
	cancel: { en: "Cancel", zh: "取消" },

	// CMDK items
	savedSearchNote: { en: "Saved search", zh: "预设搜索" },
	saveCurrentTitle: {
		en: "Save current search as preset",
		zh: "保存当前搜索为预设",
	},

	// Command
	savedSearchCmd: {
		en: "Saved search: {name}",
		zh: "预设搜索：{name}",
	},

	// Placeholders
	phInbox: { en: "e.g. Inbox", zh: "例如：收件箱" },
	phTemplates: { en: "e.g. Templates", zh: "例如：Templates" },
	phSecrets: { en: "e.g. Secrets.md", zh: "例如：Secrets.md" },
	phTimestamp: { en: "YYYYMMDDHHmmss", zh: "YYYYMMDDHHmmss" },


};

export function t(
	key: keyof typeof dict | string,
	vars?: Record<string, string | number>
): string {
	const entry = dict[key];
	let s: string;
	if (!entry) {
		s = key;
	} else {
		s = getLocale() === "zh" ? entry.zh : entry.en;
	}
	if (vars) {
		for (const k of Object.keys(vars)) {
			s = s.split(`{${k}}`).join(String(vars[k]));
		}
	}
	return s;
}
