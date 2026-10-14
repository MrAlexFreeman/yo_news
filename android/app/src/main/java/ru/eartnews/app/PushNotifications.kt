package ru.eartnews.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

/**
 * Канал уведомлений «Ё-новостей» — один на приложение и на SDK.
 *
 * **Зачем отдельный объект, а не создание канала внутри службы.** Канал нужен ровно там, где
 * уведомление показывается, а показывают его двое: наша служба приёма пушей (data-only рассылка)
 * и сам SDK RuStore, когда пуш приходит с готовым объектом `notification` — например, тестовый
 * пуш из консоли. SDK берёт идентификатор канала из манифеста
 * (`ru.rustore.sdk.pushclient.default_notification_channel_id` = `yo_news_urgent`), но **сам его
 * не создаёт**: по разбору классов pushclient (`DefaultChannelManager`) он создаёт только свой
 * собственный канал `ru.mail.vkpns.default_notification_channel`. Android отбрасывает
 * уведомление, отправленное в несуществующий канал, — молча, без ошибки в логе приложения.
 * Поэтому канал создаётся заранее, при запуске приложения, а не в момент показа: тестовый пуш на
 * свежей установке иначе потерялся бы.
 *
 * Идентификатор и название лежат здесь в одном месте: строка в манифесте и строки в Java- и
 * Kotlin-коде обязаны совпадать, а расхождение между ними не поймать ни компилятором, ни глазом.
 */
object PushNotifications {

    /** Идентификатор канала. Продублирован строкой в манифесте — менять только вместе. */
    const val CHANNEL_ID = "yo_news_urgent"

    /** Название, которое читатель видит в настройках Android. */
    const val CHANNEL_NAME = "Срочные новости"

    /** Подпись под названием в настройках. */
    private const val CHANNEL_DESCRIPTION = "Важные новости Ё-новостей"

    /**
     * Создаёт канал, если его ещё нет.
     *
     * `@JvmStatic` — чтобы `MainActivity` (Java-класс шаблона Capacitor) звал это как
     * `PushNotifications.ensureChannel(this)` без обращения к `INSTANCE`.
     *
     * Повторный вызов безвреден и дешев: Android разрешает создавать уже существующий канал, и
     * изменить его важность после создания всё равно нельзя — читатель мог её понизить сам, и
     * перезапись была бы неуважением к его выбору.
     */
    @JvmStatic
    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = CHANNEL_DESCRIPTION
            enableVibration(true)
        }

        manager.createNotificationChannel(channel)
    }
}
