import { expoSecureStoreKeyStore, type KeyStore } from "@aulora/crypto";
import * as SecureStore from "expo-secure-store";

/**
 * The mobile MLS key store: records live in the iOS Keychain / Android Keystore
 * through `expo-secure-store`, chunked and indexed by
 * {@link expoSecureStoreKeyStore}.
 */
export function mobileKeyStore(): KeyStore {
  return expoSecureStoreKeyStore({ secureStore: SecureStore });
}
