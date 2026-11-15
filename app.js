const KEY = "balance-v1",
  DAY = 86400000,
  $ = (s) => document.querySelector(s),
  M = BalanceModel;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },
  date = (s) => new Date(s + "T12:00:00"),
  diff = (a, b) => Math.round((date(b) - date(a)) / DAY),
  fmt = (n, d = 0) =>
    Number(n).toLocaleString("ru-RU", { maximumFractionDigits: d }),
  long = (s) =>
    date(s).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
let state = { profile: null, entries: {} },
  tab = "calendar",
  month = date(today()),
  selected = null,
  installPrompt;
try {
  const saved = JSON.parse(localStorage.getItem(KEY));
  if (saved?.profile) state = saved;
} catch (e) {}
function toast(t) {
  $("#toast").textContent = t;
  $("#toast").style.display = "block";
  setTimeout(() => ($("#toast").style.display = "none"), 3000);
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    toast(
      "Не удалось сохранить: проверьте свободное место и доступ к хранилищу",
    );
    return false;
  }
}
function age(b, on) {
  const x = date(b),
    y = date(on);
  return (
    y.getFullYear() -
    x.getFullYear() -
    (y.getMonth() < x.getMonth() ||
    (y.getMonth() === x.getMonth() && y.getDate() < x.getDate())
      ? 1
      : 0)
  );
}
function bmr(p, on = p.start) {
  return (
    10 * p.weight +
    6.25 * p.height -
    5 * age(p.birthday, on) +
    (p.metabolicSex === "female" ? -161 : 5)
  );
}
function cycleDate(n) {
  const p = state.profile,
    d = date(p.start),
    last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  const x = new Date(
    d.getFullYear(),
    d.getMonth() + n,
    Math.min(d.getDate(), last),
    12,
  );
  return (
    x.getFullYear() +
    "-" +
    String(x.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(x.getDate()).padStart(2, "0")
  );
}
function cycle(on) {
  const p = state.profile,
    d = date(on),
    a = date(p.start);
  let n = Math.max(
    0,
    (d.getFullYear() - a.getFullYear()) * 12 + d.getMonth() - a.getMonth(),
  );
  if (cycleDate(n) > on) n = Math.max(0, n - 1);
  const start = cycleDate(n),
    latest = M.weights(state, on)
      .filter(([day]) => day < start)
      .at(-1),
    weight = latest ? latest[1].weight : p.weight,
    base = bmr({ ...p, weight }, start),
    config = M.planAt(state, on),
    spent =
      config.calibratedExpense ??
      base * [1.2, 1.35, 1.55][Number(config.activity || 0)];
  return {
    start,
    next: cycleDate(n + 1),
    weight,
    base,
    deficit: M.plan(state, on, spent).deficit,
  };
}
function expense(e, on) {
  if (e.mode === "custom") return Number(e.spent);
  if (Number.isFinite(e.expenseSnapshot)) return e.expenseSnapshot;
  const config = M.planAt(state, on),
    factors = [1.2, 1.35, 1.55];
  return config.calibratedExpense
    ? (config.calibratedExpense * factors[Number(e.mode)]) /
        factors[Number(config.activity)]
    : cycle(on).base * factors[Number(e.mode)];
}
function targetFor(d) {
  return state.entries[d]?.targetSnapshot ?? cycle(d).deficit;
}
function records() {
  return Object.entries(state.entries)
    .filter(([d]) => d >= state.profile.start && d <= today())
    .sort(([a], [b]) => a.localeCompare(b));
}
function progress(on) {
  const p = state.profile,
    last = M.weights(state, on).at(-1),
    weight = last?.[1].weight ?? p.weight,
    total = p.weight - p.goal,
    pc =
      total > 0
        ? Math.max(0, Math.min(100, ((p.weight - weight) / total) * 100))
        : 0;
  return {
    weight,
    remaining: Math.max(0, (weight - p.goal) * 7700),
    pc,
    green: pc,
    measuredOn: last?.[0] || p.start,
  };
}
function stats() {
  const p = state.profile,
    r = records(),
    total = (p.weight - p.goal) * 7700,
    burned = r
      .filter(([, e]) => M.status(e) === "complete")
      .reduce((s, [d, e]) => s + expense(e, d) - e.intake, 0);
  return {
    r,
    total,
    burned,
    ...progress(today()),
    cycle: cycle(today()),
    days: Math.max(0, diff(today(), p.deadline)),
    planDays: diff(p.start, p.deadline),
  };
}
function currentPlan(on = today()) {
  const config = M.planAt(state, on),
    base = cycle(on).base,
    spent =
      config.calibratedExpense ??
      base * [1.2, 1.35, 1.55][Number(config.activity || 0)];
  return M.plan(state, on, spent);
}
function migrate() {
  if (!state.profile || state.schemaVersion === 2) return true;
  const before = JSON.stringify(state);
  try {
    localStorage.setItem("balance-before-v2", before);
  } catch (e) {
    toast("Не удалось создать копию перед обновлением");
    return false;
  }
  for (const [d, e] of Object.entries(state.entries)) {
    e.expenseSnapshot = expense(e, d);
    e.targetSnapshot = Math.min(500, Math.max(0, cycle(d).deficit));
    e.diaryStatus = "unreviewed";
  }
  state.measurements ||= {};
  state.templates ||= [];
  state.planHistory ||= [
    {
      effective: today(),
      createdAt: new Date().toISOString(),
      mode: "loss",
      rate: 0.5,
      minIntake: 1500,
      activity: "0",
      calibratedExpense: null,
      reason: "migration",
    },
  ];
  state.schemaVersion = 2;
  state.algorithmVersion = M.VERSION;
  state.study ||= { start: today(), baselineDays: 14, interventionDays: 56 };
  if (!save()) {
    state = JSON.parse(before);
    return false;
  }
  return true;
}
function mutate(change) {
  const before = JSON.stringify(state);
  try {
    change();
    if (save()) return true;
    state = JSON.parse(before);
  } catch (e) {
    state = JSON.parse(before);
    toast(e.message);
  }
  return false;
}
function downloadJSON(name, data) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function setup(edit = false) {
  $("#nav").hidden = true;
  const p = state.profile || {};
  $("#main").innerHTML =
    `<div class="intro"><p class="eyebrow">ВАШ ПЕРВЫЙ ШАГ</p><h1>${edit ? "Настроим ваш план" : "Меньше догадок.<br>Больше баланса."}</h1><p class="muted">Исходные данные, чтобы увидеть ориентир<br>и двигаться к ней день за днём.</p></div><form id="setupForm" class="card"><h3>Ваша точка старта</h3><div class="two"><label>Рост, см<input name="height" type="number" min="100" max="250" step="0.1" value="${p.height || ""}" placeholder="190" required></label><label>Начальный вес, кг<input name="weight" type="number" min="30" max="500" step="0.1" value="${p.weight || ""}" placeholder="107" required></label></div><label>Желаемый вес, кг<input name="goal" type="number" min="30" max="500" step="0.1" value="${p.goal || ""}" placeholder="90" required></label><label>Дата рождения<input name="birthday" type="date" value="${p.birthday || ""}" max="${today()}" required></label><label>Желаемая дата (не повышает дефицит)<input name="deadline" type="date" value="${p.deadline || ""}" min="${today()}" required></label><label>Коэффициент формулы обмена<select name="metabolicSex"><option value="male" ${p.metabolicSex !== "female" ? "selected" : ""}>Мужской (+5)</option><option value="female" ${p.metabolicSex === "female" ? "selected" : ""}>Женский (−161)</option></select></label><div class="note">Формула даёт стартовую оценку расхода. Дедлайн — пожелание; план питания не ужесточается при отставании. Расчёт: 10 × вес + 6,25 × рост − 5 × возраст + выбранный коэффициент. Расход зависит от режима дня. Это ориентировочная модель, а не измерение обмена веществ.</div><button class="primary wide">${edit ? "Сохранить настройки" : "Рассчитать мой план →"}</button>${edit ? '<button type="button" class="text wide" id="cancelSetup">Назад</button>' : ""}</form><p class="form-footer">Без регистрации. Ваши записи хранятся в этом браузере.</p>`;
  $("#setupForm").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      n = { ...p, ...Object.fromEntries(f) };
    ["height", "weight", "goal"].forEach((k) => (n[k] = Number(n[k])));
    if (n.goal >= n.weight)
      return toast("Желаемый вес должен быть меньше начального");
    if (age(n.birthday, today()) < 18 || age(n.birthday, today()) > 100)
      return toast("Расчёт предназначен для взрослых от 18 до 100 лет");
    if (diff(today(), n.deadline) <= 0)
      return toast("Выберите будущую дату дедлайна");
    n.start = p.start || today();
    n.proteinFactor = p.proteinFactor || 1.6;
    const prev = state.profile;
    state.profile = n;
    if (save()) {
      migrate();
      render();
      window.dispatchEvent(new Event("balance-profile-ready"));
    } else state.profile = prev;
  };
  if (edit) $("#cancelSetup").onclick = render;
}
function hero() {
  const s = stats(),
    t = M.trend(state, today()),
    p = currentPlan(),
    q = M.quality(state, M.add(today(), -1)),
    f = M.forecast(state, today());
  return `<section class="card hero"><p class="eyebrow">${p.mode === "maintenance" ? "УДЕРЖАНИЕ ВЕСА" : "ВАША ДИНАМИКА"}</p><div class="hero-top"><div><div class="big">${fmt(t.value ?? s.weight, 1)} <span>кг · ${t.value === null ? (t.latest ? "последний вес" : "старт") : "тренд"}</span></div><small>${t.value === null ? `${long(s.measuredOn)} · Для тренда нужны 3 взвешивания за 7 дней` : `Последнее: ${fmt(s.weight, 1)} кг · ${long(s.measuredOn)}`}</small></div><div class="ring" style="--progress:${s.pc}%;--green-progress:${s.pc}%"><div>${fmt(s.pc)}%</div></div></div><div class="hero-bottom"><div><small>Темп за 28 дней</small><b>${t.rate === null ? "Мало данных" : (t.rate >= 0 ? "−" : "+") + fmt(Math.abs(t.rate), 2) + " кг/нед."}</b></div><div><small>Питание сегодня</small><b>${fmt(p.low)}–${fmt(p.high)} ккал</b></div><div><small>Полных дней</small><b>${q.complete} / ${q.total}</b></div></div><p class="hero-note">${f.available ? `При текущем темпе: ${long(f.earliest)} — ${long(f.latest)}. Это сценарий, не обещание.` : f.reason}</p>${p.mode === "maintenance" ? `<small>Ориентир удержания: ${fmt(p.maintenanceWeight - 1, 1)}–${fmt(p.maintenanceWeight + 1, 1)} кг. Оценивайте тренд, а не отдельный скачок.</small>` : ""}</section>`;
}
function render() {
  if (!state.profile) return setup();
  $("#nav").hidden = false;
  document
    .querySelectorAll("nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.body.classList.toggle("calendar-page", tab === "calendar");
  if (tab === "calendar") calendar();
  if (tab === "charts") charts();
  if (tab === "foods" && window.renderFoods) window.renderFoods();
  if (tab === "plan") plan();
}
function calendar() {
  const now = today(),
    s = stats(),
    p = currentPlan(),
    entry = state.entries[now],
    recordStatus = M.status(entry),
    eaten = entry?.intake;
  $("#main").innerHTML =
    `${hero()}<section class="card today-card"><div class="section-head"><h2>Сегодня</h2><span class="pill">${statusLabel(recordStatus)}</span></div><p>${eaten == null ? "Питание ещё не записано" : `Записано ${fmt(eaten)} ккал · ориентир ${fmt(p.low)}–${fmt(p.high)} ккал`}</p>${eaten != null ? `<small>${recordStatus === "complete" ? "Дневник завершён." : "Пока день не завершён, дефицит не подтверждён."}</small>` : ""}<div class="actions"><button class="primary" id="addToday">${entry ? "Редактировать питание" : "Записать питание"}</button><button data-measure>＋ Вес / талия</button></div>${entry && recordStatus !== "complete" ? '<button class="text" id="completeToday">Всё питание за день внесено</button>' : ""}<label class="habit-check"><input type="checkbox" id="habitDone" ${state.measurements?.[now]?.habitDone ? "checked" : ""}> ${esc(state.habit || "Сделать короткую прогулку")}</label></section><div class="section-head"><h2>Дневник</h2><span class="pill">${s.r.length} дней питания</span></div><section class="card calendar-card"><div class="calendar-head"><h3 style="margin:0;text-transform:capitalize">${month.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}</h3><div class="arrows"><button id="prev" aria-label="Предыдущий месяц">‹</button><button id="next" aria-label="Следующий месяц">›</button></div></div><div class="week">${["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС", "Полнота"].map((x) => `<span>${x}</span>`).join("")}</div><div class="days" id="days"></div><div class="legend"><span class="legend-good">● В диапазоне</span><span class="legend-low">● Ниже дефицита</span><span class="legend-excess">● Выше дефицита</span><span>○ Неполные / непроверенные</span></div></section>${weeklyCard()}<button class="text wide" data-chatgpt>Импорт / экспорт ChatGPT</button>`;
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12),
    offset = (first.getDay() + 6) % 7,
    count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(),
    slots = Math.ceil((offset + count) / 7) * 7;
  let cells = "";
  for (let w = 0; w < slots; w += 7) {
    let full = 0,
      eligible = 0;
    for (let j = 0; j < 7; j++) {
      const num = w + j - offset + 1,
        dt = new Date(month.getFullYear(), month.getMonth(), num, 12),
        d =
          dt.getFullYear() +
          "-" +
          String(dt.getMonth() + 1).padStart(2, "0") +
          "-" +
          String(dt.getDate()).padStart(2, "0");
      if (d >= state.profile.start && d < now) {
        eligible++;
        if (M.status(state.entries[d]) === "complete") full++;
      }
      if (num < 1 || num > count) {
        cells += "<span></span>";
        continue;
      }
      const e = state.entries[d],
        kind = e ? M.classify(state, d, expense(e, d)) : "",
        measured = M.measurements(state, d).some(
          ([x, m]) => x === d && Number.isFinite(m.weight),
        );
      cells += `<button data-date="${d}" class="${d === now ? "today " : ""}${kind}" ${d < state.profile.start || d > now ? "disabled" : ""} aria-label="${long(d)}, ${statusLabel(M.status(e))}${measured ? ", есть взвешивание" : ""}">${num}${measured ? '<i class="weighed-dot"></i>' : ""}</button>`;
    }
    cells += `<span class="week-score" title="Завершённые дневники / прошедшие дни недели">${eligible ? full + "/" + eligible : "—"}</span>`;
  }
  $("#days").innerHTML = cells;
  $("#prev").onclick = () => {
    month = new Date(month.getFullYear(), month.getMonth() - 1, 1, 12);
    calendar();
  };
  $("#next").onclick = () => {
    month = new Date(month.getFullYear(), month.getMonth() + 1, 1, 12);
    calendar();
  };
  $("#days").onclick = (e) => {
    const b = e.target.closest("[data-date]");
    if (b && !b.disabled) openDay(b.dataset.date);
  };
  $("#addToday").onclick = () => openDay(now);
  if ($("#completeToday"))
    $("#completeToday").onclick = () => {
      if (
        mutate(() => {
          state.entries[now].diaryStatus = "complete";
        })
      )
        render();
    };
  $("#habitDone").onchange = (e) => {
    const checked = e.target.checked;
    if (
      !mutate(() => {
        state.measurements ||= {};
        state.measurements[now] = {
          ...(state.measurements[now] || {}),
          habitDone: checked,
        };
      })
    )
      e.target.checked = !checked;
  };
  bindReview();
}
function statusLabel(value) {
  return (
    {
      complete: "День завершён",
      partial: "Внесена часть",
      unreviewed: "Полнота не проверена",
      missing: "Нет питания",
    }[value] || value
  );
}
function openDay(d) {
  selected = d;
  const e = state.entries[d] || {
      weight: "",
      intake: "",
      protein: "",
      mode: M.planAt(state, d).activity || "0",
      spent: "",
    },
    f = $("#dayForm");
  f.reset();
  $("#dayTitle").textContent = date(d).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
  for (const k of [
    "weight",
    "intake",
    "protein",
    "spent",
    "fat",
    "carbs",
    "fiber",
  ])
    f.elements[k].value =
      e[k] ??
      (["fat", "carbs", "fiber"].includes(k)
        ? (BalanceImport.nutrients(e)[k] ?? "")
        : "");
  f.elements.weight.value =
    Object.fromEntries(M.measurements(state, today()))[d]?.weight ??
    e.weight ??
    "";
  f.elements.mode.value = e.mode;
  f.elements.diaryStatus.value = e.diaryStatus || "partial";
  for (const k of ["steps", "sleep", "hunger", "energy", "trackingMinutes"])
    f.elements[k].value = e.wellbeing?.[k] ?? "";
  $("#deleteDay").hidden = !state.entries[d];
  updateEstimate();
  if (window.showChatDetails) window.showChatDetails(d);
  $("#dayDialog").showModal();
}
function updateEstimate() {
  const f = $("#dayForm"),
    mode = f.elements.mode.value;
  f.elements.spent.hidden = mode !== "custom";
  $("#customHint").hidden = mode === "custom";
  f.elements.spent.required = mode === "custom";
  const spent =
    mode === "custom"
      ? Number(f.elements.spent.value)
      : expense({ mode }, selected);
  $("#dayEstimate").textContent =
    `Расход: ${fmt(spent)} ккал${f.elements.intake.value !== "" ? " · Баланс по внесённому: " + fmt(spent - Number(f.elements.intake.value)) + " ккал" : ""} · Цель белка: ${fmt(proteinTarget(selected), 1)} г`;
}
$("#dayForm").oninput = updateEstimate;
$("#closeDay").onclick = () => $("#dayDialog").close();
$("#dayForm").onsubmit = (e) => {
  e.preventDefault();
  const f = e.target,
    entry = {
      ...(state.entries[selected] || {}),
      weight:
        f.elements.weight.value === "" ? null : Number(f.elements.weight.value),
      mode: f.elements.mode.value,
      spent:
        f.elements.mode.value === "custom"
          ? Number(f.elements.spent.value)
          : null,
      intake: Number(f.elements.intake.value),
      protein: Number(f.elements.protein.value),
      diaryStatus: f.elements.diaryStatus.value,
      wellbeing: Object.fromEntries(
        ["steps", "sleep", "hunger", "energy", "trackingMinutes"]
          .filter((k) => f.elements[k].value !== "")
          .map((k) => [k, Number(f.elements[k].value)]),
      ),
    },
    old = state.entries[selected];
  for (const k of ["fat", "carbs", "fiber"])
    entry[k] = f.elements[k].value === "" ? null : Number(f.elements[k].value);
  if (entry.chatgpt) {
    entry.chatgpt = JSON.parse(JSON.stringify(entry.chatgpt));
    const sum = BalanceImport.totals(entry.chatgpt.foods || []);
    entry.chatgpt.baseline = {
      calories: entry.intake - sum.calories,
      protein: entry.protein - sum.protein,
    };
    for (const k of ["fat", "carbs", "fiber"]) {
      if (entry[k] != null) entry.chatgpt.baseline[k] = entry[k] - sum[k];
    }
  }
  entry.expenseSnapshot =
    old &&
    entry.mode === old.mode &&
    entry.spent === old.spent &&
    Number.isFinite(old.expenseSnapshot)
      ? old.expenseSnapshot
      : expense({ mode: entry.mode, spent: entry.spent }, selected);
  entry.targetSnapshot = old?.targetSnapshot ?? cycle(selected).deficit;
  entry.recordedAt = new Date().toISOString();
  const oldMeasurement = state.measurements?.[selected];
  state.measurements ||= {};
  if (entry.weight !== null || oldMeasurement?.weight != null)
    state.measurements[selected] = {
      ...(oldMeasurement || {}),
      weight: entry.weight,
      source: "manual",
      recordedAt: new Date().toISOString(),
    };
  state.entries[selected] = entry;
  if (save()) {
    $("#dayDialog").close();
    render();
    toast("День сохранён");
  } else {
    if (old) state.entries[selected] = old;
    else delete state.entries[selected];
    if (oldMeasurement) state.measurements[selected] = oldMeasurement;
    else delete state.measurements[selected];
  }
};
$("#deleteDay").onclick = () => {
  if (!confirm("Удалить запись за этот день?")) return;
  const old = state.entries[selected],
    oldMeasurements = JSON.stringify(state.measurements || {});
  if (Number.isFinite(old?.weight) && !state.measurements?.[selected]) {
    state.measurements ||= {};
    state.measurements[selected] = {
      weight: old.weight,
      source: "legacy",
      conditions: "unknown",
    };
  }
  delete state.entries[selected];
  if (save()) {
    $("#dayDialog").close();
    render();
  } else {
    state.entries[selected] = old;
    state.measurements = JSON.parse(oldMeasurements);
  }
};
let rangeDays = 30,
  chartView = "energy";
