// Injects brand badge into the bottom nav pill on mobile and a fixed brand on desktop
// Updated: 2026-03-08 20:30 - Logo positioning fix
(function(){
  var hapticsLoader = null;
  function loadScriptOnce(src){
    return new Promise(function(resolve, reject){
      try{
        var existing = document.querySelector('script[data-toaster-loader="' + src + '"]');
        if(existing){
          if(existing.dataset.loaded === '1') return resolve(true);
          existing.addEventListener('load', function(){ resolve(true); }, { once: true });
          existing.addEventListener('error', function(){ reject(new Error('failed: ' + src)); }, { once: true });
          return;
        }
        var script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.dataset.toasterLoader = src;
        script.onload = function(){
          script.dataset.loaded = '1';
          resolve(true);
        };
        script.onerror = function(){ reject(new Error('failed: ' + src)); };
        document.head.appendChild(script);
      }catch(error){
        reject(error);
      }
    });
  }
  function ensureHaptics(){
    try{
      if(window && window.toasterHaptics) return Promise.resolve(window.toasterHaptics);
      if(hapticsLoader) return hapticsLoader;
      hapticsLoader = loadScriptOnce('haptics.js')
        .then(function(){ return window && window.toasterHaptics; })
        .catch(function(){ return null; });
      return hapticsLoader;
    }catch(_){
      return Promise.resolve(null);
    }
  }

  function triggerHaptic(type){
    try{
      ensureHaptics().then(function(haptics){
        try{ haptics && haptics.trigger && haptics.trigger(type); }catch(_){ }
      });
    }catch(_){ }
  }

  function getWcaBetaOverrideFromQuery(){
    try{
      var params = new URLSearchParams((window && window.location && window.location.search) || '');
      var value = String(params.get('wcaBeta') || '').toLowerCase().trim();
      if(value === '1' || value === 'true' || value === 'on') return true;
      if(value === '0' || value === 'false' || value === 'off') return false;
    }catch(_){ }
    return null;
  }

  function getWcaBetaOverrideFromStorage(){
    try{
      var value = String(localStorage.getItem('toaster_wca_beta') || '').toLowerCase().trim();
      if(value === '1' || value === 'true' || value === 'on') return true;
      if(value === '0' || value === 'false' || value === 'off') return false;
    }catch(_){ }
    return null;
  }

  function publishWcaBetaFlag(enabled){
    try{
      window.toasterFeatureFlags = window.toasterFeatureFlags || {};
      window.toasterFeatureFlags.wcaLinkedBeta = !!enabled;
      window.dispatchEvent(new CustomEvent('toaster:wca-beta-changed', { detail: { enabled: !!enabled } }));
    }catch(_){ }
  }

  async function resolveWcaBetaEnabled(){
    if (window && window.__TOASTER_SKIP_AUTH_PROBES) {
      publishWcaBetaFlag(false);
      return false;
    }
    var fromQuery = getWcaBetaOverrideFromQuery();
    if(fromQuery !== null){
      publishWcaBetaFlag(fromQuery);
      return fromQuery;
    }

    var fromStorage = getWcaBetaOverrideFromStorage();
    if(fromStorage !== null){
      publishWcaBetaFlag(fromStorage);
      return fromStorage;
    }

    try{
      if(window && window.authManager && typeof window.authManager.checkAuthState === 'function'){
        var state = await window.authManager.checkAuthState();
        var groups = state && state.user && Array.isArray(state.user.groups) ? state.user.groups : [];
        var isInternal = groups.indexOf('admins') >= 0 || groups.indexOf('internal_beta') >= 0 || groups.indexOf('beta_testers') >= 0;
        publishWcaBetaFlag(isInternal);
        return isInternal;
      }
    }catch(_){ }

    publishWcaBetaFlag(false);
    return false;
  }

  var WCA_LINKED_ID_KEY = 'toaster_linked_wca_id';
  var WCA_LINKED_USER_KEY = 'toaster_linked_wca_user_sub';
  var WCA_PROFILE_CACHE_PREFIX = 'toaster_wca_profile_cache:';
  var WCA_PROFILE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

  function normalizeWcaId(raw){
    return String(raw || '')
      .trim()
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '');
  }

  function decodeJwtPayload(token){
    try{
      var payloadSegment = String(token || '').split('.')[1];
      if(!payloadSegment) return null;
      var normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
      var padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      return JSON.parse(atob(padded));
    }catch(_){
      return null;
    }
  }

  function extractWcaIdFromValue(value){
    var text = String(value || '').trim();
    if(!text) return '';

    var urlMatch = text.match(/worldcubeassociation\.org\/persons\/([0-9A-Za-z]+)/i);
    if(urlMatch && urlMatch[1]) return normalizeWcaId(urlMatch[1]);

    var direct = normalizeWcaId(text);
    if(/^[0-9]{4}[A-Z]{4}[0-9]{2}$/.test(direct)) return direct;
    return '';
  }

  function resolveLinkedWcaIdFromPayload(payload){
    if(!payload || typeof payload !== 'object') return '';
    var candidateKeys = [
      'custom:wca_id',
      'custom:wcaId',
      'wca_id',
      'wcaId',
      'wca',
      'wcaProfile',
      'profile'
    ];
    for(var i = 0; i < candidateKeys.length; i += 1){
      var key = candidateKeys[i];
      if(Object.prototype.hasOwnProperty.call(payload, key)){
        var fromClaim = extractWcaIdFromValue(payload[key]);
        if(fromClaim) return fromClaim;
      }
    }
    return '';
  }

  function readLinkedWcaIdFromStorage(){
    try{
      return normalizeWcaId(localStorage.getItem(WCA_LINKED_ID_KEY) || '');
    }catch(_){
      return '';
    }
  }

  function writeLinkedWcaIdToStorage(wcaId, userSub){
    try{
      if(wcaId){
        localStorage.setItem(WCA_LINKED_ID_KEY, wcaId);
      }
      if(userSub){
        localStorage.setItem(WCA_LINKED_USER_KEY, String(userSub));
      }
    }catch(_){ }
  }

  function readCachedWcaProfile(wcaId){
    try{
      if(!wcaId) return null;
      var raw = localStorage.getItem(WCA_PROFILE_CACHE_PREFIX + wcaId);
      if(!raw) return null;
      var parsed = JSON.parse(raw);
      if(!parsed || typeof parsed !== 'object') return null;
      var fetchedAt = Number(parsed.fetchedAt || 0);
      if(!Number.isFinite(fetchedAt) || (Date.now() - fetchedAt) > WCA_PROFILE_CACHE_TTL_MS){
        return null;
      }
      return parsed.person || null;
    }catch(_){
      return null;
    }
  }

  function writeCachedWcaProfile(wcaId, person){
    try{
      if(!wcaId || !person) return;
      localStorage.setItem(WCA_PROFILE_CACHE_PREFIX + wcaId, JSON.stringify({
        fetchedAt: Date.now(),
        person: person
      }));
    }catch(_){ }
  }

  async function resolveLinkedWcaFromAuth(){
    try{
      if(!window || !window.authManager) return { linkedWcaId: '', userSub: '' };

      var state = await window.authManager.checkAuthState();
      if(!state || !state.isAuthenticated || !state.user){
        return { linkedWcaId: '', userSub: '' };
      }

      var idToken = '';
      try{
        if(typeof window.authManager.getIdToken === 'function'){
          idToken = await window.authManager.getIdToken();
        }
      }catch(_){ }
      if(!idToken && state.user.idToken) idToken = state.user.idToken;

      var payload = decodeJwtPayload(idToken);
      var linkedWcaId = resolveLinkedWcaIdFromPayload(payload);
      return {
        linkedWcaId: linkedWcaId || '',
        userSub: state.user.sub || ''
      };
    }catch(_){
      return { linkedWcaId: '', userSub: '' };
    }
  }

  async function fetchWcaPerson(linkedWcaId){
    if(!linkedWcaId) return null;
    var cached = readCachedWcaProfile(linkedWcaId);
    if(cached) return cached;
    try{
      var response = await fetch('https://www.worldcubeassociation.org/api/v0/persons/' + encodeURIComponent(linkedWcaId), {
        headers: { accept: 'application/json' }
      });
      if(!response.ok) return null;
      var payload = await response.json();
      var person = payload && payload.person ? payload.person : null;
      if(person) writeCachedWcaProfile(linkedWcaId, person);
      return person;
    }catch(_){
      return null;
    }
  }

  function publishWcaAccountState(state){
    try{
      window.toasterWcaAccount = state;
      window.dispatchEvent(new CustomEvent('toaster:wca-linked', { detail: state }));
    }catch(_){ }
  }

  async function bootstrapWcaAccountSync(forceRefresh){
    var enabled = await resolveWcaBetaEnabled();
    if(!enabled){
      publishWcaAccountState({ linkedWcaId: '', person: null, source: 'disabled' });
      return;
    }

    var storedId = readLinkedWcaIdFromStorage();
    var initialState = { linkedWcaId: storedId || '', person: readCachedWcaProfile(storedId), source: 'storage' };
    if(initialState.linkedWcaId || initialState.person){
      publishWcaAccountState(initialState);
    }

    var authState = await resolveLinkedWcaFromAuth();
    var resolvedId = normalizeWcaId(authState.linkedWcaId || storedId || '');
    if(resolvedId){
      writeLinkedWcaIdToStorage(resolvedId, authState.userSub || '');
    }
    var person = (!forceRefresh && resolvedId) ? readCachedWcaProfile(resolvedId) : null;
    if(!person && resolvedId){
      person = await fetchWcaPerson(resolvedId);
    }
    publishWcaAccountState({
      linkedWcaId: resolvedId || '',
      person: person || null,
      source: authState.linkedWcaId ? 'auth' : (storedId ? 'storage' : 'none')
    });
  }

  if(typeof window !== 'undefined' && !window.toasterWcaAccountSync){
    window.toasterWcaAccountSync = {
      refresh: function(){ return bootstrapWcaAccountSync(true); },
      getState: function(){ return window.toasterWcaAccount || null; },
      getLinkedWcaId: function(){
        if(!(window.toasterFeatureFlags && window.toasterFeatureFlags.wcaLinkedBeta)) return '';
        var state = window.toasterWcaAccount || {};
        return normalizeWcaId(state.linkedWcaId || '') || readLinkedWcaIdFromStorage();
      }
    };
  }

  function ready(fn){ if(document.readyState!=='loading'){ fn(); } else { document.addEventListener('DOMContentLoaded', fn); } }
  ready(function(){
    try{
      function getPathName(){
        try {
          var path = (location && location.pathname) || '';
          return path.split('/').pop() || 'index.html';
        } catch (_) {
          return 'index.html';
        }
      }

      function isTimerPage(){
        var path = getPathName();
        return path === 'index.html' || path === '';
      }

      function isNativeMobileDashboardMode(){
        try {
          var capacitorNative = !!(
            window.Capacitor &&
            typeof window.Capacitor.isNativePlatform === 'function' &&
            window.Capacitor.isNativePlatform()
          );
          if (capacitorNative) return true;
          return (location && location.protocol === 'capacitor:');
        } catch (_) {
          return false;
        }
      }

      function getDashboardHref(){
        try {
          var mode = String(localStorage.getItem('toaster_dashboard_home_mode') || 'classic').toLowerCase().trim();
          if (mode === 'interactive') return 'dashboard-interactive.html';
        } catch (_) {}
        return 'dashboard.html';
      }

      function refreshDashboardHomeLinks(){
        try {
          var href = getDashboardHref();
          document.querySelectorAll('a[aria-label="Home"]').forEach(function(link){
            try { link.setAttribute('href', href); } catch(_) {}
          });
          var fixedBrand = document.querySelector('.brand-fixed-left');
          if (fixedBrand && fixedBrand.tagName === 'A') {
            fixedBrand.setAttribute('href', href);
          }
        } catch (_) {}
      }

      if (typeof window !== 'undefined') {
        window.toasterRefreshDashboardHref = refreshDashboardHomeLinks;
      }

      function createNavMarkup(activePath){
        var aiActive = activePath === 'ai.html';
        var homeHref = getDashboardHref();
        var timerActive = isTimerPage();
        var timerHref = timerActive ? '#main-timer-area' : 'index.html#main-timer-area';
        return '' +
          '<div class="app-nav-shell nav-pill" role="navigation" aria-label="Quick navigation">' +
            '<a href="' + homeHref + '" aria-label="Home">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5L12 3l9 7.5"></path><path d="M9 21V12h6v9"></path></svg>' +
            '</a>' +
            '<a href="ai.html" aria-label="AI Assistant"' + (aiActive ? ' class="is-active"' : '') + '>' +
              '<img src="img/toaster-ai-logo.svg" alt="AI" class="app-nav-ai-icon">' +
            '</a>' +
            '<a href="' + timerHref + '" aria-label="Timer"' + (timerActive ? ' class="is-active" aria-current="page" data-nav-current="timer"' : '') + '>' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2h4"></path><path d="M12 14V8"></path><circle cx="12" cy="14" r="8"></circle></svg>' +
            '</a>' +
            '<a href="courses.html" aria-label="Courses">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="18" r="2"></circle><circle cx="18" cy="6" r="2"></circle><path d="M6 18c0-6 6-6 6-6"></path><path d="M12 12c0-6 6-6 6-6"></path></svg>' +
            '</a>' +
          '</div>';
      }

      // Styles: homepage-like nav shell + existing brand behavior.
      var css = `
        * { -webkit-tap-highlight-color: transparent; }
        .app-nav-dock{position:fixed;left:0;right:0;bottom:0;margin-left:auto;margin-right:auto;width:fit-content;max-width:calc(100vw - 24px);transform:none;z-index:1000;padding:0 0 calc(env(safe-area-inset-bottom, 0px) + 8px)}
        .nav-pill,.app-nav-shell{ position: relative; display:flex; gap:14px; padding:8px 12px; border-radius:9999px;
          background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04)), rgba(99,102,241,0.1);
          border:1px solid rgba(255,255,255,0.18); box-shadow: inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px rgba(0,0,0,0.18);
          backdrop-filter: saturate(140%) blur(20px); }
        .nav-pill a,.app-nav-shell a{ display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:50%;
          color:#e5e7eb; background: rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); text-decoration:none;
          touch-action:manipulation; -webkit-tap-highlight-color:transparent; }
        .nav-pill a:hover,.app-nav-shell a:hover{ background: rgba(255,255,255,0.12); }
        .nav-pill svg,.app-nav-shell svg{ width:20px; height:20px; }
        .app-nav-shell a.is-active{ background: rgba(255,255,255,0.14); border-color: rgba(255,255,255,0.22); }
        body.app-glass-mode .nav-pill,body.app-glass-mode .app-nav-shell{
          background: color-mix(in srgb, #ffffff 15%, transparent) !important;
          border-color: color-mix(in srgb, #ffffff 30%, transparent) !important;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.28), 0 16px 34px rgba(0,0,0,0.28) !important;
          backdrop-filter: saturate(150%) blur(22px) !important;
          -webkit-backdrop-filter: saturate(150%) blur(22px) !important;
        }
        body.app-glass-mode .nav-pill a,body.app-glass-mode .app-nav-shell a{
          background: color-mix(in srgb, #ffffff 14%, transparent) !important;
          border-color: color-mix(in srgb, #ffffff 34%, transparent) !important;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.26), 0 10px 20px rgba(0,0,0,0.2) !important;
        }
        body.app-glass-mode .nav-pill a:hover,body.app-glass-mode .app-nav-shell a:hover,
        body.app-glass-mode .app-nav-shell a.is-active{
          background: color-mix(in srgb, var(--accent-color, #0ea5e9) 26%, rgba(255,255,255,0.20)) !important;
          border-color: color-mix(in srgb, #ffffff 42%, transparent) !important;
        }
        .app-nav-ai-icon{ width:22px; height:22px; object-fit:contain; display:block; }
        .brand-logo{display:inline-flex;align-items:center;justify-content:center;background-repeat:no-repeat;background-position:center;background-size:cover}
        .brand-logo-in-nav{display:none !important;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;opacity:1;z-index:10;filter:drop-shadow(0 0 2px rgba(0,0,0,.35));border-radius:6px}
        .brand-fixed-left{position:relative;display:none !important;opacity:.95;margin:0 auto;padding:0;text-align:center}
        .brand-fixed-left{filter:drop-shadow(0 0 2px rgba(0,0,0,.35));border-radius:10px}
        .brand-logo img{opacity:0;animation:brandFade .6s ease-out 1 both;animation-play-state:paused}
        body.brand-live .brand-logo img{opacity:1;animation-play-state:running}
        @keyframes brandFade{from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
        body.splashing{overflow:hidden}
        #brand-splash{position:fixed;inset:0;background:#ffffff;z-index:2147483647;display:flex;align-items:center;justify-content:center;opacity:1;transition:opacity .35s ease}
        #brand-splash.blue{background:linear-gradient(180deg, #1e3a8a, #2563eb)}
        #brand-splash img{width:min(140px,40vw);height:auto;display:block}
        @media(min-width:768px){ .brand-fixed-left{display:inline-flex !important} }
        @media(min-width:980px){ .brand-logo-in-nav{ display:none !important } }
        .brand-fallback-bottom{position:fixed;left:50%;transform:translateX(-50%);bottom:0;z-index:1000;padding-bottom:calc(env(safe-area-inset-bottom,0px) + 8px);display:none !important}
        @media(min-width:768px){ .brand-fallback-bottom{display:none} }
      `;
      var style = document.createElement('style');
      style.id = 'brand-nav-style';
      style.textContent = css;
      document.head.appendChild(style);

      // Resolve logo URL (any image ext): window.BRAND_LOGO_URL > body[data-brand-logo] > img/toaster-pill-logo.png
      var hinted = (window && window.BRAND_LOGO_URL) || document.body.getAttribute('data-brand-logo');
      var logoUrl = hinted || 'img/toaster-pill-logo.png';
      // Add cache-busting to avoid stale images after swaps
      try{
        if(logoUrl.indexOf('?') === -1){
          var vb = (window && window.BRAND_LOGO_VERSION) ? 'v='+window.BRAND_LOGO_VERSION : 'v='+(Date.now());
          logoUrl += ('?'+vb);
        }

      }catch(_){ }
      // Loading GIF while backend/app readies (relative path for both local and prod)
      var loadingUrl = (window && window.BRAND_LOADING_URL) || 'img/loading.gif';
      try{ if(loadingUrl.indexOf('?') === -1){ loadingUrl += ('?'+(Date.now())); } }catch(_){ }
      // Safe inline fallback if the provided URL fails to load
      var safeFallback = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyOCIgaGVpZ2h0PSIyOCI+PHJlY3Qgd2lkdGg9IjI4IiBoZWlnaHQ9IjI4IiBmaWxsPSJub25lIi8+PC9zdmc+';
      var imgTagInNav = '<img src="'+safeFallback+'" onerror="this.onerror=null;this.src=\''+safeFallback+'\'" alt="" aria-hidden="true">';
      var imgTagFixed = '<img src="'+safeFallback+'" onerror="this.onerror=null;this.src=\''+safeFallback+'\'" alt="Toaster">';

      // Readiness detector: ping backend or wait for event, then swap images to real logo and hide splash
      function whenReady(cb){
        var done=false; function finish(){ if(!done){ done=true; try{ cb(); }catch(_){} } }
        try{
          // Event shortcut: allow app to signal readiness
          window.addEventListener('app-ready', finish, { once:true });
          // Timeout fallback
          setTimeout(finish, 5000);
          // Ping backend if configured
          var pingUrl = window.BRAND_PING_URL;
          if(pingUrl){
            var ctrl = (window.AbortController? new AbortController(): null);
            var to = setTimeout(function(){ try{ ctrl && ctrl.abort(); }catch(_){} }, 3000);
            fetch(pingUrl, { cache:'no-store', method:'GET', signal: ctrl? ctrl.signal: undefined })
              .then(function(r){ clearTimeout(to); if(r && (r.ok || r.status<500)) finish(); })
              .catch(function(){ /* ignore; timeout or error will be covered by setTimeout */ });
          }
        }catch(_){ setTimeout(finish, 3000); }
      }

      function setBrandImageNow(img, url){
        try{
          if(!img || !url) return;
          img.src = url;
          img.style.display = 'block';
        }catch(_){ }
      }

      // Insert fullscreen splash only on first-load, or for specific pages
      var firstDone = false; try{ firstDone = (localStorage.getItem('toaster_first_load_done') === '1'); }catch(_){ }
      var splashSeenThisSession = false; try{ splashSeenThisSession = (sessionStorage.getItem('toaster_splash_seen_session') === '1'); }catch(_){ }
      var pth = (location && location.pathname) || '';
      var disableSplashForRoute = /(?:^|\/)(app-onboarding)(?:\.html)?$/i.test(pth);
      var forceSplash = /(?:^|\/)(courses)(?:\.html)?$|(?:^|\/)(report)(?:\.html)?$/i.test(pth);
      var navEntry = (performance && performance.getEntriesByType) ? (performance.getEntriesByType('navigation')[0] || null) : null;
      var isReload = !!(navEntry ? (navEntry.type === 'reload') : (performance && performance.navigation && performance.navigation.type === 1));
      var isBackForward = !!(navEntry ? (navEntry.type === 'back_forward') : false);
      var isSameOriginReferrer = false;
      try {
        if (document.referrer) {
          isSameOriginReferrer = (new URL(document.referrer, location.href)).origin === location.origin;
        }
      } catch(_) {}
      var isStandaloneLaunch = false;
      try {
        isStandaloneLaunch = !!(
          (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
          navigator.standalone === true
        );
      } catch(_) {}
      
      // Check for slow connection
      var isSlowConnection = false;
      try {
        var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn) {
          // Show splash on slow connections (2g, slow-2g) or when saveData is enabled
          isSlowConnection = (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g' || conn.saveData === true);
        }
      } catch(_) {}
      
      var isFreshLaunch = !splashSeenThisSession && (!isSameOriginReferrer || isStandaloneLaunch);
      var shouldShowForStartup = isFreshLaunch && ((!firstDone) || isStandaloneLaunch || isSlowConnection);
      var shouldShowForReload = isReload && !isBackForward;
      var showSplash = !disableSplashForRoute && (forceSplash || shouldShowForReload || ((!isBackForward) && shouldShowForStartup));
      try{
        if(showSplash){
          document.body.classList.add('splashing');
          if(!document.getElementById('brand-splash')){
            var splash = document.createElement('div');
            splash.id = 'brand-splash';
            try{ if((window && window.BRAND_SPLASH_THEME)==='blue'){ splash.classList.add('blue'); } }catch(_){ }
            splash.innerHTML = '<img src="'+loadingUrl+'" alt="loading">';
            document.body.appendChild(splash);
          }
        } else {
          // No splash: allow brand animations to run immediately
          document.body.classList.add('brand-live');
        }
      }catch(_){ }

      // Hide splash after readiness and minimum duration, then arm brand animations (placed here after whenReady() and splash insertion)
      (function(){
        if(!showSplash) return;
        var minMs = window.BRAND_SPLASH_MIN_MS || 1600;
        var start = Date.now();
        whenReady(function(){
          var left = Math.max(0, minMs - (Date.now()-start));
          setTimeout(function(){
            try{
              var el = document.getElementById('brand-splash');
              if(el){ el.style.opacity = '0'; setTimeout(function(){ el.remove(); }, 380); }
              document.body.classList.remove('splashing');
              document.body.classList.add('brand-live');
              try{ localStorage.setItem('toaster_first_load_done','1'); }catch(_){ }
              try{ sessionStorage.setItem('toaster_splash_seen_session','1'); }catch(_){ }
            }catch(_){ }
          }, left);
        });
      })();
      if(!showSplash){
        try{ sessionStorage.setItem('toaster_splash_seen_session','1'); }catch(_){ }
      }
      function cleanupDuplicateNavs(){
        try {
          var selectors = ['.top-bar', '.nav-dock'];
          selectors.forEach(function(selector){
            document.querySelectorAll(selector).forEach(function(node){
              if(node && !node.classList.contains('app-nav-dock')) node.remove();
            });
          });
          if (!isTimerPage()) {
            document.querySelectorAll('#global-bottom-nav').forEach(function(node){
              if(node) node.remove();
            });
          }
        } catch (_) {}
      }

      function ensureSharedNav(){
        try {
          cleanupDuplicateNavs();
          if (isTimerPage()) {
            var timerNav = document.getElementById('global-bottom-nav');
            if (timerNav) {
              timerNav.innerHTML = createNavMarkup(getPathName()).replace(/^<div class="app-nav-shell nav-pill" role="navigation" aria-label="Quick navigation">/, '').replace(/<\/div>$/, '');
              timerNav.classList.add('app-nav-shell');
            }
            return;
          }
          if (document.querySelector('.app-nav-dock')) return;
          var dock = document.createElement('div');
          dock.className = 'app-nav-dock';
          dock.innerHTML = createNavMarkup(getPathName());
          document.body.appendChild(dock);
        } catch (_) {}
      }

      function bindNavHaptics(){
        try{
          document.querySelectorAll('a[aria-label="AI Assistant"]').forEach(function(link){
            if(!link || link.dataset.hapticsBound === '1') return;
            link.dataset.hapticsBound = '1';
            link.addEventListener('pointerdown', function(event){
              if(event.pointerType === 'mouse' && event.button !== 0) return;
              triggerHaptic('nav-ai');
            });
            link.addEventListener('keydown', function(event){
              if(event.key === 'Enter' || event.key === ' '){
                triggerHaptic('nav-ai');
              }
            });
          });
        }catch(_){ }
      }

      function bindNavIsolation(){
        try{
          document.querySelectorAll('.app-nav-shell, #global-bottom-nav, #session-aside .nav-pill').forEach(function(nav){
            if(!nav || nav.dataset.touchIsolationBound === '1') return;
            nav.dataset.touchIsolationBound = '1';

            nav.addEventListener('touchstart', function(event){
              event.stopPropagation();
            }, { passive: true });
          });
        }catch(_){ }
      }

      function isMobileViewport(){
        try{
          return Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0) <= 767;
        }catch(_){
          return false;
        }
      }

      function getActiveTextField(){
        try{
          var activeEl = document.activeElement;
          if(activeEl && activeEl.matches && activeEl.matches('input, textarea, select, [contenteditable="true"]')){
            return activeEl;
          }
        }catch(_){ }
        return null;
      }

      function getEventElementTarget(target){
        if(target && target.nodeType === Node.ELEMENT_NODE) return target;
        return (target && target.parentElement) ? target.parentElement : null;
      }

      function bindKeyboardDismissOnOutsideTap(){
        try{
          if(document.documentElement.dataset.keyboardDismissBound === '1') return;
          document.documentElement.dataset.keyboardDismissBound = '1';

          document.addEventListener('pointerdown', function(event){
            try{
              var activeField = getActiveTextField();
              if(!activeField || !isMobileViewport()) return;

              var target = getEventElementTarget(event.target);
              if(!target || !target.closest) return;
              if(target.closest('input, textarea, select, [contenteditable="true"]')) return;

              var isInteractive = !!target.closest('button, a, label, [role="button"], [tabindex]');
              activeField.blur();

              if(isInteractive){
                event.preventDefault();
                event.stopPropagation();
              }
            }catch(_){ }
          }, true);
        }catch(_){ }
      }

      ensureSharedNav();
      refreshDashboardHomeLinks();
      bindNavHaptics();
      bindNavIsolation();
      bindKeyboardDismissOnOutsideTap();
      if (!(window && window.__TOASTER_SKIP_AUTH_PROBES)) {
        bootstrapWcaAccountSync(false);
      }
      try{
        if(document.querySelector('.profile-shell .avatar-wrap')){
          document.body.classList.add('profile-page');
        }
      }catch(_){ }

      // Mobile-only fixed top-center brand (very top middle)
      try{
        // CSS
        var extraCss = `
          .brand-fixed-top-center{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 28px);transform:translateX(-50%);z-index:1000;display:none;opacity:.98;pointer-events:none}
          .brand-fixed-top-center img{height:48px;width:auto;max-width:70vw;display:block}
          .profile-page .brand-fixed-top-center{top:calc(env(safe-area-inset-top,0px) + 14px)}
          .profile-page .profile-shell{padding-top:calc(env(safe-area-inset-top, 0px) + 110px) !important}
          @media(max-width:767px){ .brand-fixed-top-center{display:inline-flex} }
        `;
        style.textContent += "\n" + extraCss;

        var topc = document.querySelector('.brand-fixed-top-center');
        if(!topc){
          topc = document.createElement('span');
          topc.className = 'brand-logo brand-fixed-top-center';
          topc.setAttribute('aria-hidden','true');
          topc.innerHTML = imgTagInNav;
          document.body.appendChild(topc);
        }
        var tcimg = topc.querySelector('img');
        if(tcimg){ tcimg.style.objectFit='contain'; tcimg.style.borderRadius='8px'; tcimg.style.display='none'; setBrandImageNow(tcimg, logoUrl); }
      }catch(_){ }

      // Desktop & Tablet brand positioning (above content)
      if(!document.querySelector('.brand-fixed-left')){
        var fixed = document.createElement('a');
        fixed.href = getDashboardHref();
        fixed.className = 'brand-logo brand-fixed-left';
        fixed.setAttribute('aria-label','Toaster');
        fixed.innerHTML = imgTagFixed;
        var fimg = fixed.querySelector('img');
        if(fimg){
          fimg.style.objectFit='contain';
          fimg.style.objectPosition='center center';
          fimg.style.borderRadius='10px';
          fimg.style.display='none';
          fimg.style.left='';
          fimg.style.top='';
          setBrandImageNow(fimg, logoUrl);
        }
        
        // Keep desktop/tablet logo pinned at the top-center.
        var positionLogo = function(){
          try{
            if(!fixed.parentElement || fixed.parentElement !== document.body){
              document.body.appendChild(fixed);
            }
            fixed.style.position = 'fixed';
            fixed.style.left = '50%';
            fixed.style.top = 'calc(env(safe-area-inset-top, 0px) + 14px)';
            fixed.style.transform = 'translateX(-50%)';
            fixed.style.display = 'inline-flex';
            fixed.style.margin = '0';
            fixed.style.textAlign = 'center';
            fixed.style.zIndex = '1000';
          }catch(_){
            // Fallback: append to body
            document.body.appendChild(fixed);
          }
        };
        
        // Wait for DOM to be fully ready before positioning
        setTimeout(positionLogo, 100);

        // Desktop sizing — responsive width up to 300px
        var sizeDesktop = function(){
          try{
            if(!fimg) return;
            var vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
            var calculatedWidth = Math.round(vw * 0.30);
            var w = Math.min(Math.max(calculatedWidth, 120), 300);
            fimg.style.width = w + 'px';
            fimg.style.height = 'auto';
            fimg.style.left = '';
            fimg.style.top = '';
          }catch(_){ }
        };
        sizeDesktop();
        window.addEventListener('resize', sizeDesktop);
      }

      window.addEventListener('storage', function(event){
        if (event && event.key && event.key !== 'toaster_dashboard_home_mode') return;
        refreshDashboardHomeLinks();
      });
      window.addEventListener('toaster:dashboard-home-changed', function(){
        refreshDashboardHomeLinks();
      });
    }catch(e){ /* no-op */ }
  });
})();
