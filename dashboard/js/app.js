// KidShield Dashboard Logic & Real-Time Sync Controller

let currentDevice = null;
let ws = null;
let map = null;
let childMarker = null;
let geofenceCircles = [];

let isLiveMirrorMode = true;
let isLiveMonitoringEnabled = true;
let isAutoStreamActive = true;
let autoStreamInterval = null;
let isScreenFetching = false;

// DOM Elements
const elements = {
  childNameDisplay: document.getElementById('childNameDisplay'),
  deviceModelDisplay: document.getElementById('deviceModelDisplay'),
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  batteryPill: document.getElementById('batteryPill'),
  screenTimePill: document.getElementById('screenTimePill'),
  remoteLockToggle: document.getElementById('remoteLockToggle'),
  lockStateIcon: document.getElementById('lockStateIcon'),
  lockStatusNote: document.getElementById('lockStatusNote'),
  btnRingAlarm: document.getElementById('btnRingAlarm'),
  sosAlertBanner: document.getElementById('sosAlertBanner'),
  alertTitle: document.getElementById('alertTitle'),
  alertBody: document.getElementById('alertBody'),
  dismissAlertBtn: document.getElementById('dismissAlertBtn'),
  overviewAppList: document.getElementById('overviewAppList'),
  activityTimeline: document.getElementById('activityTimeline'),
  screenTimeHours: document.getElementById('screenTimeHours'),
  screenTimeProgressBar: document.getElementById('screenTimeProgressBar'),
  screenTimeRemainingText: document.getElementById('screenTimeRemainingText'),
  currentAppName: document.getElementById('currentAppName'),
  geofenceStatusText: document.getElementById('geofenceStatusText'),
  lastLocationTime: document.getElementById('lastLocationTime'),
  overviewAddress: document.getElementById('overviewAddress'),
  dailyLimitSlider: document.getElementById('dailyLimitSlider'),
  dailyLimitLabel: document.getElementById('dailyLimitLabel'),
  saveDailyLimitBtn: document.getElementById('saveDailyLimitBtn'),
  appsManagementTable: document.getElementById('appsManagementTable'),
  geofenceList: document.getElementById('geofenceList'),
  blockedDomainsList: document.getElementById('blockedDomainsList'),
  newBlockDomainInput: document.getElementById('newBlockDomainInput'),
  btnAddDomainBtn: document.getElementById('btnAddDomainBtn'),
  toastContainer: document.getElementById('toastContainer'),
  mapCoordinates: document.getElementById('mapCoordinates'),
  btnRefreshLocation: document.getElementById('btnRefreshLocation'),
  mapAddressVal: document.getElementById('mapAddressVal'),
  modalAddSafeZone: document.getElementById('modalAddSafeZone'),
  btnAddZone: document.getElementById('btnAddZone'),
  btnCloseZoneModal: document.getElementById('btnCloseZoneModal'),
  btnCancelZone: document.getElementById('btnCancelZone'),
  btnSaveZone: document.getElementById('btnSaveZone'),
  inputZoneName: document.getElementById('inputZoneName'),
  inputZoneLat: document.getElementById('inputZoneLat'),
  inputZoneLng: document.getElementById('inputZoneLng'),
  inputZoneRadius: document.getElementById('inputZoneRadius'),
  zoneRadiusVal: document.getElementById('zoneRadiusVal'),
  btnUseCurrentCoord: document.getElementById('btnUseCurrentCoord'),
  
  // Live Mirror & Simulator elements
  liveDeviceScreenContainer: document.getElementById('liveDeviceScreenContainer'),
  liveDeviceScreenImg: document.getElementById('liveDeviceScreenImg'),
  virtualSimContainer: document.getElementById('virtualSimContainer'),
  tabModeLiveMirror: document.getElementById('tabModeLiveMirror'),
  tabModeVirtualSim: document.getElementById('tabModeVirtualSim'),
  btnRefreshScreen: document.getElementById('btnRefreshScreen'),
  btnToggleAutoStream: document.getElementById('btnToggleAutoStream'),
  streamPlayIcon: document.getElementById('streamPlayIcon'),
  streamStatusText: document.getElementById('streamStatusText'),
  btnWakeScreen: document.getElementById('btnWakeScreen'),
  liveMirrorBadge: document.getElementById('liveMirrorBadge'),
  liveCurrentAppName: document.getElementById('liveCurrentAppName'),
  liveBatteryValue: document.getElementById('liveBatteryValue'),
  liveScreenTimeValue: document.getElementById('liveScreenTimeValue'),
  liveRestrictionStatus: document.getElementById('liveRestrictionStatus'),
  btnQuickLock: document.getElementById('btnQuickLock'),
  btnQuickSiren: document.getElementById('btnQuickSiren'),
  btnQuickBlockYoutube: document.getElementById('btnQuickBlockYoutube'),
  virtualPhoneLockOverlay: document.getElementById('virtualPhoneLockOverlay'),
  virtualBatteryText: document.getElementById('virtualBatteryText'),
  virtualAppName: document.getElementById('virtualAppName'),
  virtualAppIcon: document.getElementById('virtualAppIcon'),
  simLogContent: document.getElementById('simLogContent'),

  // Master Live Monitoring Toggle elements
  toggleLiveMonitoringMaster: document.getElementById('toggleLiveMonitoringMaster'),
  liveMonitoringToggleBar: document.querySelector('.live-monitoring-toggle-bar'),
  lmToggleIcon: document.getElementById('lmToggleIcon'),
  lmStatusChip: document.getElementById('lmStatusChip'),
  lmStatusSubtitle: document.getElementById('lmStatusSubtitle'),
  screenMonitoringPausedOverlay: document.getElementById('screenMonitoringPausedOverlay'),
  btnResumeLiveView: document.getElementById('btnResumeLiveView'),
  liveScreenOverlayTag: document.getElementById('liveScreenOverlayTag')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupEventListeners();
  connectWebSocket();
  fetchInitialDeviceData();
});

// Setup Navigation Tabs
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      navItems.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetTab = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
      document.getElementById(`pane-${targetTab}`).classList.add('active');

      // Update Top Page Heading
      const headings = {
        overview: { title: 'Dashboard Overview', sub: 'Real-time digital supervision & child well-being metrics' },
        apps: { title: 'App Limits & Screen Time Quota', sub: 'Manage app timers, study mode schedules, and game restrictions' },
        location: { title: 'Live GPS & Geofencing', sub: 'Accurate location tracking and safe zone entry/exit alerts' },
        webfilter: { title: 'Web & Content Safety', sub: 'Local DNS filtering, Google SafeSearch, and custom domain blacklist' },
        simulator: { title: 'Live Screen & Simulator', sub: 'Real-time live screen mirroring and interactive control lab for child device' }
      };
      if (headings[targetTab]) {
        document.getElementById('pageHeading').textContent = headings[targetTab].title;
        document.getElementById('pageSubHeading').textContent = headings[targetTab].sub;
      }

      // Handle Simulator Live Mirror Auto-Stream
      if (targetTab === 'simulator') {
        if (isLiveMonitoringEnabled && isLiveMirrorMode) {
          refreshLiveScreen();
          if (isAutoStreamActive) {
            startAutoStream();
          }
        }
      } else {
        stopAutoStream();
      }

      // Resize map when switching to location tab
      if (targetTab === 'location') {
        setTimeout(() => {
          if (!map) initMap();
          else map.invalidateSize();
        }, 150);
      }
    });
  });

  document.getElementById('viewAllAppsBtn')?.addEventListener('click', () => {
    document.querySelector('[data-tab="apps"]').click();
  });
}

