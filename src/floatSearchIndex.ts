import {
	addIcon,
	App,
	Editor,
	ExtraButtonComponent,
	Keymap,
	moment,
	Menu,
	MenuItem,
	Modal,
	ObsidianProtocolData,
	OpenViewState,
	PaneType,
	AbstractInputSuggest,
	Plugin,
	renderResults,
	SearchResult,
	requireApiVersion,
	SearchView,
	setIcon,
	PluginSettingTab,
	prepareFuzzySearch,
	Setting,
	SuggestModal,
	TAbstractFile,
	TFolder,
	TFile,
	Workspace,
	WorkspaceContainer,
	WorkspaceItem,
	WorkspaceLeaf,
} from "obsidian";
import { EmbeddedView, isEmebeddedLeaf, spawnLeafView } from "./leafView";
import { SearchFilter, freeText, isPlainText, parseQuery, requiresContent, type Query, type Clause } from "./searchFilter";
import {
	createExclusionMatcher,
	normalizePath,
	stripExclusion,
	withExclusion,
} from "./exclusions";
import {
	DEFAULT_SETTINGS,
	newSavedSearchId,
	parseViewType,
	sanitizeSettings,
	type CmdkTriggerKey,
	type FloatSearchSettings,
	type SearchState,
	type SearchType,
	type SortOrder,
} from "./settings";
import { safeFileName, uniqueNotePath } from "./quickCreate";
import { type CmdkResult, type FileResult, ephemeralStateFor, isFileResult } from "./cmdkResult";
import { ContentCache } from "./contentCache";
import { LatestQueue } from "./latestQueue";
import { escapeRegex } from "./regex";
import { around } from "monkey-around";
import { debounce } from "obsidian";
import { strings } from "./i18n";
import {
	applyNativeResultFilters,
	registerFilterIcons,
	bindNativeRegexSearch,
	isFileAllowed,
	getBookmarkedPaths,
	matchAsSearchResult,
	mountFilterBar,
	watchNativeSearchResults,
} from "./filterBar";

interface viewType {
	type: SearchType;
	icon: string;
}

const allViews: viewType[] = [
	{
		type: "modal",
		icon: "square-equal",
	},
	{
		type: "sidebar",
		icon: "panel-left-inactive",
	},
	{
		type: "split",
		icon: "split-square-horizontal",
	},
	{
		type: "tab",
		icon: "panel-top",
	},
	{
		type: "window",
		icon: "app-window",
	},
];

export default class FloatSearchPlugin extends Plugin {
	settings: FloatSearchSettings;
	private state: SearchState;
	private modal: FloatSearchModal;
	private cmdkModal: FloatSearchCmdkModal;

	queryLoaded = false;

	// Guards for the setState re-route, which would otherwise spawn a new Float
	// Search on every external setState and loop forever. `routingQuery` blocks
	// re-entrancy; `lastRouted` ignores the same query repeated within a second.
	routing = false;
	private lastRouted = { query: "", at: 0 };

	/** True while a freshly patched search view rebuilds itself. */
	private suppressViewStatePersist = false;

	isDuplicateRoute(query: string): boolean {
		const now = Date.now();
		const duplicate =
			query === this.lastRouted.query && now - this.lastRouted.at < 1000;
		this.lastRouted = { query, at: now };
		return duplicate;
	}

	persistViewState(patch: Partial<SearchState>) {
		if (!this.app.workspace.layoutReady || this.suppressViewStatePersist) return;
		Object.assign(this.settings.searchViewState, patch);
		this.applySettingsUpdate();
	}

	public applySettingsUpdate = debounce(async () => {
		// Ensure all search state properties are preserved
		this.settings.searchViewState = {
			...DEFAULT_SETTINGS.searchViewState,
			...this.settings.searchViewState,
			query: this.state?.query || "",
		};
		await this.saveSettings();
	}, 1000);

	private applyStateUpdate = debounce(() => {
		// Preserve all state properties when updating
		this.state = {
			...DEFAULT_SETTINGS.searchViewState,
			...this.state,
			query: "",
		};
	}, 30000);

	async onload() {
		await this.loadSettings();
		

		this.registerIcons();
		registerFilterIcons();
		this.app.workspace.onLayoutReady(() => {
			this.initState();
			// The prototype monkeypatches (patchWorkspace / patchSearchView / …)
			// are deferred to first use via ensurePatched() — they are only
			// needed once the user actually opens a float search, so we no
			// longer pay for them at every startup (candidate ⑤).
			this.registerDoubleKeyHandler();
		});

		this.registerContentCacheInvalidation();

		this.registerObsidianURIHandler();
		this.registerObsidianCommands();
		this.registerEditorMenuHandler();
		this.registerContextMenuHandler();
		

		this.addRibbonIcon(
			"float-search-window",
			strings().ribbonSearch(this.settings.defaultViewType),
			() => void this.openSearch(this.state, undefined, true)
		);
		this.updateFilePathVisibility();
		this.addSettingTab(new FloatSearchSettingTab(this.app, this));
	}

	onunload() {
		// this.state = DEFAULT_SETTINGS.searchViewState;
		this.modal?.close();
		this.cmdkModal?.close();
		this.contentCache.clear();
	}

	// Shared across every CMDK open so repeated searches rarely re-read bodies.
	private readonly contentCache = new ContentCache();

	async readContent(file: TFile): Promise<string> {
		const cached = this.contentCache.get(file.path, file.stat.mtime);
		if (cached !== undefined) return cached;
		const text = await this.app.vault.cachedRead(file);
		this.contentCache.set(file.path, file.stat.mtime, text);
		return text;
	}

	private registerContentCacheInvalidation() {
		this.registerEvent(
			this.app.vault.on("modify", (f) => this.contentCache.delete(f.path))
		);
		this.registerEvent(
			this.app.vault.on("rename", (_f, oldPath) =>
				this.contentCache.delete(oldPath)
			)
		);
		this.registerEvent(
			this.app.vault.on("delete", (f) => this.contentCache.delete(f.path))
		);
	}

	// Candidate ⑤: run the prototype monkeypatches exactly once, on first use,
	// instead of unconditionally at every startup.
	private patched = false;
	private ensurePatched() {
		if (this.patched) return;
		this.patched = true;
		this.patchWorkspace();
		this.patchWorkspaceLeaf();
		this.patchSearchView();
		this.patchVchildren();
		this.patchDragManager();
		this.patchEditorHighlights();
	}

	// Obsidian's search addon calls removeHighlights()/hasHighlight() on every
	// markdown editor whenever a search runs. Editors created inside the
	// embedded (HoverPopover) preview leaf may not have the search-highlight
	// StateField registered in their CodeMirror state, so `state.field(...)`
	// throws "Field is not present in this state" and crashes the app. Wrap
	// both methods defensively so the embedded preview can never crash Obsidian
	// — when the field is absent there are simply no highlights to manage.
	private patchEditorHighlights() {
		const proto = Editor.prototype as any;
		const uninstallers: Array<() => void> = [];
		for (const name of ["removeHighlights", "hasHighlight"] as const) {
			const orig = proto[name];
			if (!orig || orig.__fsPatched) continue;
			const wrapped = function (...args: any[]) {
				try {
					return orig.apply(this, args);
				} catch (e) {
					if (
						e instanceof RangeError &&
						/Field is not present in this state/.test(
							e.message
						)
					) {
						return name === "hasHighlight" ? false : undefined;
					}
					throw e;
				}
			};
			wrapped.__fsPatched = true;
			proto[name] = wrapped;
			// Restore the original method on plugin unload so we don't leave a
			// permanent patch on Editor.prototype for every editor in the app.
			uninstallers.push(() => {
				proto[name] = orig;
			});
		}
		if (uninstallers.length) {
			this.register(() => uninstallers.forEach((u) => u()));
		}
	}

	registerDoubleKeyHandler() {
		let lastKeyUp = 0;
		let keyOnly = true;

		const listen = (doc: Document) => {
			this.registerDomEvent(doc, "keydown", (e: KeyboardEvent) => {
				const triggerKey = this.settings.cmdkTriggerKey;
				if (triggerKey === "none" || e.key !== triggerKey) {
					keyOnly = false;
				}
			});

			this.registerDomEvent(doc, "keyup", (e: KeyboardEvent) => {
				const triggerKey = this.settings.cmdkTriggerKey;
				if (triggerKey === "none" || e.key !== triggerKey) return;
				const now = Date.now();
				if (
					keyOnly &&
					now - lastKeyUp < this.settings.cmdkDoubleTapInterval &&
					!doc.querySelector(".float-search-cmdk-container")
				) {
					lastKeyUp = 0;
					this.openCmdkModal();
				} else {
					lastKeyUp = now;
					keyOnly = true;
				}
			});
		};

		listen(document);
		// Popout windows have their own document.
		this.registerEvent(
			this.app.workspace.on("window-open", (_workspaceWindow, win) =>
				listen(win.document)
			)
		);
	}

	openCmdkModal(initialFilters?: string[]) {
		this.ensurePatched();
		if (this.cmdkModal) {
			this.cmdkModal.close();
		}
		this.cmdkModal = new FloatSearchCmdkModal(this, initialFilters);
		this.cmdkModal.open();
	}

	updateFilePathVisibility() {
		const { showFilePath } = this.settings;
		document.body.toggleClass("show-file-path", showFilePath);
	}

	changeFilePathVisibility() {
		this.settings.showFilePath = !this.settings.showFilePath;
		this.updateFilePathVisibility();
		this.applySettingsUpdate();
	}

	// ── Exclusion helpers ──────────────────────────────────────────────
	withExclusion(query: string): string {
		return withExclusion(this.settings, query);
	}

	stripExclusion(query: string): string {
		return stripExclusion(this.settings, query);
	}

	// ── Saved searches ────────────────────────────────────────────────
	// One palette command per preset, keyed by the preset's stable id (not its
	// name), so hotkeys survive renames and non-Latin names cannot collide.
	private savedSearchCommands = new Map<string, string>();

	syncSavedSearchCommands() {
		const presets = new Map(this.settings.savedSearches.map((s) => [s.id, s]));
		for (const [id, name] of this.savedSearchCommands) {
			if (presets.get(id)?.name === name) continue;
			this.app.commands.removeCommand(`${this.manifest.id}:savedsearch-${id}`);
			this.savedSearchCommands.delete(id);
		}
		for (const preset of presets.values()) {
			if (this.savedSearchCommands.has(preset.id)) continue;
			this.savedSearchCommands.set(preset.id, preset.name);
			this.addCommand({
				id: `savedsearch-${preset.id}`,
				name: strings().savedSearchCmd(preset.name),
				callback: () => {
					const latest = this.settings.savedSearches.find((s) => s.id === preset.id);
					if (latest) this.openCmdkModal([latest.query]);
				},
			});
		}
	}

	async addSavedSearch(name: string, query: string) {
		this.settings.savedSearches.push({ id: newSavedSearchId(), name, query });
		await this.saveSettings();
		this.syncSavedSearchCommands();
	}

	private async openInLeaf(type: PaneType | "sidebar", state?: SearchState) {
		const leaf =
			type === "sidebar"
				? this.app.workspace.getLeftLeaf(false)
				: this.app.workspace.getLeaf(type);
		leaf?.setPinned(type !== "sidebar");
		await leaf?.setViewState({
			type: "search",
			active: true,
			state: {
				...DEFAULT_SETTINGS.searchViewState,
				...state,
				query: this.withExclusion(
					new SearchFilter(this.app).toNativeQuery(state?.query ?? "")
				),
				triggerBySelf: true,
			},
		});

		window.setTimeout(() => {
			leaf?.containerEl.getElementsByTagName("input")[0]?.focus();
		}, 0);
	}

