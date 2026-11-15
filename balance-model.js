/* Pure calculations. No DOM, storage, network or AI decisions. */
(function (root) {
  "use strict";
  const VERSION = "2.0.0",
    DAY = 86400000;
  const validDate = (s) =>
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !isNaN(Date.parse(s)) &&
    new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;
  const days = (a, b) =>
    Math.round(
      (Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DAY,
    );
  const add = (d, n) =>
    new Date(Date.parse(d + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
  const finite = Number.isFinite,
    clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
    round = (v, step = 1) => Math.round(v / step) * step;
  const mean = (a) =>
    a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const median = (a) => {
    const b = [...a].sort((a, b) => a - b);
    return b.length
      ? (b[Math.floor((b.length - 1) / 2)] + b[Math.ceil((b.length - 1) / 2)]) /
          2
      : null;
  };
  function measurements(state, on) {
    const result = new Map();
    for (const [d, e] of Object.entries(state.entries || {}))
      if (d >= state.profile.start && d <= on && finite(e.weight))
        result.set(d, {
          weight: e.weight,
          source: "legacy",
          conditions: "unknown",
        });
    for (const [d, m] of Object.entries(state.measurements || {}))
      if (d >= state.profile.start && d <= on)
        result.set(d, { ...(result.get(d) || {}), ...m });
    return [...result].sort(([a], [b]) => a.localeCompare(b));
  }
  function weights(state, on) {
    return measurements(state, on).filter(([, m]) => finite(m.weight));
  }
  function trend(state, on) {
    const rows = weights(state, on),
      recent = rows.filter(([d]) => days(d, on) < 28),
      fresh = recent.filter(([d]) => days(d, on) < 7),
      points = recent.map(([d]) => {
        const a = rows.filter(([x]) => x <= d && days(x, d) < 7);
        return [d, a.length >= 3 ? mean(a.map(([, m]) => m.weight)) : null];
      });
    const slopes = [];
    for (let i = 0; i < recent.length; i++)
      for (let j = i + 1; j < recent.length; j++) {
        const span = days(recent[i][0], recent[j][0]);
        if (span >= 7)
          slopes.push(((recent[i][1].weight - recent[j][1].weight) * 7) / span);
      }
    const span = recent.length ? days(recent[0][0], recent.at(-1)[0]) : 0,
      rate =
        recent.length >= 4 && span >= 14 && fresh.length >= 1
          ? median(slopes)
          : null;
    return {
      points,
      latest: rows.at(-1) || null,
      value: fresh.length >= 3 ? mean(fresh.map(([, m]) => m.weight)) : null,
      count: recent.length,
      span,
      rate,
      spread:
        rate === null ? null : median(slopes.map((v) => Math.abs(v - rate))),
      stale: !fresh.length,
    };
  }
  const status = (e) => (!e ? "missing" : e.diaryStatus || "unreviewed");
  // Legacy/unreviewed nutrition remains visible as an estimate. Explicitly partial
  // days and measurement-only dates have no daily deficit outcome.
  function hasDeficit(e) {
    return (
      !!e && finite(e.intake) && ["complete", "unreviewed"].includes(status(e))
    );
  }
  function quality(state, on, window = 7) {
    const start = [state.profile.start, add(on, 1 - window)].sort().at(-1),
      dates = [];
    for (let d = start; d <= on; d = add(d, 1)) dates.push(d);
    const counts = { complete: 0, partial: 0, unreviewed: 0, missing: 0 };
    for (const d of dates) counts[status(state.entries[d])]++;
    return {
      start,
      end: on,
      total: dates.length,
      ...counts,
      coverage: dates.length ? counts.complete / dates.length : 0,
    };
  }
  function planAt(state, on) {
    return (
      [...(state.planHistory || [])]
        .filter((p) => p.effective <= on)
        .sort(
          (a, b) =>
            a.effective.localeCompare(b.effective) ||
            a.createdAt.localeCompare(b.createdAt),
        )
        .at(-1) || {
        effective: state.profile.start,
        mode: "loss",
        rate: 0.5,
        minIntake: 1500,
        activity: "0",
        calibratedExpense: null,
        reason: "initial",
      }
    );
  }
  function plan(state, on, expense) {
    const p = planAt(state, on),
      t = trend(state, on),
      weight = t.value ?? t.latest?.[1].weight ?? state.profile.weight,
      target = state.profile.goal,
      reached = t.value !== null && t.value <= target,
      spent = expense ?? p.calibratedExpense ?? null;
    const requested = p.mode === "maintenance" ? 0 : (p.rate * 7700) / 7,
      deficit =
        p.mode === "maintenance" || reached
          ? 0
          : Math.max(
              0,
              Math.min(
                requested,
                500,
                spent === null ? 500 : spent * 0.2,
                spent === null ? 500 : spent - p.minIntake,
              ),
            );
    return {
      ...p,
      maintenanceWeight: p.maintenanceWeight ?? weight,
      weight,
      reached,
      expense: spent,
      deficit,
      intake: spent === null ? null : round(spent - deficit, 50),
      low:
        spent === null
          ? null
          : Math.max(p.minIntake, round(spent - deficit - 100, 50)),
      high:
        spent === null
          ? null
          : Math.max(p.minIntake, round(spent - deficit + 100, 50)),
      constrained: deficit + 1 < requested,
    };
  }
  function classify(state, on, expense) {
    const e = state.entries[on];
    if (status(e) !== "complete") return status(e);
    const p = plan(state, on, expense),
      target = e.targetSnapshot ?? p.deficit,
      def = expense - e.intake;
    return def > target + 150 ? "excess" : def < target - 150 ? "low" : "good";
  }
  function calibration(state, on, expenseFor) {
    const end = add(on, -1),
      q = quality(state, end, 28),
      t = trend(state, end),
      rows = Object.entries(state.entries).filter(
        ([d, e]) => d >= q.start && d <= end && status(e) === "complete",
      ),
      eligible =
        q.total >= 21 &&
        q.coverage >= 0.85 &&
        t.count >= 6 &&
        t.span >= 21 &&
        !t.stale &&
        t.rate !== null;
    const intake = mean(rows.map(([, e]) => e.intake)),
      calculated = mean(rows.map(([d, e]) => expenseFor(e, d))),
      estimate = eligible ? intake + (t.rate * 7700) / 7 : null;
    const estimatedFoods = rows.reduce(
      (n, [, e]) =>
        n +
        (e.chatgpt?.foods || []).filter(
          (f) =>
            f.status === "consumed" &&
            (!f.calorieSource || f.calorieSource === "estimate"),
        ).length,
      0,
    );
    if (!eligible || !finite(estimate) || estimate < 1000 || estimate > 6000)
      return {
        available: false,
        quality: q,
        trend: t,
        intake,
        calculated,
        estimatedFoods,
        reason:
          "Нужны минимум 21 день наблюдений, 85% завершённых дней и 6 взвешиваний с интервалом не менее 21 дня.",
      };
    const margin = Math.max(200, ((t.spread || 0) * 7700) / 7, estimate * 0.1);
    return {
      available: true,
      quality: q,
      trend: t,
      intake,
      calculated,
      estimatedFoods,
      estimate: round(estimate, 50),
      low: round(Math.max(500, estimate - margin), 50),
      high: round(estimate + margin, 50),
      reason:
        "Оценка по вашему учёту. Ошибки еды и воды нельзя отделить от расхода; диапазон — рабочая неопределённость, не доверительный интервал.",
    };
  }
  function forecast(state, on) {
    const t = trend(state, on),
      p = plan(state, on),
      weight = t.value ?? t.latest?.[1].weight;
    if (p.mode === "maintenance")
      return {
        available: false,
        reason: "Режим удержания: следим за диапазоном веса.",
      };
    if (t.value !== null && weight <= state.profile.goal)
      return {
        available: false,
        reached: true,
        reason: "Цель достигнута. Можно перейти к удержанию.",
      };
    if (t.rate === null || t.rate <= 0.05)
      return {
        available: false,
        reason:
          "Для прогноза нужна устойчивая динамика снижения за несколько недель.",
      };
    const uncertainty = Math.max(0.1, t.spread || 0, t.rate * 0.25),
      remaining = weight - state.profile.goal,
      fast = t.rate + uncertainty,
      slow = t.rate - uncertainty;
    if (slow <= 0.05 || remaining / slow > 520)
      return {
        available: false,
        reason: "Динамика пока слишком неопределённая для диапазона дат.",
      };
    return {
      available: true,
      earliest: add(on, Math.ceil((remaining / fast) * 7)),
      latest: add(on, Math.ceil((remaining / slow) * 7)),
      reason: "Сценарий при сохранении текущего темпа, не обещание даты.",
    };
  }
  function review(state, on, expenseFor) {
    const end = add(on, -1),
      q = quality(state, end),
      t = trend(state, on),
      p = planAt(state, on),
      cal = calibration(state, on, expenseFor),
      recent = Object.entries(state.entries).filter(
        ([d, e]) => d >= q.start && d <= end && status(e) === "complete",
      ),
      hunger = mean(recent.map(([, e]) => e.wellbeing?.hunger).filter(finite)),
      energy = mean(recent.map(([, e]) => e.wellbeing?.energy).filter(finite));
    let action = "Продолжайте текущий план до следующего обзора.",
      kind = "continue",
      proposal = null;
    if (q.coverage < 0.85) {
      kind = "data";
      action =
        "Сначала завершите учёт питания. Пока данных недостаточно, менять калории рано.";
    } else if (hunger >= 4 || (energy !== null && energy <= 2)) {
      kind = "recovery";
      action =
        "План тяжело переносится. Не увеличивайте дефицит; пересмотрите питание и восстановление.";
    } else if (t.rate === null) {
      kind = "weigh";
      action =
        "Добавьте сопоставимые взвешивания. Для оценки темпа нужны наблюдения хотя бы за две недели.";
    } else if (p.mode === "loss" && t.rate > Math.max(0.9, p.rate * 1.5)) {
      kind = "fast";
      action =
        "Темп выше выбранного. Проверьте самочувствие и обсудите смягчение плана.";
    } else if (
      p.mode === "maintenance" &&
      t.value !== null &&
      Math.abs(
        t.value -
          (p.maintenanceWeight ?? t.latest?.[1].weight ?? state.profile.goal),
      ) > 1
    ) {
      kind = "maintenance";
      action =
        "Тренд вышел за диапазон удержания. Проверьте устойчивость изменения и привычный режим на следующем обзоре.";
    } else if (
      cal.available &&
      ((p.calibratedExpense ?? cal.calculated) < 1000 ||
        (p.calibratedExpense ?? cal.calculated) > 6000)
    ) {
      kind = "expense-input";
      action =
        "Проверьте введённый суточный расход. Перед уточнением оценки нужно разобраться с исходными значениями.";
    } else if (
      cal.available &&
      days(p.effective, on) >= 7 &&
      Math.abs(cal.estimate - (p.calibratedExpense ?? cal.calculated)) >= 150
    ) {
      kind = "calibrate";
      action =
        "Учёт и динамика веса расходятся с формулой. Можно осторожно уточнить оценку расхода.";
      const baseExpense = p.calibratedExpense ?? cal.calculated;
      proposal = {
        ...p,
        effective: on,
        calibratedExpense: clamp(
          round(baseExpense + clamp(cal.estimate - baseExpense, -100, 100), 50),
          Math.ceil((baseExpense - 100) / 50) * 50,
          Math.floor((baseExpense + 100) / 50) * 50,
        ),
        reason: "weekly-calibration",
      };
    } else if (p.mode === "loss" && t.rate !== null && t.rate < 0.1) {
      kind = "plateau";
      action =
        "Тренд почти не снижается. Проверьте полноту порций, масла, напитков и привычную активность; не компенсируйте это голоданием.";
    }
    const lastReview = [...(state.reviews || [])]
      .filter((r) => r.on <= on)
      .sort((a, b) => a.on.localeCompare(b.on))
      .at(-1)?.on;
    return {
      end,
      quality: q,
      trend: t,
      hunger,
      energy,
      kind,
      action,
      proposal,
      calibration: cal,
      next: add(
        lastReview && lastReview > p.effective ? lastReview : p.effective,
        7,
      ),
    };
  }
  function recipe(ingredients, yieldGrams) {
    if (
      !Array.isArray(ingredients) ||
      !ingredients.length ||
      ingredients.length > 200 ||
      !finite(yieldGrams) ||
      yieldGrams <= 0 ||
      yieldGrams > 100000
    )
      throw Error("Укажите ингредиенты и выход готового блюда");
    const totals = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 };
    for (const i of ingredients) {
      if (
        !i.name?.trim() ||
        !finite(i.grams) ||
        i.grams <= 0 ||
        i.grams > 100000
      )
        throw Error("Проверьте ингредиент");
      for (const k of Object.keys(totals)) {
        if (!finite(i[k]) || i[k] < 0 || i[k] > 20000)
          throw Error("Проверьте значения на 100 г");
        totals[k] += (i[k] * i.grams) / 100;
      }
    }
    return Object.fromEntries(
      Object.entries(totals).map(([k, v]) => [k, (v / yieldGrams) * 100]),
    );
  }
  function portion(template, grams, id) {
    if (!finite(grams) || grams <= 0 || grams > 100000)
      throw Error("Проверьте массу порции");
    const source = template.calorieSource || "estimate";
    const out = {
      id,
      name: template.name,
      status: "consumed",
      weightGrams: grams,
      calorieSource: source,
      accuracy:
        source === "estimate" ? "приблизительно" : "по этикетке/измерению",
      comments: template.ingredients
        ? "Рецепт: масса ингредиентов до приготовления; выход " +
          template.yieldGrams +
          " г."
        : "Шаблон на 100 г; масса порции " + grams + " г",
    };
    for (const k of ["calories", "protein", "fat", "carbs", "fiber"])
      out[k] = (template[k] * grams) / 100;
    if (template.calorieRange)
      out.calorieRange = {
        low: (template.calorieRange.low * grams) / 100,
        high: (template.calorieRange.high * grams) / 100,
      };
    return out;
  }
  const api = {
    VERSION,
    validDate,
    days,
    add,
    mean,
    measurements,
    weights,
    trend,
    status,
    hasDeficit,
    quality,
    planAt,
    plan,
    classify,
    calibration,
    forecast,
    review,
    recipe,
    portion,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.BalanceModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
