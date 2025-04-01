import { Preferences } from "@capacitor/preferences";
import { KeyValueStorage, Scope, ScopedStorage } from "./types";

export class ScopedPreferencesStorage
  extends ScopedStorage
  implements KeyValueStorage
{
  constructor(scope: Scope, module?: string) {
    super(scope, module);
  }

  async storeObject<T>(key: string, item: T): Promise<void> {
    await this.setItem(key, JSON.stringify(item));
  }

  async loadObject<T>(key: string): Promise<T | undefined> {
    const item = await this.getItem(key);
    return item ? JSON.parse(item) : undefined;
  }

  async setItem(key: string, value: string): Promise<void> {
    await Preferences.set({
      key: this.scopedKey(key),
      value,
    });
  }

  async getItem(key: string): Promise<string | null> {
    const { value } = await Preferences.get({ key: this.scopedKey(key) });
    return value;
  }

  async removeItem(key: string): Promise<void> {
    await Preferences.remove({ key: this.scopedKey(key) });
  }

  async clear(): Promise<void> {
    const prefix = this.scopedKey("");
    const { keys } = await Preferences.keys();

    const removePromises = keys
      .filter((key) => key.startsWith(prefix))
      .map((key) => Preferences.remove({ key }));

    await Promise.all(removePromises);
  }
}
