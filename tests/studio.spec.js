const { test, expect } = require("@playwright/test");
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.studio?.generated);
});
test("renders Blockly, editor and local canvas", async ({ page }) => {
  await expect(page.locator("#blockCount")).toHaveText("3 blocks");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator("#warnings")).not.toContainText("Invalid");
  await page.screenshot({
    path: "test-results/digispark-studio-desktop.png",
    fullPage: true,
  });
});
test("simulate, step, reset and finish forever preview", async ({ page }) => {
  await page.locator("#step").click();
  await expect(page.locator("#eventCount")).toHaveText("1");
  await page.locator("#reset").click();
  await expect(page.locator("#clock")).toHaveText("00:00.0");
  await page.locator("#speed").selectOption("10");
  await page.locator("#play").click();
  await expect(page.locator("#play")).toHaveText("↻ Repeat", {
    timeout: 10000,
  });
  await expect(page.locator("#simLabel")).toContainText("3 loops");
});
test("manual code survives blocks changes, save and reload", async ({
  page,
}) => {
  await page.evaluate(() =>
    studio.editor.dispatch({ changes: { from: 0, insert: "// MANUAL\n" } }),
  );
  await page.locator("#os").selectOption("mac");
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(() => studio.editor.state.doc.toString()),
  ).toContain("// MANUAL");
  await page.reload();
  await page.waitForFunction(() => window.studio?.generated);
  expect(
    await page.evaluate(() => studio.editor.state.doc.toString()),
  ).toContain("// MANUAL");
  await expect(page.locator("#codeMode")).toHaveText("Manually edited");
  page.once("dialog", (d) => d.accept());
  await page.locator("#regenerate").click();
  await expect(page.locator("#codeMode")).toHaveText("From blocks");
  expect(
    await page.evaluate(() => studio.editor.state.doc.toString()),
  ).not.toContain("// MANUAL");
});
test("every module compiles on Windows Linux macOS", async ({
  page,
  request,
}) => {
  test.skip(
    !(await (await request.get("/api/status")).json()).compiler,
    "Requires local Arduino CLI and Digistump core",
  );
  await page.evaluate(() =>
    studio.loadNodes(studio.samples.all, "All modules"),
  );
  await page.waitForFunction(() => studio.generated?.blocks > 17);
  for (const os of ["windows", "linux", "mac"]) {
    await page.locator("#os").selectOption(os);
    await page.waitForFunction(
      (os) => studio.generated?.settings.os === os,
      os,
    );
    const r = await page.evaluate(
      async () =>
        await (
          await fetch("/api/compile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: studio.generated.code }),
          })
        ).json(),
    );
    expect(r.output || r.error).not.toContain("error:");
    expect(r.ok).toBe(true);
  }
});
test("project export/import round trip and ino download", async ({ page }) => {
  const download = page.waitForEvent("download");
  await page.locator("#save").click();
  const d = await download;
  const path = await d.path();
  page.once("dialog", (d) => d.accept());
  await page.locator("#newProject").click();
  await expect(page.locator("#blockCount")).toHaveText("0 blocks");
  await page.locator("#fileInput").setInputFiles(path);
  await expect(page.locator("#blockCount")).toHaveText("3 blocks");
  const ino = page.waitForEvent("download");
  await page.locator("#export").click();
  expect((await ino).suggestedFilename()).toMatch(/\.ino$/);
});
test("invalid text displays an error, not stale generated code", async ({
  page,
}) => {
  await page.evaluate(() =>
    studio.loadNodes([{ op: "text", text: "😀" }], "Invalid"),
  );
  await expect(page.locator("#warnings")).toContainText("ASCII");
  expect(await page.evaluate(() => studio.generated)).toBe(null);
});
test("GPIO simulation follows input changes", async ({ page }) => {
  await page.evaluate(() => studio.loadNodes(studio.samples.gpio, "GPIO"));
  await page.waitForFunction(() => studio.generated?.blocks === 5);
  let states = await page.evaluate(() =>
    studio.generated.events.filter((e) => e.kind === "pin").map((e) => e.value),
  );
  expect(states).toContain(1);
  await page.locator(".sim-detail summary").click();
  await page.locator('[data-pin="2"]').check();
  await page.waitForTimeout(500);
  states = await page.evaluate(() =>
    studio.generated.events.filter((e) => e.kind === "pin").map((e) => e.value),
  );
  expect(states).not.toContain(1);
});
test("mobile layout and guide work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#help").click();
  await expect(page.locator("#guide")).toBeVisible();
  await page.locator("#closeGuide").click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/digispark-studio-mobile.png",
    fullPage: true,
  });
});
test("unconnected blocks are saved so work is not lost", async ({ page }) => {
  await page.evaluate(() => {
    const b = studio.workspace.newBlock("wait");
    b.initSvg();
    b.render();
  });
  await expect(page.locator("#warnings")).toContainText("Connect all");
  const count = await page.evaluate(
    () => studio.workspace.getAllBlocks(false).length,
  );
  await page.reload();
  await page.waitForFunction(() => window.studio);
  await expect(page.locator("#warnings")).toContainText("Connect all");
  expect(
    await page.evaluate(() => studio.workspace.getAllBlocks(false).length),
  ).toBe(count);
});
test("dark mode covers workspace and persists independently of project", async ({
  page,
}) => {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const before = await page.evaluate(() => studio.editor.state.doc.toString());
  await page.screenshot({
    path: "test-results/digispark-dark.png",
    fullPage: true,
  });
  await page.locator("#themeToggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => studio.editor.state.doc.toString())).toBe(
    before,
  );
  await page.reload();
  await page.waitForFunction(() => window.studio?.generated);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator("#themeToggle").click();
  await expect(page.locator("#themeToggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
test("all layouts are simulated and compile in one firmware with final LED loop", async ({
  page,
}) => {
  await page.locator("#layoutMode").selectOption("sweep");
  await page.waitForFunction(
    () => studio.generated?.settings.layoutMode === "sweep",
  );
  await expect(page.locator("#layoutPause")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        new Set(
          studio.generated.events
            .filter((e) => e.kind === "layout")
            .map((e) => e.layout),
        ).size,
    ),
  ).toBe(15);
  if (
    await page.evaluate(
      async () => (await (await fetch("/api/status")).json()).compiler,
    )
  ) {
    const r = await page.evaluate(
      async () =>
        await (
          await fetch("/api/compile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: studio.generated.code }),
          })
        ).json(),
    );
    expect(r.ok, r.output || r.error).toBe(true);
    expect(r.output).not.toContain("warning:");
    console.log("Sweep firmware:", r.output);
  }
  const before = await page.evaluate(() => studio.snapshot());
  await page.reload();
  await page.waitForFunction(() => window.studio?.generated);
  await expect(page.locator("#layoutMode")).toHaveValue("sweep");
  expect(await page.evaluate(() => studio.snapshot().settings)).toEqual(
    before.settings,
  );
  await page.screenshot({
    path: "test-results/digispark-dark-sweep.png",
    fullPage: true,
  });
});
test("workspace views give the editor space and preserve project", async ({
  page,
}) => {
  const before = await page.evaluate(() => studio.editor.state.doc.toString());
  await page.locator("#view-code").click();
  await expect(page.locator("#blocksPanel")).toBeHidden();
  await expect(page.locator("#codePanel")).toBeVisible();
  expect((await page.locator("#editor").boundingBox()).width).toBeGreaterThan(
    1200,
  );
  await page.locator("#view-code").press("ArrowLeft");
  await expect(page.locator("#view-simulation")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#simPanel")).toBeVisible();
  await page.locator("#view-all").click();
  expect(await page.evaluate(() => studio.editor.state.doc.toString())).toBe(
    before,
  );
});
test("mobile navigation exposes each tool without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#view-blocks")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".blocklyToolbox")).toBeHidden();
  await page.locator("#toggleModules").click();
  await expect(page.locator(".blocklyToolbox")).toBeVisible();
  await page.locator("#toggleModules").click();
  await expect(page.locator(".blocklyToolbox")).toBeHidden();
  await expect(page.locator("#codePanel")).toBeHidden();
  await page.locator("#view-code").click();
  await expect(page.locator("#editor")).toBeVisible();
  await page.locator("#view-simulation").click();
  await expect(page.locator("#play")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
test("manual edits and invalid blocks get explicit actionable feedback", async ({
  page,
}) => {
  await page.evaluate(() =>
    studio.editor.dispatch({ changes: { from: 0, insert: "// custom\n" } }),
  );
  await expect(page.locator("#manualNotice")).toBeVisible();
  await page.evaluate(() =>
    studio.loadNodes([{ op: "text", text: "😀" }], "Invalid"),
  );
  await expect(page.locator("#diagnostics")).toHaveAttribute("open", "");
  await expect(page.locator("#play")).toBeDisabled();
  await expect(page.locator("#export")).toBeDisabled();
  await expect(page.locator("#projectStatus")).toHaveAttribute(
    "data-error",
    "true",
  );
});
test("copy button copies the current editor content", async ({ page }) => {
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.copied = text;
        },
      },
    }),
  );
  await page.locator("#copyCode").click();
  expect(await page.evaluate(() => window.copied)).toBe(
    await page.evaluate(() => studio.editor.state.doc.toString()),
  );
  await expect(page.locator("#toast")).toContainText("copied");
});
