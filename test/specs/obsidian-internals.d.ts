import "obsidian";

/** The slice of the plugin that the e2e specs drive. */
export interface TestPlugin {
	settings: Record<string, unknown> & {
		savedSearches: { id: string; name: string; query: string }[];
	};
	applySettingsUpdate(): void;
	addSavedSearch(name: string, query: string): Promise<void>;
	syncSavedSearchCommands(): void;
	openCmdkModal(initialFilters?: string[]): void;
	loadData(): Promise<Record<string, unknown> | null>;
	saveData(data: unknown): Promise<void>;
}

declare module "obsidian" {
	interface App {
		plugins: {
			plugins: Record<string, TestPlugin>;
			enablePlugin(id: string): Promise<void>;
			disablePlugin(id: string): Promise<void>;
		};
		commands: { commands: Record<string, unknown> };
	}

	interface Workspace {
		protocolHandler: {
			handlers: Map<string, (params: Record<string, string>) => void>;
		};
	}
}
