// dashboard.js
(() => {
  const C = window.NEXCARD_CONFIG || {};
  const API_BASE = C.API_BASE;
  const TOKEN_KEY = C.TOKEN_KEY || "nexcard_token";
  const EMPRESA_KEY = C.EMPRESA_KEY || "nexcard_empresa_id";
  const ALIAS_KEY = C.ALIAS_KEY || "nexcard_empresa_alias";
  const PAGE_SIZE = Number(C.PAGE_SIZE || 20);

  // ===== DOM =====
  const whoEl = document.getElementById("who");
  const empresaIdEl = document.getElementById("empresaId");
  const empresaAliasEl = document.getElementById("empresaAlias");
  const logoutBtn = document.getElementById("logoutBtn");

  const headEl = document.getElementById("contactsHead");
  const bodyEl = document.getElementById("contactsBody");

  const searchEl = document.getElementById("contactsSearch");
  const filterVendedorEl = document.getElementById("filterVendedor");
  const filterInteresEl = document.getElementById("filterInteres");
  const clearFiltersBtn = document.getElementById("clearFiltersBtn");

  const prevPageBtn = document.getElementById("prevPageBtn");
  const nextPageBtn = document.getElementById("nextPageBtn");
  const pageInfo = document.getElementById("pageInfo");
  const rowsInfo = document.getElementById("rowsInfo");

  const copyEmpresaLink = document.getElementById("copyEmpresaLink");

  // ===== State =====
  let token = localStorage.getItem(TOKEN_KEY) || "";
  let empresa_id = "";
  let empresa_alias = "";

  let rawHeaders = [];
  let rawRows = [];            // array of objects {header:value}
  let visibleHeaders = [];     // headers excluding ID hidden
  let idHeaderName = null;     // which header is ID
  let dateHeaderName = null;   // which header is Fecha
  let vendedorHeaderName = null;
  let interesHeaderName = null;

  let filteredRows = [];
  let currentPage = 1;
  let totalPages = 1;

  // ===== Helpers =====
  function getParam(name) {
    const u = new URLSearchParams(location.search);
    return (u.get(name) || "").trim();
  }

  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = "cb_" + Math.random().toString(36).slice(2);
      const s = document.createElement("script");
      window[cb] = (data) => {
        try { delete window[cb]; } catch (_) {}
        s.remove();
        resolve(data);
      };
      s.onerror = () => {
        try { delete window[cb]; } catch (_) {}
        s.remove();
        reject(new Error("No se pudo conectar con el servidor."));
      };
      s.src = url + (url.includes("?") ? "&" : "?") + "callback=" + cb;
      document.body.appendChild(s);
    });
  }

  function norm(s) {
    return String(s || "").trim().toLowerCase();
  }

  function findHeader(headers, candidates) {
    const low = headers.map(h => norm(h));
    for (const c of candidates) {
      const idx = low.indexOf(norm(c));
      if (idx >= 0) return headers[idx];
    }
    return null;
  }

  function parseDate(value) {
    if (value == null) return null;
    if (value instanceof Date && !isNaN(value.getTime())) return value;

    const s = String(value).trim();
    if (!s) return null;

    // ISO / normal Date parse
    const d1 = new Date(s);
    if (!isNaN(d1.getTime())) return d1;

    // Try dd/mm/yyyy or dd-mm-yyyy
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      const dd = Number(m[1]);
      const mm = Number(m[2]) - 1;
      let yy = Number(m[3]);
      if (yy < 100) yy += 2000;
      const d2 = new Date(yy, mm, dd);
      if (!isNaN(d2.getTime())) return d2;
    }
    return null;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toast(msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.style.display = "none"), 1800);
  }

  function requireSessionOrRedirect() {
    if (!token) {
      location.href = "login.html";
      return false;
    }
    return true;
  }

  // ===== KPI =====
  function computeKPIs(rows) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msDay = 24 * 60 * 60 * 1000;

    let total = rows.length;
    let hoy = 0, semana = 0, mes = 0;

    for (const r of rows) {
      const d = dateHeaderName ? parseDate(r[dateHeaderName]) : null;
      if (!d) continue;
      const diff = now.getTime() - d.getTime();
      if (d >= startOfToday) hoy++;
      if (diff <= 7 * msDay) semana++;
      if (diff <= 30 * msDay) mes++;
    }

    document.getElementById("kpiTotal").textContent = String(total);
    document.getElementById("kpiHoy").textContent = String(hoy);
    document.getElementById("kpiSemana").textContent = String(semana);
    document.getElementById("kpiMes").textContent = String(mes);
  }

  // ===== Rendering =====
  function buildHeaderRow() {
    headEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const h of visibleHeaders) {
      const th = document.createElement("th");
      th.textContent = h;
      frag.appendChild(th);
    }
    headEl.appendChild(frag);
  }

  function renderTablePage() {
    // Pagination calc
    totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);

    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const pageRows = filteredRows.slice(start, end);

    bodyEl.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (const row of pageRows) {
      const tr = document.createElement("tr");
      for (const h of visibleHeaders) {
        const td = document.createElement("td");
        const v = row[h];
        td.innerHTML = escapeHtml(v);
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }

    bodyEl.appendChild(frag);

    // Pager info
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;

    pageInfo.textContent = `Página ${currentPage} / ${totalPages}`;
    rowsInfo.textContent = `${filteredRows.length} resultado(s)`;
  }

  function fillSelectOptions(selectEl, values, placeholderText) {
    const current = selectEl.value || "";
    selectEl.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = placeholderText;
    selectEl.appendChild(opt0);

    for (const v of values) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      selectEl.appendChild(o);
    }

    // Keep if still exists
    if ([...selectEl.options].some(o => o.value === current)) {
      selectEl.value = current;
    } else {
      selectEl.value = "";
    }
  }

  // ===== Filtering & sorting =====
  function applySortAndFilters() {
    // Start from rawRows
    let rows = rawRows.slice();

    // Sort by date desc
    if (dateHeaderName) {
      rows.sort((a, b) => {
        const da = parseDate(a[dateHeaderName])?.getTime() ?? 0;
        const db = parseDate(b[dateHeaderName])?.getTime() ?? 0;
        return db - da;
      });
    }

    // Filters: vendedor / interes
    const vend = filterVendedorEl.value.trim();
    const inte = filterInteresEl.value.trim();
    if (vend && vendedorHeaderName) {
      rows = rows.filter(r => String(r[vendedorHeaderName] ?? "").trim() === vend);
    }
    if (inte && interesHeaderName) {
      rows = rows.filter(r => String(r[interesHeaderName] ?? "").trim() === inte);
    }

    // Search (across visible columns only)
    const q = (searchEl.value || "").trim().toLowerCase();
    if (q) {
      rows = rows.filter(r => {
        for (const h of visibleHeaders) {
          const val = String(r[h] ?? "").toLowerCase();
          if (val.includes(q)) return true;
        }
        return false;
      });
    }

    filteredRows = rows;
    currentPage = 1;
    renderTablePage();
  }

  function buildFilterLists() {
    // Determine distinct vendor + interest
    const vendSet = new Set();
    const intSet = new Set();

    if (vendedorHeaderName) {
      for (const r of rawRows) {
        const v = String(r[vendedorHeaderName] ?? "").trim();
        if (v) vendSet.add(v);
      }
    }
    if (interesHeaderName) {
      for (const r of rawRows) {
        const v = String(r[interesHeaderName] ?? "").trim();
        if (v) intSet.add(v);
      }
    }

    const vendVals = [...vendSet].sort((a,b)=>a.localeCompare(b));
    const intVals = [...intSet].sort((a,b)=>a.localeCompare(b));

    fillSelectOptions(filterVendedorEl, vendVals, "Vendedor: Todos");
    fillSelectOptions(filterInteresEl, intVals, "Interés/Servicio: Todos");
  }

  // ===== API calls =====
  async function fetchMe() {
    const qs = new URLSearchParams({ action: "me", token });
    const data = await jsonp(`${API_BASE}?${qs.toString()}`);
    if (!data || data.ok !== true) throw new Error(data?.message || "No se pudo validar sesión.");
    return data; // {ok, email, role}
  }

  async function fetchLeads() {
    const qs = new URLSearchParams({ action: "listLeads", token, empresa_id });
    const data = await jsonp(`${API_BASE}?${qs.toString()}`);
    if (!data || data.ok !== true) throw new Error(data?.message || "No se pudo cargar leads.");
    return data; // {ok, headers, rows}
  }

  function detectColumns(headers) {
    rawHeaders = headers.slice();

    // Identify special headers
    idHeaderName = findHeader(headers, ["id", "ID", "Id"]);
    dateHeaderName = findHeader(headers, ["fecha", "Fecha", "timestamp", "Timestamp", "created_at", "Created At"]);

    // Common names in your sheet:
    vendedorHeaderName = findHeader(headers, ["vendedor", "Vendedor", "seller", "Seller"]);
    interesHeaderName = findHeader(headers, ["interés", "interes", "Interés", "Interes", "intereses", "Intereses", "servicio", "Servicio"]);

    // Visible headers = everything except ID
    visibleHeaders = headers.filter(h => h !== idHeaderName);
  }

  // ===== Events =====
  function wireEvents() {
    logoutBtn?.addEventListener("click", () => {
      localStorage.removeItem(TOKEN_KEY);
      toast("Sesión cerrada");
      setTimeout(() => (location.href = "login.html"), 200);
    });

    searchEl?.addEventListener("input", () => applySortAndFilters());
    filterVendedorEl?.addEventListener("change", () => applySortAndFilters());
    filterInteresEl?.addEventListener("change", () => applySortAndFilters());

    clearFiltersBtn?.addEventListener("click", () => {
      searchEl.value = "";
      filterVendedorEl.value = "";
      filterInteresEl.value = "";
      applySortAndFilters();
    });

    prevPageBtn?.addEventListener("click", () => {
      if (currentPage > 1) currentPage--;
      renderTablePage();
    });

    nextPageBtn?.addEventListener("click", () => {
      if (currentPage < totalPages) currentPage++;
      renderTablePage();
    });

    copyEmpresaLink?.addEventListener("click", async () => {
      const url = `${location.origin}${location.pathname}?empresa_id=${encodeURIComponent(empresa_id)}&empresa=${encodeURIComponent(empresa_alias)}`;
      try {
        await navigator.clipboard.writeText(url);
        toast("Link copiado");
      } catch (_) {
        prompt("Copia este link:", url);
      }
    });
  }

  // ===== Init =====
  async function init() {
    if (!requireSessionOrRedirect()) return;
    if (!API_BASE) {
      whoEl.textContent = "Configuración incompleta.";
      return;
    }

    // empresa_id from URL or localStorage
    const empFromUrl = getParam("empresa_id");
    const aliasFromUrl = getParam("empresa");

    empresa_id = (empFromUrl || localStorage.getItem(EMPRESA_KEY) || "").trim().toLowerCase();
    empresa_alias = (aliasFromUrl || localStorage.getItem(ALIAS_KEY) || empresa_id || "—").trim();

    if (!empresa_id) {
      // no empresa configured — send to login
      location.href = "login.html";
      return;
    }

    // persist
    localStorage.setItem(EMPRESA_KEY, empresa_id);
    localStorage.setItem(ALIAS_KEY, empresa_alias);

    empresaIdEl.textContent = empresa_id;
    empresaAliasEl.textContent = empresa_alias;

    wireEvents();

    try {
      const me = await fetchMe();
      whoEl.textContent = `${me.email} • ${String(me.role || "").toUpperCase()}`;

      const leads = await fetchLeads();
      detectColumns(leads.headers || []);

      // rows already objects from backend
      rawRows = Array.isArray(leads.rows) ? leads.rows : [];

      // Build UI
      buildHeaderRow();
      buildFilterLists();

      // KPIs from full dataset (sorted not required)
      computeKPIs(rawRows);

      // Apply initial sort+filters (sort by date desc)
      applySortAndFilters();

    } catch (err) {
      console.error(err);
      whoEl.textContent = "No se pudo cargar la sesión.";
      toast(String(err?.message || err));
      // If token is invalid/expired, bounce to login
      const m = String(err?.message || err);
      if (m.toLowerCase().includes("token")) {
        localStorage.removeItem(TOKEN_KEY);
        setTimeout(() => (location.href = "login.html"), 400);
      }
    }
  }

  init();
})();
