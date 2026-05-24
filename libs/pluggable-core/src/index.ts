export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  type: string;
  role: string;
}

class PluginRegistry {
  private plugins: PluginManifest[] = [];

  register(plugin: PluginManifest): void {
    this.plugins.push(plugin);
  }

  list(): PluginManifest[] {
    return [...this.plugins];
  }

  findByRole(role: string): PluginManifest | undefined {
    return this.plugins.find((p) => p.role === role);
  }
}

export const pluginRegistry = new PluginRegistry();
