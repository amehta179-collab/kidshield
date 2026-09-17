package com.kidshield.child.network

import android.util.Log
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class SyncClient(
    private val deviceId: String = "child_01"
) {
    private val tag = "KidShieldSync"
    private val client = OkHttpClient.Builder()
        .readTimeout(10, TimeUnit.SECONDS)
        .connectTimeout(5, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    var isConnected = false
        private set

    private var onCommandCallback: ((command: String, payload: JSONObject) -> Unit)? = null
    private var cachedRegistrationPayload: JSONObject? = null

    // Candidate URLs for Wi-Fi and USB reverse
    private val candidateWsUrls = listOf(
        "ws://192.168.1.3:4000/ws",
        "ws://127.0.0.1:4000/ws"
    )
    private val candidateHttpUrls = listOf(
        "http://192.168.1.3:4000/api/devices/$deviceId/sync",
        "http://127.0.0.1:4000/api/devices/$deviceId/sync"
    )

    private var activeWsIndex = 0
    private var activeHttpIndex = 0

    fun setCommandListener(listener: (command: String, payload: JSONObject) -> Unit) {
        this.onCommandCallback = listener
    }

    fun connect(initialPayload: JSONObject? = null) {
        if (initialPayload != null) {
            cachedRegistrationPayload = initialPayload
        }
        val url = candidateWsUrls[activeWsIndex % candidateWsUrls.size]
        val request = Request.Builder().url(url).build()
        Log.d(tag, "Attempting WebSocket connection to $url...")

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                isConnected = true
                Log.d(tag, "✓ Connected to KidShield Server via WebSocket at $url")

                val regMsg = cachedRegistrationPayload ?: JSONObject().apply {
                    put("type", "REGISTER_CHILD")
                    put("deviceId", deviceId)
                }
                webSocket.send(regMsg.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    val type = json.optString("type")
                    if (type == "COMMAND") {
                        val cmd = json.optString("command")
                        val payload = json.optJSONObject("payload") ?: JSONObject()
                        onCommandCallback?.invoke(cmd, payload)
                    } else if (type == "RULES_UPDATED") {
                        val rules = json.optJSONObject("rules") ?: JSONObject()
                        onCommandCallback?.invoke("RULES_UPDATED", rules)
                    }
                } catch (e: Exception) {
                    Log.e(tag, "Error parsing WS message: $e")
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                isConnected = false
                retryNextWs()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                isConnected = false
                Log.w(tag, "WS connection to $url failed (${t.message}). Trying next candidate in 3s...")
                retryNextWs()
            }
        })
    }

    private fun retryNextWs() {
        Thread {
            try {
                Thread.sleep(3000)
                activeWsIndex++
                connect()
            } catch (e: Exception) {
                // Ignore
            }
        }.start()
    }

    fun sendTelemetry(battery: Int, currentApp: String, screenTimeMinutes: Int, location: JSONObject? = null) {
        if (!isConnected || webSocket == null) return

        val msg = JSONObject().apply {
            put("type", "TELEMETRY_UPDATE")
            put("deviceId", deviceId)
            put("battery", battery)
            put("screenTimeTodayMinutes", screenTimeMinutes)
            put("currentApp", JSONObject().apply {
                put("name", currentApp)
            })
            if (location != null) {
                put("location", location)
            }
        }
        webSocket?.send(msg.toString())
    }

    // High-Reliability HTTP REST Sync Fallback
    fun syncViaHttp(
        deviceName: String,
        battery: Int,
        screenTimeMinutes: Int,
        currentApp: String,
        installedApps: JSONArray?,
        location: JSONObject? = null,
        onSyncResult: (isLocked: Boolean, lockMsg: String, rules: JSONObject) -> Unit
    ) {
        val httpUrl = candidateHttpUrls[activeHttpIndex % candidateHttpUrls.size]

        val bodyJson = JSONObject().apply {
            put("deviceName", deviceName)
            put("battery", battery)
            put("screenTimeTodayMinutes", screenTimeMinutes)
            put("currentApp", JSONObject().apply { put("name", currentApp) })
            if (installedApps != null && installedApps.length() > 0) {
                put("installedApps", installedApps)
            }
            if (location != null) {
                put("location", location)
            }
        }

        val requestBody = bodyJson.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url(httpUrl)
            .post(requestBody)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.w(tag, "HTTP Sync to $httpUrl failed: ${e.message}")
                activeHttpIndex++
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (response.isSuccessful) {
                        val respStr = response.body?.string() ?: ""
                        try {
                            val json = JSONObject(respStr)
                            val isLocked = json.optBoolean("isLocked", false)
                            val lockMsg = json.optString("lockMessage", "Device Locked by Parent")
                            onSyncResult(isLocked, lockMsg, json)
                        } catch (e: Exception) {
                            Log.e(tag, "Parse HTTP sync response error: $e")
                        }
                    } else {
                        activeHttpIndex++
                    }
                }
            }
        })
    }

    fun disconnect() {
        webSocket?.close(1000, "Service destroyed")
        webSocket = null
        isConnected = false
    }
}
