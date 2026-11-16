package dev.sona.connection

import android.content.Context
import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.net.http.SslCertificate
import android.webkit.*
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
import java.security.MessageDigest
import java.lang.ref.WeakReference

private const val FILE_REQUEST = 58312
private object NativeSession { var active: WeakReference<SonaConnectionView>? = null }
private object FileSelection { var callback: ValueCallback<Array<Uri>>? = null }

class SonaConnectionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SonaConnection")
    OnActivityResult { _, (requestCode, resultCode, data) ->
      if (requestCode == FILE_REQUEST) {
        val uris = if (resultCode == Activity.RESULT_OK) {
          data?.clipData?.let { clips -> Array(clips.itemCount) { clips.getItemAt(it).uri } }
            ?: data?.data?.let { arrayOf(it) }
        } else null
        // A picker may return only content-provider URIs, never local file paths.
        FileSelection.callback?.onReceiveValue(uris?.filter { it.scheme == "content" }?.toTypedArray())
        FileSelection.callback = null
      }
    }
    AsyncFunction("clearSession") { promise: Promise ->
      Handler(Looper.getMainLooper()).post {
        NativeSession.active?.get()?.close()
        CookieManager.getInstance().removeAllCookies { CookieManager.getInstance().flush(); promise.resolve(null) }
        WebStorage.getInstance().deleteAllData()
      }
    }
    View(SonaConnectionView::class) {
      Events("onState", "onExternalLink", "onBackBoundary")
      Prop("backRequest") { view: SonaConnectionView, value: Int -> view.back(value) }
      OnViewDestroys { view: SonaConnectionView -> view.close() }
      Prop("connection") { view: SonaConnectionView, value: Map<String, String> -> view.connect(value) }
    }
  }
}

