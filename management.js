/* Product flows. Calculation rules live in balance-model.js. */
function weeklyCard() {
  const r = M.review(state, today(), expense),
    q = r.quality,
    c = r.calibration;
  return `<section class="card review-card"><p class="eyebrow">НЕДЕЛЬНЫЙ ОБЗОР</p><h2>Одно следующее действие</h2><p>${esc(r.action)}</p><div class="review-metrics"><span>Питание: <b>${q.complete}/${q.total}</b> полных дней</span><span>Вес: <b>${r.trend.count}</b> измерений за 28 дней</span>${r.hunger !== null ? `<span>Средний голод: <b>${fmt(r.hunger, 1)}/5</b></span>` : ""}${r.energy !== null ? `<span>Энергия: <b>${fmt(r.energy, 1)}/5</b></span>` : ""}</div>${r.proposal ? `<p class="note">Осторожное уточнение расхода: ${fmt(M.planAt(state, today()).calibratedExpense ?? c.calculated)} → ${fmt(r.proposal.calibratedExpense)} ккал. Изменение не более 100 ккал за обзор. Это оценка по вашему учёту, не измерение обмена.</p><button class="primary" id="acceptReview">Применить оценку расхода</button>` : ""}<small>Обзор: ${long(r.next)}${r.next <= today() ? " · пора проверить план" : ""}. Данные питания — по вчерашний день.</small><div class="actions"><button id="saveReview">Сохранить обзор</button><button data-report>Скачать проверяемый отчёт</button></div></section>`;
}
function appendPlan(config, reason) {
  const now = new Date().toISOString();
  state.planHistory ||= [];
  state.planHistory.push({
    ...config,
    effective: today(),
    createdAt: now,
    reason,
    algorithmVersion: M.VERSION,
  });
  state.algorithmVersion = M.VERSION;
}
function bindReview() {
  if ($("#acceptReview"))
    $("#acceptReview").onclick = () => {
      const review = M.review(state, today(), expense);
      if (!review.proposal) return toast("Предложение уже не актуально");
      if (
        mutate(() => {
          appendPlan(review.proposal, "weekly-calibration");
          state.reviews ||= [];
          state.reviews.push({
            on: today(),
            createdAt: new Date().toISOString(),
            algorithmVersion: M.VERSION,
            kind: review.kind,
            action: review.action,
            quality: review.quality,
            rate: review.trend.rate,
            accepted: true,
          });
        })
      ) {
        render();
        toast("Новая оценка действует с сегодняшнего дня");
      }
    };
  if ($("#saveReview"))
    $("#saveReview").onclick = () => {
      const review = M.review(state, today(), expense);
      if (
        mutate(() => {
          state.reviews ||= [];
          state.reviews.push({
            on: today(),
            createdAt: new Date().toISOString(),
            algorithmVersion: M.VERSION,
            kind: review.kind,
            action: review.action,
            quality: review.quality,
            rate: review.trend.rate,
            accepted: false,
          });
        })
      ) {
        render();
        toast("Обзор сохранён в историю");
      }
    };
}
function plan() {
  const p = state.profile,
    s = stats(),
    c = currentPlan(),
    t = M.trend(state, today()),
    cal = M.calibration(state, today(), expense),
    f = M.forecast(state, today()),
    study = state.study || {
      start: today(),
      baselineDays: 14,
      interventionDays: 56,
    };
  $("#main").innerHTML =
    `<div class="intro"><p class="eyebrow">ПЛАН, КОТОРЫЙ МОЖНО ВЫДЕРЖАТЬ</p><h1>Мой план</h1></div>${hero()}<section class="card"><h2>Настройка питания</h2><p class="muted">Ориентир ${fmt(c.low)}–${fmt(c.high)} ккал. Расход ${fmt(c.expense)} ккал — ${c.calibratedExpense ? "уточнённая оценка по учёту" : "стартовая оценка по формуле"}.</p><form id="adaptivePlan"><label>Этап<select name="mode"><option value="loss" ${c.mode === "loss" ? "selected" : ""}>Снижение веса</option><option value="maintenance" ${c.mode === "maintenance" ? "selected" : ""}>Удержание веса</option></select></label><div class="two"><label>Желаемый темп, кг/нед.<input name="rate" type="number" min="0.1" max="0.75" step="0.05" value="${c.rate}" required></label><label>Нижняя граница питания, ккал<input name="minIntake" type="number" min="1200" max="5000" step="50" value="${c.minIntake}" required></label></div><label>Центр диапазона удержания, кг<input name="maintenanceWeight" type="number" min="20" max="500" step="0.1" value="${fmt(c.maintenanceWeight, 1).replace(",", ".")}" required></label><label>Обычный день<select name="activity">${[
      ["0", "Сидячий"],
      ["1", "Лёгкая активность"],
      ["2", "Умеренная активность"],
    ]
      .map(
        ([v, l]) =>
          `<option value="${v}" ${c.activity === v ? "selected" : ""}>${l}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Оценка расхода, ккал (необязательно)<input name="calibratedExpense" type="number" min="1000" max="6000" step="50" value="${c.calibratedExpense ?? ""}" placeholder="Пусто — использовать формулу"></label><p class="note">Стартовая нижняя граница — 1500 ккал, это ограничитель приложения, а не ваша индивидуальная потребность. Дефицит ограничен 500 ккал и 20% расхода; при удержании он равен нулю. Приложение не снижает питание автоматически. ${c.constrained ? "Выбранный темп ограничен этими правилами." : ""} Если расход ниже вашей границы питания, не подгоняйте питание под формулу.</p><button class="primary">Сохранить план с сегодняшнего дня</button></form><p class="muted">${f.available ? `Сценарий достижения: ${long(f.earliest)} — ${long(f.latest)}.` : f.reason} Желаемая дата ${long(p.deadline)} не повышает дефицит.</p>${c.reached && c.mode !== "maintenance" ? '<button id="startMaintenance" class="primary">Перейти к удержанию</button>' : ""}</section><section class="card"><h3>Проверка оценки расхода</h3>${cal.available ? `<p>${fmt(cal.low)}–${fmt(cal.high)} ккал/день по учёту питания и тренду веса.</p><p class="muted">${esc(cal.reason)} Приблизительных или неразмеченных продуктов в завершённых днях: ${cal.estimatedFoods}.</p>` : `<p class="muted">${esc(cal.reason)}</p><p>Завершено ${cal.quality.complete}/${cal.quality.total} дней, взвешиваний ${cal.trend.count}, интервал ${cal.trend.span} дней.</p>`}</section>${weeklyCard()}<section class="card"><h3>Измерения</h3><div class="chart-table"><table><thead><tr><th>Дата</th><th>Вес, кг</th><th>Талия, см</th><th>Условия</th></tr></thead><tbody>${M.measurements(
      state,
      today(),
    )
      .filter(([, m]) => m.weight != null || m.waist != null)
      .slice(-14)
      .reverse()
      .map(
        ([d, m]) =>
          `<tr><th><button class="text" data-measure-day="${d}">${long(d)}</button></th><td>${m.weight == null ? "—" : fmt(m.weight, 1)}</td><td>${m.waist == null ? "—" : fmt(m.waist, 1)}</td><td>${m.conditions === "morning" ? "Утром" : m.conditions === "other" ? "Другие" : "Не указаны"} ${esc(m.time || "")}</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><button class="text" data-measure>Добавить измерение</button></section><section class="card"><h3>Одна привычка</h3><label class="habit-check"><input type="checkbox" id="habitDone" ${state.measurements?.[today()]?.habitDone ? "checked" : ""}> Выполнено сегодня</label><form id="habitForm"><label>Что посильно повторять каждый день<input name="habit" maxlength="100" required value="${esc(state.habit || "Сделать короткую прогулку")}"></label><button class="primary">Сохранить привычку</button></form></section><section class="card"><h3>Исходные данные</h3><div class="row"><span>Вес на старте / цель</span><b>${fmt(p.weight, 1)} / ${fmt(p.goal, 1)} кг</b></div><div class="row"><span>Коэффициент обмена</span><b>${p.metabolicSex === "female" ? "Женский (−161)" : "Мужской (+5)"}</b></div><button class="text" id="editPlan">Изменить параметры</button><label>Белок, г на кг веса периода<input id="proteinFactor" type="number" min="0.1" max="5" step="0.1" value="${p.proteinFactor || 1.6}"></label><small>Цель: ${fmt(proteinTarget(today()), 1)} г. Это настройка пользователя, не индивидуальное назначение.</small></section><section class="card"><h3>Как проверить пользу</h3><p class="muted">Сначала ${study.baselineDays} дней исходных наблюдений, затем ${study.interventionDays} дней проверки. Сравнивайте темп, талию, полноту учёта, голод и энергию. Это личное наблюдение; причинный эффект приложения оно не доказывает.</p><form id="studyForm"><label>Начало наблюдений<input name="start" type="date" min="${p.start}" max="${today()}" value="${study.start}" required></label><button class="primary">Сохранить период проверки</button></form><button class="text" data-report>Скачать исходные данные и отчёт</button></section><section class="card"><h3>История решений</h3>${
      (state.planHistory || [])
        .slice(-8)
        .reverse()
        .map(
          (h) =>
            `<div class="row"><span>${long(h.effective)}</span><b>${h.mode === "maintenance" ? "Удержание" : "Снижение"} · ${h.calibratedExpense ? fmt(h.calibratedExpense) + " ккал расхода" : fmt(h.rate, 2) + " кг/нед."}</b></div>`,
        )
        .join("") || '<p class="muted">Нет изменений плана.</p>'
    }<details><summary>Сохранённые обзоры</summary>${
      (state.reviews || [])
        .slice(-12)
        .reverse()
        .map((r) => `<p><b>${long(r.on)}</b> · ${esc(r.action)}</p>`)
        .join("") || "<p>Пока нет обзоров.</p>"
    }</details></section><section class="card"><h3>Ваши данные</h3><p class="muted">Хранятся в этом браузере. Копия включает измерения, рецепты, историю планов и проверки. Внешняя отправка не выполняется.</p><div class="actions"><button id="export">Скачать полную копию</button><button id="import">Восстановить</button><button data-chatgpt>Импорт / экспорт ИИ</button><button id="install">На главный экран</button></div><input type="file" id="importFile" accept="application/json,.json" hidden>${localStorage.getItem("balance-before-v2") ? '<button class="text" id="preMigration">Скачать копию до обновления</button>' : ""}</section><details class="card"><summary>Расчёты и ограничения</summary><p class="muted">Вес измеряется отдельно от питания; прогресс основан только на измерениях. Тренд — среднее доступных измерений за 7 календарных дней, минимум 3. Темп — медиана попарных изменений с интервалом ≥7 дней за последние 28 дней; нужны 4 измерения с интервалом ≥14 дней и свежее измерение за неделю. Калибровка требует 21 дня, 85% завершённых дневников и 6 взвешиваний с интервалом ≥21 дня. Прогноз — сценарий по темпу, а не медицинский прогноз. 7700 ккал/кг — грубый коэффициент; вода, состав тела и изменения расхода не моделируются. Тренировки отдельно не прибавляются к суточному расходу.</p><p><a href="https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner" target="_blank" rel="noopener">NIDDK: динамическая модель веса</a> · <a href="https://www.nice.org.uk/guidance/ng246" target="_blank" rel="noopener">NICE: управление весом</a></p></details>`;
  $("#adaptivePlan").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      next = {
        mode: f.get("mode"),
        rate: Number(f.get("rate")),
        minIntake: Number(f.get("minIntake")),
        activity: f.get("activity"),
        maintenanceWeight: Number(f.get("maintenanceWeight")),
        calibratedExpense:
          f.get("calibratedExpense") === ""
            ? null
            : Number(f.get("calibratedExpense")),
      };
    if (mutate(() => appendPlan(next, "manual"))) {
      plan();
      toast("План сохранён. Исторические записи не изменены");
    }
  };
  if ($("#startMaintenance"))
    $("#startMaintenance").onclick = () => {
      if (
        mutate(() =>
          appendPlan(
            {
              ...M.planAt(state, today()),
              mode: "maintenance",
              maintenanceWeight: t.value ?? s.weight,
            },
            "goal-reached",
          ),
        )
      )
        plan();
    };
  $("#habitDone").onchange = (e) => {
    const checked = e.target.checked;
    if (
      !mutate(() => {
        state.measurements ||= {};
        state.measurements[today()] = {
          ...(state.measurements[today()] || {}),
          habitDone: checked,
        };
      })
    )
      e.target.checked = !checked;
  };
  $("#habitForm").onsubmit = (e) => {
    e.preventDefault();
    if (
      mutate(() => {
        state.habit = new FormData(e.target).get("habit").trim();
      })
    )
      toast("Привычка сохранена");
  };
  $("#studyForm").onsubmit = (e) => {
    e.preventDefault();
    if (
      mutate(() => {
        state.study = {
          start: new FormData(e.target).get("start"),
          baselineDays: 14,
          interventionDays: 56,
        };
      })
    )
      toast("Период проверки сохранён");
  };
  $("#proteinFactor").onchange = (e) => {
    if (!e.target.checkValidity()) return;
    if (
      mutate(() => {
        state.profile.proteinFactor = Number(e.target.value);
      })
    )
      plan();
  };
  $("#editPlan").onclick = () => setup(true);
  $("#export").onclick = () =>
    downloadJSON(`balance-${today()}.json`, { version: 2, ...state });
  $("#import").onclick = () => $("#importFile").click();
  $("#importFile").onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 10000000) throw Error("Файл больше 10 МБ");
      const data = JSON.parse(await file.text());
      validateBackup(data);
      if (!confirm("Заменить план, дневник и измерения данными копии?")) return;
      const old = JSON.stringify(state);
      localStorage.setItem("balance-before-restore", old);
      state = { ...data };
      delete state.version;
      if (!save()) {
        state = JSON.parse(old);
        return;
      }
      migrate();
      render();
      toast("Все данные восстановлены");
    } catch (err) {
      toast("Файл не подходит: " + err.message);
    }
  };
  if ($("#preMigration"))
    $("#preMigration").onclick = () =>
      downloadJSON(
        "balance-before-v2.json",
        JSON.parse(localStorage.getItem("balance-before-v2")),
      );
  $("#install").onclick = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
    } else
      alert(
        "Android: меню браузера → Установить приложение. iPhone: Поделиться → На экран «Домой».",
      );
  };
  bindReview();
}
function openMeasurement(day = today()) {
  const dialog = document.createElement("dialog");
  dialog.id = "measurementDialog";
  const m = Object.fromEntries(M.measurements(state, today()))[day] || {};
  dialog.innerHTML = `<form id="measurementForm"><div class="dialog-head"><h2>Измерения</h2><button type="button" class="icon" data-close aria-label="Закрыть">×</button></div><label>Дата<input name="date" type="date" min="${state.profile.start}" max="${today()}" value="${day}" required></label><div class="two"><label>Вес, кг<input name="weight" type="number" min="20" max="500" step="0.1" value="${m.weight ?? ""}"></label><label>Талия, см<input name="waist" type="number" min="30" max="300" step="0.1" value="${m.waist ?? ""}"></label></div><label>Время<input name="time" type="time" value="${esc(m.time || "")}"></label><label>Условия<select name="conditions"><option value="unknown">Не указаны</option><option value="morning">Утром, после туалета, до еды</option><option value="other">Другие условия</option></select></label><label>Силовой ориентир / заметка<input name="strengthNote" maxlength="200" value="${esc(m.strengthNote || "")}" placeholder="Например: привычные рабочие веса сохранены"></label><p class="note">Питание заполнять не нужно. По возможности сравнивайте измерения в одинаковых условиях. Одна точка не показывает изменение жира.</p><button class="primary wide">Сохранить измерение</button><button type="button" class="text danger" id="deleteMeasurement">Удалить измерение этой даты</button></form>`;
  document.body.append(dialog);
  dialog.querySelector("[name=conditions]").value = m.conditions || "unknown";
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector("[name=date]").onchange = (e) => {
    const d = e.target.value;
    if (!M.validDate(d) || d < state.profile.start || d > today()) return;
    dialog.close();
    openMeasurement(d);
  };
  dialog.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      d = f.get("date"),
      weight = f.get("weight") === "" ? null : Number(f.get("weight")),
      waist = f.get("waist") === "" ? null : Number(f.get("waist"));
    if (weight === null && waist === null && !f.get("strengthNote").trim())
      return toast("Укажите хотя бы одно измерение или заметку");
    if (
      mutate(() => {
        state.measurements ||= {};
        state.measurements[d] = {
          ...(state.measurements[d] || {}),
          weight,
          waist,
          time: f.get("time"),
          conditions: f.get("conditions"),
          strengthNote: f.get("strengthNote").trim(),
          source: "manual",
          recordedAt: new Date().toISOString(),
        };
        if (state.entries[d] && weight === null) state.entries[d].weight = null;
      })
    ) {
      dialog.close();
      render();
      toast("Измерение сохранено");
    }
  };
  dialog.querySelector("#deleteMeasurement").onclick = () => {
    const d = dialog.querySelector("[name=date]").value;
    if (
      !confirm(
        "Удалить вес, талию и заметку за выбранную дату? Питание сохранится.",
      )
    )
      return;
    if (
      mutate(() => {
        const old = state.measurements?.[d];
        if (old?.habitDone !== undefined)
          state.measurements[d] = { habitDone: old.habitDone };
        else if (state.measurements) delete state.measurements[d];
        if (state.entries[d]) state.entries[d].weight = null;
      })
    ) {
      dialog.close();
      render();
    }
  };
  dialog.showModal();
}
function reportData() {
  const on = today(),
    study = state.study || {
      start: on,
      baselineDays: 14,
      interventionDays: 56,
    },
    interventionStart = M.add(study.start, study.baselineDays),
    end = M.add(interventionStart, study.interventionDays - 1);
  function period(start, last) {
    const capped = last < on ? last : on,
      q = M.quality(state, capped, Math.max(1, M.days(start, capped) + 1)),
      measure = M.measurements(state, capped).filter(([d]) => d >= start),
      w = measure.filter(([, m]) => Number.isFinite(m.weight)),
      waist = measure.filter(([, m]) => Number.isFinite(m.waist)),
      rows = Object.entries(state.entries).filter(
        ([d, e]) => d >= start && d <= capped && M.status(e) === "complete",
      );
    return {
      start,
      end: last,
      observedThrough: capped,
      started: start <= on,
      completeDays: start > on ? 0 : rows.length,
      calendarDays: start > on ? 0 : M.days(start, capped) + 1,
      weightMeasurements: w.length,
      firstWeight: w[0] || null,
      lastWeight: w.at(-1) || null,
      firstWaist: waist[0] || null,
      lastWaist: waist.at(-1) || null,
      averageHunger: M.mean(
        rows.map(([, e]) => e.wellbeing?.hunger).filter(Number.isFinite),
      ),
      averageEnergy: M.mean(
        rows.map(([, e]) => e.wellbeing?.energy).filter(Number.isFinite),
      ),
      averageTrackingMinutes: M.mean(
        rows
          .map(([, e]) => e.wellbeing?.trackingMinutes)
          .filter(Number.isFinite),
      ),
      trackingTimeReportedDays: rows.filter(([, e]) =>
        Number.isFinite(e.wellbeing?.trackingMinutes),
      ).length,
    };
  }
  return {
    reportVersion: 1,
    algorithmVersion: M.VERSION,
    generatedAt: new Date().toISOString(),
    limitations: [
      "Личное наблюдение не доказывает причинный эффект приложения.",
      "Расход и дефицит — оценки; 7700 ккал/кг не динамическая физиологическая модель.",
      "Исходные наблюдения и пропуски сохранены.",
    ],
    protocol: study,
    baseline: period(study.start, M.add(interventionStart, -1)),
    intervention: period(interventionStart, end),
    currentTrend: M.trend(state, on),
    currentQuality: M.quality(state, M.add(on, -1), 28),
    calibration: M.calibration(state, on, expense),
    planHistory: state.planHistory || [],
    reviews: state.reviews || [],
    raw: {
      profile: state.profile,
      entries: state.entries,
      measurements: state.measurements || {},
    },
    templates: state.templates || [],
  };
}
function validateWellbeing(w) {
  if (w === undefined) return;
  if (!w || typeof w !== "object" || Array.isArray(w))
    throw Error("самочувствие");
  for (const [k, v] of Object.entries(w)) {
    const bounds = {
      steps: [0, 100000],
      sleep: [0, 24],
      hunger: [1, 5],
      energy: [1, 5],
      trackingMinutes: [0, 1440],
    }[k];
    if (!bounds || !Number.isFinite(v) || v < bounds[0] || v > bounds[1])
      throw Error("самочувствие");
  }
}
function validateExtendedBackup(d) {
  if (d.schemaVersion !== undefined && ![1, 2].includes(d.schemaVersion))
    throw Error("версия данных");
  if (d.measurements !== undefined) {
    if (
      !d.measurements ||
      typeof d.measurements !== "object" ||
      Array.isArray(d.measurements)
    )
      throw Error("измерения");
    for (const [day, m] of Object.entries(d.measurements)) {
      if (
        !M.validDate(day) ||
        day < d.profile.start ||
        day > today() ||
        !m ||
        typeof m !== "object" ||
        Array.isArray(m)
      )
        throw Error("дата измерения");
      for (const [k, min, max] of [
        ["weight", 20, 500],
        ["waist", 30, 300],
      ])
        if (
          m[k] != null &&
          (!Number.isFinite(m[k]) || m[k] < min || m[k] > max)
        )
          throw Error("измерение " + k);
      if (
        m.time !== undefined &&
        (typeof m.time !== "string" ||
          (m.time !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.time)))
      )
        throw Error("время");
      if (
        m.conditions !== undefined &&
        !["unknown", "morning", "other"].includes(m.conditions)
      )
        throw Error("условия");
      if (
        m.strengthNote !== undefined &&
        (typeof m.strengthNote !== "string" || m.strengthNote.length > 200)
      )
        throw Error("заметка");
      if (m.habitDone !== undefined && typeof m.habitDone !== "boolean")
        throw Error("привычка");
    }
  }
  if (d.planHistory !== undefined) {
    if (!Array.isArray(d.planHistory) || d.planHistory.length > 10000)
      throw Error("история плана");
    for (const h of d.planHistory) {
      if (
        !M.validDate(h.effective) ||
        h.effective < d.profile.start ||
        h.effective > today() ||
        typeof h.createdAt !== "string" ||
        !Number.isFinite(Date.parse(h.createdAt)) ||
        !["loss", "maintenance"].includes(h.mode) ||
        !Number.isFinite(h.rate) ||
        h.rate < 0.1 ||
        h.rate > 0.75 ||
        !Number.isFinite(h.minIntake) ||
        h.minIntake < 1200 ||
        h.minIntake > 5000 ||
        !["0", "1", "2"].includes(h.activity) ||
        (h.maintenanceWeight != null &&
          (!Number.isFinite(h.maintenanceWeight) ||
            h.maintenanceWeight < 20 ||
            h.maintenanceWeight > 500)) ||
        (h.calibratedExpense != null &&
          (!Number.isFinite(h.calibratedExpense) ||
            h.calibratedExpense < 1000 ||
            h.calibratedExpense > 6000))
      )
        throw Error("параметры плана");
    }
  }
  if (d.templates !== undefined) {
    if (!Array.isArray(d.templates) || d.templates.length > 500)
      throw Error("шаблоны");
    for (const t of d.templates) {
      if (
        typeof t.id !== "string" ||
        typeof t.name !== "string" ||
        !t.name.trim() ||
        t.name.length > 200 ||
        !["label", "database", "estimate"].includes(t.calorieSource)
      )
        throw Error("шаблон");
      for (const k of ["calories", "protein", "fat", "carbs", "fiber"])
        if (!Number.isFinite(t[k]) || t[k] < 0 || t[k] > 20000)
          throw Error("значения шаблона");
      if (
        t.calorieRange &&
        (!Number.isFinite(t.calorieRange.low) ||
          !Number.isFinite(t.calorieRange.high) ||
          t.calorieRange.low < 0 ||
          t.calorieRange.high < t.calorieRange.low ||
          t.calorieRange.high > 20000 ||
          t.calories < t.calorieRange.low ||
          t.calories > t.calorieRange.high)
      )
        throw Error("диапазон шаблона");
      if (t.ingredients) M.recipe(t.ingredients, t.yieldGrams);
    }
  }
  if (
    d.habit !== undefined &&
    (typeof d.habit !== "string" || d.habit.length > 100)
  )
    throw Error("привычка");
  if (
    d.study !== undefined &&
    (!M.validDate(d.study.start) ||
      d.study.start < d.profile.start ||
      d.study.start > today() ||
      d.study.baselineDays !== 14 ||
      d.study.interventionDays !== 56)
  )
    throw Error("период проверки");
  if (
    d.reviews !== undefined &&
    (!Array.isArray(d.reviews) ||
      d.reviews.length > 10000 ||
      d.reviews.some(
        (r) =>
          !M.validDate(r.on) ||
          typeof r.action !== "string" ||
          r.action.length > 1000,
      ))
  )
    throw Error("история обзоров");
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-measure]")) openMeasurement();
  if (e.target.closest("[data-measure-day]"))
    openMeasurement(e.target.closest("[data-measure-day]").dataset.measureDay);
  if (e.target.closest("[data-report]"))
    downloadJSON(`balance-evidence-${today()}.json`, reportData());
});
let workbenchDate = null;
function uid() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)
  );
}
function addFoods(day, foods) {
  const days = BalanceImport.parse(
    { schemaVersion: 1, date: day, foods },
    { start: state.profile.start, today: today() },
  );
  return mutate(() => {
    const before = state.entries[day],
      next = BalanceImport.prepare(state.entries, days, "merge");
    next[day].diaryStatus = "partial";
    next[day].recordedAt = new Date().toISOString();
    next[day].expenseSnapshot =
      before?.expenseSnapshot ?? expense(next[day], day);
    next[day].targetSnapshot = before?.targetSnapshot ?? cycle(day).deficit;
    state.entries = next;
  });
}
window.renderFoodWorkbench = function () {
  const day = workbenchDate || today(),
    entry = state.entries[day],
    foods = entry?.chatgpt?.foods || [],
    previous = M.add(day, -1),
    yesterday = (state.entries[previous]?.chatgpt?.foods || []).filter(
      (f) => f.status === "consumed",
    ),
    templates = state.templates || [];
  $("#main").innerHTML =
    `<div class="intro"><p class="eyebrow">ПРОЩЕ ЗАПИСЫВАТЬ — ЛЕГЧЕ ПРОДОЛЖАТЬ</p><h1>Питание</h1></div><label>Дата дневника<input id="foodDate" type="date" min="${state.profile.start}" max="${today()}" value="${day}"></label><div class="actions"><button data-chatgpt>Импорт из ИИ</button><button id="foodPrompt">Промпт для ИИ</button><button id="foodContext">Обновить контекст</button><button id="newTemplate">＋ Продукт / блюдо</button><button id="newRecipe">＋ Рецепт</button></div>${entry ? `<section class="card"><h3>Записано ${fmt(entry.intake)} ккал</h3><p>Белок ${fmt(entry.protein, 1)} г · ${statusLabel(M.status(entry))}</p><button id="editFoodDay" class="text">Проверить полноту и итоги</button></section>` : ""}<section class="card"><h3>Быстрые порции</h3>${templates.length ? `<label>Шаблон<select id="quickTemplate">${templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)} · ${fmt(t.calories)} ккал/100 г</option>`).join("")}</select></label><label>Съедено, г<input id="quickGrams" type="number" min="1" max="100000" step="1" value="100"></label><div class="actions"><button id="addPortion" class="primary">Добавить съеденную порцию</button><button id="editTemplate">Изменить шаблон</button><button id="deleteTemplate" class="danger">Удалить шаблон</button></div>` : '<p class="muted">Создайте продукт по этикетке или рецепт с выходом готового блюда. Сохранённые порции можно добавлять без ИИ.</p>'}${yesterday.length ? `<button id="repeatYesterday" class="text">Повторить съеденные продукты за ${long(previous)} (${yesterday.length})</button><small>Добавляет весь список продуктов, не ручные итоги. Повторное нажатие не создаёт дубликаты.</small>` : ""}</section>${[
      "consumed",
      "planned",
    ]
      .map(
        (status) =>
          `<section class="card"><h3>${status === "consumed" ? "Съедено" : "Запланировано"}</h3>${
            foods
              .filter((f) => f.status === status)
              .map(
                (f) =>
                  `<div class="food-row"><b>${esc(f.name)}</b><small>${fmt(f.weightGrams, 1)} г · ${fmt(f.calories)} ккал · ${sourceLabel(f.calorieSource)}</small><p>Б ${fmt(f.protein, 1)} / Ж ${fmt(f.fat, 1)} / У ${fmt(f.carbs, 1)} / клетчатка ${f.fiber == null ? "—" : fmt(f.fiber, 1)} г</p>${f.calorieRange ? `<p>Исходная оценка: ${fmt(f.calorieRange.low)}–${fmt(f.calorieRange.high)} ккал. Учтено ${fmt(f.calories)}.</p>` : ""}<small>${esc(f.comments || "")} ${esc(f.accuracy || "")}</small>${status === "planned" ? `<button class="text" data-consume="${foods.indexOf(f)}">Съедено — добавить в факт</button>` : ""}<button class="text" data-save-food="${foods.indexOf(f)}">Сохранить как шаблон</button></div>`,
              )
              .join("") ||
            '<p class="muted">Нет продуктов. Ручные дневные итоги не превращаются в вымышленные блюда.</p>'
          }</section>`,
      )
      .join(
        "",
      )}<p class="form-footer">Любое добавление еды открывает день заново: после завершения проверьте полноту дневника. Сохранённый шаблон не меняет уже записанные порции.</p>`;
  $("#foodDate").onchange = (e) => {
    if (
      !M.validDate(e.target.value) ||
      e.target.value < state.profile.start ||
      e.target.value > today()
    )
      return;
    workbenchDate = e.target.value;
    window.renderFoodWorkbench();
  };
  $("#foodPrompt").onclick = () => window.copyAIText(false);
  $("#foodContext").onclick = () => window.copyAIText(true);
  $("#newTemplate").onclick = () => openTemplate();
  $("#newRecipe").onclick = () => openTemplate(null, true);
  if ($("#editFoodDay")) $("#editFoodDay").onclick = () => openDay(day);
  if (templates.length) {
    $("#addPortion").onclick = () => {
      const grams = Number($("#quickGrams").value),
        template = templates.find((t) => t.id === $("#quickTemplate").value);
      try {
        if (!$("#quickGrams").checkValidity()) return toast("Проверьте массу");
        if (addFoods(day, [M.portion(template, grams, uid())])) {
          window.renderFoodWorkbench();
          toast("Порция добавлена. Проверьте полноту дня.");
        }
      } catch (e) {
        toast(e.message);
      }
    };
    $("#editTemplate").onclick = () =>
      openTemplate(templates.find((t) => t.id === $("#quickTemplate").value));
    $("#deleteTemplate").onclick = () => {
      const id = $("#quickTemplate").value;
      if (!confirm("Удалить шаблон? Записанные порции сохранятся.")) return;
      if (
        mutate(() => {
          state.templates = state.templates.filter((t) => t.id !== id);
        })
      )
        window.renderFoodWorkbench();
    };
  }
  if ($("#repeatYesterday"))
    $("#repeatYesterday").onclick = () => {
      const copied = yesterday.map((f, i) => ({
        ...f,
        id: `repeat-${day}-${previous}-${f.id || i}`,
      }));
      if (addFoods(day, copied)) {
        window.renderFoodWorkbench();
        toast("Вчерашние продукты добавлены без дубликатов");
      }
    };
  document.querySelectorAll("[data-consume]").forEach(
    (b) =>
      (b.onclick = () => {
        const f = foods[Number(b.dataset.consume)];
        if (addFoods(day, [{ ...f, id: f.id || uid(), status: "consumed" }]))
          window.renderFoodWorkbench();
      }),
  );
  document.querySelectorAll("[data-save-food]").forEach(
    (b) =>
      (b.onclick = () => {
        const f = foods[Number(b.dataset.saveFood)];
        if (!f.weightGrams) return toast("Неизвестна масса порции");
        const t = {
          id: uid(),
          name: f.name,
          calorieSource: f.calorieSource || "estimate",
        };
        for (const k of ["calories", "protein", "fat", "carbs", "fiber"])
          t[k] = f[k] == null ? "" : (f[k] * 100) / f.weightGrams;
        if (f.calorieRange)
          t.calorieRange = {
            low: (f.calorieRange.low * 100) / f.weightGrams,
            high: (f.calorieRange.high * 100) / f.weightGrams,
          };
        openTemplate(t);
      }),
  );
};
function sourceLabel(s) {
  return (
    {
      label: "По этикетке",
      database: "По справочнику",
      estimate: "Приблизительно",
    }[s] || "Источник не указан"
  );
}
function openTemplate(template = null, recipeMode = false) {
  const t = template || {},
    isRecipe = recipeMode || !!t.ingredients,
    dialog = document.createElement("dialog");
  dialog.id = "templateDialog";
  const fields = (values = {}, prefix = "") =>
    [
      ["calories", "Калории, ккал"],
      ["protein", "Белок, г"],
      ["fat", "Жиры, г"],
      ["carbs", "Углеводы, г"],
      ["fiber", "Клетчатка, г"],
    ]
      .map(
        ([k, label]) =>
          `<label>${label}<input name="${prefix + k}" type="number" min="0" max="20000" step="0.1" value="${values[k] ?? ""}" required></label>`,
      )
      .join("");
  dialog.innerHTML = `<form id="templateForm"><div class="dialog-head"><h2>${isRecipe ? "Рецепт" : "Шаблон продукта"}</h2><button type="button" class="icon" data-close aria-label="Закрыть">×</button></div><label>Название<input name="name" maxlength="200" required value="${esc(t.name || "")}"></label><label>Источник<select name="calorieSource"><option value="label">Этикетка</option><option value="database">Справочник</option><option value="estimate">Приблизительная оценка</option></select></label>${isRecipe ? '<p class="muted">Для каждого ингредиента укажите массу до приготовления и значения на 100 г. Масло и соусы добавьте отдельными строками.</p><div id="ingredients"></div><button class="text" type="button" id="addIngredient">＋ Ингредиент</button><label>Выход готового блюда, г<input name="yieldGrams" type="number" min="1" max="100000" step="1" value="' + (t.yieldGrams || "") + '" required></label>' : `<p class="muted">Все значения — на 100 г. Неизвестное значение уточните, а не заменяйте нулём.</p><div class="nutrient-grid">${fields(t)}</div><details class="manual-macros"><summary>Диапазон приблизительной калорийности</summary><p class="muted">Сохраните исходный диапазон и выбранное число отдельно. Учтённая калорийность должна находиться внутри диапазона.</p><div class="two"><label>Нижняя, ккал/100 г<input name="rangeLow" type="number" min="0" max="20000" step="0.1" value="${t.calorieRange?.low ?? ""}"></label><label>Верхняя, ккал/100 г<input name="rangeHigh" type="number" min="0" max="20000" step="0.1" value="${t.calorieRange?.high ?? ""}"></label></div></details>`}<p class="note" id="recipePreview" ${isRecipe ? "" : "hidden"}></p><button class="primary wide">Сохранить ${isRecipe ? "рецепт" : "шаблон"}</button></form>`;
  document.body.append(dialog);
  dialog.querySelector("[name=calorieSource]").value =
    t.calorieSource || "estimate";
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.addEventListener("close", () => dialog.remove());
  function ingredientRow(i = {}) {
    const div = document.createElement("fieldset");
    div.className = "ingredient";
    div.innerHTML = `<legend>Ингредиент</legend><label>Название<input data-key="name" maxlength="200" required value="${esc(i.name || "")}"></label><label>Масса, г<input data-key="grams" type="number" min="0.1" max="100000" step="0.1" required value="${i.grams ?? ""}"></label><div class="nutrient-grid">${fields(i).replaceAll('name="', 'data-key="')}</div><button type="button" class="text danger">Удалить ингредиент</button>`;
    div.querySelector("button").onclick = () => div.remove();
    dialog.querySelector("#ingredients").append(div);
  }
  if (isRecipe) {
    for (const i of t.ingredients || [{}]) ingredientRow(i);
    dialog.querySelector("#addIngredient").onclick = () => ingredientRow();
  }
  dialog.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    try {
      const f = new FormData(e.target),
        next = {
          id: t.id || uid(),
          name: f.get("name").trim(),
          calorieSource: f.get("calorieSource"),
          createdAt: t.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      if (!next.name) throw Error("Укажите название");
      if (isRecipe) {
        next.ingredients = [...dialog.querySelectorAll(".ingredient")].map(
          (div) =>
            Object.fromEntries(
              [...div.querySelectorAll("[data-key]")].map((input) => [
                input.dataset.key,
                input.dataset.key === "name"
                  ? input.value.trim()
                  : Number(input.value),
              ]),
            ),
        );
        next.yieldGrams = Number(f.get("yieldGrams"));
        Object.assign(next, M.recipe(next.ingredients, next.yieldGrams));
      } else {
        for (const k of ["calories", "protein", "fat", "carbs", "fiber"])
          next[k] = Number(f.get(k));
        if (f.get("rangeLow") !== "" || f.get("rangeHigh") !== "") {
          if (f.get("rangeLow") === "" || f.get("rangeHigh") === "")
            throw Error("Укажите обе границы");
          next.calorieRange = {
            low: Number(f.get("rangeLow")),
            high: Number(f.get("rangeHigh")),
          };
        }
      }
      validateExtendedBackup({ profile: state.profile, templates: [next] });
      if (
        mutate(() => {
          state.templates ||= [];
          const index = state.templates.findIndex((x) => x.id === next.id);
          if (index < 0) {
            if (state.templates.length >= 500)
              throw Error("Максимум 500 шаблонов");
            state.templates.push(next);
          } else state.templates[index] = next;
        })
      ) {
        dialog.close();
        window.renderFoodWorkbench();
        toast("Шаблон сохранён");
      }
    } catch (err) {
      toast(err.message);
    }
  };
  dialog.showModal();
}
