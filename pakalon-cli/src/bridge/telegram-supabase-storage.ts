/**
 * Supabase Storage for Telegram Tokens
 * 
 * Stores Telegram bot tokens securely in Supabase backend
 * instead of local filesystem for better security and
 * cross-device sync.
 */

import { getApiClient } from "@/api/client.js";
import { debugLog } from "@/utils/logger.js";

export interface TelegramTokenData {
  token: string;
  botUsername?: string;
  webhookUrl?: string;
  connectedAt: string;
  lastUpdateId?: number;
  userId?: string;
}

export interface SupabaseStorageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

class TelegramSupabaseStorage {
  private supabaseUrl: string | null = null;
  private supabaseKey: string | null = null;

  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL || process.env.PAKALON_SUPABASE_URL || null;
    this.supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.PAKALON_SUPABASE_KEY || null;
  }

  isAvailable(): boolean {
    return Boolean(this.supabaseUrl && this.supabaseKey);
  }

  async storeToken(data: TelegramTokenData): Promise<SupabaseStorageResult<void>> {
    if (!this.isAvailable()) {
      return { success: false, error: "Supabase not configured" };
    }

    try {
      const apiClient = getApiClient();
      const response = await apiClient.put("/users/me/telegram-token", {
        token: data.token,
        bot_username: data.botUsername,
        webhook_url: data.webhookUrl,
        connected_at: data.connectedAt,
        last_update_id: data.lastUpdateId,
      });

      if (response.status === 200 || response.status === 201) {
        return { success: true };
      }

      return { success: false, error: `Failed to store token: ${response.status}` };
    } catch (err) {
      debugLog("[TelegramSupabase] Failed to store token:", err);
      return { success: false, error: String(err) };
    }
  }

  async retrieveToken(): Promise<SupabaseStorageResult<TelegramTokenData | null>> {
    if (!this.isAvailable()) {
      return { success: false, error: "Supabase not configured" };
    }

    try {
      const apiClient = getApiClient();
      const response = await apiClient.get<{
        token?: string;
        bot_username?: string;
        webhook_url?: string;
        connected_at?: string;
        last_update_id?: number;
      }>("/users/me/telegram-token");

      if (response.status === 200 && response.data?.token) {
        return {
          success: true,
          data: {
            token: response.data.token,
            botUsername: response.data.bot_username,
            webhookUrl: response.data.webhook_url,
            connectedAt: response.data.connected_at || new Date().toISOString(),
            lastUpdateId: response.data.last_update_id,
          },
        };
      }

      return { success: true, data: null };
    } catch (err) {
      debugLog("[TelegramSupabase] Failed to retrieve token:", err);
      return { success: false, error: String(err) };
    }
  }

  async deleteToken(): Promise<SupabaseStorageResult<void>> {
    if (!this.isAvailable()) {
      return { success: false, error: "Supabase not configured" };
    }

    try {
      const apiClient = getApiClient();
      const response = await apiClient.delete("/users/me/telegram-token");

      if (response.status === 200 || response.status === 204) {
        return { success: true };
      }

      return { success: false, error: `Failed to delete token: ${response.status}` };
    } catch (err) {
      debugLog("[TelegramSupabase] Failed to delete token:", err);
      return { success: false, error: String(err) };
    }
  }

  async updateLastUpdateId(updateId: number): Promise<SupabaseStorageResult<void>> {
    if (!this.isAvailable()) {
      return { success: false, error: "Supabase not configured" };
    }

    try {
      const apiClient = getApiClient();
      await apiClient.patch("/users/me/telegram-token", {
        last_update_id: updateId,
      });

      return { success: true };
    } catch (err) {
      debugLog("[TelegramSupabase] Failed to update lastUpdateId:", err);
      return { success: false, error: String(err) };
    }
  }
}

export const telegramSupabaseStorage = new TelegramSupabaseStorage();

export async function storeTelegramTokenInSupabase(
  data: TelegramTokenData
): Promise<boolean> {
  const result = await telegramSupabaseStorage.storeToken(data);
  return result.success;
}

export async function getTelegramTokenFromSupabase(): Promise<TelegramTokenData | null> {
  const result = await telegramSupabaseStorage.retrieveToken();
  return result.data ?? null;
}

export async function deleteTelegramTokenFromSupabase(): Promise<boolean> {
  const result = await telegramSupabaseStorage.deleteToken();
  return result.success;
}

export function isSupabaseStorageAvailable(): boolean {
  return telegramSupabaseStorage.isAvailable();
}