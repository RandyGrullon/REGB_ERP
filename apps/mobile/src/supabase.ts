import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { createNativeClient } from '@regb/sdk/native'

/**
 * El cliente de Supabase de la app movil.
 *
 * La URL y la clave anonima llegan por `extra` de Expo -no se compilan
 * a mano en el bundle- y son las MISMAS que usa la web: la clave
 * anonima no da ningun privilegio, RLS decide que filas existen (§10).
 */
const extra = Constants.expoConfig?.extra as { supabaseUrl?: string; supabaseAnonKey?: string } | undefined

export const supabase = createNativeClient({
  url: extra?.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  anonKey: extra?.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  almacen: AsyncStorage,
})
