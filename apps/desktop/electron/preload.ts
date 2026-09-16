import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'

// Which translucency the OS can back. Asked synchronously because the renderer
// needs it before its first paint, and answered by main because deciding it
// needs `os.release()` — a sandboxed preload may only require electron, events,
// timers and url, so importing node:os here throws before contextBridge runs
// and takes the ENTIRE bridge down with it (window.arielDesktop undefined =>
// "Desktop IPC bridge is unavailable"). No reply means no glass, which degrades
// to an ordinary opaque window rather than a page thinned over nothing.
const translucencySupport = ipcRenderer.sendSync('ariel:translucency:support')
const hudWindowing = ipcRenderer.sendSync('ariel:hud:windowing')
const hudNativeDrag = hudWindowing?.nativeDrag === true

contextBridge.exposeInMainWorld('arielDesktop', {
  glassSupported: translucencySupport?.glass === true,
  translucencySupported: translucencySupport?.translucency === true,
  getConnection: profile => ipcRenderer.invoke('ariel:connection', profile),
  // Registry-scoped backend resolution: { connectionId, profile } → descriptor.
  getConnectionFor: payload => ipcRenderer.invoke('ariel:connection:for', payload),
  getProfileRoutes: profiles => ipcRenderer.invoke('ariel:plugin-profile-routes', profiles),
  revalidateConnection: () => ipcRenderer.invoke('ariel:connection:revalidate'),
  touchBackend: profile => ipcRenderer.invoke('ariel:backend:touch', profile),
  getGatewayWsUrl: profile => ipcRenderer.invoke('ariel:gateway:ws-url', profile),
  // Registry-scoped fresh WS URL: { connectionId, profile } → result shape of
  // getGatewayWsUrl, minted against that connection's backend.
  getGatewayWsUrlFor: payload => ipcRenderer.invoke('ariel:gateway:ws-url-for', payload),
  // Union agent roster across every registered connection.
  getAgentRoster: () => ipcRenderer.invoke('ariel:agents:roster'),
  openSessionWindow: (sessionId, opts) => ipcRenderer.invoke('ariel:window:openSession', sessionId, opts),
  openSessionInTerminal: (sessionId, opts) => ipcRenderer.invoke('ariel:window:openInTerminal', sessionId, opts),
  openWindow: () => ipcRenderer.invoke('ariel:window:openInstance'),
  openBrowserWindow: tabId => ipcRenderer.invoke('ariel:window:openBrowser', tabId),
  onBrowserPopoutClosed: callback => {
    const listener = (_event, tabId) => callback(tabId)
    ipcRenderer.on('ariel:browser-popout:closed', listener)

    return () => ipcRenderer.removeListener('ariel:browser-popout:closed', listener)
  },
  claimAmbientCue: key => ipcRenderer.invoke('ariel:ambient:claim', key),
  wakeIndicator: {
    getState: () => ipcRenderer.invoke('ariel:wake-indicator:get'),
    setState: state => ipcRenderer.send('ariel:wake-indicator:set', state),
    onState: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('ariel:wake-indicator:state', listener)

      return () => ipcRenderer.removeListener('ariel:wake-indicator:state', listener)
    }
  },
  petOverlay: {
    // Main renderer → main process: window lifecycle + drag. `request` is
    // `{ bounds, screen }`; resolves with the screen bounds it actually used.
    open: request => ipcRenderer.invoke('ariel:pet-overlay:open', request),
    close: () => ipcRenderer.invoke('ariel:pet-overlay:close'),
    setBounds: bounds => ipcRenderer.send('ariel:pet-overlay:set-bounds', bounds),
    setIgnoreMouse: ignore => ipcRenderer.send('ariel:pet-overlay:ignore-mouse', ignore),
    // Flip the overlay focusable (and focus it) while the composer needs keys.
    setFocusable: focusable => ipcRenderer.send('ariel:pet-overlay:set-focusable', focusable),
    // Main renderer → overlay (forwarded by main): push the latest pet state.
    pushState: payload => ipcRenderer.send('ariel:pet-overlay:state', payload),
    // Overlay → main renderer (forwarded by main): pop back in / composer submit.
    control: payload => ipcRenderer.send('ariel:pet-overlay:control', payload),
    // Overlay subscribes to state pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('ariel:pet-overlay:state', listener)

      return () => ipcRenderer.removeListener('ariel:pet-overlay:state', listener)
    },
    // Main renderer subscribes to overlay control messages.
    onControl: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('ariel:pet-overlay:control', listener)

      return () => ipcRenderer.removeListener('ariel:pet-overlay:control', listener)
    }
  },
  // HUD mode: the chrome-free floating chat. A full app renderer (own gateway)
  // sized as a floating bar, so it mounts the real composer. Main owns the
  // window; `onChanged` keeps every window's toggle truthful.
  hud: {
    nativeDrag: hudNativeDrag,
    windowing: {
      clientPlacement: hudWindowing?.clientPlacement !== false,
      controlDrag: hudWindowing?.controlDrag === true,
      nativeDrag: hudNativeDrag,
      solid: hudWindowing?.solid === true,
      workspaceTransfer: hudWindowing?.workspaceTransfer === true
    },
    open: request => ipcRenderer.invoke('ariel:hud:open', request),
    close: () => ipcRenderer.invoke('ariel:hud:close'),
    setIgnoreMouse: ignore => ipcRenderer.send('ariel:hud:ignore-mouse', ignore),
    beginMove: () => ipcRenderer.send('ariel:hud:begin-move'),
    endMove: () => ipcRenderer.send('ariel:hud:end-move'),
    moveBy: delta => ipcRenderer.send('ariel:hud:move-by', delta),
    setWorkspaceTransfer: transferring => ipcRenderer.send('ariel:hud:workspace-transfer', transferring),
    setBounds: bounds => ipcRenderer.send('ariel:hud:set-bounds', bounds),
    resetLayout: () => ipcRenderer.invoke('ariel:hud:reset-layout'),
    // Whether the band covers the window below the bar. Main pairs it with the
    // user's translucency setting to decide the native frost (macOS vibrancy /
    // Windows 11 DWM backdrop) — see hudFrostFor.
    setFrost: showing => ipcRenderer.invoke('ariel:hud:frost', showing),
    // The HUD tells main which session it is on; main hands that back to the
    // app window when the HUD closes, so the app can re-home onto it.
    setSession: sessionId => ipcRenderer.send('ariel:hud:session', sessionId),
    onGoto: callback => {
      const listener = (_event, sessionId) => callback(sessionId)
      ipcRenderer.on('ariel:hud:goto', listener)

      return () => ipcRenderer.removeListener('ariel:hud:goto', listener)
    },
    onChanged: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('ariel:hud:changed', listener)

      return () => ipcRenderer.removeListener('ariel:hud:changed', listener)
    },
    // Linux only, and silent elsewhere: where the cursor is, in page
    // coordinates, or null when it has left the window. Stands in for the
    // mousemove that `setIgnoreMouseEvents(true, { forward: true })` delivers on
    // macOS and Windows but not here.
    onCursor: callback => {
      const listener = (_event, point) => callback(point)
      ipcRenderer.on('ariel:hud:cursor', listener)

      return () => ipcRenderer.removeListener('ariel:hud:cursor', listener)
    },
    // Main's game-overlay watch: whether a fullscreen app (a game) is under
    // the HUD, so the renderer can step back to the low-opacity overlay
    // treatment while one owns the screen.
    onGameOverlay: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('ariel:hud:game-overlay', listener)

      return () => ipcRenderer.removeListener('ariel:hud:game-overlay', listener)
    }
  },
  // Quick Entry: the global-hotkey mini composer window. Main owns the OS
  // shortcut + the persisted preference; the quick window only captures text
  // and hands it back, and the primary renderer submits it through the normal
  // prompt path.
  quickEntry: {
    getSettings: () => ipcRenderer.invoke('ariel:quick-entry:settings:get'),
    setSettings: patch => ipcRenderer.invoke('ariel:quick-entry:settings:set', patch),
    submit: payload => ipcRenderer.send('ariel:quick-entry:submit', payload),
    dismiss: () => ipcRenderer.send('ariel:quick-entry:dismiss'),
    // Primary renderer → main → quick window: gateway connection state + the
    // recent-session options the target picker offers. Main caches the latest
    // payload so a freshly spawned quick window starts from truth.
    pushState: payload => ipcRenderer.send('ariel:quick-entry:state', payload),
    // Quick window subscribes to those pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('ariel:quick-entry:state', listener)

      return () => ipcRenderer.removeListener('ariel:quick-entry:state', listener)
    },
    // Main → primary renderer: a submit captured by the quick window.
    onSubmit: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('ariel:quick-entry:submit', listener)

      return () => ipcRenderer.removeListener('ariel:quick-entry:submit', listener)
    },
    // Main → quick window: you were just summoned (reset draft + refocus).
    onShown: callback => {
      const listener = () => callback()
      ipcRenderer.on('ariel:quick-entry:shown', listener)

      return () => ipcRenderer.removeListener('ariel:quick-entry:shown', listener)
    }
  },
  getBootProgress: () => ipcRenderer.invoke('ariel:boot-progress:get'),
  getConnectionConfig: profile => ipcRenderer.invoke('ariel:connection-config:get', profile),
  saveConnectionConfig: payload => ipcRenderer.invoke('ariel:connection-config:save', payload),
  applyConnectionConfig: payload => ipcRenderer.invoke('ariel:connection-config:apply', payload),
  testConnectionConfig: payload => ipcRenderer.invoke('ariel:connection-config:test', payload),
  // Opt-in OS-keychain encryption for stored gateway secrets (default off —
  // see secret-storage-policy.ts). get never touches the OS keychain.
  getSecretStorageEncryption: () => ipcRenderer.invoke('ariel:secret-storage:get'),
  setSecretStorageEncryption: (on: boolean) => ipcRenderer.invoke('ariel:secret-storage:set', on),
  // v2 multi-connection registry: named agent sources (local / remote / cloud / ssh).
  connections: {
    list: () => ipcRenderer.invoke('ariel:connections:list'),
    save: payload => ipcRenderer.invoke('ariel:connections:save', payload),
    remove: id => ipcRenderer.invoke('ariel:connections:remove', id),
    setPrimary: id => ipcRenderer.invoke('ariel:connections:set-primary', id),
    setLaunchMode: mode => ipcRenderer.invoke('ariel:connections:set-launch-mode', mode),
    setLastUsed: id => ipcRenderer.invoke('ariel:connections:set-last-used', id),
    test: id => ipcRenderer.invoke('ariel:connections:test', id),
    updateManaged: id => ipcRenderer.invoke('ariel:connections:update-managed', id),
    // Fan out `ariel update` to every eligible registered connection.
    // Optional excludeIds skips rows the caller updates through another path.
    updateAll: options => ipcRenderer.invoke('ariel:connections:update-all', options),
    // Registry lifecycle push (main → renderer): a connection was removed or
    // materially edited, so secondaries scoped to it must be disposed (and,
    // for edits, re-dialed at the new target).
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('ariel:connections:changed', listener)

      return () => ipcRenderer.removeListener('ariel:connections:changed', listener)
    }
  },
  sshConfigHosts: () => ipcRenderer.invoke('ariel:ssh-config:hosts'),
  sshResolveHost: host => ipcRenderer.invoke('ariel:ssh-config:resolve', host),
  probeConnectionConfig: remoteUrl => ipcRenderer.invoke('ariel:connection-config:probe', remoteUrl),
  oauthLoginConnectionConfig: remoteUrl => ipcRenderer.invoke('ariel:connection-config:oauth-login', remoteUrl),
  oauthLogoutConnectionConfig: remoteUrl => ipcRenderer.invoke('ariel:connection-config:oauth-logout', remoteUrl),
  // Ariel Cloud: one portal login powers discovery + silent per-agent sign-in
  // (cloud-auto-discovery Phase 3).
  cloud: {
    status: () => ipcRenderer.invoke('ariel:cloud:status'),
    login: () => ipcRenderer.invoke('ariel:cloud:login'),
    logout: () => ipcRenderer.invoke('ariel:cloud:logout'),
    discover: org => ipcRenderer.invoke('ariel:cloud:discover', org),
    agentSignIn: dashboardUrl => ipcRenderer.invoke('ariel:cloud:agent-sign-in', dashboardUrl)
  },
  profile: {
    get: () => ipcRenderer.invoke('ariel:profile:get'),
    remember: name => ipcRenderer.invoke('ariel:profile:remember', name),
    set: name => ipcRenderer.invoke('ariel:profile:set', name)
  },
  api: request => ipcRenderer.invoke('ariel:api', request),
  notify: payload => ipcRenderer.invoke('ariel:notify', payload),
  requestMicrophoneAccess: () => ipcRenderer.invoke('ariel:requestMicrophoneAccess'),
  readWindowBelow: () => ipcRenderer.invoke('ariel:window:readBelow'),
  readFileDataUrl: filePath => ipcRenderer.invoke('ariel:readFileDataUrl', filePath),
  readFileDataUrlForAttach: filePath => ipcRenderer.invoke('ariel:readFileDataUrlForAttach', filePath),
  dataUrlReadMax: {
    get: () => ipcRenderer.invoke('ariel:data-url-read-max:get'),
    set: maxMb => ipcRenderer.invoke('ariel:data-url-read-max:set', maxMb)
  },
  readFileText: filePath => ipcRenderer.invoke('ariel:readFileText', filePath),
  readPluginSource: (filePath: string) => ipcRenderer.invoke('ariel:readPluginSource', filePath),
  selectPaths: options => ipcRenderer.invoke('ariel:selectPaths', options),
  selectSavePath: options => ipcRenderer.invoke('ariel:selectSavePath', options),
  writeClipboard: text => ipcRenderer.invoke('ariel:writeClipboard', text),
  readClipboard: () => ipcRenderer.invoke('ariel:readClipboard'),
  saveGatewayFile: payload => ipcRenderer.invoke('ariel:saveGatewayFile', payload),
  saveImageFromUrl: url => ipcRenderer.invoke('ariel:saveImageFromUrl', url),
  contextMenuEdit: command => ipcRenderer.invoke('ariel:context-menu:edit', command),
  contextMenuCopyImage: () => ipcRenderer.invoke('ariel:context-menu:copy-image'),
  contextMenuSpellcheck: action => ipcRenderer.invoke('ariel:context-menu:spellcheck', action),
  contextMenuGuestAddWord: payload => ipcRenderer.invoke('ariel:context-menu:guest-add-word', payload),
  onContextMenuSpellcheck: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('ariel:context-menu-spellcheck', listener)

    return () => ipcRenderer.removeListener('ariel:context-menu-spellcheck', listener)
  },
  saveImageBuffer: (data, ext) => ipcRenderer.invoke('ariel:saveImageBuffer', { data, ext }),
  saveClipboardImage: () => ipcRenderer.invoke('ariel:saveClipboardImage'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('ariel:normalizePreviewTarget', target, baseDir),
  watchPreviewFile: url => ipcRenderer.invoke('ariel:watchPreviewFile', url),
  watchDirectory: dir => ipcRenderer.invoke('ariel:watchDirectory', dir),
  stopPreviewFileWatch: id => ipcRenderer.invoke('ariel:stopPreviewFileWatch', id),
  setActiveWork: payload => ipcRenderer.send('ariel:active-work', payload),
  setTitleBarTheme: payload => ipcRenderer.send('ariel:titlebar-theme', payload),
  setNativeTheme: mode => ipcRenderer.send('ariel:native-theme', mode),
  setTranslucency: payload => ipcRenderer.send('ariel:translucency', payload),
  setKeepAwake: on => ipcRenderer.send('ariel:keep-awake', on),
  setDisableF12: blocked => ipcRenderer.send('ariel:devtools:disable-f12', blocked),
  setPreviewShortcutActive: active => ipcRenderer.send('ariel:previewShortcutActive', Boolean(active)),
  openExternal: url => ipcRenderer.invoke('ariel:openExternal', url),
  mcpOauth: {
    // One-shot loopback listener for MCP OAuth against remote backends: bind
    // on this machine, hand redirectUri to mcp.servers.oauth.start, then wait
    // for the provider redirect and relay code/state via oauth.callback.
    listen: () => ipcRenderer.invoke('ariel:mcp-oauth:listen'),
    wait: (id, timeoutMs) => ipcRenderer.invoke('ariel:mcp-oauth:wait', id, timeoutMs),
    cancel: id => ipcRenderer.invoke('ariel:mcp-oauth:cancel', id)
  },
  openPreviewInBrowser: url => ipcRenderer.invoke('ariel:openPreviewInBrowser', url),
  reachPreviewUrl: url => ipcRenderer.invoke('ariel:preview:reach', url),
  setActiveConnectionRoute: route => ipcRenderer.send('ariel:connection:active-route', route),
  fetchLinkTitle: url => ipcRenderer.invoke('ariel:fetchLinkTitle', url),
  resolveFavicon: url => ipcRenderer.invoke('ariel:resolveFavicon', url),
  sanitizeWorkspaceCwd: cwd => ipcRenderer.invoke('ariel:workspace:sanitize', cwd),
  settings: {
    getDefaultProjectDir: () => ipcRenderer.invoke('ariel:setting:defaultProjectDir:get'),
    setDefaultProjectDir: dir => ipcRenderer.invoke('ariel:setting:defaultProjectDir:set', dir),
    pickDefaultProjectDir: () => ipcRenderer.invoke('ariel:setting:defaultProjectDir:pick')
  },
  zoom: {
    // Current zoom of this window, as { level, percent }.
    get: () => ipcRenderer.invoke('ariel:zoom:get'),
    // Synchronous zoom factor (1 = 100%). Coordinate math needs it in the
    // same tick as the event it converts, so no IPC round-trip here.
    factor: () => webFrame.getZoomFactor(),
    setPercent: percent => ipcRenderer.send('ariel:zoom:set-percent', percent),
    // Fires on every zoom change, including the Ctrl/Cmd +/-/0 shortcuts,
    // so the settings UI can stay in sync with the keyboard.
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('ariel:zoom:changed', listener)

      return () => ipcRenderer.removeListener('ariel:zoom:changed', listener)
    }
  },
  revealLogs: () => ipcRenderer.invoke('ariel:logs:reveal'),
  getRecentLogs: () => ipcRenderer.invoke('ariel:logs:recent'),
  // Fire-and-forget: persists a renderer error-boundary catch (with component
  // stack) to desktop.log so crashes survive the window (#79428).
  reportRendererError: report => ipcRenderer.send('ariel:logs:renderer-error', report),
  readDir: dirPath => ipcRenderer.invoke('ariel:fs:readDir', dirPath),
  gitRoot: startPath => ipcRenderer.invoke('ariel:fs:gitRoot', startPath),
  revealPath: targetPath => ipcRenderer.invoke('ariel:fs:reveal', targetPath),
  openDir: dirPath => ipcRenderer.invoke('ariel:fs:openDir', dirPath),
  desktopPluginsRoot: () => ipcRenderer.invoke('ariel:fs:desktopPluginsRoot'),
  logsRoot: () => ipcRenderer.invoke('ariel:fs:logsRoot'),
  agentPluginsRoot: () => ipcRenderer.invoke('ariel:fs:agentPluginsRoot'),
  renamePath: (targetPath, newName) => ipcRenderer.invoke('ariel:fs:rename', targetPath, newName),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('ariel:fs:writeText', filePath, content),
  trashPath: targetPath => ipcRenderer.invoke('ariel:fs:trash', targetPath),
  git: {
    worktreeList: repoPath => ipcRenderer.invoke('ariel:git:worktreeList', repoPath),
    worktreeAdd: (repoPath, options) => ipcRenderer.invoke('ariel:git:worktreeAdd', repoPath, options),
    worktreeRemove: (repoPath, worktreePath, options) =>
      ipcRenderer.invoke('ariel:git:worktreeRemove', repoPath, worktreePath, options),
    branchSwitch: (repoPath, branch) => ipcRenderer.invoke('ariel:git:branchSwitch', repoPath, branch),
    branchList: repoPath => ipcRenderer.invoke('ariel:git:branchList', repoPath),
    baseBranchList: repoPath => ipcRenderer.invoke('ariel:git:baseBranchList', repoPath),
    repoStatus: repoPath => ipcRenderer.invoke('ariel:git:repoStatus', repoPath),
    fileDiff: (repoPath, filePath) => ipcRenderer.invoke('ariel:git:fileDiff', repoPath, filePath),
    scanRepos: (roots, options) => ipcRenderer.invoke('ariel:git:scanRepos', roots, options),
    review: {
      list: (repoPath, scope, baseRef) => ipcRenderer.invoke('ariel:git:review:list', repoPath, scope, baseRef),
      diff: (repoPath, filePath, scope, baseRef, staged) =>
        ipcRenderer.invoke('ariel:git:review:diff', repoPath, filePath, scope, baseRef, staged),
      stage: (repoPath, filePath) => ipcRenderer.invoke('ariel:git:review:stage', repoPath, filePath),
      unstage: (repoPath, filePath) => ipcRenderer.invoke('ariel:git:review:unstage', repoPath, filePath),
      revert: (repoPath, filePath) => ipcRenderer.invoke('ariel:git:review:revert', repoPath, filePath),
      revParse: (repoPath, ref) => ipcRenderer.invoke('ariel:git:review:revParse', repoPath, ref),
      commit: (repoPath, message, push) => ipcRenderer.invoke('ariel:git:review:commit', repoPath, message, push),
      commitContext: repoPath => ipcRenderer.invoke('ariel:git:review:commitContext', repoPath),
      push: repoPath => ipcRenderer.invoke('ariel:git:review:push', repoPath),
      shipInfo: repoPath => ipcRenderer.invoke('ariel:git:review:shipInfo', repoPath),
      prList: (repoPath, branches, numbers) =>
        ipcRenderer.invoke('ariel:git:review:prList', repoPath, branches, numbers),
      fetchPrComment: (repoPath, url) => ipcRenderer.invoke('ariel:git:review:fetchPrComment', repoPath, url),
      createPr: repoPath => ipcRenderer.invoke('ariel:git:review:createPr', repoPath)
    }
  },
  terminal: {
    cwd: id => ipcRenderer.invoke('ariel:terminal:cwd', id),
    dispose: id => ipcRenderer.invoke('ariel:terminal:dispose', id),
    resize: (id, size) => ipcRenderer.invoke('ariel:terminal:resize', id, size),
    start: options => ipcRenderer.invoke('ariel:terminal:start', options),
    write: (id, data) => ipcRenderer.invoke('ariel:terminal:write', id, data),
    onData: (id, callback) => {
      const channel = `ariel:terminal:${id}:data`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id, callback) => {
      const channel = `ariel:terminal:${id}:exit`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  onClosePreviewRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('ariel:close-preview-requested', listener)

    return () => ipcRenderer.removeListener('ariel:close-preview-requested', listener)
  },
  onPreviewNav: callback => {
    const listener = (_event, command) => callback(command)
    ipcRenderer.on('ariel:preview-nav', listener)

    return () => ipcRenderer.removeListener('ariel:preview-nav', listener)
  },
  onOpenFolderRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('ariel:open-folder-requested', listener)

    return () => ipcRenderer.removeListener('ariel:open-folder-requested', listener)
  },
  onOpenUpdatesRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('ariel:open-updates', listener)

    return () => ipcRenderer.removeListener('ariel:open-updates', listener)
  },
  onDeepLink: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('ariel:deep-link', listener)

    return () => ipcRenderer.removeListener('ariel:deep-link', listener)
  },
  signalDeepLinkReady: () => ipcRenderer.invoke('ariel:deep-link-ready'),
  probePluginRepo: payload => ipcRenderer.invoke('ariel:plugin:probe', payload),
  installDesktopPlugin: payload => ipcRenderer.invoke('ariel:plugin:installDesktop', payload),
  onWindowStateChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('ariel:window-state-changed', listener)

    return () => ipcRenderer.removeListener('ariel:window-state-changed', listener)
  },
  onFocusSession: callback => {
    const listener = (_event, sessionId) => callback(sessionId)
    ipcRenderer.on('ariel:focus-session', listener)

    return () => ipcRenderer.removeListener('ariel:focus-session', listener)
  },
  onNotificationAction: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('ariel:notification-action', listener)

    return () => ipcRenderer.removeListener('ariel:notification-action', listener)
  },
  onNotificationActivate: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('ariel:notification-activate', listener)

    return () => ipcRenderer.removeListener('ariel:notification-activate', listener)
  },
  onPreviewFileChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('ariel:preview-file-changed', listener)

    return () => ipcRenderer.removeListener('ariel:preview-file-changed', listener)
  },
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('ariel:backend-exit', listener)

    return () => ipcRenderer.removeListener('ariel:backend-exit', listener)
  },
  // Soft gateway-mode apply finished tearing down the primary backend. Renderer
  // should wipe session lists + re-dial without a window reload.
  onConnectionApplied: callback => {
    const listener = () => callback()
    ipcRenderer.on('ariel:connection:applied', listener)

    return () => ipcRenderer.removeListener('ariel:connection:applied', listener)
  },
  onPowerResume: callback => {
    const listener = () => callback()
    ipcRenderer.on('ariel:power-resume', listener)

    return () => ipcRenderer.removeListener('ariel:power-resume', listener)
  },
  // AC ↔ battery transitions; renderers slow their backstop polls on battery.
  getOnBattery: () => ipcRenderer.invoke('ariel:power-battery:get'),
  onBatteryChanged: callback => {
    const listener = (_event, onBattery) => callback(Boolean(onBattery))
    ipcRenderer.on('ariel:power-battery', listener)

    return () => ipcRenderer.removeListener('ariel:power-battery', listener)
  },
  onBootProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('ariel:boot-progress', listener)

    return () => ipcRenderer.removeListener('ariel:boot-progress', listener)
  },
  // First-launch bootstrap progress -- emitted by the install.ps1 stage
  // runner in main.ts (apps/desktop/electron/bootstrap-runner.ts).
  // Renderer's install overlay subscribes to live events and queries the
  // current snapshot via getBootstrapState() to recover after a devtools
  // reload mid-bootstrap.
  getBootstrapState: () => ipcRenderer.invoke('ariel:bootstrap:get'),
  continueBootstrapLocal: () => ipcRenderer.invoke('ariel:bootstrap:continue-local'),
  resetBootstrap: () => ipcRenderer.invoke('ariel:bootstrap:reset'),
  repairBootstrap: () => ipcRenderer.invoke('ariel:bootstrap:repair'),
  cancelBootstrap: () => ipcRenderer.invoke('ariel:bootstrap:cancel'),
  onBootstrapEvent: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('ariel:bootstrap:event', listener)

    return () => ipcRenderer.removeListener('ariel:bootstrap:event', listener)
  },
  getVersion: () => ipcRenderer.invoke('ariel:version'),
  getRemoteDisplayReason: () => ipcRenderer.invoke('ariel:get-remote-display-reason'),
  uninstall: {
    summary: () => ipcRenderer.invoke('ariel:uninstall:summary'),
    run: mode => ipcRenderer.invoke('ariel:uninstall:run', { mode })
  },
  updates: {
    check: () => ipcRenderer.invoke('ariel:updates:check'),
    apply: opts => ipcRenderer.invoke('ariel:updates:apply', opts),
    getBranch: () => ipcRenderer.invoke('ariel:updates:branch:get'),
    setBranch: name => ipcRenderer.invoke('ariel:updates:branch:set', name),
    onProgress: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('ariel:updates:progress', listener)

      return () => ipcRenderer.removeListener('ariel:updates:progress', listener)
    }
  },
  themes: {
    fetchMarketplace: id => ipcRenderer.invoke('ariel:vscode-theme:fetch', id),
    searchMarketplace: query => ipcRenderer.invoke('ariel:vscode-theme:search', query)
  },
  // Find-in-page (Ctrl/Cmd+F): delegates to Electron's
  // webContents.findInPage on the IPC sender's window so a Cmd+F pressed
  // in a secondary session window searches THAT window, not the primary.
  // `onFoundInPage` returns the unsubscribe fn; the renderer wires it via
  // `initFindInPageListener` in store/find-in-page.ts and tears it down
  // when the FindBar unmounts.
  findInPage: (query, options) => ipcRenderer.invoke('ariel:find-in-page', query, options),
  stopFindInPage: () => ipcRenderer.invoke('ariel:stop-find-in-page'),
  onFoundInPage: callback => {
    const listener = (_event, result) => callback(result)
    ipcRenderer.on('ariel:found-in-page', listener)

    return () => ipcRenderer.removeListener('ariel:found-in-page', listener)
  },
  // Main-process `before-input-event` forwards Ctrl/Cmd+F here so renderer
  // can open the FindBar even when the GTK compositor has already grabbed
  // the chord at the windowing layer (#81727).
  onOpenFindBarRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('ariel:open-find-bar', listener)

    return () => ipcRenderer.removeListener('ariel:open-find-bar', listener)
  }
})
