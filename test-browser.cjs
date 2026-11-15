/* npm run test:browser; optionally set BALANCE_TEST_URL and PLAYWRIGHT_CHROMIUM_EXECUTABLE. */
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  try {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        acceptDownloads: true,
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.clock.install({ time: new Date("2026-11-15T12:00:00Z") });
    await page.goto(process.env.BALANCE_TEST_URL || "http://127.0.0.1:8080");
    const legacy = {
      profile: {
        height: 190,
        weight: 107,
        goal: 90,
        birthday: "1998-04-03",
        start: "2026-09-01",
        deadline: "2027-04-01",
        proteinFactor: 1.6,
      },
      entries: {
        "2026-11-01": {
          weight: 103,
          mode: "custom",
          spent: 2800,
          intake: 2000,
          protein: 160,
          fat: 50,
          carbs: 150,
          fiber: 20,
        },
        "2026-11-05": {
          weight: 103,
          mode: "0",
          spent: null,
          intake: 3000,
          protein: 100,
          fat: null,
          carbs: null,
          fiber: null,
        },
      },
    };
    await page.evaluate(
      (s) => localStorage.setItem("balance-v1", JSON.stringify(s)),
      legacy,
    );
    await page.reload();
    let saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("balance-v1")),
    );
    assert.equal(saved.schemaVersion, 2);
    assert.equal(saved.entries["2026-11-01"].diaryStatus, "unreviewed");
    assert.equal(saved.entries["2026-11-01"].spent, 2800);
    assert.deepEqual(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("balance-before-v2")),
      ),
      legacy,
    );
    assert.equal(await page.locator("#main > section").count(), 1);
    assert.equal(
      await page
        .locator("#main .hero, #main .review-card, #main .today-card")
        .count(),
      0,
    );
    const historicalExpected = Object.entries(saved.entries).reduce(
      (sum, [d, e]) => sum + e.expenseSnapshot - e.intake,
      0,
    );
    assert.equal(await page.evaluate(() => stats().burned), historicalExpected);
    await page.locator("[data-tab=charts]").click();
    assert.equal(
      await page.evaluate(
        () =>
          chartSeries(records()).find((s) => s.id === "deficit").items[0][1],
      ),
      800,
    );
    assert(
      (await page.locator(".form-footer").innerText()).includes("непроверенн"),
    );
    await page.locator("[data-tab=calendar]").click();
    // Independent measurement must not fabricate a nutrition record.
    await page.locator("[data-measure]").click();
    await page.locator("#measurementDialog [name=weight]").fill("101.5");
    await page.locator("#measurementDialog [name=waist]").fill("100");
    await page
      .locator("#measurementDialog [name=conditions]")
      .selectOption("morning");
    await page
      .locator(
        "#measurementDialog button[type=submit], #measurementDialog button.primary",
      )
      .click();
    const day = await page.evaluate(() => today());
    saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("balance-v1")),
    );
    assert.equal(saved.measurements[day].weight, 101.5);
    assert.equal(saved.entries[day], undefined);
    // Partial / completed day and optional wellbeing.
    await page.locator("#addToday").click();
    await page.locator("#dayForm [name=intake]").fill("2100");
    await page.locator("#dayForm [name=protein]").fill("160");
    await page.locator("#dayForm .primary").click();
    assert(
      (
        await page.locator(`[data-date="${day}"]`).getAttribute("class")
      ).includes("partial"),
    );
    await page.locator("#addToday").click();
    await page.locator("#dayForm [name=diaryStatus]").selectOption("complete");
    await page.locator("#dayForm .primary").click();
    saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("balance-v1")),
    );
    assert.equal(saved.entries[day].diaryStatus, "complete");
    // Reusable template with original calorie range.
    await page.locator("[data-tab=foods]").click();
    await page.locator("#newTemplate").click();
    const td = page.locator("#templateDialog");
    await td.locator("[name=name]").fill("Йогурт <тест>");
    await td.locator("[name=calorieSource]").selectOption("estimate");
    for (const [k, v] of Object.entries({
      calories: 100,
      protein: 10,
      fat: 2,
      carbs: 10,
      fiber: 0,
    }))
      await td.locator(`[name=${k}]`).fill(String(v));
    await td.locator("summary").click();
    await td.locator("[name=rangeLow]").fill("80");
    await td.locator("[name=rangeHigh]").fill("100");
    await td.locator("button.primary").click();
    await page.locator("#quickGrams").fill("200");
    await page.locator("#addPortion").click();
    saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("balance-v1")),
    );
    assert.equal(saved.entries[day].intake, 2300);
    assert.equal(saved.entries[day].diaryStatus, "partial");
    assert.equal(saved.templates[0].calorieRange.low, 80);
    assert((await page.locator("body").innerText()).includes("Йогурт <тест>"));
    // Recipe: 100g ingredient at 350 kcal/100g, 400g cooked yield => 87.5 kcal/100g.
    await page.locator("#newRecipe").click();
    await td.locator("[name=name]").fill("Каша");
    await td.locator("[data-key=name]").fill("Крупа");
    await td.locator("[data-key=grams]").fill("100");
    for (const [k, v] of Object.entries({
      calories: 350,
      protein: 10,
      fat: 2,
      carbs: 70,
      fiber: 5,
    }))
      await td.locator(`[data-key=${k}]`).fill(String(v));
    await td.locator("[name=yieldGrams]").fill("400");
    await td.locator("button.primary").click();
    saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("balance-v1")),
    );
    assert.equal(saved.templates[1].calories, 87.5);
    // Import synchronizes explicit weight and source ranges; undo checks the full state.
    const importPayload = {
      schemaVersion: 1,
      date: day,
      weight: 102,
      foods: [
        {
          id: "browser-import-1",
          name: "Добавка",
          weightGrams: 100,
          calories: 100,
          protein: 5,
          fat: 2,
          carbs: 15,
          fiber: 1,
          calorieSource: "estimate",
          calorieRange: { low: 80, high: 100 },
        },
      ],
    };
    const beforeImport = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("balance-v1")),
    );
    async function importMeal() {
      await page.locator("[data-chatgpt]").first().click();
      await page.locator("#chatJson").fill(JSON.stringify(importPayload));
      await page.locator("#chatPreview").click();
      await page.locator("#chatConfirm").click();
    }
    await importMeal();
    assert.equal(
      await page.evaluate((d) => state.measurements[d].weight, day),
      102,
    );
    await page.locator("[data-chatgpt]").first().click();
    await page.locator("#chatUndo").click();
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem("balance-v1"))),
      beforeImport,
    );
    await importMeal();
    await page.locator("[data-tab=plan]").click();
    await page
      .locator("#habitForm [name=habit]")
      .fill("Проверка сохранения привычки");
    await page.locator("#habitForm .primary").click();
    await page.locator("[data-chatgpt]").first().click();
    await page.locator("#chatUndo").click();
    assert(
      (await page.locator("#chatError").innerText()).includes(
        "данные изменены",
      ),
    );
    assert.equal(
      await page.evaluate(() => state.habit),
      "Проверка сохранения привычки",
    );
    await page.locator("#chatClose").click();
    saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("balance-v1")),
    );
    // Plan changes do not rewrite historical snapshots. Maintenance has zero deficit.
    const snapshots = JSON.stringify(saved.entries);
    await page.locator("[data-tab=plan]").click();
    await page.locator("#adaptivePlan [name=mode]").selectOption("maintenance");
    await page.locator("#adaptivePlan button.primary").click();
    assert.equal(await page.evaluate(() => currentPlan().deficit), 0);
    saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("balance-v1")),
    );
    assert.equal(JSON.stringify(saved.entries), snapshots);
    // Validated backup and independently inspectable evidence export.
    assert.equal(
      await page.evaluate(() => {
        validateBackup(JSON.parse(localStorage.getItem("balance-v1")));
        return true;
      }),
      true,
    );
    const reportWait = page.waitForEvent("download");
    await page.locator("[data-report]").first().click();
    const reportDownload = await reportWait,
      report = JSON.parse(
        await fs.readFile(await reportDownload.path(), "utf8"),
      );
    assert.equal(report.algorithmVersion, "2.0.0");
    assert.equal(report.raw.measurements[day].weight, 102);
    assert(report.limitations.length);
    const backupWait = page.waitForEvent("download");
    await page.locator("#export").click();
    const backup = await backupWait,
      backupPath = await backup.path();
    const beforeRestore = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("balance-v1")),
    );
    await page.locator("#importFile").setInputFiles(backupPath);
    await page.waitForFunction(
      () =>
        document.querySelector("#toast").textContent ===
        "Все данные восстановлены",
    );
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem("balance-v1"))),
      beforeRestore,
    );
    // Charts and viewport layouts.
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      for (const tab of ["calendar", "charts", "foods", "plan"]) {
        await page.locator(`[data-tab=${tab}]`).click();
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `overflow ${width} ${tab}`,
        );
      }
    }
    for (const [width, height] of [
      [320, 568],
      [360, 640],
      [390, 844],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      await page.locator("[data-tab=calendar]").click();
      await page.evaluate(() => {
        month = date("2026-08-01");
        calendar();
      });
      assert.equal(await page.locator("#days [data-date]").count(), 31);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight,
        ),
        `vertical overflow ${width}x${height}`,
      );
      assert(
        (await page.locator("header").boundingBox()).y >= 0,
        `header clipped ${width}x${height}`,
      );
      const calendarBounds = await page.locator(".calendar-card").boundingBox(),
        navBounds = await page.locator("#nav").boundingBox();
      assert(
        navBounds.y - (calendarBounds.y + calendarBounds.height) < 32,
        `calendar should fill the screen ${width}x${height}`,
      );
      const last = await page.locator("#days [data-date]").last().boundingBox(),
        nav = await page.locator("#nav").boundingBox();
      assert(
        last.y + last.height <= nav.y,
        `calendar hidden by navigation ${width}x${height}`,
      );
      await page.locator("#goToday").click();
      assert.equal(await page.evaluate(() => month.getMonth()), 10);
    }
    await page.locator("[data-tab=charts]").click();
    await page.locator("[data-view=weight]").click();
    assert.equal(await page.locator("svg.chart").count(), 1);
    assert(
      !(
        await page.locator("svg.chart").evaluate((el) => el.outerHTML)
      ).includes("NaN"),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("[data-tab=calendar]").click();
    if (process.env.BALANCE_SCREENSHOT)
      await page.screenshot({
        path: process.env.BALANCE_SCREENSHOT,
        fullPage: true,
      });
    // PWA's new calculation and UI modules must be cached for offline use.
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      await reg.update();
    });
    // A newly activated worker is guaranteed to control the next navigation.
    // Do not race clients.claim() from the first installation with this assertion.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
    );
    await context.setOffline(true);
    await page.reload();
    await page.locator("#addToday").waitFor();
    await page.locator("[data-tab=plan]").click();
    await page.locator("#adaptivePlan").waitFor();
    await context.setOffline(false);
    assert.deepEqual(errors, []);
    console.log(
      "PASS Chromium: migration, independent measurements, completeness, templates/ranges, recipes, maintenance, history, backup/restore, evidence, 320/390/768px, charts, offline PWA",
    );
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