	/** Open the float search in the given (default: configured) view. */
	openSearch(
		state: SearchState,
		viewType: SearchType = this.settings.defaultViewType,
		clearQuery = false
	): Promise<void> {
		if (viewType === "modal") {
			this.initModal(state, true, clearQuery);
			return Promise.resolve();
		}
		this.ensurePatched();
		return this.openInLeaf(viewType,
			clearQuery ? { ...state, query: "" } : state
		);
	}

	initState() {
		// Initialize state with all default properties.
		// We intentionally do NOT inherit the persisted `query` from
		// settings.searchViewState, so the float search always opens with a
		// global (empty) scope. Folder/tag restrictions (path:/tag:) are only
		// applied when the user types them or picks a saved search chip.
		this.state = {
			...DEFAULT_SETTINGS.searchViewState,
			...this.settings.searchViewState,
			query: "",
		};
	}

	initModal(
		state: SearchState,
		stateSave = false,
		clearQuery = false
	) {
		this.ensurePatched();
		if (this.modal) {
			this.modal.close();
		}

		this.modal = new FloatSearchModal(
			(state) => {
				// Preserve all state properties when updating from modal
				this.state = {
					...DEFAULT_SETTINGS.searchViewState,
					...state,
				};
				if (stateSave) this.applyStateUpdate();
				this.settings.searchViewState = this.state;
				this.applySettingsUpdate();
			},
			this,
			{ ...state, query: clearQuery ? "" : state.query }
		);
		this.modal.open();
	}

	patchWorkspace() {
		let layoutChanging = false;
		// Keep the plugin receiver across native method wrappers.
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;
		const uninstaller = around(Workspace.prototype, {
			getLeaf: (next) =>
				function (...args) {
					const activeLeaf = (this as Workspace).activeLeaf;
					if (activeLeaf?.parent) {
						// @ts-ignore
						const fsCtnEl = (
							activeLeaf.parent.containerEl as HTMLElement
						).parentElement;
						if (fsCtnEl?.hasClass("fs-content")) {
							if (activeLeaf.view.getViewType() === "markdown") {
								return activeLeaf;
							}

							const newLeaf =
								self.app.workspace.getMostRecentLeaf();

							if (newLeaf) {
								this.setActiveLeaf(newLeaf);
							}
						}
						return next.call(this, ...args);
					}
					return next.call(this, ...args);
				},
			changeLayout(old) {
				return async function (workspace: unknown) {
					layoutChanging = true;
					try {
						// Don't consider hover popovers part of the workspace while it's changing
						await old.call(this, workspace);
					} finally {
						layoutChanging = false;
					}
				};
			},
			iterateLeaves(old) {
				type leafIterator = (item: WorkspaceLeaf) => boolean | void;
				return function (arg1, arg2) {
					// Fast exit if desired leaf found
					if (old.call(this, arg1, arg2)) return true;

					// Handle old/new API parameter swap
					const cb: leafIterator = (
						typeof arg1 === "function" ? arg1 : arg2
					) as leafIterator;
					const parent: WorkspaceItem = (
						typeof arg1 === "function" ? arg2 : arg1
					) as WorkspaceItem;

					if (!parent) return false; // <- during app startup, rootSplit can be null
					if (layoutChanging) return false; // Don't let HEs close during workspace change

					// 0.14.x doesn't have WorkspaceContainer; this can just be an instanceof check once 15.x is mandatory:

					if (!requireApiVersion("0.15.0")) {
						if (
							parent === self.app.workspace.rootSplit ||
							(WorkspaceContainer &&
								parent instanceof WorkspaceContainer)
						) {
							for (const popover of EmbeddedView.popoversForWindow(
								(parent as WorkspaceContainer).win
							)) {
								// Use old API here for compat w/0.14.x
								if (old.call(this, cb, popover.rootSplit))
									return false;
							}
						}
					}
					return false;
				};
			},
			setActiveLeaf(old) {
				return function (leaf: any, params?: any) {
					if (isEmebeddedLeaf(leaf)) {
						old.call(this, leaf, params);
						leaf.activeTime = 1700000000000;
					}
					return old.call(this, leaf, params);
				};
			},
			pushUndoHistory(old: any) {
				return function (
					leaf: WorkspaceLeaf,
					id: string,
					...args: any[]
				) {
					const viewState = leaf.getViewState();
					if (viewState.type === "search") {
						return;
					}
					return old.call(this, leaf, id, ...args);
				};
			},
		});
		this.register(uninstaller);
	}

	// Used for patch workspaceleaf pinned behaviors
	patchWorkspaceLeaf() {
		this.register(
			around(WorkspaceLeaf.prototype, {
				getRoot(old) {
					return function () {
						const top = old.call(this);
						return top?.getRoot === this.getRoot
							? top
							: top?.getRoot();
					};
				},
				setPinned(old) {
					return function (pinned: boolean) {
						old.call(this, pinned);
						if (isEmebeddedLeaf(this) && !pinned)
							this.setPinned(true);
					};
				},
				openFile(old) {
					return function (file: TFile, openState?: OpenViewState) {
						if (isEmebeddedLeaf(this)) {
							setTimeout(
								around(Workspace.prototype, {
									recordMostRecentOpenedFile(old) {
										return function (_file: TFile) {
											// Don't update the quick switcher's recent list
											if (_file !== file) {
												return old.call(this, _file);
											}
										};
									},
								}),
								1
							);
							const recentFiles =
								this.app.plugins.plugins[
									"recent-files-obsidian"
								];
							if (recentFiles) {
								setTimeout(
									around(recentFiles, {
										shouldAddFile(old) {
											return function (_file: TFile) {
												// Don't update the Recent Files plugin
												return (
													_file !== file &&
													old.call(this, _file)
												);
											};
										},
									}),
									1
								);
							}
						}

						const view = old.call(this, file, openState);
						setTimeout(() => {
							const fsCtnEl = this.parent?.containerEl?.parentElement;
							if (!fsCtnEl?.classList.contains("fs-content"))
								return;
							if (file.extension != "canvas") return;

							const canvas = this.view.canvas;
							setTimeout(() => {
								if (canvas && openState?.eState?.match) {
									let node = canvas.data.nodes?.find(
										(e: any) =>
											e.text ===
											(openState?.eState as any)?.match
												?.content
									);
									if (node) {
										node = canvas.nodes.get(node.id);
										canvas.selectOnly(node);
										canvas.zoomToSelection();
									}
								}
							}, 20);
						}, 1);

						return view;
					};
				},
			})
		);
	}

	patchSearchView() {
		const checkCurrentViewType = (leaf: WorkspaceLeaf) => {
			const isModal =
				document.querySelector(".float-search-modal") !== null;
			const currentLeafRoot = leaf.getRoot();
			if (
				currentLeafRoot?.side &&
				(currentLeafRoot?.side === "left" ||
					currentLeafRoot?.side === "right")
			)
				return "sidebar";
			if (leaf.getContainer()?.type === "window") return "window";
			return isModal ? "modal" : "split";
		};

		const initViewMenu = (
			menu: Menu,
			current: SearchType,
			originLeaf?: WorkspaceLeaf
		) => {
			menu.dom.toggleClass("float-search-view-menu", true);
			const availableViews = allViews.filter((view) => {
				if (current === "split") {
					return view.type !== "tab";
				} else {
					return view.type !== current;
				}
			});
			for (const view of availableViews) {
				menu.addItem((item: MenuItem) => {
					item.setTitle(strings().viewTypeMenu(view.type))
						.setIcon(`${view.icon}`)
						.onClick(async () => {
							if (view.type === "modal") {
								originLeaf?.detach();
								setTimeout(() => {
									this.initModal(this.state, true, false);
								}, 10);
							} else if (view.type === "sidebar") {
								await this.openInLeaf(view.type,
									this.state
								);
							} else {
								if (current === "window") {
									originLeaf?.detach();
									setTimeout(async () => {
										await this.openInLeaf(<"tab" | "split">view.type,
											this.state
										);
									}, 10);
								} else {
									await this.openInLeaf(view.type,
										this.state
									);
								}
							}
							if (current === "modal") {
								this.modal.close();
							} else {
								originLeaf?.detach();
							}
						});
				});
			}
			return menu;
		};

		// `layout-change` can fire again while the first patch is still awaiting
		// a deferred view, so patching must be single-flight.
		let patched = false;
		let patching = false;
		const patchSearch = async () => {
			if (patched) return true;
			if (patching) return false;
			const searchLeaf = this.app.workspace.getLeavesOfType("search")[0];
			if (!searchLeaf) return false;
			patching = true;
			try {
				return await patchSearchViewOf(searchLeaf);
			} finally {
				patching = false;
			}
		};

		const patchSearchViewOf = async (searchLeaf: WorkspaceLeaf) => {
			if (requireApiVersion("1.7.3") && searchLeaf.isDeferred) {
				await searchLeaf.loadIfDeferred();
			}


			const searchView = searchLeaf?.view as any;
			// Keep the plugin receiver across native method wrappers.
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

			if (!searchView) return false;

			const searchViewConstructor = searchView.constructor;

			this.register(
				around(searchViewConstructor.prototype, {
					onOpen(old) {
						return function () {
							old.call(this);

							const viewSwitchEl = createDiv({
								cls: "float-search-view-switch",
							});
							const targetEl = this.filterSectionToggleEl;
							const viewSwitchButton = new ExtraButtonComponent(
								viewSwitchEl
							);
							viewSwitchButton
								.setIcon("layout-template")
								.setTooltip(strings().switchToFileView);
							viewSwitchButton.onClick(() => {
								const currentType = checkCurrentViewType(
									this.leaf
								);
								const layoutMenu = initViewMenu(
									new Menu(),
									currentType,
									this.leaf
								);
								const viewSwitchButtonPos =
									viewSwitchEl.getBoundingClientRect();
								layoutMenu.showAtPosition({
									x: viewSwitchButtonPos.x,
									y: viewSwitchButtonPos.y + 30,
								});
							});
						// Remove any previously inserted switch button first so
						// repeated rebuilds (rebuildView -> onOpen) don't stack
						// multiple copies and bloat the search view DOM.
						targetEl.parentElement
							.querySelector(".float-search-view-switch")
							?.remove();
						targetEl.parentElement.insertBefore(
							viewSwitchEl,
							targetEl
						);
							if (!this.hidePathToggle) {
								this.hidePathToggle = new Setting(
									this.searchParamsContainerEl
								)
									.setName(strings().showFilePath)
									.addToggle((toggle) => {
										toggle.toggleEl.toggleClass(
											"mod-small",
											true
										);
										toggle
											.setValue(
												self.settings.showFilePath
											)
											.onChange(async (value) => {
												self.settings.showFilePath =
													!value;
												self.changeFilePathVisibility();
												self.applySettingsUpdate();
											});
									});
							}
							if (!this.showInstructionsToggle) {
								this.showInstructionsToggle = new Setting(
									this.searchParamsContainerEl
								)
									.setName(strings().showInstructions)
									.addToggle((toggle) => {
										toggle.toggleEl.toggleClass(
											"mod-small",
											true
										);
										toggle
											.setValue(
												self.settings.showInstructions
											)
											.onChange(async (value) => {
												self.settings.showInstructions =
													value;
												self.applySettingsUpdate();
											});
									});
							}
							if (!this.defaultViewTypeDropdown) {
								this.defaultViewTypeDropdown = new Setting(
									this.searchParamsContainerEl
								)
									.setName(strings().defaultViewType)
									.addDropdown((dropdown) => {
										const viewLabels = strings().viewType;
										dropdown.addOptions({
											modal: viewLabels.modal,
											split: viewLabels.split,
											tab: viewLabels.tab,
											window: viewLabels.window,
											sidebar: viewLabels.sidebar,
										});
										dropdown.setValue(
											self.settings.defaultViewType
										);
										dropdown.onChange((value) => {
											self.settings.defaultViewType =
												value as SearchType;
											self.applySettingsUpdate();
										});
									});
							}
						};
					},
					setExplainSearch(old) {
						return function (value: boolean) {
							old.call(this, value);
							self.persistViewState({ explainSearch: value });
						};
					},
					setCollapseAll(old) {
						return function (value: boolean) {
							old.call(this, value);
							self.persistViewState({ collapseAll: value });
						};
					},
					setExtraContext(old) {
						return function (value: boolean) {
							old.call(this, value);
							self.persistViewState({ extraContext: value });
						};
					},
					setMatchingCase(old) {
						return function (value: boolean) {
							old.call(this, value);
							self.persistViewState({ matchingCase: value });
						};
					},
					setSortOrder(old) {
						return function (value: string) {
							old.call(this, value);
							self.persistViewState({ sortOrder: value as SortOrder });
						};
					},
					setQuery(old) {
						return function (value: string) {
							old.call(this, value);
							self.persistViewState({ query: self.stripExclusion(value) });
						};
					},
				setState(old) {
					return function (
						state: any,
						eState: Record<string, unknown>
					) {
						if (
							typeof state.query === "string" &&
							!state?.triggerBySelf
						) {
							if (self.queryLoaded) {
								// Re-route an external query to a Float Search,
								// but guard against re-entrant spawning (which
								// would recurse) and against spawning again for
								// the SAME query (which would otherwise loop
								// endlessly and freeze Obsidian).
								if (
									state.query &&
									!self.routing &&
									!self.isDuplicateRoute(state.query)
								) {
									self.routing = true;
									try {
										void self.openSearch({
											...state,
											query: state.query,
											current: false,
											triggerBySelf: true,
										});
										
									} finally {
										self.routing = false;
									}
								}
								// The Float Search takes over; do NOT apply the
								// query to the native view (matches original
								// behaviour and avoids a second redundant search).
								return;
							}

							self.queryLoaded = true;
						}

						old.call(this, state, eState);
					};
				},
				})
			);
			// Rebuilding replays the view's state through the patched setters; that
			// must not overwrite the saved float-search state.
			this.suppressViewStatePersist = true;
			searchView.leaf?.rebuildView();
			window.setTimeout(() => {
				this.suppressViewStatePersist = false;
			}, 250);
			patched = true;
			return true;
		};
		this.app.workspace.onLayoutReady(async () => {
			if (!(await patchSearch())) {
				const evt = this.app.workspace.on("layout-change", async () => {
					(await patchSearch()) && this.app.workspace.offref(evt);
				});
				this.registerEvent(evt);
			}
		});
	}

