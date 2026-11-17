import { browser, expect } from "@wdio/globals";
import { afterEach, describe, it } from "mocha";
import {
	PLUGIN_ID,
	waitForPlugin,
	closeModals,
	openCmdk,
	hasResult,
	updateSettings,
	waitForResult,
} from "./helpers";

describe("Saved searches", () => {
	afterEach(async () => {
		await closeModals();
		await updateSettings({ savedSearches: [], excludeFolders: [], excludeFiles: [] });
	});

	it("registers a command that opens quick search pre-filtered", async () => {
		await waitForPlugin();
		await browser.executeObsidian(
			({ app }, id) => {
				const plugin = (app as any).plugins.plugins[id];
				plugin.addSavedSearch("Fruit notes", "path:Notes");
			},
			PLUGIN_ID,
		);

		await browser.executeObsidianCommand(`${PLUGIN_ID}:savedsearch-fruit-notes`);
		await browser.$(".float-search-cmdk").waitForExist();
		await waitForResult("Banana");
		expect(await hasResult("Pineapple")).toBe(false);
	});

	it("lists presets as filter chips that narrow the results", async () => {
		await updateSettings({
			savedSearches: [{ name: "Archive", query: "path:Archive" }],
		});
		await openCmdk();
		const chip = browser.$(".float-search-filter-chip=Archive");
		await chip.waitForExist();
		await chip.click();
		await waitForResult("Old");
		expect(await hasResult("Pineapple")).toBe(false);
	});
});
