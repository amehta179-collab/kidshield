package com.kidshield.child.services

/**
 * Central configuration for KidShield child app.
 * Update SERVER_BASE_URL to your Cloudflare Tunnel or production server URL.
 */
object KidShieldConfig {

    // ─── SERVER URL ────────────────────────────────────────────────────────────
    // Replace this URL with your Cloudflare Tunnel link or production HTTPS URL
    // Example: "https://longer-buttons-rather-ownership.trycloudflare.com"
    private const val SERVER_BASE_URL = "https://longer-buttons-rather-ownership.trycloudflare.com"

    // ─── DERIVED URLs ─────────────────────────────────────────────────────────
    val SERVER_HTTP_URL: String = SERVER_BASE_URL
    val SERVER_WS_URL:   String = SERVER_BASE_URL
        .replace("https://", "wss://")
        .replace("http://",  "ws://")

    // ─── DEVICE ID ────────────────────────────────────────────────────────────
    // Unique identifier for this child device on the parent dashboard
    const val DEVICE_ID = "child_01"

    // ─── TELEMETRY SETTINGS ────────────────────────────────────────────────────
    // How often (ms) to send telemetry to server (default: every 2.5s)
    const val TELEMETRY_INTERVAL_MS = 2500L
    // How often (ms) to refresh app list on server (default: every 30s)
    const val APP_SYNC_INTERVAL_MS  = 30_000L
    // Screen stream frame interval (default: 1.8s)
    const val SCREEN_FRAME_INTERVAL_MS = 1800L
}
