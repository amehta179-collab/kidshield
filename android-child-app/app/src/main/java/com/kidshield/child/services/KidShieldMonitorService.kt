package com.kidshield.child.services

import android.app.*
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.RingtoneManager
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.kidshield.child.LockOverlayActivity
import com.kidshield.child.network.SyncClient
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

class KidShieldMonitorService : Service() {

    private val tag = "KidShieldService"
    private val serviceJob = Job()
    private val serviceScope = CoroutineScope(Dispatchers.Default + serviceJob)
    private lateinit var usageStatsManager: UsageStatsManager
    private lateinit var syncClient: SyncClient

    private var isDeviceLocked = false
    private var lockMessage = "Device Locked by Parent"
    private var dailyLimitMinutes = 120

    // Set of packages blocked by parent
    private val blockedPackages = mutableSetOf<String>()
    // Map of package -> limit in minutes
    private val appLimitsMap = mutableMapOf<String, Int>()

    private var cachedAppsArray: JSONArray? = null
    private var lastAppsSyncTime = 0L

    private var locationManager: LocationManager? = null
    private var fusedLocationClient: FusedLocationProviderClient? = null
    private var lastKnownLocation: Location? = null
    private var lastKnownAddress: String? = null

    override fun onCreate() {
        super.onCreate()
        usageStatsManager = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        syncClient = SyncClient(deviceId = "child_01")
        locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        try {
            fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        } catch (e: Exception) {
            Log.w(tag, "FusedLocationClient init fallback: ${e.message}")
        }

        startForeground(NOTIFICATION_ID, createNotification())
        setupLocationTracking()
        setupSyncClient()
        startMonitoringLoop()
    }

