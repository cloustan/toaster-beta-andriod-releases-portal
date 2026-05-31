// This script runs on every page to ensure theme and layout consistency.
const DEFAULT_ACCENT = '#0055ff';
const LEGACY_BRAND_BLUE = '#0055ff';
const EXPERIMENTAL_FLAGS_KEY = 'toaster_flags';
const LEGACY_ELASTIC_FX_KEY = 'toaster_fx_elastic_y';
const ELASTIC_FX_STYLE_ID = 'toaster-elastic-fx-style';
const ELASTIC_FX_ATTR = 'data-fx';
const ELASTIC_FX_VALUE = 'elastic-y';
const HAPTICS_SCRIPT_SRC = 'haptics.js';

// Solid page background only when data-app-bg-solid is set; otherwise body uses .bg-* classes.
// When solid colour is active, paint html too so edges, safe-area, and overscroll don't show the grey frame.
/* themeGradientDark: accent → deep. themeGradientLight: soft accent tint → mid → bold accent (no pure white — better contrast) */
const VOICE_PAGE_GRADIENT_DARK =
    'linear-gradient(180deg,rgb(var(--accent-rgb, 0, 85, 255)) 0%,rgb(var(--accent-rgb-deep, 0, 41, 122)) 100%)';
const VOICE_PAGE_GRADIENT_LIGHT =
    'linear-gradient(180deg,rgb(var(--accent-rgb-wash, 122, 171, 255)) 0%,rgb(var(--accent-rgb-mid, 51, 119, 255)) 46%,rgb(var(--accent-rgb, 0, 85, 255)) 100%)';

const GLOBAL_BG_CSS =
    '*{-webkit-tap-highlight-color:transparent;}' +
    'html{min-height:100dvh;min-height:-webkit-fill-available;overscroll-behavior:none;background:var(--app-frame-bg, #0055ff) !important;}' +
    'body{margin:0;min-height:100dvh;min-height:-webkit-fill-available;overscroll-behavior:none;background:var(--app-bg, #0055ff) !important;}' +
    'body[data-app-bg-solid="1"]{background:var(--app-bg) !important;}';

const ELASTIC_FX_CSS =
    '@view-transition{navigation:auto;}' +
    '::view-transition-group(root){background:#050505;}' +
    'html[data-fx="elastic-y"]::view-transition-old(root){animation:140ms ease-out both move-out-top;}' +
    'html[data-fx="elastic-y"]::view-transition-new(root){animation:180ms cubic-bezier(0.2, 0.8, 0.2, 1.05) both move-in-bottom;}' +
    '@keyframes move-out-top{to{transform:translateY(-8%);opacity:1;}}' +
    '@keyframes move-in-bottom{from{transform:translateY(8%);opacity:1;}}' +
    '@media (prefers-reduced-motion: reduce){' +
    'html[data-fx="elastic-y"]::view-transition-old(root),' +
    'html[data-fx="elastic-y"]::view-transition-new(root){animation:none !important;}' +
    '}';

function ensureGlobalBgStyle() {
    let tag = document.getElementById('global-bg-var');
    if (!tag) {
        tag = document.createElement('style');
        tag.id = 'global-bg-var';
        document.head.appendChild(tag);
    }
    tag.textContent = GLOBAL_BG_CSS;
}

function parseBooleanFlag(value) {
    const normalized = String(value || '').toLowerCase().trim();
    if (normalized === '1' || normalized === 'true' || normalized === 'on') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'off') return false;
    return null;
}

