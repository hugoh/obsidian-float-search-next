import { browser } from "@wdio/globals";

export const PLUGIN_ID = "float-search";

export async function waitForPlugin() {
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(({ app }, id) => {
        const plugin = (app as any).plugins.plugins[id];
        return Boolean(plugin?.settings);
      }, PLUGIN_ID),
    { timeoutMsg: "the plugin never finished loading" },
  );
}

export async function openCmdk(initialFilters?: string[]) {
  await waitForPlugin();
  await browser.executeObsidian(
    ({ app }, id, filters) => {
      // biome-ignore lint: reaching into the plugin registry for the test
      const plugin = (app as any).plugins.plugins[id];
      plugin.openCmdkModal(filters);
    },
    PLUGIN_ID,
    initialFilters,
  );
  const input = browser.$(".float-search-cmdk .prompt-input");
  await input.waitForExist();
  return input;
}

export async function updateSettings(patch: Record<string, unknown>) {
  await waitForPlugin();
  await browser.executeObsidian(
    ({ app }, id, values) => {
      const plugin = (app as any).plugins.plugins[id];
      Object.assign(plugin.settings, values);
    },
    PLUGIN_ID,
    patch,
  );
}

export async function resultTexts(): Promise<string[]> {
  const items = await browser.$$(".float-search-cmdk .suggestion-item");
  const texts: string[] = [];
  for (const item of items) texts.push(await item.getText());
  return texts;
}

export async function hasResult(text: string): Promise<boolean> {
  return (await resultTexts()).some((row) => row.includes(text));
}

export async function waitForResult(text: string) {
  await browser.waitUntil(() => hasResult(text), {
    timeoutMsg: `"${text}" never appeared in the results`,
  });
}

export async function activePath(): Promise<string | undefined> {
  return browser.executeObsidian(
    ({ app }) => app.workspace.getActiveFile()?.path,
  );
}

export async function closeModals() {
  await browser.keys("Escape");
}
