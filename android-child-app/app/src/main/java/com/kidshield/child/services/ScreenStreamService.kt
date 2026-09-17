package com.kidshield.child.services

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

/**
 * KidShield Wireless Screen Streaming Service
 *
 * Uses Android's official MediaProjection API to capture the child device screen
 * and streams compressed JPEG frames to the cloud server via HTTP POST.
 * No USB cable or ADB required — works entirely over WiFi/4G.
 *
 * This is the same API used by Google Meet, Zoom and Discord for screen sharing.
 */
class ScreenStreamService : Service() {

    private val tag = "KidShieldScreen"
    private val serviceJob = Job()
    private val scope = CoroutineScope(Dispatchers.IO + serviceJob)

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .build()

    // Will be set from Config when connecting (cloud server URL)
    private val serverUrl = KidShieldConfig.SERVER_HTTP_URL
    private val deviceId   = KidShieldConfig.DEVICE_ID

    private var screenWidth  = 1080
    private var screenHeight = 2340
    private var screenDpi    = 320

    private var isStreaming = false
    private var lastFrameSentAt = 0L
    private val minFrameIntervalMs = 1800L  // ~0.55 FPS to stay lightweight

    companion object {
        const val ACTION_START   = "com.kidshield.child.SCREEN_STREAM_START"
        const val ACTION_STOP    = "com.kidshield.child.SCREEN_STREAM_STOP"
        const val EXTRA_RESULT_CODE   = "result_code"
        const val EXTRA_RESULT_DATA   = "result_data"
        private const val NOTIF_ID    = 2002
        private const val CHANNEL_ID  = "kidshield_screen_channel"
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()

        val metrics = DisplayMetrics()
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        @Suppress("DEPRECATION")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val display = display
            display?.getRealMetrics(metrics)
        } else {
            wm.defaultDisplay?.getRealMetrics(metrics)
        }
        screenWidth  = metrics.widthPixels
        screenHeight = metrics.heightPixels
        screenDpi    = metrics.densityDpi

        startForeground(NOTIF_ID, buildNotification())
        Log.d(tag, "ScreenStreamService created. Resolution: ${screenWidth}x${screenHeight} @${screenDpi}dpi")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, -1)
                @Suppress("DEPRECATION")
                val resultData: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                } else {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA)
                }
                if (resultCode != -1 && resultData != null) {
                    startScreenCapture(resultCode, resultData)
                } else {
                    Log.e(tag, "Missing projection data, stopping.")
                    stopSelf()
                }
            }
            ACTION_STOP -> {
                stopStreaming()
                stopSelf()
            }
        }
        return START_STICKY
    }

    private fun startScreenCapture(resultCode: Int, data: Intent) {
        val projManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjection = projManager.getMediaProjection(resultCode, data)

        // Capture at half resolution to reduce bandwidth
        val captureWidth  = (screenWidth  * 0.6).toInt()
        val captureHeight = (screenHeight * 0.6).toInt()

        imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2)
        virtualDisplay = mediaProjection?.createVirtualDisplay(
            "KidShieldCapture",
            captureWidth,
            captureHeight,
            screenDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface,
            null,
            null
        )

        isStreaming = true
        Log.d(tag, "Screen capture started. Streaming to $serverUrl")
        startFrameLoop(captureWidth, captureHeight)
    }

    private fun startFrameLoop(w: Int, h: Int) {
        scope.launch {
            while (isActive && isStreaming) {
                val now = System.currentTimeMillis()
                if (now - lastFrameSentAt >= minFrameIntervalMs) {
                    captureAndSendFrame(w, h)
                    lastFrameSentAt = now
                }
                delay(300)
            }
        }
    }

    private fun captureAndSendFrame(w: Int, h: Int) {
        var image: Image? = null
        try {
            image = imageReader?.acquireLatestImage() ?: return
            val planes = image.planes
            val buffer = planes[0].buffer
            val pixelStride = planes[0].pixelStride
            val rowStride   = planes[0].rowStride
            val rowPadding  = rowStride - pixelStride * w

            val bitmap = Bitmap.createBitmap(
                w + rowPadding / pixelStride,
                h,
                Bitmap.Config.ARGB_8888
            )
            bitmap.copyPixelsFromBuffer(buffer)
            val cropped = Bitmap.createBitmap(bitmap, 0, 0, w, h)

            val baos = ByteArrayOutputStream()
            // Compress to JPEG quality 55 — good balance of quality vs speed
            cropped.compress(Bitmap.CompressFormat.JPEG, 55, baos)
            val jpegBytes = baos.toByteArray()

            bitmap.recycle()
            cropped.recycle()

            // POST frame to cloud server
            val request = Request.Builder()
                .url("$serverUrl/api/devices/$deviceId/screen-push")
                .post(jpegBytes.toRequestBody("image/jpeg".toMediaType()))
                .addHeader("X-Device-Id", deviceId)
                .build()

            httpClient.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(tag, "Frame push failed: ${resp.code}")
                }
            }
        } catch (e: Exception) {
            Log.w(tag, "Frame capture error: ${e.message}")
        } finally {
            image?.close()
        }
    }

    private fun stopStreaming() {
        isStreaming = false
        virtualDisplay?.release()
        mediaProjection?.stop()
        imageReader?.close()
        virtualDisplay  = null
        mediaProjection = null
        imageReader     = null
        Log.d(tag, "Screen streaming stopped.")
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "KidShield Screen Sync",
                NotificationManager.IMPORTANCE_LOW
            ).apply { description = "Parental screen monitoring active" }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("KidShield Screen Monitoring")
            .setContentText("Parent can see your screen for safety supervision.")
            .setSmallIcon(android.R.drawable.ic_secure)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    override fun onDestroy() {
        stopStreaming()
        serviceJob.cancel()
        httpClient.dispatcher.executorService.shutdown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