// Fetch Initial Data via REST API
async function fetchInitialDeviceData() {
  try {
    const res = await fetch('/api/devices');
    const json = await res.json();
    if (json.success && json.data.length > 0) {
      currentDevice = json.data[0];
      renderAll();
    }
  } catch (err) {
    console.warn('API offline or initial fetch failed, using fallback mock data:', err);
  }
}

// Connect Real-Time WebSocket
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[KidShield WS] Connected to Cloud Sync Server');
    ws.send(JSON.stringify({ type: 'REGISTER_DASHBOARD' }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (e) {
      console.error('WS Parse error', e);
    }
  };

  ws.onclose = () => {
    console.log('[KidShield WS] Disconnected. Retrying in 3s...');
    setTimeout(connectWebSocket, 3000);
  };
}

// Handle Incoming Server Push Messages
function handleServerMessage(data) {
  switch (data.type) {
    case 'REGISTER_OK':
      if (data.devices && data.devices.length > 0) {
        currentDevice = data.devices[0];
        renderAll();
      }
      break;

    case 'DEVICE_UPDATED':
    case 'TELEMETRY_UPDATE':
      if (data.device) {
        currentDevice = data.device;
        renderAll();
      }
      break;

    case 'SOS_ALERT':
      showSosBanner(data);
      showToast('🚨 EMERGENCY SOS Alert received from ' + data.childName);
      break;

    default:
      break;
  }
}

// Setup Event Listeners
function setupEventListeners() {
  // Remote Lock Toggle Switch
  elements.remoteLockToggle.addEventListener('change', async (e) => {
    const shouldLock = e.target.checked;
    await sendRemoteCommand(shouldLock ? 'LOCK_DEVICE' : 'UNLOCK_DEVICE', {
      message: 'Dinner Time! Locked by Parent'
    });
    showToast(shouldLock ? '🔒 Device locked successfully' : '🔓 Device unlocked');
  });

  // Ring Siren
  elements.btnRingAlarm.addEventListener('click', async () => {
    await sendRemoteCommand('RING_ALARM');
    showToast('🔔 Emergency find-phone siren sounded on child device!');
    logSimulatorEvent('[Remote Command] RING_ALARM received -> playing siren at maximum volume');
  });

  // Dismiss SOS Banner
  elements.dismissAlertBtn.addEventListener('click', () => {
    elements.sosAlertBanner.classList.add('hidden');
  });

  // Daily Limit Slider
  elements.dailyLimitSlider.addEventListener('input', (e) => {
    const mins = parseInt(e.target.value);
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    elements.dailyLimitLabel.textContent = `${mins} Minutes (${hrs}h ${remMins.toString().padStart(2, '0')}m)`;
  });

  elements.saveDailyLimitBtn.addEventListener('click', async () => {
    const mins = parseInt(elements.dailyLimitSlider.value);
    await updateRules({ dailyLimitMinutes: mins });
    showToast('⏱️ Daily Screen Time limit updated to ' + mins + ' minutes');
  });

  // Add Blocked Domain
  elements.btnAddDomainBtn.addEventListener('click', () => {
    const domain = elements.newBlockDomainInput.value.trim().toLowerCase();
    if (!domain) return;
    if (!currentDevice.webFilter.customBlockedDomains.includes(domain)) {
      currentDevice.webFilter.customBlockedDomains.push(domain);
      updateRules({ webFilter: currentDevice.webFilter });
      renderBlockedDomains();
      elements.newBlockDomainInput.value = '';
      showToast(`🌐 Blocked website: ${domain}`);
    }
  });

  // Refresh Location from hardware GNSS & child device
  elements.btnRefreshLocation.addEventListener('click', async () => {
    if (!currentDevice) return;
    try {
      showToast('🛰️ Requesting live GNSS fix from child phone...');
      const res = await fetch(`/api/devices/${currentDevice.id}/refresh-location`, { method: 'POST' });
      const json = await res.json();
      if (json.success && json.location) {
        currentDevice.location = json.location;
        if (json.geofences) currentDevice.geofences = json.geofences;
        renderAll();
        if (map) {
          map.flyTo([json.location.lat, json.location.lng], 16, { duration: 1.2 });
        }
        showToast(`📍 Live Location Found: ${json.location.address || 'Shimla, HP'}`);
      } else {
        if (map && currentDevice.location) {
          map.flyTo([currentDevice.location.lat, currentDevice.location.lng], 16, { duration: 1.2 });
        }
        showToast('📍 Updated map view with latest coordinates');
      }
    } catch (e) {
      console.error('Refresh location error:', e);
      showToast('⚠️ Could not refresh location');
    }
  });

  // Modal: Add Safe Zone
  if (elements.btnAddZone) {
    elements.btnAddZone.addEventListener('click', () => {
      if (currentDevice?.location) {
        if (elements.inputZoneLat) elements.inputZoneLat.value = currentDevice.location.lat.toFixed(4);
        if (elements.inputZoneLng) elements.inputZoneLng.value = currentDevice.location.lng.toFixed(4);
      }
      if (elements.modalAddSafeZone) elements.modalAddSafeZone.classList.remove('hidden');
    });
  }

  if (elements.btnCloseZoneModal) {
    elements.btnCloseZoneModal.addEventListener('click', () => {
      if (elements.modalAddSafeZone) elements.modalAddSafeZone.classList.add('hidden');
    });
  }

  if (elements.btnCancelZone) {
    elements.btnCancelZone.addEventListener('click', () => {
      if (elements.modalAddSafeZone) elements.modalAddSafeZone.classList.add('hidden');
    });
  }

  if (elements.btnUseCurrentCoord) {
    elements.btnUseCurrentCoord.addEventListener('click', () => {
      if (currentDevice?.location) {
        if (elements.inputZoneLat) elements.inputZoneLat.value = currentDevice.location.lat.toFixed(4);
        if (elements.inputZoneLng) elements.inputZoneLng.value = currentDevice.location.lng.toFixed(4);
        showToast('📍 Loaded current child GPS coordinates');
      }
    });
  }

  if (elements.inputZoneRadius) {
    elements.inputZoneRadius.addEventListener('input', (e) => {
      if (elements.zoneRadiusVal) elements.zoneRadiusVal.textContent = e.target.value;
    });
  }

  if (elements.btnSaveZone) {
    elements.btnSaveZone.addEventListener('click', async () => {
      const name = elements.inputZoneName?.value.trim();
      const lat = parseFloat(elements.inputZoneLat?.value);
      const lng = parseFloat(elements.inputZoneLng?.value);
      const radius = parseInt(elements.inputZoneRadius?.value) || 300;

      if (!name) {
        showToast('⚠️ Please enter a Safe Zone name');
        return;
      }
      if (isNaN(lat) || isNaN(lng)) {
        showToast('⚠️ Please enter valid coordinates');
        return;
      }

      try {
        const res = await fetch(`/api/devices/${currentDevice.id}/geofences`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, lat, lng, radiusMeters: radius })
        });
        const json = await res.json();
        if (json.success && json.geofences) {
          currentDevice.geofences = json.geofences;
          renderGeofences();
          redrawGeofenceCircles();
          if (elements.modalAddSafeZone) elements.modalAddSafeZone.classList.add('hidden');
          if (elements.inputZoneName) elements.inputZoneName.value = '';
          showToast(`🛡️ Safe Zone created: ${name} (${radius}m)`);
        }
      } catch (err) {
        console.error('Error saving geofence:', err);
        showToast('⚠️ Failed to save Safe Zone');
      }
    });
  }

  // Simulation Controls
  setupSimulatorControls();
}

