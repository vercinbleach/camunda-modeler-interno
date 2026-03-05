/**
 * Web Backend Shim for Camunda Modeler
 *
 * Replaces the Electron IPC backend with a browser-compatible implementation.
 * File storage uses localStorage (to be replaced with SpacetimeDB).
 * This must be loaded BEFORE the Camunda Modeler bundle.js.
 */
(function() {
  'use strict';

  const STORAGE_PREFIX = 'camunda-collab:';
  const listeners = new Map();

  function emit(event, ...args) {
    const cbs = listeners.get(event) || [];
    cbs.forEach(cb => {
      try { cb(...args); } catch(e) { console.error('Event handler error:', event, e); }
    });
  }

  // In-memory file store: path → { contents, lastModified, name }
  const fileStore = new Map();
  let fileIdCounter = 1;

  function generatePath(name) {
    return '/virtual/' + (fileIdCounter++) + '/' + (name || 'diagram.bpmn');
  }

  // Generate unique ID
  function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // Config stored in localStorage
  function configGet(key) {
    // Auto-generate editor.id if missing (required by UserJourneyStatistics)
    if (key === 'editor.id') {
      let id = localStorage.getItem(STORAGE_PREFIX + 'config:editor.id');
      if (!id) {
        id = JSON.stringify(generateId());
        localStorage.setItem(STORAGE_PREFIX + 'config:editor.id', id);
      }
      try { return JSON.parse(id); } catch { return id; }
    }
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + 'config:' + key);
      return raw ? JSON.parse(raw) : undefined;
    } catch { return undefined; }
  }

  function configSet(key, value) {
    localStorage.setItem(STORAGE_PREFIX + 'config:' + key, JSON.stringify(value));
    return value;
  }

  // Workspace stored in localStorage
  function workspaceSave(config) {
    localStorage.setItem(STORAGE_PREFIX + 'workspace', JSON.stringify(config));
  }

  function workspaceRestore(defaultConfig) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + 'workspace');
      if (raw) return JSON.parse(raw);
    } catch {}
    // Return valid default with empty files array
    return defaultConfig || { files: [], activeFile: -1, layout: {} };
  }

  async function handleSend(event, ...args) {
    switch (event) {

      // ── File System ────────────────────────────────────────────────
      case 'file:read': {
        const [filePath, options] = args;
        const stored = fileStore.get(filePath);
        if (stored) {
          return {
            path: filePath,
            contents: stored.contents,
            lastModified: stored.lastModified || Date.now(),
            name: stored.name || filePath.split('/').pop(),
            messages: []
          };
        }
        throw new Error('File not found: ' + filePath);
      }

      case 'file:read-stats': {
        const [file] = args;
        const stored = fileStore.get(file.path);
        return {
          ...file,
          lastModified: stored ? stored.lastModified : file.lastModified
        };
      }

      case 'file:write': {
        const [filePath, file, options] = args;
        const now = Date.now();
        fileStore.set(filePath, {
          contents: file.contents,
          lastModified: now,
          name: file.name || filePath.split('/').pop()
        });
        return {
          ...file,
          path: filePath,
          lastModified: now
        };
      }

      case 'file:get-path': {
        // In web, we can't get OS paths. Return null - file will be treated as new.
        return null;
      }

      // ── Dialogs ────────────────────────────────────────────────────
      case 'dialog:open-files': {
        return new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.bpmn,.dmn,.form,.xml,.json';
          input.multiple = true;
          input.onchange = async () => {
            const paths = [];
            for (const file of input.files) {
              const contents = await file.text();
              const path = generatePath(file.name);
              fileStore.set(path, {
                contents,
                lastModified: file.lastModified,
                name: file.name
              });
              paths.push(path);
            }
            resolve(paths);
          };
          input.oncancel = () => resolve([]);
          input.click();
        });
      }

      case 'dialog:save-file': {
        const [options] = args;
        const file = options.file || {};
        // In browser: download the file
        const name = file.name || 'diagram.bpmn';
        const path = file.path || generatePath(name);
        // Also keep in memory
        if (file.contents) {
          fileStore.set(path, {
            contents: file.contents,
            lastModified: Date.now(),
            name
          });
        }
        // Trigger download
        if (file.contents) {
          const blob = new Blob([file.contents], { type: 'application/xml' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = name;
          a.click();
          URL.revokeObjectURL(a.href);
        }
        return path;
      }

      case 'dialog:open-file-error': {
        const [options] = args;
        alert((options && options.message) || 'Error opening file');
        return { button: 'cancel' };
      }

      case 'dialog:show': {
        const [options] = args;
        const result = confirm(
          (options.message || '') + (options.detail ? '\n' + options.detail : '')
        );
        return { button: result ? 0 : 1 };
      }

      case 'dialog:open-file-explorer': {
        return; // no-op in web
      }

      // ── Config ─────────────────────────────────────────────────────
      case 'config:get': {
        const [key] = args;
        return configGet(key);
      }

      case 'config:set': {
        const [key, value] = args;
        return configSet(key, value);
      }

      // ── Workspace ──────────────────────────────────────────────────
      case 'workspace:save': {
        const [config] = args;
        workspaceSave(config);
        return;
      }

      case 'workspace:restore': {
        const [defaultConfig] = args;
        return workspaceRestore(defaultConfig);
      }

      // ── App lifecycle ──────────────────────────────────────────────
      case 'app:reload': {
        window.location.reload();
        return;
      }

      case 'app:restart': {
        window.location.reload();
        return;
      }

      case 'app:quit-allowed':
      case 'app:quit-aborted':
        return;

      case 'client:ready': {
        // Electron emits client:started after receiving client:ready
        // with workspace restore data and any CLI files
        setTimeout(() => {
          emit('client:started', {}, {
            files: [],
            activeFile: -1,
            layout: {}
          });
        }, 100);
        return;
      }

      case 'client:error': {
        console.error('Client error:', ...args);
        return;
      }

      // ── Menus (stubs) ──────────────────────────────────────────────
      case 'context-menu:open':
      case 'menu:register':
      case 'menu:update':
      case 'toggle-plugins':
        return;

      // ── External ───────────────────────────────────────────────────
      case 'external:open-url': {
        const [options] = args;
        if (options && options.url) window.open(options.url, '_blank');
        return;
      }

      // ── Clipboard ──────────────────────────────────────────────────
      case 'system-clipboard:write-text': {
        const [options] = args;
        if (options && options.text && navigator.clipboard) {
          await navigator.clipboard.writeText(options.text);
        }
        return;
      }

      // ── File context (stubs) ───────────────────────────────────────
      case 'file-context:file-opened':
      case 'file-context:file-closed':
      case 'file-context:file-updated':
      case 'file-context:add-root':
      case 'file-context:remove-root':
        return;

      // ── Templates (stubs) ──────────────────────────────────────────
      case 'client:templates-update':
        return;

      // ── Error tracking (stubs) ─────────────────────────────────────
      case 'errorTracking:turnedOn':
      case 'errorTracking:turnedOff':
        return;

      // ── Zeebe (stubs - not needed for Camunda 7) ───────────────────
      case 'zeebe:checkConnection':
      case 'zeebe:deploy':
      case 'zeebe:startInstance':
      case 'zeebe:getGatewayVersion':
      case 'zeebe:searchProcessInstances':
      case 'zeebe:searchElementInstances':
      case 'zeebe:searchVariables':
      case 'zeebe:searchIncidents':
        return { error: 'Zeebe not available in web mode' };

      default:
        console.warn('Unhandled backend event:', event, args);
        return;
    }
  }

  const backend = {
    send(event, ...args) {
      return Promise.resolve().then(() => handleSend(event, ...args));
    },

    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(callback);
      return {
        cancel() {
          const cbs = listeners.get(event);
          if (cbs) {
            const idx = cbs.indexOf(callback);
            if (idx >= 0) cbs.splice(idx, 1);
          }
        }
      };
    },

    once(event, callback) {
      const wrapped = (...args) => {
        sub.cancel();
        callback(...args);
      };
      const sub = backend.on(event, wrapped);
      return sub;
    },

    getPlatform() {
      return 'linux';
    },

    sendQuitAllowed() {},
    sendQuitAborted() {},
    sendReady() { backend.send('client:ready'); },

    showContextMenu(type, options) {
      // Web context menus not supported yet
    },

    sendTogglePlugins() {},

    sendMenuUpdate(state) {
      backend.send('menu:update', state);
    },

    registerMenu(name, options) {
      return backend.send('menu:register', name, options);
    }
  };

  // Package version info
  const metadata = {
    version: '5.45.0-web',
    name: 'Camunda Modeler (Web)'
  };

  const flags = {
    'disable-rpa': true
  };

  const plugins = [];

  // Make getAppPreload available ONCE (same contract as Electron preload)
  let called = false;
  window.getAppPreload = function() {
    if (called) throw new Error('getAppPreload already called');
    called = true;
    return { metadata, flags, plugins, backend };
  };

  console.info('[Web Shim] Camunda Modeler web backend initialized');
})();
