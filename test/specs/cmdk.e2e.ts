import { browser, expect } from "@wdio/globals";
import { afterEach, beforeEach, describe, it } from "mocha";
import {
	activePath,
	closeModals,
	openCmdk,
	hasResult,
	updateSettings,
	waitForResult,
} from "./helpers";

describe("Quick search (CMDK)", () => {
	beforeEach(async () => {
		await updateSettings({
			excludeFolders: [],
			excludeFiles: [],
			filterUseRegex: false,
			filterMatchCase: false,
		});
	});

	afterEach(async () => {
		await closeModals();
	});

	it("finds notes by name and opens the selected one", async () => {
		const input = await openCmdk();
		await input.setValue("pineapple");
		await waitForResult("Pineapple");
		expect(await hasResult("Other")).toBe(false);

		await browser.$$(".suggestion-item*=Pineapple")[0].click();
		await browser.waitUntil(async () => (await activePath()) === "Pineapple.md", {
			timeoutMsg: "Pineapple.md was not opened",
		});
	});

	it("searches note content", async () => {
		const input = await openCmdk();
		await input.setValue("tropical");
		await waitForResult("Pineapple");
	});

	it("hides excluded folders from the results", async () => {
		await updateSettings({ excludeFolders: ["Archive"] });
		const input = await openCmdk();
		await input.setValue("pineapple");
		await waitForResult("Pineapple");
		expect(await hasResult("Old")).toBe(false);
	});

	it("hides excluded files from the results", async () => {
		await updateSettings({ excludeFiles: ["Pineapple.md"] });
		const input = await openCmdk();
		await input.setValue("pineapple");
		await waitForResult("Old");
		expect(await hasResult("Pineapple")).toBe(false);
	});

	it("understands query operators such as path: and negation", async () => {
		const input = await openCmdk();
		await input.setValue("pineapple -path:Archive");
		await waitForResult("Pineapple");
		expect(await hasResult("Old")).toBe(false);
	});

	it("supports regular expressions when enabled", async () => {
		await updateSettings({ filterUseRegex: true });
		const input = await openCmdk();
		await input.setValue("^Pine.*le$");
		await waitForResult("Pineapple");
		expect(await hasResult("Banana")).toBe(false);
	});

	it("shows quick-create when nothing matches", async () => {
		await updateSettings({ cmdkQuickCreate: true });
		const input = await openCmdk();
		await input.setValue("zzz-no-such-note");
		await browser.waitUntil(
			async () => (await browser.$$(".float-search-cmdk .suggestion-item")).length > 0,
			{ timeoutMsg: "no quick-create suggestion appeared" },
		);
		await updateSettings({ cmdkQuickCreate: false });
	});
});
