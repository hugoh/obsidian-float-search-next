import {
  AbstractInputSuggest,
  type App,
  PluginSettingTab,
  prepareFuzzySearch,
  Setting,
  type SettingDefinitionItem,
  type TextComponent,
  TFile,
  TFolder,
} from "obsidian";
import type FloatSearchPlugin from "./floatSearchIndex";
import { strings } from "./i18n";
import type { CmdkTriggerKey, SearchType } from "./settings";
import { DOUBLE_TAP_RANGE } from "./settings";

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

function buildPillList(
  container: HTMLElement,
  items: string[],
  onRemove: (index: number) => void | Promise<void>,
) {
  const wrap = container.createDiv({ cls: "float-search-pill-list" });
  wrap.empty();
  items.forEach((item, i) => {
    const pill = wrap.createDiv({ cls: "float-search-pill" });
    pill.setText(item);
    pill.title = strings().clickToRemove;
    pill.onClickEvent(() => void onRemove(i));
  });
  return wrap;
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
    private onPick: (path: string) => void | Promise<void>,
  ) {
    super(app, inputEl);
  }

  getSuggestions(query: string): (TFolder | TFile)[] {
    const pool = this.app.vault
      .getAllLoadedFiles()
      .filter((f) =>
        this.kind === "folder"
          ? f instanceof TFolder && f.path !== ""
          : f instanceof TFile,
      ) as (TFolder | TFile)[];
    if (!query) return pool.slice(0, 50);
    const fuzzy = prepareFuzzySearch(query);
    return pool
      .map((f) => ({ f, m: fuzzy(f.path) }))
      .filter((x) => x.m)
      .sort((a, b) => (b.m!.score ?? -Infinity) - (a.m!.score ?? -Infinity))
      .slice(0, 50)
      .map((x) => x.f);
  }

  renderSuggestion(value: TFolder | TFile, el: HTMLElement) {
    el.setText(value.path || "/");
  }

  selectSuggestion(value: TFolder | TFile) {
    void this.onPick(value.path);
    this.inputEl.value = "";
    this.close();
  }
}

export class FloatSearchSettingTab extends PluginSettingTab {
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

