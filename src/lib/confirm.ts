import { Alert, Platform } from 'react-native';

/** Asks before something destructive. Alert has no buttons on the web, so the browser's own dialog is used there. */
export function confirmDestructive(title: string, actionLabel: string, onConfirm: () => void): void {
  if (Platform.OS === 'web') {
    if (window.confirm(title)) onConfirm();
    return;
  }
  Alert.alert(title, undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: actionLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
