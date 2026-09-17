package com.kidshield.child.receivers

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast

class KidShieldDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Toast.makeText(context, "KidShield Device Admin Security Enabled", Toast.LENGTH_SHORT).show()
    }

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        // Warning when child attempts to deactivate Device Admin
        return "WARNING: KidShield protection will be disabled and parent will be alerted immediately. Enter Parent PIN to proceed."
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Toast.makeText(context, "KidShield Security Deactivated", Toast.LENGTH_LONG).show()
    }
}
