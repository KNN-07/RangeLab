(() => {
  "use strict";

  const defaults = {
    board: "As 8d 4c", pot: "6", size: "50",
    oop: "22-TT, A2s-AJs, K9s+, QTs+, JTs, T9s, 98s, 87s, ATo-AQo, KJo+",
    ip: "66+, A2s+, KTs+, QTs+, JTs, T9s, 98s, AJo+, KQo", quality: "standard", lock: "",
    tree: "standard", secondSize: "100", stack: "100", raiseFactor: "3"
  };
  const decisions = [
    ["OOP · First to act", "Bet", "Check"],
    ["IP · Facing a check", "Bet", "Check"],
    ["IP · Facing a bet", "Call", "Fold"],
    ["OOP · Facing a bet after checking", "Call", "Fold"]
  ];
  const suits = { c: "♣", d: "♦", h: "♥", s: "♠" };
  const pct = x => (100 * x).toFixed(1) + "%";
  const fmt = n => Number(n.toFixed(2)).toLocaleString();
  const state = { config: { ...defaults }, solved: null, result: null, decision: 0 };
  let activeWorker = null;
  function readList(key) {
    try { const value = JSON.parse(localStorage.getItem("rangeLab:" + key)); return Array.isArray(value) ? value : []; }
    catch { return []; }
  }
  function writeList(key, value) {
    try { localStorage.setItem("rangeLab:" + key, JSON.stringify(value)); return true; }
    catch { return false; }
  }
  function cleanConfig(input) {
    const clean = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const value = input?.[key];
      if (typeof value === "string" || typeof value === "number") clean[key] = String(value);
    }
    if (!["fast", "standard", "deep"].includes(clean.quality)) clean.quality = defaults.quality;
    if (!["standard", "advanced"].includes(clean.tree)) clean.tree = defaults.tree;
    return clean;
  }

  function element(tag, cls, text) {
    const item = document.createElement(tag);
    if (cls) item.className = cls;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  function addStyles() {
    if (document.querySelector("#postflop-style")) return;
    const style = element("style");
    style.id = "postflop-style";
    style.textContent = `
      .pf-layout{display:grid;grid-template-columns:minmax(268px,.78fr) minmax(0,1.48fr);gap:17px;align-items:start}
      .pf-layout .panel-pad{min-width:0}.pf-layout h2{margin-bottom:15px}
      .pf-layout details{font-size:13px;color:var(--muted);margin:4px 0 15px;line-height:1.5}
      .pf-layout summary{cursor:pointer;color:#c3d0d9}.pf-layout details p{margin-top:7px}
      .pf-layout textarea{width:100%;line-height:1.45;font-family:var(--mono);font-size:13px}
      .pf-layout .field input[type=checkbox]{width:auto;accent-color:var(--mint)}
      .pf-layout .pf-lock{display:flex;align-items:center;gap:8px;font-size:13px;margin:2px 0 12px}
      .pf-layout .pf-status{margin:10px 0 0;color:var(--muted);font-size:13px;line-height:1.55}
      .pf-status[data-error=true]{color:var(--raise)}.pf-layout .pf-boards{display:flex;align-items:center;gap:5px}
      .pf-board-head,.pf-node-head,.pf-table-head,.pf-pager{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
      .pf-board-head{margin:0 0 14px}.pf-board-head h2{margin:0}.pf-node-head{margin:18px 0 10px}
      .pf-layout .metrics{margin:12px 0}.pf-layout .metric{min-width:0}.pf-layout .metric strong{font-size:17px}
      .pf-node-head select{max-width:100%;font-size:13px}.pf-breakdown{display:flex;height:10px;border-radius:5px;background:var(--fold);overflow:hidden}
      .pf-legend{display:flex;justify-content:space-between;margin:7px 0 16px;font-size:13px}.pf-table-head{margin:16px 0 7px}
      .pf-table-head input{width:142px;font-size:13px}.pf-table th,.pf-table td{white-space:nowrap}
      .pf-combo{font:600 14px var(--mono);white-space:nowrap}.pf-card-red{color:#f5a59a}.pf-pager{margin-top:12px;font-size:13px}
      .pf-model{border-top:1px solid var(--border);margin-top:16px;padding-top:12px;line-height:1.5;font-size:13px;color:var(--muted)}
      .pf-empty{padding:36px 12px;text-align:center;color:var(--muted)}
      @media(max-width:820px){.pf-layout{grid-template-columns:minmax(0,1fr)}}
      @media(max-width:450px){.pf-layout .panel-pad{padding:14px}.pf-table{font-size:12px}.pf-layout .metric strong{font-size:14px}.pf-layout .metrics{gap:5px}.pf-layout .metric{padding:10px 6px}.pf-table td,.pf-table th{padding:8px 4px}}
    `;
    document.head.append(style);
  }

  function mount(container, custom = {}) {
    addStyles();
    if (activeWorker) activeWorker.terminate();
    activeWorker = null;
    if (custom.board) {
      state.config = cleanConfig(custom);
      state.decision = Number.isInteger(custom.decision) && custom.decision >= 0 && custom.decision < decisions.length ? custom.decision : 0;
    }
    const root = element("section", "pf-layout");
    const form = element("form", "panel panel-pad");
    const output = element("section", "panel panel-pad");
    output.setAttribute("aria-label", "Postflop solution");
    form.innerHTML = `
      <h2>Build a spot</h2>
      <label class="field" data-saved-field>Saved spots<select name="saved"><option value="">Choose a saved spot</option></select></label>
      <label class="field">Community cards<input type="text" name="board" required autocomplete="off" spellcheck="false" maxlength="28" placeholder="As 8d 4c"></label>
      <label class="field">Betting tree<select name="tree"><option value="standard">Standard · one bet size</option><option value="advanced">Advanced · two sizes and a raise</option></select></label>
      <div class="field-grid">
        <label class="field">Pot (bb)<input name="pot" type="number" min="0.01" max="100000" step="any" required></label>
        <label class="field">Stack behind (bb)<input name="stack" type="number" min="0.01" max="100000" step="any" required></label>
      </div>
      <label class="field">Bet size (% pot)<input name="size" type="number" min="0.01" max="1000" step="any" required></label>
      <div data-advanced-fields>
        <div class="field-grid">
          <label class="field">Second size (% pot)<input name="secondSize" type="number" min="0.01" max="1000" step="any"></label>
          <label class="field">Raise to (× bet)<input name="raiseFactor" type="number" min="2" max="10" step="any"></label>
        </div>
      </div>
      <label class="field">Out-of-position range<textarea name="oop" rows="3" required spellcheck="false"></textarea></label>
      <label class="field">In-position range<textarea name="ip" rows="3" required spellcheck="false"></textarea></label>
      <details><summary>Range notation</summary><p>Use AA, AKs, AKo, 77+, A2s-A5s, exact suits (AsKh), or random. Separate entries with commas. Add a weight with AKs:50%. Later entries override overlapping combos.</p></details>
      <label class="field">Solve quality<select name="quality"><option value="fast">Quick · 100 iterations</option><option value="standard">Standard · 300 iterations</option><option value="deep">Deep · 800 iterations</option></select></label>
      <label class="pf-lock"><input name="locked" type="checkbox">Lock IP calls facing an opening bet</label>
      <label class="field" data-lock-field>Call frequency (%)<input name="lock" type="number" min="0" max="100" step="any" placeholder="50"></label>
      <div class="row"><button class="button primary" type="submit">Solve spot</button><button class="button" type="button" data-cancel hidden>Cancel</button></div>
      <p class="pf-status" role="status" aria-live="polite"></p>`;
    root.append(form, output);
    const lineHost = element("div");
    lineHost.style.marginTop = "17px";
    container.replaceChildren(root, lineHost);
    let lineResult = null, cleanupLine = null;
    const fields = form.elements;
    for (const key of Object.keys(defaults)) fields.namedItem(key).value = state.config[key] ?? "";
    fields.locked.checked = state.config.lock !== "" && state.config.lock !== null;
    const lockField = form.querySelector("[data-lock-field]");
    function updateLock() {
      const advanced = fields.tree.value === "advanced";
      form.querySelector("[data-advanced-fields]").hidden = !advanced;
      for (const key of ["secondSize", "raiseFactor"]) {
        fields[key].disabled = !advanced;
        fields[key].required = advanced;
      }
      lockField.style.display = fields.locked.checked ? "" : "none";
      fields.lock.required = fields.locked.checked;
      if (fields.locked.checked && fields.lock.value === "") fields.lock.value = "50";
    }
    updateLock();
    const submit = form.querySelector("[type=submit]"), cancel = form.querySelector("[data-cancel]");
    const status = form.querySelector('[role="status"]');
    let page = 0, filter = "", worker = null, drill = null;
    let library = readList("postflop-spots").filter(item => item && typeof item.name === "string" && item.config?.board).slice(0, 100);
    let training = readList("postflop-training").filter(item => Number.isFinite(item?.loss)).slice(0, 5000);
    function showLibrary() {
      fields.saved.replaceChildren(new Option("Choose a saved spot", ""));
      library.forEach((spot, i) => fields.saved.add(new Option(spot.name, String(i))));
      form.querySelector("[data-saved-field]").style.display = library.length ? "" : "none";
    }
    showLibrary();
    function config() {
      return Object.fromEntries(Object.keys(defaults).map(key => [key, key === "lock" && !fields.locked.checked ? "" : fields[key].value]));
    }
    function busy(active) {
      submit.disabled = active;
      cancel.style.display = active ? "inline-flex" : "none";
      cancel.hidden = !active;
      output.setAttribute("aria-busy", String(active));
    }
    busy(false);
    function stop() {
      worker?.terminate();
      if (activeWorker === worker) activeWorker = null;
      worker = null;
      busy(false);
    }
    function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
    form.oninput = () => {
      updateLock();
      if (worker) stop();
      state.config = config();
      message("Run a solve to apply the current settings.");
    };
    fields.saved.onchange = () => {
      if (fields.saved.value === "") return;
      const loaded = cleanConfig(library[Number(fields.saved.value)]?.config);
      for (const key of Object.keys(defaults)) fields[key].value = loaded[key];
      fields.locked.checked = loaded.lock !== "";
      updateLock();
      fields.saved.value = "";
      run();
    };
    cancel.onclick = () => { stop(); message("Solve canceled."); };
    function dispose() {
      stop();
      cleanupLine?.();
      cleanupLine = null;
    }

    function render() {
      output.replaceChildren();
      const result = state.result;
      lineHost.hidden = !!drill;
      if (result && result !== lineResult && globalThis.RangeLine) {
        cleanupLine?.();
        lineHost.replaceChildren();
        cleanupLine = globalThis.RangeLine.mount(lineHost, state.solved, result);
        lineResult = result;
      }
      if (!result) {
        output.append(element("h2", "", "Postflop strategy"), element("p", "pf-empty", "Your strategy and hand values will appear here."));
        return;
      }
      const boardHead = element("div", "pf-board-head"), boardCards = element("div", "pf-boards");
      const street = ["Flop", "Turn", "River"][result.board.length - 3];
      boardHead.append(element("h2", "", street + " strategy"), boardCards);
      for (const card of result.board) {
        const tile = element("span", "playing-card" + ("hd".includes(card[1]) ? " red" : ""));
        tile.setAttribute("aria-label", card);
        tile.append(element("b", "", card[0]), element("i", "", suits[card[1]]));
        boardCards.append(tile);
      }
      const advanced = !!result.treeNodes;
      const nodeLabels = advanced ? result.treeNodes.map(n => n.label) : decisions.map(d => d[0]);
      if (state.decision >= nodeLabels.length) state.decision = 0;
      const sizeText = advanced ? "Bets " + result.betSizes.map(fmt).join(" / ") : "Bet " + fmt(result.bet);
      const betText = sizeText + " bb" + (result.stack === null || result.stack === undefined ? "" : " · " + fmt(result.stack) + " bb behind");
      const info = element("p", "muted small", "Pot " + fmt(result.pot) + " bb  ·  " + betText + "  ·  " + result.backend + " equity");
      const controls = element("div", "pf-node-head"), choose = element("select");
      choose.setAttribute("aria-label", "Decision node");
      nodeLabels.forEach((label, i) => choose.add(new Option(label, i)));
      choose.value = state.decision;
      choose.onchange = () => { state.decision = Number(choose.value); page = 0; filter = ""; render(); };
      controls.append(element("h3", "", "Decision node"), choose);
      const node = (result.treeNodes || result.nodes)[state.decision];
      const actionLabels = advanced ? node.actions : decisions[state.decision].slice(1);
      const actionFreqs = advanced ? node.frequencies : [node.frequency, 1 - node.frequency];
      const handEV = r => advanced ? r.evs : [r.evA, r.evB];
      const handFreq = r => advanced ? r.frequencies : [r.frequency, 1 - r.frequency];
      const metrics = element("div", "metrics");
      for (const [key, value] of [["Range EV", fmt(node.ev) + " bb"], ["Node reach", pct(node.reach)], ["Available combos", node.rows.length.toLocaleString()]]) {
        const metric = element("div", "metric"); metric.append(element("strong", "", value), element("small", "", key)); metrics.append(metric);
      }
      const bar = element("div", "pf-breakdown");
      const legend = element("div", "pf-legend");
      actionLabels.forEach((label, index) => {
        const fill = element("span");
        fill.style.width = pct(actionFreqs[index]);
        fill.style.background = label === "Fold" ? "var(--fold)" : ["Call", "Check"].includes(label) ? "var(--call)" : index === 2 && label.startsWith("Bet") ? "#d56b69" : "var(--raise)";
        bar.append(fill); legend.append(element("span", "", label + " " + pct(actionFreqs[index])));
      });
      output.append(boardHead, info, controls, metrics);
      function drawDrill() {
        let target = Math.random() * node.reach;
        let hand = node.rows[node.rows.length - 1];
        for (const row of node.rows) { target -= row.reach; if (target < 0) { hand = row; break; } }
        drill = { hand, choice: null };
        render();
      }
      if (drill) {
        // Remove aggregate and private-hand strategy until the player answers.
        output.replaceChildren(boardHead, info);
        const box = element("div", "drill");
        const cards = element("div", "cards"), row = drill.hand;
        for (const c of row.hand.match(/../g)) {
          const tile = element("span", "playing-card" + ("hd".includes(c[1]) ? " red" : ""));
          tile.append(element("b", "", c[0]), element("i", "", suits[c[1]])); cards.append(tile);
        }
        box.append(element("h2", "", "Decision practice"), element("p", "muted", nodeLabels[state.decision]), cards);
        const choices = element("div", "drill-choices");
        const evs = handEV(row), frequencies = handFreq(row);
        for (const [index, label] of actionLabels.entries()) {
          const button = element("button", "button", label);
          button.disabled = drill.choice !== null;
          button.onclick = () => {
            if (drill.choice !== null) return;
            drill.choice = index;
            const loss = Math.max(...evs) - evs[index];
            training.unshift({ date: Date.now(), board: result.board.join(" "), pot: result.pot, bet: result.bet,
              decision: nodeLabels[state.decision], hand: row.hand, action: label, loss, frequency: frequencies[index] });
            training = training.slice(0, 5000);
            if (!writeList("postflop-training", training)) message("Device storage is full. This practice result is available for this visit.", true);
            render();
          };
          choices.append(button);
        }
        box.append(choices);
        if (drill.choice !== null) {
          const selected = actionLabels[drill.choice], loss = Math.max(...evs) - evs[drill.choice];
          const feedback = element("div", "notice drill-result");
          feedback.append(element("strong", "", selected + " · " + fmt(loss) + " bb EV loss"),
            element("div", "", actionLabels.map((label, a) => label + " " + pct(frequencies[a]) + " (" + evs[a].toFixed(2) + " bb)").join(" · ")));
          box.append(feedback);
        }
        const actions = element("div", "drill-choices"), exit = element("button", "button", "View solution");
        exit.onclick = () => { drill = null; render(); }; actions.append(exit);
        if (drill.choice !== null) {
          const next = element("button", "button primary", "Next hand"); next.onclick = drawDrill; actions.append(next);
        }
        const average = training.length ? training.reduce((total, item) => total + item.loss, 0) / training.length : 0;
        box.append(actions, element("p", "muted small", training.length + " postflop decisions on this device · " + fmt(average) + " bb average EV loss"));
        output.append(box); return;
      }
      if (node.reach > 0) output.append(bar, legend);
      if (node.rows.length) {
        const practice = element("button", "button", "Practice this node");
        practice.onclick = drawDrill; output.append(practice);
      }
      const tableHead = element("div", "pf-table-head");
      const search = element("input", "input");
      search.type = "search"; search.setAttribute("aria-label", "Filter private cards"); search.placeholder = "Filter cards, e.g. As"; search.value = filter;
      tableHead.append(element("h3", "", "Hand breakdown"), search);
      const rowsMount = element("div"), pager = element("div", "pf-pager");
      output.append(tableHead, rowsMount, pager);
      function drawRows() {
        const rows = node.rows.filter(r => r.hand.toLowerCase().includes(filter.trim().toLowerCase()));
        const chunk = 10, pages = Math.max(1, Math.ceil(rows.length / chunk));
        page = Math.min(page, pages - 1);
        const scroll = element("div", "scroll-x"), table = element("table", "data-table pf-table");
        const head = table.createTHead().insertRow();
        ["Hand", ...actionLabels, "Reach"].forEach(t => head.append(element("th", "", t)));
        const body = table.createTBody();
        for (const r of rows.slice(page * chunk, (page + 1) * chunk)) {
          const line = body.insertRow(), hand = line.insertCell(); hand.className = "pf-combo";
          for (const pair of r.hand.match(/../g)) hand.append(element("span", "hd".includes(pair[1]) ? "pf-card-red" : "", pair[0] + suits[pair[1]] + " "));
          const evs = handEV(r);
          handFreq(r).forEach((p, a) => {
            const cell = line.insertCell();
            cell.append(element("div", "", pct(p)), element("small", "muted", evs[a].toFixed(2) + " bb"));
          });
          line.insertCell().textContent = pct(r.reach);
        }
        scroll.append(table);
        rowsMount.replaceChildren(scroll); pager.replaceChildren();
        if (!rows.length) rowsMount.append(element("p", "pf-status", node.reach ? "No hands match these cards." : "This decision is unreachable under the solved strategy."));
        if (pages > 1) {
          const prev = element("button", "button compact", "Previous"), next = element("button", "button compact", "Next");
          prev.disabled = !page; next.disabled = page === pages - 1;
          prev.onclick = () => { page--; drawRows(); }; next.onclick = () => { page++; drawRows(); };
          pager.append(prev, element("span", "muted", (page + 1) + " / " + pages), next);
        }
      }
      search.oninput = () => { filter = search.value; page = 0; drawRows(); };
      drawRows();
      const meta = [
        result.iterations + " CFR+ iterations", result.matches.toLocaleString() + " / " + result.legal.toLocaleString() + " legal matchups",
        street === "Flop" ? result.runs + " sampled runouts per matchup" : street === "Turn" ? "all 44 rivers per matchup" : "exact river showdowns",
        "best-response gap " + result.gap.toFixed(3) + " bb in the evaluated game"
      ];
      if (result.lock !== null) meta.push("IP calls opening bets " + pct(result.lock) + " and folds the rest");
      const treeText = advanced ? "Both players can check, bet, and raise once per betting line. Bets and raises are capped at the effective stack. " : "Each player can check or bet. Facing a bet, the opponent can call or fold. ";
      output.append(element("p", "pf-model", meta.join(" · ") + ". " + treeText + "Remaining streets run directly to showdown."));
      const saveRow = element("div", "report-actions"), spotName = element("input", "input");
      spotName.type = "text"; spotName.maxLength = 60; spotName.setAttribute("aria-label", "Saved spot name");
      spotName.placeholder = "Spot name";
      const saveBtn = element("button", "button", "Save solved spot"), exportBtn = element("button", "button", "Export JSON");
      saveBtn.onclick = () => {
        const name = spotName.value.trim() || (result.board.join(" ") + " · " + fmt(result.pot) + " bb pot");
        const spot = { name, config: cleanConfig(state.solved), date: Date.now() };
        const duplicate = library.findIndex(item => item.name === name && JSON.stringify(cleanConfig(item.config)) === JSON.stringify(spot.config));
        if (duplicate >= 0) library.splice(duplicate, 1);
        library.unshift(spot);
        library = library.slice(0, 100);
        const saved = writeList("postflop-spots", library);
        showLibrary();
        message(saved ? "Saved “" + name + "” on this device." : "Device storage is unavailable. The spot is saved for this visit.", !saved);
      };
      exportBtn.onclick = () => {
        const blob = new Blob([JSON.stringify({ format: "RangeLab postflop solution", version: 1, config: state.solved, result, decisions: advanced ? result.treeNodes.map(n => [n.label, ...n.actions]) : decisions }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob), link = element("a");
        link.href = url; link.download = "rangelab-" + result.board.join("-") + ".json";
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      };
      saveRow.append(spotName, saveBtn, exportBtn);
      output.append(saveRow);
    }

    function run() {
      stop();
      const request = config();
      drill = null;
      state.config = request;
      if (typeof Worker === "undefined") { message("This browser cannot start the solver worker.", true); return; }
      try { worker = new Worker(new URL("./postflop-worker.js", document.baseURI)); }
      catch (error) { message("Could not start the solver worker. Open the app using HTTPS or localhost.", true); return; }
      activeWorker = worker;
      message("Preparing private ranges…");
      busy(true);
      worker.onmessage = ({ data }) => {
        if (data.progress) { message(data.progress); return; }
        stop();
        if (data.error) { message(data.error, true); return; }
        state.result = data.result; state.solved = request;
        page = 0; filter = "";
        message("Solve complete."); render();
      };
      worker.onerror = () => { stop(); message("The solver worker could not finish. Open the app on HTTPS or localhost, then retry.", true); };
      worker.postMessage(request);
    }
    form.onsubmit = event => { event.preventDefault(); run(); };
    render();
    if (!state.result || custom.board) run();
    else if (JSON.stringify(state.config) !== JSON.stringify(state.solved)) message("Run a solve to apply the current settings.");
    return dispose;
  }

  globalThis.RangePostflop = Object.freeze({ mount });
})();
