package dev.sona.connection

// Owns the asynchronous Android permission prompt for the currently paired page.
// Keeping this lifecycle independent of WebView lets cancellation and late grants
// be tested without granting a real device permission.
internal class MicrophonePermissionGate(
  private val currentOrigin: () -> String?,
  private val requestPermission: ((Boolean) -> Unit) -> Unit,
) {
  private class Pending(val id: Any, val origin: String, val grant: () -> Unit, val deny: () -> Unit)
  private var pending: Pending? = null

  fun request(id: Any, origin: String, audioOnly: Boolean, grant: () -> Unit, deny: () -> Unit) {
    if (!audioOnly || !origin.startsWith("https://") || origin.removeSuffix("/") != currentOrigin()) {
      deny()
      return
    }
    cancelAll()
    val request = Pending(id, origin.removeSuffix("/"), grant, deny)
    pending = request
    try {
      requestPermission { allowed ->
        if (pending !== request) return@requestPermission
        pending = null
        if (allowed && currentOrigin() == request.origin) request.grant() else request.deny()
      }
    } catch (_: Exception) {
      if (pending === request) {
        pending = null
        request.deny()
      }
    }
  }

  fun cancel(id: Any) {
    if (pending?.id === id) pending = null
  }

  fun cancelAll() {
    val request = pending
    pending = null
    request?.deny?.invoke()
  }
}