function readExperimentalFlags() {
    try {
        const parsed = JSON.parse(localStorage.getItem(EXPERIMENTAL_FLAGS_KEY) || '{}');
        if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {}
    return {};
}

function isElasticFxEnabled() {
    const flags = readExperimentalFlags();
    if (Object.prototype.hasOwnProperty.call(flags, 'elasticViewTransitionY')) {
        return !!flags.elasticViewTransitionY;
    }
    try {
        const legacy = parseBooleanFlag(localStorage.getItem(LEGACY_ELASTIC_FX_KEY));
        return legacy === null ? true : legacy;
    } catch (_) {
        return true;
    }
}

function ensureElasticFxStyle(enabled) {
    let tag = document.getElementById(ELASTIC_FX_STYLE_ID);
    if (!enabled) {
        if (tag) tag.remove();
        return;
    }
    if (!tag) {
        tag = document.createElement('style');
        tag.id = ELASTIC_FX_STYLE_ID;
        document.head.appendChild(tag);
    }
    tag.textContent = ELASTIC_FX_CSS;
}

function applyExperimentalFeatureFlags() {
    const enabled = isElasticFxEnabled();
    try {
        window.toasterFeatureFlags = window.toasterFeatureFlags || {};
        window.toasterFeatureFlags.elasticViewTransitionY = enabled;
    } catch (_) {}
    ensureElasticFxStyle(enabled);
    if (enabled) document.documentElement.setAttribute(ELASTIC_FX_ATTR, ELASTIC_FX_VALUE);
    else document.documentElement.removeAttribute(ELASTIC_FX_ATTR);
}

function ensureHapticsScriptLoaded() {
    try {
        if (window.toasterHaptics) return;
        if (document.querySelector('script[data-toaster-haptics="1"]')) return;
        const script = document.createElement('script');
        script.src = HAPTICS_SCRIPT_SRC;
        script.async = true;
        script.dataset.toasterHaptics = '1';
        document.head.appendChild(script);
    } catch (_) {}
}

function bindPageTransitionHaptics() {
    try {
        if (document.documentElement.dataset.pageTransitionHapticsBound === '1') return;
        document.documentElement.dataset.pageTransitionHapticsBound = '1';
        document.addEventListener(
            'click',
            (event) => {
                try {
                    if (!isElasticFxEnabled()) return;
                    const target = event.target;
                    if (!target || !target.closest) return;
                    const link = target.closest('a[href]');
                    if (!link || link.hasAttribute('download')) return;
                    if (link.target && link.target !== '_self') return;
                    const href = String(link.getAttribute('href') || '').trim();
                    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
                    const resolved = new URL(link.href, window.location.href);
                    if (resolved.origin !== window.location.origin) return;
                    if (
                        resolved.pathname === window.location.pathname &&
                        resolved.search === window.location.search &&
                        resolved.hash === window.location.hash
                    ) {
                        return;
                    }
                    window.toasterHaptics?.trigger?.('page-transition');
                } catch (_) {}
            },
            true
        );
    } catch (_) {}
}

function whenBodyReady(callback) {
    if (document.body) {
        callback();
        return;
    }

    document.addEventListener(
        'DOMContentLoaded',
        () => {
            if (document.body) {
                callback();
            }
        },
        { once: true }
    );
}

/** RGB triplets "r, g, b" for rgba(var(--accent-rgb), a) and themed gradients. */
function accentRgbDerivatives(hex) {
    let h = String(hex || '').trim();
    if (/^#([\da-f]{3})$/i.test(h)) {
        const x = h.slice(1);
        h = '#' + [...x].map((c) => c + c).join('');
    }
    const m = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h);
    let r = 0,
        g = 85,
        b = 255;
    if (m) {
        r = parseInt(m[1], 16);
        g = parseInt(m[2], 16);
        b = parseInt(m[3], 16);
    }
    const mixToward = (tr, tg, tb, t) => [
        Math.round(r + (tr - r) * t),
        Math.round(g + (tg - g) * t),
        Math.round(b + (tb - b) * t),
    ];
    const fmt = (arr) => `${arr[0]}, ${arr[1]}, ${arr[2]}`;
    /* Stronger mixes = bolder full-page gradients (less washed-out white). */
    return {
        rgb: fmt([r, g, b]),
        deep: fmt(mixToward(0, 0, 0, 0.52)),
        pale: fmt(mixToward(255, 255, 255, 0.62)),
        wash: fmt(mixToward(255, 255, 255, 0.48)),
        mid: fmt(mixToward(255, 255, 255, 0.2)),
        light: fmt(mixToward(255, 255, 255, 0.38)),
    };
}

