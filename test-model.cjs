const assert = require("node:assert/strict"),
  M = require("./balance-model.js"),
  Import = require("./chatgpt-import.js"),
  Compact = require("./compact-format.js");
function state() {
  return {
    profile: {
      start: "2026-09-01",
      weight: 100,
      goal: 90,
      deadline: "2026-10-01",
    },
    entries: {},
    measurements: {},
    planHistory: [
      {
        effective: "2026-09-01",
        createdAt: "2026-09-01T00:00:00Z",
        mode: "loss",
        rate: 0.5,
        minIntake: 1500,
        activity: "0",
        calibratedExpense: null,
      },
    ],
  };
}
function test(name, fn) {
  fn();
  console.log("PASS " + name);
}
test("same-weight measurements reset observed progress, never invent loss", () => {
  const s = state();
  s.entries["2026-09-02"] = { weight: 99, intake: 1500 };
  s.entries["2026-09-03"] = { weight: 99, intake: 1500 };
  assert.equal(M.weights(s, "2026-09-03").at(-1)[0], "2026-09-03");
  assert.equal(M.trend(s, "2026-09-03").latest[1].weight, 99);
});
test("measurement only and explicit deletion override legacy weight", () => {
  const s = state();
  s.entries["2026-09-02"] = { weight: 99 };
  s.measurements["2026-09-02"] = { weight: null, waist: 95 };
  assert.equal(M.weights(s, "2026-09-03").length, 0);
  s.measurements["2026-09-03"] = { weight: 98 };
  assert.equal(M.weights(s, "2026-09-03")[0][1].weight, 98);
  assert.equal(Object.keys(s.entries).length, 1);
});
test("quality separates missing, partial, legacy and completed days", () => {
  const s = state();
  s.entries["2026-09-01"] = { diaryStatus: "complete" };
  s.entries["2026-09-02"] = { diaryStatus: "partial" };
  s.entries["2026-09-03"] = {};
  const q = M.quality(s, "2026-09-07");
  assert.equal(q.complete, 1);
  assert.equal(q.partial, 1);
  assert.equal(q.unreviewed, 1);
  assert.equal(q.missing, 4);
  assert.equal(q.coverage, 1 / 7);
});
test("deadline never escalates deficit; intake constraints and maintenance", () => {
  const s = state();
  const before = M.plan(s, "2026-09-30", 2500),
    after = M.plan(s, "2026-10-02", 2500);
  assert.equal(before.deficit, after.deficit);
  assert(before.deficit <= 500);
  assert.equal(M.plan(s, "2026-09-30", 1600).deficit, 100);
  assert.equal(M.plan(s, "2026-09-30", 1300).deficit, 0);
  assert.equal(M.plan(s, "2026-09-30", 1300).low, 1500);
  s.planHistory.push({
    ...s.planHistory[0],
    effective: "2026-10-02",
    mode: "maintenance",
  });
  assert.equal(M.plan(s, "2026-10-02", 2500).deficit, 0);
  assert(M.plan(s, "2026-09-30", 2500).deficit > 0);
});
test("excessive deficit is not rewarded; partial day has no outcome", () => {
  const s = state();
  s.entries["2026-09-02"] = { intake: 1000, diaryStatus: "complete" };
  assert.equal(M.classify(s, "2026-09-02", 2500), "excess");
  s.entries["2026-09-02"].diaryStatus = "partial";
  assert.equal(M.classify(s, "2026-09-02", 2500), "partial");
});
test("trend uses calendar windows and refuses sparse or stale rate", () => {
  const s = state();
  s.measurements = {
    "2026-09-01": { weight: 100 },
    "2026-09-02": { weight: 99.9 },
  };
  assert.equal(M.trend(s, "2026-09-02").value, null);
  assert.equal(M.trend(s, "2026-09-02").rate, null);
  s.measurements["2026-09-03"] = { weight: 99.8 };
  assert(Math.abs(M.trend(s, "2026-09-03").value - 99.9) < 1e-8);
  assert.equal(M.trend(s, "2026-09-20").rate, null);
});
function completeHistory() {
  const s = state();
  for (let n = 0; n < 28; n++) {
    const d = M.add("2026-09-01", n);
    s.entries[d] = {
      intake: 2000,
      diaryStatus: "complete",
      wellbeing: { hunger: 2, energy: 4 },
    };
    s.measurements[d] = { weight: 100 - n / 14, conditions: "morning" };
  }
  return s;
}
test("calibration gated by completeness; robust observed rate and conservative proposal", () => {
  const s = completeHistory(),
    cal = M.calibration(s, "2026-09-29", () => 2800);
  assert(cal.available);
  assert(Math.abs(cal.trend.rate - 0.5) < 1e-8);
  assert(cal.low < cal.estimate && cal.high > cal.estimate);
  assert.equal(cal.estimate, 2550);
  const r = M.review(s, "2026-09-29", () => 2800);
  assert.equal(r.kind, "calibrate");
  assert.equal(r.proposal.calibratedExpense, 2700);
  for (let n = 0; n < 5; n++)
    s.entries[M.add("2026-09-01", n)].diaryStatus = "partial";
  assert.equal(M.calibration(s, "2026-09-29", () => 2800).available, false);
  assert.equal(M.review(s, "2026-09-29", () => 2800).proposal, null);
});
test("poor wellbeing blocks calibration; same-week plan prevents repeated adjustment", () => {
  const s = completeHistory();
  for (const e of Object.values(s.entries)) e.wellbeing.hunger = 5;
  assert.equal(M.review(s, "2026-09-29", () => 2800).kind, "recovery");
  for (const e of Object.values(s.entries)) e.wellbeing.hunger = 2;
  s.planHistory.push({ ...s.planHistory[0], effective: "2026-09-29" });
  assert.equal(M.review(s, "2026-09-29", () => 2800).proposal, null);
});
test("forecast gives scenario range, no dates for stale or flat weights", () => {
  const s = completeHistory();
  const f = M.forecast(s, "2026-09-28");
  assert(f.available);
  assert(f.earliest < f.latest);
  for (const m of Object.values(s.measurements)) m.weight = 100;
  assert.equal(M.forecast(s, "2026-09-28").available, false);
});
test("recipe scales raw ingredients by cooked yield, portions preserve provenance", () => {
  const ingredients = [
    {
      name: "Крупа",
      grams: 100,
      calories: 350,
      protein: 10,
      fat: 2,
      carbs: 70,
      fiber: 5,
    },
    {
      name: "Масло",
      grams: 10,
      calories: 900,
      protein: 0,
      fat: 100,
      carbs: 0,
      fiber: 0,
    },
  ];
  const nutrients = M.recipe(ingredients, 400);
  assert(Math.abs(nutrients.calories - 110) < 1e-8);
  const t = {
    name: "Каша",
    ...nutrients,
    ingredients,
    yieldGrams: 400,
    calorieSource: "database",
  };
  const f = M.portion(t, 200, "meal-1");
  assert(Math.abs(f.calories - 220) < 1e-8);
  assert.equal(f.calorieSource, "database");
  assert.throws(() => M.recipe(ingredients, 0));
  assert.throws(() => M.portion(t, -1, "x"));
});
test("calorie ranges survive v1 and compact roundtrip; malformed ranges rejected", () => {
  const d = {
    version: 1,
    importId: "range-test-123",
    date: "2026-09-01",
    mode: "append",
    foods: [
      {
        name: "Блюдо",
        weightGrams: 100,
        calories: 320,
        protein: 10,
        fat: 10,
        carbs: 40,
        fiber: 3,
        calorieSource: "estimate",
        calorieRange: { low: 250, high: 320 },
      },
    ],
  };
  const expanded = Compact.expand(Compact.pack(d));
  const { version, importId, mode, ...rest } = expanded;
  const parsed = Import.parse({ ...rest, schemaVersion: 1 });
  assert.deepEqual(parsed[0].foods[0].calorieRange, { low: 250, high: 320 });
  rest.foods[0].calorieRange.low = 400;
  assert.throws(() => Import.parse({ ...rest, schemaVersion: 1 }));
});

test("rounding never exceeds 100 kcal per review; implausible source expenditure blocks proposal", () => {
  const s = completeHistory();
  const r = M.review(s, "2026-09-29", () => 2376);
  assert(r.proposal);
  assert(Math.abs(r.proposal.calibratedExpense - 2376) <= 100);
  assert.equal(r.proposal.calibratedExpense % 50, 0);
  assert.equal(M.review(s, "2026-09-29", () => 500).proposal, null);
});