  /**
   * Describes the plain settings for Obsidian's settings search (1.13+).
   * The tab itself is still drawn by display(), which also handles the
   * exclusion pickers and the saved-search editor.
   */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    const s = strings();
    const viewTypes = s.viewType;
    return [
      {
        type: "group",
        heading: s.tabGeneral,
        items: [
          {
            name: s.defaultViewType,
            control: {
              type: "dropdown",
              key: "defaultViewType",
              options: {
                modal: viewTypes.modal,
                split: viewTypes.split,
                tab: viewTypes.tab,
                window: viewTypes.window,
                sidebar: viewTypes.sidebar,
              },
            },
          },
          {
            name: s.showFilePath,
            control: { type: "toggle", key: "showFilePath" },
          },
          {
            name: s.showInstructions,
            control: { type: "toggle", key: "showInstructions" },
          },
        ],
      },
      {
        type: "group",
        heading: s.tabQuickSearch,
        items: [
          {
            name: s.quickSearchTrigger,
            desc: s.quickSearchTriggerDesc,
            control: {
              type: "dropdown",
              key: "cmdkTriggerKey",
              options: triggerKeyOptions(),
            },
          },
          {
            name: s.autoPreview,
            desc: s.autoPreviewDesc,
            control: { type: "toggle", key: "cmdkAutoPreview" },
          },
          {
            name: s.doubleTapInterval,
            desc: s.doubleTapIntervalDesc,
            control: {
              type: "slider",
              key: "cmdkDoubleTapInterval",
              min: DOUBLE_TAP_RANGE.min,
              max: DOUBLE_TAP_RANGE.max,
              step: 50,
            },
          },
        ],
      },
      {
        type: "group",
        heading: s.tabQuickCreate,
        items: [
          {
            name: s.enableQuickCreate,
            desc: s.enableQuickCreateDesc,
            control: { type: "toggle", key: "cmdkQuickCreate" },
          },
          {
            name: s.quickCreateFolder,
            desc: s.quickCreateFolderDesc,
            control: {
              type: "folder",
              key: "cmdkQuickCreateFolder",
              placeholder: s.quickCreateFolderPlaceholder,
            },
          },
          {
            name: s.titleFormat,
            desc: s.titleFormatDesc,
            control: { type: "text", key: "cmdkQuickCreateTitleFormat" },
          },
        ],
      },
    ];
  }

  override getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    if (key === "showFilePath") this.plugin.updateFilePathVisibility();
    await this.plugin.saveSettings();
  }

  display() {
    const { containerEl } = this;
    const s = strings();
    containerEl.empty();
    containerEl.addClass("float-search-settings-tab");

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

    new Setting(container).setName(s.showFilePath).addToggle((toggle) => {
      toggle
        .setValue(this.plugin.settings.showFilePath)
        .onChange(async (value) => {
          this.plugin.settings.showFilePath = value;
          this.plugin.updateFilePathVisibility();
          this.plugin.applySettingsUpdate();
        });
    });

    new Setting(container).setName(s.showInstructions).addToggle((toggle) => {
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
    s: ReturnType<typeof strings>,
  ) {
    new Setting(container)
      .setName(s.quickSearchTrigger)
      .setDesc(s.quickSearchTriggerDesc)
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(triggerKeyOptions())) {
          dropdown.addOption(value, label);
        }
        dropdown.setValue(this.plugin.settings.cmdkTriggerKey);
        dropdown.onChange(async (value) => {
          this.plugin.settings.cmdkTriggerKey = value as CmdkTriggerKey;
          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName(s.autoPreview)
      .setDesc(s.autoPreviewDesc)
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.cmdkAutoPreview)
          .onChange(async (value) => {
            this.plugin.settings.cmdkAutoPreview = value;
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
          .onChange(async (value) => {
            this.plugin.settings.cmdkDoubleTapInterval = value;
            await this.plugin.saveSettings();
          });
      });
  }

  private renderQuickCreate(
    container: HTMLElement,
    s: ReturnType<typeof strings>,
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
        text
          .setPlaceholder(s.quickCreateFolderPlaceholder)
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
        text
          .setPlaceholder("YYYYMMDDHHmmss")
          .setValue(this.plugin.settings.cmdkQuickCreateTitleFormat)
          .onChange(async (value) => {
            this.plugin.settings.cmdkQuickCreateTitleFormat = value;
            await this.plugin.saveSettings();
          });
      });
  }

  private renderFilters(container: HTMLElement) {
    // ── Exclusions ──────────────────────────────────────────────
    new Setting(container).setName(strings().exclusions).setHeading();

    // Exclude folders
    new Setting(container)
      .setName(strings().excludeFolders)
      .setDesc(strings().excludeFoldersDesc)
      .addText((text) => {
        text.setPlaceholder(strings().phTemplates);
        new PathSuggest(this.app, text.inputEl, "folder", async (path) => {
          if (!this.plugin.settings.excludeFolders.includes(path)) {
            this.plugin.settings.excludeFolders.push(path);
            await this.plugin.saveSettings();
            this.display();
          }
        });
      });
    buildPillList(container, this.plugin.settings.excludeFolders, async (i) => {
      this.plugin.settings.excludeFolders.splice(i, 1);
      await this.plugin.saveSettings();
      this.display();
    });

    // Exclude files
    new Setting(container)
      .setName(strings().excludeFiles)
      .setDesc(strings().excludeFilesDesc)
      .addText((text) => {
        text.setPlaceholder(strings().phSecrets);
        new PathSuggest(this.app, text.inputEl, "file", async (path) => {
          if (!this.plugin.settings.excludeFiles.includes(path)) {
            this.plugin.settings.excludeFiles.push(path);
            await this.plugin.saveSettings();
            this.display();
          }
        });
      });
    buildPillList(container, this.plugin.settings.excludeFiles, async (i) => {
      this.plugin.settings.excludeFiles.splice(i, 1);
      await this.plugin.saveSettings();
      this.display();
    });

    // ── Saved searches ─────────────────────────────────────────
    new Setting(container).setName(strings().savedSearches).setHeading();

    const addSetting = new Setting(container).setName(strings().addSavedSearch);
    addSetting.setDesc(strings().addSavedSearchDesc);
    let nameInput: TextComponent | undefined;
    let queryInput: TextComponent | undefined;
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
        .onClick(() => {
          const name = nameInput?.inputEl.value.trim();
          const query = queryInput?.inputEl.value.trim();
          if (!name || !query || !nameInput || !queryInput) return;
          const fields = [nameInput, queryInput];
          void this.plugin.addSavedSearch(name, query).then(() => {
            this.renderSavedList();
            for (const field of fields) field.inputEl.value = "";
          });
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
      label.createSpan({ cls: "float-search-saved-name" }).setText(s.name);
      label
        .createSpan({
          cls: "float-search-saved-query",
        })
        .setText(s.query);

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
        saveBtn.onClickEvent(() => void commit());
        queryField.addEventListener("keydown", (e) => {
          if (e.key === "Enter") void commit();
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