function applyAccentGradientVars(root, accentHex) {
    const d = accentRgbDerivatives(accentHex);
    root.style.setProperty('--accent-rgb', d.rgb);
    root.style.setProperty('--accent-rgb-deep', d.deep);
    root.style.setProperty('--accent-rgb-pale', d.pale);
    root.style.setProperty('--accent-rgb-wash', d.wash);
    root.style.setProperty('--accent-rgb-mid', d.mid);
    root.style.setProperty('--accent-rgb-light', d.light);
}

function accentToVividBackground(hex, themeMode) {
    const m = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
    let r = 0,
        g = 85,
        b = 255;
    if (m) {
        r = parseInt(m[1], 16);
        g = parseInt(m[2], 16);
        b = parseInt(m[3], 16);
    }
    const rn = r / 255,
        gn = g / 255,
        bn = b / 255;
    const max = Math.max(rn, gn, bn),
        min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === rn) {
            h = ((gn - bn) / d) % 6;
        } else if (max === gn) {
            h = (bn - rn) / d + 2;
        } else {
            h = (rn - gn) / d + 4;
        }
        h = Math.round((h * 60 + 360) % 360);
    }
    const l = themeMode === 'light' ? 0.5 : 0.28;
    function hsl2rgb(hh, ss, ll) {
        const c = (1 - Math.abs(2 * ll - 1)) * ss,
            x = c * (1 - Math.abs(((hh / 60) % 2) - 1)),
            m0 = ll - c / 2;
        let rr = 0,
            gg = 0,
            bb = 0;
        if (hh < 60) {
            rr = c;
            gg = x;
        } else if (hh < 120) {
            rr = x;
            gg = c;
        } else if (hh < 180) {
            gg = c;
            bb = x;
        } else if (hh < 240) {
            gg = x;
            bb = c;
        } else if (hh < 300) {
            rr = x;
            bb = c;
        } else {
            rr = c;
            bb = x;
        }
        rr = Math.round((rr + m0) * 255);
        gg = Math.round((gg + m0) * 255);
        bb = Math.round((bb + m0) * 255);
        return `#${rr.toString(16).padStart(2, '0')}${gg.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`;
    }
    return hsl2rgb(h, 1, l);
}

function syncSystemThemeColor(color) {
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', color);
    const appleStatus = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (appleStatus && color.toLowerCase() === LEGACY_BRAND_BLUE) {
        appleStatus.setAttribute('content', 'black-translucent');
    } else if (appleStatus) {
        appleStatus.setAttribute('content', 'default');
    }
}

function getFrameFallbackColor(themeMode, accentColor) {
    // Keep frame fallback on accent for both light/dark to avoid white/black flashes
    // during page-to-page navigation handoff in WebView.
    return accentColor || DEFAULT_ACCENT;
}

function applySolidBgOverride(hex) {
    if (!document.body) return;
    ensureGlobalBgStyle();
    document.documentElement.style.setProperty('--app-bg', hex);
    document.body.setAttribute('data-app-bg-solid', '1');
    syncSystemThemeColor(hex);
}

function removeSolidBgOverride() {
    if (!document.body) return;
    document.documentElement.style.removeProperty('--app-bg');
    document.body.removeAttribute('data-app-bg-solid');
    const themeMode = localStorage.getItem('themeMode') || 'dark';
    const accentColor = localStorage.getItem('accentColor') || DEFAULT_ACCENT;
    const frame = getFrameFallbackColor(themeMode, accentColor);
    syncSystemThemeColor(frame);
}