class SonaConnectionView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onState by EventDispatcher()
  val onExternalLink by EventDispatcher()
  val onBackBoundary by EventDispatcher()
  private var lastBackRequest: Int? = null
  private var closed = false
  private var origin = ""
  private var pin = ""
  private var currentConnection = ""
  private var pageFailed = false
  private val browser = WebView(context)
  private val sessionHandler = Handler(Looper.getMainLooper())
  private val sessionCheck = object : Runnable {
    override fun run() {
      if (closed || pageFailed || !sameOrigin(browser.url ?: "") || Uri.parse(browser.url).path == "/pair") return
      browser.evaluateJavascript("""
        fetch('/api/auth/session', {credentials:'include', cache:'no-store'})
          .then(response => response.json())
          .then(session => { if (!session.authenticated) location.replace('/auth/signed-out'); })
          .catch(() => {});
      """.trimIndent(), null)
      sessionHandler.postDelayed(this, 15_000)
    }
  }
  init {
    NativeSession.active = WeakReference(this)
    browser.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    addView(browser)
    browser.settings.javaScriptEnabled = true
    browser.settings.domStorageEnabled = true
    browser.settings.allowFileAccess = false
    browser.settings.allowContentAccess = false
    browser.settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
    CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false)
    browser.settings.setSupportMultipleWindows(false)
    browser.webChromeClient = object : WebChromeClient() {
      override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
        if (!sameOrigin(view.url ?: "")) return false
        FileSelection.callback?.onReceiveValue(null)
        FileSelection.callback = callback
        try {
          val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
            val accepted = params.acceptTypes.filter { it.contains("/") }
            if (accepted.isNotEmpty()) putExtra(Intent.EXTRA_MIME_TYPES, accepted.toTypedArray())
          }
          val activity = appContext.currentActivity ?: throw IllegalStateException("No activity")
          activity.startActivityForResult(intent, FILE_REQUEST)
        } catch (_: Exception) { FileSelection.callback?.onReceiveValue(null); FileSelection.callback = null }
        return true
      }
    }
    browser.webViewClient = object : WebViewClient() {
      override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) { pageFailed = false; sessionHandler.removeCallbacks(sessionCheck) }
      override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
        if (request.isForMainFrame) {
          pageFailed = true
          onState(mapOf("state" to "error", "message" to "The computer refused this connection. Scan a new pairing code from its Connections settings."))
        }
      }
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url
        if (sameOrigin(uri.toString()) && uri.path == "/auth/signed-out") {
          sessionHandler.removeCallbacks(sessionCheck)
          view.loadUrl("about:blank")
          onState(mapOf("state" to "error", "message" to "Access expired or was revoked. Scan a new pairing code from your computer."))
          return true
        }
        if (sameOrigin(uri.toString())) return false
        if (request.isForMainFrame && uri.scheme in listOf("https", "http")) onExternalLink(mapOf("url" to uri.toString()))
        return true
      }
      override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        val der = SslCertificate.saveState(error.certificate)?.getByteArray("x509-certificate")
        val actual = der?.let { MessageDigest.getInstance("SHA-256").digest(it).joinToString("") { byte -> "%02x".format(byte) } }
        // Accept only the exact certificate transferred out of band from the computer's QR.
        // Never trust a new certificate silently or allow cross-origin certificate exceptions.
        if (sameOrigin(error.url) && actual == pin && pin.length == 64 && !error.hasError(SslError.SSL_EXPIRED) && !error.hasError(SslError.SSL_NOTYETVALID)) handler.proceed()
        else { handler.cancel(); if (!sameOrigin(error.url)) return; pageFailed = true; onState(mapOf("state" to "error", "message" to "The computer's identity changed. Pair again from its screen.")) }
      }
      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (request.isForMainFrame) { pageFailed = true; onState(mapOf("state" to "error", "message" to "Cannot reach your computer. Check Wi-Fi and local connections, then retry.")) }
      }
      override fun onPageFinished(view: WebView, url: String) {
        CookieManager.getInstance().flush()
        if (pageFailed) return
        if (sameOrigin(url) && Uri.parse(url).path == "/auth/signed-out") { onState(mapOf("state" to "error", "message" to "Access expired or was revoked. Scan a new pairing code from your computer.")); return }
        if (sameOrigin(url) && Uri.parse(url).path != "/pair") {
          onState(mapOf("state" to "ready"))
          sessionHandler.removeCallbacks(sessionCheck)
          sessionHandler.post(sessionCheck)
        }
      }
    }
  }
  private fun sameOrigin(url: String): Boolean {
    val uri = Uri.parse(url)
    return uri.scheme == "https" && "${uri.scheme}://${uri.encodedAuthority}" == origin
  }
  fun connect(value: Map<String, String>) {
    val endpoint = value["endpoint"] ?: return
    val fingerprint = value["certificateFingerprint"] ?: return
    val credential = value["credential"] ?: ""
    if (!fingerprint.matches(Regex("[a-f0-9]{64}")) || !endpoint.startsWith("https://")) return
    // Once a credential has been consumed, dropping it must not reload the page.
    if (endpoint == origin && fingerprint == pin && credential.isEmpty() && currentConnection.isNotEmpty()) return
    val key = "$endpoint|$fingerprint|$credential"
    if (key == currentConnection) return
    currentConnection = key; origin = endpoint; pin = fingerprint
    browser.stopLoading()
    browser.clearSslPreferences()
    onState(mapOf("state" to "loading"))
    browser.loadUrl(if (credential.isEmpty()) "$origin/" else "$origin/pair#token=${Uri.encode(credential)}")
  }
  fun back(value: Int) {
    if (lastBackRequest == null) { lastBackRequest = value; return }
    if (value == lastBackRequest) return
    lastBackRequest = value
    if (browser.canGoBack()) browser.goBack() else onBackBoundary(emptyMap<String, String>())
  }
  fun close() {
    if (closed) return
    closed = true
    sessionHandler.removeCallbacks(sessionCheck)
    FileSelection.callback?.onReceiveValue(null)
    FileSelection.callback = null
    browser.stopLoading()
    browser.clearSslPreferences()
    browser.loadUrl("about:blank")
    removeView(browser)
    browser.destroy()
  }
}
