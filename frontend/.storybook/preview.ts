import type { Preview } from '@storybook/react-vite'
import { INITIAL_VIEWPORTS } from 'storybook/viewport'
import '../src/index.css'

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },

    viewport: {
      options: INITIAL_VIEWPORTS,
    },

    a11y: {
      test: 'error'
    }
  },
};

export default preview;