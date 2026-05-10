import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  "stories": [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"
  ],
  "addons": [
    "@chromatic-com/storybook",
    "@storybook/addon-vitest",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-onboarding",
    "storybook/viewport"
  ],
  "framework": "@storybook/react-vite",
  // Allow remote access (e.g. Tailscale hostnames) — Vite blocks unknown
  // Host headers by default. Dev-only; not a security concern here.
  viteFinal: async (config) => {
    config.server = config.server ?? {}
    config.server.allowedHosts = true
    return config
  },
};
export default config;