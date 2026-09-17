# KidShield - Smart Parental Control & Child Safety Platform

A complete, production-ready, and Google Play-compliant parental control system inspired by industry leaders like **Qustodio** and **Google Family Link**.

---

## 📁 Repository Structure

```
d:\project\spyPro/
├── server/                   # Cloud Sync & Command Server (Node.js, Express, WebSockets)
│   ├── src/
│   │   └── server.js         # Core REST API & WebSocket dispatcher
│   └── package.json
│
├── dashboard/                # Modern Parent Web Dashboard (Glassmorphic Dark UI)
│   ├── index.html            # Semantic HTML5 Dashboard
│   ├── css/style.css         # Glassmorphism design system & micro-animations
│   └── js/app.js             # Real-time WebSocket sync & Leaflet map integration
│
└── android-child-app/        # Native Android Child Companion Client (Kotlin)
    ├── app/
    │   ├── src/main/
    │   │   ├── AndroidManifest.xml   # Google Play compliant Family & Monitoring declarations
    │   │   ├── java/com/kidshield/child/
    │   │   │   ├── MainActivity.kt               # Permission onboarding & setup
    │   │   │   ├── LockOverlayActivity.kt        # App quota & bedtime lock overlay
    │   │   │   ├── services/
    │   │   │   │   ├── KidShieldMonitorService.kt # Foreground service tracking UsageStats
    │   │   │   │   └── DnsVpnService.kt          # Local DNS web content filter
    │   │   │   ├── receivers/
    │   │   │   │   ├── KidShieldDeviceAdminReceiver.kt # Anti-uninstall protection
    │   │   │   │   └── BootReceiver.kt           # Auto-starts service on phone restart
    │   │   │   └── network/
    │   │   │       └── SyncClient.kt             # WebSocket real-time client
    │   │   └── res/
    │   └── build.gradle.kts
    ├── build.gradle.kts
    └── settings.gradle.kts
```

---

## 🚀 How to Run the Platform

### 1. Launch the Cloud Sync Server:
```bash
cd server
npm start
```
* The server will boot on `http://localhost:4000` with WebSockets enabled at `ws://localhost:4000`.

### 2. Open Parent Web Dashboard:
Open your browser and visit:
👉 **`http://localhost:4000`**

From the dashboard you can:
- View live screen time quota & battery level.
- Set per-app timers (YouTube, Instagram, Free Fire, etc.) or block them instantly.
- Track live GPS location on the interactive Leaflet map with Home & School geofence boundaries.
- Toggle smart DNS web safety filters (Adult content, Google SafeSearch, Gambling).
- Trigger 1-click **Instant Remote Lock** ("Dinner Time Lock").
- Ring emergency find-phone siren.
- Test all features interactively via the built-in **Device Simulator** tab.

### 3. Build the Android Child Companion APK:
Open the `android-child-app` folder inside **Android Studio**, connect an Android device or emulator, and click **Run / Build APK**.
