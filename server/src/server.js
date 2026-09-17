const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const { exec, execFile } = require('child_process');
const fs = require('fs');

const ADB_PATH = process.env.ADB_PATH || 'C:\\Users\\ankit\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Serve static dashboard files directly from the server as well
app.use(express.static(path.join(__dirname, '../../dashboard')));

// In-Memory Database for Child Devices
const devices = {
  'child_01': {
    id: 'child_01',
    name: "Aman's Galaxy S21",
    childName: 'Aman',
    avatar: '👦',
    pairingCode: '782941',
    status: 'online',
    lastSeen: new Date().toISOString(),
    battery: 84,
    isCharging: false,
    isLocked: false,
    lockMessage: 'Device locked by Parent for Study / Bedtime',
    screenTimeTodayMinutes: 87,
    dailyLimitMinutes: 0,
    currentApp: {
      name: 'YouTube',
      package: 'com.google.android.youtube',
      category: 'Entertainment'
    },
    location: {
      lat: 31.3051,
      lng: 77.5830,
      accuracy: 3.8,
      timestamp: new Date().toISOString(),
      address: 'Bhorja, Nankhari, Shimla, Himachal Pradesh, India'
    },
    geofences: [
      { id: 'geo_1', name: 'Home (Bhorja)', lat: 31.3051, lng: 77.5830, radiusMeters: 300, status: 'inside', distanceMeters: 0 },
      { id: 'geo_2', name: 'Govt Model School Nankhari', lat: 31.3090, lng: 77.5890, radiusMeters: 450, status: 'outside', distanceMeters: 720 },
      { id: 'geo_3', name: 'Shimla Ridge / Mall', lat: 31.1048, lng: 77.1734, radiusMeters: 800, status: 'outside', distanceMeters: 45200 }
    ],
    appLimits: [
      { package: 'com.google.android.youtube', name: 'YouTube', limitMinutes: 45, usedMinutes: 38, isBlocked: false, category: 'Video', icon: '▶️' },
      { package: 'com.instagram.android', name: 'Instagram', limitMinutes: 30, usedMinutes: 30, isBlocked: true, category: 'Social', icon: '📸' },
      { package: 'com.dts.freefireth', name: 'Free Fire Max', limitMinutes: 0, usedMinutes: 0, isBlocked: true, category: 'Gaming', icon: '🔥' },
      { package: 'com.roblox.client', name: 'Roblox', limitMinutes: 45, usedMinutes: 14, isBlocked: false, category: 'Gaming', icon: '🎮' },
      { package: 'com.whatsapp', name: 'WhatsApp', limitMinutes: 60, usedMinutes: 19, isBlocked: false, category: 'Chat', icon: '💬' }
    ],
    webFilter: {
      safeSearchEnabled: true,
      blockAdultSites: true,
      blockGambling: true,
      customBlockedDomains: ['tiktok.com', 'omegle.com', 'chatrandom.com']
    },
    activityLog: [
      { id: 'act_1', time: '10:15 AM', type: 'app', text: 'Started playing Roblox (14m)' },
      { id: 'act_2', time: '09:40 AM', type: 'geofence', text: 'Arrived at Safe Zone: Home' },
      { id: 'act_3', time: '08:15 AM', type: 'alert', text: 'Daily limit for Instagram reached (30m)' }
    ]
  }
};

// Create HTTP and WebSocket Server
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Connected WebSocket Clients
// map of ws -> { type: 'dashboard' | 'child', deviceId?: string }
const clients = new Map();

wss.on('connection', (ws) => {
  clients.set(ws, { type: 'unknown' });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      handleWebSocketMessage(ws, data);
    } catch (err) {
      console.error('Invalid WS payload:', err);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});

