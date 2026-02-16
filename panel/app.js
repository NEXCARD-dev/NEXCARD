
(function(){
  const CFG = window.NEXCARD_CONFIG || {};
  const API_BASE = CFG.API_BASE || "";
  const TOKEN_KEY = CFG.TOKEN_KEY || "nexcard_token_v1";

  const UI = {
    toast(msg){
      const t = document.getElementById("toast");
      if (!t) return alert(msg);
      t.textContent = msg;
      t.style.display = "block";
      clearTimeout(UI._tm);
      UI._tm = setTimeout(()=> t.style.display="none", 2800);
    },
    escape(s){
      return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }
  };

  function jsonp(url){
    return new Promise((resolve, reject) => {
      const cb = "cb_" + Math.random().toString(16).slice(2);
      const u = new URL(url);
      u.searchParams.set("callback", cb);

      const script = document.createElement("script");
      window[cb] = (data) => {
        try { delete window[cb]; } catch {}
        script.remove();
        resolve(data);
      };
      script.onerror = () => {
        try { delete window[cb]; } catch {}
        script.remove();
        reject(new Error("JSONP load failed"));
      };
      script.src = u.toString();
      document.body.appendChild(script);
    });
  }

  function tokenGet(){ return localStorage.getItem(TOKEN_KEY) || ""; }
  function tokenSet(t){ localStorage.setItem(TOKEN_KEY, t); }
  function tokenClear(){ localStorage.removeItem(TOKEN_KEY); }

  function apiUrl(params){
    if (!API_BASE || API_BASE.includes("PEGA_AQUI")) throw new Error("API_BASE no configurado en panel/config.js");
    const u = new URL(API_BASE);
    Object.entries(params || {}).forEach(([k,v]) => {
      if (v === undefined || v === null || v === "") return;
      u.searchParams.set(k, String(v));
    });
    return u.toString();
  }

  async function apiCall(params){
    const u = apiUrl(params);
    const j = await jsonp(u);
    if (!j || j.ok === false) throw new Error(j?.message || "Error API");
    return j;
  }

  window.NexcardPanel = {
    UI,
    tokenGet, tokenSet, tokenClear,
    async login(email, password){
      return await apiCall({ action:"login", email, password });
    },
    async me(){
      const token = tokenGet();
      return await apiCall({ action:"me", token });
    },
    async contacts(query){
      const token = tokenGet();
      return await apiCall({ action:"contacts", token, ...(query||{}) });
    }
  };
})();