    private fun createNotification(): Notification {
        val channelId = "kidshield_service_channel"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "KidShield Parental Control",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Active parental monitoring and child protection"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }

        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("KidShield Protection Active")
            .setContentText("Device is actively supervised by Parent for screen time & safety")
            .setSmallIcon(android.R.drawable.ic_secure)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun setupSyncClient() {
        syncClient.setCommandListener { command, payload ->
            Log.d(tag, "Received parent command: $command, payload: $payload")
            when (command) {
                "LOCK_DEVICE" -> {
                    isDeviceLocked = true
                    lockMessage = payload.optString("message", "Device Locked by Parent")
                    triggerLockOverlay(lockMessage)
                }
                "UNLOCK_DEVICE" -> {
                    isDeviceLocked = false
                    dismissLockOverlay()
                }
                "RING_ALARM" -> {
                    playAlarmSound()
                }
                "RULES_UPDATED" -> {
                    handleRulesUpdated(payload)
                }
            }
        }

        // Collect real device telemetry & installed apps and connect
        serviceScope.launch(Dispatchers.IO) {
            val deviceModel = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
            val battery = getBatteryPercentage()
            val (totalScreenTime, installedApps) = getInstalledAppsWithUsage()
            cachedAppsArray = installedApps
            val locJson = buildLocationJson()

            val regPayload = JSONObject().apply {
                put("type", "REGISTER_CHILD")
                put("deviceId", "child_01")
                put("deviceName", deviceModel)
                put("battery", battery)
                put("screenTimeTodayMinutes", totalScreenTime)
                put("installedApps", installedApps)
                if (locJson != null) {
                    put("location", locJson)
                }
            }

            syncClient.connect(regPayload)
        }
    }

    private fun handleRulesUpdated(rules: JSONObject) {
        dailyLimitMinutes = rules.optInt("dailyLimitMinutes", 120)

        val directBlocked = rules.optJSONArray("blockedPackages")
        if (directBlocked != null) {
            blockedPackages.clear()
            for (i in 0 until directBlocked.length()) {
                val pkg = directBlocked.optString(i)
                if (pkg.isNotEmpty()) {
                    blockedPackages.add(pkg)
                }
            }
        }
        
        val apps = rules.optJSONArray("appLimits")
        if (apps != null) {
            appLimitsMap.clear()
            for (i in 0 until apps.length()) {
                val app = apps.optJSONObject(i) ?: continue
                val pkg = app.optString("package")
                val isBlocked = app.optBoolean("isBlocked", false)
                val limit = app.optInt("limitMinutes", 0)

                if (isBlocked) {
                    blockedPackages.add(pkg)
                }
                if (limit > 0) {
                    appLimitsMap[pkg] = limit
                }
            }
        }

        getSharedPreferences("kidshield_rules", Context.MODE_PRIVATE)
            .edit()
            .putStringSet("blocked_packages", blockedPackages)
            .apply()

        Log.d(tag, "Active Blocked Packages: $blockedPackages")
    }

    private fun startMonitoringLoop() {
        // Load cached blocked packages from disk
        val cached = getSharedPreferences("kidshield_rules", Context.MODE_PRIVATE)
            .getStringSet("blocked_packages", emptySet())
        if (cached != null) {
            blockedPackages.addAll(cached)
        }

        serviceScope.launch {
            var loopCount = 0
            while (isActive) {
                try {
                    loopCount++
                    val currentPkg = getForegroundAppPackage()
                    val totalScreenTime = getTodayTotalScreenTimeMinutes()
                    val battery = getBatteryPercentage()
                    val appName = getAppNameFromPackage(currentPkg)
                    val deviceModel = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"

                    // Enforce lock restrictions immediately (every 500ms)
                    if (currentPkg != null && currentPkg != packageName) {
                        checkAppRestrictions(currentPkg, totalScreenTime)
                    } else if (isDeviceLocked) {
                        triggerLockOverlay(lockMessage)
                    }

                    // Send telemetry and sync over HTTP every 2.5 seconds (every 5 loops)
                    if (loopCount % 5 == 0) {
                        val locJson = buildLocationJson()

                        if (syncClient.isConnected) {
                            syncClient.sendTelemetry(battery, appName, totalScreenTime, locJson)
                        }

                        val now = System.currentTimeMillis()
                        val shouldSendApps = (cachedAppsArray == null || now - lastAppsSyncTime > 25000)
                        if (shouldSendApps && cachedAppsArray == null) {
                            val (_, apps) = getInstalledAppsWithUsage()
                            cachedAppsArray = apps
                        }

                        syncClient.syncViaHttp(
                            deviceName = deviceModel,
                            battery = battery,
                            screenTimeMinutes = totalScreenTime,
                            currentApp = appName,
                            installedApps = if (shouldSendApps) cachedAppsArray else null,
                            location = locJson
                        ) { serverIsLocked, serverLockMsg, rules ->
                            if (shouldSendApps) lastAppsSyncTime = now

                            if (serverIsLocked != isDeviceLocked) {
                                isDeviceLocked = serverIsLocked
                                lockMessage = serverLockMsg
                                if (isDeviceLocked) {
                                    triggerLockOverlay(lockMessage)
                                } else {
                                    dismissLockOverlay()
                                }
                            }
                            handleRulesUpdated(rules)
                        }
                    }

                } catch (e: Exception) {
                    Log.e(tag, "Error in monitoring loop: $e")
                }
                delay(500)
            }
        }
    }

    private fun checkAppRestrictions(currentPkg: String, totalScreenTime: Int) {
        if (isDeviceLocked) {
            triggerLockOverlay(lockMessage)
            return
        }

        // 1. Blocked apps check (Parent toggled block)
        if (blockedPackages.contains(currentPkg)) {
            val appName = getAppNameFromPackage(currentPkg)
            triggerLockOverlay("🚫 $appName is blocked by your parent.")
            return
        }

        // 2. Per-app timer limit
        val appLimit = appLimitsMap[currentPkg] ?: 0
        if (appLimit > 0) {
            val appUsage = getAppUsageTodayMinutes(currentPkg)
            if (appUsage >= appLimit) {
                val appName = getAppNameFromPackage(currentPkg)
                triggerLockOverlay("⏳ Daily limit of $appLimit mins for $appName has been reached.")
                return
            }
        }

        // 3. Daily total screen time limit (only if parent set limit > 0)
        if (dailyLimitMinutes > 0 && totalScreenTime >= dailyLimitMinutes) {
            triggerLockOverlay("⏳ Daily Screen Time Limit reached ($dailyLimitMinutes mins). Take a break!")
            return
        }
    }

    private fun triggerLockOverlay(reason: String) {
        val now = System.currentTimeMillis()
        if (now - lastLockTriggerTime < 1000) return
        lastLockTriggerTime = now

        Log.i(tag, ">>> TRIGGERING LOCK OVERLAY: $reason <<<")

        // 1. Kick user back to Home Screen so the blocked app cannot stay open
        val homeIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        startActivity(homeIntent)

        // 2. Launch LockOverlayActivity on top of Home
        val intent = Intent(this, LockOverlayActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            putExtra("EXTRA_LOCK_REASON", reason)
        }
        startActivity(intent)

        // 3. Show Toast notification
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            android.widget.Toast.makeText(applicationContext, "🚫 $reason", android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    private fun dismissLockOverlay() {
        val dismissIntent = Intent(LockOverlayActivity.ACTION_DISMISS_LOCK)
        sendBroadcast(dismissIntent)
    }

    private fun playAlarmSound() {
        try {
            val alertUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            val ringtone = RingtoneManager.getRingtone(applicationContext, alertUri)
            ringtone.play()
            serviceScope.launch {
                delay(5000)
                ringtone.stop()
            }
        } catch (e: Exception) {
            Log.e(tag, "Alarm play error: $e")
        }
    }

    private var lastForegroundPackage: String? = null
    private var lastLockTriggerTime = 0L

    private fun getForegroundAppPackage(): String? {
        val time = System.currentTimeMillis()
        val usageEvents = usageStatsManager.queryEvents(time - 1000 * 120, time)
        val event = UsageEvents.Event()

        while (usageEvents.hasNextEvent()) {
            usageEvents.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
                lastForegroundPackage = event.packageName
            }
        }

        if (lastForegroundPackage == null) {
            val stats = usageStatsManager.queryUsageStats(
                UsageStatsManager.INTERVAL_DAILY,
                time - 1000 * 60 * 10,
                time
            )
            lastForegroundPackage = stats?.maxByOrNull { it.lastTimeUsed }?.packageName
        }

        return lastForegroundPackage
    }

    private fun getBatteryPercentage(): Int {
        val batteryStatus: Intent? = IntentFilter(Intent.ACTION_BATTERY_CHANGED).let { filter ->
            applicationContext.registerReceiver(null, filter)
        }
        val level: Int = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: 50
        val scale: Int = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: 100
        return (level * 100 / scale.toFloat()).toInt()
    }

    private fun getTodayTotalScreenTimeMinutes(): Int {
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
        }
        val stats = usageStatsManager.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY,
            cal.timeInMillis,
            System.currentTimeMillis()
        )
        var totalMillis = 0L
        stats?.forEach {
            totalMillis += it.totalTimeInForeground
        }
        return (totalMillis / (1000 * 60)).toInt()
    }