// Haversine formula to compute accurate distance between two coordinates in meters
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Evaluate device position against configured safe zones
function updateGeofencesForDevice(device) {
  if (!device.location || device.location.lat === undefined || !device.geofences) return;

  const devLat = device.location.lat;
  const devLng = device.location.lng;

  device.geofences.forEach(geo => {
    const dist = getDistanceMeters(devLat, devLng, geo.lat, geo.lng);
    const prevStatus = geo.status;
    geo.distanceMeters = Math.round(dist);
    geo.status = (dist <= geo.radiusMeters) ? 'inside' : 'outside';

    if (prevStatus && prevStatus !== geo.status) {
      const isEntering = geo.status === 'inside';
      const eventText = isEntering
        ? `📍 Arrived at Safe Zone: ${geo.name}`
        : `⚠️ Left Safe Zone: ${geo.name} (${Math.round(dist)}m away)`;
      
      device.activityLog.unshift({
        id: 'act_' + Date.now(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'geofence',
        text: eventText
      });

      broadcastToDashboards({
        type: 'GEOFENCE_ALERT',
        deviceId: device.id,
        geofenceName: geo.name,
        action: isEntering ? 'ENTER' : 'EXIT',
        text: eventText,
        timestamp: new Date().toISOString()
      });
    }
  });
}

// Hardware GNSS extractor via ADB
function queryRealDeviceLocation(deviceId = 'child_01') {
  return new Promise((resolve) => {
    execFile(ADB_PATH, ['shell', 'dumpsys location'], { timeout: 4000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) {
        return resolve(null);
      }
      
      const gnssMatch = stdout.match(/Gnss Location Data::\s*LatitudeDegrees:\s*([\d.-]+),\s*LongitudeDegrees:\s*([\d.-]+).*?horizontalAccuracyMeters:\s*([\d.]+)/i);
      if (gnssMatch) {
        const lat = parseFloat(gnssMatch[1]);
        const lng = parseFloat(gnssMatch[2]);
        const acc = Math.round(parseFloat(gnssMatch[3]) * 10) / 10;
        
        const dev = devices[deviceId];
        if (dev) {
          dev.location = {
            lat,
            lng,
            accuracy: acc || 3.8,
            timestamp: new Date().toISOString(),
            address: 'Bhorja, Nankhari, Shimla, Himachal Pradesh, India'
          };
          updateGeofencesForDevice(dev);
          console.log(`[KidShield GPS] Captured Hardware GNSS: ${lat}, ${lng} (±${acc}m)`);
          broadcastToDashboards({ type: 'TELEMETRY_UPDATE', deviceId, device: dev });
          return resolve(dev.location);
        }
      }
      resolve(null);
    });
  });
}

function handleWebSocketMessage(ws, data) {
  switch (data.type) {
    case 'REGISTER_DASHBOARD':
      clients.set(ws, { type: 'dashboard' });
      ws.send(JSON.stringify({ type: 'REGISTER_OK', devices: Object.values(devices) }));
      break;

    case 'REGISTER_CHILD':
      clients.set(ws, { type: 'child', deviceId: data.deviceId });
      console.log(`[KidShield Server] Child connected: ${data.deviceId} (${data.deviceName || 'Android Device'})`);
      if (devices[data.deviceId]) {
        const dev = devices[data.deviceId];
        dev.status = 'online';
        dev.lastSeen = new Date().toISOString();
        if (data.deviceName) dev.name = data.deviceName;
        if (data.battery !== undefined) dev.battery = data.battery;
        if (data.screenTimeTodayMinutes !== undefined) dev.screenTimeTodayMinutes = data.screenTimeTodayMinutes;
        if (data.installedApps && Array.isArray(data.installedApps) && data.installedApps.length > 0) {
          console.log(`[KidShield Server] Ingested ${data.installedApps.length} installed apps from real device!`);
          dev.appLimits = data.installedApps;
        }
        broadcastToDashboards({ type: 'DEVICE_UPDATED', deviceId: data.deviceId, device: dev });
      }
      ws.send(JSON.stringify({ type: 'CHILD_REGISTER_OK', device: devices[data.deviceId] }));
      break;

    case 'TELEMETRY_UPDATE':
      if (data.deviceId && devices[data.deviceId]) {
        const dev = devices[data.deviceId];
        if (data.battery !== undefined) dev.battery = data.battery;
        if (data.location && data.location.lat && data.location.lng) {
          dev.location = {
            ...dev.location,
            ...data.location,
            timestamp: new Date().toISOString()
          };
          updateGeofencesForDevice(dev);
        }
        if (data.screenTimeTodayMinutes !== undefined) dev.screenTimeTodayMinutes = data.screenTimeTodayMinutes;
        if (data.currentApp) dev.currentApp = data.currentApp;
        dev.lastSeen = new Date().toISOString();
        broadcastToDashboards({ type: 'TELEMETRY_UPDATE', deviceId: data.deviceId, device: dev });
      }
      break;

    case 'PARENT_COMMAND':
      // Forward command to child
      if (data.deviceId && devices[data.deviceId]) {
        executeParentCommand(data.deviceId, data.command, data.payload);
      }
      break;

    default:
      break;
  }
}

