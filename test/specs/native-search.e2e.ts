import { browser, expect } from "@wdio/globals";
import { afterEach, describe, it } from "mocha";
import { PLUGIN_ID, closeModals, updateSettings, waitForPlugin } from "./helpers";

const TITLES = ".float-search-modal .search-result-file-title";

async function waitForResults() {
	await browser.waitUntil(async () => (await browser.$$(TITLES)).length > 0, {
		timeout: 15_000,
		timeoutMsg: "the search returned no results",
	});
}

describe("Floating native search", () => {
	afterEach(async () => {
		await closeModals();
		await updateSettings({ excludeFolders: [], excludeFiles: [] });
	});

	async function searchFor(query: string) {
		await waitForPlugin();
		await browser.executeObsidianCommand(`${PLUGIN_ID}:search-obsidian-globally`);
		const input = browser.$(".float-search-modal .search-input-container input");
		await input.waitForExist();
		await browser.waitUntil(() => input.isFocused(), {
			timeoutMsg: "the search input never received focus",
		});
		// Type into the focused field, like a user, so the injected exclusion clause survives.
		await browser.keys(query.split(""));
	}

	it("runs Obsidian's search in a modal", async () => {
		await searchFor("pineapple");
		await waitForResults();
		const titles = await browser.$$(TITLES);
		expect(titles.length).toBeGreaterThan(1);
	});

	it("keeps text typed into an empty search separate from the exclusion clause", async () => {
		await updateSettings({ excludeFolders: ["Archive"] });
		await searchFor("pineapple");
		const input = browser.$(".float-search-modal .search-input-container input");
		expect(await input.getValue()).toBe("pineapple -path:/^Archive\\//");
	});

	it("applies exclusion rules to the native search", async () => {
		await updateSettings({ excludeFolders: ["Archive"] });
		await searchFor("pineapple");
		await waitForResults();
		const texts: string[] = [];
		for (const el of await browser.$$(TITLES)) {
			texts.push((await el.getText()).split("\n")[0] ?? "");
		}
		expect(texts).not.toContain("Old");
		expect(texts).toContain("Pineapple");
	});
});