	patchVchildren() {
		const patchSearchDom = () => {
			const searchView = this.app.workspace.getLeavesOfType("search")[0]
				?.view as any;
			if (!searchView) return false;

			const dom = searchView.dom.constructor;

			this.register(
				around(dom.prototype, {
					stopLoader(old) {
						return function () {
							old.call(this);
							// console.log(this?.vChildren?.children);
							this?.vChildren?.children?.forEach((child: any) => {
								if (child?.file && !child?.pathEl) {
									const path =
										child?.file.parent?.path || "/";
									const pathEl = createDiv({
										cls: "search-result-file-path",
									});
									const pathIconEl = pathEl.createDiv({
										cls: "search-result-file-path-icon",
									});
									setIcon(pathIconEl, "folder");
									pathEl.createDiv({
										cls: "search-result-file-path-text",
										text: path,
									});
									child.pathEl = pathEl;
									const titleEl = child.containerEl.find(
										".search-result-file-title"
									);
									titleEl.prepend(pathEl);
								}
							});
						};
					},
				})
			);
			return true;
		};
		this.app.workspace.onLayoutReady(() => {
			if (!patchSearchDom()) {
				const evt = this.app.workspace.on("layout-change", () => {
					patchSearchDom() && this.app.workspace.offref(evt);
				});
				this.registerEvent(evt);
			}
		});
	}

	patchDragManager() {
		const manager = this.app.dragManager;
		if (!manager) return;
		// Keep the plugin receiver across native method wrappers.
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

		this.register(
			around(manager.constructor.prototype, {
				dragFile(old: any) {
					return function (e: any, a: TFile) {
						const result = old.call(this, e, a);

						setTimeout(() => {
							self?.modal?.close();
						}, 10);
						return result;
					};
				},
			})
		);
	}

	registerObsidianURIHandler() {
		/**
		* Handles obsidian://fs protocol for search functionality
		*
		* @param viewType - Where to open search:
		*   - "modal" (default) - Opens in modal popup
		*   - "tab" - Opens in new tab
		*   - "split" - Opens in split pane
		*   - "window" - Opens in new window
		*   - "sidebar" - Opens in sidebar
		* @param query - Search query string
		*
		* Examples:
		* obsidian://fs?query=hello&viewType=modal
		* obsidian://fs?query=world&viewType=tab
		* obsidian://fs?query=test (defaults to modal)
		*/
		this.registerObsidianProtocolHandler(
			"fs",
			async (path: ObsidianProtocolData) => {
				const viewType = parseViewType(path.viewType) ?? "modal";
				const query = path.query || "";
				await this.openSearch(
					{ ...this.state, query, current: false },
					viewType
				);
			}
		);
	}

	private createCommand(options: {
		id: string;
		name: string;
		queryBuilder: (file?: TFile) => string;
		global: boolean;
	}): void {
		const open = (query: string) =>
			void this.openSearch({ ...this.state, query, current: true });

		if (options.global) {
			this.addCommand({
				id: options.id,
				name: options.name,
				callback: () => open(options.queryBuilder()),
			});
			return;
		}

		this.addCommand({
			id: options.id,
			name: options.name,
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || (file.extension !== "md" && file.extension !== "canvas")) {
					return false;
				}
				if (!checking) open(options.queryBuilder(file));
				return true;
			},
		});
	}

	registerObsidianCommands() {
		this.addCommand({
			id: "show-or-hide-file-path",
			name: strings().cmdShowHideFilePath,
			callback: () => {
				this.changeFilePathVisibility();
			},
		});

		this.addCommand({
			id: "search-obsidian-globally",
			name: strings().cmdSearchGlobally,
			callback: () =>
				this.initModal(
					{ ...this.state, query: "", current: false },
					false,
					true
				),
		});

		this.addCommand({
			id: "search-obsidian-globally-state",
			name: strings().cmdSearchGloballyState,
			callback: () =>
				this.initModal(
					{ ...this.state, query: this.state.query, current: false },
					true,
					false
				),
		});

		this.createCommand({
			id: "search-in-backlink",
			name: strings().cmdSearchBacklink,
			queryBuilder: (file?: TFile) => {
				if (!file) return "";
				return (
					" /\\[\\[" +
					escapeRegex(file.extension === "canvas" ? file.name : file.basename) +
					"(\\|[^\\]]*)?\\]\\]/"
				);
			},
			global: false,
		});

		this.createCommand({
			id: "search-in-current-file",
			name: strings().cmdSearchCurrentFile,
			queryBuilder: (file?: TFile) => {
				if (!file) return "";
				return " path:" + `"${file.path}"`;
			},
			global: false,
		});

		// Register search operator commands
		this.registerSearchOperatorCommands();

		for (const type of ["split", "tab", "window"] as PaneType[]) {
			this.addCommand({
				id: `open-search-view-${type}`,
				name: strings().cmdOpenSearchView(type),
				callback: async () => {
					const existingLeaf =
						this.app.workspace.getLeavesOfType("search");
					switch (type) {
						case "window": {
							// @ts-ignore
							const isExistingWindowLeaf = existingLeaf.find(
								(leaf) =>
									leaf.parentSplit.parent.type === "window"
							);
							if (isExistingWindowLeaf) {
								this.app.workspace.revealLeaf(
									isExistingWindowLeaf
								);
								return;
							}
							await this.openInLeaf(type, {
								...this.state,
								triggerBySelf: true,
							});
							break;
						}
						case "tab":
						case "split": {
							// @ts-ignore
							const isExistingLeaf = existingLeaf.find(
								(leaf) => !leaf.parentSplit.parent.side
							);
							if (isExistingLeaf) {
								this.app.workspace.revealLeaf(isExistingLeaf);
								isExistingLeaf.setViewState({
									type: "search",
									active: true,
									state: {
										...this.state,
										triggerBySelf: true,
									} as Record<string, unknown>,
								});
								return;
							}
							await this.openInLeaf(type, {
								...this.state,
								triggerBySelf: true,
							});
							break;
						}
					}
				},
			});
		}

		this.syncSavedSearchCommands();
	}

	registerSearchOperatorCommands() {
		const s = strings();
		const searchOperators = [
			{
				id: "search-file-operator",
				name: s.cmdSearchFile,
				query: "file:",
			},
			{
				id: "search-path-operator",
				name: s.cmdSearchPath,
				query: "path:",
			},
			{
				id: "search-content-operator",
				name: s.cmdSearchContent,
				query: "content:",
			},
			{
				id: "search-match-case-operator",
				name: s.cmdSearchMatchCase,
				query: "match-case:",
			},
			{
				id: "search-ignore-case-operator",
				name: s.cmdSearchIgnoreCase,
				query: "ignore-case:",
			},
			{
				id: "search-tag-operator",
				name: s.cmdSearchTag,
				query: "tag:",
			},
			{
				id: "search-line-operator",
				name: s.cmdSearchLine,
				query: "line:",
			},
			{
				id: "search-block-operator",
				name: s.cmdSearchBlock,
				query: "block:",
			},
			{
				id: "search-section-operator",
				name: s.cmdSearchSection,
				query: "section:",
			},
			{
				id: "search-task-operator",
				name: s.cmdSearchTask,
				query: "task:",
			},
			{
				id: "search-task-todo-operator",
				name: s.cmdSearchTaskTodo,
				query: "task-todo:",
			},
			{
				id: "search-task-done-operator",
				name: s.cmdSearchTaskDone,
				query: "task-done:",
			},
			{
				id: "search-property",
				name: s.cmdSearchProperty,
				query: "[]",
			},
		];

		// Register all search operator commands
		searchOperators.forEach((operator) => {
			this.createCommand({
				id: operator.id,
				name: operator.name,
				queryBuilder: () => operator.query || "",
				global: true,
			});
		});
	}

	registerEditorMenuHandler() {
		this.registerEvent(
			this.app.workspace.on(
				"editor-menu",
				(menu: Menu, editor: Editor) => {
					if (!editor) {
						return;
					}
					if (editor.getSelection().length === 0) {
						return;
					}
					const selection = editor.getSelection().trim();
					const searchWord =
						selection.length > 8
							? `${selection.slice(0, 3)}...${selection.slice(-3)}`
							: selection;

					menu.addItem((item) => {
						// Add sub menu
						item.setTitle(strings().menuSearchInFloat(searchWord))
							.setIcon("search")
							.onClick(() =>
								this.initModal(
									{
										...this.state,
										query: selection,
										current: false,
									},
									true,
									false
								)
							);
					});
				}
			)
		);
	}

	registerContextMenuHandler() {
		this.registerEvent(
			this.app.workspace.on(
				"file-menu",
				(
					menu: Menu,
					file: TAbstractFile,
					source: string,
					leaf?: WorkspaceLeaf
				) => {
					const popover = leaf
						? EmbeddedView.forLeaf(leaf)
						: undefined;
					if (file instanceof TFile && !popover && !leaf) {
						menu.addItem((item) => {
							item.setIcon("popup-open")
								.setTitle(strings().menuOpenInFloatPreview)
								.onClick(async () => {
									if (this.modal) {
										await this.modal.initFileView(
											file,
											undefined
										);

										return;
									}

									this.initModal(
										{ ...this.state, current: false },
										true,
										true
									);
									setTimeout(async () => {
										await this.modal.initFileView(
											file,
											undefined
										);
									}, 20);
								})
								.setSection?.("open");
						});
					}
				}
			)
		);
	}

	registerIcons() {
		// Phosphor Bold: app-window + magnifying-glass (MIT)
		// https://phosphoricons.com/  256 viewBox scaled into Obsidian's 100x100 icon slot
		addIcon(
			"float-search-window",
			`<g transform="translate(3 10) scale(0.275)" fill="currentColor"><path d="M216,36H40A20,20,0,0,0,20,56V200a20,20,0,0,0,20,20H216a20,20,0,0,0,20-20V56A20,20,0,0,0,216,36Zm-4,160H44V60H212ZM60,92a16,16,0,1,1,16,16A16,16,0,0,1,60,92Zm48,0a16,16,0,1,1,16,16A16,16,0,0,1,108,92Z"/></g><g transform="translate(38 38) scale(0.24)" fill="currentColor"><path d="M232.49,215.51,185,168a92.12,92.12,0,1,0-17,17l47.53,47.54a12,12,0,0,0,17-17ZM44,112a68,68,0,1,1,68,68A68.07,68.07,0,0,1,44,112Z"/></g>`
		);
		addIcon(
			"panel-left-inactive",
			`<path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 4.999687 3 L 19.000312 3 C 20.104688 3 21 3.895312 21 4.999687 L 21 19.000312 C 21 20.104688 20.104688 21 19.000312 21 L 4.999687 21 C 3.895312 21 3 20.104688 3 19.000312 L 3 4.999687 C 3 3.895312 3.895312 3 4.999687 3 Z M 4.999687 3 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 9 13.999688 L 9 15 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 9 19.000312 L 9 21 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 9 3 L 9 4.999687 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 9 9 L 9 10.000312 " transform="matrix(4.166667,0,0,4.166667,0,0)"/>`
		);
		addIcon(
			"app-window",
			`<path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 4.000312 4.000312 L 19.999688 4.000312 C 21.105 4.000312 22.000312 4.895625 22.000312 6 L 22.000312 18 C 22.000312 19.104375 21.105 19.999688 19.999688 19.999688 L 4.000312 19.999688 C 2.895 19.999688 1.999687 19.104375 1.999687 18 L 1.999687 6 C 1.999687 4.895625 2.895 4.000312 4.000312 4.000312 Z M 4.000312 4.000312 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 10.000312 4.000312 L 10.000312 7.999687 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 1.999687 7.999687 L 22.000312 7.999687 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 6 4.000312 L 6 7.999687 " transform="matrix(4.166667,0,0,4.166667,0,0)"/>`
		);
		addIcon(
			"panel-top",
			`<path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 4.999687 3 L 19.000312 3 C 20.104688 3 21 3.895312 21 4.999687 L 21 19.000312 C 21 20.104688 20.104688 21 19.000312 21 L 4.999687 21 C 3.895312 21 3 20.104688 3 19.000312 L 3 4.999687 C 3 3.895312 3.895312 3 4.999687 3 Z M 4.999687 3 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 3 9 L 21 9 " transform="matrix(4.166667,0,0,4.166667,0,0)"/>`
		);
		addIcon(
			"square-equal",
			`<path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 4.999687 3 L 19.000312 3 C 20.104688 3 21 3.895312 21 4.999687 L 21 19.000312 C 21 20.104688 20.104688 21 19.000312 21 L 4.999687 21 C 3.895312 21 3 20.104688 3 19.000312 L 3 4.999687 C 3 3.895312 3.895312 3 4.999687 3 Z M 4.999687 3 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 7.000312 10.000312 L 16.999688 10.000312 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 7.000312 13.999688 L 16.999688 13.999688 " transform="matrix(4.166667,0,0,4.166667,0,0)"/>`
		);
	}

	async loadSettings() {
		this.settings = sanitizeSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

const triggerKeyOptions = (): Record<CmdkTriggerKey, string> => {
	const s = strings();
	return {
		Shift: s.triggerShift,
		Control: s.triggerControl,
		Alt: s.triggerAlt,
		Meta: s.triggerMeta,
		none: s.triggerNone,
	};
};

type SettingsTabId = "general" | "quick-search" | "quick-create" | "filters";

class NamePromptModal extends Modal {
	private defaultValue: string;
	private result: (value: string | null) => void;

	constructor(
		app: App,
		defaultValue: string,
		result: (value: string | null) => void
	) {
		super(app);
		this.defaultValue = defaultValue;
		this.result = result;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("float-search-prompt");
		contentEl.createEl("h3", { text: strings().saveAsPreset });
		const input = contentEl.createEl("input", {
			type: "text",
			placeholder: strings().presetName,
		});
		input.value = this.defaultValue;
		const row = contentEl.createDiv({ cls: "float-search-prompt-row" });
		const ok = row.createEl("button", { text: strings().save });
		const cancel = row.createEl("button", { text: strings().cancel });

		const submit = () => {
			const v = input.value.trim();
			this.result(v || this.defaultValue);
			this.close();
		};
		ok.onClickEvent(() => submit());
		cancel.onClickEvent(() => {
			this.result(null);
			this.close();
		});
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") submit();
			if (e.key === "Escape") {
				this.result(null);
				this.close();
			}
		});
		setTimeout(() => input.focus(), 0);
	}

	onClose() {
		this.contentEl.empty();
	}
}