function broadcastToDashboards(payload) {
  const msg = JSON.stringify(payload);
  for (const [client, meta] of clients.entries()) {
    if (meta.type === 'dashboard' && client.readyState === client.OPEN) {
      client.send(msg);
    }
  }
}

function sendToChild(deviceId, payload) {
  const msg = JSON.stringify(payload);
  for (const [client, meta] of clients.entries()) {
    if (meta.type === 'child' && meta.deviceId === deviceId && client.readyState === client.OPEN) {
      client.send(msg);
    }
  }
}

function executeParentCommand(deviceId, command, payload = {}) {
  const device = devices[deviceId];
  if (!device) return;

  if (command === 'LOCK_DEVICE') {
    device.isLocked = true;
    device.lockMessage = payload.message || 'Device Locked by Parent';
    device.activityLog.unshift({
      id: 'act_' + Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'security',
      text: 'Parent triggered Instant Remote Lock'
    });
  } else if (command === 'UNLOCK_DEVICE') {
    device.isLocked = false;
    device.activityLog.unshift({
      id: 'act_' + Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'security',
      text: 'Parent unlocked the device'
    });
  } else if (command === 'RING_ALARM') {
    device.activityLog.unshift({
      id: 'act_' + Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'alert',
      text: 'Parent sounded emergency find-phone siren'
    });
  }

  // Notify child device
  sendToChild(deviceId, { type: 'COMMAND', command, payload });
  // Notify dashboards
  broadcastToDashboards({ type: 'DEVICE_UPDATED', deviceId, device });
}

// REST APIs
app.get('/api/devices', (req, res) => {
  res.json({ success: true, data: Object.values(devices) });
});

app.get('/api/devices/:id', (req, res) => {
  const device = devices[req.params.id];
  if (!device) return res.status(404).json({ success: false, error: 'Device not found' });
  res.json({ success: true, data: device });
});

// Initialize ADB daemon
execFile(ADB_PATH, ['start-server'], { env: process.env }, (err) => {
  if (err) console.warn('[KidShield Server] ADB daemon start notice:', err.message);
  else console.log('[KidShield Server] ADB daemon ready for screen mirroring');
});

// Live Device Screen Mirroring (Captures real-time screen of connected Android child device)
let lastScreenBuffer = null;
let lastScreenTime = 0;
let isScreenCapturing = false;

// Preload test image if available
try {
  const fallbackPath = path.join(__dirname, 'latest_screen.png');
  if (fs.existsSync(fallbackPath)) {
    lastScreenBuffer = fs.readFileSync(fallbackPath);
  }
} catch (e) {}

app.get('/api/devices/:id/screen', (req, res) => {
  const now = Date.now();
  // Return cached frame if captured within 600ms to keep stream snappy without overloading ADB
  if (lastScreenBuffer && (now - lastScreenTime < 600)) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res.send(lastScreenBuffer);
  }

  if (isScreenCapturing && lastScreenBuffer) {
    res.setHeader('Content-Type', 'image/png');
    return res.send(lastScreenBuffer);
  }

  isScreenCapturing = true;

  execFile(ADB_PATH, ['exec-out', 'screencap', '-p'], { maxBuffer: 10 * 1024 * 1024, encoding: 'buffer', timeout: 3000 }, (err, stdout, stderr) => {
    isScreenCapturing = false;
    if (err || !stdout || stdout.length < 500) {
      console.warn('[KidShield Screen] Exec-out error:', err ? err.message : 'Empty stdout', 'stderr:', stderr ? stderr.toString() : '');
      if (lastScreenBuffer) {
        res.setHeader('Content-Type', 'image/png');
        return res.send(lastScreenBuffer);
      }
      return res.status(500).json({ error: 'Screencap failed: ' + (err ? err.message : 'Empty stream') });
    }

    console.log(`[KidShield Screen] Captured live screen frame: ${stdout.length} bytes`);
    lastScreenBuffer = stdout;
    lastScreenTime = Date.now();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.send(lastScreenBuffer);
  });
});

// Wake up device screen if asleep
app.post('/api/devices/:id/wake', (req, res) => {
  execFile(ADB_PATH, ['shell', 'input', 'keyevent', '224'], { env: process.env, timeout: 2000 }, (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, message: 'Device screen woken up' });
  });
});

