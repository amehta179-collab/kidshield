package com.kidshield.child

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.util.Log
import com.kidshield.child.services.ScreenStreamService

/**
 * Transparent launcher activity that requests the MediaProjection permission
 * from the user (shows the system "Start recording?" dialog), then hands
 * the granted intent to ScreenStreamService and finishes immediately.
 *
 * This must be triggered once by the parent (e.g., from the setup wizard).
 * After the first grant, the permission dialog does NOT appear again until
 * the app is reinstalled or the grant is revoked.
 */
class ScreenProjectionActivity : Activity() {

    private val tag = "KidShieldProjection"
    private val REQUEST_CODE = 1001

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Ask Android to show the "KidShield wants to start recording" consent dialog
        val projManager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(projManager.createScreenCaptureIntent(), REQUEST_CODE)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        if (requestCode == REQUEST_CODE && resultCode == RESULT_OK && data != null) {
            Log.d(tag, "Screen projection permission granted. Starting ScreenStreamService...")

            val serviceIntent = Intent(this, ScreenStreamService::class.java).apply {
                action = ScreenStreamService.ACTION_START
                putExtra(ScreenStreamService.EXTRA_RESULT_CODE, resultCode)
                putExtra(ScreenStreamService.EXTRA_RESULT_DATA, data)
            }
            startForegroundService(serviceIntent)
        } else {
            Log.w(tag, "Screen projection permission denied or cancelled (resultCode=$resultCode)")
        }

        // Always finish immediately — this activity has no visible UI
        finish()
    }
}