const chartHidden = new Set();
function proteinTarget(on) {
  return cycle(on).weight * (state.profile.proteinFactor || 1.6);
}
function chartSeries(r) {
  const series = (id, label, unit, color, value, extra = {}) => ({
    id,
    label,
    unit,
    color,
    items: r.map(([d, e]) => [d, value(d, e)]),
    ...extra,
  });
  if (chartView === "energy")
    return [
      series("intake", "Съедено", "ккал", "#739348", (d, e) => e.intake),
      series(
        "expense",
        "Расход",
        "ккал",
        "#48796b",
        (d, e) => (Number.isFinite(e.intake) ? expense(e, d) : null),
        { dash: true },
      ),
      series("deficit", "Дефицит", "ккал", "#dc9865", (d, e) =>
        M.status(e) === "complete" ? expense(e, d) - e.intake : null,
      ),
      series(
        "target",
        "Целевой дефицит",
        "ккал",
        "#8997bb",
        (d) => targetFor(d),
        { dash: true },
      ),
    ];
  if (chartView === "nutrients")
    return [
      series("protein", "Белок", "г", "#647cb2", (d, e) => e.protein, {
        target: (d) => proteinTarget(d),
      }),
      series(
        "proteinTarget",
        "Цель белка",
        "г",
        "#647cb2",
        (d) => proteinTarget(d),
        { dash: true },
      ),
      ...[
        ["fat", "Жиры", "#d6a35a"],
        ["carbs", "Углеводы", "#829fc4"],
        ["fiber", "Клетчатка", "#79a36a"],
      ].map(([key, label, color]) =>
        series(
          key,
          label,
          "г",
          color,
          (d, e) => BalanceImport.nutrients(e)[key],
        ),
      ),
    ];
  if (chartView === "weight")
    return [
      {
        id: "trend",
        label: "Тренд 7 дней",
        unit: "кг",
        color: "#b18a43",
        items: r.map(([d]) => [d, M.trend(state, d).value]),
      },
      series("weight", "Вес", "кг", "#48796b", (d, e) => e.weight),
      series("goal", "Целевой вес", "кг", "#8997bb", () => state.profile.goal, {
        dash: true,
      }),
    ];
  return [
    series(
      "remaining",
      "Осталось сжечь",
      "ккал",
      "#739348",
      (d) => progress(d).remaining,
    ),
  ];
}
function combinedChart(r, series) {
  if (!r.length)
    return '<div class="empty">Здесь появится ваш прогресс.<br>Добавьте первую запись в календаре.</div>';
  const visible = series.filter((s) => !chartHidden.has(s.id)),
    values = visible.flatMap((s) =>
      s.items.map(([, v]) => v).filter(Number.isFinite),
    );
  if (!values.length)
    return '<div class="empty">Нет значений для выбранных показателей.</div>';
  const min = Math.min(...values),
    max = Math.max(...values),
    pad = Math.max(1, (max - min) * 0.1),
    lo = chartView === "weight" ? Math.max(0, min - pad) : Math.min(0, min),
    hi = chartView === "weight" ? max + pad : Math.max(1, max),
    x = (d) =>
      48 +
      (r.length === 1
        ? 144
        : (diff(r[0][0], d) / Math.max(1, diff(r[0][0], r.at(-1)[0]))) * 288),
    y = (v) => 190 - ((v - lo) / (hi - lo)) * 164;
  const lines = visible
    .map((s) => {
      let segments = [],
        current = [];
      for (const [d, v] of s.items) {
        if (Number.isFinite(v)) current.push([d, v]);
        else if (current.length) {
          segments.push(current);
          current = [];
        }
      }
      if (current.length) segments.push(current);
      return (
        segments
          .map(
            (points) =>
              `<polyline points="${points.length === 1 && s.dash ? `48,${y(points[0][1])} 336,${y(points[0][1])}` : points.map(([d, v]) => `${x(d)},${y(v)}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="${s.dash ? 1.7 : 2.5}" ${s.dash ? 'stroke-dasharray="6 4"' : ""} stroke-linejoin="round"/>`,
          )
          .join("") +
        (s.dash
          ? ""
          : s.items
              .filter(([, v]) => Number.isFinite(v))
              .map(
                ([d, v]) =>
                  `<circle cx="${x(d)}" cy="${y(v)}" r="3" fill="${s.target ? (v >= s.target(d) ? "#719a4f" : "#d6ad42") : s.color}"><title>${long(d)} · ${s.label}: ${fmt(v, 1)} ${s.unit}</title></circle>`,
              )
              .join(""))
      );
    })
    .join("");
  return `<svg class="chart combined-chart" viewBox="0 0 360 220" role="img" aria-label="${visible.map((s) => s.label).join(", ")}; ${visible[0].unit}; от ${long(r[0][0])} до ${long(r.at(-1)[0])}"><text x="48" y="14">${visible[0].unit}</text>${[0, 0.5, 1].map((t) => `<line x1="48" x2="336" y1="${26 + t * 164}" y2="${26 + t * 164}" stroke="#e9ede2"/><text x="42" y="${30 + t * 164}" text-anchor="end">${fmt(hi - t * (hi - lo), chartView === "weight" ? 1 : 0)}</text>`).join("")}${lo <= 0 ? `<line x1="48" x2="336" y1="${y(0)}" y2="${y(0)}" stroke="#60756c" stroke-width="1.5"><title>Ноль</title></line>` : ""}${lines}</svg><div class="chart-caption"><span>${long(r[0][0])}</span><span>${long(r.at(-1)[0])}</span></div>`;
}
function charts() {
  const s = stats(),
    timeline = new Map(s.r);
  for (const [d, m] of M.measurements(state, today()))
    timeline.set(d, {
      ...(timeline.get(d) || {}),
      weight: m.weight ?? timeline.get(d)?.weight ?? null,
    });
  const r = [...timeline]
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([d]) => rangeDays === 0 || diff(d, today()) < rangeDays),
    series = chartSeries(r),
    visible = series.filter((s) => !chartHidden.has(s.id));
  $("#main").innerHTML =
    `<div class="section-head"><div><p class="eyebrow">КАРТИНА В ЦЕЛОМ</p><h1>Ваш прогресс</h1></div><select id="range" class="chart-select" aria-label="Период графика"><option value="7">7 дней</option><option value="30">30 дней</option><option value="0">Всё время</option></select></div><div class="stat-grid"><div class="stat"><small>Расчёт по завершённым дням</small><strong>${fmt(s.burned)}</strong><em>ккал · оценка расхода</em></div><div class="stat"><small>Последний вес</small><strong>${fmt(s.weight, 1)}</strong><em>кг · цель ${fmt(state.profile.goal, 1)}</em></div></div><section class="card"><div class="chart-tabs" role="group" aria-label="Показатели графика">${[
      ["energy", "Калории"],
      ["nutrients", "Нутриенты"],
      ["weight", "Вес"],
      ["remaining", "Осталось сжечь"],
    ]
      .map(
        ([id, label]) =>
          `<button type="button" data-view="${id}" aria-pressed="${chartView === id}">${label}</button>`,
      )
      .join(
        "",
      )}</div><div class="chart-toggles" role="group" aria-label="Линии графика">${series.map((s) => `<button type="button" data-series="${s.id}" aria-pressed="${!chartHidden.has(s.id)}"><i style="border-color:${s.color};border-top-style:${s.dash ? "dashed" : "solid"}"></i>${s.label}</button>`).join("")}${chartView === "energy" ? '<span class="zero-key">— Ноль</span>' : ""}</div>${combinedChart(r, series)}${r.length ? `<details class="chart-values"><summary>Все значения</summary><div class="chart-table"><table><thead><tr><th scope="col">Дата</th>${visible.map((s) => `<th scope="col">${s.label}, ${s.unit}</th>`).join("")}</tr></thead><tbody>${r.map(([d], i) => `<tr><th scope="row">${long(d)}</th>${visible.map((s) => `<td>${Number.isFinite(s.items[i][1]) ? fmt(s.items[i][1], 1) : "—"}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>` : ""}</section><p class="form-footer">Нажмите на название линии, чтобы скрыть или показать её. Пунктир — ориентиры. Пропуски дат сохранены. Дефицит показан только для завершённых дней. Тренд веса: среднее за 7 дней при 3 измерениях. «Осталось сжечь» — грубый эквивалент массы, не измеренный запас энергии. Отрицательный дефицит означает профицит.</p>`;
  $("#range").value = rangeDays;
  $("#range").onchange = (e) => {
    rangeDays = Number(e.target.value);
    charts();
  };
  document.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        chartView = b.dataset.view;
        charts();
      }),
  );
  document.querySelectorAll("[data-series]").forEach(
    (b) =>
      (b.onclick = () => {
        const id = b.dataset.series;
        if (chartHidden.has(id)) chartHidden.delete(id);
        else chartHidden.add(id);
        charts();
      }),
  );
}
function validateBackup(d) {
  const p = d?.profile;
  if (
    !p ||
    !d.entries ||
    typeof d.entries !== "object" ||
    Array.isArray(d.entries)
  )
    throw Error("нет плана или записей");
  if (
    ![p.height, p.weight, p.goal].every(Number.isFinite) ||
    p.height < 100 ||
    p.height > 250 ||
    p.weight < 30 ||
    p.weight > 500 ||
    p.goal < 30 ||
    p.goal >= p.weight
  )
    throw Error("неверные параметры");
  if (
    ![p.start, p.birthday, p.deadline].every(M.validDate) ||
    p.start > today() ||
    diff(p.start, p.deadline) <= 0 ||
    age(p.birthday, p.start) < 18 ||
    age(p.birthday, p.start) > 100
  )
    throw Error("неверные даты");
  if (
    p.proteinFactor !== undefined &&
    (!Number.isFinite(p.proteinFactor) ||
      p.proteinFactor < 0.1 ||
      p.proteinFactor > 5)
  )
    throw Error("коэффициент белка");
  if (
    p.metabolicSex !== undefined &&
    !["male", "female"].includes(p.metabolicSex)
  )
    throw Error("коэффициент формулы");
  if (
    d.importIds !== undefined &&
    (!Array.isArray(d.importIds) ||
      d.importIds.some(
        (id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(id),
      ))
  )
    throw Error("история импортов");
  for (const [day, e] of Object.entries(d.entries)) {
    if (
      !M.validDate(day) ||
      day < p.start ||
      day > today() ||
      !e ||
      !["0", "1", "2", "custom"].includes(e.mode) ||
      !Number.isFinite(e.intake) ||
      e.intake < 0 ||
      e.intake > 20000 ||
      !Number.isFinite(e.protein) ||
      e.protein < 0 ||
      e.protein > 1500 ||
      !(
        e.weight === null ||
        (Number.isFinite(e.weight) && e.weight >= 20 && e.weight <= 500)
      ) ||
      (e.mode === "custom" &&
        (!Number.isFinite(e.spent) || e.spent <= 0 || e.spent > 20000))
    )
      throw Error("неверная запись дня");
    for (const k of ["fat", "carbs", "fiber"])
      if (e[k] != null && (!Number.isFinite(e[k]) || e[k] < 0 || e[k] > 1500))
        throw Error("нутриент");
    if (
      e.diaryStatus !== undefined &&
      !["complete", "partial", "unreviewed"].includes(e.diaryStatus)
    )
      throw Error("полнота дня");
    for (const k of ["expenseSnapshot", "targetSnapshot"])
      if (e[k] != null && (!Number.isFinite(e[k]) || e[k] < 0 || e[k] > 20000))
        throw Error("снимок расчёта");
    validateWellbeing(e.wellbeing);
    if (e.chatgpt) {
      BalanceImport.parse(
        {
          schemaVersion: 1,
          date: day,
          foods: e.chatgpt.foods || [],
          exercises: e.chatgpt.exercises || [],
        },
        { start: p.start, today: today() },
      );
    }
  }
  validateExtendedBackup(d);
}
/* APP_BOOTSTRAP */
migrate();
document.querySelectorAll("nav button").forEach(
  (b) =>
    (b.onclick = () => {
      tab = b.dataset.tab;
      render();
      window.scrollTo(0, 0);
    }),
);
$("#settings").onclick = () => {
  if (state.profile) {
    tab = "plan";
    render();
  } else setup();
};
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloading) {
      reloading = true;
      location.reload();
    }
  });
  navigator.serviceWorker
    .register("./sw.js", { updateViaCache: "none" })
    .then((reg) => reg.update())
    .catch(() => {});
}
render();