// ─── REMOTE CONTROL ENDPOINTS ─────────────────────────────────────────────────

// Remote Tap (Click-to-Tap on phone screen)
// Accepts normalized coords (0.0–1.0) and converts to real device resolution
app.post('/api/devices/:id/tap', (req, res) => {
  const { x, y, deviceWidth = 1080, deviceHeight = 2340 } = req.body;
  if (x === undefined || y === undefined) {
    return res.status(400).json({ success: false, error: 'x and y coordinates required' });
  }
  const realX = Math.round(parseFloat(x) * deviceWidth);
  const realY = Math.round(parseFloat(y) * deviceHeight);
  console.log(`[KidShield Remote] TAP at (${realX}, ${realY})`);
  execFile(ADB_PATH, ['shell', 'input', 'tap', String(realX), String(realY)], { timeout: 3000 }, (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, action: 'tap', x: realX, y: realY });
  });
});

// Remote Swipe / Scroll
app.post('/api/devices/:id/swipe', (req, res) => {
  const { x1, y1, x2, y2, duration = 300, deviceWidth = 1080, deviceHeight = 2340 } = req.body;
  const rx1 = Math.round(parseFloat(x1) * deviceWidth);
  const ry1 = Math.round(parseFloat(y1) * deviceHeight);
  const rx2 = Math.round(parseFloat(x2) * deviceWidth);
  const ry2 = Math.round(parseFloat(y2) * deviceHeight);
  console.log(`[KidShield Remote] SWIPE (${rx1},${ry1}) -> (${rx2},${ry2}) ${duration}ms`);
  execFile(ADB_PATH, ['shell', 'input', 'swipe', String(rx1), String(ry1), String(rx2), String(ry2), String(duration)], { timeout: 5000 }, (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, action: 'swipe' });
  });
});

// Remote Hardware Key (Back, Home, Recents, Volume, Power)
app.post('/api/devices/:id/keyevent', (req, res) => {
  const ALLOWED_KEYS = {
    'BACK':        '4',
    'HOME':        '3',
    'RECENTS':     '187',
    'VOLUME_UP':   '24',
    'VOLUME_DOWN': '26',
    'POWER':       '26',
    'WAKE':        '224',
    'ENTER':       '66',
    'DELETE':      '67',
    'SCREENSHOT':  '120'
  };
  const { key } = req.body;
  const keycode = ALLOWED_KEYS[key?.toUpperCase()];
  if (!keycode) return res.status(400).json({ success: false, error: `Unknown key: ${key}. Allowed: ${Object.keys(ALLOWED_KEYS).join(', ')}` });
  console.log(`[KidShield Remote] KEY: ${key} (${keycode})`);
  execFile(ADB_PATH, ['shell', 'input', 'keyevent', keycode], { timeout: 3000 }, (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, action: 'keyevent', key, keycode });
  });
});

