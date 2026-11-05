package com.openmarket.auth

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * OpenMarketAuth — вход по аккаунту OpenMarket для сторонних приложений и игр.
 *
 * Без зависимостей: только Android + org.json. Скопируйте файл в проект и вызывайте:
 *
 *   OpenMarketAuth.signIn(context, email, password) { user, error ->
 *       if (user != null) { /* user.email, user.role */ } else { /* error */ }
 *   }
 *
 *   val user = OpenMarketAuth.currentUser(context)   // сессия или null
 *   OpenMarketAuth.signOut(context)
 *
 * Схема упрощённая: реестр users.txt публичный, хеши паролей видны всем.
 * Не используйте здесь пароль от других сервисов.
 */
object OpenMarketAuth {

    const val REGISTRY_URL =
        "https://raw.githubusercontent.com/CodeXyLabs/OpenMarket/main/users.txt"

    private const val PREFS = "openmarket_auth"
    private const val KEY_EMAIL = "email"
    private const val KEY_ROLE = "role"
    private const val KEY_CREATED_AT = "created_at"
    private const val TIMEOUT_MS = 15_000

    data class User(val email: String, val role: String, val createdAt: Long)

    private val executor = Executors.newCachedThreadPool()
    private val mainHandler = Handler(Looper.getMainLooper())

    fun signIn(context: Context, email: String, password: String, callback: (User?, String?) -> Unit) {
        val normalized = email.trim().lowercase()
        if (normalized.isEmpty() || password.isEmpty()) {
            callback(null, "Заполните почту и пароль")
            return
        }

        val appContext = context.applicationContext
        executor.execute {
            try {
                val registry = download(REGISTRY_URL)
                val row = parseRow(registry, normalized)
                    ?: return@execute post { callback(null, "Аккаунт с такой почтой не найден в OpenMarket") }

                val expected = row[2].trim().lowercase()
                val actual = sha256(row[1].trim() + ":" + password)
                if (actual != expected) {
                    post { callback(null, "Неверный пароль") }
                    return@execute
                }

                val user = User(
                    email = normalized,
                    role = row[4].trim().ifEmpty { "user" },
                    createdAt = row[3].trim().toLongOrNull() ?: 0L
                )
                appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putString(KEY_EMAIL, user.email)
                    .putString(KEY_ROLE, user.role)
                    .putLong(KEY_CREATED_AT, user.createdAt)
                    .apply()

                post { callback(user, null) }
            } catch (error: Exception) {
                post { callback(null, "Нет связи с реестром OpenMarket: ${error.message ?: "ошибка сети"}") }
            }
        }
    }

    fun currentUser(context: Context): User? {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val email = prefs.getString(KEY_EMAIL, null) ?: return null
        return User(
            email = email,
            role = prefs.getString(KEY_ROLE, "user") ?: "user",
            createdAt = prefs.getLong(KEY_CREATED_AT, 0L)
        )
    }

    fun signOut(context: Context) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().clear().apply()
    }

    private fun post(block: () -> Unit) {
        mainHandler.post(block)
    }

    private fun download(address: String): String {
        val connection = (URL(address).openConnection() as HttpURLConnection).apply {
            connectTimeout = TIMEOUT_MS
            readTimeout = TIMEOUT_MS
            setRequestProperty("Accept", "text/plain")
            setRequestProperty("User-Agent", "OpenMarketAuth")
        }
        return try {
            if (connection.responseCode != 200) error("HTTP ${connection.responseCode}")
            connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private fun parseRow(raw: String, email: String): List<String>? =
        raw.lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("#") }
            .map { it.split("|") }
            .firstOrNull { it.size >= 5 && it[0].trim().equals(email, ignoreCase = true) }

    private fun sha256(text: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(text.toByteArray(Charsets.UTF_8))
            .joinToString("") { byte -> "%02x".format(byte) }

    /** Необязательно: JSON-представление сессии, удобно сохранять в свой backend. */
    fun toJson(user: User): String = JSONObject()
        .put("email", user.email)
        .put("role", user.role)
        .put("createdAt", user.createdAt)
        .toString()
}
