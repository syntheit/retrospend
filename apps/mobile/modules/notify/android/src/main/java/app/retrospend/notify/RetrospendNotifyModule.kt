package app.retrospend.notify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Local notifications without Google services: notification channels and a
 * plain NotificationCompat post whose tap opens a retrospend:// link. The
 * background task (JS) decides what to post; nothing here talks to a server.
 */
class RetrospendNotifyModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("RetrospendNotify")

    // Creates or renames the channels (Android keeps a user's own settings for
    // an existing channel and only takes the new name and description).
    Function("ensureChannels") { channels: List<Map<String, String>> ->
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      for (channel in channels) {
        val id = channel["id"] ?: continue
        val made = NotificationChannel(id, channel["name"] ?: id, NotificationManager.IMPORTANCE_DEFAULT)
        made.description = channel["description"]
        manager.createNotificationChannel(made)
      }
    }

    // False when the user turned notifications off for the app, or has not
    // granted POST_NOTIFICATIONS on Android 13+.
    Function("enabled") {
      NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    // `key` makes the notification id, so posting the same event again
    // replaces the first instead of stacking.
    Function("post") { notification: Map<String, String> ->
      val key = notification["key"] ?: return@Function
      val url = notification["url"] ?: return@Function
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      val tap = PendingIntent.getActivity(
        context,
        key.hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val built = NotificationCompat.Builder(context, notification["channel"] ?: "splits")
        .setSmallIcon(context.applicationInfo.icon)
        .setContentTitle(notification["title"])
        .setContentText(notification["body"])
        .setAutoCancel(true)
        .setContentIntent(tap)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .build()
      try {
        NotificationManagerCompat.from(context).notify(key.hashCode(), built)
      } catch (_: SecurityException) {
        // Permission revoked between the check and the post.
      }
    }
  }
}
