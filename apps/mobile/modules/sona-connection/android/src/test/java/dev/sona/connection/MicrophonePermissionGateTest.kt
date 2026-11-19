package dev.sona.connection

import org.junit.Assert.*
import org.junit.Test

class MicrophonePermissionGateTest {
  private val origin = "https://192.168.1.2:9443"
  private var current: String? = origin
  private val completions = mutableListOf<(Boolean) -> Unit>()
  private val gate = MicrophonePermissionGate({ current }, { completions.add(it) })
  private var granted = 0
  private var denied = 0
  private fun request(id: Any = Any(), from: String = "$origin/", audioOnly: Boolean = true) {
    gate.request(id, from, audioOnly, { granted++ }, { denied++ })
  }

  @Test fun grantsOnlyAfterAndroidApproval() {
    request()
    assertEquals(0, granted)
    completions.single()(true)
    assertEquals(1, granted)
    assertEquals(0, denied)
  }

  @Test fun denialDoesNotGrant() {
    request()
    completions.single()(false)
    assertEquals(0, granted)
    assertEquals(1, denied)
  }

  @Test fun rejectsOtherOriginsAndNonAudioResourcesWithoutPrompting() {
    request(from = "https://attacker.example")
    request(from = "http://192.168.1.2:9443")
    request(from = "https://192.168.1.2:9444")
    request(audioOnly = false)
    assertTrue(completions.isEmpty())
    assertEquals(0, granted)
    assertEquals(4, denied)
  }

  @Test fun rejectsWhenNoPairedPageIsActive() {
    current = null
    request()
    assertTrue(completions.isEmpty())
    assertEquals(1, denied)
  }

  @Test fun navigationWhilePromptIsOpenCannotGrantAccess() {
    request()
    current = "https://192.168.1.3:9443"
    completions.single()(true)
    assertEquals(0, granted)
    assertEquals(1, denied)
  }

  @Test fun closeOrReloadInvalidatesLatePermissionResults() {
    request()
    gate.cancelAll()
    completions.single()(true)
    assertEquals(0, granted)
    assertEquals(1, denied)
  }

  @Test fun webViewCancellationIgnoresLatePermissionResult() {
    val id = Any()
    request(id)
    gate.cancel(id)
    completions.single()(true)
    assertEquals(0, granted)
    assertEquals(0, denied)
  }

  @Test fun replacingRequestCannotGrantTheOldOne() {
    request()
    request()
    completions[0](true)
    assertEquals(0, granted)
    assertEquals(1, denied)
    completions[1](true)
    assertEquals(1, granted)
  }

  @Test fun permissionServiceFailureDeniesRequest() {
    val failingGate = MicrophonePermissionGate({ origin }, { throw IllegalStateException("No activity") })
    failingGate.request(Any(), origin, true, { granted++ }, { denied++ })
    assertEquals(0, granted)
    assertEquals(1, denied)
  }
}