// Remote Text Input (Type text on the focused field)
app.post('/api/devices/:id/type', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ success: false, error: 'text field required' });
  // Sanitize text - escape special shell chars
  const safeText = text.replace(/([`$"'\\&|;<>(){}])/g, '\\$1').replace(/ /g, '%s');
  console.log(`[KidShield Remote] TYPE: "${text}"`);
  execFile(ADB_PATH, ['shell', 'input', 'text', safeText], { timeout: 3000 }, (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, action: 'type', text });
  });
});

// ─── END REMOTE CONTROL ───────────────────────────────────────────────────────

app.post('/api/devices/:id/command', (req, res) => {
  const { command, payload } = req.body;
  if (!command) return res.status(400).json({ success: false, error: 'Command is required' });

  executeParentCommand(req.params.id, command, payload);
  res.json({ success: true, message: `Command ${command} executed`, device: devices[req.params.id] });
});

// Dedicated endpoint to toggle app block state
app.post('/api/devices/:id/toggle-block', (req, res) => {
  const device = devices[req.params.id];
  if (!device) return res.status(404).json({ success: false, error: 'Device not found' });

  const { package: pkg, isBlocked } = req.body;
  if (!pkg) return res.status(400).json({ success: false, error: 'Package name required' });

  if (!device.blockedPackages) device.blockedPackages = [];
  if (isBlocked) {
    if (!device.blockedPackages.includes(pkg)) device.blockedPackages.push(pkg);
  } else {
    device.blockedPackages = device.blockedPackages.filter(p => p !== pkg);
  }

  // Update in appLimits array
  if (device.appLimits && Array.isArray(device.appLimits)) {
    const target = device.appLimits.find(a => a.package === pkg);
    if (target) target.isBlocked = isBlocked;
  }

  console.log(`[KidShield Server] Toggle Block: ${pkg} -> ${isBlocked}. Total blocked:`, device.blockedPackages);

  // Send to child
  sendToChild(device.id, {
    type: 'RULES_UPDATED',
    rules: {
      blockedPackages: device.blockedPackages,
      dailyLimitMinutes: device.dailyLimitMinutes,
      appLimits: device.appLimits
    }
  });

  broadcastToDashboards({ type: 'DEVICE_UPDATED', deviceId: device.id, device });

  res.json({ success: true, isBlocked, blockedPackages: device.blockedPackages });
});

app.post('/api/devices/:id/rules', (req, res) => {
  const device = devices[req.params.id];
  if (!device) return res.status(404).json({ success: false, error: 'Device not found' });

  const { dailyLimitMinutes, appLimits, webFilter } = req.body;
  if (dailyLimitMinutes !== undefined) device.dailyLimitMinutes = dailyLimitMinutes;
  if (appLimits) device.appLimits = appLimits;
  if (webFilter) device.webFilter = { ...device.webFilter, ...webFilter };

  device.activityLog.unshift({
    id: 'act_' + Date.now(),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    type: 'rules',
    text: 'Parent updated screen time rules / limits'
  });

  sendToChild(device.id, { type: 'RULES_UPDATED', rules: { dailyLimitMinutes: device.dailyLimitMinutes, appLimits: device.appLimits, webFilter: device.webFilter } });
  broadcastToDashboards({ type: 'DEVICE_UPDATED', deviceId: device.id, device });

  res.json({ success: true, device });
});

app.post('/api/devices/:id/sos', (req, res) => {
  const device = devices[req.params.id];
  if (!device) return res.status(404).json({ success: false, error: 'Device not found' });

  device.activityLog.unshift({
    id: 'act_' + Date.now(),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    type: 'sos',
    text: '🚨 EMERGENCY SOS Triggered by Child!'
  });

  broadcastToDashboards({
    type: 'SOS_ALERT',
    deviceId: device.id,
    childName: device.childName,
    location: device.location,
    timestamp: new Date().toISOString()
  });

  res.json({ success: true, message: 'SOS Alert dispatched to Parent Dashboard' });
});

// Pairing a new child device via 6-digit code
app.post('/api/devices/pair', (req, res) => {
  const { pairingCode, deviceName, childName } = req.body;
  const newId = 'child_' + Date.now().toString().slice(-4);
  const newDevice = {
    id: newId,
    name: deviceName || "Child's Phone",
    childName: childName || 'Kid',
    avatar: '👧',
    pairingCode: pairingCode || Math.floor(100000 + Math.random() * 900000).toString(),
    status: 'online',
    lastSeen: new Date().toISOString(),
    battery: 100,
    isCharging: false,
    isLocked: false,
    lockMessage: 'Device locked by Parent',
    screenTimeTodayMinutes: 0,
    dailyLimitMinutes: 120,
    currentApp: { name: 'Home Screen', package: 'com.android.launcher', category: 'System' },
    location: { lat: 31.3051, lng: 77.5830, accuracy: 3.8, timestamp: new Date().toISOString(), address: 'Bhorja, Nankhari, Shimla, Himachal Pradesh, India' },
    geofences: [
      { id: 'geo_1', name: 'Home (Bhorja)', lat: 31.3051, lng: 77.5830, radiusMeters: 300, status: 'inside', distanceMeters: 0 }
    ],
    appLimits: [
      { package: 'com.google.android.youtube', name: 'YouTube', limitMinutes: 45, usedMinutes: 0, isBlocked: false, category: 'Video', icon: '▶️' },
      { package: 'com.instagram.android', name: 'Instagram', limitMinutes: 30, usedMinutes: 0, isBlocked: true, category: 'Social', icon: '📸' }
    ],
    webFilter: { safeSearchEnabled: true, blockAdultSites: true, blockGambling: true, customBlockedDomains: [] },
    activityLog: [{ id: 'act_0', time: 'Just now', type: 'info', text: 'Device successfully paired' }]
  };

  devices[newId] = newDevice;
  broadcastToDashboards({ type: 'DEVICE_ADDED', device: newDevice });
  res.json({ success: true, device: newDevice });
});

// Two-way device sync endpoint (Heartbeat + Telemetry + Real App Ingestion)
app.post('/api/devices/:id/sync', (req, res) => {
  const device = devices[req.params.id];
  if (!device) return res.status(404).json({ success: false, error: 'Device not found' });

  const { deviceName, battery, screenTimeTodayMinutes, currentApp, installedApps, location } = req.body;
  
  device.status = 'online';
  device.lastSeen = new Date().toISOString();

  if (deviceName) device.name = deviceName;
  if (battery !== undefined) device.battery = battery;
  if (screenTimeTodayMinutes !== undefined) device.screenTimeTodayMinutes = screenTimeTodayMinutes;
  if (currentApp) device.currentApp = currentApp;

  if (location && location.lat && location.lng) {
    device.location = {
      lat: location.lat,
      lng: location.lng,
      accuracy: location.accuracy || 4.0,
      timestamp: new Date().toISOString(),
      address: location.address || device.location?.address || 'Bhorja, Nankhari, Shimla, Himachal Pradesh, India'
    };
    updateGeofencesForDevice(device);
  }

  if (installedApps && Array.isArray(installedApps) && installedApps.length > 0) {
    // Preserve existing blocked status or limits if already configured by parent
    const existingRules = new Map();
    device.appLimits.forEach(app => {
      existingRules.set(app.package, { isBlocked: app.isBlocked, limitMinutes: app.limitMinutes });
    });

    if (!device.blockedPackages) device.blockedPackages = [];

    device.appLimits = installedApps.map(app => {
      const isBlocked = device.blockedPackages.includes(app.package);
      const existing = existingRules.get(app.package);
      return {
        ...app,
        isBlocked: isBlocked || (existing ? existing.isBlocked : false),
        limitMinutes: existing ? existing.limitMinutes : app.limitMinutes
      };
    });
    console.log(`[KidShield Server] Ingested ${device.appLimits.length} apps from ${device.name}`);
  }

  broadcastToDashboards({ type: 'DEVICE_UPDATED', deviceId: device.id, device });

  res.json({
    success: true,
    isLocked: device.isLocked,
    lockMessage: device.lockMessage,
    dailyLimitMinutes: device.dailyLimitMinutes,
    blockedPackages: device.blockedPackages || [],
    appLimits: device.appLimits,
    webFilter: device.webFilter
  });
});

// Force immediate GPS refresh from connected hardware
app.post('/api/devices/:id/refresh-location', async (req, res) => {
  const device = devices[req.params.id];
  if (!device) return res.status(404).json({ success: false, error: 'Device not found' });

  // Query hardware GNSS via ADB
  await queryRealDeviceLocation(req.params.id);
  res.json({
    success: true,
    location: device.location,
    geofences: device.geofences
  });
});

// Add or update a geofence zone
app.post('/api/devices/:id/geofences', (req, res) => {
  const device = devices[req.params.id];
  if (!device) return res.status(404).json({ success: false, error: 'Device not found' });

  const { name, lat, lng, radiusMeters } = req.body;
  if (!name || lat === undefined || lng === undefined) {
    return res.status(400).json({ success: false, error: 'Name, lat, and lng are required' });
  }

  const newGeo = {
    id: 'geo_' + Date.now().toString().slice(-4),
    name,
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    radiusMeters: parseInt(radiusMeters) || 300,
    status: 'outside',
    distanceMeters: 0
  };

  if (!device.geofences) device.geofences = [];
  device.geofences.push(newGeo);
  updateGeofencesForDevice(device);

  device.activityLog.unshift({
    id: 'act_' + Date.now(),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    type: 'geofence',
    text: `Parent added new Safe Zone: ${name} (${newGeo.radiusMeters}m)`
  });

  broadcastToDashboards({ type: 'DEVICE_UPDATED', deviceId: device.id, device });
  res.json({ success: true, geofences: device.geofences });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), activeConnections: clients.size });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[KidShield Server] Running on http://0.0.0.0:${PORT}`);
  console.log(`[KidShield Server] WebSocket ready at ws://0.0.0.0:${PORT}/ws`);

  // Initial GNSS query from hardware
  queryRealDeviceLocation('child_01').catch(() => {});
  
  // Periodic GNSS refresh every 25 seconds
  setInterval(() => {
    queryRealDeviceLocation('child_01').catch(() => {});
  }, 25000);
});