// Bootstrap the global bg variable ASAP so navigation reflects stored color immediately
(function () {
    try {
        const viewportMeta = document.querySelector('meta[name="viewport"]');
        if (viewportMeta) {
            const content = String(viewportMeta.getAttribute('content') || '').trim();
            if (content && !/viewport-fit\s*=\s*cover/i.test(content)) {
                viewportMeta.setAttribute('content', `${content}, viewport-fit=cover`);
            }
        }
        ensureGlobalBgStyle();
        const accentColor = localStorage.getItem('accentColor') || DEFAULT_ACCENT;
        applyAccentGradientVars(document.documentElement, accentColor);
        let s = localStorage.getItem('backgroundStyle');
        if (!s || s === 'default') {
            s = 'themeGradientLight';
            localStorage.setItem('backgroundStyle', s);
        }
        if (s === 'themeGradient') {
            s = 'themeGradientDark';
            localStorage.setItem('backgroundStyle', 'themeGradientDark');
        }
        const c = localStorage.getItem('bgColor');
        const themeMode = localStorage.getItem('themeMode') || 'dark';
        document.documentElement.style.setProperty(
            '--app-frame-bg',
            getFrameFallbackColor(themeMode, accentColor)
        );
        if (document.body && s === 'color' && c) {
            document.documentElement.style.setProperty('--app-bg', c);
            document.body.setAttribute('data-app-bg-solid', '1');
        }
        ensureHapticsScriptLoaded();
        bindPageTransitionHaptics();
        applyExperimentalFeatureFlags();
    } catch (_) {}
})();

