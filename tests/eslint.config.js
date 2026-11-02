// Revisión estática del código de Kai. Se corre desde la raíz del repo (npm run lint).
//  - no-undef e import-x/named: nombres sin definir, sin importar o que el otro módulo no exporta
//    (lo que más fácil se rompe al repartir app.js en módulos).
//  - Dirección de las dependencias: lib ← models ← views ← controllers. Un modelo nunca importa la pantalla,
//    así se puede probar solo y cambiar la interfaz sin tocar los datos.
import globals from 'globals';
import importX from 'eslint-plugin-import-x';

const forbid = (groups, message) => ['error', { patterns: [{ group: groups, message }] }];

export default [
  { ignores: ['tests/**', 'vendor/**', 'sw.js', 'core.js'] },
  {
    files: ['*.js', 'lib/**/*.js', 'models/**/*.js', 'views/**/*.js', 'controllers/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser } },
    plugins: { 'import-x': importX },
    rules: {
      // lo que se importa existe: el archivo y cada nombre exportado (si no, Kai no arranca)
      'import-x/no-unresolved': 'error',
      'import-x/named': 'error',
      'import-x/no-cycle': 'off',
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-redeclare': 'error',
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // las ventanas del navegador a veces no aparecen en iPhone: Kai pregunta con su propia hoja
      'no-restricted-globals': ['error', ...['confirm', 'alert', 'prompt'].map((name) => ({ name, message: 'Usa askConfirm (views/sheet.js) o toast.' }))],
    },
  },
  {
    files: ['lib/**/*.js'],
    rules: { 'no-restricted-imports': forbid(['**/models/**', '**/views/**', '**/controllers/**', '**/app.js'], 'lib/ son utilidades generales: no conocen los datos ni la pantalla de Kai.') },
  },
  {
    files: ['models/**/*.js'],
    rules: { 'no-restricted-imports': forbid(['**/views/**', '**/controllers/**', '**/app.js'], 'Un modelo no depende de la pantalla: avisa con un evento y que el controlador decida qué dibujar.') },
  },
  {
    files: ['views/**/*.js'],
    rules: { 'no-restricted-imports': forbid(['**/controllers/**', '**/app.js'], 'Una vista solo dibuja: las acciones van en controllers/.') },
  },
];
