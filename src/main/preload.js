const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // --- Database setup & health ---
  db: {
    status:    ()       => ipcRenderer.invoke('db:status'),
    test:      (config) => ipcRenderer.invoke('db:test', config),
    connect:   (config) => ipcRenderer.invoke('db:connect', config),
    reconnect: ()       => ipcRenderer.invoke('db:reconnect'),
    reset:     ()       => ipcRenderer.invoke('db:reset'),
  },

  // --- Auth ---
  auth: {
    login:          (u, p)        => ipcRenderer.invoke('auth:login', u, p),
    changePassword: (id, old, nw) => ipcRenderer.invoke('auth:changePassword', id, old, nw),
  },

  // --- Patients ---
  patients: {
    getAll:  (filters) => ipcRenderer.invoke('patients:getAll', filters),
    getById: (id)      => ipcRenderer.invoke('patients:getById', id),
    create:  (data)    => ipcRenderer.invoke('patients:create', data),
    update:  (id, d)   => ipcRenderer.invoke('patients:update', id, d),
    delete:  (id)      => ipcRenderer.invoke('patients:delete', id),
    search:  (q)       => ipcRenderer.invoke('patients:search', q),
  },

  // --- Imaging (flat — images link directly to patient, no study abstraction) ---
  imaging: {
    getImages:       (patientId)           => ipcRenderer.invoke('imaging:getImages', patientId),
    getImage:        (instanceId)          => ipcRenderer.invoke('imaging:getImage', instanceId),
    importImage:     (patientId, fp, meta) => ipcRenderer.invoke('imaging:importImage', patientId, fp, meta),
    deleteImage:     (instanceId)          => ipcRenderer.invoke('imaging:deleteImage', instanceId),
    saveAnnotations: (instanceId, ann)     => ipcRenderer.invoke('imaging:saveAnnotations', instanceId, ann),
  },

  // --- File dialogs ---
  dialog: {
    openFile:      (opts) => ipcRenderer.invoke('dialog:openFile', opts),
    saveFile:      (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
    openDirectory: (opts) => ipcRenderer.invoke('dialog:openDirectory', opts),
    showMessage:   (opts) => ipcRenderer.invoke('dialog:showMessage', opts),
  },

  // --- License ---
  license: {
    getStatus:  ()    => ipcRenderer.invoke('license:getStatus'),
    activate:   (key) => ipcRenderer.invoke('license:activate', key),
    deactivate: ()    => ipcRenderer.invoke('license:deactivate'),
    validate:   ()    => ipcRenderer.invoke('license:validate'),
  },

  // --- Settings ---
  settings: {
    get:    (key)        => ipcRenderer.invoke('settings:get', key),
    set:    (key, value) => ipcRenderer.invoke('settings:set', key, value),
    getAll: ()           => ipcRenderer.invoke('settings:getAll'),
  },

  // --- Users ---
  users: {
    getAll: ()     => ipcRenderer.invoke('users:getAll'),
    create: (data) => ipcRenderer.invoke('users:create', data),
  },

  // --- App ---
  app: {
    getVersion:        () => ipcRenderer.invoke('app:getVersion'),
    getPlatform:       () => process.platform,
    getInstallType:    () => ipcRenderer.invoke('app:getInstallType'),
    quit:              () => ipcRenderer.invoke('app:quit'),
    installUpdate:     () => ipcRenderer.invoke('app:installUpdate'),
    openLogsDirectory: () => ipcRenderer.invoke('app:openLogsDirectory'),
  },

  // --- Audit log ---
  audit: {
    getLogs:    (filters)    => ipcRenderer.invoke('audit:getLogs', filters),
    exportLogs: (outputPath) => ipcRenderer.invoke('audit:exportLogs', outputPath),
  },

  // --- Events from main → renderer ---
  on: (channel, callback) => {
    const allowed = [
      'menu:new-patient', 'menu:open-patient', 'menu:import-dicom',
      'menu:export-jpeg', 'menu:export-png', 'menu:export-pdf',
      'menu:license-info', 'menu:about', 'menu:db-settings',
      'viewer:zoom-in', 'viewer:zoom-out', 'viewer:fit',
      'update:available', 'update:downloaded',
      'license:expired', 'license:warning',
    ];
    if (!allowed.includes(channel)) return;
    const sub = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, sub);
    return () => ipcRenderer.removeListener(channel, sub);
  },
});