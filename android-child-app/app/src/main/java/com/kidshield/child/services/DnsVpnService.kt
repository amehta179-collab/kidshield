package com.kidshield.child.services

import android.content.Intent
import android.net.VpnService
import android.os.ParcelFileDescriptor
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer

class DnsVpnService : VpnService() {

    private var vpnInterface: ParcelFileDescriptor? = null
    private var isRunning = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!isRunning) {
            setupVpn()
        }
        return START_STICKY
    }

    private fun setupVpn() {
        try {
            val builder = Builder()
                .setSession("KidShield Web Safety Filter")
                .addAddress("10.0.0.2", 32)
                .addDnsServer("1.1.1.3") // Cloudflare Family DNS (Blocks Adult Content automatically)
                .addRoute("1.1.1.3", 32)

            vpnInterface = builder.establish()
            isRunning = true
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        vpnInterface?.close()
        vpnInterface = null
        isRunning = false
    }
}