function buildPillList(
	container: HTMLElement,
	items: string[],
	onRemove: (index: number) => void
) {
	const wrap = container.createDiv({ cls: "float-search-pill-list" });
	wrap.empty();
	items.forEach((item, i) => {
		const pill = wrap.createDiv({ cls: "float-search-pill" });
		pill.setText(item);
		pill.title = strings().clickToRemove;
		pill.onClickEvent(() => onRemove(i));
	});
	return wrap;
}

function promptForName(
	app: App,
	defaultValue: string
): Promise<string | null> {
	return new Promise((resolve) => {
		new NamePromptModal(app, defaultValue, resolve).open();
	});
}

/**
 * Folder / file picker backed by the official vault API. As the user types,
 * it shows a fuzzy-filtered list of real vault folders or files, so the
 * exact path never has to be typed by hand.
 */
class PathSuggest extends AbstractInputSuggest<TFolder | TFile> {
	constructor(
		app: App,
		private inputEl: HTMLInputElement,
		private kind: "folder" | "file",
		private onPick: (path: string) => void
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): (TFolder | TFile)[] {
		const pool = this.app.vault
			.getAllLoadedFiles()
			.filter((f) =>
				this.kind === "folder"
					? f instanceof TFolder && f.path !== ""
					: f instanceof TFile
			) as (TFolder | TFile)[];
		if (!query) return pool.slice(0, 50);
		const fuzzy = prepareFuzzySearch(query);
		return pool
			.map((f) => ({ f, m: fuzzy(f.path) }))
			.filter((x) => x.m)
			.sort(
				(a, b) =>
					(b.m!.score ?? -Infinity) - (a.m!.score ?? -Infinity)
			)
			.slice(0, 50)
			.map((x) => x.f);
	}

	renderSuggestion(value: TFolder | TFile, el: HTMLElement) {
		el.setText(value.path || "/");
	}

	selectSuggestion(value: TFolder | TFile) {
		this.onPick(value.path);
		this.inputEl.value = "";
		this.close();
	}
}

class FloatSearchSettingTab extends PluginSettingTab {
	plugin: FloatSearchPlugin;
	private activeTab: SettingsTabId = "general";
	// Reference to the saved-search list container so it can be re-rendered
	// in place (preserving the settings scroll position) instead of calling
	// the full display() that rebuilds everything and jumps the scroll.
	private savedListEl?: HTMLElement;

	constructor(app: App, plugin: FloatSearchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		const s = strings();
		containerEl.empty();
		containerEl.addClass("float-search-settings-tab");

		containerEl.createEl("h3", { text: s.settingsTitle });
		containerEl.createEl("p", {
			cls: "float-search-settings-intro",
			text: s.pluginIntro,
		});

		const tabsContainer = containerEl.createDiv({
			cls: "float-search-settings-tabs-container",
		});
		const tabsList: { id: SettingsTabId; name: string }[] = [
			{ id: "general", name: s.tabGeneral },
			{ id: "quick-search", name: s.tabQuickSearch },
			{ id: "quick-create", name: s.tabQuickCreate },
			{ id: "filters", name: strings().tabFilters },
		];
		for (const tab of tabsList) {
			const btn = tabsContainer.createEl("button", { text: tab.name });
			if (this.activeTab === tab.id) btn.addClass("is-active");
			btn.onclick = () => {
				this.activeTab = tab.id;
				this.display();
			};
		}

		const content = containerEl.createDiv({
			cls: "float-search-settings-content",
		});
		if (this.activeTab === "general") this.renderGeneral(content, s);
		else if (this.activeTab === "quick-search")
			this.renderQuickSearch(content, s);
		else if (this.activeTab === "quick-create")
			this.renderQuickCreate(content, s);
		else this.renderFilters(content);
	}

