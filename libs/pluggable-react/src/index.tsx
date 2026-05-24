import React from 'react';
import { pluginRegistry } from '@pluggable-js/core';

// Component registry keyed by role
type ComponentEntry = React.ComponentType<any>;

class UiRegistry {
  private components: Map<string, ComponentEntry> = new Map();

  registerComponent(role: string, component: ComponentEntry): void {
    this.components.set(role, component);
  }

  getComponent(role: string): ComponentEntry | undefined {
    return this.components.get(role);
  }
}

export const uiRegistry = new UiRegistry();

export function ActiveWorkspaceView({
  role,
  passProps,
}: {
  role: string;
  passProps?: Record<string, unknown>;
}) {
  const Component = uiRegistry.getComponent(role);
  if (!Component) {
    return <p style={{ color: '#f87171' }}>No plugin registered for role: {role}</p>;
  }
  return <Component passProps={passProps} />;
}
