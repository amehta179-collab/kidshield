package com.kidshield.child.services

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import androidx.annotation.RequiresApi
import kotlinx.coroutines.*
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * KidShield Wireless Remote Control Service
 *
 * Uses Android's official AccessibilityService API to receive tap/swipe commands
 * from the parent dashboard (via cloud server WebSocket) and execute them on the
 * child device screen — without any USB cable or ADB connection.
 *
 * This is the same API used by legitimate parental control apps like
 * Google Family Link and third-party MDM tools.
 *
 * SETUP REQUIRED (one-time on child device):
 *   Settings → Accessibility → KidShield Parental Control → Enable
 */
class KidShieldAccessibilityService : AccessibilityService() {

    private val tag = "KidShieldA11y"
    private val serviceJob = Job()
    private val scope = CoroutineScope(Dispatchers.IO + serviceJob)

    private val serverWsUrl = KidShieldConfig.SERVER_WS_URL
    private val deviceId    = KidShieldConfig.DEVICE_ID

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private var reconnectJob: Job? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.d(tag, "Accessibility Service connected — starting remote control WebSocket")
        connectWebSocket()
    }

    private fun connectWebSocket() {
        val request = Request.Builder()
            .url("$serverWsUrl?type=child_control&deviceId=$deviceId")
            .build()

        webSocket = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(tag, "Control WebSocket connected ✓")
                // Register this as the remote-control receiver for this device
                val reg = JSONObject().apply {
                    put("type", "REGISTER_CONTROL_RECEIVER")
                    put("deviceId", deviceId)
                }
                webSocket.send(reg.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleIncomingCommand(text)
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.w(tag, "Control WS failed: ${t.message} — reconnecting in 5s")
                scheduleReconnect()
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.w(tag, "Control WS closed: $reason — reconnecting in 5s")
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(5000)
            connectWebSocket()
        }
    }

    private fun handleIncomingCommand(text: String) {
        try {
            val json = JSONObject(text)
            val type = json.optString("type")

            if (type != "REMOTE_CONTROL") return

            val action  = json.optString("action")
            val payload = json.optJSONObject("payload") ?: JSONObject()

            Log.d(tag, "Remote command received: $action")

            when (action) {
                "TAP" -> {
                    val x = payload.optDouble("x", 0.5)
                    val y = payload.optDouble("y", 0.5)
                    performRemoteTap(x.toFloat(), y.toFloat())
                }
                "SWIPE" -> {
                    val x1 = payload.optDouble("x1", 0.5)
                    val y1 = payload.optDouble("y1", 0.5)
                    val x2 = payload.optDouble("x2", 0.5)
                    val y2 = payload.optDouble("y2", 0.5)
                    val duration = payload.optLong("duration", 300)
                    performRemoteSwipe(x1.toFloat(), y1.toFloat(), x2.toFloat(), y2.toFloat(), duration)
                }
                "KEYEVENT" -> {
                    val key = payload.optString("key", "HOME")
                    performKeyAction(key)
                }
                else -> Log.w(tag, "Unknown remote action: $action")
            }
        } catch (e: Exception) {
            Log.e(tag, "Error handling remote command: ${e.message}")
        }
    }

    @RequiresApi(Build.VERSION_CODES.N)
    private fun performRemoteTap(normX: Float, normY: Float) {
        val dm = resources.displayMetrics
        val realX = normX * dm.widthPixels
        val realY = normY * dm.heightPixels

        val path = Path().apply { moveTo(realX, realY) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 50)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()

        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription) {
                Log.d(tag, "Remote tap dispatched at ($realX, $realY)")
            }
            override fun onCancelled(gestureDescription: GestureDescription) {
                Log.w(tag, "Remote tap cancelled")
            }
        }, null)
    }

    @RequiresApi(Build.VERSION_CODES.N)
    private fun performRemoteSwipe(nx1: Float, ny1: Float, nx2: Float, ny2: Float, durationMs: Long) {
        val dm = resources.displayMetrics
        val x1 = nx1 * dm.widthPixels
        val y1 = ny1 * dm.heightPixels
        val x2 = nx2 * dm.widthPixels
        val y2 = ny2 * dm.heightPixels

        val path = Path().apply {
            moveTo(x1, y1)
            lineTo(x2, y2)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceIn(100, 2000))
        val gesture = GestureDescription.Builder().addStroke(stroke).build()

        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription) {
                Log.d(tag, "Remote swipe dispatched ($x1,$y1)->($x2,$y2)")
            }
        }, null)
    }

    private fun performKeyAction(key: String) {
        when (key.uppercase()) {
            "BACK"    -> performGlobalAction(GLOBAL_ACTION_BACK)
            "HOME"    -> performGlobalAction(GLOBAL_ACTION_HOME)
            "RECENTS" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            "NOTIFICATIONS" -> performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
            else -> Log.w(tag, "Unknown key: $key")
        }
        Log.d(tag, "Global key action: $key")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Not needed for remote control — event monitoring handled by KidShieldMonitorService
    }

    override fun onInterrupt() {
        Log.w(tag, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        webSocket?.close(1000, "Service destroyed")
        serviceJob.cancel()
        httpClient.dispatcher.executorService.shutdown()
        super.onDestroy()
    }
}
