package com.kidshield.child

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class LockOverlayActivity : AppCompatActivity() {

    companion object {
        const val ACTION_DISMISS_LOCK = "com.kidshield.child.ACTION_DISMISS_LOCK"
        var isOverlayShowing = false
    }

    private val dismissReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Ensure overlay covers screen and shows over lock screen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        setContentView(R.layout.activity_lock_overlay)
        isOverlayShowing = true

        val lockReason = intent.getStringExtra("EXTRA_LOCK_REASON") ?: "Device or App locked by Parent"
        findViewById<TextView>(R.id.tvLockMessage).text = lockReason

        findViewById<Button>(R.id.btnEmergencyCall).setOnClickListener {
            val dialIntent = Intent(Intent.ACTION_DIAL).apply {
                data = Uri.parse("tel:112")
            }
            startActivity(dialIntent)
        }

        val filter = IntentFilter(ACTION_DISMISS_LOCK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(dismissReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(dismissReceiver, filter)
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        val lockReason = intent?.getStringExtra("EXTRA_LOCK_REASON") ?: "Device or App locked by Parent"
        findViewById<TextView>(R.id.tvLockMessage).text = lockReason
    }

    override fun onDestroy() {
        super.onDestroy()
        isOverlayShowing = false
        try {
            unregisterReceiver(dismissReceiver)
        } catch (e: Exception) {
            // Ignored
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Prevent child from bypassing lock screen with back button
        val homeIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        startActivity(homeIntent)
    }
}
