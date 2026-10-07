import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// While the app is open it shows what is happening itself, so a notification on top would be noise.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
});

/**
 * This phone's push token, asking for permission the first time. Undefined when push is not
 * available: permission refused, or running in Expo Go on Android, which cannot receive it.
 */
export async function pushToken(): Promise<string | undefined> {
  try {
    if (Platform.OS === 'android')
      await Notifications.setNotificationChannelAsync('default', { name: 'Agents', importance: Notifications.AndroidImportance.HIGH });
    let { granted } = await Notifications.getPermissionsAsync();
    if (!granted) ({ granted } = await Notifications.requestPermissionsAsync());
    if (!granted) return undefined;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return undefined;
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return undefined;
  }
}

/** The agent a tapped notification was about, if the app was opened by one. */
export function useTappedAgent(): string | undefined {
  const agentId = Notifications.useLastNotificationResponse()?.notification.request.content.data?.agentId;
  return typeof agentId === 'string' ? agentId : undefined;
}
