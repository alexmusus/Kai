// Revisión estática del código de Kai: sobre todo nombres sin definir o sin importar,
// que es lo que más fácil se rompe al repartir app.js en módulos. Se corre desde la raíz del repo.
import globals from 'globals';

export default [
  { ignores: ['tests/**', 'vendor/**', 'sw.js', 'core.js'] },
  {
    files: ['*.js', 'lib/**/*.js', 'models/**/*.js', 'views/**/*.js', 'controllers/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser } },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-redeclare': 'error' },
  },
];
