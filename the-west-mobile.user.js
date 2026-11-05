// ==UserScript==
// @name         The West Mobile - Nox (experimental)
// @namespace    https://the-west.net/
// @version      1.2.0
// @description  Ventanas adaptables, X grande, misiones, mapa ampliado y alternancia abrir/cerrar Mapa y Personaje.
// @author       Nox + Lautta
// @include      https://*.the-west.*/game.php*
// @include      http://*.the-west.*/game.php*
// @homepageURL  https://github.com/Lautta17/the-west-mobile
// @supportURL   https://github.com/Lautta17/the-west-mobile/issues
// @updateURL    https://raw.githubusercontent.com/Lautta17/the-west-mobile/main/the-west-mobile.user.js
// @downloadURL  https://raw.githubusercontent.com/Lautta17/the-west-mobile/main/the-west-mobile.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // Nunca modifica datos del juego, llama APIs del servidor ni automatiza acciones.
  // Cada atajo ejecuta, como máximo, un clic por interacción explícita del jugador.
  if (window.top !== window.self || document.getElementById('twmm-root')) return;
  if (!/\bAndroid\b|\biPhone\b|\biPad\b/i.test(navigator.userAgent) &&
      !window.matchMedia('(pointer: coarse)').matches) return;

  const STORAGE_KEY = 'twmm.settings.v01';
  const ITEMS = [
    { key: 'mapa', label: 'Mapa', icon: '🗺️' },
    { key: 'misiones', label: 'Misiones', icon: '📜' },
    { key: 'mochila', label: 'Inventario', icon: '🎒' },
    { key: 'personaje', label: 'Personaje', icon: '🤠' },
    { key: 'ciudad', label: 'Ciudad', icon: '🏘️' },
  ];
  const defaults = { enabled: true, compact: true, blockMapAutoFocus: true, largePanels: true, nativeScale: 125, autoWindows: true, autoMax: 160, nativeClose: true, questScale: 125, railExpanded: false, shortcuts: {} };
  let config = readSettings();
  let binding = null;
  let settingsOpen = false;
  let noticeTimer;
  let updateQueued = false;
  let lastTap = null;
  let viewportQueued = false;
  let minimapGuardUntil = 0;
  let explicitInput = null;
  let explicitInputUntil = 0;
  let stoppedAutoFocus = 0;
  let layoutQueued = false;
  let railManualOverride = null;
  let nativeQueued = false;
  const nativeWindowState = new Map();
  let nativeLayoutStatus = 'ninguna';
  let questQueued = false;
  const questWindowState = new Map();
  // No guardamos un simple booleano de "abierto": las ventanas pueden cerrarse
  // desde el juego o sustituirse por nuevas instancias durante la partida.
  const shortcutDialogs = new Map();
  let shortcutOpenGeneration = 0;
  let questLayoutStatus = 'sin detectar';

  function readSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        enabled: typeof saved.enabled === 'boolean' ? saved.enabled : defaults.enabled,
        compact: typeof saved.compact === 'boolean' ? saved.compact : defaults.compact,
        largePanels: typeof saved.largePanels === 'boolean' ? saved.largePanels : defaults.largePanels,
        nativeScale: [100, 115, 125, 135].includes(saved.nativeScale) ? saved.nativeScale : defaults.nativeScale,
        autoWindows: typeof saved.autoWindows === 'boolean' ? saved.autoWindows : defaults.autoWindows,
        autoMax: [125, 145, 160, 180].includes(saved.autoMax) ? saved.autoMax : defaults.autoMax,
        nativeClose: typeof saved.nativeClose === 'boolean' ? saved.nativeClose : defaults.nativeClose,
        questScale: [100, 115, 125, 140].includes(saved.questScale) ? saved.questScale : defaults.questScale,
        railExpanded: typeof saved.railExpanded === 'boolean' ? saved.railExpanded : defaults.railExpanded,
        blockMapAutoFocus: typeof saved.blockMapAutoFocus === 'boolean'
          ? saved.blockMapAutoFocus : defaults.blockMapAutoFocus,
        // Compatibilidad con v0.4-v0.7: ambos botones abrían la pareja de ventanas.
        // Conservamos Inventario; si sólo estaba enlazado Equipo, reutilizamos su enlace.
        shortcuts: (() => {
          const shortcuts = saved.shortcuts && typeof saved.shortcuts === 'object' && !Array.isArray(saved.shortcuts)
            ? { ...saved.shortcuts } : {};
          if (!shortcuts.mochila && shortcuts.equipo) shortcuts.mochila = shortcuts.equipo;
          delete shortcuts.equipo;
          return shortcuts;
        })()
      };
    } catch (_) {
      return { ...defaults, shortcuts: {} };
    }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch (_) { /* modo privado */ }
  }
  function escapeCss(text) {
    return window.CSS && typeof CSS.escape === 'function'
      ? CSS.escape(text)
      : String(text).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  // El juego se diseñó para escritorio. Forzamos un viewport real sólo en el móvil.
  let viewport = document.querySelector('meta[name="viewport"]');
  if (!viewport) {
    viewport = document.createElement('meta');
    viewport.name = 'viewport';
    document.head.appendChild(viewport);
  }
  viewport.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');

  const style = document.createElement('style');
  style.id = 'twmm-style';
  style.textContent = `
    /* La barra lateral no consume espacio inferior del mapa. */
    /* Zoom local: afecta al contenido de ventanas, NO a toda la página ni al mapa. */
    html.twmm-large .tw2gui_inner_window.twmm-enlarge {
      zoom: 1.2 !important;
      max-width: calc((100vw - 12px) / 1.2) !important;
      max-height: calc((100dvh - 105px) / 1.2) !important;
      overflow: auto !important;
    }
    html.twmm-large .tw2gui_inner_window.twmm-enlarge button,
    html.twmm-large .tw2gui_inner_window.twmm-enlarge [role="button"] { min-height: 34px; }

    /* Ajustes visuales al juego original. No se modifican clics ni drag & drop.
       La X agrandada se inserta sólo donde existe una X nativa reconocible. */
    .tw2gui_window.twmm-native-window { transform-origin: center center !important; }
    html.twmm-on .tw2gui_window .twmm-native-close {
      display: block !important; position: absolute !important; top: 0 !important;
      right: 0 !important; width: 38px !important; height: 38px !important;
      min-width: 38px !important; min-height: 38px !important; z-index: 1000 !important;
      box-sizing: border-box !important; background: #4d311e !important;
      color: #fff0d3 !important; border: 2px solid #e0b477 !important;
      border-radius: 7px !important; font: bold 28px/28px system-ui,sans-serif !important;
      text-align: center !important; padding: 0 !important;
      box-shadow: 0 2px 7px #0009 !important; touch-action: manipulation !important;
      cursor: pointer !important;
    }
    /* Seguimiento de misiones: ampliar también el área de toque de brújulas,
       sin cambiar ni interceptar la acción real del juego. */
    html.twmm-on .twmm-quest-boost .quest_mmaplink,
    html.twmm-on .twmm-quest-boost [onclick*="clickQuicklink"],
    html.twmm-on .twmm-quest-boost [onclick*="Map.center"] {
      display: inline-flex !important; align-items: center !important;
      justify-content: center !important; min-width: 28px !important;
      min-height: 28px !important; vertical-align: middle !important;
      cursor: pointer !important;
    }
    html.twmm-on .twmm-quest-boost .quest_mmaplink img[src*="compass"],
    html.twmm-on .twmm-quest-boost [onclick*="clickQuicklink"] img[src*="compass"] {
      width: 22px !important; height: 22px !important;
      object-fit: contain !important;
    }
    html.twmm-on .twmm-quest-boost { transform-origin: top right !important; }
    html.twmm-compact .tw2gui_inner_window {
      max-width: calc(100vw - 12px) !important;
      max-height: calc(100dvh - 104px) !important;
      overflow-x: auto !important;
      box-sizing: border-box !important;
    }
    html.twmm-compact .tw2gui_inner_window_title {
      min-height: 30px;
      touch-action: none;
    }
    html.twmm-on .tw2gui_inner_window button,
    html.twmm-on .tw2gui_inner_window input[type="button"] {
      min-height: 32px;
    }
  `;
  document.head.appendChild(style);

  const host = document.createElement('div');
  host.id = 'twmm-root';
  // Directamente bajo <html> para evitar contenedores transformados por el juego.
  host.style.cssText = 'position:fixed!important;top:0!important;left:0!important;' +
    'right:auto!important;bottom:auto!important;margin:0!important;padding:0!important;' +
    'pointer-events:none!important;z-index:2147483000!important;' +
    'transform-origin:top left!important;overflow:visible!important;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { font-family: system-ui, sans-serif; color: #f8eee0; }
      *, *::before, *::after { box-sizing: border-box; }
      button { font: inherit; cursor: pointer; }
      /* Rail plegable: ocupa sólo una lengüeta cuando no se usa.
         Se posiciona en el borde derecho del viewport visible, no del mapa. */
      .dock {
        position:absolute; right:4px; top:50%; transform:translateY(-50%);
        width:62px; display:flex; flex-direction:column; gap:3px;
        padding:5px; background:linear-gradient(180deg,#473522f5,#211a14fa);
        border:1px solid #ba8850; border-radius:13px;
        box-shadow:-3px 3px 16px #0009; pointer-events:auto;
        max-height:calc(100% - 24px); overflow-y:auto; scrollbar-width:none;
      }
      .dock::-webkit-scrollbar { display:none; }
      .dock button { width:100%; min-width:0; min-height:48px; flex:none;
        color:#f8e7c9; border:1px solid #74583b;
        background:#433324; border-radius:9px; padding:4px 1px;
        font-size:9px; display:flex; flex-direction:column;
        align-items:center; justify-content:center; gap:1px;
      }
      .rail-tab {
        position:absolute; right:0; top:50%; transform:translateY(-50%);
        min-width:31px; width:32px; height:64px;
        border:1px solid #ba8850; border-radius:12px 0 0 12px;
        background:#362718f5; color:#ffe2ac; font-size:19px;
        pointer-events:auto; box-shadow:-2px 2px 10px #0008;
      }
      .dock button:active { background:#8d6034; }
      .dock button span:last-child { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .dock .emoji { font-size:19px; line-height:22px; }
      .dock .gear { font-size:21px; }
      .bubble { position:absolute; bottom:calc(12px + env(safe-area-inset-bottom));right:12px;
        width:56px;height:56px;border-radius:50%;border:2px solid #ba8850;
        background:#312519;color:#fbe5c6;font-size:26px;box-shadow:0 3px 12px #000b;
        pointer-events:auto; }
      .settings { position:absolute; left:50%; transform:translateX(-50%); width:min(calc(100% - 16px),520px); bottom:calc(12px + env(safe-area-inset-bottom));
        max-height:min(67%, 510px); overflow:auto; border:2px solid #c39255; border-radius:14px;
        background:#261c16f9; color:#f9e9d5; box-shadow:0 4px 25px #000b;
        padding:14px; pointer-events:auto; font-size:13px; }
      .settings h2 { margin:0 0 4px;font-size:17px;color:#ffd39a; }
      .settings p { margin:6px 0 12px;line-height:1.4;color:#d9c6b0; }
      .settings .line { display:flex;gap:8px;align-items:center;justify-content:space-between;
        margin:9px 0;min-height:38px; }
      .settings .line span { flex:1; }
      .settings button { padding:9px 11px;border:1px solid #b98a59;border-radius:8px;
        background:#58402b;color:#fff2dc;min-height:38px; }
      .settings button:active { background:#8d6034; }
      .settings button.linking { background:#a36619; }
      .settings .muted { color:#c8b6a0;font-size:11px; }
      .settings .actions { display:flex;flex-wrap:wrap;gap:8px;margin-top:14px; }
      .settings pre {white-space:pre-wrap; overflow-wrap:anywhere;font:11px ui-monospace,monospace;
        background:#110e0b;padding:10px;border-radius:8px;max-height:160px;overflow:auto;}
      /* Vinculación: aviso bajo la parte superior del mapa, lejos de controles inferiores.
         El fondo no captura toques y sólo el botón X es interactivo. */
      .bind-hint { position:absolute; top:90px;
        left:50%; transform:translateX(-50%); max-width:calc(100% - 12px);
        display:flex;align-items:center;gap:7px;padding:4px 5px 4px 10px;
        border:1px solid #b98a59;border-radius:999px;
        background:#251c16ef;color:#fff1d6;box-shadow:0 2px 9px #0007;
        font:11px/1.2 system-ui,sans-serif;pointer-events:none; }
      .bind-hint .bind-label { min-width:0;overflow:hidden;text-overflow:ellipsis;
        white-space:nowrap; }
      .bind-hint .bind-cancel { width:32px;height:32px;flex:none;
        padding:0;border:1px solid #9b7950;border-radius:50%;background:#513927;
        color:#fff1d6;font-size:19px;line-height:1;pointer-events:auto; }
      .bind-hint .bind-cancel:active { background:#936330; }
      .toast { position:absolute; top:max(12px, env(safe-area-inset-top));left:10px;right:10px;
        background:#2a2119f8;border:1px solid #d6a36b;border-radius:10px;
        padding:12px 14px;color:#fff2d9;text-align:center;box-shadow:0 2px 16px #0009;
        font:13px/1.4 system-ui,sans-serif;pointer-events:none; }
      .hidden { display:none !important; }

    </style>
    <button type="button" class="rail-tab" data-action="toggle-rail" aria-label="Mostrar accesos">☰</button>
    <nav class="dock" aria-label="The West Mobile">
      ${ITEMS.map(i => `<button type="button" data-action="open" data-key="${i.key}" aria-label="${i.label}"><span class="emoji">${i.icon}</span><span>${i.label}</span></button>`).join('')}
      <button type="button" data-action="settings" aria-label="Ajustes"><span class="gear">⚙️</span></button>
      <button type="button" data-action="toggle-rail" aria-label="Plegar menú"><span class="gear">❯</span></button>
    </nav>
    <button type="button" class="bubble hidden" data-action="enable" aria-label="Activar barra móvil">🤠</button>
    <section class="settings hidden" aria-label="Ajustes de The West Mobile">
      <h2>🤠 The West Mobile · v1.2</h2>
      <p>Para crear un acceso, tocá «Vincular» y luego el botón <b>original</b> del juego correspondiente. Se guarda sólo el selector local, nunca datos de la cuenta.</p>
      <div class="links"></div>
      <div class="line"><span>Barra abierta al iniciar (siempre plegable con ❯)</span><button type="button" data-action="pinrail"></button></div>
      <div class="line"><span>Ventanas compactas (experimental)</span><button type="button" data-action="compact"></button></div>
      <div class="line"><span>Agrandar ventanas (experimental)</span><button type="button" data-action="large"></button></div>
      <div class="line"><span>Ajustar automáticamente las ventanas originales</span><button type="button" data-action="auto-windows"></button></div>
      <div class="line"><span>Ampliación máxima automática</span><button type="button" data-action="auto-max"></button></div>
      <div class="line"><span>Escala manual equipo/inventario (con Auto desactivado)</span><button type="button" data-action="native-scale"></button></div>
      <div class="line"><span>X grande para cerrar ventanas del juego</span><button type="button" data-action="native-close"></button></div>
      <div class="line"><span>Tamaño del seguimiento de misiones y brújulas</span><button type="button" data-action="quest-scale"></button></div>
      <div class="line"><span>Evitar teclado automático del minimapa</span><button type="button" data-action="blockfocus"></button></div>
      <div class="actions">
        <button type="button" data-action="diagnostic">Ver diagnóstico</button>
        <button type="button" data-action="clear">Borrar accesos</button>
        <button type="button" data-action="disable">Ocultar barra</button>
        <button type="button" data-action="close">Cerrar</button>
      </div>
      <pre class="diagnostic hidden"></pre>
      <p class="muted">Si algo se ve mal, desactivá «Ventanas compactas». Para restaurar completamente la página, desactivá el script en Violentmonkey y recargá.</p>
    </section>
    <div class="bind-hint hidden" aria-live="polite">
      <span class="bind-label"></span>
      <button type="button" class="bind-cancel" data-action="cancelbind" aria-label="Cancelar vinculación" title="Cancelar">×</button>
    </div>
    <div class="toast hidden" role="status" aria-live="polite"></div>
  `;
  const $ = (selector) => root.querySelector(selector);
  const linksEl = $('.links');
  const toastEl = $('.toast');
  const settingsEl = $('.settings');
  const bindHintEl = $('.bind-hint');

  function apply() {
    document.documentElement.classList.toggle('twmm-on', config.enabled);
    document.documentElement.classList.toggle('twmm-compact', config.enabled && config.compact);
    document.documentElement.classList.toggle('twmm-large', config.enabled && config.largePanels);
    const railOpen = railManualOverride === null ? config.railExpanded : railManualOverride;
    $('.dock').classList.toggle('hidden', !config.enabled || !!binding || (!railOpen && !settingsOpen));
    $('.rail-tab').classList.toggle('hidden', !config.enabled || !!binding || settingsOpen || railOpen);
    $('.bubble').classList.toggle('hidden', config.enabled);
    bindHintEl.classList.toggle('hidden', !config.enabled || !binding);
    if (binding) {
      const item = ITEMS.find(i => i.key === binding);
      $('.bind-label').textContent = `Vincular ${item ? item.label : 'acceso'}: tocá el original`;
    }
    settingsEl.classList.toggle('hidden', !settingsOpen || !config.enabled);
    $('[data-action="pinrail"]').textContent = config.railExpanded ? 'Sí' : 'No';
    $('[data-action="compact"]').textContent = config.compact ? 'Activado' : 'Desactivado';
    $('[data-action="large"]').textContent = config.largePanels ? 'Activado' : 'Desactivado';
    $('[data-action="native-scale"]').textContent = config.autoWindows ? 'Automático activo' : config.nativeScale + '%';
    $('[data-action="native-scale"]').disabled = config.autoWindows;
    $('[data-action="auto-windows"]').textContent = config.autoWindows ? 'Activado' : 'Desactivado';
    $('[data-action="auto-max"]').textContent = config.autoMax + '%';
    $('[data-action="native-close"]').textContent = config.nativeClose ? 'Activado' : 'Desactivado';
    $('[data-action="quest-scale"]').textContent = config.questScale + '%';

    $('[data-action="blockfocus"]').textContent = config.blockMapAutoFocus ? 'Activado' : 'Desactivado';
    linksEl.innerHTML = ITEMS.map(i => {
      const isLinked = !!config.shortcuts[i.key];
      return `<div class="line"><span>${i.icon} ${i.label} <small class="muted">(${isLinked ? 'vinculado' : 'sin vincular'})</small></span>
        <button type="button" data-action="bind" data-key="${i.key}" class="${binding === i.key ? 'linking' : ''}">${binding === i.key ? 'Esperando…' : 'Vincular'}</button></div>`;
    }).join('');
    if (config.enabled && (config.compact || config.largePanels)) scheduleCompact();
    scheduleViewport();
    scheduleNativeWindows();
    scheduleQuestWindows();
  }

  function toast(message, ms = 3100) {
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => toastEl.classList.add('hidden'), ms);
  }

  function candidateButton(target) {
    if (!(target instanceof Element)) return null;
    let node = target;
    for (let depth = 0; depth < 7 && node && node !== document.body; depth++, node = node.parentElement) {
      if (node.matches('button, a, [role="button"], .menulink, .ui_menucontainer, [onclick]')) {
        // Evitar enlazar <a> de navegación real que salga del juego.
        if (node.tagName === 'A') {
          const href = node.getAttribute('href') || '';
          if (/^(https?:|\/\/)/i.test(href)) return null;
        }
        return node;
      }
    }
    return target;
  }
  function selectorFor(element) {
    if (element.id && document.querySelectorAll('#' + escapeCss(element.id)).length === 1)
      return '#' + escapeCss(element.id);
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 12) {
      if (node.id && document.querySelectorAll('#' + escapeCss(node.id)).length === 1) {
        parts.unshift('#' + escapeCss(node.id));
        break;
      }
      let segment = node.localName;
      const parent = node.parentElement;
      if (!parent) break;
      const siblings = [...parent.children].filter(s => s.localName === node.localName);
      if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      parts.unshift(segment);
      node = parent;
    }
    return parts.join(' > ');
  }
  // visualViewport es el área visible REAL en Android tras pellizcar, mover la vista
  // o mostrar/ocultar barras del navegador. Los hijos del host son absolutos: así no
  // dependen del layout viewport ni cambian de tamaño aparente con el zoom.
  function placeOverlay() {
    viewportQueued = false;
    if (!host.isConnected) return;
    const vv = window.visualViewport;
    const scale = vv && Number.isFinite(vv.scale) && vv.scale > 0 ? vv.scale : 1;
    const ox = vv ? vv.offsetLeft : 0;
    const oy = vv ? vv.offsetTop : 0;
    const width = vv ? vv.width * scale : window.innerWidth;
    const height = vv ? vv.height * scale : window.innerHeight;
    host.style.setProperty('width', `${Math.max(1, width)}px`, 'important');
    host.style.setProperty('height', `${Math.max(1, height)}px`, 'important');
    host.style.setProperty('transform',
      `translate3d(${ox}px, ${oy}px, 0) scale(${1 / scale})`, 'important');
  }
  function scheduleViewport() {
    if (viewportQueued) return;
    viewportQueued = true;
    requestAnimationFrame(placeOverlay);
  }

  // La búsqueda dentro del minimapa suele recibir focus() al abrirse: Firefox
  // invoca el teclado y desplaza/amplía la página. Bloqueamos SOLO ese enfoque
  // no solicitado; tocar explícitamente un input continúa funcionando.
  const minimapSelector = '#ui_minimap, #minimap, .ui_minimap, .minimap,' +
    ' [id*="minimap" i], [class*="minimap" i], [data-action*="minimap" i]';
  function isKeyboardInput(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el instanceof HTMLTextAreaElement || el.isContentEditable) return true;
    if (!(el instanceof HTMLInputElement)) return false;
    return !/^(?:button|submit|reset|checkbox|radio|range|hidden|file|image|color)$/.test(el.type);
  }
  function isInMinimap(el) {
    return !!el.closest(minimapSelector);
  }
  function beginMapGuard() {
    explicitInput = null;
    explicitInputUntil = 0;
    minimapGuardUntil = performance.now() + 1600;
  }
  function shouldPreventFocus(el) {
    if (!config.enabled || !config.blockMapAutoFocus || !isKeyboardInput(el)) return false;
    if (el === explicitInput && performance.now() < explicitInputUntil) return false;
    return isInMinimap(el) || performance.now() < minimapGuardUntil;
  }
  // Funciona incluso cuando el juego llama focus() programáticamente antes
  // de despachar un evento focusin. Sin esto, el teclado puede parpadear.
  const realFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (...args) {
    if (shouldPreventFocus(this)) {
      stoppedAutoFocus++;
      return;
    }
    return realFocus.apply(this, args);
  };
  // Respaldo si el juego usa autofocus nativo o una ruta que no pase por focus().
  document.addEventListener('focusin', e => {
    if (shouldPreventFocus(e.target)) {
      stoppedAutoFocus++;
      e.target.blur();
    }
  }, true);
  document.addEventListener('pointerdown', e => {
    const target = e.target;
    if (!(target instanceof Element) || host.contains(target)) return;
    if (isKeyboardInput(target)) {
      explicitInput = target;
      explicitInputUntil = performance.now() + 1000;
    } else if (target.closest(minimapSelector)) {
      beginMapGuard();
    }
  }, { capture: true, passive: true });

  // Alternancia de los accesos Mapa y Personaje. El juego puede abrir ventanas
  // sincrónica o asincrónicamente. Identificamos la instancia REAL abierta,
  // y el segundo toque usa su cierre nativo (no ocultamos un div visualmente).
  const TOGGLE_SHORTCUTS = new Set(['mapa', 'personaje']);
  const CLOSE_SELECTOR = '.tw2gui_window_buttons_close, .tw2gui_inner_window_close';

  function nativeDialogClose(win) {
    if (!win || !win.isConnected) return null;
    return [...win.querySelectorAll(CLOSE_SELECTOR)]
      .find(el => el.closest('.tw2gui_window') === win) || null;
  }
  function isVisibleDialog(win) {
    if (!(win instanceof Element) || !win.isConnected ||
        !win.classList.contains('tw2gui_window') || !nativeDialogClose(win) ||
        !win.getClientRects().length) return false;
    const cs = getComputedStyle(win);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    // Puede haber un contenedor padre que se esconda sin eliminar la ventana.
    for (let el = win.parentElement; el && el !== document.body; el = el.parentElement) {
      const parentCss = getComputedStyle(el);
      if (parentCss.display === 'none' || parentCss.visibility === 'hidden') return false;
    }
    return true;
  }
  function visibleClosableDialogs() {
    return [...document.querySelectorAll('.tw2gui_window')].filter(isVisibleDialog);
  }
  function dialogMatchesShortcut(win, key) {
    const heading = [...win.querySelectorAll('.tw2gui_window_title, .tw2gui_inner_window_title')]
      .filter(el => el.closest('.tw2gui_window') === win)
      .slice(0, 5).map(el => el.textContent || '').join(' ').toLowerCase();
    const identity = `${win.id || ''} ${win.className || ''}`.toLowerCase();
    if (key === 'mapa') {
      return /\b(mapa|map|worldmap|world.map|karte|cartograph|cartograf)\b/i.test(heading) ||
        /(?:^|[_\s-])(map|mapa|worldmap|world_map)(?:$|[_\s-])/.test(identity);
    }
    if (key === 'personaje') {
      return /\b(personaje|character|perfil|profile|attribut|atributos|habilidades|skills)\b/i.test(heading) ||
        /(?:^|[_\s-])(character|personaje|profile|perfil|attributes)(?:$|[_\s-])/.test(identity);
    }
    return false;
  }
  function isMapDialog(win) {
    return dialogMatchesShortcut(win, 'mapa');
  }

  function trackedShortcutDialog(key) {
    const tracked = shortcutDialogs.get(key);
    if (tracked && isVisibleDialog(tracked)) return tracked;
    shortcutDialogs.delete(key);
    // Caso: ya estaba abierta antes de que el usuario tocara nuestro botón,
    // o el juego reemplazó el nodo DOM. Cerramos sólo con coincidencia inequívoca.
    const matches = visibleClosableDialogs().filter(win => dialogMatchesShortcut(win, key));
    if (matches.length === 1) {
      shortcutDialogs.set(key, matches[0]);
      return matches[0];
    }
    return null;
  }
  function rememberOpenedShortcut(key, before) {
    const generation = ++shortcutOpenGeneration;
    const sample = () => {
      if (generation !== shortcutOpenGeneration || !config.enabled) return;
      const now = visibleClosableDialogs();
      const added = now.filter(win => !before.has(win));
      const exact = added.filter(win => dialogMatchesShortcut(win, key));
      // Si se abrieron varias ventanas (p.ej. equipo + inventario), jamás
      // elegimos una al azar y arriesgamos cerrar la equivocada.
      const candidate = exact.length === 1 ? exact[0] : added.length === 1 ? added[0] : null;
      if (candidate) shortcutDialogs.set(key, candidate);
    };
    // Interfaz The West: algunas ventanas nacen en AJAX y otras instantáneamente.
    sample();
    setTimeout(sample, 120);
    setTimeout(sample, 420);
  }
  function openShortcut(key) {
    const item = ITEMS.find(i => i.key === key);
    const selector = config.shortcuts[key];
    if (!selector) {
      settingsOpen = true;
      apply();
      toast(`Primero vinculá «${item.label}» con su botón original.`);
      return;
    }
    let source;
    try { source = document.querySelector(selector); } catch (_) { /* selector obsoleto */ }
    if (!source || host.contains(source)) {
      settingsOpen = true;
      apply();
      toast(`El acceso «${item.label}» cambió. Volvé a vincularlo.`);
      return;
    }
    // Si la ventana sigue abierta, cerrar mediante su X original. No tocamos
    // la opción original de abrir ni otros diálogos que puedan estar activos.
    if (TOGGLE_SHORTCUTS.has(key)) {
      const current = trackedShortcutDialog(key);
      const close = current && nativeDialogClose(current);
      if (close) {
        ++shortcutOpenGeneration;  // invalida detecciones de aperturas pendientes
        shortcutDialogs.delete(key);
        close.click();
        if (!config.railExpanded) { railManualOverride = false; apply(); }
        scheduleNativeWindows();
        scheduleQuestWindows();
        return;
      }
    }
    const before = TOGGLE_SHORTCUTS.has(key) ? new Set(visibleClosableDialogs()) : null;
    if (key === 'mapa') beginMapGuard();
    source.click(); // Un solo clic nativo por toque explícito.
    if (before) rememberOpenedShortcut(key, before);
    if (!config.railExpanded) { railManualOverride = false; apply(); }
    if (config.compact) scheduleCompact();
  }
  function diagnostic() {
    const bounds = (document.querySelector('.tw2gui_inner_window') || {}).getBoundingClientRect?.();
    const text = [
      'The West Mobile v1.2 (sin información de cuenta)',
      'Host: ' + location.hostname,
      'Pantalla CSS: ' + innerWidth + 'x' + innerHeight,
      'VisualViewport: ' + (visualViewport ? [visualViewport.width, visualViewport.height, visualViewport.scale, visualViewport.offsetLeft, visualViewport.offsetTop].map(n => Number(n).toFixed(2)).join(' / ') : 'no disponible'),
      'Focos automáticos bloqueados: ' + stoppedAutoFocus,
      'screen.width: ' + screen.width,
      'pointer: ' + (matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine'),
      '#map: ' + !!document.querySelector('#map'),
      '#ui_menubar: ' + !!document.querySelector('#ui_menubar'),
      '#ui_minimap: ' + !!document.querySelector('#ui_minimap'),
      '.tw2gui_inner_window: ' + document.querySelectorAll('.tw2gui_inner_window').length,
      'Ventanas nativas detectadas: ' + nativeWindowState.size,
      'Ajuste automático: ' + config.autoWindows + ' (máx. ' + config.autoMax + '%)',
      'Mapa: si está solo, puede ampliarse por encima del límite general si entra en pantalla',
      'Escala manual nativa: ' + config.nativeScale + '%',
      'Distribución de ventanas: ' + nativeLayoutStatus,
      'Misiones: ' + questLayoutStatus + ' / pedido ' + config.questScale + '%',
      'Ventanas con X grande: ' + document.querySelectorAll('.twmm-native-close').length,
      'Primer ventana (px): ' + (bounds ? `${Math.round(bounds.width)}x${Math.round(bounds.height)}` : 'ninguna'),
      'Alternancia Mapa/Personaje: ' + [...TOGGLE_SHORTCUTS].map(key => `${key}=${trackedShortcutDialog(key) ? 'abierta' : 'no detectada'}`).join(', '),
      'Atajos: ' + ITEMS.map(i => `${i.key}=${config.shortcuts[i.key] ? 'sí' : 'no'}`).join(', '),
    ].join('\n');
    $('.diagnostic').textContent = text;
    $('.diagnostic').classList.remove('hidden');
    return text;
  }
  function scheduleCompact() {
    if (updateQueued || !config.enabled || (!config.compact && !config.largePanels)) return;
    updateQueued = true;
    requestAnimationFrame(() => { updateQueued = false; fitWindows(); });
  }
  function fitWindows() {
    if (!config.enabled || (!config.compact && !config.largePanels)) return;
    const width = document.documentElement.clientWidth || window.innerWidth;
    const height = window.innerHeight;
    document.querySelectorAll('.tw2gui_inner_window').forEach(win => {
      // Nunca ampliamos la ventana de equipamiento. La de inventario es ampliable.
      const name = [win.id, win.className, win.getAttribute('data-window') || ''].join(' ').toLowerCase();
      const isEquipment = /equip|outfit|wardrobe/.test(name);
      const nativeParent = win.closest('.tw2gui_window');
      const isNative = !!nativeParent && (config.autoWindows ? isAdaptiveDialog(nativeParent) : isInventoryOrWearWindow(nativeParent));
      win.classList.toggle('twmm-enlarge', config.largePanels && !isEquipment && !isNative);
      // No desplacemos el contenido INTERNO de estas ventanas: el conjunto
      // se posiciona desde su contenedor original en updateNativeWindows().
      if (isNative || !win.isConnected || win.getClientRects().length === 0) return;
      const position = getComputedStyle(win).position;
      if (!config.compact || (position !== 'absolute' && position !== 'fixed')) return;
      let rect = win.getBoundingClientRect();
      // Sólo reubicamos ventanas, jamás el mapa ni los elementos del juego.
      let dx = 0, dy = 0;
      if (rect.width <= width - 12 && rect.right > width - 6) dx = width - 6 - rect.right;
      if (rect.left < 6 || rect.width > width - 12) dx = 6 - rect.left;
      if (rect.top < 6) dy = 6 - rect.top;
      else if (rect.height < height - 85 && rect.bottom > height - 80) dy = height - 80 - rect.bottom;
      const currentLeft = Number.parseFloat(win.style.left);
      const currentTop = Number.parseFloat(win.style.top);
      if (dx && Number.isFinite(currentLeft)) win.style.left = (currentLeft + dx) + 'px';
      if (dy && Number.isFinite(currentTop)) win.style.top = (currentTop + dy) + 'px';
    });
  }

  // Sólo ventanas flotantes con un botón de cierre NATIVO propio; se excluyen
  // los módulos persistentes del HUD (misiones, logros, chat, cola de tareas).
  // El panel de misiones conserva su ajuste propio en updateQuestWindows().
  function isAdaptiveDialog(win) {
    if (!win?.classList?.contains('tw2gui_window')) return false;
    if (isQuestTracker(win)) return false;
    const identity = `${win.id || ''} ${win.className || ''}`.toLowerCase();
    if (/achievement|friend|buddy|chat|jobqueue|activityqueue|workqueue|hud|notebook|minimap|queue/.test(identity)) return false;
    const close = [...win.querySelectorAll('.tw2gui_window_buttons_close, .tw2gui_inner_window_close')]
      .find(el => el.closest('.tw2gui_window') === win);
    if (!close) return false;
    if (win.offsetWidth < 100 || win.offsetHeight < 85 || !win.getClientRects().length) return false;
    const cs = getComputedStyle(win);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    // No tocar ventanas fuera de la pantalla por una animación del juego.
    const r = win.getBoundingClientRect();
    const vv = window.visualViewport;
    const lx = vv?.offsetLeft || 0, ly = vv?.offsetTop || 0;
    const w = vv?.width || innerWidth, h = vv?.height || innerHeight;
    // El diálogo puede estar fuera del visualViewport al hacer zoom o pan.
    // Se descartan sólo ventanas claramente estacionadas fuera del documento.
    if (Math.abs(r.left) > 5000 || Math.abs(r.top) > 5000) return false;
    // Paneles de tareas fijados en la esquina inferior derecha no son diálogos.
    if (r.top > ly + h * 0.74 && r.left > lx + w * 0.65 && r.height < h * 0.42) return false;
    return true;
  }

  function updateAdaptiveWindows() {
    for (const win of [...nativeWindowState.keys()]) {
      if (!win.isConnected || !config.enabled || !isAdaptiveDialog(win)) restoreNative(win);
    }
    updateNativeCloseButtons();
    if (!config.enabled) { nativeLayoutStatus = 'desactivado'; return; }
    const vv = window.visualViewport;
    const minX = (vv?.offsetLeft || 0) + 8, minY = (vv?.offsetTop || 0) + 8;
    const viewW = vv?.width || innerWidth, viewH = vv?.height || innerHeight;
    const availableW = Math.max(0, viewW - 16), availableH = Math.max(0, viewH - 16);
    const gap = 10;
    let windows = [];
    document.querySelectorAll('.tw2gui_window').forEach(win => {
      if (!isAdaptiveDialog(win)) return;
      if (!nativeWindowState.has(win)) {
        nativeWindowState.set(win, {
          transform: win.style.transform, origin: win.style.transformOrigin,
          canScale: getComputedStyle(win).transform === 'none'
        });
      }
      const prior = nativeWindowState.get(win);
      win.style.transform = prior.transform;
      win.style.transformOrigin = prior.origin;
      // Una ventana previamente transformada por el propio juego se deja intacta.
      if (!prior.canScale) return;
      win.classList.add('twmm-native-window');
      windows.push({win, prior, rect: win.getBoundingClientRect(),
        width: win.offsetWidth, height: win.offsetHeight});
    });
    // Algunos diálogos del juego aparecen anidados o durante animaciones.
    // Nunca los reordenamos en masa por encima de cuatro diálogos simultáneos.
    windows = windows.filter(entry => entry.win.isConnected);
    if (!windows.length || windows.length > 4) {
      nativeLayoutStatus = windows.length ? 'demasiadas ventanas para reordenar' : 'ninguna ventana flotante';
      for (const entry of windows) restoreNative(entry.win);
      return;
    }
    windows.sort((a,b) => a.rect.left - b.rect.left || a.rect.top - b.rect.top);
    const n = windows.length;
    const layouts = [];
    const onlyMap = n === 1 && isMapDialog(windows[0].win);
    const maximum = onlyMap ? Math.max(config.autoMax / 100, 2.15) : (config.autoMax / 100);
    for (let cols=1; cols<=Math.min(n,3); cols++) {
      const rows=[];
      for (let i=0; i<n; i+=cols) rows.push(windows.slice(i,i+cols));
      const baseWidths=rows.map(row=>row.reduce((sum,e)=>sum+e.width,0));
      const baseHeights=rows.map(row=>Math.max(...row.map(e=>e.height)));
      const maxColumns=Math.max(...rows.map(row=>row.length));
      const horizontalGaps=gap*(maxColumns-1);
      const verticalGaps=gap*(rows.length-1);
      const maxRowW=Math.max(...baseWidths);
      const sumHeights=baseHeights.reduce((a,b)=>a+b,0);
      const factor=Math.min(maximum,
        (availableW-horizontalGaps)/maxRowW,
        (availableH-verticalGaps)/sumHeights);
      layouts.push({cols, rows, baseWidths, baseHeights, factor});
    }
    let viable=layouts.filter(l=>l.factor>=1.0);
    if (!viable.length) {
      // No reducimos arbitrariamente las ventanas cuando la pantalla es escasa.
      // Se conservan el tamaño y comportamiento originales del juego.
      nativeLayoutStatus = 'no caben sin reducir (sin cambios)';
      for (const entry of windows) restoreNative(entry.win);
      return;
    }
    viable.sort((a,b)=>b.factor-a.factor);
    let choice=viable[0];
    // Mantener inventario/equipamiento lado a lado tiene prioridad si caben.
    if (n===2) {
      const lateral=viable.find(l=>l.cols===2);
      if (lateral && lateral.factor>=1.005) choice=lateral;
    }
    // Si varias distribuciones son parecidas, elegir la más horizontal.
    if (n>2) {
      const almost=viable.filter(l=>l.factor>=choice.factor*0.93);
      choice=almost.sort((a,b)=>b.cols-a.cols)[0];
    }
    const factor=choice.factor;
    const rowWidths=choice.rows.map((row,i)=>choice.baseWidths[i]*factor+gap*(row.length-1));
    const rowHeights=choice.baseHeights.map(h=>h*factor);
    const groupW=Math.max(...rowWidths);
    const groupH=rowHeights.reduce((a,b)=>a+b,0)+gap*(rowHeights.length-1);
    // Centrar el conjunto dentro de la superficie real disponible.
    const groupLeft=minX+(availableW-groupW)/2;
    const groupTop=minY+(availableH-groupH)/2;
    let y=groupTop;
    choice.rows.forEach((row,rowIndex)=>{
      let x=groupLeft+(groupW-rowWidths[rowIndex])/2;
      row.forEach(entry=>{
        const {win,prior,rect,width,height}=entry;
        const expandedLeft=rect.left-(factor-1)*width/2;
        const expandedTop=rect.top-(factor-1)*height/2;
        const dx=x-expandedLeft, dy=y-expandedTop;
        win.style.transformOrigin='center center';
        win.style.transform=`translate(${dx}px, ${dy}px) scale(${factor})`;
        x+=width*factor+gap;
      });
      y+=rowHeights[rowIndex]+gap;
    });
    nativeLayoutStatus=`automático (${Math.round(factor*100)}%, ${n} ventana${n!==1?'s':''}, ${choice.cols} columna${choice.cols!==1?'s':''}${onlyMap ? ', mapa priorizado' : ''})`;
    if (config.compact || config.largePanels) fitWindows();
  }

  // Escala sólo las ventanas NATIVAS de equipamiento e inventario (no nuestra barra).
  // Sus clases están documentadas en scripts comunitarios del propio The West.
  // No alteramos eventos del juego ni la lógica de arrastre de objetos.
  function isInventoryOrWearWindow(win) {
    const ids = `${win.className || ''} ${win.id || ''}`.toLowerCase();
    if (/(^|\s)(wear|inventory|equipamiento|inventario)(\s|$)/.test(ids)) return true;
    const title = [...win.querySelectorAll('.tw2gui_inner_window_title, .tw2gui_window_title')]
      .slice(0, 3).map(el => el.textContent || '').join(' ').trim().toLowerCase();
    return /\b(equipamiento|inventario|equipment|inventory)\b/.test(title);
  }
  function restoreNative(win) {
    const prior = nativeWindowState.get(win);
    if (!prior) return;
    win.style.transform = prior.transform;
    win.style.transformOrigin = prior.origin;
    win.classList.remove('twmm-native-window');
    nativeWindowState.delete(win);
  }
  function scheduleNativeWindows() {
    if (nativeQueued) return;
    nativeQueued = true;
    requestAnimationFrame(() => {
      nativeQueued = false;
      updateNativeWindows();
    });
  }
  // El escalado de la v0.7 centraba CADA ventana independientemente.
  // Cuando aparecían juntas, el crecimiento horizontal las hacía solaparse.
  // En la v0.8 calculamos primero el espacio que consume EL PAR completo.
  function updateNativeWindows() {
    if (config.autoWindows) return updateAdaptiveWindows();
    for (const win of nativeWindowState.keys()) {
      if (!win.isConnected || !config.enabled || !isInventoryOrWearWindow(win)) restoreNative(win);
    }
    nativeLayoutStatus = 'ninguna';
    updateNativeCloseButtons();
    if (!config.enabled) return;

    const vv = window.visualViewport;
    const minX = (vv?.offsetLeft || 0) + 8;
    const minY = (vv?.offsetTop || 0) + 8;
    const viewWidth = vv?.width || innerWidth;
    const viewHeight = vv?.height || innerHeight;
    const maxX = minX + viewWidth - 16;
    const maxY = minY + viewHeight - 16;
    const windows = [];

    document.querySelectorAll('.tw2gui_window').forEach(win => {
      if (!isInventoryOrWearWindow(win)) return;
      if (!win.isConnected || getComputedStyle(win).display === 'none' ||
          win.getClientRects().length === 0 || win.offsetWidth < 120 || win.offsetHeight < 140) return;
      if (!nativeWindowState.has(win)) {
        const originalTransform = getComputedStyle(win).transform;
        nativeWindowState.set(win, {
          transform: win.style.transform,
          origin: win.style.transformOrigin,
          canScale: originalTransform === 'none'
        });
      }
      const prior = nativeWindowState.get(win);
      win.classList.add('twmm-native-window');
      // Restauramos nuestra transformación anterior ANTES de medir, para no
      // acumular traslaciones o escalas en recálculos posteriores.
      win.style.transform = prior.transform;
      win.style.transformOrigin = prior.origin;
      windows.push({ win, prior, rect: win.getBoundingClientRect(),
        width: win.offsetWidth, height: win.offsetHeight });
    });

    const preferredMapScale = 2.0;
    const wanted = config.nativeScale / 100;
    const availableW = Math.max(0, viewWidth - 16);
    const availableH = Math.max(0, viewHeight - 16);
    const gap = 10; // Separación visible entre bordes de ambas ventanas.
    const activePair = windows.length === 2 && windows.every(w => w.prior.canScale);

    // Transform origin: center center. CSS translate se expresa en unidades
    // de layout (no en píxeles escalados); cada ventana recibe su desplazamiento.
    function place(entry, factor, targetLeft, targetTop) {
      const { win, rect, width, height, prior } = entry;
      if (!prior.canScale || factor <= 1.005) {
        win.style.transform = prior.transform;
        win.style.transformOrigin = prior.origin;
        return;
      }
      const grownLeft = rect.left - (factor - 1) * width / 2;
      const grownTop = rect.top - (factor - 1) * height / 2;
      const dx = targetLeft - grownLeft;
      const dy = targetTop - grownTop;
      win.style.transformOrigin = 'center center';
      win.style.transform = `translate(${dx}px, ${dy}px) scale(${factor})`;
    }

    if (activePair) {
      const pair = [...windows].sort((a, b) => a.rect.left - b.rect.left);
      const [left, right] = pair;
      const sumWidth = left.width + right.width;
      // Una sola escala para ambas: nunca permite que se monten.
      const sideFactor = Math.min(wanted, (availableW - gap) / sumWidth,
        availableH / Math.max(left.height, right.height));
      const stackFactor = Math.min(wanted, availableW / Math.max(left.width, right.width),
        (availableH - gap) / (left.height + right.height));
      // Prioridad: conservar las dos ventanas juntas, sin solaparlas.
      if (sideFactor > 1.005) {
        const pairW = sideFactor * sumWidth + gap;
        const pairH = sideFactor * Math.max(left.height, right.height);
        const x = minX + (availableW - pairW) / 2;
        const originalCenterY = (Math.min(left.rect.top, right.rect.top) +
          Math.max(left.rect.bottom, right.rect.bottom)) / 2;
        const top = Math.min(Math.max(originalCenterY - pairH / 2, minY), maxY - pairH);
        place(left, sideFactor, x, top);
        place(right, sideFactor, x + left.width * sideFactor + gap, top);
        nativeLayoutStatus = `lado a lado (${Math.round(sideFactor * 100)}%)`;
      } else {
        // Fallback: si ni siquiera entran una al lado de la otra ampliadas,
        // se apilan verticalmente, conservando la escala elegida en lo posible.
        if (stackFactor > 1.005) {
          const h = (left.height + right.height) * stackFactor + gap;
          const y = minY + (availableH - h) / 2;
          place(left, stackFactor, minX + (availableW - left.width * stackFactor) / 2, y);
          place(right, stackFactor, minX + (availableW - right.width * stackFactor) / 2,
            y + left.height * stackFactor + gap);
          nativeLayoutStatus = `apiladas (${Math.round(stackFactor * 100)}%)`;
        } else {
          nativeLayoutStatus = 'sin ampliar (pantalla reducida)';
        }
      }
      // El par ya fue procesado. Ninguna otra regla puede desplazarlo por separado.
    } else {
      // Si se abrió una sola ventana, conservamos el comportamiento de la v0.7.
      for (const entry of windows) {
        if (!entry.prior.canScale) continue;
        const targetWanted = (windows.length === 1 && isMapDialog(entry.win)) ? Math.max(wanted, preferredMapScale) : wanted;
        const factor = Math.min(targetWanted, availableW / entry.width, availableH / entry.height);
        if (factor <= 1.005) continue;
        const grownLeft = entry.rect.left - (factor - 1) * entry.width / 2;
        const grownTop = entry.rect.top - (factor - 1) * entry.height / 2;
        const left = Math.min(Math.max(grownLeft, minX), maxX - entry.width * factor);
        const top = Math.min(Math.max(grownTop, minY), maxY - entry.height * factor);
        place(entry, factor, left, top);
      }
      nativeLayoutStatus = windows.length === 1 ? 'individual' : `individuales (${windows.length})`;
    }
    if (config.compact || config.largePanels) fitWindows();
  }

  // X GRANDE GLOBAL. Sólo añadimos un control si el juego expone su propio
  // botón nativo de cierre. Un toque nuestro delega en ese botón original;
  // no intentamos cerrar ventanas manipulando estado interno del juego.
  function updateNativeCloseButtons() {
    // Primero restauramos ventanas cuando se desactiva la opción o nuestro modo.
    document.querySelectorAll('.twmm-native-close').forEach(button => {
      const parent = button.parentElement;
      const native = parent?.querySelector('.tw2gui_window_buttons_close, .tw2gui_inner_window_close');
      if (!config.enabled || !config.nativeClose || !parent?.isConnected || !native) button.remove();
    });
    if (!config.enabled || !config.nativeClose) return;
    document.querySelectorAll('.tw2gui_window').forEach(win => {
      if (!win.isConnected || !win.getClientRects().length ||
          getComputedStyle(win).display === 'none' || win.offsetWidth < 55) return;
      // Evitamos capturar el control de otra ventana anidada.
      const close = [...win.querySelectorAll('.tw2gui_window_buttons_close, .tw2gui_inner_window_close')]
        .find(el => el.closest('.tw2gui_window') === win);
      if (!close || win.querySelector(':scope > .twmm-native-close')) return;
      const bigger = document.createElement('button');
      bigger.type = 'button';
      bigger.className = 'twmm-native-close';
      bigger.textContent = '×';
      bigger.setAttribute('aria-label', 'Cerrar ventana del juego');
      bigger.title = 'Cerrar ventana';
      bigger.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const nativeNow = [...win.querySelectorAll('.tw2gui_window_buttons_close, .tw2gui_inner_window_close')]
          .find(el => el.closest('.tw2gui_window') === win);
        if (nativeNow?.isConnected) nativeNow.click();
        scheduleNativeWindows();
        scheduleQuestWindows();
      });
      win.appendChild(bigger);
    });
  }

  // No fabricamos una segunda lista: ampliamos el rastreador NATIVO.
  // Usamos su título para evitar modificar otros rastreadores de terceros
  // (p.ej. el de logros, que también puede llevar la clase questtracker).
  function isQuestTracker(win) {
    if (!win?.classList?.contains('tw2gui_window')) return false;
    const idAndClass = `${win.id || ''} ${win.className || ''}`.toLowerCase();
    if (/achievement|logros|achievementtracker/.test(idAndClass) || win.querySelector('#ui_achievementtracker')) return false;
    const titles = [...win.querySelectorAll('.tw2gui_window_title, .tw2gui_inner_window_title, .tw2gui_window_tab_text')]
      .slice(0, 7).map(el => (el.textContent || '').trim().toLowerCase()).join(' ');
    if (/seguimiento de logros|achievement tracker/.test(titles)) return false;
    if (/seguidor de b[úu]squedas|seguimiento de (misiones|b[úu]squedas)|quest.?tracker|quest tracking|quest tracker/.test(titles)) return true;
    return /(?:^|\s)questtracker(?:\s|$)/.test(idAndClass) && !/achievement/.test(titles);
  }
  function restoreQuestWindow(win) {
    const prev = questWindowState.get(win);
    if (!prev) return;
    win.style.transform = prev.transform;
    win.style.transformOrigin = prev.origin;
    win.classList.remove('twmm-quest-boost');
    questWindowState.delete(win);
  }
  function scheduleQuestWindows() {
    if (questQueued) return;
    questQueued = true;
    requestAnimationFrame(() => {
      questQueued = false;
      updateQuestWindows();
    });
  }
  function updateQuestWindows() {
    for (const win of [...questWindowState.keys()]) {
      if (!win.isConnected || !config.enabled || config.questScale === 100 || !isQuestTracker(win))
        restoreQuestWindow(win);
    }
    questLayoutStatus = 'no encontrado';
    if (!config.enabled || config.questScale === 100) {
      questLayoutStatus = 'desactivado';
      return;
    }
    const vv = window.visualViewport;
    const minX = (vv?.offsetLeft || 0) + 8;
    const minY = (vv?.offsetTop || 0) + 8;
    const viewWidth = vv?.width || innerWidth;
    const viewHeight = vv?.height || innerHeight;
    const maxX = minX + viewWidth - 16;
    const maxY = minY + viewHeight - 16;
    document.querySelectorAll('.tw2gui_window').forEach(win => {
      if (!isQuestTracker(win) || !win.isConnected || !win.getClientRects().length ||
          getComputedStyle(win).display === 'none' || win.offsetWidth < 120 || win.offsetHeight < 90) return;
      if (!questWindowState.has(win)) {
        questWindowState.set(win, {transform: win.style.transform,
          origin: win.style.transformOrigin, canScale: getComputedStyle(win).transform === 'none'});
      }
      const prev = questWindowState.get(win);
      // Medimos siempre sin nuestro transform para que el zoom nunca se acumule.
      win.style.transform = prev.transform;
      win.style.transformOrigin = prev.origin;
      if (!prev.canScale) { questLayoutStatus = 'el juego ya transforma este panel'; return; }
      const rect = win.getBoundingClientRect();
      const width = win.offsetWidth;
      const height = win.offsetHeight;
      const factor = Math.min(config.questScale / 100,
        Math.max(1, (viewWidth - 16) / width),
        Math.max(1, (viewHeight - 16) / height));
      if (factor <= 1.005) { questLayoutStatus = 'sin espacio para ampliar'; return; }
      const scaledW = width * factor;
      const scaledH = height * factor;
      // Prioridad: conservar la esquina superior derecha en el área visible.      // La lista crece hacia la izquierda, evitando desbordarse a la derecha.
      const intendedLeft = rect.right - scaledW;
      const targetLeft = Math.min(Math.max(intendedLeft, minX), maxX - scaledW);
      const targetTop = Math.min(Math.max(rect.top, minY), maxY - scaledH);
      const dx = targetLeft - intendedLeft;
      const dy = targetTop - rect.top;
      win.classList.add('twmm-quest-boost');
      win.style.transformOrigin = 'top right';
      win.style.transform = `translate(${dx}px, ${dy}px) scale(${factor})`;
      questLayoutStatus = `ampliado al ${Math.round(factor * 100)}%`;
    });
  }

  // Vincular sobre el botón original. Interceptamos el gesto para no ejecutar la acción al vincular.
  document.addEventListener('pointerdown', (e) => {
    if (!binding || host.contains(e.target)) return;
    const key = binding;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = candidateButton(e.target);
    binding = null;
    if (!target) {
      toast('Ese elemento no sirve como acceso. Intentá con el botón del menú.');
      apply();
      return;
    }
    const selector = selectorFor(target);
    if (!selector || document.querySelector(selector) !== target) {
      toast('No pude reconocer ese control. Probá otro.');
      apply();
      return;
    }
    config.shortcuts[key] = selector;
    save();
    lastTap = { target, until: Date.now() + 1000 };
    apply();
    const label = ITEMS.find(i => i.key === key).label;
    toast(`¡${label} configurado! Podés deshacerlo desde ⚙️.`);
  }, { capture: true, passive: false });
  document.addEventListener('click', (e) => {
    if (lastTap && Date.now() < lastTap.until && lastTap.target.contains(e.target)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      lastTap = null;
    }
  }, true);
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const key = btn.dataset.key;
    if (action === 'open') return openShortcut(key);
    if (action === 'toggle-rail') {
      const currentlyOpen = railManualOverride === null ? config.railExpanded : railManualOverride;
      railManualOverride = !currentlyOpen;
      settingsOpen = false;
      return apply();
    }
    if (action === 'pinrail') { config.railExpanded = !config.railExpanded; railManualOverride = null; save(); return apply(); }
    if (action === 'settings') { settingsOpen = !settingsOpen; binding = null; return apply(); }
    if (action === 'close') { settingsOpen = false; binding = null; return apply(); }
    if (action === 'bind') {
      binding = key;
      settingsOpen = false;
      // Cualquier aviso anterior también debe desaparecer para dejar el juego libre.
      clearTimeout(noticeTimer);
      toastEl.classList.add('hidden');
      return apply();
    }
    if (action === 'cancelbind') {
      binding = null;
      settingsOpen = true;
      return apply();
    }
    if (action === 'auto-windows') { config.autoWindows = !config.autoWindows; save(); return apply(); }
    if (action === 'auto-max') {
      const values = [125, 145, 160, 180];
      config.autoMax = values[(values.indexOf(config.autoMax) + 1) % values.length];
      save(); return apply();
    }
    if (action === 'large') { config.largePanels=!config.largePanels; save(); scheduleCompact(); return apply(); }
    if (action === 'native-scale') {
      if (config.autoWindows) return;
      const values = [100, 115, 125, 135];
      config.nativeScale = values[(values.indexOf(config.nativeScale) + 1) % values.length];
      save(); return apply();
    }
    if (action === 'native-close') { config.nativeClose = !config.nativeClose; save(); return apply(); }
    if (action === 'quest-scale') {
      const values = [100, 115, 125, 140];
      config.questScale = values[(values.indexOf(config.questScale) + 1) % values.length];
      save(); return apply();
    }
    if (action === 'compact') { config.compact = !config.compact; save(); return apply(); }
    if (action === 'blockfocus') { config.blockMapAutoFocus = !config.blockMapAutoFocus; save(); return apply(); }
    if (action === 'diagnostic') { diagnostic(); return; }
    if (action === 'clear') { config.shortcuts = {}; save(); apply(); return toast('Accesos borrados.'); }
    if (action === 'disable') {
      config.enabled = false; settingsOpen = false; binding = null;
      save(); return apply();
    }
    if (action === 'enable') { config.enabled = true; save(); return apply(); }
  });

  const observer = new MutationObserver(mutations => {
    if (!config.enabled) return;
    for (const change of mutations) {
      if (change.addedNodes.length > 0) { scheduleCompact(); scheduleNativeWindows(); scheduleQuestWindows(); break; }
    }
  });
  // No observamos atributos: de otro modo ajustar una ventana realimentaría el observador.
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', scheduleCompact, { passive: true });
  window.addEventListener('resize', scheduleViewport, { passive: true });
  window.addEventListener('resize', scheduleNativeWindows, { passive: true });
  window.addEventListener('resize', scheduleQuestWindows, { passive: true });
  document.addEventListener('pointerup', scheduleNativeWindows, { passive: true });
  document.addEventListener('pointerup', scheduleQuestWindows, { passive: true });
  document.addEventListener('click', scheduleNativeWindows, { passive: true });
  document.addEventListener('click', scheduleQuestWindows, { passive: true });
  window.addEventListener('scroll', scheduleViewport, { passive: true });
  window.addEventListener('orientationchange', scheduleViewport, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('scroll', scheduleViewport, { passive: true });
    window.visualViewport.addEventListener('resize', scheduleViewport, { passive: true });
    window.visualViewport.addEventListener('resize', scheduleNativeWindows, { passive: true });
    window.visualViewport.addEventListener('resize', scheduleQuestWindows, { passive: true });
    window.visualViewport.addEventListener('scroll', scheduleQuestWindows, { passive: true });
  }
  // Aplicamos de inmediato para que la barra no aparezca fuera de pantalla
  // antes del primer frame, incluso en sitios con viewport inicialmente ancho.
  placeOverlay();
  apply();
  toast('The West Mobile v1.2: el mapa puede aprovechar más pantalla cuando está abierto solo.', 3400);
})();