// Send Remote Command to Child
async function sendRemoteCommand(command, payload = {}) {
  if (!currentDevice) return;
  try {
    const res = await fetch(`/api/devices/${currentDevice.id}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, payload })
    });
    const json = await res.json();
    if (json.device) {
      currentDevice = json.device;
      renderAll();
    }
  } catch (err) {
    console.error('Command failed', err);
  }
}

// Update Rules (Limits / Filters)
async function updateRules(rules) {
  if (!currentDevice) return;
  try {
    const res = await fetch(`/api/devices/${currentDevice.id}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rules)
    });
    const json = await res.json();
    if (json.device) {
      currentDevice = json.device;
      renderAll();
    }
  } catch (err) {
    console.error('Update rules failed', err);
  }
}

// Render Complete UI
function renderAll() {
  if (!currentDevice) return;

  // Header & Meta
  elements.childNameDisplay.textContent = currentDevice.childName;
  elements.deviceModelDisplay.innerHTML = `${currentDevice.name} • <span class="status-dot online"></span> ${currentDevice.status}`;
  elements.batteryPill.textContent = `${currentDevice.battery}%`;
  elements.virtualBatteryText.textContent = `${currentDevice.battery}%`;

  // Remote Lock state
  elements.remoteLockToggle.checked = currentDevice.isLocked;
  elements.lockStateIcon.textContent = currentDevice.isLocked ? '🔒' : '🔓';
  elements.lockStatusNote.textContent = currentDevice.isLocked ? 'Phone is LOCKED by Parent' : 'Phone is currently unlocked';
  
  if (currentDevice.isLocked) {
    elements.virtualPhoneLockOverlay.classList.remove('hidden');
  } else {
    elements.virtualPhoneLockOverlay.classList.add('hidden');
  }

  // Screen Time Calculation
  const used = currentDevice.screenTimeTodayMinutes;
  const limit = currentDevice.dailyLimitMinutes;
  const hrs = Math.floor(used / 60);
  const mins = used % 60;
  elements.screenTimeHours.innerHTML = `${hrs}<span class="unit">h</span> ${mins}<span class="unit">m</span>`;
  elements.screenTimePill.textContent = `${hrs}h ${mins}m / ${Math.floor(limit / 60)}h`;

  const pct = Math.min(Math.round((used / limit) * 100), 100);
  elements.screenTimeProgressBar.style.width = `${pct}%`;
  
  const remaining = Math.max(0, limit - used);
  elements.screenTimeRemainingText.textContent = remaining > 0 ? `${remaining} mins remaining today` : 'Daily quota reached!';

  // Current Active App
  if (currentDevice.currentApp) {
    elements.currentAppName.textContent = currentDevice.currentApp.name;
    elements.virtualAppName.textContent = currentDevice.currentApp.name;
  }

  // Geofence & Location text
  if (currentDevice.location) {
    const lat = currentDevice.location.lat;
    const lng = currentDevice.location.lng;
    const acc = currentDevice.location.accuracy || 3.8;
    const addr = currentDevice.location.address || 'Bhorja, Nankhari, Shimla, Himachal Pradesh';
    
    if (elements.overviewAddress) elements.overviewAddress.textContent = addr;
    if (elements.mapCoordinates) elements.mapCoordinates.textContent = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)} (±${acc}m accuracy)`;
    const mapAddrEl = document.getElementById('mapAddressVal');
    if (mapAddrEl) mapAddrEl.textContent = addr;
  }
  
  const insideZone = currentDevice.geofences.find(g => g.status === 'inside');
  elements.geofenceStatusText.textContent = insideZone ? `Inside ${insideZone.name}` : 'Outside Safe Zones';

  // Live Activity Card Updates in Simulator Pane
  if (elements.liveCurrentAppName && currentDevice.currentApp) {
    const appName = currentDevice.currentApp.name || 'Active App';
    const appPkg = currentDevice.currentApp.package ? ` (${currentDevice.currentApp.package})` : '';
    elements.liveCurrentAppName.textContent = `${appName}${appPkg}`;
  }
  if (elements.liveBatteryValue) {
    elements.liveBatteryValue.textContent = `🔋 ${currentDevice.battery}% (Online)`;
  }
  if (elements.liveScreenTimeValue) {
    elements.liveScreenTimeValue.textContent = `⏱️ ${hrs}h ${mins}m`;
  }
  if (elements.liveRestrictionStatus) {
    if (currentDevice.isLocked) {
      elements.liveRestrictionStatus.textContent = '🔒 Device Locked';
      elements.liveRestrictionStatus.className = 'detail-value text-danger';
    } else {
      elements.liveRestrictionStatus.textContent = '🟢 Active Protection';
      elements.liveRestrictionStatus.className = 'detail-value text-success';
    }
  }
  if (elements.btnQuickLock) {
    elements.btnQuickLock.innerHTML = currentDevice.isLocked ? '<span>🔓</span> Instant Screen Unlock' : '<span>🔒</span> Instant Screen Lock';
  }
  if (elements.btnQuickBlockYoutube) {
    const ytApp = currentDevice.appLimits?.find(a => a.package === 'com.google.android.youtube');
    const isYtBlocked = ytApp ? ytApp.isBlocked : false;
    elements.btnQuickBlockYoutube.innerHTML = isYtBlocked ? '<span>✓</span> Allow YouTube' : '<span>🚫</span> Block YouTube';
  }

  // Render Sub-components
  renderOverviewApps();
  renderActivityTimeline();
  renderAppLimitsTable();
  renderGeofences();
  renderBlockedDomains();
  updateMapMarker();
}

// Render Top Apps in Overview
function renderOverviewApps() {
  if (!currentDevice?.appLimits) return;
  elements.overviewAppList.innerHTML = currentDevice.appLimits.map(app => {
    const isOver = app.usedMinutes >= app.limitMinutes && app.limitMinutes > 0;
    return `
      <div class="app-usage-item">
        <div class="app-info-left">
          <span class="app-icon-display">${app.icon || '📱'}</span>
          <div class="app-name-details">
            <strong>${app.name}</strong>
            <span>${app.category} • Limit: ${app.limitMinutes > 0 ? app.limitMinutes + 'm' : 'Unlimited'}</span>
          </div>
        </div>
        <div class="app-usage-stats">
          <strong>${app.usedMinutes}m</strong>
          ${app.isBlocked ? '<span class="app-badge-blocked">Blocked</span>' : ''}
          ${isOver ? '<span class="pill-badge-warning">Limit Reached</span>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Render Activity Timeline
function renderActivityTimeline() {
  if (!currentDevice?.activityLog) return;
  elements.activityTimeline.innerHTML = currentDevice.activityLog.map(act => `
    <div class="timeline-item">
      <div class="timeline-dot ${act.type}"></div>
      <div class="timeline-text">${act.text}</div>
      <span class="timeline-time">${act.time}</span>
    </div>
  `).join('');
}

// Render App Management Table in Tab 2
let appSearchFilter = '';

function renderAppLimitsTable() {
  if (!currentDevice?.appLimits) return;

  const countBadge = document.getElementById('totalAppsCountBadge');
  if (countBadge) {
    countBadge.textContent = `${currentDevice.appLimits.length} Apps Detected on Phone`;
  }

  const searchInput = document.getElementById('searchAppsInput');
  if (searchInput && !searchInput.dataset.listenerAttached) {
    searchInput.dataset.listenerAttached = 'true';
    searchInput.addEventListener('input', (e) => {
      appSearchFilter = e.target.value.toLowerCase().trim();
      renderAppLimitsTable();
    });
  }

  const filteredApps = currentDevice.appLimits
    .map((app, originalIdx) => ({ ...app, originalIdx }))
    .filter(app => {
      if (!appSearchFilter) return true;
      return app.name.toLowerCase().includes(appSearchFilter) || 
             app.package.toLowerCase().includes(appSearchFilter) ||
             (app.category && app.category.toLowerCase().includes(appSearchFilter));
    });

  if (filteredApps.length === 0) {
    elements.appsManagementTable.innerHTML = `
      <div style="text-align: center; padding: 30px; color: var(--text-muted);">
        No applications matching "<strong>${appSearchFilter}</strong>" found on child device.
      </div>
    `;
    return;
  }

  elements.appsManagementTable.innerHTML = filteredApps.map(app => `
    <div class="app-row">
      <div class="app-row-left">
        <span style="font-size: 24px;">${app.icon || '📱'}</span>
        <div>
          <strong>${app.name}</strong>
          <span style="font-size: 11px; color: var(--text-dim); display: block;">${app.package}</span>
        </div>
      </div>

      <div class="app-row-controls">
        <div class="limit-input-group">
          <span>Daily Timer:</span>
          <input type="number" min="0" max="300" step="5" value="${app.limitMinutes || 0}" data-idx="${app.originalIdx}" class="input-app-timer">
          <span>mins</span>
        </div>

        <label class="switch">
          <input type="checkbox" ${app.isBlocked ? 'checked' : ''} data-idx="${app.originalIdx}" class="toggle-app-block">
          <span class="slider round"></span>
        </label>
      </div>
    </div>
  `).join('');

  // Attach Table Listeners
  document.querySelectorAll('.input-app-timer').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const idx = parseInt(e.target.getAttribute('data-idx'));
      currentDevice.appLimits[idx].limitMinutes = parseInt(e.target.value) || 0;
      updateRules({ appLimits: currentDevice.appLimits });
      showToast(`Updated limit for ${currentDevice.appLimits[idx].name}`);
    });
  });

  document.querySelectorAll('.toggle-app-block').forEach(tog => {
    tog.addEventListener('change', async (e) => {
      const idx = parseInt(e.target.getAttribute('data-idx'));
      const app = currentDevice.appLimits[idx];
      if (!app) return;
      const isBlocked = e.target.checked;
      app.isBlocked = isBlocked;

      try {
        await fetch(`/api/devices/${currentDevice.id}/toggle-block`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ package: app.package, isBlocked: isBlocked })
        });
        showToast(`${app.name} is now ${isBlocked ? 'BLOCKED 🚫' : 'ALLOWED ✓'}`);
      } catch (err) {
        console.error('Toggle block failed:', err);
      }
    });
  });
}

