package com.kidshield.child

import android.app.AppOpsManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.kidshield.child.receivers.KidShieldDeviceAdminReceiver
import com.kidshield.child.services.KidShieldMonitorService

class MainActivity : AppCompatActivity() {

    private lateinit var etPairingCode: EditText
    private lateinit var btnPairDevice: EditText
    private lateinit var tvStatus: TextView
    private lateinit var btnGrantUsage: Button
    private lateinit var btnGrantOverlay: Button
    private lateinit var btnGrantAdmin: Button

    private lateinit var devicePolicyManager: DevicePolicyManager
    private lateinit var adminComponent: ComponentName

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        devicePolicyManager = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        adminComponent = ComponentName(this, KidShieldDeviceAdminReceiver::class.java)

        initViews()
        checkAndStartService()
    }

    override fun onResume() {
        super.onResume()
        updatePermissionStatuses()
    }

    private fun initViews() {
        val btnStart = findViewById<Button>(R.id.btnStartService)
        val btnAdmin = findViewById<Button>(R.id.btnEnableAdmin)
        val btnUsage = findViewById<Button>(R.id.btnEnableUsage)
        val btnOverlay = findViewById<Button>(R.id.btnEnableOverlay)

        val btnLocation = findViewById<Button>(R.id.btnEnableLocation)

        btnUsage.setOnClickListener {
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        }

        btnOverlay.setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
                startActivity(intent)
            } else {
                Toast.makeText(this, "Overlay permission not required on this Android version", Toast.LENGTH_SHORT).show()
            }
        }

        btnAdmin.setOnClickListener {
            val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
                putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, adminComponent)
                putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, getString(R.string.device_admin_description))
            }
            startActivity(intent)
        }

        btnLocation.setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                requestPermissions(
                    arrayOf(
                        android.Manifest.permission.ACCESS_FINE_LOCATION,
                        android.Manifest.permission.ACCESS_COARSE_LOCATION
                    ),
                    1002
                )
            } else {
                Toast.makeText(this, "Location permission granted automatically", Toast.LENGTH_SHORT).show()
            }
        }

        btnStart.setOnClickListener {
            if (!hasUsageStatsPermission()) {
                Toast.makeText(this, "Please enable Usage Access first!", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
                Toast.makeText(this, "Please grant Display Over Other Apps permission!", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val serviceIntent = Intent(this, KidShieldMonitorService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
            Toast.makeText(this, "KidShield Protection Started!", Toast.LENGTH_LONG).show()
            updatePermissionStatuses()
        }

        updatePermissionStatuses()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        updatePermissionStatuses()
        if (hasLocationPermission()) {
            checkAndStartService()
        }
    }

    private fun updatePermissionStatuses() {
        val btnUsage = findViewById<Button>(R.id.btnEnableUsage)
        val btnOverlay = findViewById<Button>(R.id.btnEnableOverlay)
        val btnAdmin = findViewById<Button>(R.id.btnEnableAdmin)
        val btnLocation = findViewById<Button>(R.id.btnEnableLocation)

        if (hasUsageStatsPermission()) {
            btnUsage.text = "✓ 1. Screen Time Access Granted"
            btnUsage.setBackgroundColor(android.graphics.Color.parseColor("#059669"))
        } else {
            btnUsage.text = "1. Grant Screen Time Access"
            btnUsage.setBackgroundColor(android.graphics.Color.parseColor("#6366F1"))
        }

        val hasOverlay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) Settings.canDrawOverlays(this) else true
        if (hasOverlay) {
            btnOverlay.text = "✓ 2. Display Over Other Apps Granted"
            btnOverlay.setBackgroundColor(android.graphics.Color.parseColor("#059669"))
        } else {
            btnOverlay.text = "2. Grant Display Over Other Apps"
            btnOverlay.setBackgroundColor(android.graphics.Color.parseColor("#6366F1"))
        }

        if (devicePolicyManager.isAdminActive(adminComponent)) {
            btnAdmin.text = "✓ 3. Device Admin Active"
            btnAdmin.setBackgroundColor(android.graphics.Color.parseColor("#059669"))
        } else {
            btnAdmin.text = "3. Enable Device Admin (Security)"
            btnAdmin.setBackgroundColor(android.graphics.Color.parseColor("#4F46E5"))
        }

        if (hasLocationPermission()) {
            btnLocation.text = "✓ 4. GPS Location Granted"
            btnLocation.setBackgroundColor(android.graphics.Color.parseColor("#059669"))
        } else {
            btnLocation.text = "4. Grant GPS & Safe Zones Location"
            btnLocation.setBackgroundColor(android.graphics.Color.parseColor("#6366F1"))
        }
    }

    private fun hasLocationPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    private fun checkAndStartService() {
        if (hasUsageStatsPermission()) {
            val serviceIntent = Intent(this, KidShieldMonitorService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
        }
    }

    private fun hasUsageStatsPermission(): Boolean {
        val appOps = getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                packageName
            )
        } else {
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }
}
