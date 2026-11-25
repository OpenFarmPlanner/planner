import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'openlayers', test: /node_modules\/(ol|rbush|quickselect)\// }],
        },
      },
    },
  },
});
