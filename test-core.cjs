const assert = require("node:assert/strict"),
  fs = require("fs"),
  vm = require("vm");
function fixture() {
  const elements = {},
    storage = new Map();
  let fail = false;
  const c = {
    console,
    Date: class extends Date {
      constructor(...args) {
        super(...(args.length ? args : ["2026-11-15T12:00:00Z"]));
      }
      static now() {
        return Date.parse("2026-11-15T12:00:00Z");
      }
    },
    Math,
    Number,
    JSON,
    Set,
    Map,
    FormData,
    Blob,
    URL,
    setTimeout: () => 0,
    BalanceModel: require("./balance-model.js"),
    BalanceImport: require("./chatgpt-import.js"),
    localStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => {
        if (fail) throw Error("quota");
        storage.set(k, v);
      },
    },
    document: {
      querySelector: (s) => (elements[s] ??= { style: {} }),
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    window: {},
    crypto: { randomUUID: () => String(Math.random()) },
  };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync("management.js", "utf8"), c);
  const s = fs.readFileSync("app.js", "utf8");
  vm.runInContext(s.split("/* APP_BOOTSTRAP */")[0], c);
  return {
    c,
    storage,
    failWrite: () => {
      fail = true;
    },
    run: (s) => vm.runInContext(s, c),
  };
}
const profile = {
  height: 190,
  weight: 107,
  goal: 90,
  birthday: "1998-04-03",
  start: "2026-09-01",
  deadline: "2027-04-01",
  proteinFactor: 1.6,
};
function test(name, fn) {
  fn();
  console.log("PASS " + name);
}
test("legacy migration keeps exact backup, snapshots, unknown completeness and repeat safety", () => {
  const f = fixture(),
    legacy = {
      profile,
      entries: {
        "2026-11-01": {
          weight: 100,
          mode: "custom",
          spent: 2800,
          intake: 1800,
          protein: 160,
        },
        "2026-11-02": {
          weight: 100,
          mode: "custom",
          spent: 2800,
          intake: 1800,
          protein: 160,
        },
      },
    };
  f.c.seed = legacy;
  f.run("state=JSON.parse(JSON.stringify(seed));migrate()");
  assert.deepEqual(JSON.parse(f.storage.get("balance-before-v2")), legacy);
  assert.equal(
    f.run("progress('2026-11-01').remaining"),
    f.run("progress('2026-11-02').remaining"),
  );
  assert.equal(f.run("state.entries['2026-11-01'].diaryStatus"), "unreviewed");
  assert.equal(f.run("state.entries['2026-11-01'].expenseSnapshot"), 2800);
  const backup = f.storage.get("balance-before-v2");
  f.run("migrate()");
  assert.equal(f.storage.get("balance-before-v2"), backup);
  assert(f.run("cycle('2027-04-02').deficit") <= 500);
  assert.equal(f.run("stats().burned"), 2000);
  assert.equal(f.run("M.quality(state,'2026-11-02').complete"), 0);
});
test("failed migration does not partially change or erase legacy diary", () => {
  const f = fixture();
  f.c.seed = { profile, entries: {} };
  f.run("state=JSON.parse(JSON.stringify(seed))");
  f.failWrite();
  assert.equal(f.run("migrate()"), false);
  assert.equal(f.run("state.schemaVersion"), undefined);
});
test("state mutations roll back on storage failure", () => {
  const f = fixture();
  f.c.seed = { profile, entries: {}, schemaVersion: 2 };
  f.run("state=JSON.parse(JSON.stringify(seed))");
  f.failWrite();
  assert.equal(f.run("mutate(()=>{state.habit='changed'})"), false);
  assert.equal(f.run("state.habit"), undefined);
});
test("v2 backup restores all extended data and rejects malformed fields atomically", () => {
  const f = fixture();
  f.c.seed = { profile, entries: {} };
  f.run(
    'state=JSON.parse(JSON.stringify(seed));migrate();state.measurements[today()]={weight:101,waist:100,conditions:"morning",time:"08:00"};state.habit="Прогулка";validateBackup(state)',
  );
  f.c.bad = JSON.parse(f.run("JSON.stringify(state)"));
  f.c.bad.measurements[f.run("today()")].weight = "101";
  assert.throws(() => f.run("validateBackup(bad)"));
  f.c.bad = JSON.parse(f.run("JSON.stringify(state)"));
  f.c.bad.planHistory[0].rate = 5;
  assert.throws(() => f.run("validateBackup(bad)"));
  f.c.bad = JSON.parse(f.run("JSON.stringify(state)"));
  f.c.bad.entries["2026-11-01"] = {
    weight: null,
    mode: "0",
    spent: null,
    intake: 1000,
    protein: 100,
    wellbeing: { energy: 10 },
  };
  assert.throws(() => f.run("validateBackup(bad)"));
  assert.equal(f.run("state.habit"), "Прогулка");
});
test("new plan affects future expenses without rewriting snapshots; report includes raw proof", () => {
  const f = fixture();
  f.c.seed = {
    profile,
    entries: {
      "2026-11-01": {
        weight: 100,
        mode: "0",
        spent: null,
        intake: 1800,
        protein: 160,
      },
    },
  };
  f.run("state=JSON.parse(JSON.stringify(seed));migrate()");
  const before = f.run("expense(state.entries['2026-11-01'],'2026-11-01')");
  f.run(
    "appendPlan({...M.planAt(state,today()),calibratedExpense:2700},'test')",
  );
  assert.equal(
    f.run("expense(state.entries['2026-11-01'],'2026-11-01')"),
    before,
  );
  assert.equal(f.run("expense({mode:'0'},today())"), 2700);
  const report = f.run("reportData()");
  assert.equal(report.algorithmVersion, "2.0.0");
  assert(report.raw.entries["2026-11-01"]);
  assert(report.limitations.length);
});
