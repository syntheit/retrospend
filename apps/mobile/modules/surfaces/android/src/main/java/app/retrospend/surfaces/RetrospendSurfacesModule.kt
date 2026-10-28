package app.retrospend.surfaces

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.IntentCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * Share into Retrospend (Android half). The manifest's SEND filters (added
 * by plugins/with-system-surfaces.js) deliver a text or a file to the main
 * activity; this reads the intent and hands JS one JSON string, the same
 * shape the iOS App Group hand-off uses (src/surfaces/prefill.ts). The file
 * stays a content:// URI; the grant on the intent lasts while the activity
 * does, and nothing here copies or uploads it.
 */
class RetrospendSurfacesModule : Module() {
  // A share that arrived while the app was running, until JS takes it.
  private var pending: Intent? = null

  override fun definition() = ModuleDefinition {
    Name("RetrospendSurfaces")

    Events("onPending")

    OnNewIntent { intent ->
      if (isShare(intent)) {
        pending = intent
        sendEvent("onPending", mapOf<String, Any>())
      }
    }

    // The share that opened or reached the app, once; null when there is none.
    Function("consumePending") {
      val activity = appContext.currentActivity
      val intent = pending ?: activity?.intent
      pending = null
      if (intent == null || !isShare(intent)) return@Function null
      // Reading it again (a rotation, a resume) must not reopen the composer.
      activity?.intent = Intent(Intent.ACTION_MAIN)
      read(intent)
    }
  }

  private fun isShare(intent: Intent) = intent.action == Intent.ACTION_SEND

  private fun read(intent: Intent): String {
    val json = JSONObject().put("kind", "share")
    intent.getStringExtra(Intent.EXTRA_TEXT)?.let { json.put("text", it) }
    val uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
    if (uri != null) {
      json.put(
        "file",
        JSONObject()
          .put("uri", uri.toString())
          .put("mime", intent.type ?: "application/octet-stream")
          .put("name", displayName(uri))
      )
    }
    return json.toString()
  }

  private fun displayName(uri: Uri): String {
    val resolver = appContext.reactContext?.contentResolver ?: return uri.lastPathSegment ?: ""
    return try {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
      } ?: uri.lastPathSegment ?: ""
    } catch (e: Exception) {
      uri.lastPathSegment ?: ""
    }
  }
}