    private fun getAppUsageTodayMinutes(targetPkg: String): Int {
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
        }
        val stats = usageStatsManager.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY,
            cal.timeInMillis,
            System.currentTimeMillis()
        )
        val appStat = stats?.find { it.packageName == targetPkg }
        return ((appStat?.totalTimeInForeground ?: 0L) / (1000 * 60)).toInt()
    }

    private fun getInstalledAppsWithUsage(): Pair<Int, JSONArray> {
        val pm = packageManager
        val mainIntent = Intent(Intent.ACTION_MAIN, null).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
        }
        val launchableApps = pm.queryIntentActivities(mainIntent, 0)
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
        }
        val usageStats = usageStatsManager.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY,
            cal.timeInMillis,
            System.currentTimeMillis()
        )
        val usageMap = usageStats?.associate { it.packageName to (it.totalTimeInForeground / (1000 * 60)).toInt() } ?: emptyMap()

        var totalDailyTime = 0
        val jsonArray = JSONArray()

        // Filter out our own app
        val filtered = launchableApps.filter { it.activityInfo.packageName != packageName }

        for (resolveInfo in filtered) {
            val pkg = resolveInfo.activityInfo.packageName
            val label = resolveInfo.loadLabel(pm).toString()
            val usedMins = usageMap[pkg] ?: 0
            totalDailyTime += usedMins

            val appObj = JSONObject().apply {
                put("package", pkg)
                put("name", label)
                put("usedMinutes", usedMins)
                put("limitMinutes", 0)
                put("isBlocked", blockedPackages.contains(pkg))
                put("category", detectCategory(pkg, label))
                put("icon", detectIcon(label))
            }
            jsonArray.put(appObj)
        }

        return Pair(totalDailyTime, jsonArray)
    }

    private fun detectCategory(pkg: String, label: String): String {
        val lower = "$pkg $label".lowercase()
        return when {
            lower.contains("game") || lower.contains("fire") || lower.contains("roblox") || lower.contains("pubg") || lower.contains("candy") -> "Gaming"
            lower.contains("video") || lower.contains("youtube") || lower.contains("netflix") || lower.contains("prime") -> "Video"
            lower.contains("whatsapp") || lower.contains("message") || lower.contains("telegram") || lower.contains("chat") -> "Chat"
            lower.contains("insta") || lower.contains("facebook") || lower.contains("tiktok") || lower.contains("snapchat") -> "Social"
            lower.contains("chrome") || lower.contains("browser") || lower.contains("opera") -> "Browser"
            else -> "App"
        }
    }

    private fun detectIcon(label: String): String {
        val lower = label.lowercase()
        return when {
            lower.contains("youtube") -> "▶️"
            lower.contains("whatsapp") -> "💬"
            lower.contains("instagram") -> "📸"
            lower.contains("chrome") -> "🌐"
            lower.contains("game") || lower.contains("fire") || lower.contains("roblox") -> "🎮"
            lower.contains("photo") || lower.contains("gallery") -> "🖼️"
            lower.contains("setting") -> "⚙️"
            else -> "📱"
        }
    }

    private fun getAppNameFromPackage(pkg: String?): String {
        if (pkg == null) return "System"
        return try {
            val pm = packageManager
            val info = pm.getApplicationInfo(pkg, 0)
            pm.getApplicationLabel(info).toString()
        } catch (e: Exception) {
            pkg.substringAfterLast('.')
        }
    }

    private fun setupLocationTracking() {
        if (!hasLocationPermission()) return

        try {
            val gpsLoc = locationManager?.getLastKnownLocation(LocationManager.GPS_PROVIDER)
            val netLoc = locationManager?.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            val bestInitial = gpsLoc ?: netLoc

            if (bestInitial != null) {
                lastKnownLocation = bestInitial
                updateAddressAsync(bestInitial)
            }

            fusedLocationClient?.lastLocation?.addOnSuccessListener { fused ->
                if (fused != null) {
                    lastKnownLocation = fused
                    updateAddressAsync(fused)
                }
            }

            val locationListener = object : LocationListener {
                override fun onLocationChanged(loc: Location) {
                    lastKnownLocation = loc
                    updateAddressAsync(loc)
                }
                override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                override fun onProviderEnabled(provider: String) {}
                override fun onProviderDisabled(provider: String) {}
            }

            locationManager?.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                10000L,
                10f,
                locationListener,
                Looper.getMainLooper()
            )
            locationManager?.requestLocationUpdates(
                LocationManager.NETWORK_PROVIDER,
                10000L,
                10f,
                locationListener,
                Looper.getMainLooper()
            )
        } catch (e: SecurityException) {
            Log.w(tag, "Location permission not granted yet: ${e.message}")
        } catch (e: Exception) {
            Log.e(tag, "Error setting up location tracking: ${e.message}")
        }
    }

    private fun hasLocationPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_COARSE_LOCATION)
        return fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED
    }

    private fun updateAddressAsync(loc: Location) {
        serviceScope.launch(Dispatchers.IO) {
            try {
                val geocoder = Geocoder(this@KidShieldMonitorService, Locale.getDefault())
                val addresses = geocoder.getFromLocation(loc.latitude, loc.longitude, 1)
                if (!addresses.isNullOrEmpty()) {
                    val addr = addresses[0]
                    val parts = listOfNotNull(
                        addr.subLocality ?: addr.thoroughfare ?: addr.featureName,
                        addr.locality ?: addr.subAdminArea,
                        addr.adminArea,
                        addr.countryName
                    ).filter { it.isNotBlank() }
                    lastKnownAddress = parts.joinToString(", ")
                }
            } catch (e: Exception) {
                // Ignore network reverse geocoding issues
            }
        }
    }

    private fun buildLocationJson(): JSONObject? {
        if (lastKnownLocation == null && hasLocationPermission()) {
            setupLocationTracking()
        }
        val loc = lastKnownLocation ?: return null
        return JSONObject().apply {
            put("lat", loc.latitude)
            put("lng", loc.longitude)
            put("accuracy", if (loc.hasAccuracy()) loc.accuracy.toDouble() else 10.0)
            put("timestamp", loc.time)
            if (lastKnownAddress != null) {
                put("address", lastKnownAddress)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceJob.cancel()
        syncClient.disconnect()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val NOTIFICATION_ID = 1001
    }
}