function applyGlobalSettings() {
    if (!document.body) {
        whenBodyReady(applyGlobalSettings);
        return;
    }

    try {
        ensureGlobalBgStyle();
    } catch (_) {}
    applyExperimentalFeatureFlags();

    const layoutStyle = localStorage.getItem('layoutStyle') || 'floating';
    const fontSize = localStorage.getItem('fontSize') || '10';
    const reduceMotion = localStorage.getItem('reduceMotion') === 'true';
    const highContrast = localStorage.getItem('highContrast') === 'true';
    const glassEffect = localStorage.getItem('glassEffect') === 'true';

    document.body.className = document.body.className.replace(/layout-(docked|floating)/g, '').trim();
    document.body.classList.add(`layout-${layoutStyle}`);

    let backgroundStyle = localStorage.getItem('backgroundStyle') || 'themeGradientLight';
    if (backgroundStyle === 'default') {
        backgroundStyle = 'themeGradientLight';
        localStorage.setItem('backgroundStyle', backgroundStyle);
    }
    if (backgroundStyle === 'themeGradient') {
        backgroundStyle = 'themeGradientDark';
        localStorage.setItem('backgroundStyle', 'themeGradientDark');
    }
    document.body.className = document.body.className.replace(
        /bg-(default|gradient1|gradient2|gradient3|particles|minimal|custom|color|themeGradient(?:Dark|Light)?)/g,
        ''
    ).trim();
    document.body.classList.add(`bg-${backgroundStyle}`);

    if (backgroundStyle === 'custom') {
        applyCustomBackgroundGlobal();
    } else {
        document.body.style.backgroundImage = '';
        const overlay = document.querySelector('.custom-bg-overlay');
        if (overlay) overlay.remove();
    }

    const accentColor = localStorage.getItem('accentColor') || DEFAULT_ACCENT;
    const scrambleColor = localStorage.getItem('scrambleColor') || '#facc15';
    const themeMode = localStorage.getItem('themeMode') || 'dark';
    document.documentElement.style.setProperty('--app-frame-bg', getFrameFallbackColor(themeMode, accentColor));

    const root = document.documentElement;
    root.style.setProperty('--accent-color', accentColor);
    applyAccentGradientVars(root, accentColor);
    root.style.setProperty('--scramble-color', scrambleColor);
    root.style.setProperty('--timer-font-size', fontSize + 'rem');

    document.body.classList.toggle('light-mode', themeMode === 'light');
    document.body.classList.toggle('reduce-motion', reduceMotion);
    document.body.classList.toggle('high-contrast', highContrast);
    document.body.classList.toggle('app-glass-mode', glassEffect);
    document.body.setAttribute('data-glass', glassEffect ? 'on' : 'off');

    const isTimer = !!(
        document.getElementById('main-timer-area') ||
        /(?:^|\/)index\.html(?:$|#|\?)/.test(location.pathname)
    );

    if (backgroundStyle === 'custom') {
        if (isTimer) {
            applyCustomBackgroundGlobal();
            removeSolidBgOverride();
            syncSystemThemeColor(accentColor);
        } else {
            document.body.style.backgroundImage = '';
            const overlay = document.querySelector('.custom-bg-overlay');
            if (overlay) overlay.remove();
            const chosen = localStorage.getItem('bgColor');
            if (chosen) {
                applySolidBgOverride(chosen);
            } else {
                try {
                    const vivid = accentToVividBackground(accentColor, themeMode);
                    applySolidBgOverride(vivid);
                } catch (_) {}
            }
        }
    } else if (backgroundStyle === 'color') {
        const chosen = localStorage.getItem('bgColor') || accentColor;
        applySolidBgOverride(chosen);
    } else {
        removeSolidBgOverride();
        syncSystemThemeColor(accentColor);
    }

    applySeededBackground();
}

function applyCustomBackgroundGlobal() {
    if (!document.body) return;
    const imageData = localStorage.getItem('customBackgroundImage');
    const opacity = localStorage.getItem('customBackgroundOpacity') || '0.3';

    if (imageData) {
        document.body.style.backgroundImage = `url(${imageData})`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
        document.body.style.backgroundAttachment = 'fixed';

        const overlay = document.querySelector('.custom-bg-overlay') || document.createElement('div');
        overlay.className = 'custom-bg-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, ${1 - opacity});
            pointer-events: none;
            z-index: -1;
        `;
        if (!document.querySelector('.custom-bg-overlay')) {
            document.body.appendChild(overlay);
        }
    }
}

whenBodyReady(applyGlobalSettings);

window.addEventListener('storage', (event) => {
    const refreshKeys = new Set([
        'accentColor',
        'scrambleColor',
        'themeMode',
        'glassEffect',
        'fontSize',
        'reduceMotion',
        'highContrast',
        'layoutStyle',
        'backgroundStyle',
        'bgColor',
        'customBackgroundImage',
        'customBackgroundOpacity',
    ]);

    if (refreshKeys.has(event.key)) {
        applyGlobalSettings();
    }
    if (event.key === EXPERIMENTAL_FLAGS_KEY || event.key === LEGACY_ELASTIC_FX_KEY) {
        applyExperimentalFeatureFlags();
    }
});

function hslToRgba(h, s, l, a) {
    s = Math.max(0, Math.min(1, s));
    l = Math.max(0, Math.min(1, l));
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = (h % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0,
        g = 0,
        b = 0;
    if (0 <= hp && hp < 1) {
        r = c;
        g = x;
    } else if (1 <= hp && hp < 2) {
        r = x;
        g = c;
    } else if (2 <= hp && hp < 3) {
        g = c;
        b = x;
    } else if (3 <= hp && hp < 4) {
        g = x;
        b = c;
    } else if (4 <= hp && hp < 5) {
        r = x;
        b = c;
    } else if (5 <= hp && hp < 6) {
        r = c;
        b = x;
    }
    const m = l - c / 2;
    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function applySeededBackground() {
    const canvas = document.querySelector('.bg-canvas');
    if (!canvas) return;

    const seed = (localStorage.getItem('bgSeed') || '3x3').toLowerCase();
    const hueMap = {
        '2x2': 210,
        '3x3': 255,
        '4x4': 220,
        '5x5': 200,
        '6x6': 195,
        '7x7': 190,
        pyraminx: 160,
        skewb: 280,
        megaminx: 300,
        'square-1': 20,
        clock: 45,
    };
    const base = hueMap[seed] ?? 240;
    const c1 = hslToRgba(base, 0.9, 0.6, 0.18);
    const c2 = hslToRgba((base + 40) % 360, 0.9, 0.55, 0.16);
    const c3 = hslToRgba((base + 80) % 360, 0.9, 0.5, 0.14);
    canvas.style.background =
        `radial-gradient(1200px 800px at 20% 10%, ${c1}, transparent 50%),` +
        `radial-gradient(1000px 700px at 80% 20%, ${c2}, transparent 55%),` +
        `radial-gradient(900px 700px at 50% 90%, ${c3}, transparent 55%),` +
        `linear-gradient(180deg, #0b1220 0%, #0a1020 100%)`;
}
