// dashboard.js
(function () {
  const CFG = window.NEXCARD || {};
  const API_BASE = CFG.API_BASE;
  const TOKEN_KEY = CFG.TOKEN_KEY || "nexcard_token";
  const EMPRESA_KEY = CFG.EMPRESA_KEY || "nexcard_empresa_id";
  const ALIAS_KEY = CFG.ALIAS_KEY || "nexcard_empresa_alias";

  // --- DOM ---
  const whoEl = document.getElementById("who");
  const empresaAliasEl = document.getElementById("empresaAlias");
  const empresaIdEl = document.getElementById("empresaId");
  const headEl = document.getElementById("contactsHead");
  const bodyEl = document.getElementById("contactsBody");
  const searchEl = document.getElementById("contactsSearch");

  const kpiTotal = document.getElementById("kpiTotal");
  const kpiHoy = document.getElementById("kpiHoy");
  const kpiSemana = document.getElementById("kpiSemana");
  const kpiMes = document.getElementById("kpiMes");

  const toastEl = document.getElementById("toast");
  const logoutBtn = document.getElementById("logoutBtn");

  // --- Utils ---
  const getParam = (k) => new URLSearchParams(location.search).get(k) || "";
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  const safe = (s) => String(s ?? "");

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.style.display = "block";
    setTimeout(() => (toastEl.style.display = "none"), 2400);
  }

  // JSONP helper (para GitHub Pages + Apps Script)
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cbName = "cb_" + Math.random().toString(36).slice(2);
      const script = document.createElement("script");
      window[cbName] = (data) => {
        try { delete window[cbName]; } catch (_) {}
        script.remove();
        resolve(data);
      };
      script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + cbName;
      script.onerror = () => {
        try { delete window[cbName]; } catch (_) {}
        script.remove();
        reject(new Error("No se pudo conectar al servidor."));
      };
      document.body.appendChild(script);
    });
  }

  function apiUrl(params) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => qs.set(k, String(v)));
    return `${API_BASE}?${qs.toString()}`;
  }

  function parseFechaToMs(v) {
    // Tus fechas suelen venir como ISO string desde landing
    const ms = Date.parse(String(v || ""));
    return Number.isFinite(ms) ? ms : NaN;
  }

  function countInRange(rows, days) {
    const now = Date.now();
    const min = now - days * 24 * 60 * 60 * 1000;
    let c = 0;
    for (const r of rows) {
      const ms = parseFechaToMs(r.Fecha || r.fecha);
      if (Number.isFinite(ms) && ms >= min && ms <= now) c++;
    }
    return c;
  }

  // --- State ---
  let token = localStorage.getItem(TOKEN_KEY) || "";
  let empresa_id = (getParam("empresa_id") || localStorage.getItem(EMPRESA_KEY) || "trampaclean").trim();
  let empresa_alias = (getParam("empresa") || localStorage.getItem(ALIAS_KEY) || empresa_id).trim();

  localStorage.setItem(EMPRESA_KEY, empresa_id);
  localStorage.setItem(ALIAS_KEY, empresa_alias);

  let allRows = [];
  let headers = [];

  // --- Render ---
  function renderTable(rows) {
    // header
    headEl.innerHTML = "";
    const ths = [...headers, "Acciones"];
    for (const h of ths) {
      const th = document.createElement("th");
      th.textContent = h;
      headEl.appendChild(th);
    }

    // body
    bodyEl.innerHTML = "";
    for (const row of rows) {
      const tr = document.createElement("tr");

      for (const h of headers) {
        const td = document.createElement("td");
        td.textContent = safe(row[h]);
        tr.appendChild(td);
      }

      const tdAct = document.createElement("td");
      tdAct.className = "right";
      const id = row.ID || row.Id || row.id || "";

      tdAct.innerHTML = `
        <button class="btn btn-sm btn-ghost" data-edit="${id}">Editar</button>
        <button class="btn btn-sm btn-danger" data-del="${id}">Borrar</button>
      `;
      tr.appendChild(tdAct);

      bodyEl.appendChild(tr);
    }
  }

  function renderKPIs(rows) {
    kpiTotal.textContent = rows.length;
    kpiHoy.textContent = countInRange(rows, 1);
    kpiSemana.textContent = countInRange(rows, 7);
    kpiMes.textContent = countInRange(rows, 30);
  }

  function applySearch() {
    const q = norm(searchEl.value);
    if (!q) {
      renderTable(allRows);
      renderKPIs(allRows);
      return;
    }
    const filtered = allRows.filter((r) =>
      headers.some((h) => norm(r[h]).includes(q))
    );
    renderTable(filtered);
    renderKPIs(filtered);
  }

  // --- Actions: load ---
  async function loadMe() {
    const res = await jsonp(apiUrl({ action: "me", token }));
    if (!res || res.ok !== true) throw new Error(res?.message || "Sesión inválida.");
    whoEl.textContent = `Conectado como ${res.email} (${res.role})`;
  }

  async function loadLeads() {
    const res = await jsonp(apiUrl({ action: "listLeads", token, empresa_id }));
    if (!res || res.ok !== true) throw new Error(res?.message || "No se pudo cargar leads.");

    headers = Array.isArray(res.headers) ? res.headers : [];
    allRows = Array.isArray(res.rows) ? res.rows : [];

    // Si por alguna razón headers viene vacío, inferimos de la primera fila
    if (!headers.length && allRows.length) headers = Object.keys(allRows[0]);

    renderTable(allRows);
    renderKPIs(allRows);
  }

  // --- Delete ---
  async function deleteLead(id) {
    const res = await jsonp(apiUrl({ action: "deleteLead", token, empresa_id, id }));
    if (!res || res.ok !== true) throw new Error(res?.message || "No se pudo borrar.");
    toast("Eliminado ✅");
    await loadLeads();
  }

  // --- Edit (simple prompt por ahora) ---
  async function editLead(id) {
    const row = allRows.find(r => String(r.ID || r.Id || r.id) === String(id));
    if (!row) return;

    // Edita solo campos comunes; puedes expandirlo luego con modal
    const nuevoNombre = prompt("Nombre:", row.Nombre ?? row.nombre ?? "");
    if (nuevoNombre === null) return;

    const nuevoTelefono = prompt("Teléfono:", row["Teléfono"] ?? row.telefono ?? "");
    if (nuevoTelefono === null) return;

    const nuevoCorreo = prompt("Correo/Email:", row.Correo ?? row.Email ?? row.email ?? "");
    if (nuevoCorreo === null) return;

    const data = Object.assign({}, row);
    // Mantener ID
    data.ID = row.ID || row.Id || row.id || id;
    // Escribir en el header exacto si existe
    if (headers.includes("Nombre")) data["Nombre"] = nuevoNombre;
    if (headers.includes("Teléfono")) data["Teléfono"] = nuevoTelefono;
    if (headers.includes("Correo")) data["Correo"] = nuevoCorreo;
    if (headers.includes("Email")) data["Email"] = nuevoCorreo;

    const res = await jsonp(apiUrl({
      action: "saveLead",
      token,
      empresa_id,
      data: JSON.stringify(data)
    }));
    if (!res || res.ok !== true) throw new Error(res?.message || "No se pudo guardar.");
    toast("Actualizado ✅");
    await loadLeads();
  }

  // --- Events ---
  searchEl?.addEventListener("input", applySearch);

  bodyEl?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const delId = btn.getAttribute("data-del");
    const editId = btn.getAttribute("data-edit");

    try {
      if (delId) {
        if (!confirm("¿Borrar este contacto?")) return;
        await deleteLead(delId);
      }
      if (editId) {
        await editLead(editId);
      }
    } catch (err) {
      console.error(err);
      toast(String(err?.message || err));
    }
  });

  logoutBtn?.addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    location.href = "login.html";
  });

  // --- Boot ---
  (async function init() {
    empresaAliasEl.textContent = empresa_alias;
    empresaIdEl.textContent = empresa_id;

    if (!token) {
      // si no hay token, manda a login
      location.href = "login.html";
      return;
    }

    try {
      await loadMe();
      await loadLeads();
      toast("Contactos cargados ✅");
    } catch (err) {
      console.error(err);
      toast(String(err?.message || err));
      // si token inválido
      if (String(err?.message || "").toLowerCase().includes("token")) {
        localStorage.removeItem(TOKEN_KEY);
        setTimeout(() => (location.href = "login.html"), 900);
      }
    }
  })();
})();