	private renderGeneral(container: HTMLElement, s: ReturnType<typeof strings>) {
		new Setting(container)
			.setName(s.defaultViewType)
			.addDropdown((dropdown) => {
				const viewLabels = s.viewType;
				dropdown.addOptions({
					modal: viewLabels.modal,
					split: viewLabels.split,
					tab: viewLabels.tab,
					window: viewLabels.window,
					sidebar: viewLabels.sidebar,
				});
				dropdown.setValue(this.plugin.settings.defaultViewType);
				dropdown.onChange((value) => {
					this.plugin.settings.defaultViewType = value as SearchType;
					this.plugin.applySettingsUpdate();
				});
			});

		new Setting(container)
			.setName(s.showFilePath)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showFilePath)
					.onChange(async (value) => {
						this.plugin.settings.showFilePath = value;
						this.plugin.updateFilePathVisibility();
						this.plugin.applySettingsUpdate();
					});
			});

		new Setting(container)
			.setName(s.showInstructions)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showInstructions)
					.onChange(async (value) => {
						this.plugin.settings.showInstructions = value;
						this.plugin.applySettingsUpdate();
					});
			});
	}

	private renderQuickSearch(
		container: HTMLElement,
		s: ReturnType<typeof strings>
	) {
		new Setting(container)
			.setName(s.quickSearchTrigger)
			.setDesc(s.quickSearchTriggerDesc)
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(
					triggerKeyOptions()
				)) {
					dropdown.addOption(value, label);
				}
				dropdown.setValue(this.plugin.settings.cmdkTriggerKey);
				dropdown.onChange(async (value) => {
					this.plugin.settings.cmdkTriggerKey =
						value as CmdkTriggerKey;
					await this.plugin.saveSettings();
				});
			});

		new Setting(container)
			.setName(s.doubleTapInterval)
			.setDesc(s.doubleTapIntervalDesc)
			.addSlider((slider) => {
				slider
					.setLimits(150, 600, 50)
					.setValue(this.plugin.settings.cmdkDoubleTapInterval)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.cmdkDoubleTapInterval = value;
						await this.plugin.saveSettings();
					});
			});
	}

	private renderQuickCreate(
		container: HTMLElement,
		s: ReturnType<typeof strings>
	) {
		new Setting(container)
			.setName(s.enableQuickCreate)
			.setDesc(s.enableQuickCreateDesc)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.cmdkQuickCreate)
					.onChange(async (value) => {
						this.plugin.settings.cmdkQuickCreate = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(container)
			.setName(s.quickCreateFolder)
			.setDesc(s.quickCreateFolderDesc)
			.addText((text) => {
				text.setPlaceholder(s.quickCreateFolderPlaceholder)
					.setValue(this.plugin.settings.cmdkQuickCreateFolder)
					.onChange(async (value) => {
						this.plugin.settings.cmdkQuickCreateFolder = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(container)
			.setName(s.titleFormat)
			.setDesc(s.titleFormatDesc)
			.addText((text) => {
				text.setPlaceholder("YYYYMMDDHHmmss")
					.setValue(this.plugin.settings.cmdkQuickCreateTitleFormat)
					.onChange(async (value) => {
						this.plugin.settings.cmdkQuickCreateTitleFormat =
							value;
						await this.plugin.saveSettings();
					});
			});
	}

	private renderFilters(container: HTMLElement) {
		// ── Exclusions ──────────────────────────────────────────────
		container.createEl("h3", { text: strings().exclusions });

		// Exclude folders
		new Setting(container)
			.setName(strings().excludeFolders)
			.setDesc(strings().excludeFoldersDesc)
			.addText((text) => {
				text.setPlaceholder(strings().phTemplates);
				new PathSuggest(
					this.app,
					text.inputEl,
					"folder",
					async (path) => {
						if (
							!this.plugin.settings.excludeFolders.includes(
								path
							)
						) {
							this.plugin.settings.excludeFolders.push(path);
							await this.plugin.saveSettings();
							this.display();
						}
					}
				);
			});
		buildPillList(
			container,
			this.plugin.settings.excludeFolders,
			async (i) => {
				this.plugin.settings.excludeFolders.splice(i, 1);
				await this.plugin.saveSettings();
				this.display();
			}
		);

		// Exclude files
		new Setting(container)
			.setName(strings().excludeFiles)
			.setDesc(strings().excludeFilesDesc)
			.addText((text) => {
				text.setPlaceholder(strings().phSecrets);
				new PathSuggest(
					this.app,
					text.inputEl,
					"file",
					async (path) => {
						if (
							!this.plugin.settings.excludeFiles.includes(
								path
							)
						) {
							this.plugin.settings.excludeFiles.push(path);
							await this.plugin.saveSettings();
							this.display();
						}
					}
				);
			});
		buildPillList(
			container,
			this.plugin.settings.excludeFiles,
			async (i) => {
				this.plugin.settings.excludeFiles.splice(i, 1);
				await this.plugin.saveSettings();
				this.display();
			}
		);

		// ── Saved searches ─────────────────────────────────────────
		container.createEl("h3", { text: strings().savedSearches });

		const addSetting = new Setting(container).setName(
			strings().addSavedSearch
		);
		addSetting.setDesc(strings().addSavedSearchDesc);
		let nameInput: any;
		let queryInput: any;
		addSetting.addText((text) => {
			nameInput = text;
			text.setPlaceholder(strings().namePlaceholder);
		});
		addSetting.addText((text) => {
			queryInput = text;
			text.setPlaceholder(strings().queryPlaceholder);
		});
		addSetting.addButton((button) => {
			button
				.setButtonText(strings().add)
				.setCta()
				.onClick(async () => {
					const name = nameInput?.inputEl.value.trim();
					const query = queryInput?.inputEl.value.trim();
					if (name && query) {
					await this.plugin.addSavedSearch(name, query);
					this.renderSavedList();
					nameInput.inputEl.value = "";
					queryInput.inputEl.value = "";
					}
				});
		});

		// Saved search list (rendered by its own method so it can be
		// refreshed in place without rebuilding the whole settings tab).
		const listEl = container.createDiv({
			cls: "float-search-saved-list",
		});
		this.savedListEl = listEl;
		this.renderSavedList();
	}

	// Re-render only the saved-search list in place. Used after add / edit /
	// delete so the settings tab scroll position is preserved (calling the
	// full display() rebuilds everything and jumps the scroll to the top).
	private renderSavedList() {
		const listEl = this.savedListEl;
		if (!listEl) return;
		listEl.empty();
		this.plugin.settings.savedSearches.forEach((s, i) => {
			const row = listEl.createDiv({
				cls: "float-search-saved-row",
			});
			const label = row.createDiv({
				cls: "float-search-saved-label",
			});
			label.createSpan({ cls: "float-search-saved-name" }).setText(
				s.name
			);
			label.createSpan({
				cls: "float-search-saved-query",
			}).setText(s.query);

			// Action buttons (grouped, right-aligned)
			const actions = row.createDiv({
				cls: "float-search-saved-actions",
			});
			const edit = actions.createEl("button", {
				text: strings().edit,
				cls: "float-search-saved-edit",
			});
			const del = actions.createEl("button", {
				text: strings().delete,
				cls: "float-search-saved-delete",
			});

			edit.onClickEvent(() => {
				// Turn the row into inline editable fields.
				row.empty();
				row.addClass("is-editing");
				const nameField = row.createEl("input", {
					cls: "float-search-saved-input",
					type: "text",
				});
				nameField.value = s.name;
				nameField.placeholder = strings().namePlaceholder;
				const queryField = row.createEl("input", {
					cls: "float-search-saved-input",
					type: "text",
				});
				queryField.value = s.query;
				queryField.placeholder = strings().queryPlaceholder;
				const saveBtn = row.createEl("button", {
					text: strings().save,
					cls: "float-search-saved-save",
				});
				const cancelBtn = row.createEl("button", {
					text: strings().cancel,
					cls: "float-search-saved-cancel",
				});
				nameField.focus();
				const commit = async () => {
					const newName = nameField.value.trim();
					const newQuery = queryField.value.trim();
					if (newName && newQuery) {
						this.plugin.settings.savedSearches[i] = {
							id: s.id,
							name: newName,
							query: newQuery,
						};
						await this.plugin.saveSettings();
						this.plugin.syncSavedSearchCommands();
						this.renderSavedList();
					}
				};
				saveBtn.onClickEvent(() => commit());
				queryField.addEventListener("keydown", (e) => {
					if (e.key === "Enter") commit();
					if (e.key === "Escape") this.renderSavedList();
				});
				cancelBtn.onClickEvent(() => this.renderSavedList());
			});

			del.onClickEvent(async () => {
				this.plugin.settings.savedSearches.splice(i, 1);
				await this.plugin.saveSettings();
				this.plugin.syncSavedSearchCommands();
				this.renderSavedList();
			});
		});
		if (this.plugin.settings.savedSearches.length === 0) {
			listEl.createDiv({
				cls: "float-search-saved-empty",
				text: strings().noSavedSearches,
			});
		}
	}
}

function createInstructionElement(
	parentEl: HTMLElement,
	divCls: string,
	keyText: string,
	text: string
) {
	const divEl = parentEl.createDiv({ cls: divCls });
	const iconEl = divEl.createSpan({
		cls: "float-search-modal-instructions-key",
	});
	const textEl = divEl.createSpan({
		cls: "float-search-modal-instructions-text",
	});

	iconEl.setText(keyText);
	textEl.setText(text);

	return { divEl, iconEl, textEl };
}

class FloatSearchModal extends Modal {
	private readonly plugin: FloatSearchPlugin;
	private searchEmbeddedView: EmbeddedView;
	private fileEmbeddedView: EmbeddedView | undefined;

	searchLeaf: WorkspaceLeaf;
	fileLeaf: WorkspaceLeaf | undefined;

	private cb: (state: any) => void;
	private state: any;

	private fileState: any;

	private searchCtnEl: HTMLElement;
	private unwatchFilters: (() => void) | null = null;
	private unbindNativeQuery: (() => void) | null = null;
	private instructionsEl: HTMLElement;
	private fileEl: HTMLElement;
	private viewType: string;

	private focusdItem: any;
	private closed = false;
	private readonly previews = new LatestQueue();
	private inputCleanup: (() => void) | null = null;

	private debouncedAutoPreview = debounce(() => {
		this.autoPreviewFocusedItem();
	}, 150);

	constructor(
		cb: (state: any) => void,
		plugin: FloatSearchPlugin,
		state: any,
		viewType = "search"
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.cb = cb;
		this.state = state;
		this.viewType = viewType;
	}

	async onOpen() {
		this.closed = false;
		const { contentEl, containerEl, modalEl } = this;

		this.searchCtnEl = contentEl.createDiv({
			cls: "float-search-modal-search-ctn",
		});
		this.instructionsEl = modalEl.createDiv({
			cls: "float-search-modal-instructions",
		});

		this.initInstructions(this.instructionsEl);
		this.initCss(contentEl, modalEl, containerEl);
		await this.initSearchView(this.searchCtnEl);
		if (this.closed) {
			this.searchLeaf?.detach();
			return;
		}
		this.initFilterBar();
		this.initInput();
		this.initContent();
	}

	onClose() {
		this.closed = true;
		this.debouncedAutoPreview.cancel();
		this.inputCleanup?.();
		this.inputCleanup = null;
		this.clearPreview();
		const { contentEl } = this;
		this.unwatchFilters?.();
		this.unwatchFilters = null;
		this.unbindNativeQuery?.();
		this.unbindNativeQuery = null;

		if (this.searchLeaf) {
			const st = this.searchLeaf.view.getState();
			st.query = this.plugin.stripExclusion(st.query as string);
			this.cb(st);
		}

		this.searchLeaf?.detach();
		this.fileLeaf?.detach();
		this.searchEmbeddedView?.unload();
		this.fileEmbeddedView?.unload();
		contentEl.empty();
	}

	initInstructions(instructionsEl: HTMLElement) {
		if (!this.plugin.settings.showInstructions) {
			return;
		}
		const s = strings();
		createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-navigate",
			"↑↓",
			s.instrNavigate
		);
		createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-collapse",
			"Shift+↑↓",
			s.instrCollapse
		);
		createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-enter",
			"↵",
			s.instrOpenBackground
		);
		createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-alt-enter",
			"Alt+↵",
			s.instrOpenAndClose
		);
		createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-ctrl-enter",
			"Ctrl+↵",
			s.instrCreateIfMissing
		);
		createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-tab",
			"Tab/Shift+Tab",
			s.instrPreview
		);
		createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-switch",
			"Ctrl+G",
			s.instrSwitchView
		);
		createInstructionElement(
			instructionsEl,
			"float-search-modal-instructions-click",
			"Alt+Click",
			s.instrAltClick
		);
	}

	initCss(
		contentEl: HTMLElement,
		modalEl: HTMLElement,
		containerEl: HTMLElement
	) {
		contentEl.classList.add("float-search-modal-content");
		modalEl.classList.add("float-search-modal");
		containerEl.classList.add("float-search-modal-container");
	}

	async initSearchView(contentEl: HTMLElement) {
		const [createdLeaf, embeddedView] = spawnLeafView(
			this.plugin,
			contentEl
		);
		this.searchLeaf = createdLeaf;
		this.searchEmbeddedView = embeddedView;

		this.searchLeaf.setPinned(true);
		const initialQuery = this.plugin.withExclusion(this.state.query ?? "");
		const initialState = {
			...this.state,
			query: initialQuery,
			matchingCase: this.plugin.settings.filterMatchCase,
		};
		await this.searchLeaf.setViewState({
			type: "search",
			state: { ...initialState, triggerBySelf: true },
		});

		window.setTimeout(async () => {
			if (this.closed) return;
			// The view re-applies the saved state once it has settled, but never
			// over text the user already typed.
			const typed = (this.searchLeaf.view as SearchView).searchComponent?.inputEl?.value;
			if (!typed || typed === initialQuery) {
				await this.searchLeaf.view.setState(
					{ ...initialState, triggerBySelf: true },
					{ history: false }
				);
			}
			if (this.closed) return;
			const searchComponent = (this.searchLeaf.view as SearchView)
				.searchComponent;
			if (searchComponent?.inputEl) {
				this.state?.current
					? searchComponent.inputEl.setSelectionRange(0, 0)
					: searchComponent.inputEl.setSelectionRange(
							0,
							this.state?.query?.length
					);
			}
		}, 0);

		return;
	}

	private initFilterBar() {
		const searchRow = this.searchCtnEl.querySelector(".search-row");
		if (searchRow) {
			mountFilterBar(searchRow as HTMLElement, this.plugin, () =>
				this.onFilterChange()
			);
		}
		const view = this.searchLeaf.view as SearchView;
		this.unbindNativeQuery = bindNativeRegexSearch(view, this.plugin, () => {
			this.debouncedAutoPreview.cancel();
			this.clearPreview();
		});
		this.syncNativeMatchCase(view);
		(view as SearchView & { startSearch?: () => void }).startSearch?.();
		this.unwatchFilters = watchNativeSearchResults(view, this.plugin);
	}

	private onFilterChange() {
		this.clearPreview();
		const view = this.searchLeaf.view as SearchView;
		this.syncNativeMatchCase(view);
		(view as SearchView & { startSearch?: () => void }).startSearch?.();
		applyNativeResultFilters(view, this.plugin);
	}

	private syncNativeMatchCase(view: SearchView) {
		const state = view.getState();
		if (state.matchingCase === this.plugin.settings.filterMatchCase) return;
		const target = view as SearchView & { setMatchingCase?: (value: boolean) => void };
		if (typeof target.setMatchingCase === "function") {
			target.setMatchingCase(this.plugin.settings.filterMatchCase);
			return;
		}
		if (state.matchingCase !== this.plugin.settings.filterMatchCase) {
			view.setState({
				...state,
				matchingCase: this.plugin.settings.filterMatchCase,
				triggerBySelf: true,
			}, { history: false });
		}
	}

	initInput(retries = 10) {
		if (this.closed) return;
		const inputEl = this.contentEl.getElementsByTagName("input")[0];
		if (!inputEl) {
			if (retries > 0) {
				setTimeout(() => this.initInput(retries - 1), 50);
			}
			return;
		}
		const clear = () => {
			this.debouncedAutoPreview.cancel();
			this.clearPreview();
		};
		inputEl.addEventListener("input", clear);
		this.inputCleanup = () => {
			inputEl.removeEventListener("input", clear);
			inputEl.onkeydown = null;
		};
		inputEl.focus();
		inputEl.onkeydown = (e) => {
			if (e.isComposing || e.key === "Process" || e.keyCode === 229) {
				return;
			}
			const currentView = this.searchLeaf.view as SearchView;
			switch (e.key) {
				case "ArrowDown":
				case "n":
					if (e.key === "n" && !e.ctrlKey) break;
					if (e.key === "n") e.preventDefault();

					if (e.shiftKey) {
						currentView.onKeyShowMoreAfter(e);
						if (currentView.dom.focusedItem) {
							if (currentView.dom.focusedItem.collapsible) {
								currentView.dom.focusedItem.setCollapse(false);
							}
							this.focusdItem = currentView.dom.focusedItem;
						}
					} else {
						currentView.onKeyArrowDownInFocus(e);
						this.focusdItem = currentView.dom.focusedItem;
						this.debouncedAutoPreview();
					}
					break;
				case "ArrowUp":
				case "p":
					if (e.key === "p" && !e.ctrlKey) break;
					if (e.key === "p") e.preventDefault();

					if (e.shiftKey) {
						currentView.onKeyShowMoreBefore(e);
						if (currentView.dom.focusedItem) {
							if (currentView.dom.focusedItem.collapseEl) {
								currentView.dom.focusedItem.setCollapse(true);
							}
							this.focusdItem = currentView.dom.focusedItem;
						}
					} else {
						currentView.onKeyArrowUpInFocus(e);
						this.focusdItem = currentView.dom.focusedItem;
						if (!currentView.dom.focusedItem?.content) {
							this.focusdItem = undefined;
						}
						this.debouncedAutoPreview();
					}
					break;
				case "ArrowLeft":
					currentView.onKeyArrowLeftInFocus(e);
					break;
				case "ArrowRight":
					currentView.onKeyArrowRightInFocus(e);
					break;
				case "Enter":
					if (
						Keymap.isModifier(e, "Mod") &&
						Keymap.isModifier(e, "Shift") &&
						!this.focusdItem
					) {
						e.preventDefault();
						const fileName = inputEl.value.trim();
						const real = fileName.replace(/[/\\?%*:|"<>]/g, "-");
						this.plugin.app.workspace.openLinkText(real, "", true);
						this.close();
						break;
					}
					currentView.onKeyEnterInFocus(e);
					if (e.altKey && currentView.dom.focusedItem) {
						this.close();
					}
					break;
				case "Tab":
					e.preventDefault();
					if (e.shiftKey) {
						if (this.fileLeaf) {
							this.fileLeaf?.detach();
							this.fileLeaf = undefined;
							this.fileEmbeddedView?.unload();
							this.modalEl.toggleClass(
								"float-search-width",
								false
							);
							this.fileEl.detach();

							break;
						}
					}

					if (currentView.dom.focusedItem) {
						const item = currentView.dom.focusedItem;
						const file =
							item.parent.file instanceof TFile
								? item.parent.file
								: item.file;

						item.parent.file instanceof TFile
							? this.initFileView(file, {
									match: {
										content: item.content,
										matches: item.matches,
									},
							})
							: this.initFileView(file, undefined);
					}
					break;
				case "e":
					if (e.ctrlKey) {
						e.preventDefault();
						if (this.fileLeaf) {
							const estate = this.fileLeaf.getViewState();
							estate.state = {
								...estate.state,
								mode:
									"preview" === estate.state?.mode
										? "source"
										: "preview",
							};
							this.fileLeaf.setViewState(estate, {
								focus: true,
							});
							setTimeout(() => {
								(
									this.searchLeaf.view as SearchView
								).searchComponent?.inputEl?.focus();
							}, 0);
						}
					}
					break;
				case "g":
					if (this.fileLeaf && e.ctrlKey) {
						e.preventDefault();
						this.plugin.app.workspace.setActiveLeaf(this.fileLeaf, {
							focus: true,
						});
					}
					break;
				case "C":
					if (e.ctrlKey && e.shiftKey) {
						e.preventDefault();
						const text = currentView.dom.focusedItem.el.innerText;
						navigator.clipboard.writeText(text);
					}
					break;
			}
		};
	}

	private autoPreviewFocusedItem() {
		if (this.closed) return;
		const currentView = this.searchLeaf.view as SearchView;
		const item = currentView.dom?.focusedItem;
		if (!item) {
			this.clearPreview();
			return;
		}

		const file =
			item.parent?.file instanceof TFile
				? item.parent.file
				: item.file;
		if (!(file instanceof TFile)) return;

		const state =
			item.parent?.file instanceof TFile
				? {
						match: {
							content: item.content,
							matches: item.matches,
						},
				}
				: undefined;

		this.initFileView(file, state);
	}

	initContent() {
		const { contentEl } = this;
		contentEl.onclick = (e) => {
			const resultElement = contentEl.getElementsByClassName(
				"search-results-children"
			)[0];
			if (!resultElement || resultElement.children.length < 2) {
				return;
			}

			let targetElement = e.target as HTMLElement | null;

			if (e.altKey || !this.fileLeaf) {
				while (targetElement) {
					if (targetElement.classList.contains("tree-item-icon")) {
						break;
					}
					if (
						targetElement.classList.contains(
							"search-result-hover-button"
						)
					) {
						break;
					}
					if (targetElement.classList.contains("tree-item")) {
						this.close();
						break;
					}
					targetElement = targetElement.parentElement;
				}
				return;
			}

			if (this.fileLeaf) {
				const currentView = this.searchLeaf.view as SearchView;

				if (
					(this.searchCtnEl as Node).contains(targetElement as Node)
				) {
					while (targetElement) {
						if (targetElement.classList.contains("tree-item")) {
							break;
						}
						targetElement = targetElement.parentElement;
					}
					if (!targetElement) return;

					const fileInnerEl = targetElement?.getElementsByClassName(
						"tree-item-inner"
					)[0] as HTMLElement;
					const innerText = fileInnerEl.innerText;
					const file =
						this.plugin.app.metadataCache.getFirstLinkpathDest(
							innerText,
							""
						);

					if (file) {
						const item = currentView.dom.resultDomLookup.get(file);
						currentView.dom.setFocusedItem(item);
						this.initFileView(file, undefined);
						(
							this.searchLeaf.view as SearchView
						).searchComponent?.inputEl?.focus();
					}
				}

				return;
			}
		};
	}

	private clearPreview() {
		this.previews.invalidate();
		this.focusdItem = undefined;
		this.fileState = undefined;
		this.fileLeaf?.detach();
		this.fileEmbeddedView?.unload();
		this.fileLeaf = undefined;
		this.fileEmbeddedView = undefined;
		this.fileEl?.remove();
		this.modalEl.removeClass("float-search-width");
	}

	async initFileView(file: TFile, state: any) {
		if (this.closed) return;
		await this.previews.run(async (isCurrent) => {
			if (this.closed) return;
			await this.renderFileView(file, state, isCurrent);
		});
	}

	private async renderFileView(file: TFile, state: any, isCurrent: () => boolean) {
		if (this.fileLeaf) {
			await this.fileLeaf.openFile(file, {
				active: false,
				eState: state,
			});
			if (this.closed || !isCurrent()) return;

			if (
				this.fileState?.match?.matches[0] ===
					state?.match?.matches[0] &&
				state &&
				this.fileState
			) {
				setTimeout(() => {
					if (!this.closed && isCurrent() && this.fileLeaf) {
						this.plugin.app.workspace.setActiveLeaf(this.fileLeaf, {
							focus: true,
						});
					}
				}, 0);
			} else {
				this.fileState = state;
				setTimeout(() => {
					if (this.closed || !isCurrent()) return;
					(
						this.searchLeaf.view as SearchView
					).searchComponent?.inputEl?.focus();
				}, 0);
			}

			return;
		}

		const { contentEl } = this;
		this.fileEl = contentEl.createDiv({
			cls: "float-search-modal-file-ctn",
		});
		this.modalEl.toggleClass("float-search-width", true);
		this.fileEl.onkeydown = (e) => {
			if (e.ctrlKey && e.key === "g") {
				e.preventDefault();
				e.stopPropagation();

				(
					this.searchLeaf.view as SearchView
				).searchComponent?.inputEl?.focus();
			}

			if (e.key === "Tab" && e.ctrlKey) {
				e.preventDefault();
				e.stopPropagation();

				(
					this.searchLeaf.view as SearchView
				).searchComponent?.inputEl?.focus();
			}
		};

		if (!this.fileEl) return;

		const [createdLeaf, embeddedView] = spawnLeafView(
			this.plugin,
			this.fileEl
		);
		this.fileLeaf = createdLeaf;
		this.fileEmbeddedView = embeddedView;

		this.fileLeaf.setPinned(true);
		await this.fileLeaf.openFile(file, {
			active: false,
			eState: state,
		});
		if (this.closed || !isCurrent()) return;
		this.fileState = state;

		(this.searchLeaf.view as SearchView).searchComponent?.inputEl?.focus();
	}
}

class FloatSearchCmdkModal extends SuggestModal<CmdkResult> {
	plugin: FloatSearchPlugin;
	private bodyEl: HTMLElement;
	private isComposing = false;
	private previewEl: HTMLElement | undefined;
	private fileLeaf: WorkspaceLeaf | undefined;
	private fileEmbeddedView: EmbeddedView | undefined;
	private searchAbort: AbortController | null = null;
	private readonly compositionStart = () => { this.isComposing = true; };
	private readonly compositionEnd = () => {
		this.isComposing = false;
		this.updateSuggestions();
	};
	private closed = false;
	private readonly previews = new LatestQueue();
	private debouncedUpdate = debounce(() => this.runSearch(), 150);
	private activeFilters: string[] = [];
	private filterMatchSets: Map<string, Set<string>> | null = null;
	private searchFilter: SearchFilter;
	private liveQuery: Query = { groups: [] };
	private liveHasContent = false;
	private filterBarEl: HTMLElement;
	// Candidate ③: the scanned + exclusion-filtered candidate file set, built
	// once and reused across keystrokes (invalidated on vault changes).
	private candidateFiles: TFile[] | null = null;
	private vaultHandlers: Array<[string, () => void]> = [];
	// Candidate ⑥: file paths that already passed the metadata pre-filter in
	// runSearch, so the heading phase need not re-evaluate them.
	private passedMeta: Set<string> | null = null;

	constructor(plugin: FloatSearchPlugin, initialFilters?: string[]) {
		super(plugin.app);
		this.plugin = plugin;
		this.limit = 50;
		const s = strings();
		this.setPlaceholder(s.cmdkPlaceholder);
		this.searchFilter = new SearchFilter(this.app);
		this.activeFilters = initialFilters ? [...initialFilters] : [];
		this.setInstructions([
			{ command: "↑↓", purpose: s.cmdkNavigate },
			{ command: "↵", purpose: s.cmdkOpen },
			{ command: "Shift ↵", purpose: s.cmdkNewTab },
			{ command: "esc", purpose: s.cmdkClose },
		]);
		this.modalEl.addClass("float-search-cmdk");
		this.containerEl.addClass("float-search-cmdk-container");
	}

	onOpen() {
		this.closed = false;
		super.onOpen();
		this.isComposing = false;
		this.inputEl.addEventListener("compositionstart", this.compositionStart);
		this.inputEl.addEventListener("compositionend", this.compositionEnd);
		// Candidate ③: invalidate the cached candidate file set whenever the
		// vault changes, so the next search rebuilds it lazily.
		const invalidate = () => {
			this.candidateFiles = null;
		};
		for (const ev of ["create", "modify", "rename", "delete"] as const) {
			const h = invalidate;
			(this.app.vault as any).on(ev, h);
			this.vaultHandlers.push([ev, h]);
		}
		this.bodyEl = createDiv("float-search-cmdk-body");
		this.modalEl.insertBefore(
			this.bodyEl,
			(this as any).resultContainerEl
		);
		this.bodyEl.appendChild((this as any).resultContainerEl);
		const inputWrap = this.inputEl.closest(
			".prompt-input-container"
		) as HTMLElement | null;
		if (inputWrap) {
			mountFilterBar(inputWrap, this.plugin, () =>
				this.updateSuggestions()
			);
		}

		// Render filter chip bar as its own horizontal row, above the results body
		this.filterBarEl = this.modalEl.createDiv({
			cls: "float-search-filter-bar",
		});
		this.modalEl.insertBefore(this.filterBarEl, this.bodyEl);
		this.renderFilterBar();

		// If the modal was opened with presets pre-selected (e.g. via the
		// saved-search command), filter the list immediately.
		if (this.activeFilters.length > 0) {
			this.runSearch();
		}
	}

	// Required by SuggestModal but unused — we drive the chooser directly
	getSuggestions(_query: string): CmdkResult[] {
		return [];
	}

  // Override to use progressive rendering via chooser.addSuggestion
  updateSuggestions() {
    if (this.closed || this.isComposing) return;
		this.onSelectedChange.cancel();
		this.hidePreview();
		this.debouncedUpdate();
  }

  // ── Filter bar ─────────────────────────────────────────────────────
  private renderFilterBar() {
    this.filterBarEl.empty();
    const buttons = this.plugin.settings.savedSearches;
    if (buttons.length === 0) {
      this.filterBarEl.style.display = "none";
      return;
    }
    this.filterBarEl.style.display = "";

    for (const fb of buttons) {
      const chip = this.filterBarEl.createDiv({
        cls: "float-search-filter-chip",
        text: fb.name,
      });
      if (this.activeFilters.includes(fb.query)) {
        chip.addClass("is-active");
      }
      chip.onClickEvent(() => {
        // Single-select (mutually exclusive): clicking the active chip
        // clears it; clicking another chip replaces the previous selection.
        if (this.activeFilters.includes(fb.query)) {
          this.activeFilters = [];
        } else {
          this.activeFilters = [fb.query];
        }
        this.renderFilterBar();
        this.runSearch();
      });
    }
  }

  private matchesFilters(file: TFile): boolean {
    if (this.activeFilters.length === 0) return true;
    return this.activeFilters.every((f) =>
      this.filterMatchSets?.get(f)?.has(file.path) ?? false
    );
  }

  // Candidate ③: build the scanned + exclusion-filtered candidate file set
  // once, normalising the exclusion lists a single time (not per file), and
  // reuse it across keystrokes. Rebuilt lazily after any vault change.
  private getCandidateFiles(): TFile[] {
    if (this.candidateFiles) return this.candidateFiles;
    const isExcluded = createExclusionMatcher(this.plugin.settings);
    const exts = new Set(["md", "canvas", "pdf", "base"]);
    this.candidateFiles = this.app.vault
      .getFiles()
      .filter((f: TFile) => exts.has(f.extension) && !isExcluded(f.path));
    return this.candidateFiles;
  }

  // Precompute, for each active filter query, the set of file paths that
  // match. Delegates to SearchFilter, the single source of truth for all
  // filter matching (tag / path / folder / property / text, with AND across
  // clauses and nested-tag support matching native search).
  private prepareFilterMatchSets(files: TFile[]) {
    this.filterMatchSets = this.searchFilter.buildMatchSets(
      files,
      this.activeFilters
    );
  }

	private runSearch() {
		// Cancel previous in-flight search
		this.searchAbort?.abort();
		const abort = (this.searchAbort = new AbortController());
		const { signal } = abort;
		this.passedMeta = null;

    const chooser = (this as any).chooser;
    const rawInput = this.inputEl.value;
    const trimmed = rawInput.trim();

		// Candidate ③: reuse the cached, exclusion-filtered candidate set
		// instead of re-scanning + re-normalising exclusions on every keystroke.
		const bookmarks = this.plugin.settings.filterStarredOnly
			? getBookmarkedPaths(this.app)
			: null;
		const files = this.getCandidateFiles().filter((f: TFile) =>
			isFileAllowed(this.plugin, f, bookmarks)
		);

		// Precompute filter match sets before filtering
		if (this.activeFilters.length > 0) {
			this.prepareFilterMatchSets(files);
		} else {
			this.filterMatchSets = null;
		}

		// "Save current query" chip (shown when a query is typed and not yet saved)
		const extra: CmdkResult[] = [];
		if (
			trimmed &&
			!this.plugin.settings.savedSearches.some(
				(s) => s.query.trim() === trimmed
			)
		) {
			extra.push({ type: "save" });
		}

		// Empty query — show launcher (saved) + recent files, filtered by active chips
		if (!trimmed) {
			const recent = files
				.sort((a: TFile, b: TFile) => b.stat.mtime - a.stat.mtime)
				.filter((f: TFile) => this.matchesFilters(f))
				.slice(0, this.limit)
				.map((file: TFile) => ({
					file,
					nameMatch: null,
					pathMatch: null,
					type: "file" as const,
				}));
			chooser.setSuggestions([...extra, ...recent]);
			return;
		}

		// Parse the live query with the FULL Obsidian Query syntax
		// (tag:/path:/folder:/file:/property:/[key::value] plus line:/block:/
		// section:/content:/task:, -exclusion, "quoted phrases", OR grouping).
		// Metadata clauses are applied synchronously; content clauses
		// (line/block/section/content/task) are evaluated in the async
		// content phase so we don't read every file body on each keystroke.
		const query = parseQuery(trimmed);
		this.liveQuery = query;
		this.liveHasContent = requiresContent(query);
		const pureText = isPlainText(query);
		const fuzzyText = freeText(query);
		const fuzzy = fuzzyText
			? (text: string) =>
					matchAsSearchResult(this.plugin, text, fuzzyText)
			: null;

		const fileResults: FileResult[] = [];

		// When the query needs file bodies (content operators), the file list
		// is produced by the async content phase to avoid false positives.
		if (!this.liveHasContent) {
			// Candidate ⑥: remember which files passed the metadata pre-filter
			// so the (later, batched) heading phase can reuse it instead of
			// re-evaluating matchMetadata per file.
			this.passedMeta = new Set<string>();
			for (const file of files) {
				// Active chips (presets) always apply
				if (!this.matchesFilters(file)) continue;
				// Live metadata clauses (tag/path/folder/name/property) apply
				if (!this.searchFilter.matchMetadata(file, query)) continue;
				this.passedMeta.add(file.path);
				const nameMatch = fuzzy ? fuzzy(file.basename) : null;
				const pathMatch = fuzzy ? fuzzy(file.path) : null;
				// Text requirement only applies when there is plain text
				if (fuzzy && !nameMatch && !pathMatch) continue;
				fileResults.push({
					file,
					nameMatch,
					pathMatch,
					type: "file",
				});
			}
		}

		fileResults.sort((a, b) => {
			const sa = Math.max(
				a.nameMatch?.score ?? -Infinity,
				(a.pathMatch?.score ?? -Infinity) * 0.5
			);
			const sb = Math.max(
				b.nameMatch?.score ?? -Infinity,
				(b.pathMatch?.score ?? -Infinity) * 0.5
			);
			return (
				sb - sa || a.file.basename.localeCompare(b.file.basename)
			);
		});

		// Check if there is an exact name match (for quick-create gating)
		const queryLower = trimmed.toLowerCase();
		const hasExactMatch = fileResults.some(
			(r) => r.file.basename.toLowerCase() === queryLower
		);

		const resultsToShow: CmdkResult[] = fileResults
			.filter((r) => this.matchesFilters(r.file))
			.slice(0, this.limit);

		// Append "quick create" option when enabled and no exact match
		if (
			this.plugin.settings.cmdkQuickCreate &&
			!hasExactMatch &&
			pureText &&
			trimmed.length > 0
		) {
			resultsToShow.push({ type: "create", createQuery: trimmed });
		}

		// Render file results immediately
		chooser.setSuggestions([...extra, ...resultsToShow]);

		// Phase 2: heading search — progressive, batched via setTimeout.
		// Headings can't be checked against content operators, so skip this
		// phase when the query needs file bodies.
		if (trimmed.length >= 2) {
			if (fuzzy && !this.liveHasContent)
				this.progressiveHeadingSearch(files, fuzzy, chooser, signal);

			// Phase 3: content search — progressive, async (reads file content)
			this.progressiveContentSearch(files, query, chooser, signal);
		}
	}

	private progressiveHeadingSearch(
		files: TFile[],
		fuzzy: (text: string) => SearchResult | null,
		chooser: any,
		signal: AbortSignal
	) {
		const BATCH_SIZE = 50; // files per tick
		let idx = 0;
		let added = 0;
		const MAX_HEADING_RESULTS = 20;

		const processBatch = () => {
			if (signal.aborted || this.closed) return;

			const end = Math.min(idx + BATCH_SIZE, files.length);
			for (; idx < end; idx++) {
				if (added >= MAX_HEADING_RESULTS) return;
				const file = files[idx];
				const cache =
					this.app.metadataCache.getFileCache(file);
				if (!cache?.headings) continue;

				for (const h of cache.headings) {
					const headingMatch = fuzzy(h.heading);
					if (
						headingMatch &&
						this.matchesFilters(file) &&
						// Candidate ⑥: reuse the precomputed pass-set instead of
						// re-running matchMetadata on every heading check.
						(this.passedMeta?.has(file.path) ??
							this.searchFilter.matchMetadata(file, this.liveQuery))
					) {
						chooser.addSuggestion({
							file,
							nameMatch: null,
							pathMatch: null,
							heading: h.heading,
							headingMatch,
							type: "heading",
						});
							added++;
							if (added >= MAX_HEADING_RESULTS) return;
						}
					}
				}

			// More files to process — yield to event loop
			if (idx < files.length && added < MAX_HEADING_RESULTS) {
				setTimeout(processBatch, 0);
			}
		};

		// Start first batch on next microtask so file results render first
		setTimeout(processBatch, 0);
	}

	private progressiveContentSearch(
		files: TFile[],
		query: Query,
		chooser: any,
		signal: AbortSignal
	) {
		const BATCH_SIZE = 50;
		const MAX_CONTENT_RESULTS = 20;
		const DURATION_LIMIT = 5; // ms before yielding

		const contentMode = this.liveHasContent;
		// Fuzzy-text mode: a plain free-text search across file bodies.
		const fuzzyText = contentMode ? "" : freeText(query);
		const simpleSearch =
			!contentMode && fuzzyText
				? (text: string) =>
						matchAsSearchResult(this.plugin, text, fuzzyText)
				: null;
		if (!contentMode && !simpleSearch) return;
		if (contentMode && query.groups.length === 0) return;

		let idx = 0;
		let added = 0;

		const processBatch = async () => {
			if (signal.aborted) return;
			const start = performance.now();

			for (; idx < files.length; idx++) {
				if (signal.aborted || added >= MAX_CONTENT_RESULTS) return;

				// Adaptive yielding: check time every BATCH_SIZE items
				if (idx % BATCH_SIZE === 0 && idx > 0) {
					if (performance.now() - start > DURATION_LIMIT) {
						setTimeout(processBatch, 0);
						return;
					}
				}

				const file = files[idx];
				if (file.extension !== "md") continue;

				// Fast metadata pre-filter (no file read needed).
				if (!this.searchFilter.matchMetadata(file, query)) continue;
				if (!contentMode && !this.matchesFilters(file)) continue;

				let text: string;
				try {
					text = await this.plugin.readContent(file);
				} catch {
					continue;
				}

				if (signal.aborted || this.closed) return;
				if (contentMode) {
					// Full query evaluation including content operators.
					if (!this.searchFilter.matchContent(file, text, query))
						continue;
					const lineInfo = this.firstMatchLine(text, query);
					chooser.addSuggestion({
						file,
						nameMatch: null,
						pathMatch: null,
						content: lineInfo.text,
						contentMatch: null,
						line: lineInfo.line,
						type: "content",
					});
					added++;
					if (added >= MAX_CONTENT_RESULTS) return;
					continue;
				}

				const result = simpleSearch!(text);
				if (!result) continue;

				// Compute line number and context from first match offset
				const matchStart = result.matches[0][0];
				let line = 0;
				let lineStart = 0;
				for (let i = 0; i < matchStart; i++) {
					if (text.charCodeAt(i) === 10) {
						line++;
						lineStart = i + 1;
					}
				}
				let lineEnd = text.indexOf("\n", lineStart);
				if (lineEnd === -1) lineEnd = text.length;
				const lineText = text.substring(lineStart, lineEnd).trim();

				// Recompute match on the line for highlight offsets
				const lineMatch = simpleSearch!(lineText);

				chooser.addSuggestion({
					file,
					nameMatch: null,
					pathMatch: null,
					content: lineText,
					contentMatch: lineMatch,
					line,
					type: "content",
				});
				added++;
				if (added >= MAX_CONTENT_RESULTS) return;
			}
		};

		// Start after heading search has a chance to render
		setTimeout(processBatch, contentMode ? 0 : 50);
	}

	/** First line in `text` matching any positive content clause value. */
	private firstMatchLine(
		text: string,
		query: Query
	): { line: number; text: string } {
		const clauseValue = (c: Clause): string | undefined => {
			switch (c.kind) {
				case "content":
				case "line":
				case "section":
				case "block":
				case "task":
					return c.value;
				default:
					return undefined;
			}
		};
		const vals: string[] = [];
		for (const g of query.groups) {
			for (const c of g) {
				if (c.negated) continue;
				const v = clauseValue(c);
				if (v) vals.push(v.toLowerCase());
			}
		}
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const low = lines[i].toLowerCase();
			if (vals.some((v) => low.includes(v)))
				return { line: i, text: lines[i].trim() };
		}
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim()) return { line: i, text: lines[i].trim() };
		}
		return { line: 0, text: "" };
	}

	renderSuggestion(result: CmdkResult, el: HTMLElement) {
		el.addClass("mod-complex");

		if (result.type === "create") {
			el.addClass("float-search-cmdk-create-item");
			const contentEl = el.createDiv("suggestion-content");
			const titleEl = contentEl.createDiv("suggestion-title");
			titleEl.setText(strings().cmdkCreateNote);
			const noteEl = contentEl.createDiv("suggestion-note");
			const folder =
				this.plugin.settings.cmdkQuickCreateFolder || "/";
			noteEl.setText(
				`"${result.createQuery}" → ${folder}`
			);
			const auxEl = el.createDiv("suggestion-aux");
			const flair = auxEl.createSpan("suggestion-flair");
			setIcon(flair, "plus");
			return;
		}



		if (result.type === "save") {
			const contentEl = el.createDiv("suggestion-content");
			const titleEl = contentEl.createDiv("suggestion-title");
			titleEl.setText(strings().saveCurrentTitle);
			const noteEl = contentEl.createDiv("suggestion-note");
			noteEl.setText(this.inputEl.value.trim());
			const auxEl = el.createDiv("suggestion-aux");
			const flair = auxEl.createSpan("suggestion-flair");
			setIcon(flair, "bookmark");
			return;
		}


		const contentEl = el.createDiv("suggestion-content");

		if (result.type === "content" && result.content) {
			const titleEl = contentEl.createDiv("suggestion-title");
			if (result.contentMatch) {
				renderResults(titleEl, result.content, result.contentMatch);
			} else {
				titleEl.setText(result.content);
			}
			const noteEl = contentEl.createDiv("suggestion-note");
			noteEl.setText(result.file.path);
		} else if (result.type === "heading" && result.heading) {
			const titleEl = contentEl.createDiv("suggestion-title");
			if (result.headingMatch) {
				renderResults(titleEl, result.heading, result.headingMatch);
			} else {
				titleEl.setText(result.heading);
			}
			const noteEl = contentEl.createDiv("suggestion-note");
			noteEl.setText(result.file.path);
		} else {
			const titleEl = contentEl.createDiv("suggestion-title");
			if (result.nameMatch) {
				renderResults(
					titleEl,
					result.file.basename,
					result.nameMatch
				);
			} else {
				titleEl.setText(result.file.basename);
			}

			const noteEl = contentEl.createDiv("suggestion-note");
			const parentPath = result.file.parent?.path || "/";
			if (result.pathMatch) {
				renderResults(noteEl, parentPath, result.pathMatch);
			} else {
				noteEl.setText(parentPath);
			}
		}

		if (result.file.extension !== "md") {
			el.createDiv("suggestion-aux")
				.createSpan("suggestion-flair")
				.setText(result.file.extension);
		}
	}

	async onChooseSuggestion(
		result: CmdkResult,
		evt: MouseEvent | KeyboardEvent
	) {
		if (result.type === "create") {
			void this.quickCreateNote(result.createQuery, evt);
			return;
		}



		if (result.type === "save") {
			const current = this.inputEl.value.trim();
			const name = await promptForName(this.app, current);
			if (name) {
				await this.plugin.addSavedSearch(name, current);
			}
			this.close();
			return;
		}

		const leaf = Keymap.isModEvent(evt)
			? this.app.workspace.getLeaf("tab")
			: this.app.workspace.getMostRecentLeaf() ??
				this.app.workspace.getLeaf();

		const eState = ephemeralStateFor(result);
		await leaf.openFile(result.file, { active: true });
		if (eState) leaf.setEphemeralState(eState);
	}

	private async quickCreateNote(
		content: string,
		evt: MouseEvent | KeyboardEvent
	) {
		const settings = this.plugin.settings;
		const title = safeFileName(
			moment().format(settings.cmdkQuickCreateTitleFormat || "YYYYMMDDHHmmss")
		);
		const folder = normalizePath(settings.cmdkQuickCreateFolder);
		if (folder && !this.app.vault.getFolderByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}
		const path = uniqueNotePath(
			folder,
			title,
			(candidate) => this.app.vault.getAbstractFileByPath(candidate) !== null
		);
		const file = await this.app.vault.create(path, content);

		const leaf = Keymap.isModEvent(evt)
			? this.app.workspace.getLeaf("tab")
			: this.app.workspace.getMostRecentLeaf() ??
				this.app.workspace.getLeaf();
		await leaf.openFile(file, { active: true });
	}

	// Called by internal Chooser on selection change
	// @ts-ignore
	onSelectedChange = debounce(
		(result: CmdkResult, _evt: Event | null) => {
			if (result && isFileResult(result)) {
				this.showPreview(result);
			} else {
				this.hidePreview();
			}
		},
		100
	);

	private hidePreview() {
		this.previews.invalidate();
		this.modalEl.removeClass("float-search-cmdk-expanded");
		if (this.previewEl) {
			this.previewEl.hide();
		}
	}

	async showPreview(result: FileResult) {
		if (this.closed) return;
		this.previewEl?.hide();
		await this.previews.run(async (isCurrent) => {
			if (this.closed) return;
			await this.renderPreview(result, isCurrent);
		});
	}

	private async renderPreview(result: FileResult, isCurrent: () => boolean) {
		if (!this.previewEl) {
			this.previewEl = this.bodyEl.createDiv(
				"float-search-cmdk-preview"
			);
			const [leaf, view] = spawnLeafView(
				this.plugin,
				this.previewEl
			);
			this.fileLeaf = leaf;
			this.fileEmbeddedView = view;
			this.fileLeaf.setPinned(true);
		}

		this.previewEl.hide();

		const file = result.file;
		const leaf = this.fileLeaf!;
		await leaf.openFile(file, { active: false });
		if (this.closed || !isCurrent()) return;
		this.previewEl.show();
		this.modalEl.addClass("float-search-cmdk-expanded");

		const eState = ephemeralStateFor(result);
		if (eState) leaf.setEphemeralState(eState);

		this.inputEl.focus();
	}

	onClose() {
		this.closed = true;
		this.searchAbort?.abort();
		this.searchAbort = null;
		this.onSelectedChange.cancel();
		this.hidePreview();
		super.onClose?.();
		for (const [ev, h] of this.vaultHandlers) {
			this.app.vault.off(ev as any, h as any);
		}
		this.vaultHandlers = [];
		this.fileLeaf?.detach();
		this.fileEmbeddedView?.unload();
		this.fileLeaf = undefined;
		this.fileEmbeddedView = undefined;
		this.previewEl?.remove();
		this.previewEl = undefined;
		this.inputEl.removeEventListener("compositionstart", this.compositionStart);
		this.inputEl.removeEventListener("compositionend", this.compositionEnd);
	}
}

