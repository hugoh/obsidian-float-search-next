import {
	Keymap,
	Modal,
	SearchView,
	TFile,
	WorkspaceLeaf,
	debounce,
} from "obsidian";
import { EmbeddedView, spawnLeafView } from "./leafView";
import { stripExclusion, withExclusion } from "./exclusions";
import { LatestQueue } from "./latestQueue";
import { strings } from "./i18n";
import { applyNativeResultFilters, bindNativeRegexSearch, mountFilterBar, watchNativeSearchResults } from "./filterBar";
import type FloatSearchPlugin from "./floatSearchIndex";

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

export class FloatSearchModal extends Modal {
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
