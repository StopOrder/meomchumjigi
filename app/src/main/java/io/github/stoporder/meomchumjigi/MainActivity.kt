package io.github.stoporder.meomchumjigi

import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.view.View
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * 화면은 assets/web 의 정적 페이지(좌석 배치도 · 음성 안내 · 신고 문장 · 기록)이고,
 * 차량 신호는 [VehicleSignalSource] 에서 받아 window.VehicleBridge 로 넘긴다.
 * 판정(멈춤 알아채기 · 남은 좌석 짚기 · 전원 하차 · 신고 문장)은 web/app.js 가 신호 값에서 계산한다.
 */
class MainActivity : Activity(), SignalSink {

    private lateinit var web: WebView
    private lateinit var source: VehicleSignalSource
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var runDemoOnLoad = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        source = if (PleosSignalSource.isAvailable(this)) PleosSignalSource(this) else DemoSignalSource()
        // 시험용: adb shell am start -n …/.MainActivity --ez autodemo true
        runDemoOnLoad = source.isDemo && intent.getBooleanExtra("autodemo", false)
        Log.i(TAG, "신호원: ${source.label}")

        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.KOREAN
                ttsReady = true
            }
        }

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            addJavascriptInterface(Bridge(), "Android")
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                    Log.i(TAG, "web: ${m.message()}")
                    return true
                }
            }
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    js("VehicleBridge.source(${JSONObject.quote(source.label)})")
                    if (!source.isDemo) {
                        source.start(this@MainActivity)
                    } else if (runDemoOnLoad) {
                        runDemoOnLoad = false
                        view.evaluateJavascript("document.getElementById('intro').hidden = true;", null)
                        source.start(this@MainActivity)
                    }
                }
            }
            loadUrl("file:///android_asset/web/index.html")
        }
        setContentView(web)

        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION

        if (!source.isDemo && checkSelfPermission(CAR_SPEED) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(CAR_SPEED), 1)
        }
    }

    override fun onDestroy() {
        source.stop()
        tts?.shutdown()
        super.onDestroy()
    }

    // ---------- 차량 신호 → 화면 ----------
    override fun onSpeed(kmh: Int, onHighway: Boolean) = js("VehicleBridge.speed($kmh, $onHighway)")
    override fun onTelltales(names: List<String>) = js("VehicleBridge.telltales(${JSONArray(names)})")
    override fun onAirbagDeployed() = js("VehicleBridge.airbag()")
    override fun onDoor(key: String, open: Boolean) = js("VehicleBridge.door(${JSONObject.quote(key)}, $open)")
    override fun onSeat(index: Int, occupied: Boolean) = js("VehicleBridge.seat($index, $occupied)")

    private fun js(code: String) {
        web.evaluateJavascript("window.VehicleBridge && $code", null)
    }

    // ---------- 화면 → 차량 ----------
    inner class Bridge {
        /** 음성 안내. Pleos 에서는 TextToSpeech SDK 로 바꿀 자리다. */
        @JavascriptInterface
        fun speak(text: String) {
            Log.i(TAG, "음성: $text")
            if (ttsReady) tts?.speak(text, TextToSpeech.QUEUE_ADD, null, text.hashCode().toString())
        }

        @JavascriptInterface
        fun setLamps(on: Boolean) = runOnUiThread { source.setEvacLamps(on) }

        @JavascriptInterface
        fun isDemo(): Boolean = source.isDemo

        /** 시연 각본을 처음부터 다시 돌린다. */
        @JavascriptInterface
        fun startDemo() = runOnUiThread {
            source.stop()
            tts?.stop()
            runDemoOnLoad = true
            web.reload()
        }
    }

    private companion object {
        const val TAG = "Meomchumjigi"
        const val CAR_SPEED = "android.car.permission.CAR_SPEED"
    }
}