// Render Geofence List
function renderGeofences() {
  if (!currentDevice?.geofences) return;
  elements.geofenceList.innerHTML = currentDevice.geofences.map(geo => {
    const isInside = geo.status === 'inside';
    const distText = geo.distanceMeters !== undefined 
      ? (isInside ? `Inside safe zone (${geo.distanceMeters}m from center)` : `${geo.distanceMeters > 1000 ? (geo.distanceMeters/1000).toFixed(1) + 'km' : geo.distanceMeters + 'm'} away`)
      : (isInside ? 'Inside safe boundary' : 'Outside boundary');

    return `
      <div class="geofence-card" style="display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; margin-bottom: 12px; background: ${isInside ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.03)'}; border: 1px solid ${isInside ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-glass)'}; border-radius: 12px;">
        <div class="geo-info">
          <div style="display: flex; align-items: center; gap: 8px;">
            <strong style="font-size: 15px; color: white;">${geo.name}</strong>
            <span style="padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; background: ${isInside ? 'rgba(16, 185, 129, 0.2)' : 'rgba(148, 163, 184, 0.2)'}; color: ${isInside ? '#34d399' : '#94a3b8'}; border: 1px solid ${isInside ? 'rgba(16, 185, 129, 0.4)' : 'rgba(148, 163, 184, 0.3)'};">
              ${isInside ? '🟢 INSIDE' : '⚪ OUTSIDE'}
            </span>
          </div>
          <span style="font-size: 12px; color: #94a3b8; margin-top: 4px; display: block;">Radius: ${geo.radiusMeters}m • ${distText}</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn-text btn-fly-zone" data-lat="${geo.lat}" data-lng="${geo.lng}" title="Fly to zone" style="font-size: 13px; color: #818cf8; cursor: pointer; border: none; background: none; font-weight: 600;">📍 Focus</button>
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.btn-fly-zone').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const lat = parseFloat(e.currentTarget.getAttribute('data-lat'));
      const lng = parseFloat(e.currentTarget.getAttribute('data-lng'));
      if (map && !isNaN(lat) && !isNaN(lng)) {
        map.flyTo([lat, lng], 16, { duration: 1 });
      }
    });
  });
}

// Render Blocked Domains
function renderBlockedDomains() {
  if (!currentDevice?.webFilter?.customBlockedDomains) return;
  elements.blockedDomainsList.innerHTML = currentDevice.webFilter.customBlockedDomains.map((domain, idx) => `
    <div class="domain-tag">
      <span>${domain}</span>
      <span class="btn-remove-tag" data-idx="${idx}">&times;</span>
    </div>
  `).join('');

  document.querySelectorAll('.btn-remove-tag').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-idx'));
      const removed = currentDevice.webFilter.customBlockedDomains.splice(idx, 1);
      updateRules({ webFilter: currentDevice.webFilter });
      renderBlockedDomains();
      showToast(`Removed ${removed} from blocklist`);
    });
  });
}

// Initialize Leaflet Map
function initMap() {
  if (map || !document.getElementById('map')) return;

  const lat = currentDevice?.location?.lat || 31.3051;
  const lng = currentDevice?.location?.lng || 77.5830;

  map = L.map('map').setView([lat, lng], 15);

  // Watermark-free OpenStreetMap tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  // Child Marker
  const childIcon = L.divIcon({
    className: 'child-map-pin',
    html: '<div style="font-size: 28px; filter: drop-shadow(0 0 10px rgba(99,102,241,0.9));">👦📍</div>',
    iconSize: [32, 32],
    iconAnchor: [16, 32]
  });

  const popupContent = `
    <div style="font-family: inherit; padding: 4px;">
      <b style="font-size: 14px; color: #1e293b;">👦 ${currentDevice?.childName || 'Child'}</b>
      <div style="font-size: 12px; color: #475569; margin-top: 4px;">📍 ${currentDevice?.location?.address || 'Bhorja, Nankhari, Shimla, HP'}</div>
      <div style="font-size: 11px; color: #64748b; margin-top: 2px;">GNSS: ${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
    </div>
  `;

  childMarker = L.marker([lat, lng], { icon: childIcon }).addTo(map)
    .bindPopup(popupContent)
    .openPopup();

  redrawGeofenceCircles();
}

function redrawGeofenceCircles() {
  if (!map) return;
  geofenceCircles.forEach(c => map.removeLayer(c));
  geofenceCircles = [];

  if (currentDevice?.geofences) {
    currentDevice.geofences.forEach(geo => {
      const isInside = geo.status === 'inside';
      const color = isInside ? '#10b981' : (geo.name.toLowerCase().includes('home') ? '#38bdf8' : '#818cf8');
      const circle = L.circle([geo.lat, geo.lng], {
        color: color,
        fillColor: color,
        fillOpacity: isInside ? 0.22 : 0.10,
        weight: isInside ? 3 : 1.5,
        radius: geo.radiusMeters
      }).addTo(map);
      
      const distInfo = geo.distanceMeters !== undefined ? ` • ${geo.distanceMeters}m away` : '';
      circle.bindTooltip(`<b>${geo.name}</b> (${geo.radiusMeters}m)${distInfo}`, { permanent: false, direction: 'top' });
      geofenceCircles.push(circle);
    });
  }
}

// Update Map Marker
function updateMapMarker() {
  if (!map || !currentDevice?.location) return;
  const { lat, lng, address } = currentDevice.location;
  if (!lat || !lng) return;

  if (!childMarker) {
    const childIcon = L.divIcon({
      className: 'child-map-pin',
      html: '<div style="font-size: 28px; filter: drop-shadow(0 0 10px rgba(99,102,241,0.9));">👦📍</div>',
      iconSize: [32, 32],
      iconAnchor: [16, 32]
    });
    childMarker = L.marker([lat, lng], { icon: childIcon }).addTo(map);
  } else {
    childMarker.setLatLng([lat, lng]);
  }

  childMarker.setPopupContent(`
    <div style="font-family: inherit; padding: 4px;">
      <b style="font-size: 14px; color: #1e293b;">👦 ${currentDevice.childName}</b>
      <div style="font-size: 12px; color: #475569; margin-top: 4px;">📍 ${address || 'Real-time Location'}</div>
      <div style="font-size: 11px; color: #64748b; margin-top: 2px;">GNSS: ${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
    </div>
  `);

  redrawGeofenceCircles();
}

// Live Phone Screen Streaming & Mirroring
function refreshLiveScreen() {
  if (!elements.liveDeviceScreenImg || !isLiveMirrorMode || !isLiveMonitoringEnabled) return;
  if (isScreenFetching) return;
  isScreenFetching = true;

  const deviceId = currentDevice?.id || 'child_01';
  const imgUrl = `/api/devices/${deviceId}/screen?t=${Date.now()}`;
  const preloader = new Image();
  preloader.onload = () => {
    if (elements.liveDeviceScreenImg && isLiveMonitoringEnabled) {
      elements.liveDeviceScreenImg.src = imgUrl;
    }
    isScreenFetching = false;
  };
  preloader.onerror = () => {
    isScreenFetching = false;
  };
  preloader.src = imgUrl;
}

function startAutoStream() {
  stopAutoStream();
  if (!isLiveMonitoringEnabled) return;
  autoStreamInterval = setInterval(() => {
    const simPane = document.getElementById('pane-simulator');
    if (simPane && simPane.classList.contains('active') && isLiveMirrorMode && isLiveMonitoringEnabled) {
      refreshLiveScreen();
    }
  }, 1800);
}

function stopAutoStream() {
  if (autoStreamInterval) {
    clearInterval(autoStreamInterval);
    autoStreamInterval = null;
  }
}

// Master Live Monitoring State Controller
function setLiveMonitoringState(enabled, showToastNotice = true) {
  isLiveMonitoringEnabled = enabled;
  if (elements.toggleLiveMonitoringMaster) {
    elements.toggleLiveMonitoringMaster.checked = enabled;
  }

  const bar = elements.liveMonitoringToggleBar || document.querySelector('.live-monitoring-toggle-bar');

  if (enabled) {
    bar?.classList.remove('monitoring-off');
    if (elements.lmToggleIcon) elements.lmToggleIcon.textContent = '📡';
    if (elements.lmStatusChip) {
      elements.lmStatusChip.className = 'lm-status-chip on';
      elements.lmStatusChip.textContent = '● STREAMING LIVE';
    }
    if (elements.lmStatusSubtitle) {
      elements.lmStatusSubtitle.textContent = 'Real-time screen capture from child device (Realme X2) is active.';
    }
    if (elements.liveMirrorBadge) {
      elements.liveMirrorBadge.className = 'badge-live-pulse';
      elements.liveMirrorBadge.innerHTML = '<span class="pulse-dot"></span> LIVE MIRROR';
    }
    elements.screenMonitoringPausedOverlay?.classList.add('hidden');
    elements.liveScreenOverlayTag?.classList.remove('hidden');
    if (elements.btnRefreshScreen) elements.btnRefreshScreen.disabled = false;
    if (elements.btnToggleAutoStream) {
      elements.btnToggleAutoStream.disabled = false;
      elements.btnToggleAutoStream.classList.toggle('btn-stream-active', isAutoStreamActive);
      if (elements.streamStatusText) elements.streamStatusText.textContent = isAutoStreamActive ? 'Auto-Stream: ON' : 'Auto-Stream: PAUSED';
    }

    refreshLiveScreen();
    if (isAutoStreamActive && isLiveMirrorMode) {
      startAutoStream();
    }
    if (showToastNotice) showToast('✅ Live screen monitoring resumed');
  } else {
    stopAutoStream();
    bar?.classList.add('monitoring-off');
    if (elements.lmToggleIcon) elements.lmToggleIcon.textContent = '⏸️';
    if (elements.lmStatusChip) {
      elements.lmStatusChip.className = 'lm-status-chip off';
      elements.lmStatusChip.textContent = '○ PAUSED / OFF';
    }
    if (elements.lmStatusSubtitle) {
      elements.lmStatusSubtitle.textContent = 'Live screen capture is temporarily turned OFF. Child privacy active.';
    }
    if (elements.liveMirrorBadge) {
      elements.liveMirrorBadge.className = 'badge-live-paused';
      elements.liveMirrorBadge.innerHTML = '⏸️ MONITORING OFF';
    }
    elements.screenMonitoringPausedOverlay?.classList.remove('hidden');
    elements.liveScreenOverlayTag?.classList.add('hidden');
    if (elements.btnRefreshScreen) elements.btnRefreshScreen.disabled = true;
    if (elements.btnToggleAutoStream) {
      elements.btnToggleAutoStream.disabled = true;
      elements.btnToggleAutoStream.classList.remove('btn-stream-active');
      if (elements.streamStatusText) elements.streamStatusText.textContent = 'Auto-Stream: OFF';
    }
    if (showToastNotice) showToast('🛑 Live screen monitoring turned OFF (Privacy active)');
  }
}

// Setup Simulator & Live Mirror Controls
function setupSimulatorControls() {
  // Master Live Monitoring Toggle Switch
  elements.toggleLiveMonitoringMaster?.addEventListener('change', (e) => {
    setLiveMonitoringState(e.target.checked);
  });

  // Resume Button on Standby Overlay
  elements.btnResumeLiveView?.addEventListener('click', () => {
    setLiveMonitoringState(true);
  });
  // Live Mirror Mode Toggle
  elements.tabModeLiveMirror?.addEventListener('click', () => {
    isLiveMirrorMode = true;
    elements.tabModeLiveMirror.classList.add('active');
    elements.tabModeVirtualSim.classList.remove('active');
    elements.liveDeviceScreenContainer?.classList.remove('hidden');
    elements.virtualSimContainer?.classList.add('hidden');
    if (elements.liveMirrorBadge) elements.liveMirrorBadge.style.display = 'inline-flex';
    refreshLiveScreen();
    if (isAutoStreamActive) startAutoStream();
  });

  // Virtual Sim Mode Toggle
  elements.tabModeVirtualSim?.addEventListener('click', () => {
    isLiveMirrorMode = false;
    elements.tabModeVirtualSim.classList.add('active');
    elements.tabModeLiveMirror.classList.remove('active');
    elements.liveDeviceScreenContainer?.classList.add('hidden');
    elements.virtualSimContainer?.classList.remove('hidden');
    if (elements.liveMirrorBadge) elements.liveMirrorBadge.style.display = 'none';
    stopAutoStream();
  });

  // Refresh Screen Button
  elements.btnRefreshScreen?.addEventListener('click', () => {
    refreshLiveScreen();
    showToast('📸 Phone screen refreshed');
  });

  // Toggle Auto-Stream Button
  elements.btnToggleAutoStream?.addEventListener('click', () => {
    isAutoStreamActive = !isAutoStreamActive;
    if (isAutoStreamActive) {
      elements.btnToggleAutoStream.classList.add('btn-stream-active');
      if (elements.streamPlayIcon) elements.streamPlayIcon.textContent = '⚡';
      if (elements.streamStatusText) elements.streamStatusText.textContent = 'Auto-Stream: ON';
      startAutoStream();
      showToast('⚡ Live screen auto-streaming enabled');
    } else {
      elements.btnToggleAutoStream.classList.remove('btn-stream-active');
      if (elements.streamPlayIcon) elements.streamPlayIcon.textContent = '⏸️';
      if (elements.streamStatusText) elements.streamStatusText.textContent = 'Auto-Stream: PAUSED';
      stopAutoStream();
      showToast('⏸️ Live screen auto-streaming paused');
    }
  });

  // Wake Phone Screen Button
  elements.btnWakeScreen?.addEventListener('click', async () => {
    const deviceId = currentDevice?.id || 'child_01';
    try {
      showToast('💡 Sending wake-up signal to phone...');
      await fetch(`/api/devices/${deviceId}/wake`, { method: 'POST' });
      setTimeout(refreshLiveScreen, 400);
      setTimeout(refreshLiveScreen, 1200);
    } catch (err) {
      console.error('Wake failed:', err);
    }
  });

  // ─── REMOTE CONTROL SETUP ──────────────────────────────────────────────────

  let isRemoteControlEnabled = true;
  let swipeStartX = null, swipeStartY = null, swipeStartNormX = null, swipeStartNormY = null;
  const SWIPE_THRESHOLD = 15; // px

  function sendRemoteTap(normX, normY) {
    const deviceId = currentDevice?.id || 'child_01';
    fetch(`/api/devices/${deviceId}/tap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: normX, y: normY, deviceWidth: 1080, deviceHeight: 2340 })
    }).then(r => r.json()).then(d => {
      if (d.success) showToast(`👆 Tapped (${d.x}, ${d.y}) on child phone`);
      setTimeout(refreshLiveScreen, 700);
    }).catch(e => console.error('Tap failed:', e));
  }

  function sendRemoteSwipe(nx1, ny1, nx2, ny2) {
    const deviceId = currentDevice?.id || 'child_01';
    fetch(`/api/devices/${deviceId}/swipe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x1: nx1, y1: ny1, x2: nx2, y2: ny2, duration: 300, deviceWidth: 1080, deviceHeight: 2340 })
    }).then(() => {
      showToast('👆 Swipe sent to child phone');
      setTimeout(refreshLiveScreen, 600);
    }).catch(e => console.error('Swipe failed:', e));
  }

  function sendRemoteKey(key) {
    const deviceId = currentDevice?.id || 'child_01';
    fetch(`/api/devices/${deviceId}/keyevent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    }).then(() => setTimeout(refreshLiveScreen, 600))
    .catch(e => console.error('Keyevent failed:', e));
  }

  function showRipple(el, clientX, clientY) {
    const rect = el.getBoundingClientRect();
    const ripple = document.getElementById('rcoRipple');
    if (!ripple) return;
    ripple.style.left = (clientX - rect.left) + 'px';
    ripple.style.top  = (clientY - rect.top) + 'px';
    ripple.classList.remove('animating');
    void ripple.offsetWidth; // reflow
    ripple.classList.add('animating');
    setTimeout(() => ripple.classList.remove('animating'), 500);
  }

  // Remote Control Toggle
  const rcToggle = document.getElementById('toggleRemoteControl');
  const rcOverlay = document.getElementById('remoteControlOverlay');
  const rcModeLabel = document.getElementById('rcModeLabel');

  rcToggle?.addEventListener('change', (e) => {
    isRemoteControlEnabled = e.target.checked;
    if (rcOverlay) {
      rcOverlay.classList.toggle('rc-disabled', !isRemoteControlEnabled);
      rcOverlay.style.cursor = isRemoteControlEnabled ? 'crosshair' : 'default';
    }
    if (rcModeLabel) {
      rcModeLabel.textContent = isRemoteControlEnabled ? '🖱️ Remote Control: ON' : '👁️ View Only Mode';
      rcModeLabel.style.color = isRemoteControlEnabled ? '#34d399' : '#94a3b8';
    }
    showToast(isRemoteControlEnabled ? '🖱️ Remote control enabled – click to tap on phone' : '👁️ View-only mode active');
  });

  // ── Click → Tap ────────────────────────────────────────────────────────────
  rcOverlay?.addEventListener('mousedown', (e) => {
    if (!isRemoteControlEnabled || !isLiveMirrorMode) return;
    const rect = rcOverlay.getBoundingClientRect();
    swipeStartX = e.clientX;
    swipeStartY = e.clientY;
    swipeStartNormX = (e.clientX - rect.left) / rect.width;
    swipeStartNormY = (e.clientY - rect.top) / rect.height;
    rcOverlay.classList.add('swiping');
  });

  rcOverlay?.addEventListener('mouseup', (e) => {
    if (!isRemoteControlEnabled || !isLiveMirrorMode || swipeStartX === null) return;
    const rect = rcOverlay.getBoundingClientRect();
    const dx = e.clientX - swipeStartX;
    const dy = e.clientY - swipeStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < SWIPE_THRESHOLD) {
      // Treat as tap
      const normX = (e.clientX - rect.left) / rect.width;
      const normY = (e.clientY - rect.top) / rect.height;
      showRipple(rcOverlay, e.clientX, e.clientY);
      sendRemoteTap(normX, normY);
    } else {
      // Treat as swipe
      const normX2 = (e.clientX - rect.left) / rect.width;
      const normY2 = (e.clientY - rect.top) / rect.height;
      showRipple(rcOverlay, e.clientX, e.clientY);
      sendRemoteSwipe(swipeStartNormX, swipeStartNormY, normX2, normY2);
    }
    rcOverlay.classList.remove('swiping');
    swipeStartX = swipeStartY = swipeStartNormX = swipeStartNormY = null;
  });

  // Cancel drag if mouse leaves overlay
  rcOverlay?.addEventListener('mouseleave', () => {
    rcOverlay.classList.remove('swiping');
    swipeStartX = swipeStartY = swipeStartNormX = swipeStartNormY = null;
  });

  // ── Touch support (mobile dashboard) ──────────────────────────────────────
  rcOverlay?.addEventListener('touchstart', (e) => {
    if (!isRemoteControlEnabled || !isLiveMirrorMode) return;
    const t = e.touches[0];
    const rect = rcOverlay.getBoundingClientRect();
    swipeStartX = t.clientX; swipeStartY = t.clientY;
    swipeStartNormX = (t.clientX - rect.left) / rect.width;
    swipeStartNormY = (t.clientY - rect.top) / rect.height;
  }, { passive: true });

  rcOverlay?.addEventListener('touchend', (e) => {
    if (!isRemoteControlEnabled || !isLiveMirrorMode || swipeStartX === null) return;
    const t = e.changedTouches[0];
    const rect = rcOverlay.getBoundingClientRect();
    const dx = t.clientX - swipeStartX;
    const dy = t.clientY - swipeStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < SWIPE_THRESHOLD) {
      const normX = (t.clientX - rect.left) / rect.width;
      const normY = (t.clientY - rect.top) / rect.height;
      showRipple(rcOverlay, t.clientX, t.clientY);
      sendRemoteTap(normX, normY);
    } else {
      const normX2 = (t.clientX - rect.left) / rect.width;
      const normY2 = (t.clientY - rect.top) / rect.height;
      sendRemoteSwipe(swipeStartNormX, swipeStartNormY, normX2, normY2);
    }
    swipeStartX = swipeStartY = null;
  }, { passive: true });

  // ── Android Nav Keys ──────────────────────────────────────────────────────
  document.getElementById('rcBtnBack')?.addEventListener('click', () => {
    sendRemoteKey('BACK');
    showToast('← Back pressed on child phone');
  });
  document.getElementById('rcBtnHome')?.addEventListener('click', () => {
    sendRemoteKey('HOME');
    showToast('⌂ Home pressed on child phone');
  });
  document.getElementById('rcBtnRecents')?.addEventListener('click', () => {
    sendRemoteKey('RECENTS');
    showToast('⧉ Recents pressed on child phone');
  });

  // ── Volume + Screenshot Buttons ───────────────────────────────────────────
  document.getElementById('rcBtnVolUp')?.addEventListener('click', () => {
    sendRemoteKey('VOLUME_UP');
    showToast('🔊 Volume Up sent');
  });
  document.getElementById('rcBtnVolDown')?.addEventListener('click', () => {
    sendRemoteKey('VOLUME_DOWN');
    showToast('🔉 Volume Down sent');
  });
  document.getElementById('rcBtnScreenshot')?.addEventListener('click', async () => {
    sendRemoteKey('SCREENSHOT');
    showToast('📷 Screenshot taken on child phone');
    setTimeout(refreshLiveScreen, 1200);
  });

  // ── Keyboard Toggle ───────────────────────────────────────────────────────
  const rcKeyboardBar = document.getElementById('rcKeyboardBar');
  const rcBtnKeyboard = document.getElementById('rcBtnKeyboard');
  rcBtnKeyboard?.addEventListener('click', () => {
    const isVisible = !rcKeyboardBar.classList.contains('hidden');
    rcKeyboardBar.classList.toggle('hidden', isVisible);
    rcBtnKeyboard.classList.toggle('active', !isVisible);
    if (!isVisible) document.getElementById('rcTypeInput')?.focus();
  });

  // ── Send Text ─────────────────────────────────────────────────────────────
  function sendRemoteText(text) {
    const deviceId = currentDevice?.id || 'child_01';
    fetch(`/api/devices/${deviceId}/type`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    }).then(() => showToast(`⌨️ Sent: "${text}"`))
    .catch(e => console.error('Type failed:', e));
  }

  document.getElementById('rcBtnSendText')?.addEventListener('click', () => {
    const input = document.getElementById('rcTypeInput');
    if (!input?.value.trim()) return;
    sendRemoteText(input.value.trim());
    input.value = '';
    input.focus();
  });

  document.getElementById('rcTypeInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const input = e.target;
      if (input.value.trim()) {
        sendRemoteText(input.value.trim());
        input.value = '';
      } else {
        sendRemoteKey('ENTER');
      }
    }
  });

  document.getElementById('rcBtnDelete')?.addEventListener('click', () => sendRemoteKey('DELETE'));
  document.getElementById('rcBtnEnter')?.addEventListener('click', () => sendRemoteKey('ENTER'));

  // ─── END REMOTE CONTROL ────────────────────────────────────────────────────

  // Quick Action: Instant Lock
  elements.btnQuickLock?.addEventListener('click', async () => {
    if (!currentDevice) return;
    const shouldLock = !currentDevice.isLocked;
    await sendRemoteCommand(shouldLock ? 'LOCK_DEVICE' : 'UNLOCK_DEVICE', {
      message: 'Locked by Parent from Live Monitor'
    });
    showToast(shouldLock ? '🔒 Device locked remotely' : '🔓 Device unlocked');
    setTimeout(refreshLiveScreen, 1000);
  });

  // Quick Action: Ring Siren
  elements.btnQuickSiren?.addEventListener('click', async () => {
    await sendRemoteCommand('RING_ALARM');
    showToast('🔔 Emergency siren sounded on child phone!');
  });

  // Quick Action: Toggle YouTube Block
  elements.btnQuickBlockYoutube?.addEventListener('click', async () => {
    if (!currentDevice) return;
    const ytPkg = 'com.google.android.youtube';
    const ytApp = currentDevice.appLimits?.find(a => a.package === ytPkg);
    const currentlyBlocked = ytApp ? ytApp.isBlocked : false;
    const newBlockedState = !currentlyBlocked;
    
    if (ytApp) ytApp.isBlocked = newBlockedState;
    try {
      await fetch(`/api/devices/${currentDevice.id}/toggle-block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: ytPkg, isBlocked: newBlockedState })
      });
      showToast(`YouTube is now ${newBlockedState ? 'BLOCKED 🚫' : 'ALLOWED ✓'}`);
      renderAll();
      setTimeout(refreshLiveScreen, 1500);
    } catch (err) {
      console.error('Failed to toggle YouTube block:', err);
    }
  });

  // Open Roblox Game (Virtual Sim)
  document.getElementById('simOpenRoblox')?.addEventListener('click', () => {
    if (!currentDevice) return;
    currentDevice.currentApp = { name: 'Roblox', package: 'com.roblox.client', category: 'Gaming' };
    currentDevice.screenTimeTodayMinutes += 5;
    elements.virtualAppName.textContent = 'Roblox';
    elements.virtualAppIcon.textContent = '🎮';
    logSimulatorEvent('[App Switched] Foreground Package: com.roblox.client (Roblox)');
    syncTelemetryToBackend();
    renderAll();
    showToast('Child launched Roblox');
  });

  // Open Instagram (Blocked)
  document.getElementById('simOpenInstagram')?.addEventListener('click', () => {
    logSimulatorEvent('[Access Denied] com.instagram.android is BLOCKED by Parent -> Overlay Triggered');
    elements.virtualPhoneLockOverlay.classList.remove('hidden');
    document.getElementById('virtualLockReason').textContent = 'Instagram is blocked by your parent.';
    showToast('⚠️ Child attempted to open blocked app: Instagram');
  });

  // Move to School (Nankhari)
  document.getElementById('simMoveToSchool')?.addEventListener('click', () => {
    if (!currentDevice) return;
    currentDevice.location = {
      lat: 31.3090,
      lng: 77.5890,
      accuracy: 4,
      timestamp: new Date().toISOString(),
      address: 'Govt Model School Nankhari, Shimla, Himachal Pradesh'
    };
    if (currentDevice.geofences && currentDevice.geofences.length >= 2) {
      currentDevice.geofences[0].status = 'outside';
      currentDevice.geofences[0].distanceMeters = 720;
      currentDevice.geofences[1].status = 'inside';
      currentDevice.geofences[1].distanceMeters = 20;
    }
    currentDevice.activityLog.unshift({
      id: 'act_' + Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'geofence',
      text: 'Arrived at Safe Zone: Govt Model School Nankhari'
    });
    logSimulatorEvent('[Geofence Trigger] Entered Safe Zone: Govt Model School Nankhari (31.3090, 77.5890)');
    syncTelemetryToBackend();
    renderAll();
    if (map) map.flyTo([31.3090, 77.5890], 16, { duration: 1 });
    showToast('📍 Child arrived at Govt Model School Nankhari');
  });

  // Return to Home (Bhorja)
  document.getElementById('simMoveToHome')?.addEventListener('click', () => {
    if (!currentDevice) return;
    currentDevice.location = {
      lat: 31.3051,
      lng: 77.5830,
      accuracy: 3.8,
      timestamp: new Date().toISOString(),
      address: 'Bhorja, Nankhari, Shimla, Himachal Pradesh, India'
    };
    if (currentDevice.geofences && currentDevice.geofences.length >= 2) {
      currentDevice.geofences[0].status = 'inside';
      currentDevice.geofences[0].distanceMeters = 0;
      currentDevice.geofences[1].status = 'outside';
      currentDevice.geofences[1].distanceMeters = 720;
    }
    currentDevice.activityLog.unshift({
      id: 'act_' + Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'geofence',
      text: 'Arrived at Safe Zone: Home (Bhorja)'
    });
    logSimulatorEvent('[Geofence Trigger] Returned to Safe Zone: Home (Bhorja) (31.3051, 77.5830)');
    syncTelemetryToBackend();
    renderAll();
    if (map) map.flyTo([31.3051, 77.5830], 16, { duration: 1 });
    showToast('🏡 Child returned to Safe Zone: Home (Bhorja)');
  });

  // Trigger SOS Panic
  document.getElementById('simTriggerSos')?.addEventListener('click', async () => {
    if (!currentDevice) return;
    await fetch(`/api/devices/${currentDevice.id}/sos`, { method: 'POST' });
    logSimulatorEvent('[CRITICAL] SOS Panic Triggered by child on Android Client!');
  });

  // Drop Battery
  document.getElementById('simBatteryLow')?.addEventListener('click', () => {
    if (!currentDevice) return;
    currentDevice.battery = 12;
    elements.virtualBatteryText.textContent = '12%';
    logSimulatorEvent('[Battery Alert] Battery level dropped to 12% (Critical)');
    syncTelemetryToBackend();
    renderAll();
    showToast('🪫 Warning: Child phone battery low (12%)');
  });
}

function logSimulatorEvent(msg) {
  const box = elements.simLogContent;
  if (!box) return;
  const time = new Date().toLocaleTimeString();
  box.innerHTML = `[${time}] ${msg}<br>` + box.innerHTML;
}

function syncTelemetryToBackend() {
  if (ws && ws.readyState === WebSocket.OPEN && currentDevice) {
    ws.send(JSON.stringify({
      type: 'TELEMETRY_UPDATE',
      deviceId: currentDevice.id,
      battery: currentDevice.battery,
      location: currentDevice.location,
      screenTimeTodayMinutes: currentDevice.screenTimeTodayMinutes,
      currentApp: currentDevice.currentApp
    }));
  }
}

// Show SOS Alert Banner
function showSosBanner(data) {
  elements.sosAlertBanner.classList.remove('hidden');
  elements.alertTitle.textContent = `🚨 EMERGENCY SOS ALERT: ${data.childName}!`;
  elements.alertBody.textContent = `Triggered at ${new Date(data.timestamp).toLocaleTimeString()}. Location coordinates: ${data.location.lat.toFixed(4)}, ${data.location.lng.toFixed(4)}.`;
}

// Toast System
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
